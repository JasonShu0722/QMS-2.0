import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { OrganizationResponsibilityService } from '../../src/modules/organization/organization-responsibility.service.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import { WorkflowClosureRegistry } from '../../src/modules/workflow/workflow-closure-registry.js';
import type { WorkflowClosureAdapter, WorkflowClosureDuty } from '../../src/modules/workflow/workflow-closure-round.types.js';
import { clearWorkflowClosureFixtureEvents, createWorkflowClosureFixture, workflowClosureFixtureAdapter as adapter } from './workflow-closure-round.fixture.js';

const url = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (!url || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['postgres:', 'postgresql:'].includes(url.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash) {
  throw new Error('Closure repair requires disposable loopback PostgreSQL, never preview 55440.');
}

describe('closure round expiry and outer-prewrite concurrency on real PostgreSQL', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const responsibilities = new OrganizationResponsibilityService(prisma, new AdminMutationService(prisma, audit), audit);
  const makeService = (domain = adapter) => new WorkflowClosureRoundService(prisma, audit, responsibilities, new WorkflowClosureRegistry([domain]));
  const service = makeService();
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  afterEach(() => clearWorkflowClosureFixtureEvents(prisma));

  function signal<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
  }

  async function waitForBlocker(pid: number) {
    for (let attempt = 0; attempt < 300; attempt++) {
      const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS
        (SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS waiting`;
      if (row.waiting) return;
      await new Promise(done => setTimeout(done, 10));
    }
    throw new Error('Expected actual PostgreSQL lock wait was not observed');
  }

  async function counts(roundId: string, key: string) {
    return {
      rounds: (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM workflow_closure_rounds WHERE id = ${roundId}::uuid`)[0].n,
      receipts: (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM workflow_closure_receipts WHERE key = ${key}`)[0].n,
      audits: await prisma.auditEvent.count({ where: { resourceId: roundId, action: 'WORKFLOW_CLOSURE_CHANGED' } }),
      events: await prisma.outboxEvent.count({ where: { aggregateId: roundId, eventType: 'WORKFLOW_CLOSURE_CHANGED' } }),
    };
  }

  it.each(['manager-assignment', 'minister-assignment', 'minister-scope', 'professional-assignment'] as const)(
    'cancels rather than approves when %s expires during resolver user lock wait', async source => {
      const high = source.startsWith('minister');
      const f = await createWorkflowClosureFixture(prisma, service, 'INTERNAL', high ? 'HIGH' : 'LOW');
      let r = await f.start();
      const duty: WorkflowClosureDuty = source === 'professional-assignment' ? 'PROFESSIONAL' : high ? 'MINISTER' : 'SECTION_MANAGER';
      const actor = duty === 'PROFESSIONAL' ? f.professional : duty === 'MINISTER' ? f.minister : f.manager;
      for (const d of r.duties.filter(d => d.duty !== duty)) {
        r = await f.decide(d.duty === 'PROFESSIONAL' ? f.professional.actor : f.manager.actor, r, [d.duty]);
      }
      // Direct workflow:act survives appointment expiry, so a 403 cannot hide stale source acceptance.
      expect(await prisma.userRole.count({ where: { userId: actor.user.id, roleId: f.role.id } })).toBe(1);
      const expiresAt = new Date(Date.now() + 1000);
      if (source === 'minister-scope') await prisma.$executeRaw`UPDATE department_minister_scopes SET valid_to = ${expiresAt} WHERE id = ${f.scopeId}::uuid`;
      else await prisma.userPosition.update({ where: { id: actor.assignment.id }, data: { endedAt: expiresAt } });
      const ready = signal<number>(); const release = signal<void>();
      const blocker = prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${f.manager.user.id}::uuid FOR UPDATE`;
        ready.resolve((await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid);
        await release.promise;
      }, { timeout: 15_000 });
      const pid = await ready.promise;
      const key = randomUUID();
      const pending = f.decide(actor.actor, r, [duty], 'APPROVE', key).then(value => ({ value }), error => ({ error }));
      try {
        await waitForBlocker(pid);
        expect(Date.now()).toBeLessThan(expiresAt.getTime());
        await new Promise(done => setTimeout(done, Math.max(0, expiresAt.getTime() - Date.now() + 100)));
      } finally { release.resolve(); await blocker; }
      const result = await pending;
      expect(result).toMatchObject({ value: { status: 'CANCELLED', version: r.version + 1 } });
      const saved = (await service.readProjection(prisma, f.org.id, f.problem.id))!;
      expect(saved.context).toMatchObject({ endReason: 'SOURCE_CHANGED' });
      expect(saved.duties.find(d => d.duty === duty)).toMatchObject({ status: 'CANCELLED', decidedBy: null });
      expect(await prisma.problemIndex.findUniqueOrThrow({ where: { id: f.problem.id } })).toMatchObject({ status: 'IN_PROGRESS', version: 2, closedAt: null });
      expect(await prisma.workflowInstance.findUniqueOrThrow({ where: { id: f.instance.id } })).toMatchObject({ status: 'RUNNING', version: 1 });
      expect(await counts(r.id, key)).toEqual({ rounds: 1, receipts: 1, audits: r.version + 1, events: r.version + 1 });
      expect((await prisma.$queryRaw<{ response: { status: string } }[]>`SELECT response FROM workflow_closure_receipts WHERE key = ${key}`)[0].response.status).toBe('CANCELLED');
    }, 30_000,
  );

  it.each(['start', 'decide'] as const)('converges same-key %s with an outer problem prewrite without a deadlock victim', async operation => {
    const f = await createWorkflowClosureFixture(prisma, service);
    const r = operation === 'decide' ? await f.decide(f.professional.actor, await f.start(), ['PROFESSIONAL']) : null;
    const key = randomUUID();
    const invoke = (tx?: Parameters<typeof service.start>[5]) => r
      ? service.decide(f.manager.actor, r.id, { expectedRoundVersion: r.version, duties: ['SECTION_MANAGER'], decision: 'APPROVE', comment: 'Concurrent final' }, key, randomUUID(), tx)
      : service.start(f.owner.actor, f.problem.id, { expectedContentVersion: 2, expectedInstanceVersion: 1 }, key, randomUUID(), tx);
    const ready = signal<number>(); const proceed = signal<void>();
    const outer = prisma.$transaction(async tx => {
      await tx.problemIndex.update({ where: { id: f.problem.id }, data: r ? { status: 'OPEN' } : { version: { increment: 1 } } });
      ready.resolve((await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid);
      await proceed.promise;
      return invoke(tx);
    }, { timeout: 15_000 }).then(value => ({ value }), error => ({ error }));
    const pid = await ready.promise;
    const ordinary = invoke().then(value => ({ value }), error => ({ error }));
    try { await waitForBlocker(pid); } finally { proceed.resolve(); }
    const [a, b] = await Promise.all([outer, ordinary]);
    expect(a).toHaveProperty('value'); expect(b).toHaveProperty('value');
    if (!('value' in a) || !('value' in b)) throw new Error('Both requests must succeed');
    expect(a.value).toEqual(b.value);
    expect(await counts(a.value.id, key)).toEqual({ rounds: 1, receipts: 1, audits: r ? 3 : 1, events: r ? 3 : 1 });
    expect((await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM workflow_closure_rounds WHERE problem_id = ${f.problem.id}::uuid`)[0].n).toBe(1);
  }, 30_000);

  it.each(['same-user', 'another-user'])('cancels if a future %s manager appointment becomes a second candidate during the resolver lock wait', async candidate => {
    const f = await createWorkflowClosureFixture(prisma, service);
    const round = await f.decide(f.professional.actor, await f.start(), ['PROFESSIONAL']);
    const begins = new Date(Date.now() + 1000);
    const userId = candidate === 'same-user' ? f.manager.user.id : f.professional.user.id;
    await prisma.userPosition.create({ data: { organizationId: f.org.id, userId, positionId: f.manager.position.id, startedAt: begins, endedAt: new Date(begins.getTime() + 60_000) } });
    const ready = signal<number>(), release = signal<void>();
    const blocker = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${f.manager.user.id}::uuid FOR UPDATE`;
      ready.resolve((await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid);
      await release.promise;
    }, { timeout: 15_000 });
    const pid = await ready.promise;
    const key = randomUUID();
    const pending = f.decide(f.manager.actor, round, ['SECTION_MANAGER'], 'APPROVE', key).then(value => ({ value }), error => ({ error }));
    try {
      await waitForBlocker(pid); expect(Date.now()).toBeLessThan(begins.getTime());
      await new Promise(done => setTimeout(done, Math.max(0, begins.getTime() - Date.now() + 100)));
    } finally { release.resolve(); await blocker; }
    expect(await pending).toMatchObject({ value: { status: 'CANCELLED', version: round.version + 1 } });
    expect((await prisma.problemIndex.findUniqueOrThrow({ where: { id: f.problem.id } })).status).toBe('IN_PROGRESS');
    expect(await counts(round.id, key)).toEqual({ rounds: 1, receipts: 1, audits: 3, events: 3 });
  }, 30_000);

  it('never replays the same actor/key receipt for another problem in the same organization', async () => {
    const f = await createWorkflowClosureFixture(prisma, service);
    const problem = await prisma.problemIndex.create({ data: { organizationId: f.org.id, reportNumber: randomUUID(), domainCode: adapter.domainCode, problemType: 'FIXTURE', sourceType: 'FIXTURE', severity: 'LOW', ownerId: f.owner.user.id } });
    const instance = await prisma.workflowInstance.create({ data: { organizationId: f.org.id, problemIndexId: problem.id, workflowDefinitionId: f.instance.workflowDefinitionId, workflowVersionId: f.instance.workflowVersionId, instanceKey: randomUUID(), currentNodeId: f.node.id } });
    await prisma.problemIndex.update({ where: { id: problem.id }, data: { workflowInstanceId: instance.id } });
    const key = randomUUID();
    const results = await Promise.allSettled([f.start(key), service.start(f.owner.actor, problem.id, { expectedContentVersion: 1, expectedInstanceVersion: 1 }, key, randomUUID())]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    expect((await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM workflow_closure_receipts WHERE key = ${key}`)[0].n).toBe(1);
  });

  it.each(['READ', 'DECIDE'] as const)('rejects same-organization adapter %s scope revocation even with live roles and a receipt', async operation => {
    const f = await createWorkflowClosureFixture(prisma, service);
    let denied = false;
    const scoped: WorkflowClosureAdapter = { ...adapter, async lockAndRead(tx, actor, problemId, action) {
      const context = await adapter.lockAndRead(tx, actor, problemId, action);
      if (denied && action === operation) throw new ForbiddenException('Domain scope revoked');
      return context;
    } };
    const guarded = makeService(scoped);
    const r = await f.start(); const key = randomUUID();
    const body = { expectedRoundVersion: r.version, duties: ['PROFESSIONAL'] as WorkflowClosureDuty[], decision: 'APPROVE' as const, comment: 'Scope' };
    await guarded.decide(f.professional.actor, r.id, body, key, randomUUID());
    denied = true;
    await guarded.assertActor(prisma, f.professional.actor);
    if (operation === 'DECIDE') await expect(guarded.decide(f.professional.actor, r.id, body, key, randomUUID())).rejects.toMatchObject({ status: 403 });
    else {
      await expect(guarded.history(f.professional.actor, f.problem.id)).rejects.toMatchObject({ status: 403 });
      await expect(prisma.$transaction(tx => guarded.readSnapshot(tx, f.professional.actor, f.problem.id))).rejects.toMatchObject({ status: 403 });
      expect(await guarded.eligibleDuties(f.manager.actor)).toEqual([]);
    }
    expect(await counts(r.id, key)).toEqual({ rounds: 1, receipts: 1, audits: 2, events: 2 });
  });
});
