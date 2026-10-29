import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { AdminUserLifecycleService } from '../../src/modules/identity/admin-user-lifecycle.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { SupplierEightDService } from '../../src/modules/supplier-quality/supplier-eight-d.service.js';
import { SupplierEightDAdministrativeQueryDto, SupplierEightDAdministrativeReconfigureDto } from '../../src/modules/supplier-quality/supplier-eight-d-administrative.dto.js';
import type { SupplierEightDActor } from '../../src/modules/supplier-quality/supplier-eight-d.types.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import { APPLICATION_OUTBOX_HANDLER, OutboxWorkerService, type AtomicOutboxHandler } from '../../src/modules/task-notification/outbox-worker.service.js';
import { WorkflowEventHandler } from '../../src/modules/task-notification/workflow-event.handler.js';
import { supplierEightDDocument, supplierEightDFixture } from './supplier-eight-d.fixture.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Supplier recovery requires explicitly disposable loopback PostgreSQL, never preview.');
}

describe('supplier current-role administrative recovery / actual App and PostgreSQL', () => {
  let app: INestApplication, db: PrismaService, service: SupplierEightDService, rounds: WorkflowClosureRoundService;
  let administrator: SupplierEightDActor;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    db = app.get(PrismaService); service = app.get(SupplierEightDService); rounds = app.get(WorkflowClosureRoundService);
    expect(await db.$queryRaw`SELECT migration_name FROM _prisma_migrations
      WHERE migration_name = '20261028232000_administrative_configuration_links' AND finished_at IS NOT NULL`).toHaveLength(1);
    const home = await db.organization.create({ data: { code: randomUUID(), name: 'Surviving recovery home', type: 'INTERNAL' } });
    const role = await db.role.create({ data: { organizationId: home.id, code: randomUUID(), name: 'Explicit platform recovery',
      permissions: { create: { permissionId: (await db.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } })).id } } } });
    const user = await db.user.create({ data: { organizationId: home.id, accountType: 'INTERNAL', username: randomUUID(), passwordHash: 'unused-test-session',
      userRoles: { create: { organizationId: home.id, roleId: role.id } } } });
    const token = await app.get(SessionService).create(user.id, db, { mfaVerified: true, reauthenticated: true });
    administrator = { id: user.id, organizationId: home.id, accountType: 'INTERNAL', sessionId: (await app.get(SessionService).resolve(token))!.id };
  }, 120_000);
  afterAll(() => app?.close());
  const transaction = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => db.$transaction(work, { timeout: 30_000 });
  const fixture = () => supplierEightDFixture(app, 'HIGH', false, 'INTERNAL');
  async function remove(userId: string) {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    return app.get(AdminUserLifecycleService).deleteUser(administrator, userId, { expectedSecurityVersion: user.securityVersion }, user.organizationId, randomUUID(), randomUUID());
  }
  async function submit(f: Awaited<ReturnType<typeof fixture>>) {
    let row = await f.read();
    row = (await f.http(f.outsider.cookie, 'put', f.prefix, { ...f.version(row), document: supplierEightDDocument() }).expect(200)).body;
    row = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/analysis-complete`, { ...f.version(row), submissionDueAt: '2026-11-03T00:00:00Z' }).expect(201)).body;
    return (await f.http(f.outsider.cookie, 'post', `${f.prefix}/submit`, f.version(row)).expect(201)).body;
  }

  const pending = (actor = administrator, query = { pageSize: 100, offset: 0 }) =>
    transaction(tx => service.administrativePending(tx, actor, query));
  async function pendingItems(actor = administrator) {
    const items: Awaited<ReturnType<typeof pending>>['items'] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await pending(actor, { pageSize: 100, offset });
      items.push(...page.items); offset = page.nextOffset;
    }
    return items;
  }
  const configure = (f: Awaited<ReturnType<typeof fixture>>, assignmentId: string, expectedVersion: number,
    responderAssignmentId?: string, actor = administrator, traceId: string = randomUUID()) => transaction(tx =>
    service.administrativeReconfigure(tx, actor, f.draft.id, { expectedVersion, sqeAssignmentId: assignmentId,
      ...(responderAssignmentId === undefined ? {} : { internalResponderAssignmentId: responderAssignmentId }) }, traceId));
  async function snapshot(f: Awaited<ReturnType<typeof fixture>>) {
    return { control: await db.$queryRaw`SELECT * FROM supplier_eight_d_controls WHERE supplier_problem_id=${f.draft.id}::uuid`,
      supplier: await db.supplierQualityProblem.findUniqueOrThrow({ where: { id: f.draft.id } }),
      problem: await db.problemIndex.findUniqueOrThrow({ where: { id: f.issued.problemId } }),
      audits: await db.auditEvent.findMany({ where: { resourceId: { in: [f.draft.id, f.issued.problemId] } }, orderBy: { id: 'asc' } }) };
  }

  it('repairs a permanently deleted SQE and starts a real new round without rewriting the original decision or revision', async () => {
    const f = await fixture(), submitted = await submit(f);
    const initial = (await rounds.readProjection(db, f.f.org.id, submitted.problemId))!;
    const decision = await f.decide(f.sqe, initial, ['PROFESSIONAL']);
    expect(decision.status).toBe(200);
    const decided = decision.body;
    const decisions = await db.$queryRaw`SELECT * FROM workflow_closure_duties WHERE round_id=${initial.id}::uuid AND status='APPROVED'`;
    expect(decisions).toHaveLength(1);
    const revision = await db.supplierResponseRevision.findUniqueOrThrow({ where: { id: submitted.submittedRevisionId } });
    await remove(f.sqe.actor.id);
    expect(await db.user.findUniqueOrThrow({ where: { id: f.sqe.actor.id } })).toMatchObject({ status: 'DISABLED', deletedAt: expect.any(Date) });
    expect((await rounds.readProjection(db, f.f.org.id, submitted.problemId))!.status).toBe('CANCELLED');
    expect(await db.$queryRaw`SELECT * FROM workflow_closure_duties WHERE round_id=${initial.id}::uuid AND status='APPROVED'`).toEqual(decisions);
    expect(await db.supplierResponseRevision.findUniqueOrThrow({ where: { id: revision.id } })).toEqual(revision);
    const replacement = await f.f.person(f.f.section.id);
    const item = (await pendingItems()).find(item => item.supplierProblemId === f.draft.id)!;
    expect(item).toMatchObject({ reportNumber: submitted.reportNumber, originalOrganizationId: f.f.org.id, requiredConfiguration: ['sqeAssignmentId'] });
    expect(item).not.toHaveProperty('document');
    const original = await snapshot(f);
    const repaired = await configure(f, replacement.assignment.id, item.version);
    expect(repaired).toMatchObject({ reportNumber: submitted.reportNumber, version: item.version + 1, problemVersion: original.problem.version + 1,
      originalOrganizationId: f.f.org.id, sqeUserId: replacement.user.id, sqeAssignmentId: replacement.assignment.id,
      responsibleSectionDepartmentId: f.f.section.id, internalResponderId: f.outsider.actor.id });
    const after = await snapshot(f);
    expect(after.supplier).toEqual(original.supplier);
    expect(after.problem).toEqual({ ...original.problem, ownerId: replacement.user.id, updatedById: administrator.id,
      version: original.problem.version + 1, updatedAt: expect.any(Date) });
    expect((await pendingItems()).some(item => item.supplierProblemId === f.draft.id)).toBe(false);
    const row = (await f.http(f.outsider.cookie, 'get', f.prefix).expect(200)).body;
    const resubmitted = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/submit`, f.version(row)).expect(201)).body;
    const newRound = (await rounds.readProjection(db, f.f.org.id, submitted.problemId))!;
    expect(newRound).toMatchObject({ status: 'PENDING', roundNumber: initial.roundNumber + 1,
      context: { professionalUserId: replacement.user.id, ownerUserId: replacement.user.id } });
    expect(newRound.duties.find(duty => duty.duty === 'PROFESSIONAL')).toMatchObject({ userId: replacement.user.id, status: 'PENDING' });
    await expect(rounds.decide(administrator, newRound.id, { expectedRoundVersion: newRound.version,
      duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: 'No administrative impersonation' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404 });
    const approved = await rounds.decide(replacement.actor, newRound.id, { expectedRoundVersion: newRound.version,
      duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: 'Replacement SQE as their real self' }, randomUUID(), randomUUID());
    expect(approved.duties.find(duty => duty.duty === 'PROFESSIONAL')).toMatchObject({ userId: replacement.user.id, decidedBy: replacement.user.id, status: 'APPROVED' });
    expect(resubmitted.submittedRevisionId).not.toBe(revision.id);
    expect(await db.supplierResponseRevision.findUniqueOrThrow({ where: { id: revision.id } })).toEqual(revision);
    expect(await db.$queryRaw`SELECT * FROM workflow_closure_duties WHERE round_id=${initial.id}::uuid AND status='APPROVED'`).toEqual(decisions);
    await expect(rounds.decide(f.sqe.actor, newRound.id, { expectedRoundVersion: approved.version,
      duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: 'Deleted old SQE' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 401 });
    await expect(rounds.decide(f.manager.actor, initial.id, { expectedRoundVersion: decided.version,
      duties: ['SECTION_MANAGER'], decision: 'APPROVE', comment: 'Late original decision' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  }, 60_000);

  it('repairs an ended exact appointment, rejects stale CAS, and rolls all writes back on a real audit insert failure', async () => {
    const f = await fixture();
    await db.userPosition.update({ where: { id: f.f.owner.assignment.id }, data: { endedAt: new Date(Date.now() - 1000) } });
    // Same user, new exact appointment: audit failure is in the domain audit, not an owner update.
    const replacement = await db.userPosition.create({ data: { organizationId: f.f.org.id, userId: f.sqe.actor.id,
      positionId: f.f.owner.position.id, startedAt: new Date(Date.now() - 1000) } });
    const before = await snapshot(f), version = f.issued.rowVersion;
    expect((await pendingItems()).find(item => item.supplierProblemId === f.draft.id)?.requiredConfiguration).toEqual(['sqeAssignmentId']);
    await expect(configure(f, replacement.id, version + 1)).rejects.toMatchObject({ status: 409 });
    expect(await snapshot(f)).toEqual(before);
    await expect(configure(f, replacement.id, version, undefined, administrator, 'x'.repeat(101))).rejects.toMatchObject({ code: 'P2000' });
    expect(await snapshot(f)).toEqual(before);
    const repaired = await configure(f, replacement.id, version);
    expect(repaired).toMatchObject({ version: version + 1, problemVersion: before.problem.version, sqeUserId: f.sqe.actor.id, sqeAssignmentId: replacement.id });
    const audit = await db.auditEvent.findMany({ where: { resourceId: f.draft.id, action: 'SUPPLIER_EIGHT_D_RECONFIGURED' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: administrator.id, organizationId: f.f.org.id, metadata: { resourceVersion: version + 1 } });
    await expect(configure(f, replacement.id, version)).rejects.toMatchObject({ status: 409 });
  }, 60_000);

  it('rejects ordinary same-name admins, supplier callers, stale authentication, and loss of the real platform marker', async () => {
    const f = await fixture(), replacement = await f.f.person(f.f.section.id);
    await db.userPosition.update({ where: { id: f.f.owner.assignment.id }, data: { endedAt: new Date(Date.now() - 1000) } });
    const permission = await db.permission.findUniqueOrThrow({ where: { code: 'organization:reconfigure' } });
    await db.rolePermission.create({ data: { roleId: f.f.role.id, permissionId: permission.id } });
    await db.role.update({ where: { id: f.f.role.id }, data: { name: 'admin' } });
    const before = await snapshot(f);
    for (const actor of [f.outsider.actor, f.vendor.actor]) {
      await expect(pending(actor)).rejects.toMatchObject({ status: 403 });
      await expect(configure(f, replacement.assignment.id, f.issued.rowVersion, undefined, actor)).rejects.toMatchObject({ status: 403 });
    }
    const session = await db.session.findUniqueOrThrow({ where: { id: administrator.sessionId } });
    await db.session.update({ where: { id: session.id }, data: { reauthenticatedAt: new Date(Date.now() - 3600_000) } });
    try { await expect(pending()).rejects.toMatchObject({ status: 403 }); }
    finally { await db.session.update({ where: { id: session.id }, data: { reauthenticatedAt: new Date() } }); }
    const grant = await db.userRole.findFirstOrThrow({ where: { userId: administrator.id } });
    await db.userRole.delete({ where: { userId_roleId_organizationId: { userId: administrator.id, roleId: grant.roleId, organizationId: grant.organizationId } } });
    try {
      await expect(pending()).rejects.toMatchObject({ status: 403 });
      await expect(configure(f, replacement.assignment.id, f.issued.rowVersion)).rejects.toMatchObject({ status: 403 });
    } finally { await db.userRole.create({ data: { userId: administrator.id, roleId: grant.roleId, organizationId: grant.organizationId } }); }
    expect(await snapshot(f)).toEqual(before);
  }, 60_000);

  it('does not replace an active SQE or a valid responder and rejects forged scope and cross-tenant appointments', async () => {
    const f = await fixture(), replacement = await f.f.person(f.f.section.id);
    const before = await snapshot(f);
    await expect(configure(f, replacement.assignment.id, f.issued.rowVersion)).rejects.toMatchObject({ status: 409 });
    await expect(configure(f, f.f.owner.assignment.id, f.issued.rowVersion, replacement.assignment.id)).rejects.toMatchObject({ status: 409 });
    await expect(configure(f, f.f.owner.assignment.id, f.issued.rowVersion, undefined,
      { ...administrator, organizationId: f.f.org.id })).rejects.toMatchObject({ status: 403 });
    expect(await snapshot(f)).toEqual(before);
    await db.userPosition.update({ where: { id: f.f.owner.assignment.id }, data: { endedAt: new Date(Date.now() - 1000) } });
    const other = await supplierEightDFixture(app, 'LOW', false, 'INTERNAL');
    await expect(configure(f, other.f.owner.assignment.id, f.issued.rowVersion)).rejects.toMatchObject({ status: 403 });
  }, 60_000);

  it('repairs only an invalid INTERNAL responder, preserving an already valid SQE and allowing real submission', async () => {
    const f = await fixture(), replacement = await f.f.person(f.f.section.id);
    let row = await f.read();
    row = (await f.http(f.outsider.cookie, 'put', f.prefix, { ...f.version(row), document: supplierEightDDocument() }).expect(200)).body;
    row = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/analysis-complete`, { ...f.version(row), submissionDueAt: '2026-11-03T00:00:00Z' }).expect(201)).body;
    await remove(f.outsider.actor.id);
    const before = await snapshot(f);
    const item = (await pendingItems()).find(item => item.supplierProblemId === f.draft.id)!;
    expect(item.requiredConfiguration).toEqual(['internalResponderAssignmentId']);
    await expect(configure(f, replacement.assignment.id, item.version, replacement.assignment.id)).rejects.toMatchObject({ status: 409 });
    const result = await configure(f, f.f.owner.assignment.id, item.version, replacement.assignment.id);
    expect(result).toMatchObject({ internalResponderId: replacement.user.id, sqeUserId: f.sqe.actor.id, sqeAssignmentId: f.f.owner.assignment.id });
    const after = await snapshot(f);
    expect(after.problem).toEqual(before.problem);
    expect(after.supplier).toEqual({ ...before.supplier, internalResponderId: replacement.user.id, version: before.supplier.version + 1, updatedAt: expect.any(Date) });
    const submitted = await service.submit(replacement.actor, f.draft.id,
      { expectedRowVersion: result.version, expectedInstanceVersion: row.instanceVersion }, randomUUID(), randomUUID());
    expect(submitted.closure?.duties.find(duty => duty.duty === 'PROFESSIONAL')).toMatchObject({ userId: f.sqe.actor.id });
  }, 60_000);

  it.each(['position', 'department', 'user'] as const)('detects configurationRequired on the current %s without using permission loss to replace healthy roles', async kind => {
    const f = await fixture(), replacement = await f.f.person(f.f.dept.id);
    if (kind === 'position') await db.position.update({ where: { id: f.f.owner.position.id }, data: { status: 'DISABLED', configurationRequired: true } });
    if (kind === 'department') await db.department.update({ where: { id: f.f.section.id }, data: { status: 'DISABLED', configurationRequired: true } });
    if (kind === 'user') await db.user.update({ where: { id: f.sqe.actor.id }, data: { status: 'DISABLED', configurationRequired: true } });
    const item = (await pendingItems()).find(item => item.supplierProblemId === f.draft.id)!;
    expect(item.requiredConfiguration).toContain('sqeAssignmentId');
    const result = await configure(f, replacement.assignment.id, item.version);
    expect(result).toMatchObject({ sqeUserId: replacement.user.id, responsibleSectionDepartmentId: f.f.dept.id });
  }, 60_000);

  it('rejects an appointment missing actual business permissions and does not classify permission loss alone as an invalid SQE', async () => {
    const f = await fixture();
    const work = await db.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:issues:work' } });
    await db.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.f.role.id, permissionId: work.id } } });
    expect((await pendingItems()).some(item => item.supplierProblemId === f.draft.id)).toBe(false);
    const replacement = await f.f.person(f.f.section.id);
    await expect(configure(f, replacement.assignment.id, f.issued.rowVersion)).rejects.toMatchObject({ status: 409 });
    await db.userPosition.update({ where: { id: f.f.owner.assignment.id }, data: { endedAt: new Date(Date.now() - 1000) } });
    const before = await snapshot(f);
    await expect(configure(f, replacement.assignment.id, f.issued.rowVersion)).rejects.toMatchObject({ status: 403 });
    expect(await snapshot(f)).toEqual(before);
  }, 60_000);

  it('never changes an in-review report; lifecycle cancellation must return it before reconfiguration', async () => {
    const f = await fixture(), submitted = await submit(f), replacement = await f.f.person(f.f.section.id);
    await db.userPosition.update({ where: { id: f.f.owner.assignment.id }, data: { endedAt: new Date(Date.now() - 1000) } });
    const before = await snapshot(f), round = (await rounds.readProjection(db, f.f.org.id, submitted.problemId))!;
    await expect(configure(f, replacement.assignment.id, submitted.rowVersion)).rejects.toMatchObject({ status: 409 });
    expect(await snapshot(f)).toEqual(before);
    expect(await rounds.readProjection(db, f.f.org.id, submitted.problemId)).toEqual(round);
  }, 60_000);

  it('keeps completed approved reports byte-for-byte and excludes closed or archived reports from pending', async () => {
    const f = await fixture(), submitted = await submit(f);
    let round = (await rounds.readProjection(db, f.f.org.id, submitted.problemId))!;
    for (const [actor, duty] of [[f.sqe.actor, 'PROFESSIONAL'], [f.manager.actor, 'SECTION_MANAGER'], [f.minister.actor, 'MINISTER']] as const) {
      round = await rounds.decide(actor, round.id, { expectedRoundVersion: round.version, duties: [duty], decision: 'APPROVE', comment: 'Actual required duty' }, randomUUID(), randomUUID());
    }
    expect(round.status).toBe('APPROVED');
    await remove(f.sqe.actor.id);
    const before = await snapshot(f), replacement = await f.f.person(f.f.section.id);
    expect(before.control).toEqual([expect.objectContaining({ closed_at: expect.any(Date), approved_revision_id: submitted.submittedRevisionId })]);
    await expect(configure(f, replacement.assignment.id, Number((before.control as { row_version: number }[])[0]!.row_version))).rejects.toMatchObject({ status: 409 });
    expect((await pendingItems()).some(item => item.supplierProblemId === f.draft.id)).toBe(false);
    expect(await snapshot(f)).toEqual(before);
    const archived = await fixture();
    await remove(archived.sqe.actor.id);
    await db.problemIndex.update({ where: { id: archived.issued.problemId }, data: { archivedAt: new Date(), status: 'ARCHIVED' } });
    const archiveBefore = await snapshot(archived);
    await expect(configure(archived, archived.f.manager.assignment.id, archived.issued.rowVersion)).rejects.toMatchObject({ status: 409 });
    expect((await pendingItems()).some(item => item.supplierProblemId === archived.draft.id)).toBe(false);
    expect(await snapshot(archived)).toEqual(archiveBefore);
  }, 60_000);

  it('consumes the actual completed supplier closure through the original worker with a CLOSE mutation event', async () => {
    const f = await fixture(), submitted = await submit(f);
    let round = (await rounds.readProjection(db, f.f.org.id, submitted.problemId))!;
    for (const [actor, duty] of [[f.sqe.actor, 'PROFESSIONAL'], [f.manager.actor, 'SECTION_MANAGER']] as const) {
      round = await rounds.decide(actor, round.id, { expectedRoundVersion: round.version, duties: [duty],
        decision: 'APPROVE', comment: 'Real closure duty before original Worker consumption' }, randomUUID(), randomUUID());
    }
    // A real parser failure rolls back the final decision/event instead of poisoning the next GREEN run.
    round = await transaction(async tx => {
      const approved = await rounds.decide(f.minister.actor, round.id, { expectedRoundVersion: round.version,
        duties: ['MINISTER'], decision: 'APPROVE', comment: 'Real final duty with transactional event validation' }, randomUUID(), randomUUID(), tx);
      const completed = await tx.workflowInstance.findUniqueOrThrow({ where: { id: submitted.instanceId } });
      const persisted = await tx.outboxEvent.findUniqueOrThrow({ where: { eventKey: `workflow:${completed.id}:${completed.version}` } });
      await app.get(WorkflowEventHandler).handle(tx, { ...persisted, processingAt: new Date() });
      return approved;
    });
    expect(round.status).toBe('APPROVED');
    const instance = await db.workflowInstance.findUniqueOrThrow({ where: { id: submitted.instanceId } });
    expect(instance.status).toBe('COMPLETED');
    expect(await db.workflowTransition.count({ where: { workflowVersionId: instance.workflowVersionId,
      fromNodeId: round.nodeId, toNodeId: instance.currentNodeId!, action: 'APPROVE' } })).toBe(1);
    const eventKey = `workflow:${instance.id}:${instance.version}`;
    const worker = app.get(OutboxWorkerService), handler = app.get<AtomicOutboxHandler>(APPLICATION_OUTBOX_HANDLER);
    let closing = await db.outboxEvent.findUniqueOrThrow({ where: { eventKey } });
    for (let batch = 0; batch < 20 && closing.status !== 'PROCESSED'; batch++) {
      const result = await worker.processAtomicDue(100, handler);
      closing = await db.outboxEvent.findUniqueOrThrow({ where: { eventKey } });
      // RED identifies this persisted closing event's actual parser failure, not an unrelated queue item.
      expect({ eventKey: closing.eventKey, payload: closing.payload, lastError: closing.lastError }).toMatchObject({ lastError: null });
      expect(result.failed).toBe(0); expect(result.retried).toBe(0);
      if (closing.status !== 'PROCESSED') await setTimeout(Math.max(10, Math.min(1100, closing.availableAt.getTime() - Date.now() + 10)));
    }
    expect(closing).toMatchObject({ eventType: 'WORKFLOW_ACTION_COMPLETED', status: 'PROCESSED', lastError: null,
      payload: { action: 'CLOSE', status: 'COMPLETED', instanceVersion: instance.version } });
    expect(await db.workflowMutation.findUniqueOrThrow({ where: { instanceId_instanceVersion: {
      instanceId: instance.id, instanceVersion: instance.version,
    } } })).toMatchObject({ action: 'CLOSE', response: { status: 'COMPLETED', version: instance.version } });
    expect(await db.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } })).toMatchObject({ taskProjectionVersion: instance.version });
    expect(await db.outboxDeliveryAttempt.count({ where: { outboxEventId: closing.id, outcome: 'PROCESSED' } })).toBe(1);
  }, 60_000);

  it('requires the actual target and surviving home organization to remain usable and validates bounded scanning', async () => {
    const f = await fixture(), replacement = await f.f.person(f.f.section.id);
    await db.userPosition.update({ where: { id: f.f.owner.assignment.id }, data: { endedAt: new Date(Date.now() - 1000) } });
    await db.organization.update({ where: { id: f.f.org.id }, data: { status: 'DISABLED' } });
    const before = await snapshot(f);
    await expect(configure(f, replacement.assignment.id, f.issued.rowVersion)).rejects.toMatchObject({ status: 403 });
    expect(await snapshot(f)).toEqual(before);
    await db.organization.update({ where: { id: administrator.organizationId }, data: { status: 'DISABLED', configurationRequired: true } });
    try { await expect(pending()).rejects.toMatchObject({ status: 401 }); }
    finally { await db.organization.update({ where: { id: administrator.organizationId }, data: { status: 'ACTIVE', configurationRequired: false } }); }
    for (const query of [{ pageSize: 0, offset: 0 }, { pageSize: 101, offset: 0 }, { pageSize: 1, offset: 2147483648 }, { pageSize: 1, offset: -1 }]) {
      await expect(pending(administrator, query)).rejects.toMatchObject({ status: 400 });
    }
    const page = await pending(administrator, { pageSize: 1, offset: 0 });
    expect(page.items.length).toBeLessThanOrEqual(1);
    expect(page).toMatchObject({ pageSize: 1, offset: 0, nextOffset: 1 });
  }, 60_000);

  it('continues a real scan beyond 10000 and reads the actual issued tail record without truncating its cursor', async () => {
    const f = await fixture();
    await db.userPosition.update({ where: { id: f.f.owner.assignment.id }, data: { endedAt: new Date(Date.now() - 1000) } });
    const source = await db.supplierQualityProblem.findUniqueOrThrow({ where: { id: f.draft.id } });
    const seeds = Array.from({ length: 10020 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`, problemId: randomUUID(),
    }));
    const rollback = new Error('ROLLBACK_ARCHIVED_SCAN_VOLUME');
    try {
      await transaction(async tx => {
        // Archived volume tests the scan window only; the tail subject was genuinely issued through the App.
        for (let start = 0; start < seeds.length; start += 1000) {
          const batch = seeds.slice(start, start + 1000);
          await tx.problemIndex.createMany({ data: batch.map(row => ({ id: row.problemId, organizationId: f.f.org.id,
            reportNumber: `SCAN-${row.id}`, domainCode: 'supplier-quality', sourceType: 'supplier-quality', problemType: 'EIGHT_D',
            sourceId: row.id, severity: 'HIGH', ownerId: f.sqe.actor.id, status: 'ARCHIVED', archivedAt: new Date() })) });
          await tx.supplierQualityProblem.createMany({ data: batch.map(row => ({ ...source, id: row.id, problemIndexId: row.problemId })) });
          await tx.$executeRaw`INSERT INTO supplier_eight_d_controls
            (supplier_problem_id,organization_id,problem_index_id,sqe_user_id,sqe_assignment_id,responsible_section_department_id,updated_by)
            SELECT id,owner_organization_id,problem_index_id,${f.sqe.actor.id}::uuid,${f.f.owner.assignment.id}::uuid,
              ${f.f.section.id}::uuid,${f.sqe.actor.id}::uuid FROM supplier_quality_problems
            WHERE owner_organization_id=${f.f.org.id}::uuid AND id=ANY(${batch.map(row => row.id)}::uuid[])`;
        }
        const boundary = await service.administrativePending(tx, administrator, { pageSize: 20, offset: 10000 });
        expect(boundary).toMatchObject({ items: [], offset: 10000, nextOffset: 10020 });
        const [rank] = await tx.$queryRaw<{ offset: number }[]>`SELECT count(*)::int AS offset FROM supplier_eight_d_controls
          WHERE closed_at IS NULL AND supplier_problem_id<${f.draft.id}::uuid`;
        expect(rank!.offset).toBeGreaterThanOrEqual(10020);
        const tail = await service.administrativePending(tx, administrator, { pageSize: 1, offset: rank!.offset });
        expect(tail.items).toEqual([expect.objectContaining({ supplierProblemId: f.draft.id, reportNumber: f.issued.reportNumber,
          originalOrganizationId: f.f.org.id, requiredConfiguration: ['sqeAssignmentId'] })]);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    expect(await db.supplierQualityProblem.count({ where: { ownerOrganizationId: f.f.org.id } })).toBe(1);
  }, 60_000);

  it('resolves only an issued supplier original organization and enforces server caller scope on lookup, pending and reconfiguration', async () => {
    const f = await fixture(), replacement = await f.f.person(f.f.section.id);
    await db.userPosition.update({ where: { id: f.f.owner.assignment.id }, data: { endedAt: new Date(Date.now() - 1000) } });
    const scoped = { ...administrator, scopeOrganizationId: f.f.org.id };
    const wrongScope = { ...administrator, scopeOrganizationId: administrator.organizationId };
    const lookup = (actor = administrator, id = f.draft.id) => transaction(tx => service.administrativeOrganizationId(tx, actor, id));
    expect(await lookup()).toBe(f.f.org.id);
    expect(await lookup(scoped)).toBe(f.f.org.id);
    await expect(lookup(wrongScope)).rejects.toMatchObject({ status: 403 });
    await expect(lookup(f.outsider.actor)).rejects.toMatchObject({ status: 403 });
    await expect(lookup(f.vendor.actor)).rejects.toMatchObject({ status: 403 });
    await expect(lookup(administrator, randomUUID())).rejects.toMatchObject({ status: 404 });
    const draft = (await f.http(f.outsider.cookie, 'post', 'supplier-quality/drafts', { profileId: f.profile.id,
      title: 'Unissued lookup fixture', materialCode: 'SCOPE-PART', defectDescription: 'Not yet issued', defectQuantity: 1,
      severity: 'HIGH', responseForm: 'EIGHT_D', replyMode: 'INTERNAL', internalResponderId: f.outsider.actor.id }).expect(201)).body;
    await expect(lookup(administrator, draft.id)).rejects.toMatchObject({ status: 404 });
    const before = await snapshot(f);
    await expect(configure(f, replacement.assignment.id, f.issued.rowVersion, undefined, wrongScope)).rejects.toMatchObject({ status: 403 });
    expect(await snapshot(f)).toEqual(before);
    const items = await pendingItems(scoped);
    expect(items.some(item => item.supplierProblemId === f.draft.id)).toBe(true);
    expect(items.every(item => item.originalOrganizationId === f.f.org.id)).toBe(true);
    expect((await pendingItems(wrongScope)).some(item => item.supplierProblemId === f.draft.id)).toBe(false);
    expect(await configure(f, replacement.assignment.id, f.issued.rowVersion, undefined, scoped)).toMatchObject({ originalOrganizationId: f.f.org.id });
  }, 60_000);

  it('can repair both deleted roles and lets the new SQE submit and approve as their actual INTERNAL responder identity', async () => {
    const f = await fixture(), submitted = await submit(f), replacement = await f.f.person(f.f.section.id);
    const revision = await db.supplierResponseRevision.findUniqueOrThrow({ where: { id: submitted.submittedRevisionId } });
    await remove(f.sqe.actor.id); await remove(f.outsider.actor.id);
    const item = (await pendingItems()).find(item => item.supplierProblemId === f.draft.id)!;
    expect(item.requiredConfiguration).toEqual(['sqeAssignmentId', 'internalResponderAssignmentId']);
    const repaired = await configure(f, replacement.assignment.id, item.version, replacement.assignment.id);
    const row = await service.read(replacement.actor, f.draft.id);
    const next = await service.submit(replacement.actor, f.draft.id,
      { expectedRowVersion: repaired.version, expectedInstanceVersion: row.instanceVersion }, randomUUID(), randomUUID());
    const round = (await rounds.readProjection(db, f.f.org.id, next.problemId))!;
    const approved = await rounds.decide(replacement.actor, round.id, { expectedRoundVersion: round.version,
      duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: 'New SQE, actual responder and real duty holder' }, randomUUID(), randomUUID());
    expect(approved.duties.find(duty => duty.duty === 'PROFESSIONAL')).toMatchObject({ decidedBy: replacement.user.id, userId: replacement.user.id });
    expect(await db.supplierResponseRevision.findUniqueOrThrow({ where: { id: revision.id } })).toEqual(revision);
  }, 60_000);

  it('does not mutate a pending domain deadline review before the existing lifecycle hook cancels it', async () => {
    const f = await fixture(), replacement = await f.f.person(f.f.section.id);
    let row = await f.read();
    row = (await f.http(f.sqe.cookie, 'put', `${f.prefix}/deadlines`, { ...f.version(row), analysisDueAt: '2026-11-01T00:00:00Z' }).expect(200)).body;
    const request = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/deadline-extensions`, { ...f.version(row),
      expectedContentVersion: row.contentVersion, stage: 'ANALYSIS', requestedDueAt: '2026-12-01T00:00:00Z', reason: 'Real deadline request' }).expect(201)).body;
    await db.userPosition.update({ where: { id: f.f.owner.assignment.id }, data: { endedAt: new Date(Date.now() - 1000) } });
    const before = await snapshot(f);
    await expect(configure(f, replacement.assignment.id, row.rowVersion)).rejects.toMatchObject({ status: 409 });
    expect(await snapshot(f)).toEqual(before);
    expect(await db.$queryRaw`SELECT status FROM supplier_eight_d_deadline_requests WHERE id=${request.id}::uuid`).toEqual([{ status: 'QUALITY_PENDING' }]);
    await remove(f.sqe.actor.id);
    expect(await db.$queryRaw`SELECT status FROM supplier_eight_d_deadline_requests WHERE id=${request.id}::uuid`).toEqual([{ status: 'CANCELLED' }]);
    const item = (await pendingItems()).find(item => item.supplierProblemId === f.draft.id)!;
    expect(await configure(f, replacement.assignment.id, item.version)).toMatchObject({ sqeUserId: replacement.user.id });
  }, 60_000);

  it('preserves SUPPLIER reply mode and all supplier facts and cannot add an INTERNAL responder', async () => {
    const f = await supplierEightDFixture(app, 'LOW'), replacement = await f.f.person(f.f.section.id);
    await db.userPosition.update({ where: { id: f.f.owner.assignment.id }, data: { endedAt: new Date(Date.now() - 1000) } });
    const before = await snapshot(f);
    await expect(configure(f, replacement.assignment.id, f.issued.rowVersion, replacement.assignment.id)).rejects.toMatchObject({ status: 409 });
    expect(await snapshot(f)).toEqual(before);
    await configure(f, replacement.assignment.id, f.issued.rowVersion);
    expect((await snapshot(f)).supplier).toEqual(before.supplier);
  }, 60_000);

  it('validates DTOs without a reason field, rejects explicit-null/forged identities, and transforms only pagination', async () => {
    const valid = { expectedVersion: 1, sqeAssignmentId: randomUUID() };
    expect(await validate(plainToInstance(SupplierEightDAdministrativeReconfigureDto, valid))).toEqual([]);
    for (const extra of [{ internalResponderAssignmentId: null }, { sqeUserId: randomUUID() }, { responsibleSectionDepartmentId: randomUUID() }]) {
      expect((await validate(plainToInstance(SupplierEightDAdministrativeReconfigureDto, { ...valid, ...extra }),
        { whitelist: true, forbidNonWhitelisted: true })).length).toBeGreaterThan(0);
    }
    const query = plainToInstance(SupplierEightDAdministrativeQueryDto, { pageSize: '10', offset: '20' });
    expect(await validate(query)).toEqual([]); expect(query).toMatchObject({ pageSize: 10, offset: 20 });
    const tailQuery = plainToInstance(SupplierEightDAdministrativeQueryDto, { pageSize: '20', offset: '10020' });
    expect(await validate(tailQuery)).toEqual([]); expect(tailQuery).toMatchObject({ pageSize: 20, offset: 10020 });
  });

  it('bounds administrative deadline source relations to the impacted organization in both discovery and mutation', async () => {
    const f = await fixture();
    let row = await f.read();
    row = (await f.http(f.sqe.cookie, 'put', `${f.prefix}/deadlines`, { ...f.version(row), analysisDueAt: '2026-11-01T00:00:00Z' }).expect(200)).body;
    const request = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/deadline-extensions`, { ...f.version(row),
      expectedContentVersion: row.contentVersion, stage: 'ANALYSIS', requestedDueAt: '2026-12-01T00:00:00Z', reason: 'Bounded source relation' }).expect(201)).body;
    const before = await db.$queryRaw`SELECT * FROM supplier_eight_d_deadline_requests WHERE id=${request.id}::uuid`;
    const impact = { kind: 'DEPARTMENT' as const, entityId: randomUUID(), organizationId: administrator.organizationId,
      receiptOrganizationId: administrator.organizationId, organizationIds: [], departmentIds: [],
      positionIds: [f.f.owner.position.id], userIds: [f.sqe.actor.id] };
    for (const foreignImpact of [impact, { ...impact, departmentIds: [f.f.section.id], positionIds: [] }]) {
      expect(await transaction(tx => service.administrativeInvalidationTargets(tx, foreignImpact))).toEqual([]);
      expect(await transaction(tx => service.administrativeInvalidation(tx, { organizationId: f.f.org.id,
        problemId: f.issued.problemId, actorUserId: administrator.id, reason: 'DEPARTMENT_DELETED', impact: foreignImpact }))).toBe(0);
    }
    expect(await db.$queryRaw`SELECT * FROM supplier_eight_d_deadline_requests WHERE id=${request.id}::uuid`).toEqual(before);
    const ownImpact = { ...impact, organizationId: f.f.org.id };
    expect(await transaction(tx => service.administrativeInvalidationTargets(tx, ownImpact)))
      .toEqual([{ organizationId: f.f.org.id, problemId: f.issued.problemId }]);
    const rollback = new Error('ROLLBACK_SUPPLIER_SOURCE_RELATION');
    await expect(transaction(async tx => {
      expect(await service.administrativeInvalidation(tx, { organizationId: f.f.org.id, problemId: f.issued.problemId,
        actorUserId: administrator.id, reason: 'DEPARTMENT_DELETED', impact: ownImpact })).toBe(1);
      expect(await tx.$queryRaw`SELECT status FROM supplier_eight_d_deadline_requests WHERE id=${request.id}::uuid`).toEqual([{ status: 'CANCELLED' }]);
      throw rollback;
    })).rejects.toBe(rollback);
    expect(await db.$queryRaw`SELECT * FROM supplier_eight_d_deadline_requests WHERE id=${request.id}::uuid`).toEqual(before);
  }, 60_000);

  it.each(['SQE', 'MANAGER'] as const)('preserves other appointments and disabled/wrong-section bindings but matches the exact %s source', async source => {
    const f = await fixture();
    const unrelated = await db.department.create({ data: { organizationId: f.f.org.id, code: randomUUID(), name: 'Other appointment' } });
    const position = await db.position.create({ data: { organizationId: f.f.org.id, departmentId: unrelated.id, code: randomUUID(), name: 'Other source' } });
    for (const userId of [f.sqe.actor.id, f.manager.actor.id, f.outsider.actor.id]) {
      await db.userPosition.create({ data: { organizationId: f.f.org.id, userId, positionId: position.id } });
    }
    for (const [departmentId, status] of [[f.f.section.id, 'DISABLED'], [unrelated.id, 'ACTIVE']]) {
      await db.$executeRaw`INSERT INTO department_management_bindings
        (id,organization_id,department_id,responsibility,position_id,status,created_by,updated_by)
        VALUES (${randomUUID()}::uuid,${f.f.org.id}::uuid,${departmentId}::uuid,'SECTION_MANAGER',${position.id}::uuid,
          ${status},${f.sqe.actor.id}::uuid,${f.sqe.actor.id}::uuid)`;
    }
    let row = await f.read();
    row = (await f.http(f.sqe.cookie, 'put', `${f.prefix}/deadlines`, { ...f.version(row), analysisDueAt: '2026-11-01T00:00:00Z' }).expect(200)).body;
    const request = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/deadline-extensions`, { ...f.version(row),
      expectedContentVersion: row.contentVersion, stage: 'ANALYSIS', requestedDueAt: '2026-12-01T00:00:00Z', reason: 'Exact administrative source' }).expect(201)).body;
    const progressed = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/deadline-extensions/${request.id}/decide`, {
      expectedVersion: request.version, duty: 'SQE', decision: 'APPROVE', comment: 'Preserve actual decision' }).expect(200)).body;
    const before = await snapshot(f);
    const decisions = await db.$queryRaw`SELECT * FROM supplier_eight_d_deadline_decisions WHERE request_id=${request.id}::uuid`;
    const impact = { kind: 'DEPARTMENT' as const, entityId: unrelated.id, organizationId: f.f.org.id,
      receiptOrganizationId: administrator.organizationId, organizationIds: [], departmentIds: [unrelated.id],
      positionIds: [position.id], userIds: [f.sqe.actor.id, f.manager.actor.id, f.outsider.actor.id] };
    expect(await transaction(tx => service.administrativeInvalidationTargets(tx, impact))).toEqual([]);
    expect(await transaction(tx => service.administrativeInvalidation(tx, { organizationId: f.f.org.id,
      problemId: f.issued.problemId, actorUserId: administrator.id, reason: 'DEPARTMENT_DELETED', impact }))).toBe(0);
    expect(await snapshot(f)).toEqual(before);
    expect(await db.$queryRaw`SELECT status,version FROM supplier_eight_d_deadline_requests WHERE id=${request.id}::uuid`)
      .toEqual([{ status: 'MANAGER_PENDING', version: progressed.version }]);
    const actualImpact = { ...impact, departmentIds: [], positionIds: [source === 'SQE' ? f.f.owner.position.id : f.f.manager.position.id] };
    expect(await transaction(tx => service.administrativeInvalidationTargets(tx, actualImpact)))
      .toEqual([{ organizationId: f.f.org.id, problemId: f.issued.problemId }]);
    expect(await transaction(tx => service.administrativeInvalidation(tx, { organizationId: f.f.org.id,
      problemId: f.issued.problemId, actorUserId: administrator.id, reason: 'DEPARTMENT_DELETED', impact: actualImpact }))).toBe(1);
    expect(await db.$queryRaw`SELECT status,version FROM supplier_eight_d_deadline_requests WHERE id=${request.id}::uuid`)
      .toEqual([{ status: 'CANCELLED', version: progressed.version + 1 }]);
    expect(await db.$queryRaw`SELECT * FROM supplier_eight_d_deadline_decisions WHERE request_id=${request.id}::uuid`).toEqual(decisions);
  }, 60_000);
});
