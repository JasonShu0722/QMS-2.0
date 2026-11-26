import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { ProcessEightDReminderService } from '../../src/modules/process-quality/process-eight-d-reminder.service.js';
import { ProcessEightDTaskService } from '../../src/modules/process-quality/process-eight-d-task.service.js';
import { OutboxWorkerService } from '../../src/modules/task-notification/outbox-worker.service.js';
import { createDisposableAppDatabase } from '../disposable-app-database.js';
import { createProcessEightDTaskFixture, clearProcessEightDTaskFixtureEvents, requireDisposableProcessEightDDatabase, waitForProcessEightDProblemLock } from './process-eight-d-task.fixture.js';

requireDisposableProcessEightDDatabase();
describe('process reminders through real atomic outbox worker and PostgreSQL', () => {
  let app: INestApplicationContext;
  let reminders: ProcessEightDReminderService;
  let prisma: PrismaService;
  const organizations: string[] = [];
  const originalDatabaseUrl = process.env.DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = await createDisposableAppDatabase('qms_process_reminder');
    app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    reminders = app.get(ProcessEightDReminderService); prisma = app.get(PrismaService);
  }, 120000);
  afterEach(async () => clearProcessEightDTaskFixtureEvents(prisma, organizations));
  afterAll(async () => {
    try { await app?.close(); }
    finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });
  const fixture = () => createProcessEightDTaskFixture(app, organizations);
  const deliver = () => app.get(OutboxWorkerService).processAtomicDue(100, reminders);
  async function pollCycle() {
    const [{ total }] = await prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM process_eight_d_reports`;
    const limit = 100;
    // A resumed cursor can end on an old tail; visit a full bounded cycle before asserting this fixture.
    for (let page = 0; page < Math.ceil(total / limit) + 1; page++) await reminders.poll(limit);
  }
  const recipients = async (problemId: string, kind: string) => (await prisma.$queryRaw<{ userId: string }[]>`SELECT recipient_user_id AS "userId" FROM process_eight_d_notifications
    WHERE problem_id = ${problemId}::uuid AND kind = ${kind} ORDER BY recipient_user_id`).map(r => r.userId);

  it('polls persisted current stages, sends once to owner and actual issuing quality, and is replay-safe', async () => {
    const f = await fixture(); await pollCycle(); await deliver();
    expect(await recipients(f.problem.id, 'HANDLING_REMINDER')).toEqual([f.owner.user.id, f.professional.user.id].sort());
    await pollCycle(); await deliver();
    expect(await recipients(f.problem.id, 'HANDLING_REMINDER')).toHaveLength(2);
    const list = await app.get(ProcessEightDTaskService).notifications(f.owner.actor, { problemId: f.problem.id });
    expect(list).toMatchObject({ total: 1, items: [{ kind: 'HANDLING_REMINDER' }] });
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { eventType: 'PROCESS_EIGHT_D_REMINDER_DUE', aggregateId: f.problem.id } });
    await prisma.$transaction(tx => reminders.handle(tx, { ...event, processingAt: new Date() }));
    expect(await recipients(f.problem.id, 'HANDLING_REMINDER')).toHaveLength(2);
  }, 120000);

  it('does not invent overdue for missing stage plans or create reminders when explicitly disabled', async () => {
    const f = await fixture();
    await prisma.$executeRaw`UPDATE process_eight_d_reports SET analysis_completed_at = CURRENT_TIMESTAMP WHERE problem_id = ${f.problem.id}::uuid`;
    await pollCycle(); await deliver(); expect(await recipients(f.problem.id, 'HANDLING_REMINDER')).toHaveLength(0);
    await prisma.$executeRaw`UPDATE process_eight_d_reports SET analysis_completed_at = NULL WHERE problem_id = ${f.problem.id}::uuid`;
    await prisma.workflowNode.update({ where: { id: f.ownerNode.id }, data: { config: { isStart: true, assignment: { permission: 'workflow:act' }, processEightD: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: null } } } });
    await pollCycle(); await deliver(); expect(await recipients(f.problem.id, 'HANDLING_REMINDER')).toHaveLength(0);
  }, 120000);

  it('rechecks real qualifications at send time, not the earlier poll or a synthesized session', async () => {
    const f = await fixture(); await pollCycle();
    await prisma.userRole.deleteMany({ where: { userId: f.owner.user.id } });
    await deliver();
    expect(await recipients(f.problem.id, 'HANDLING_REMINDER')).toEqual([f.professional.user.id]);
    expect(await prisma.session.count({ where: { userId: f.owner.user.id } })).toBe(1);
  }, 120000);

  it('sends extension duties only to the current serial approver and cancels changed sources with a reapply notice', async () => {
    const f = await fixture(); const r = await f.request(); await deliver();
    expect(await recipients(f.problem.id, 'EXTENSION_PENDING')).toEqual([f.manager.user.id]);
    const quality = await f.extensions.decide(f.manager.actor, r.id, { expectedVersion: 1, decision: 'APPROVE' }, randomUUID(), randomUUID());
    await deliver();
    expect(await recipients(f.problem.id, 'EXTENSION_PENDING')).toEqual([f.manager.user.id, f.professional.user.id].sort());
    await prisma.$executeRaw`UPDATE department_management_bindings SET version = version + 1 WHERE id = ${f.managerBinding}::uuid`;
    await pollCycle(); await deliver();
    expect((await f.extensions.history(f.owner.actor, f.problem.id))[0]).toMatchObject({ status: 'CANCELLED', version: quality.version + 1 });
    expect(await recipients(f.problem.id, 'EXTENSION_CANCELLED')).toEqual([f.owner.user.id]);
    const inbox = await app.get(ProcessEightDTaskService).notifications(f.manager.actor, { problemId: f.problem.id });
    expect(inbox.items.some(item => item.kind === 'EXTENSION_PENDING')).toBe(false);
  }, 120000);

  it('does not nag a submitted owner or the approved/skipped management duty', async () => {
    const f = await fixture(); const round = await f.toClosure();
    await f.rounds.decide(f.manager.actor, round.id, { expectedRoundVersion: round.version, duties: ['SECTION_MANAGER'], decision: 'APPROVE', comment: 'Real manager approved' }, randomUUID(), randomUUID());
    await pollCycle(); await deliver();
    expect(await recipients(f.problem.id, 'HANDLING_REMINDER')).toHaveLength(0);
    expect(await recipients(f.problem.id, 'CLOSURE_REMINDER')).toEqual([f.professional.user.id]);
  }, 120000);

  it('delivers closure reminders to the configured manager as well as the professional reviewer', async () => {
    const f = await fixture(); await f.toClosure();
    await pollCycle(); await deliver();
    expect(await recipients(f.problem.id, 'CLOSURE_REMINDER')).toEqual([f.manager.user.id, f.professional.user.id].sort());
    const inbox = await app.get(ProcessEightDTaskService).notifications(f.manager.actor, { problemId: f.problem.id });
    expect(inbox).toMatchObject({ items: [{ kind: 'CLOSURE_REMINDER' }] });
  }, 120000);

  it('delivers a readable periodic closure reminder to the directly granted issuer after their final appointment ends', async () => {
    const f = await fixture();
    await f.toClosure();
    await prisma.userPosition.update({ where: { id: f.professional.assignment.id }, data: { endedAt: new Date() } });
    await pollCycle(); await deliver();
    expect(await recipients(f.problem.id, 'CLOSURE_REMINDER')).toEqual([f.manager.user.id, f.professional.user.id].sort());
    expect(await app.get(ProcessEightDTaskService).notifications(f.professional.actor, { problemId: f.problem.id })).toMatchObject({
      items: [{ kind: 'CLOSURE_REMINDER' }],
    });
  }, 120000);

  it('reconciles an invalid legacy reviewer in place but keeps a still-valid legacy reviewer', async () => {
    const f = await fixture();
    const round = await f.toClosure();
    const previousPlan = await prisma.$transaction(tx => f.rounds.plan(tx, { ...round.context, processManagement: undefined }));
    const legacy = previousPlan.duties.find(duty => duty.duty === 'SECTION_MANAGER')!.participant!;
    await prisma.$executeRaw`UPDATE workflow_closure_rounds SET context = context - 'processManagement' - 'flowRecords' WHERE id = ${round.id}::uuid`;
    await prisma.$executeRaw`UPDATE workflow_closure_duties SET participant = ${JSON.stringify(legacy)}::jsonb
      WHERE round_id = ${round.id}::uuid AND duty = 'SECTION_MANAGER'`;
    const replacement = await f.person(f.section.id);
    await prisma.$executeRaw`UPDATE department_responsible_appointments
      SET assignment_ids = ARRAY[${replacement.assignment.id}::uuid], primary_assignment_id = ${replacement.assignment.id}::uuid, version = version + 1
      WHERE organization_id = ${f.org.id}::uuid AND department_id = ${f.section.id}::uuid`;
    await pollCycle();
    expect((await f.rounds.history(f.owner.actor, f.problem.id))[0]).toMatchObject({ id: round.id, version: round.version, duties: [
      { duty: 'PROFESSIONAL', status: 'PENDING' }, { duty: 'SECTION_MANAGER', participant: legacy, status: 'PENDING' },
    ] });

    const decided = await f.decide(f.professional.actor, round, ['PROFESSIONAL']);
    await prisma.user.update({ where: { id: f.professional.user.id }, data: { status: 'DISABLED' } });
    await prisma.userPosition.update({ where: { id: f.manager.assignment.id }, data: { endedAt: new Date() } });
    await pollCycle();
    const [reconciled, ...older] = await f.rounds.history(f.owner.actor, f.problem.id);
    expect(older).toHaveLength(0);
    expect(reconciled).toMatchObject({ id: round.id, status: 'PENDING', version: decided.version + 1, context: { processManagement: true }, duties: [
      decided.duties[0], { id: round.duties[1]!.id, duty: 'SECTION_MANAGER', userId: replacement.user.id, status: 'PENDING' },
    ] });
    expect(reconciled!.context.flowRecords?.[0]).toEqual({ occurredAt: round.createdAt, person: '系统',
      content: `管理审核派给${f.manager.user.fullName?.trim() || f.manager.user.username}` });
    expect(await f.rounds.eligibleDuties(replacement.actor)).toMatchObject([{ roundId: round.id, duty: 'SECTION_MANAGER' }]);
  }, 120000);

  it('records why a delegated review changes to the parent lead after its appointment is revoked', async () => {
    const f = await fixture();
    const parentLead = await f.person(f.dept.id);
    await prisma.problemIndex.update({ where: { id: f.problem.id }, data: { severity: 'HIGH' } });
    await prisma.$executeRaw`INSERT INTO department_responsible_appointments (organization_id, department_id, assignment_ids, primary_assignment_id, version)
      VALUES (${f.org.id}::uuid, ${f.dept.id}::uuid,
        ARRAY[${f.minister.assignment.id}::uuid, ${parentLead.assignment.id}::uuid], ${parentLead.assignment.id}::uuid, 1)`;
    await prisma.$executeRaw`UPDATE department_minister_scopes SET department_leadership = true WHERE id = ${f.scopeId}::uuid`;
    const round = await f.toClosure();
    expect(round.duties).toContainEqual(expect.objectContaining({ duty: 'MINISTER', userId: f.minister.user.id }));
    const revokedAt = new Date();
    await prisma.$transaction(async tx => {
      await tx.userPosition.update({ where: { id: f.minister.assignment.id }, data: { endedAt: revokedAt } });
      await tx.$executeRaw`UPDATE department_minister_scopes SET status = 'DISABLED', version = version + 1, updated_at = ${revokedAt}
        WHERE id = ${f.scopeId}::uuid`;
      await tx.$executeRaw`INSERT INTO department_minister_scopes (id, organization_id, department_id, section_department_id,
        minister_assignment_id, department_leadership, status, valid_from, valid_to, created_by, updated_by, updated_at)
        VALUES (${randomUUID()}::uuid, ${f.org.id}::uuid, ${f.dept.id}::uuid, ${f.section.id}::uuid,
          ${parentLead.assignment.id}::uuid, true, 'DISABLED', ${new Date(revokedAt.getTime() - 120000)},
          ${new Date(revokedAt.getTime() - 90000)}, ${parentLead.user.id}::uuid, ${parentLead.user.id}::uuid,
          ${new Date(revokedAt.getTime() + 1)})`;
    });
    await pollCycle();
    const [updated] = await f.rounds.history(f.owner.actor, f.problem.id);
    expect(updated?.duties).toContainEqual(expect.objectContaining({ duty: 'MINISTER', userId: parentLead.user.id, status: 'PENDING' }));
    expect(updated?.context.flowRecords).toContainEqual(expect.objectContaining({ person: '系统', content: '原分管任职已失效，改派直属上级主负责人' }));
  }, 120000);

  it('rejects a stale management decision but accepts the professional decision before the worker reconciles', async () => {
    const f = await fixture();
    const round = await f.toClosure();
    const replacement = await f.person(f.section.id);
    await prisma.$executeRaw`UPDATE department_responsible_appointments
      SET assignment_ids = ARRAY[${replacement.assignment.id}::uuid], primary_assignment_id = ${replacement.assignment.id}::uuid, version = version + 1
      WHERE organization_id = ${f.org.id}::uuid AND department_id = ${f.section.id}::uuid`;
    await prisma.workflowTransition.create({ data: { organizationId: f.org.id, workflowVersionId: round.workflowVersionId,
      fromNodeId: f.node.id, toNodeId: f.ownerNode.id, transitionKey: 'return', action: 'RETURN' } });
    expect(await f.rounds.eligibleDuties(f.professional.actor)).toMatchObject([{ roundId: round.id, duty: 'PROFESSIONAL' }]);
    await expect(f.decide(f.manager.actor, round, ['SECTION_MANAGER'])).rejects.toMatchObject({ status: 403 });
    const decided = await f.decide(f.professional.actor, round, ['PROFESSIONAL']);
    expect(decided).toMatchObject({ id: round.id, status: 'PENDING', version: round.version + 1, duties: [
      { duty: 'PROFESSIONAL', status: 'APPROVED', decidedBy: f.professional.user.id }, { duty: 'SECTION_MANAGER', status: 'PENDING' },
    ] });
  }, 120000);

  it('automatically closes after management skip without a live actor or a human workflow mutation', async () => {
    const f = await fixture();
    const round = await f.toClosure();
    const terminal = await prisma.workflowNode.create({ data: { organizationId: f.org.id, workflowVersionId: round.workflowVersionId,
      nodeKey: 'end', type: 'CLOSE', name: 'Closed', config: { isEnd: true } } });
    await prisma.workflowTransition.create({ data: { organizationId: f.org.id, workflowVersionId: round.workflowVersionId,
      fromNodeId: f.node.id, toNodeId: terminal.id, transitionKey: 'close', action: 'APPROVE' } });
    const decided = await f.decide(f.professional.actor, round, ['PROFESSIONAL']);
    await prisma.user.update({ where: { id: f.professional.user.id }, data: { status: 'DISABLED' } });
    await prisma.session.deleteMany({ where: { userId: f.professional.user.id } });
    await prisma.userPosition.update({ where: { id: f.manager.assignment.id }, data: { endedAt: new Date() } });
    await pollCycle();
    await pollCycle();
    expect((await f.rounds.history(f.owner.actor, f.problem.id))[0]).toMatchObject({ id: round.id, status: 'APPROVED', version: decided.version + 1,
      context: { closedAfterManagementSkip: true }, duties: [decided.duties[0]] });
    expect(await prisma.workflowInstance.findUniqueOrThrow({ where: { id: f.instance.id } })).toMatchObject({ status: 'COMPLETED',
      currentNodeId: terminal.id, version: round.context.instanceVersion + 1, taskProjectionVersion: round.context.instanceVersion + 1, updatedById: null });
    expect(await prisma.problemIndex.findUniqueOrThrow({ where: { id: f.problem.id } })).toMatchObject({ status: 'CLOSED', updatedById: null });
    expect(await prisma.workflowMutation.count({ where: { instanceId: f.instance.id, action: 'CLOSE' } })).toBe(0);
    expect(await prisma.auditEvent.findMany({ where: { organizationId: f.org.id, resourceType: 'WorkflowInstance',
      resourceId: f.instance.id, action: 'WORKFLOW_ACTION_COMPLETED' } })).toMatchObject([{ actorUserId: null, metadata: { reasonCode: 'CLOSE' } }]);
  }, 120000);

  it('records parse failure receipts and retries without a partial notification', async () => {
    const f = await fixture();
    const event = await prisma.outboxEvent.create({ data: { eventKey: `invalid-eight-d:${randomUUID()}`, aggregateType: 'ProcessEightDReminder', aggregateId: f.problem.id,
      eventType: 'PROCESS_EIGHT_D_REMINDER_DUE', payload: { organizationId: f.org.id }, createdAt: new Date(0), availableAt: new Date(0) } });
    const failed = await deliver(); expect(failed.retried).toBeGreaterThanOrEqual(1);
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'PROCESS_EIGHT_D_REMINDER_EVENT_INVALID' });
    expect(await prisma.outboxDeliveryAttempt.findMany({ where: { outboxEventId: event.id } })).toMatchObject([{ outcome: 'FAILED' }]);
    expect(await recipients(f.problem.id, 'HANDLING_REMINDER')).toHaveLength(0);
  }, 120000);

  it('rolls back notification projection together with an enclosing atomic transaction', async () => {
    const f = await fixture(); await pollCycle();
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { eventType: 'PROCESS_EIGHT_D_REMINDER_DUE', aggregateId: f.problem.id } });
    await expect(prisma.$transaction(async tx => { await reminders.handle(tx, { ...event, processingAt: new Date() }); throw new Error('force actual transaction rollback'); })).rejects.toThrow('force actual transaction rollback');
    expect(await recipients(f.problem.id, 'HANDLING_REMINDER')).toHaveLength(0);
    await deliver(); expect(await recipients(f.problem.id, 'HANDLING_REMINDER')).toHaveLength(2);
  }, 120000);

  it('delivers an extension change immediately, not again in slot zero, and deduplicates later periodic delivery/replay', async () => {
    const f = await fixture(); const r = await f.request(); await deliver();
    expect(await recipients(f.problem.id, 'EXTENSION_PENDING')).toEqual([f.manager.user.id]);
    await pollCycle(); await deliver();
    await pollCycle(); await deliver();
    expect(await recipients(f.problem.id, 'EXTENSION_PENDING')).toEqual([f.manager.user.id]);
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { eventKey: `deadline:${r.id}:1` } });
    await prisma.$transaction(tx => reminders.handle(tx, { ...event, processingAt: new Date() }));
    expect(await recipients(f.problem.id, 'EXTENSION_PENDING')).toHaveLength(1);
    await prisma.$executeRaw`UPDATE workflow_deadline_extensions SET updated_at = ${new Date(Date.now() - 24 * 3600000 - 1000)} WHERE id = ${r.id}::uuid`;
    await pollCycle(); await deliver();
    expect(await recipients(f.problem.id, 'EXTENSION_PENDING')).toEqual([f.manager.user.id, f.manager.user.id]);
    await pollCycle(); await deliver();
    expect(await recipients(f.problem.id, 'EXTENSION_PENDING')).toHaveLength(2);
  }, 120000);

  it('hides an old cancellation after a replacement request whose transaction began before cancellation while waiting for the problem lock', async () => {
    const f = await fixture(); const old = await f.request(); const c = await f.context();
    await prisma.$executeRaw`UPDATE department_management_bindings SET version = version + 1 WHERE id = ${f.managerBinding}::uuid`;
    let locked!: () => void; let release!: () => void;
    const lockReady = new Promise<void>(resolve => { locked = resolve; });
    const releaseLock = new Promise<void>(resolve => { release = resolve; });
    const cancellation = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM problem_indexes WHERE id = ${f.problem.id}::uuid FOR UPDATE`;
      locked(); await releaseLock;
      const current = await f.reports.notificationContext(tx, f.org.id, f.problem.id);
      expect(current).not.toBeNull();
      await f.extensions.reconcile(tx, current!);
    }, { timeout: 15000 });
    void cancellation.catch(() => {});
    await lockReady;
    const replacement = f.extensions.request(f.owner.actor, f.problem.id, { expectedRowVersion: c.rowVersion, expectedInstanceVersion: c.instanceVersion,
      stage: 'ANALYSIS', requestedDueAt: old.requestedDueAt, reason: 'Replace after real lock wait' }, randomUUID(), randomUUID());
    void replacement.catch(() => {});
    try { await waitForProcessEightDProblemLock(prisma); }
    finally { release(); }
    await cancellation;
    const created = await replacement;
    const history = await f.extensions.history(f.owner.actor, f.problem.id);
    const cancelled = history.find(r => r.id === old.id)!;
    expect(cancelled.status).toBe('CANCELLED');
    expect(created.createdAt >= cancelled.updatedAt).toBe(true);
    expect(history.find(r => r.id === created.id)).toMatchObject({ createdAt: created.createdAt, updatedAt: created.updatedAt });
    await deliver();
    expect(await recipients(f.problem.id, 'EXTENSION_CANCELLED')).toHaveLength(0);
    expect((await app.get(ProcessEightDTaskService).notifications(f.owner.actor, { problemId: f.problem.id })).items.some(n => n.kind === 'EXTENSION_CANCELLED')).toBe(false);
  }, 120000);

  it('filters a minister whose captured scope expires during the last recipient check even though session/features/appointment remain valid', async () => {
    const f = await fixture();
    await prisma.problemIndex.update({ where: { id: f.problem.id }, data: { ownerId: f.manager.user.id } });
    const c = await f.context();
    const r = await f.extensions.request(f.manager.actor, f.problem.id, { expectedRowVersion: c.rowVersion, expectedInstanceVersion: c.instanceVersion,
      stage: 'ANALYSIS', requestedDueAt: new Date(Date.now() + 72 * 3600000).toISOString(), reason: 'Actual minister scope test' }, randomUUID(), randomUUID());
    expect(r.participants.leader.userId).toBe(f.minister.user.id);
    const original = f.reports.canNotifyRecipient.bind(f.reports);
    let ministerChecks = 0;
    const spy = jest.spyOn(f.reports, 'canNotifyRecipient').mockImplementation(async (tx, context, userId) => {
      if (userId === f.minister.user.id && ++ministerChecks === 2) {
        await tx.$executeRaw`UPDATE department_minister_scopes SET valid_to = ${new Date(Date.now() + 50)} WHERE id = ${f.scopeId}::uuid`;
        await tx.$queryRaw`SELECT pg_sleep(0.1)::text`;
      }
      return original(tx, context, userId);
    });
    try {
      await deliver();
      expect(ministerChecks).toBe(2);
      expect(await recipients(f.problem.id, 'EXTENSION_PENDING')).toHaveLength(0);
      expect((await f.context()).analysisDueAt).toBe(r.originalDueAt);
      const event = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventKey: `deadline:${r.id}:${r.version}` } });
      expect(event).toMatchObject({ status: 'PROCESSED', lastError: null });
      expect(await prisma.outboxDeliveryAttempt.count({ where: { outboxEventId: event.id, outcome: 'PROCESSED' } })).toBe(1);
    } finally { spy.mockRestore(); }
  }, 120000);
});
