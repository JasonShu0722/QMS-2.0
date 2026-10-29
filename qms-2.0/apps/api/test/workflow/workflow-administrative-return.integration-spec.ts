import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { WorkflowRuntimeService } from '../../src/modules/workflow/workflow-runtime.service.js';
import type { WorkflowAdministrativeReturnInput } from '../../src/modules/workflow/workflow-administrative-return.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import { createWorkflowClosureFixture } from './workflow-closure-round.fixture.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Explicit disposable loopback PostgreSQL required; never preview 55440.');
}

describe('workflow administrative return / exclusive real PostgreSQL', () => {
  let app: INestApplication, db: PrismaService, runtime: WorkflowRuntimeService;
  let admin: Awaited<ReturnType<typeof createWorkflowClosureFixture>>;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init(); db = app.get(PrismaService); runtime = app.get(WorkflowRuntimeService);
    admin = await createWorkflowClosureFixture(db, app.get(WorkflowClosureRoundService));
    await db.rolePermission.create({ data: { roleId: admin.role.id,
      permissionId: (await db.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } })).id } });
  }, 120_000);
  afterAll(() => app?.close());

  async function fixture() {
    const f = await createWorkflowClosureFixture(db, app.get(WorkflowClosureRoundService));
    await db.problemIndex.update({ where: { id: f.problem.id }, data: { domainCode: 'process-quality', status: 'PENDING' } });
    await db.workflowNode.update({ where: { id: f.node.id }, data: {
      config: { closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'process-quality' } },
    } });
    const owner = await db.workflowNode.create({ data: { organizationId: f.org.id, workflowVersionId: f.instance.workflowVersionId,
      nodeKey: 'owner', type: 'ACTION', name: 'Controlled owner', config: { isStart: true,
        processEightD: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: 24 } } } });
    const transition = await db.workflowTransition.create({ data: { organizationId: f.org.id, workflowVersionId: f.instance.workflowVersionId,
      fromNodeId: f.node.id, toNodeId: owner.id, action: 'RETURN', transitionKey: 'administrative-owner' } });
    const input: WorkflowAdministrativeReturnInput = { orgId: f.org.id, problemId: f.problem.id,
      actorUserId: admin.owner.user.id, expectedInstanceId: f.instance.id, expectedInstanceVersion: 1, reason: 'ADMINISTRATIVE_USER_DELETED' };
    const context = { organizationId: f.org.id, problemId: f.problem.id, instanceId: f.instance.id,
      currentNodeId: f.node.id, workflowVersionId: f.instance.workflowVersionId, instanceVersion: 1,
      endedBy: admin.owner.user.id, endReason: input.reason };
    const roundId = randomUUID();
    await db.$executeRaw`INSERT INTO workflow_closure_rounds
      (id,organization_id,problem_id,instance_id,workflow_version_id,node_id,content_version,content_snapshot,context,round_number,status,version,created_by,creator_organization_id)
      VALUES (${roundId}::uuid,${f.org.id}::uuid,${f.problem.id}::uuid,${f.instance.id}::uuid,${f.instance.workflowVersionId}::uuid,
        ${f.node.id}::uuid,1,'{}'::jsonb,${JSON.stringify(context)}::jsonb,1,'CANCELLED',2,${f.owner.user.id}::uuid,${f.org.id}::uuid)`;
    return { ...f, ownerNode: owner, transition, roundId, input, context };
  }
  const run = (input: WorkflowAdministrativeReturnInput) => db.$transaction(tx => runtime.administrativeReturn(tx, input), { timeout: 30_000 });
  async function snapshot(f: Awaited<ReturnType<typeof fixture>>) {
    return {
      instance: await db.workflowInstance.findUniqueOrThrow({ where: { id: f.instance.id } }),
      problem: await db.problemIndex.findUniqueOrThrow({ where: { id: f.problem.id } }),
      rounds: await db.$queryRaw`SELECT * FROM workflow_closure_rounds WHERE problem_id=${f.problem.id}::uuid ORDER BY round_number`,
      receipts: await db.workflowMutation.findMany({ where: { instanceId: f.instance.id } }),
      events: await db.outboxEvent.findMany({ where: { aggregateId: f.instance.id } }),
      tasks: await db.workflowTask.findMany({ where: { workflowInstanceId: f.instance.id } }),
    };
  }

  it('uses the real cross-org marker, owner CAS/public ProblemIndex, admin-only receipt/audit and no ordinary RETURN event', async () => {
    const f = await fixture(), before = await snapshot(f);
    expect(admin.org.id).not.toBe(f.org.id);
    expect(await run(f.input)).toBe(2);
    const after = await snapshot(f);
    expect(after.instance).toMatchObject({ currentNodeId: f.ownerNode.id, version: 2, taskProjectionVersion: 2, updatedById: admin.owner.user.id });
    expect(after.problem).toMatchObject({ status: 'IN_PROGRESS', version: before.problem.version + 1, updatedById: admin.owner.user.id });
    expect(after.receipts).toHaveLength(1);
    expect(after.receipts[0]).toMatchObject({ action: 'RETURN', key: `admin-return:${f.roundId}:1`, actorUserId: admin.owner.user.id,
      instanceVersion: 2, response: { administrative: true, reason: f.input.reason, cancelledRoundId: f.roundId } });
    expect(after.rounds).toEqual(before.rounds);
    expect(after.events).toEqual(before.events);
    expect(await db.auditEvent.count({ where: { resourceId: f.instance.id, action: 'WORKFLOW_ADMINISTRATIVELY_RETURNED', actorUserId: admin.owner.user.id } })).toBe(1);
    await expect(run(f.input)).rejects.toMatchObject({ status: 409 });
    expect(await snapshot(f)).toEqual(after);
  });

  it('rejects a real ordinary actor with no platform marker without writing anything', async () => {
    const f = await fixture(), before = await snapshot(f);
    await expect(run({ ...f.input, actorUserId: f.owner.user.id })).rejects.toMatchObject({ status: 403 });
    expect(await snapshot(f)).toEqual(before);
  });

  it('silently retires a leftover generic task and advances projection so the next real business event cannot be deferred forever', async () => {
    const f = await fixture();
    const task = await db.workflowTask.create({ data: { organizationId: f.org.id, workflowInstanceId: f.instance.id,
      workflowVersionId: f.instance.workflowVersionId, workflowNodeId: f.node.id, entryInstanceVersion: 1 } });
    expect(await run(f.input)).toBe(2);
    expect(await db.workflowTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: 'COMPLETED', version: 2 });
    expect((await snapshot(f)).instance.taskProjectionVersion).toBe(2);
  });

  it('rejects a removed real platform marker source rather than inheriting its role name', async () => {
    const f = await fixture();
    const permission = await db.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
    const marker = await db.rolePermission.create({ data: { roleId: f.role.id, permissionId: permission.id } });
    await db.rolePermission.delete({ where: { roleId_permissionId: { roleId: marker.roleId, permissionId: marker.permissionId } } });
    const before = await snapshot(f);
    await expect(run({ ...f.input, actorUserId: f.owner.user.id })).rejects.toMatchObject({ status: 403 });
    expect(await snapshot(f)).toEqual(before);
  });

  it.each(['endedBy', 'endReason', 'instanceVersion', 'organizationId', 'problemId', 'instanceId', 'currentNodeId', 'workflowVersionId'])('rejects mismatched cancelled-round context %s', async field => {
    const f = await fixture();
    await db.$executeRaw`UPDATE workflow_closure_rounds SET context=context || ${JSON.stringify({ [field]: field === 'instanceVersion' ? 2 : randomUUID() })}::jsonb WHERE id=${f.roundId}::uuid`;
    const before = await snapshot(f);
    await expect(run(f.input)).rejects.toMatchObject({ status: 409 });
    expect(await snapshot(f)).toEqual(before);
  });

  it.each(['PENDING', 'APPROVED', 'RETURNED'])('does not reuse an older CANCELLED round when the latest is %s', async status => {
    const f = await fixture();
    await db.$executeRaw`INSERT INTO workflow_closure_rounds
      (id,organization_id,problem_id,instance_id,workflow_version_id,node_id,content_version,content_snapshot,context,round_number,status,created_by,creator_organization_id)
      SELECT ${randomUUID()}::uuid,organization_id,problem_id,instance_id,workflow_version_id,node_id,content_version,content_snapshot,context,2,${status},created_by,creator_organization_id
      FROM workflow_closure_rounds WHERE id=${f.roundId}::uuid`;
    const before = await snapshot(f);
    await expect(run(f.input)).rejects.toMatchObject({ status: 409 });
    expect(await snapshot(f)).toEqual(before);
  });

  it('never changes an already closed problem/instance', async () => {
    const f = await fixture();
    await db.workflowInstance.update({ where: { id: f.instance.id }, data: { status: 'COMPLETED' } });
    await db.problemIndex.update({ where: { id: f.problem.id }, data: { status: 'CLOSED', closedAt: new Date() } });
    const before = await snapshot(f);
    await expect(run(f.input)).rejects.toMatchObject({ status: 409 });
    expect(await snapshot(f)).toEqual(before);
  });

  it('requires the expected instance and version', async () => {
    const f = await fixture(), before = await snapshot(f);
    await expect(run({ ...f.input, expectedInstanceId: randomUUID() })).rejects.toMatchObject({ status: 409 });
    await expect(run({ ...f.input, expectedInstanceVersion: 2 })).rejects.toMatchObject({ status: 409 });
    expect(await snapshot(f)).toEqual(before);
  });

  it('evaluates RETURN conditions and requires exactly one matching controlled owner edge', async () => {
    const f = await fixture();
    await db.workflowTransition.update({ where: { id: f.transition.id }, data: { condition: { field: 'severity', operator: 'eq', value: 'CRITICAL' } } });
    const before = await snapshot(f);
    await expect(run(f.input)).rejects.toMatchObject({ status: 409 });
    expect(await snapshot(f)).toEqual(before);
    await db.workflowTransition.create({ data: { organizationId: f.org.id, workflowVersionId: f.instance.workflowVersionId,
      fromNodeId: f.node.id, toNodeId: f.ownerNode.id, action: 'RETURN', transitionKey: 'only-matching', condition: { field: 'severity', operator: 'eq', value: f.problem.severity } } });
    expect(await run(f.input)).toBe(2);
  });

  it('keeps all writes inside the supplied transaction', async () => {
    const f = await fixture(), before = await snapshot(f);
    await expect(db.$transaction(async tx => {
      await runtime.administrativeReturn(tx, f.input);
      throw new Error('domain audit failure');
    })).rejects.toThrow('domain audit failure');
    expect(await snapshot(f)).toEqual(before);
    expect(await db.auditEvent.count({ where: { resourceId: f.instance.id, action: 'WORKFLOW_ADMINISTRATIVELY_RETURNED' } })).toBe(0);
  });

  it('serializes competing same-version administrative returns with one winner', async () => {
    const f = await fixture(), results = await Promise.allSettled([run(f.input), run(f.input)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await snapshot(f)).receipts).toHaveLength(1);
  });
});
