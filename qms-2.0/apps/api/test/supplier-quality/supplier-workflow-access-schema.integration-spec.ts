import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import type { Prisma, WorkflowNode } from '../../src/generated/prisma/client.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { WorkflowRuntimeService, type WorkflowActionInput, type WorkflowActionResult, type WorkflowCommand } from '../../src/modules/workflow/workflow-runtime.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { SupplierWorkflowAccess } from '../../src/modules/supplier-quality/supplier-workflow-access.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { jest } from '@jest/globals';

if (!process.env.DATABASE_URL) throw new Error('Supplier workflow access requires real PostgreSQL; no skipping.');

interface Participant {
  authorize(tx: Prisma.TransactionClient, input: WorkflowCommand, node?: WorkflowNode): Promise<void>;
  lock(tx: Prisma.TransactionClient, input: WorkflowCommand): Promise<void>;
}
type Mutation = (tx: Prisma.TransactionClient) => Promise<void>;

describe('supplier participation in the real platform runtime', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let runtime: WorkflowRuntimeService;
  const instances: string[] = [];
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    runtime = app.get(WorkflowRuntimeService);
  });
  afterAll(async () => {
    try { if (prisma && instances.length) await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: instances } } }); }
    finally { await app?.close(); }
  });

  function participant(): Participant {
    return app.get(SupplierWorkflowAccess);
  }

  async function identity(type: 'INTERNAL' | 'SUPPLIER', organizationId?: string) {
    organizationId ??= (await prisma.organization.create({ data: { code: randomUUID(), name: 'Participation fixture', type } })).id;
    const user = await prisma.user.create({ data: { organizationId, username: randomUUID(), accountType: type, passwordHash: 'unused-fixture' } });
    const role = await prisma.role.create({ data: { organizationId, code: `ROLE-${randomUUID()}`, name: 'Participant fixture' } });
    for (const code of ['workflow:start', 'workflow:act', 'supplier-quality:problems:write', 'supplier-quality:responses:write']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId } });
    await app.get(SessionService).create(user.id);
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    return { actor: { id: user.id, organizationId, accountType: type, sessionId: session.id }, role };
  }

  async function fixture(mode: 'INTERNAL' | 'SUPPLIER' = 'SUPPLIER', independent = true) {
    const owner = await identity('INTERNAL');
    const supplier = await identity('SUPPLIER');
    const responder = mode === 'SUPPLIER' ? supplier : await identity('INTERNAL', owner.actor.organizationId);
    const profile = await prisma.supplierBusinessProfile.create({ data: { ownerOrganizationId: owner.actor.organizationId, supplierOrganizationId: supplier.actor.organizationId, businessCode: randomUUID(), displayName: 'Supplier fixture' } });
    const record = await prisma.supplierQualityProblem.create({ data: { ownerOrganizationId: owner.actor.organizationId, supplierOrganizationId: supplier.actor.organizationId, profileId: profile.id, createdById: owner.actor.id, title: 'Runtime participation fixture', materialCode: 'MAT', defectDescription: 'Issue', defectQuantity: 1, severity: 'HIGH', responseForm: 'BRIEF', replyMode: mode, internalResponderId: mode === 'INTERNAL' ? responder.actor.id : null } });
    // Domain release is a fixture; formal issuance and immutable reply submission are separate batches.
    const index = await prisma.problemIndex.create({ data: { organizationId: owner.actor.organizationId, reportNumber: randomUUID(), domainCode: 'supplier-quality', sourceType: 'supplier-quality', sourceId: record.id, severity: 'HIGH', problemType: 'BRIEF' } });
    await prisma.supplierQualityProblem.update({ where: { id: record.id }, data: { problemIndexId: index.id, releasedToSupplierAt: mode === 'SUPPLIER' ? new Date() : null } });
    const definitions = app.get(WorkflowDefinitionService);
    const definition = await definitions.createDraft({ organizationId: owner.actor.organizationId, userId: owner.actor.id, code: randomUUID(), name: 'Supplier participation', draft: {
      nodes: [
        { id: 'reply', type: 'ACTION', name: 'Reply', config: { isStart: true, assignment: { roleCode: responder.role.code, permission: 'supplier-quality:responses:write' } } },
        { id: 'verify', type: 'VERIFICATION', name: 'Verify', config: { assignment: { permission: 'supplier-quality:problems:write' } } },
        { id: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, assignment: { permission: 'supplier-quality:problems:write' }, requireIndependentVerification: independent } },
      ], transitions: [{ id: 'submit', from: 'reply', to: 'verify', action: 'SUBMIT' }, { id: 'verify', from: 'verify', to: 'close', action: 'VERIFY' }, { id: 'return', from: 'verify', to: 'reply', action: 'RETURN' }],
    } });
    const version = await definitions.publishVersion({ organizationId: owner.actor.organizationId, userId: owner.actor.id, definitionId: definition.id });
    const startInput = { organizationId: owner.actor.organizationId, actor: owner.actor, problemIndexId: index.id, workflowDefinitionId: definition.id, workflowVersionId: version.id, expectedProblemVersion: 1, instanceKey: randomUUID(), idempotencyKey: randomUUID(), traceId: randomUUID() };
    const started = await runtime.startInstance(startInput);
    instances.push(started.instanceId);
    const action = (result = started, actor = responder.actor, name: WorkflowActionInput['action'] = 'SUBMIT'): WorkflowActionInput => ({ organizationId: owner.actor.organizationId, actor, problemIndexId: index.id, workflowVersionId: version.id, instanceId: result.instanceId, currentNodeId: result.currentNodeId, expectedVersion: result.version, expectedProblemVersion: result.problemVersion, action: name, idempotencyKey: randomUUID(), traceId: randomUUID(), commandPayload: { problemId: record.id, expectedDomainVersion: 1 } });
    return { owner, supplier, responder, record, index, started, startInput, action };
  }

  function submit(input: WorkflowActionInput, mutate?: Mutation, access: Participant | undefined = participant()) {
    return runtime.submitAction(input, undefined, mutate, undefined, access);
  }

  it('executes with the real supplier identity and preserves owner-scoped workflow, audit and outbox', async () => {
    const context = await fixture();
    const input = context.action();
    const result = await submit(input, async (tx) => { await tx.supplierQualityProblem.update({ where: { id: context.record.id }, data: { version: { increment: 1 } } }); });
    expect(result).toMatchObject({ version: 2, problemVersion: 3, status: 'RUNNING' });
    expect(await prisma.workflowMutation.findFirst({ where: { instanceId: result.instanceId, instanceVersion: 2 } })).toMatchObject({ actorUserId: context.supplier.actor.id, organizationId: context.owner.actor.organizationId });
    expect(await prisma.auditEvent.findFirst({ where: { resourceId: result.instanceId, action: 'WORKFLOW_ACTION_COMPLETED' } })).toMatchObject({ actorUserId: context.supplier.actor.id, organizationId: context.owner.actor.organizationId });
    expect(await prisma.outboxEvent.count({ where: { eventKey: `workflow:${result.instanceId}:2` } })).toBe(1);
    expect(await prisma.userRole.count({ where: { userId: context.supplier.actor.id, organizationId: context.owner.actor.organizationId } })).toBe(0);
  });

  it('denies cross-organization execution without the server-side domain callback', async () => {
    const context = await fixture();
    await expect(runtime.submitAction(context.action())).rejects.toMatchObject({ status: 403 });
    await expect(runtime.startInstance({ ...context.startInput, actor: context.supplier.actor })).rejects.toMatchObject({ status: 403 });
  });

  it('denies another supplier, unreleased problems and internal impersonation of a supplier reply', async () => {
    const context = await fixture();
    const other = await identity('SUPPLIER');
    await expect(submit(context.action(context.started, other.actor))).rejects.toMatchObject({ status: 403 });
    await expect(submit(context.action(context.started, context.owner.actor))).rejects.toMatchObject({ status: 403 });
    await prisma.supplierQualityProblem.update({ where: { id: context.record.id }, data: { releasedToSupplierAt: null } });
    await expect(submit(context.action())).rejects.toMatchObject({ status: 403 });
  });

  it('never permits supplier verification or closing even with matching feature permissions', async () => {
    const context = await fixture();
    const next = await submit(context.action());
    await expect(submit(context.action(next, context.supplier.actor, 'VERIFY'))).rejects.toMatchObject({ status: 403 });
    const verified = await submit(context.action(next, context.owner.actor, 'VERIFY'));
    await expect(submit(context.action(verified, context.supplier.actor, 'CLOSE'))).rejects.toMatchObject({ status: 403 });
    await expect(submit(context.action(verified, context.owner.actor, 'CLOSE'))).rejects.toMatchObject({ status: 403 });
    const closer = await identity('INTERNAL', context.owner.actor.organizationId);
    expect((await submit(context.action(verified, closer.actor, 'CLOSE'))).status).toBe('COMPLETED');
  });

  it('replays after the node changes without rerunning domain mutation, and rejects altered content', async () => {
    const context = await fixture();
    const input = context.action();
    const mutate: Mutation = async (tx) => { await tx.supplierQualityProblem.update({ where: { id: context.record.id }, data: { version: { increment: 1 } } }); };
    const first = await submit(input, mutate);
    expect(await submit({ ...input, traceId: randomUUID() }, mutate)).toEqual(first);
    expect((await prisma.supplierQualityProblem.findUniqueOrThrow({ where: { id: context.record.id } })).version).toBe(2);
    await expect(submit({ ...input, commandPayload: { expectedDomainVersion: 2 } })).rejects.toMatchObject({ status: 409, response: { code: 'IDEMPOTENCY_REPLAY' } });
  });

  it.each(['workflow:act', 'supplier-quality:responses:write'])('rejects replay after %s is revoked', async (code) => {
    const context = await fixture();
    const input = context.action();
    await submit(input);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: context.supplier.role.id, permissionId: permission.id } } });
    await expect(submit(input)).rejects.toMatchObject({ status: 403 });
  });

  it('checks current session on first execution and replay', async () => {
    const context = await fixture();
    const input = context.action();
    await expect(submit({ ...input, actor: { ...input.actor, sessionId: undefined } })).rejects.toMatchObject({ status: 401 });
    await submit(input);
    await prisma.session.update({ where: { id: context.supplier.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(submit(input)).rejects.toMatchObject({ status: 401 });
  });

  it('retains node assignment constraints in the supplier organization', async () => {
    const context = await fixture();
    const coworker = await identity('SUPPLIER', context.supplier.actor.organizationId);
    await expect(submit(context.action(context.started, coworker.actor))).rejects.toMatchObject({ status: 403 });
    await prisma.userRole.create({ data: { userId: coworker.actor.id, roleId: context.supplier.role.id, organizationId: context.supplier.actor.organizationId } });
    expect((await submit(context.action(context.started, coworker.actor))).version).toBe(2);
  });

  it('uses the designated internal responder for internal reply mode', async () => {
    const context = await fixture('INTERNAL');
    await expect(submit(context.action(context.started, context.owner.actor))).rejects.toMatchObject({ status: 403 });
    await expect(submit(context.action(context.started, context.supplier.actor))).rejects.toMatchObject({ status: 403 });
    expect((await submit(context.action())).version).toBe(2);
  });

  it('rolls back domain and workflow changes on failure, then supports a same-key retry', async () => {
    const context = await fixture();
    const input = context.action();
    await expect(submit(input, async (tx) => {
      await tx.supplierQualityProblem.update({ where: { id: context.record.id }, data: { version: { increment: 1 } } });
      throw new Error('injected domain failure');
    })).rejects.toThrow('injected domain failure');
    expect((await prisma.supplierQualityProblem.findUniqueOrThrow({ where: { id: context.record.id } })).version).toBe(1);
    expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: context.started.instanceId } })).version).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { eventKey: `workflow:${context.started.instanceId}:2` } })).toBe(0);
    expect((await submit(input)).version).toBe(2);
  });

  it('permits only one of two concurrent distinct commands for the same version', async () => {
    const context = await fixture();
    const results = await Promise.allSettled([submit(context.action()), submit(context.action())]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409, response: { code: 'CONCURRENCY_CONFLICT' } });
  });

  it('rolls back facts, index, audit, runtime and receipt when the Outbox write fails', async () => {
    const context = await fixture();
    const input = context.action();
    const fail = jest.spyOn(app.get(OutboxService), 'enqueue').mockRejectedValueOnce(new Error('injected outbox failure'));
    try {
      await expect(submit(input, async (tx) => {
        await tx.supplierQualityProblem.update({ where: { id: context.record.id }, data: { version: { increment: 1 } } });
      })).rejects.toThrow('injected outbox failure');
    } finally { fail.mockRestore(); }
    expect((await prisma.supplierQualityProblem.findUniqueOrThrow({ where: { id: context.record.id } })).version).toBe(1);
    expect((await prisma.problemIndex.findUniqueOrThrow({ where: { id: context.index.id } })).version).toBe(2);
    expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: context.started.instanceId } })).version).toBe(1);
    expect(await prisma.auditEvent.count({ where: { resourceId: context.started.instanceId, action: 'WORKFLOW_ACTION_COMPLETED' } })).toBe(0);
    expect(await prisma.workflowMutation.count({ where: { instanceId: context.started.instanceId, instanceVersion: 2 } })).toBe(0);
    expect((await submit(input)).version).toBe(2);
  });

  it.each([false, true])('rechecks session after participant lock acquisition (replay=%s)', async (replay) => {
    const context = await fixture();
    const input = context.action();
    if (replay) await submit(input);
    const access = participant();
    const lock = jest.spyOn(access, 'lock').mockImplementationOnce(async (tx, command) => {
      await SupplierWorkflowAccess.prototype.lock.call(access, tx, command);
      await prisma.$transaction(async (other) => {
        await other.$executeRawUnsafe("SET LOCAL lock_timeout = '500ms'");
        await other.session.update({ where: { id: context.supplier.actor.sessionId }, data: { revokedAt: new Date() } });
      });
    });
    try { await expect(submit(input)).rejects.toMatchObject({ status: 401 }); }
    finally { lock.mockRestore(); }
    expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: context.started.instanceId } })).version).toBe(replay ? 2 : 1);
  });

  it('rejects a release revoked while waiting for the domain row without locking the actor first', async () => {
    const context = await fixture();
    const access = participant();
    let ready!: () => void;
    let requested!: () => void;
    const locked = new Promise<void>((resolve) => { ready = resolve; });
    const waiting = new Promise<void>((resolve) => { requested = resolve; });
    const writer = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM supplier_quality_problems WHERE id = ${context.record.id}::uuid FOR UPDATE`;
      ready();
      await waiting;
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${context.supplier.actor.id}::uuid FOR UPDATE NOWAIT`;
      await tx.supplierQualityProblem.update({ where: { id: context.record.id }, data: { releasedToSupplierAt: null } });
    }, { timeout: 10000 }).then(() => ({ ok: true }), (error: unknown) => ({ error }));
    await locked;
    const lock = jest.spyOn(access, 'lock').mockImplementationOnce(async (tx, command) => {
      requested();
      await SupplierWorkflowAccess.prototype.lock.call(access, tx, command);
    });
    try { await expect(submit(context.action())).rejects.toMatchObject({ status: 403 }); }
    finally { requested(); lock.mockRestore(); }
    expect(await writer).toEqual({ ok: true });
    expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: context.started.instanceId } })).version).toBe(1);
  });

  it('denies forged scope, detached domain references and disabled owning organizations', async () => {
    const context = await fixture();
    await expect(submit({ ...context.action(), actor: { ...context.supplier.actor, organizationId: context.owner.actor.organizationId } })).rejects.toMatchObject({ status: 401 });
    await prisma.supplierQualityProblem.update({ where: { id: context.record.id }, data: { problemIndexId: null, releasedToSupplierAt: null } });
    await expect(submit(context.action())).rejects.toMatchObject({ status: 404 });
    await prisma.supplierQualityProblem.update({ where: { id: context.record.id }, data: { problemIndexId: context.index.id, releasedToSupplierAt: new Date() } });
    await prisma.organization.update({ where: { id: context.owner.actor.organizationId }, data: { status: 'DISABLED' } });
    await expect(submit(context.action())).rejects.toMatchObject({ status: 403 });
  });

  it('executes inside a caller ReadCommitted transaction and obeys outer rollback', async () => {
    const context = await fixture();
    const input = context.action();
    await expect(prisma.$transaction(async (tx) => {
      await runtime.submitAction(input, tx, undefined, undefined, participant());
      throw new Error('outer rollback');
    }, { isolationLevel: 'ReadCommitted' })).rejects.toThrow('outer rollback');
    expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: context.started.instanceId } })).version).toBe(1);
    await expect(prisma.$transaction((tx) => runtime.submitAction(input, tx, undefined, undefined, participant()), { isolationLevel: 'Serializable' }))
      .rejects.toMatchObject({ status: 409, response: { code: 'WORKFLOW_TRANSACTION_ISOLATION_UNSUPPORTED' } });
    expect((await submit(input)).version).toBe(2);
  });

  it('fails closed when a published close node does not require independent verification', async () => {
    const context = await fixture('SUPPLIER', false);
    const replied = await submit(context.action());
    const verified = await submit(context.action(replied, context.owner.actor, 'VERIFY'));
    await expect(submit(context.action(verified, context.owner.actor, 'CLOSE'))).rejects.toMatchObject({ status: 403, response: { code: 'WORKFLOW_INDEPENDENT_VERIFICATION_REQUIRED' } });
    expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: context.started.instanceId } })).status).toBe('RUNNING');
  });

  it('returns retryable 409 for a real domain/authentication lock cycle and preserves rollback', async () => {
    const context = await fixture();
    const access = participant();
    let ready!: () => void;
    let domainLocked!: () => void;
    const userLocked = new Promise<void>((resolve) => { ready = resolve; });
    const domainReady = new Promise<void>((resolve) => { domainLocked = resolve; });
    // Existing draft mutations lock actor before domain. Runtime must turn PostgreSQL's deadlock victim into 409.
    const draftWriter = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL deadlock_timeout = '5s'");
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${context.supplier.actor.id}::uuid FOR UPDATE`;
      ready();
      await domainReady;
      await tx.supplierQualityProblem.update({ where: { id: context.record.id }, data: { version: { increment: 1 } } });
    }, { timeout: 10000 }).then(() => ({ ok: true }), (error: unknown) => ({ error }));
    await userLocked;
    const lock = jest.spyOn(access, 'lock').mockImplementationOnce(async (tx, command) => {
      await tx.$executeRawUnsafe("SET LOCAL deadlock_timeout = '50ms'");
      await SupplierWorkflowAccess.prototype.lock.call(access, tx, command);
      domainLocked();
    });
    const input = context.action();
    try { await expect(submit(input)).rejects.toMatchObject({ status: 409, response: { code: 'CONCURRENCY_CONFLICT' } }); }
    finally { domainLocked(); lock.mockRestore(); await draftWriter; }
    expect(await draftWriter).toEqual({ ok: true });
    expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: context.started.instanceId } })).version).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { eventKey: `workflow:${context.started.instanceId}:2` } })).toBe(0);
    expect((await submit(input)).version).toBe(2);
  });
});
