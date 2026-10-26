import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { OrganizationResponsibilityService } from '../../src/modules/organization/organization-responsibility.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import { WorkflowClosureRegistry } from '../../src/modules/workflow/workflow-closure-registry.js';
import type { WorkflowClosureAdapter, WorkflowClosureContext } from '../../src/modules/workflow/workflow-closure-round.types.js';
import { clearWorkflowClosureFixtureEvents, createWorkflowClosureFixture, workflowClosureFixtureAdapter as adapter } from './workflow-closure-round.fixture.js';

const url = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (!url || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['postgres:', 'postgresql:'].includes(url.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash) {
  throw new Error('Closure rounds require disposable loopback PostgreSQL, never preview 55440.');
}
jest.setTimeout(120_000);

describe('workflow closure rounds real PostgreSQL', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const responsibilities = new OrganizationResponsibilityService(prisma, new AdminMutationService(prisma, audit), audit);
  let service: WorkflowClosureRoundService;

  beforeAll(async () => {
    await prisma.$connect();
    service = new WorkflowClosureRoundService(prisma, audit, responsibilities, new WorkflowClosureRegistry([adapter]));
  });
  afterAll(async () => { await prisma.$disconnect(); });
  afterEach(() => clearWorkflowClosureFixtureEvents(prisma));

  const fixture = (policy: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL', severity: WorkflowClosureContext['severity'] = 'LOW', dual = false) =>
    createWorkflowClosureFixture(prisma, service, policy, severity, dual);

  it('passes the engine-verified actor into terminal domain hooks', async () => {
    const complete = jest.spyOn(adapter, 'complete');
    const returned = jest.spyOn(adapter, 'returnForChanges');
    try {
      const f = await fixture();
      const one = await f.decide(f.professional.actor, await f.start(), ['PROFESSIONAL']);
      await f.decide(f.manager.actor, one, ['SECTION_MANAGER']);
      expect(complete.mock.calls.at(-1)?.[2]).toEqual(f.manager.actor);
      const another = await fixture();
      await another.decide(another.professional.actor, await another.start(), ['PROFESSIONAL'], 'RETURN');
      expect(returned.mock.calls.at(-1)?.[2]).toEqual(another.professional.actor);
    } finally { complete.mockRestore(); returned.mockRestore(); }
  });

  it('projects every historical round in the caller transaction and organization', async () => {
    const f = await fixture();
    await f.decide(f.professional.actor, await f.start(), ['PROFESSIONAL'], 'RETURN');
    await service.start(f.owner.actor, f.problem.id, { expectedContentVersion: 2, expectedInstanceVersion: 1 }, randomUUID(), randomUUID());
    const rounds = await prisma.$transaction(tx => service.readHistoryProjection(tx, f.problem.organizationId, f.problem.id));
    expect(rounds.map(round => round.status)).toEqual(['PENDING', 'RETURNED']);
    expect(rounds.every(round => round.duties.length === 2)).toBe(true);
    expect(await prisma.$transaction(tx => service.readHistoryProjection(tx, randomUUID(), f.problem.id))).toEqual([]);
  });

  it.each(['PROFESSIONAL', 'SECTION_MANAGER'] as const)('joins parallel internal reviews with %s first, never closes on one side alone', async first => {
    const f = await fixture(); const r = await f.start();
    expect(r).toMatchObject({ status: 'PENDING', roundNumber: 1, version: 1, contentSnapshot: { revision: 1 } });
    const actor = first === 'PROFESSIONAL' ? f.professional.actor : f.manager.actor;
    const one = await f.decide(actor, r, [first]);
    expect(one.status).toBe('PENDING');
    expect((await prisma.problemIndex.findUniqueOrThrow({ where: { id: f.problem.id } })).status).toBe('OPEN');
    const last = await f.decide(first === 'PROFESSIONAL' ? f.manager.actor : f.professional.actor, one, [first === 'PROFESSIONAL' ? 'SECTION_MANAGER' : 'PROFESSIONAL']);
    expect(last.status).toBe('APPROVED');
    expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: f.instance.id } })).status).toBe('COMPLETED');
  });

  it('serializes supplier reviews and requires both same-person management duties in one atomic confirmation', async () => {
    const f = await fixture('SUPPLIER', 'HIGH', true); const r = await f.start();
    expect(r.duties.map(d => d.status)).toEqual(['PENDING', 'WAITING', 'WAITING']);
    await expect(f.decide(f.manager.actor, r, ['SECTION_MANAGER', 'MINISTER'])).rejects.toMatchObject({ status: 409 });
    const one = await f.decide(f.professional.actor, r, ['PROFESSIONAL']);
    expect(one.duties.map(d => d.status)).toEqual(['APPROVED', 'PENDING', 'PENDING']);
    await expect(f.decide(f.manager.actor, one, ['SECTION_MANAGER'])).rejects.toMatchObject({ status: 409 });
    const result = await f.decide(f.manager.actor, one, ['SECTION_MANAGER', 'MINISTER']);
    expect(result.status).toBe('APPROVED');
    expect(result.duties.slice(1).map(d => d.decidedBy)).toEqual([f.manager.user.id, f.manager.user.id]);
  });

  it('records an owner-manager skip but always requires an actual professional approval', async () => {
    const f = await fixture(); await prisma.problemIndex.update({ where: { id: f.problem.id }, data: { ownerId: f.manager.user.id } });
    const r = await service.start(f.manager.actor, f.problem.id, { expectedContentVersion: 1, expectedInstanceVersion: 1 }, randomUUID(), randomUUID());
    expect(r.duties[1].status).toBe('SKIPPED_SAME_PERSON');
    expect((await f.decide(f.professional.actor, r, ['PROFESSIONAL'])).status).toBe('APPROVED');
  });

  it('returns the entire round, keeps old opinions, and resubmits a fresh round with no carried approvals', async () => {
    const f = await fixture(); const one = await f.decide(f.professional.actor, await f.start(), ['PROFESSIONAL']);
    const returned = await f.decide(f.manager.actor, one, ['SECTION_MANAGER'], 'RETURN');
    expect(returned.status).toBe('RETURNED');
    const next = await service.start(f.owner.actor, f.problem.id, { expectedContentVersion: 2, expectedInstanceVersion: 1 }, randomUUID(), randomUUID());
    expect(next).toMatchObject({ roundNumber: 2, status: 'PENDING' });
    expect(next.duties.map(d => d.status)).toEqual(['PENDING', 'PENDING']);
    expect((await service.history(f.owner.actor, f.problem.id)).map(r => r.status)).toEqual(['PENDING', 'RETURNED']);
    await expect(f.decide(f.manager.actor, one, ['SECTION_MANAGER'])).rejects.toMatchObject({ status: 409 });
  });

  it('commits cancellation and return-to-edit on changed real responsibility sources instead of throwing rollback', async () => {
    const f = await fixture(); const r = await f.start();
    await prisma.$executeRaw`UPDATE department_management_bindings SET version = version + 1 WHERE id = ${f.managerBinding}::uuid`;
    const cancelled = await f.decide(f.professional.actor, r, ['PROFESSIONAL']);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.duties.every(d => d.status === 'CANCELLED')).toBe(true);
    expect((await prisma.problemIndex.findUniqueOrThrow({ where: { id: f.problem.id } })).version).toBe(2);
    expect((await service.history(f.owner.actor, f.problem.id))[0].status).toBe('CANCELLED');
  });

  it('rejects stale round/content/instance versions and an already pending start', async () => {
    const f = await fixture();
    await expect(service.start(f.owner.actor, f.problem.id, { expectedContentVersion: 2, expectedInstanceVersion: 1 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const r = await f.start(); await expect(f.start()).rejects.toMatchObject({ status: 409 });
    await f.decide(f.professional.actor, r, ['PROFESSIONAL']);
    await expect(f.decide(f.manager.actor, r, ['SECTION_MANAGER'])).rejects.toMatchObject({ status: 409 });
  });

  it('replays unchanged receipts after version advance but rejects changed payload, revoked grants and sessions', async () => {
    const f = await fixture(); const key = randomUUID(); const r = await f.start(key);
    await f.decide(f.professional.actor, r, ['PROFESSIONAL']);
    expect(await f.start(key)).toEqual(r);
    await expect(service.start(f.owner.actor, f.problem.id, { expectedContentVersion: 2, expectedInstanceVersion: 1 }, key, randomUUID())).rejects.toMatchObject({ status: 409 });
    await prisma.userRole.deleteMany({ where: { userId: f.owner.user.id } });
    await expect(f.start(key)).rejects.toMatchObject({ status: 403 });
    await prisma.session.update({ where: { id: f.professional.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(f.decide(f.professional.actor, r, ['PROFESSIONAL'])).rejects.toMatchObject({ status: 401 });
  });

  it('replays the final approval after completion without executing adapter complete a second time', async () => {
    const f = await fixture(); const r = await f.decide(f.professional.actor, await f.start(), ['PROFESSIONAL']);
    await prisma.workflowNode.create({ data: { organizationId: f.org.id, workflowVersionId: f.node.workflowVersionId, nodeKey: 'end', type: 'CLOSE', name: 'Terminal node', config: { isEnd: true } } });
    const key = randomUUID(); const done = await f.decide(f.manager.actor, r, ['SECTION_MANAGER'], 'APPROVE', key);
    expect(await f.decide(f.manager.actor, r, ['SECTION_MANAGER'], 'APPROVE', key)).toEqual(done);
    expect((await prisma.problemIndex.findUniqueOrThrow({ where: { id: f.problem.id } })).version).toBe(2);
    expect((await service.history(f.owner.actor, f.problem.id))[0]).toEqual(done);
  });

  it('returns 409 rather than cancelling a round when the fixed runtime version has advanced', async () => {
    const f = await fixture(); const r = await f.start();
    await prisma.workflowInstance.update({ where: { id: f.instance.id }, data: { version: { increment: 1 } } });
    await expect(f.decide(f.professional.actor, r, ['PROFESSIONAL'])).rejects.toMatchObject({ status: 409 });
    expect((await service.readProjection(prisma, f.org.id, f.problem.id))!.status).toBe('PENDING');
  });

  it('never lets an unrelated workflow actor cancel via a source-change decide shortcut', async () => {
    const f = await fixture(); const outsider = await f.person(f.dept.id); const r = await f.start();
    await prisma.$executeRaw`UPDATE department_management_bindings SET version = version + 1 WHERE id = ${f.managerBinding}::uuid`;
    await expect(f.decide(outsider.actor, r, ['PROFESSIONAL'])).rejects.toMatchObject({ status: 403 });
    expect((await service.readProjection(prisma, f.org.id, f.problem.id))!.status).toBe('PENDING');
  });

  it('shares the outer transaction for content, round, receipt, audit and outbox, including rollback', async () => {
    const f = await fixture();
    await expect(prisma.$transaction(async tx => {
      await tx.problemIndex.update({ where: { id: f.problem.id }, data: { version: { increment: 1 } } });
      const r = await service.start(f.owner.actor, f.problem.id, { expectedContentVersion: 2, expectedInstanceVersion: 1 }, randomUUID(), randomUUID(), tx);
      expect(r.contentVersion).toBe(2);
      expect(await tx.outboxEvent.count({ where: { aggregateId: r.id, eventType: 'WORKFLOW_CLOSURE_CHANGED' } })).toBe(1);
      throw new Error('Outer rollback');
    }, { isolationLevel: 'ReadCommitted' })).rejects.toThrow('Outer rollback');
    expect(await service.readProjection(prisma, f.org.id, f.problem.id)).toBeNull();
    expect((await prisma.problemIndex.findUniqueOrThrow({ where: { id: f.problem.id } })).version).toBe(1);
    await expect(prisma.$transaction(tx => service.start(f.owner.actor, f.problem.id, { expectedContentVersion: 1, expectedInstanceVersion: 1 }, randomUUID(), randomUUID(), tx), { isolationLevel: 'Serializable' })).rejects.toMatchObject({ status: 409 });
  });

  it('checks adapter scope for cancel, owner submission and cross-organization history, not workflow manage alone', async () => {
    const f = await fixture(); const foreign = await fixture(); const r = await f.start();
    await expect(service.start(f.professional.actor, f.problem.id, { expectedContentVersion: 1, expectedInstanceVersion: 1 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await expect(service.cancel(f.professional.actor, r.id, { expectedRoundVersion: 1, reason: 'Not owner' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await expect(service.history(foreign.owner.actor, f.problem.id)).rejects.toMatchObject({ status: 403 });
    expect((await service.cancel(f.owner.actor, r.id, { expectedRoundVersion: 1, reason: 'Edit required' }, randomUUID(), randomUUID())).status).toBe('CANCELLED');
  });

  it('rolls back duty decisions, domain closure and receipts when audit persistence fails', async () => {
    const f = await fixture(); const r = await f.decide(f.professional.actor, await f.start(), ['PROFESSIONAL']);
    const failingAudit = new AuditLogService(prisma);
    failingAudit.record = async () => { throw new Error('Audit unavailable'); };
    const failing = new WorkflowClosureRoundService(prisma, failingAudit, responsibilities, new WorkflowClosureRegistry([adapter]));
    const key = randomUUID();
    await expect(failing.decide(f.manager.actor, r.id, { expectedRoundVersion: r.version, duties: ['SECTION_MANAGER'], decision: 'APPROVE', comment: 'Check' }, key, randomUUID())).rejects.toThrow('Audit unavailable');
    expect((await service.history(f.owner.actor, f.problem.id))[0]).toEqual(r);
    expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: f.instance.id } })).status).toBe('RUNNING');
    expect(await prisma.$queryRaw`SELECT key FROM workflow_closure_receipts WHERE key = ${key}`).toEqual([]);
  });

  it('closes exactly once under two genuinely concurrent final decisions', async () => {
    const f = await fixture(); const r = await f.decide(f.professional.actor, await f.start(), ['PROFESSIONAL']);
    const results = await Promise.allSettled([f.decide(f.manager.actor, r, ['SECTION_MANAGER']), f.decide(f.manager.actor, r, ['SECTION_MANAGER'])]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(x => x.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    expect((await prisma.problemIndex.findUniqueOrThrow({ where: { id: f.problem.id } })).version).toBe(2);
  });

  it('exposes current read-only snapshot and eligible pending duties, never waiting or stale-source duties', async () => {
    const f = await fixture('SUPPLIER'); await f.start();
    await prisma.$transaction(async tx => {
      const snapshot = await service.readSnapshot(tx, f.professional.actor, f.problem.id);
      expect(await service.eligible(tx, f.professional.actor, snapshot, 'PROFESSIONAL')).toBe(true);
      expect(await service.eligible(tx, f.manager.actor, snapshot, 'SECTION_MANAGER')).toBe(false);
    });
    await prisma.$executeRaw`UPDATE department_management_bindings SET version = version + 1 WHERE id = ${f.managerBinding}::uuid`;
    await prisma.$transaction(async tx => {
      const snapshot = await service.readSnapshot(tx, f.professional.actor, f.problem.id);
      expect(snapshot.sourcesCurrent).toBe(false);
      expect(await service.eligible(tx, f.professional.actor, snapshot, 'PROFESSIONAL')).toBe(false);
    });
  });

  it('refuses unregistered domains and validates internal inputs rather than trusting HTTP validation', async () => {
    const f = await fixture();
    await expect(service.start(f.owner.actor, f.problem.id, { expectedContentVersion: 1, expectedInstanceVersion: 1, ownerUserId: f.owner.user.id } as never, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    await prisma.problemIndex.update({ where: { id: f.problem.id }, data: { domainCode: 'UNREGISTERED' } });
    await expect(f.start()).rejects.toMatchObject({ status: 409 });
  });

  it.each(['wrong-domain', 'wrong-policy', 'missing-gate', 'start', 'end', 'assignment', 'not-approval'])(
    'refuses a %s gate from actual persisted node configuration', async invalid => {
      const f = await fixture();
      const config = { ...(f.node.config as Prisma.InputJsonObject) };
      if (invalid === 'wrong-domain') config.closureReview = { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'OTHER' };
      if (invalid === 'wrong-policy') config.closureReview = { schemaVersion: 1, policy: 'SUPPLIER', domainCode: adapter.domainCode };
      if (invalid === 'missing-gate') delete config.closureReview;
      if (invalid === 'start') config.isStart = true;
      if (invalid === 'end') config.isEnd = true;
      if (invalid === 'assignment') config.assignment = { assigneeUserId: f.owner.user.id };
      await prisma.workflowNode.update({ where: { id: f.node.id }, data: { config, ...(invalid === 'not-approval' ? { type: 'ACTION' } : {}) } });
      await expect(f.start()).rejects.toMatchObject({ status: 409 });
    },
  );

  it.each(['closed', 'archived', 'completed', 'detached', 'version-draft'])(
    'checks real database lifecycle rather than trusting adapter claims: %s', async invalid => {
      const f = await fixture();
      if (invalid === 'closed') await prisma.problemIndex.update({ where: { id: f.problem.id }, data: { status: 'CLOSED' } });
      if (invalid === 'archived') await prisma.problemIndex.update({ where: { id: f.problem.id }, data: { archivedAt: new Date() } });
      if (invalid === 'completed') await prisma.workflowInstance.update({ where: { id: f.instance.id }, data: { status: 'COMPLETED' } });
      if (invalid === 'detached') {
        const unrelated = await prisma.workflowInstance.create({ data: { organizationId: f.org.id, workflowDefinitionId: f.instance.workflowDefinitionId,
          workflowVersionId: f.node.workflowVersionId, currentNodeId: f.node.id, instanceKey: randomUUID() } });
        await expect(prisma.problemIndex.update({ where: { id: f.problem.id }, data: { workflowInstanceId: unrelated.id } })).rejects.toMatchObject({ code: 'P2003' });
        return;
      }
      if (invalid === 'version-draft') await prisma.workflowVersion.update({ where: { id: f.node.workflowVersionId }, data: { status: 'DRAFT' } });
      await expect(f.start()).rejects.toMatchObject({ status: 409 });
    },
  );

  it('cancels old opinions on a real appointment replacement, not merely a configuration version bump', async () => {
    const f = await fixture(); const r = await f.start();
    await prisma.userPosition.update({ where: { id: f.manager.assignment.id }, data: { endedAt: new Date(Date.now() - 1000) } });
    const replacement = await f.person(f.section.id);
    await prisma.userPosition.update({ where: { id: replacement.assignment.id }, data: { positionId: f.manager.position.id } });
    expect((await f.decide(f.professional.actor, r, ['PROFESSIONAL'])).status).toBe('CANCELLED');
    expect((await service.readProjection(prisma, f.org.id, f.problem.id))!.duties[1].participant.assignmentId).toBe(f.manager.assignment.id);
    const next = await service.start(f.owner.actor, f.problem.id, { expectedContentVersion: 2, expectedInstanceVersion: 1 }, randomUUID(), randomUUID());
    expect(next.duties[1].participant.assignmentId).toBe(replacement.assignment.id);
  });

  it('keeps professional separate when the professional and both management duties belong to the same user', async () => {
    const f = await fixture('SUPPLIER', 'CRITICAL', true);
    const config = { ...(f.node.config as Prisma.InputJsonObject), professionalId: f.manager.user.id };
    await prisma.workflowNode.update({ where: { id: f.node.id }, data: { config } });
    const r = await f.start();
    await expect(service.decide(f.manager.actor, r.id, { expectedRoundVersion: 1, duties: ['PROFESSIONAL', 'SECTION_MANAGER'], decision: 'APPROVE', comment: 'Invalid merge' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const pro = await f.decide(f.manager.actor, r, ['PROFESSIONAL']);
    expect((await f.decide(f.manager.actor, pro, ['SECTION_MANAGER', 'MINISTER'])).status).toBe('APPROVED');
  });

  it('emits one bounded new closure event per committed round version and none for receipt replay', async () => {
    const f = await fixture(); const key = randomUUID(); const r = await f.start(key); await f.start(key);
    const rows = await prisma.outboxEvent.findMany({ where: { aggregateId: r.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ eventKey: `closure:${r.id}:1`, eventType: 'WORKFLOW_CLOSURE_CHANGED', payload: {
      schemaVersion: 1, organizationId: f.org.id, problemId: f.problem.id, roundId: r.id, roundVersion: 1,
    } });
    await f.decide(f.professional.actor, r, ['PROFESSIONAL']);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: r.id } })).toBe(2);
  });

  it('rolls back domain complete and both same-person duty rows if outbox persistence fails', async () => {
    const f = await fixture('SUPPLIER', 'HIGH', true);
    const r = await f.decide(f.professional.actor, await f.start(), ['PROFESSIONAL']);
    const outbox = new OutboxService(prisma);
    outbox.enqueue = async () => { throw new Error('Outbox unavailable'); };
    const failing = new WorkflowClosureRoundService(prisma, audit, responsibilities, new WorkflowClosureRegistry([adapter]), outbox);
    await expect(failing.decide(f.manager.actor, r.id, { expectedRoundVersion: r.version, duties: ['SECTION_MANAGER', 'MINISTER'], decision: 'APPROVE', comment: 'Check' }, randomUUID(), randomUUID())).rejects.toThrow('Outbox unavailable');
    expect(await service.readProjection(prisma, f.org.id, f.problem.id)).toEqual(r);
    expect((await prisma.problemIndex.findUniqueOrThrow({ where: { id: f.problem.id } })).status).toBe('OPEN');
  });

  it('rechecks real session and permission changes made while waiting on resolver user locks', async () => {
    const f = await fixture();
    let release!: () => void;
    let ready!: (pid: number) => void;
    const holding = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<number>(resolve => { ready = resolve; });
    const blocker = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${f.manager.user.id}::uuid FOR UPDATE`;
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      ready(backend.pid); await holding;
    }, { timeout: 20000 });
    const pid = await locked;
    const pending = f.start().then(value => ({ value }), error => ({ error }));
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 200 && !waiting; attempt++) {
        const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS waiting`;
        waiting = row.waiting;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await prisma.session.update({ where: { id: f.owner.actor.sessionId }, data: { revokedAt: new Date() } });
    } finally { release(); await blocker; }
    expect(await pending).toMatchObject({ error: { status: 401 } });
    expect(await service.readProjection(prisma, f.org.id, f.problem.id)).toBeNull();
  });

  it('rejects missing required MFA and replays with current rather than stale session security version', async () => {
    const f = await fixture(); const key = randomUUID(); await f.start(key);
    await prisma.user.update({ where: { id: f.owner.user.id }, data: { mfaRequirementOverride: true } });
    await prisma.session.update({ where: { id: f.owner.actor.sessionId }, data: { mfaVerifiedAt: null } });
    await expect(f.start(key)).rejects.toMatchObject({ status: 401 });
    await prisma.session.update({ where: { id: f.owner.actor.sessionId }, data: { mfaVerifiedAt: new Date() } });
    await prisma.user.update({ where: { id: f.owner.user.id }, data: { securityVersion: { increment: 1 } } });
    await expect(f.start(key)).rejects.toMatchObject({ status: 401 });
  });

  it('enforces same-organization foreign keys, one pending round and one row per round duty in PostgreSQL itself', async () => {
    const f = await fixture(); const other = await fixture(); const r = await f.start();
    await expect(prisma.$executeRaw`INSERT INTO workflow_closure_rounds
      (id, organization_id, problem_id, instance_id, workflow_version_id, node_id, content_version, content_snapshot, context, round_number, created_by)
      SELECT ${randomUUID()}::uuid, organization_id, problem_id, instance_id, workflow_version_id, node_id, content_version, content_snapshot, context, 2, created_by
      FROM workflow_closure_rounds WHERE id = ${r.id}::uuid`).rejects.toBeDefined();
    await expect(prisma.$executeRaw`INSERT INTO workflow_closure_duties (id, organization_id, round_id, duty, status, user_id, participant)
      SELECT ${randomUUID()}::uuid, organization_id, round_id, duty, status, user_id, participant FROM workflow_closure_duties WHERE round_id = ${r.id}::uuid AND duty = 'PROFESSIONAL'`).rejects.toBeDefined();
    await expect(prisma.$executeRaw`UPDATE workflow_closure_duties SET user_id = ${other.professional.user.id}::uuid,
      participant = jsonb_set(participant, '{userId}', ${JSON.stringify(other.professional.user.id)}::jsonb)
      WHERE round_id = ${r.id}::uuid AND duty = 'PROFESSIONAL'`).rejects.toBeDefined();
    await expect(prisma.$executeRaw`DELETE FROM workflow_instances WHERE id = ${f.instance.id}::uuid`).rejects.toBeDefined();
  });

  it('validates every service input including duplicate duties, versions, comments, keys and private actor claims', async () => {
    const f = await fixture();
    for (const body of [null, [], {}, { expectedContentVersion: 0, expectedInstanceVersion: 1 }, { expectedContentVersion: 1, expectedInstanceVersion: NaN },
      { expectedContentVersion: '1', expectedInstanceVersion: 1 }, { expectedContentVersion: 1, expectedInstanceVersion: 1, professionalUserId: f.owner.user.id }]) {
      await expect(service.start(f.owner.actor, f.problem.id, body as never, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    }
    await expect(service.start(f.owner.actor, f.problem.id, { expectedContentVersion: 1, expectedInstanceVersion: 1 }, 'bad key', randomUUID())).rejects.toMatchObject({ status: 400 });
    const r = await f.start();
    const input = { expectedRoundVersion: r.version, duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: 'Checked' };
    for (const body of [{ ...input, expectedRoundVersion: -1 }, { ...input, duties: [] }, { ...input, duties: ['PROFESSIONAL', 'PROFESSIONAL'] },
      { ...input, duties: ['OWNER'] }, { ...input, decision: 'CLOSE' }, { ...input, comment: ' ' }, { ...input, comment: 'x'.repeat(2001) }, { ...input, ownerUserId: f.owner.user.id }]) {
      await expect(service.decide(f.professional.actor, r.id, body as never, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    }
    await expect(service.cancel(f.owner.actor, r.id, { expectedRoundVersion: 1, reason: '' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
  });

  it('rejects excessive or executable snapshot values provided by an incorrectly implemented trusted adapter', async () => {
    const f = await fixture(); let executed = false;
    for (const content of ['x'.repeat(1_048_577), { toJSON: () => { executed = true; return 'wrong'; } }, { code: () => 'wrong' }]) {
      const invalid: WorkflowClosureAdapter = { ...adapter, async lockAndRead(...args) { return { ...await adapter.lockAndRead(...args), content: content as never }; } };
      const guarded = new WorkflowClosureRoundService(prisma, audit, responsibilities, new WorkflowClosureRegistry([invalid]));
      await expect(guarded.start(f.owner.actor, f.problem.id, { expectedContentVersion: 1, expectedInstanceVersion: 1 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    }
    expect(executed).toBe(false);
    expect(await service.readProjection(prisma, f.org.id, f.problem.id)).toBeNull();
  });

  it('returns both same-person eligible management duties and removes them immediately on revoked real permissions', async () => {
    const f = await fixture('SUPPLIER', 'HIGH', true); const r = await f.start();
    expect(await service.eligibleDuties(f.manager.actor)).toEqual([]);
    await f.decide(f.professional.actor, r, ['PROFESSIONAL']);
    const result = await service.eligibleDuties(f.manager.actor);
    expect(result.map(d => d.duty)).toEqual(['SECTION_MANAGER', 'MINISTER']);
    expect(result.every(d => d.samePersonDuties.join(',') === 'SECTION_MANAGER,MINISTER')).toBe(true);
    await prisma.userRole.deleteMany({ where: { userId: f.manager.user.id } });
    await expect(service.eligibleDuties(f.manager.actor)).rejects.toMatchObject({ status: 403 });
  });

  it('checks adapter instance/version/owner claims against actual PostgreSQL rows', async () => {
    const f = await fixture();
    for (const change of [{ instanceVersion: 2 }, { workflowVersionId: randomUUID() }, { ownerUserId: f.professional.user.id }]) {
      const invalid: WorkflowClosureAdapter = { ...adapter, async lockAndRead(...args) { return { ...await adapter.lockAndRead(...args), ...change }; } };
      const guarded = new WorkflowClosureRoundService(prisma, audit, responsibilities, new WorkflowClosureRegistry([invalid]));
      await expect(guarded.start(f.owner.actor, f.problem.id, { expectedContentVersion: 1, expectedInstanceVersion: 1 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    }
    expect(await service.readProjection(prisma, f.org.id, f.problem.id)).toBeNull();
  });

  async function notificationFixture(policy: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const f = await fixture(policy);
    const grants = await prisma.permission.findMany({ where: { code: { in: ['task:read', 'notification:read'] } } });
    expect(grants).toHaveLength(2);
    await prisma.rolePermission.createMany({ data: grants.map(p => ({ roleId: f.role.id, permissionId: p.id })) });
    const r = await f.start();
    const recipients = (round = r, target = service) => prisma.$transaction(tx => target.notificationRecipients(tx, f.org.id, f.problem.id, round.id, round.version));
    return { ...f, r, recipients };
  }

  it('authorizes offline notification recipients without requiring, borrowing or creating sessions', async () => {
    const f = await notificationFixture();
    await prisma.session.deleteMany({ where: { userId: { in: [f.professional.user.id, f.manager.user.id] } } });
    expect((await f.recipients()).sort()).toEqual([f.professional.user.id, f.manager.user.id].sort());
    expect(await prisma.session.count({ where: { userId: { in: [f.professional.user.id, f.manager.user.id] } } })).toBe(0);
  });

  it('keeps supplier management offline notifications waiting until the professional passes, and drops late events', async () => {
    const f = await notificationFixture('SUPPLIER');
    expect(await f.recipients()).toEqual([f.professional.user.id]);
    const one = await f.decide(f.professional.actor, f.r, ['PROFESSIONAL']);
    expect(await f.recipients()).toEqual([]);
    await prisma.session.deleteMany({ where: { userId: f.manager.user.id } });
    expect(await f.recipients(one)).toEqual([f.manager.user.id]);
  });

  it('fails offline notifications closed without adapter audience authorization, changed sources or changed domain facts', async () => {
    const f = await notificationFixture();
    const noAudience: WorkflowClosureAdapter = { ...adapter, canNotifyRecipient: undefined };
    const closed = new WorkflowClosureRoundService(prisma, audit, responsibilities, new WorkflowClosureRegistry([noAudience]));
    expect(await f.recipients(f.r, closed)).toEqual([]);
    const config = { ...(f.node.config as Prisma.InputJsonObject), professionalId: f.owner.user.id };
    await prisma.workflowNode.update({ where: { id: f.node.id }, data: { config } });
    expect(await f.recipients()).toEqual([]);
    await prisma.workflowNode.update({ where: { id: f.node.id }, data: { config: f.node.config as Prisma.InputJsonValue } });
    await prisma.$executeRaw`UPDATE department_management_bindings SET version = version + 1 WHERE id = ${f.managerBinding}::uuid`;
    expect(await f.recipients()).toEqual([]);
    expect((await service.readProjection(prisma, f.org.id, f.problem.id))!.status).toBe('PENDING');
  });

  it.each(['workflow:act', 'task:read', 'notification:read'])('revokes offline notification visibility immediately for missing %s', async permission => {
    const f = await notificationFixture();
    const p = await prisma.permission.findUniqueOrThrow({ where: { code: permission } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: p.id } } });
    expect(await f.recipients()).toEqual([]);
  });
});
