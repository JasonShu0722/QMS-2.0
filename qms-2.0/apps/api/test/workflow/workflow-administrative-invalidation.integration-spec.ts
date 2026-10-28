import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { AdministrativeLifecycleRegistry } from '../../src/common/security/administrative-lifecycle.registry.js';
import type { AdministrativeLifecycleImpact } from '../../src/common/security/administrative-lifecycle.types.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { OrganizationResponsibilityService } from '../../src/modules/organization/organization-responsibility.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { WorkflowAdministrativeInvalidationService } from '../../src/modules/workflow/workflow-administrative-invalidation.service.js';
import type { WorkflowAdministrativeInvalidationInput } from '../../src/modules/workflow/workflow-administrative-invalidation.types.js';
import { WorkflowClosureRegistry } from '../../src/modules/workflow/workflow-closure-registry.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import type { WorkflowClosureAdapter, WorkflowClosureRound } from '../../src/modules/workflow/workflow-closure-round.types.js';
import { clearWorkflowClosureFixtureEvents, createWorkflowClosureFixture, workflowClosureFixtureAdapter } from './workflow-closure-round.fixture.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Administrative invalidation requires disposable loopback PostgreSQL, never preview 55440.');
}
jest.setTimeout(90_000);

describe('administrative invalidation engine real PostgreSQL (neutral adapter, not four-domain acceptance)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const outbox = new OutboxService(prisma);
  const problems = new ProblemIndexService(prisma, new NumberingService(prisma), audit, outbox);
  const responsibilities = new OrganizationResponsibilityService(prisma, new AdminMutationService(prisma, audit), audit);
  const calls: WorkflowAdministrativeInvalidationInput[] = [];
  const deadlineIds: string[] = [];
  const adapter: WorkflowClosureAdapter = { ...workflowClosureFixtureAdapter,
    async administrativeInvalidation(tx, input) {
      calls.push(input);
      const problem = await problems.lockForWorkflow(tx, input.organizationId, input.problemId);
      await tx.workflowInstance.update({ where: { id: problem.workflowInstanceId! }, data: { version: { increment: 1 }, updatedById: input.actorUserId } });
      return 0;
    },
  };
  const registry = new WorkflowClosureRegistry([adapter]);
  const rounds = new WorkflowClosureRoundService(prisma, audit, responsibilities, registry, outbox);
  const engine = (adapters = registry, logger = audit) => new WorkflowAdministrativeInvalidationService(
    new AdministrativeLifecycleRegistry(), adapters, problems, logger, outbox);
  const impact = (f: Awaited<ReturnType<typeof createWorkflowClosureFixture>>, changes: Partial<AdministrativeLifecycleImpact> = {}): AdministrativeLifecycleImpact => ({
    kind: 'USER', entityId: f.manager.user.id, organizationId: f.org.id, receiptOrganizationId: f.org.id,
    userIds: [f.manager.user.id], departmentIds: [], positionIds: [], organizationIds: [], ...changes,
  });
  const fixture = () => createWorkflowClosureFixture(prisma, rounds);
  const transaction = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(work, { isolationLevel: 'ReadCommitted', timeout: 20_000 });
  const deadline = async (r: WorkflowClosureRound, status: 'QUALITY_PENDING' | 'APPROVED', stage: 'ANALYSIS' | 'SUBMISSION' = 'ANALYSIS') => {
    const id = randomUUID();
    deadlineIds.push(id);
    await prisma.$executeRaw`INSERT INTO workflow_deadline_extensions
      (id, organization_id, problem_id, workflow_version_id, stage, original_due_at, requested_due_at, originally_overdue, reason, applicant_user_id, context, participants, status, history)
      VALUES (${id}::uuid, ${r.organizationId}::uuid, ${r.problemId}::uuid, ${r.workflowVersionId}::uuid, ${stage}, CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP + INTERVAL '1 day', false, 'Fixture extension', ${r.context.ownerUserId}::uuid, ${JSON.stringify(r.context)}::jsonb,
      ${JSON.stringify({ leader: r.duties[1]!.participant, professional: r.duties[0]!.participant, leaderSkipped: false })}::jsonb, ${status}, '[{"action":"REQUESTED"}]'::jsonb)`;
    return id;
  };

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());
  afterEach(async () => {
    calls.length = 0;
    await clearWorkflowClosureFixtureEvents(prisma);
    await prisma.outboxEvent.deleteMany({ where: { eventType: 'WORKFLOW_DEADLINE_EXTENSION_CHANGED', aggregateId: { in: deadlineIds } } });
  });

  it('cancels pending closure/deadline, preserves approved duty/history, uses the real cross-organization actor, rejects late decisions and is repeatable', async () => {
    const f = await fixture(), admin = await fixture();
    const r = await f.decide(f.professional.actor, await f.start(), ['PROFESSIONAL']);
    const pendingId = await deadline(r, 'QUALITY_PENDING'), approvedId = await deadline(r, 'APPROVED', 'SUBMISSION');
    const beforeApproved = await prisma.$queryRaw`SELECT * FROM workflow_deadline_extensions WHERE id = ${approvedId}::uuid`;
    const beforeDuty = r.duties.find(d => d.status === 'APPROVED');
    const result = await transaction(tx => engine().apply(tx, admin.owner.actor, impact(f)));
    expect(result).toEqual({ module: 'workflow', changed: 2, pendingConfiguration: 1 });
    const saved = await transaction(tx => rounds.readProjection(tx, f.org.id, f.problem.id));
    expect(saved).toMatchObject({ status: 'CANCELLED', version: r.version + 1, context: { endedBy: admin.owner.user.id, endReason: 'ADMINISTRATIVE_USER_DELETED' } });
    expect(saved!.duties.find(d => d.status === 'APPROVED')).toEqual(beforeDuty);
    expect(saved!.duties.find(d => d.duty === 'SECTION_MANAGER')).toMatchObject({ status: 'CANCELLED', version: r.duties[1]!.version + 1 });
    const [pending] = await prisma.$queryRaw<{ status: string; version: number; history: unknown[] }[]>`SELECT status, version, history FROM workflow_deadline_extensions WHERE id = ${pendingId}::uuid`;
    expect(pending).toMatchObject({ status: 'CANCELLED', version: 2, history: [{ action: 'REQUESTED' }, { userId: admin.owner.user.id, action: 'QUALITY_PENDING:CANCELLED' }] });
    expect(await prisma.$queryRaw`SELECT * FROM workflow_deadline_extensions WHERE id = ${approvedId}::uuid`).toEqual(beforeApproved);
    expect(calls).toEqual([{ problemId: f.problem.id, organizationId: f.org.id, actorUserId: admin.owner.user.id, reason: 'ADMINISTRATIVE_USER_DELETED', impact: impact(f) }]);
    await expect(f.decide(f.manager.actor, r, ['SECTION_MANAGER'])).rejects.toMatchObject({ status: 409 });
    expect(await transaction(tx => engine().apply(tx, admin.owner.actor, impact(f)))).toEqual({ module: 'workflow', changed: 0, pendingConfiguration: 0 });
    const events = await prisma.auditEvent.findMany({ where: { resourceId: { in: [r.id, pendingId] }, actorUserId: admin.owner.user.id } });
    expect(events).toHaveLength(2);
  });

  it('refuses a missing hook before changing a round or deadline', async () => {
    const f = await fixture(), r = await f.start();
    const requestId = await deadline(r, 'QUALITY_PENDING');
    await expect(transaction(tx => engine(new WorkflowClosureRegistry([workflowClosureFixtureAdapter])).apply(tx, f.owner.actor, impact(f))))
      .rejects.toMatchObject({ status: 409 });
    expect((await transaction(tx => rounds.readProjection(tx, f.org.id, f.problem.id)))!.status).toBe('PENDING');
    expect(await prisma.$queryRaw`SELECT status FROM workflow_deadline_extensions WHERE id = ${requestId}::uuid`).toEqual([{ status: 'QUALITY_PENDING' }]);
  });

  it('rolls back engine, domain hook and outbox writes if audit fails', async () => {
    const f = await fixture(), r = await f.start();
    class FailingAudit extends AuditLogService { override async record(): Promise<never> { throw new Error('fixture audit unavailable'); } }
    await expect(transaction(tx => engine(registry, new FailingAudit(prisma)).apply(tx, f.owner.actor, impact(f)))).rejects.toThrow('fixture audit unavailable');
    expect((await transaction(tx => rounds.readProjection(tx, f.org.id, f.problem.id)))!.status).toBe('PENDING');
    expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: f.instance.id } })).version).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: r.id, eventKey: `closure:${r.id}:2` } })).toBe(0);
  });

  it('matches department and owned organization without touching unrelated or approved rounds', async () => {
    const f = await fixture(), untouched = await fixture(), approved = await fixture();
    await f.start(); const other = await untouched.start();
    const one = await approved.decide(approved.professional.actor, await approved.start(), ['PROFESSIONAL']);
    const done = await approved.decide(approved.manager.actor, one, ['SECTION_MANAGER']);
    const input = impact(f, { kind: 'DEPARTMENT', userIds: [], departmentIds: [f.section.id], organizationIds: [approved.org.id] });
    expect(await transaction(tx => engine().apply(tx, f.owner.actor, input))).toMatchObject({ changed: 1, pendingConfiguration: 1 });
    expect(await transaction(tx => rounds.readProjection(tx, untouched.org.id, untouched.problem.id))).toEqual(other);
    expect(await transaction(tx => rounds.readProjection(tx, approved.org.id, approved.problem.id))).toEqual(done);
  });

  it('keeps a same-user B creator/applicant/participant unchanged for A deletion, but still cancels globally for USER deletion', async () => {
    const f = await fixture();
    const a = await prisma.department.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'Unrelated A' } });
    const position = await prisma.position.create({ data: { organizationId: f.org.id, departmentId: a.id, code: randomUUID(), name: 'A manager' } });
    await prisma.userPosition.create({ data: { organizationId: f.org.id, userId: f.manager.user.id, positionId: position.id } });
    const r = await f.decide(f.professional.actor, await f.start(), ['PROFESSIONAL']);
    await prisma.$executeRaw`UPDATE workflow_closure_rounds SET created_by=${f.manager.user.id}::uuid WHERE id=${r.id}::uuid`;
    const id = await deadline(r, 'QUALITY_PENDING');
    await prisma.$executeRaw`UPDATE workflow_deadline_extensions SET applicant_user_id=${f.manager.user.id}::uuid WHERE id=${id}::uuid`;
    const before = await transaction(tx => rounds.readProjection(tx, f.org.id, f.problem.id));
    const beforeDeadline = await prisma.$queryRaw`SELECT * FROM workflow_deadline_extensions WHERE id=${id}::uuid`;
    const beforeInstance = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: f.instance.id } });
    expect(await transaction(tx => engine().apply(tx, f.owner.actor, impact(f, { kind: 'DEPARTMENT', entityId: a.id,
      departmentIds: [a.id], positionIds: [position.id] })))).toEqual({ module: 'workflow', changed: 0, pendingConfiguration: 0 });
    expect(await transaction(tx => rounds.readProjection(tx, f.org.id, f.problem.id))).toEqual(before);
    expect(await prisma.$queryRaw`SELECT * FROM workflow_deadline_extensions WHERE id=${id}::uuid`).toEqual(beforeDeadline);
    expect(await prisma.workflowInstance.findUniqueOrThrow({ where: { id: f.instance.id } })).toEqual(beforeInstance);
    expect(calls).toEqual([]);
    expect(await transaction(tx => engine().apply(tx, f.owner.actor, impact(f)))).toMatchObject({ changed: 2, pendingConfiguration: 1 });
    const after = await transaction(tx => rounds.readProjection(tx, f.org.id, f.problem.id));
    expect(after!.duties.find(duty => duty.status === 'APPROVED')).toEqual(r.duties.find(duty => duty.status === 'APPROVED'));
    await expect(f.decide(f.manager.actor, r, ['SECTION_MANAGER'])).rejects.toMatchObject({ status: 409 });
  });

  it('cancels saved supplier WAITING duties without rewriting their participant snapshots', async () => {
    const f = await createWorkflowClosureFixture(prisma, rounds, 'SUPPLIER', 'HIGH');
    const r = await f.start();
    expect(r.duties.map(d => d.status)).toEqual(['PENDING', 'WAITING', 'WAITING']);
    await transaction(tx => engine().apply(tx, f.owner.actor, impact(f, { kind: 'ORGANIZATION', userIds: [], organizationIds: [f.org.id] })));
    const after = (await transaction(tx => rounds.readProjection(tx, f.org.id, f.problem.id)))!;
    expect(after.duties.map(d => d.status)).toEqual(['CANCELLED', 'CANCELLED', 'CANCELLED']);
    expect(after.duties.map(d => d.participant)).toEqual(r.duties.map(d => d.participant));
  });

  it('handles a deadline-only problem and leaves terminal deadline records unchanged', async () => {
    const f = await fixture(), r = await f.start();
    await rounds.cancel(f.owner.actor, r.id, { expectedRoundVersion: r.version, reason: 'Fixture returns to handling' }, randomUUID(), randomUUID());
    const id = await deadline(r, 'QUALITY_PENDING');
    expect(await transaction(tx => engine().apply(tx, f.owner.actor, impact(f)))).toEqual({ module: 'workflow', changed: 1, pendingConfiguration: 1 });
    expect(await prisma.$queryRaw`SELECT status FROM workflow_deadline_extensions WHERE id = ${id}::uuid`).toEqual([{ status: 'CANCELLED' }]);
    expect((await transaction(tx => rounds.readProjection(tx, f.org.id, f.problem.id)))!.version).toBe(2);
  });

  it('rolls back domain-hook writes and preserves pending rounds if the trusted hook fails', async () => {
    const f = await fixture(); await f.start();
    const failing = new WorkflowClosureRegistry([{ ...adapter, async administrativeInvalidation(tx, input) {
      await adapter.administrativeInvalidation!(tx, input);
      throw new Error('fixture domain failure');
    } }]);
    await expect(transaction(tx => engine(failing).apply(tx, f.owner.actor, impact(f)))).rejects.toThrow('fixture domain failure');
    expect((await transaction(tx => rounds.readProjection(tx, f.org.id, f.problem.id)))!.status).toBe('PENDING');
    expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: f.instance.id } })).version).toBe(1);
  });

  it('serializes a racing ordinary decision behind administrative invalidation on the same problem', async () => {
    const f = await fixture(), r = await f.start();
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    const holding = new WorkflowClosureRegistry([{ ...adapter, async administrativeInvalidation(tx, input) {
      await adapter.administrativeInvalidation!(tx, input); entered(); await resume; return 0;
    } }]);
    const invalidating = transaction(tx => engine(holding).apply(tx, f.owner.actor, impact(f)));
    try {
      await reached;
      const decision = f.decide(f.manager.actor, r, ['SECTION_MANAGER']).then(() => null, error => error as { status: number });
      release();
      await expect(invalidating).resolves.toMatchObject({ changed: 1 });
      expect(await decision).toMatchObject({ status: 409 });
    } finally { release(); await invalidating.catch(() => undefined); }
  });
});
