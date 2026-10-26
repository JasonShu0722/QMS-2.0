import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { ProcessEightDTaskService } from '../../src/modules/process-quality/process-eight-d-task.service.js';
import { ClosureInboxService } from '../../src/modules/task-notification/closure-inbox.service.js';
import { createProcessEightDTaskFixture, clearProcessEightDTaskFixtureEvents, requireDisposableProcessEightDDatabase, addProcessEightDTaskProblem } from './process-eight-d-task.fixture.js';

requireDisposableProcessEightDDatabase();
describe('process current-action tasks with real App and PostgreSQL', () => {
  let app: INestApplicationContext;
  let tasks: ProcessEightDTaskService;
  const organizations: string[] = [];
  beforeAll(async () => { app = await NestFactory.createApplicationContext(AppModule, { logger: false }); tasks = app.get(ProcessEightDTaskService); }, 120000);
  afterEach(async () => { await clearProcessEightDTaskFixtureEvents(app.get(PrismaService), organizations); });
  afterAll(async () => { await app?.close(); });
  const fixture = () => createProcessEightDTaskFixture(app, organizations);

  it('projects the current owner, not collaborators or a duplicate generic problem row', async () => {
    const f = await fixture(); const colleague = await f.person(f.section.id);
    await f.reports.collaborators(f.owner.actor, f.problem.id, { expectedVersion: 1, userIds: [colleague.user.id] }, randomUUID(), randomUUID());
    expect((await tasks.list(f.owner.actor, { problemId: f.problem.id }))).toMatchObject({ total: 1, items: [{ kind: 'HANDLING', stage: 'ANALYSIS', userId: f.owner.user.id, actions: ['OPEN_REPORT', 'ANALYSIS_COMPLETE', 'REQUEST_EXTENSION'] }] });
    expect((await tasks.list(colleague.actor, { problemId: f.problem.id })).total).toBe(0);
    expect((await tasks.list(f.professional.actor, { problemId: f.problem.id })).total).toBe(0);
    expect(await f.prisma.workflowTask.count({ where: { workflowInstanceId: f.instance.id } })).toBe(0);
  }, 120000);

  it('projects serial leader then actual quality duties with server-owned actions and CAS', async () => {
    const f = await fixture(); const request = await f.request();
    expect((await tasks.list(f.manager.actor, { problemId: f.problem.id }))).toMatchObject({ total: 1, items: [{ kind: 'EXTENSION', extensionRequestId: request.id, extensionRequestVersion: 1, status: 'LEADER_PENDING', actions: ['OPEN_REPORT', 'DECIDE_EXTENSION'] }] });
    expect((await tasks.list(f.professional.actor, { problemId: f.problem.id })).total).toBe(0);
    await f.extensions.decide(f.manager.actor, request.id, { expectedVersion: 1, decision: 'APPROVE' }, randomUUID(), randomUUID());
    expect((await tasks.list(f.manager.actor, { problemId: f.problem.id })).total).toBe(0);
    expect((await tasks.list(f.professional.actor, { problemId: f.problem.id }))).toMatchObject({ total: 1, items: [{ status: 'QUALITY_PENDING', extensionRequestVersion: 2 }] });
    expect((await tasks.list(f.owner.actor, { problemId: f.problem.id })).items[0]?.extensionStages).not.toContain('ANALYSIS');
  }, 120000);

  it('leaves submitted close-review tasks in N2Inbox and never marks owner as unhandled', async () => {
    const f = await fixture(); const round = await f.toClosure();
    expect((await tasks.list(f.owner.actor, { problemId: f.problem.id })).total).toBe(0);
    expect((await tasks.list(f.manager.actor, { problemId: f.problem.id })).total).toBe(0);
    expect((await app.get(ClosureInboxService).list(f.manager.actor, { problemId: f.problem.id }))).toMatchObject({ total: 1, items: [{ roundId: round.id, duty: 'SECTION_MANAGER' }] });
  }, 120000);

  it('denies revoked sessions, missing features, foreign organizations and unknown action JSON', async () => {
    const f = await fixture();
    await expect(tasks.list(f.owner.actor, { organizationId: randomUUID() })).rejects.toMatchObject({ status: 403 });
    await expect(tasks.list(f.owner.actor, { action: 'COMPLETE' } as never)).rejects.toMatchObject({ status: 400 });
    await f.prisma.session.update({ where: { id: f.owner.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(tasks.list(f.owner.actor, {})).rejects.toMatchObject({ status: 401 });
    await f.prisma.userRole.deleteMany({ where: { userId: f.manager.user.id } });
    await expect(tasks.list(f.manager.actor, {})).rejects.toMatchObject({ status: 403 });
  }, 120000);

  it('hides ambiguous/revoked old approvals rather than assigning another candidate', async () => {
    const f = await fixture(); await f.request();
    await f.prisma.$executeRaw`UPDATE department_management_bindings SET version = version + 1 WHERE id = ${f.managerBinding}::uuid`;
    expect((await tasks.list(f.manager.actor, { problemId: f.problem.id })).total).toBe(0);
    expect((await tasks.list(f.professional.actor, { problemId: f.problem.id })).total).toBe(0);
  }, 120000);

  it.each(['list', 'notifications'] as const)('%s releases first-problem structure locks before a second-problem user/organization writer', async method => {
    const f = await fixture(); const second = await addProcessEightDTaskProblem(f);
    for (const [manager, r] of [[f.manager, await f.request()], [second.manager, await second.request()]] as const) {
      await f.extensions.decide(manager.actor, r.id, { expectedVersion: r.version, decision: 'APPROVE' }, randomUUID(), randomUUID());
    }
    if (method === 'notifications') {
      for (const problem of [f.problem, second.problem]) await f.prisma.$executeRaw`INSERT INTO process_eight_d_notifications
        (id, organization_id, problem_id, recipient_user_id, event_key, kind, subject, body, context)
        VALUES (${randomUUID()}::uuid, ${f.org.id}::uuid, ${problem.id}::uuid, ${f.professional.user.id}::uuid, ${randomUUID()}, 'EXTENSION_PENDING', 'Lock regression', 'Read qualification', '{}'::jsonb)`;
    }
    const original = f.reports.lockRecord.bind(f.reports);
    let firstProblem: string | undefined;
    let writer: Promise<unknown> | undefined;
    const spy = jest.spyOn(f.reports, 'lockRecord').mockImplementation(async (tx, actor, problemId, purpose) => {
      firstProblem ??= problemId;
      if (problemId !== firstProblem && !writer) {
        const userId = problemId === second.problem.id ? second.owner.user.id : f.owner.user.id;
        let userLocked!: () => void;
        const locked = new Promise<void>(resolve => { userLocked = resolve; });
        writer = f.prisma.$transaction(async other => {
          await other.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
          userLocked();
          await other.$queryRaw`SELECT id FROM organizations WHERE id = ${f.org.id}::uuid FOR UPDATE`;
        }, { timeout: 15000 });
        // Attach a rejection observer immediately; the final assertion still requires success.
        void writer.catch(() => {});
        await locked;
      }
      return original(tx, actor, problemId, purpose);
    });
    try {
      await expect(tasks[method](f.professional.actor, {})).resolves.toBeDefined();
      expect(writer).toBeDefined();
      await expect(writer).resolves.toBeUndefined();
    } finally { spy.mockRestore(); if (writer) await writer.catch(() => {}); }
  }, 120000);

  it('applies the deadline only after both approvals through the installed process adapter, with replay-safe audit/outbox', async () => {
    const f = await fixture(); const r = await f.request();
    expect((await f.context()).analysisDueAt).toBe(r.originalDueAt);
    const quality = await f.extensions.decide(f.manager.actor, r.id, { expectedVersion: 1, decision: 'APPROVE' }, randomUUID(), randomUUID());
    expect((await f.context()).analysisDueAt).toBe(r.originalDueAt);
    const key = randomUUID(); const input = { expectedVersion: quality.version, decision: 'APPROVE' as const };
    const approved = await f.extensions.decide(f.professional.actor, r.id, input, key, randomUUID());
    expect(approved.status).toBe('APPROVED');
    expect((await f.context()).analysisDueAt).toBe(r.requestedDueAt);
    const audits = await f.prisma.auditEvent.count({ where: { resourceId: f.problem.id, action: 'PROCESS_EIGHT_D_DEADLINE_EXTENDED' } });
    const events = await f.prisma.outboxEvent.count({ where: { aggregateId: f.problem.id, eventType: 'PROCESS_EIGHT_D_DEADLINE_EXTENDED' } });
    expect(audits).toBe(1); expect(events).toBe(1);
    expect(await f.extensions.decide(f.professional.actor, r.id, input, key, randomUUID())).toEqual(approved);
    expect(await f.prisma.auditEvent.count({ where: { resourceId: f.problem.id, action: 'PROCESS_EIGHT_D_DEADLINE_EXTENDED' } })).toBe(audits);
    expect(await f.prisma.outboxEvent.count({ where: { aggregateId: f.problem.id, eventType: 'PROCESS_EIGHT_D_DEADLINE_EXTENDED' } })).toBe(events);
  }, 120000);
});
