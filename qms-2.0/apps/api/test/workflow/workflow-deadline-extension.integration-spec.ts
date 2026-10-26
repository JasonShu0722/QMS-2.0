import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { OrganizationResponsibilityService } from '../../src/modules/organization/organization-responsibility.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import { WorkflowClosureRegistry } from '../../src/modules/workflow/workflow-closure-registry.js';
import { WorkflowDeadlineExtensionService } from '../../src/modules/workflow/workflow-deadline-extension.service.js';
import type { WorkflowActor } from '../../src/modules/workflow/workflow-access-policy.js';
import type { WorkflowDeadlineExtension } from '../../src/modules/workflow/workflow-deadline-extension.types.js';
import { createDeadlineFixture, deadlineFixtureAdapter, initializeDeadlineFixture } from './workflow-deadline-extension.fixture.js';

const url = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (!url || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['postgres:', 'postgresql:'].includes(url.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash) throw new Error('Deadline extensions require disposable loopback PostgreSQL, never preview 55440.');

describe('bounded deadline extensions real PostgreSQL', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const management = new OrganizationResponsibilityService(prisma, new AdminMutationService(prisma, audit), audit);
  const registry = new WorkflowClosureRegistry([deadlineFixtureAdapter]);
  const rounds = new WorkflowClosureRoundService(prisma, audit, management, registry);
  const service = new WorkflowDeadlineExtensionService(prisma, audit, management, registry, rounds, new OutboxService(prisma));
  const organizations: string[] = [];
  beforeAll(async () => { await prisma.$connect(); await initializeDeadlineFixture(prisma); }, 120000);
  afterEach(async () => {
    if (organizations.length) await prisma.$executeRaw`DELETE FROM outbox_events WHERE event_type = 'WORKFLOW_DEADLINE_EXTENSION_CHANGED' AND payload->>'organizationId' = ANY(${organizations}::text[])`;
  }, 120000);
  afterAll(() => prisma.$disconnect());
  async function fixture() { const f = await createDeadlineFixture(prisma, rounds); organizations.push(f.org.id); return f; }
  const request = (actor: WorkflowActor, id: string, key = randomUUID(), due = '2026-12-01T00:00:00.000Z') => service.request(actor, id,
    { expectedRowVersion: 1, expectedInstanceVersion: 1, stage: 'ANALYSIS', requestedDueAt: due, reason: 'Real explicit extension reason' }, key, randomUUID());
  const decide = (actor: WorkflowActor, r: WorkflowDeadlineExtension, decision: 'APPROVE' | 'RETURN' = 'APPROVE', key = randomUUID()) => service.decide(actor, r.id,
    { expectedVersion: r.version, decision }, key, randomUUID());

  it('keeps the original deadline through leader approval; only real quality approval updates it', async () => {
    const f = await fixture(); const r = await request(f.owner.actor, f.problem.id);
    expect(r).toMatchObject({ status: 'LEADER_PENDING', originallyOverdue: true });
    expect(await f.due()).toBe(r.originalDueAt);
    await expect(decide(f.professional.actor, r)).rejects.toMatchObject({ status: 403 });
    const leader = await decide(f.manager.actor, r);
    expect(leader.status).toBe('QUALITY_PENDING'); expect(await f.due()).toBe(r.originalDueAt);
    const approved = await decide(f.professional.actor, leader);
    expect(approved.status).toBe('APPROVED'); expect(await f.due()).toBe(r.requestedDueAt);
    expect(approved.history.some(h => h.action === 'ORIGINAL_DUE_ELAPSED_BEFORE_APPROVAL')).toBe(true);
    expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: f.instance.id } })).status).toBe('RUNNING');
    expect((await prisma.problemIndex.findUniqueOrThrow({ where: { id: f.problem.id } })).closedAt).toBeNull();
  }, 120000);

  it.each(['LEADER', 'QUALITY'] as const)('returns from %s and never changes the original deadline', async side => {
    const f = await fixture(); let r = await request(f.owner.actor, f.problem.id);
    if (side === 'QUALITY') r = await decide(f.manager.actor, r);
    expect((await decide(side === 'LEADER' ? f.manager.actor : f.professional.actor, r, 'RETURN')).status).toBe('RETURNED');
    expect(await f.due()).toBe(r.originalDueAt);
  }, 120000);

  it('uses the minister when owner is manager and only skips a genuinely identical valid leader', async () => {
    const f = await fixture(); await prisma.problemIndex.update({ where: { id: f.problem.id }, data: { ownerId: f.manager.user.id } });
    const r = await request(f.manager.actor, f.problem.id);
    expect(r.participants.leader.userId).toBe(f.minister.user.id); expect(r.status).toBe('LEADER_PENDING');
    await decide(f.minister.actor, r, 'RETURN');
    await prisma.userPosition.update({ where: { id: f.minister.assignment.id }, data: { userId: f.manager.user.id } });
    const skipped = await request(f.manager.actor, f.problem.id);
    expect(skipped.status).toBe('QUALITY_PENDING'); expect(skipped.history.some(h => h.action === 'LEADER_SKIPPED_SAME_PERSON')).toBe(true);
    await expect(decide(f.manager.actor, skipped)).rejects.toMatchObject({ status: 403 });
    expect(await f.due()).toBe(skipped.originalDueAt);
    expect((await decide(f.professional.actor, skipped)).status).toBe('APPROVED');
  }, 120000);

  it('rejects unknown bodies, absent original due dates, unauthorized actors and CAS conflicts without facts', async () => {
    const f = await fixture();
    await expect(request(f.professional.actor, f.problem.id)).rejects.toMatchObject({ status: 403 });
    await expect(service.request(f.owner.actor, f.problem.id, { expectedRowVersion: 1, expectedInstanceVersion: 1, stage: 'SUBMISSION', requestedDueAt: '2027-01-01', reason: 'explicit' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(service.request(f.owner.actor, f.problem.id, { expectedRowVersion: 1, expectedInstanceVersion: 1, stage: 'ANALYSIS', requestedDueAt: '2027-01-01', reason: 'explicit', arbitraryAction: 'CLOSE' } as never, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    const r = await request(f.owner.actor, f.problem.id);
    await expect(request(f.owner.actor, f.problem.id)).rejects.toMatchObject({ status: 409 });
    await decide(f.manager.actor, r);
    await expect(decide(f.manager.actor, r)).rejects.toMatchObject({ status: 403 });
    expect(await f.due()).toBe(r.originalDueAt);
  }, 120000);

  it('replays exact receipts but refuses changed payload and revoked sessions', async () => {
    const f = await fixture(); const key = randomUUID(); const r = await request(f.owner.actor, f.problem.id, key);
    expect(await request(f.owner.actor, f.problem.id, key)).toEqual(r);
    await expect(request(f.owner.actor, f.problem.id, key, '2027-01-01T00:00:00Z')).rejects.toMatchObject({ status: 409 });
    await prisma.session.update({ where: { id: f.owner.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(request(f.owner.actor, f.problem.id, key)).rejects.toMatchObject({ status: 401 });
  }, 120000);

  it('cancels changed approvers instead of silently substituting; unrelated body saves are allowed', async () => {
    const f = await fixture(); const r = await request(f.owner.actor, f.problem.id);
    await prisma.problemIndex.update({ where: { id: f.problem.id }, data: { version: { increment: 1 } } });
    await prisma.$executeRaw`UPDATE workflow_deadline_extension_fixture_facts SET version = version + 1 WHERE problem_id = ${f.problem.id}::uuid`;
    const quality = await decide(f.manager.actor, r); expect(quality.status).toBe('QUALITY_PENDING');
    await prisma.$executeRaw`UPDATE department_management_bindings SET version = version + 1 WHERE id = ${f.managerBinding}::uuid`;
    const cancelled = await decide(f.professional.actor, quality);
    expect(cancelled.status).toBe('CANCELLED'); expect(await f.due()).toBe(r.originalDueAt);
    expect((await service.history(f.owner.actor, f.problem.id))[0].history.at(-1)?.comment).toBe('SOURCE_CHANGED_REAPPLY');
  }, 120000);

  it('does not overwrite a concurrently changed old due date', async () => {
    const f = await fixture(); const r = await request(f.owner.actor, f.problem.id);
    await prisma.$executeRaw`UPDATE workflow_deadline_extension_fixture_facts SET analysis_due_at = ${new Date('2026-06-01T00:00:00Z')} WHERE problem_id = ${f.problem.id}::uuid`;
    expect((await decide(f.manager.actor, r)).status).toBe('CANCELLED'); expect(await f.due()).toBe('2026-06-01T00:00:00.000Z');
  }, 120000);

  it('allows only one concurrent pending request', async () => {
    const f = await fixture(); const results = await Promise.allSettled([request(f.owner.actor, f.problem.id), request(f.owner.actor, f.problem.id)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect((await service.history(f.owner.actor, f.problem.id))).toHaveLength(1);
  }, 120000);

  it('rolls back final approval, history, audit and outbox if the real domain update fails', async () => {
    const f = await fixture(); const r = await request(f.owner.actor, f.problem.id, randomUUID(), '2099-01-01T00:00:00Z');
    const quality = await decide(f.manager.actor, r);
    const audits = await prisma.auditEvent.count({ where: { resourceId: r.id } });
    const events = await prisma.outboxEvent.count({ where: { aggregateId: r.id } });
    await expect(decide(f.professional.actor, quality)).rejects.toBeDefined();
    expect((await service.history(f.owner.actor, f.problem.id))[0]).toMatchObject({ status: 'QUALITY_PENDING', version: quality.version, history: quality.history });
    expect(await f.due()).toBe(r.originalDueAt);
    expect(await prisma.auditEvent.count({ where: { resourceId: r.id } })).toBe(audits);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: r.id } })).toBe(events);
  }, 120000);

  it('fails closed without an installed deadline hook or real published owner-node policy', async () => {
    const f = await fixture();
    await prisma.workflowNode.update({ where: { id: f.ownerNode.id }, data: { config: { assignment: { permission: 'workflow:act' } } } });
    await expect(request(f.owner.actor, f.problem.id)).rejects.toMatchObject({ status: 409 });
    const { deadlineContext: _context, applyDeadlineExtension: _apply, ...legacy } = deadlineFixtureAdapter;
    const noHook = new WorkflowDeadlineExtensionService(prisma, audit, management, new WorkflowClosureRegistry([legacy]), rounds, new OutboxService(prisma));
    await expect(noHook.history(f.owner.actor, f.problem.id)).rejects.toMatchObject({ status: 409 });
  }, 120000);

  it.each(['ASSIGNMENT', 'SCOPE'] as const)('filters captured %s expiry after the final adapter wait without rerunning the resolver', async source => {
    const f = await fixture();
    if (source === 'SCOPE') await prisma.problemIndex.update({ where: { id: f.problem.id }, data: { ownerId: f.manager.user.id } });
    const r = await request(source === 'SCOPE' ? f.manager.actor : f.owner.actor, f.problem.id);
    const actor = source === 'SCOPE' ? f.minister.actor : f.manager.actor;
    const original = deadlineFixtureAdapter.deadlineContext!;
    let reads = 0;
    const resolver = jest.spyOn(management, 'resolveManagementResponsibilities');
    const adapter = jest.spyOn(deadlineFixtureAdapter, 'deadlineContext').mockImplementation(async (tx, context, currentActor, operation) => {
      const c = await original(tx, context, currentActor, operation);
      if (++reads === 2) {
        const expires = new Date(Date.now() + 50);
        if (source === 'ASSIGNMENT') await tx.userPosition.update({ where: { id: f.manager.assignment.id }, data: { endedAt: expires } });
        else await tx.$executeRaw`UPDATE department_minister_scopes SET valid_to = ${expires} WHERE id = ${f.scopeId}::uuid`;
        await tx.$queryRaw`SELECT pg_sleep(0.1)::text`;
      }
      return c;
    });
    try {
      expect(await prisma.$transaction(tx => service.eligible(tx, actor, f.problem.id))).toEqual([]);
      expect(reads).toBe(2); expect(resolver).toHaveBeenCalledTimes(1);
      expect(await f.due()).toBe(r.originalDueAt);
    } finally { adapter.mockRestore(); resolver.mockRestore(); }
  }, 120000);
});
