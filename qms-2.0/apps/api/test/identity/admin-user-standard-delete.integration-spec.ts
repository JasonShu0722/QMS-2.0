import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('User deletion tests require disposable loopback PostgreSQL.');
}

function signal<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(done => { resolve = done; });
  return { promise, resolve };
}

describe('standard user deletion through the real lifecycle registry', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  const csrf = randomUUID();

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    sessions = app.get(SessionService);
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  async function fixture(reauthenticated = true) {
    const org = await prisma.organization.create({ data: { type: 'INTERNAL', code: randomUUID(), name: 'User deletion fixture' } });
    const person = () => prisma.user.create({ data: { organizationId: org.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'fixture' } });
    const actor = await person();
    const target = await person();
    const marker = await prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
    const role = await prisma.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Lifecycle administrator', permissions: { create: { permissionId: marker.id } } } });
    await prisma.userRole.create({ data: { organizationId: org.id, userId: actor.id, roleId: role.id } });
    const token = await sessions.create(actor.id, prisma, { mfaVerified: true, reauthenticated });
    const remove = (mode?: string, key = randomUUID(), subject = target) => request(app.getHttpServer()).delete(`/api/v1/admin/users/${subject.id}`)
      .set('Cookie', `qms_session=${token}; qms_csrf=${csrf}`).set('x-csrf-token', csrf).set('Idempotency-Key', key)
      .send({ expectedSecurityVersion: subject.securityVersion, mode });
    return { org, actor, target, remove, person, role };
  }

  async function appointment(organizationId: string, userId: string) {
    const department = await prisma.department.create({ data: { organizationId, name: 'Quality', code: randomUUID() } });
    const position = await prisma.position.create({ data: { organizationId, departmentId: department.id, name: 'Engineer', code: randomUUID() } });
    const assignment = await prisma.userPosition.create({ data: { organizationId, userId, positionId: position.id, startedAt: new Date() } });
    return { department, assignment };
  }

  async function waitForBlockedTransaction(blocker: number) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [waiting] = await prisma.$queryRaw<{ pid: number }[]>`
        SELECT pid FROM pg_stat_activity WHERE ${blocker} = ANY(pg_blocking_pids(pid))`;
      if (waiting) return waiting.pid;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Expected PostgreSQL lock wait was not observed');
  }

  it('blocks on a nullable project reference without modifying it and lets explicit force clear it', async () => {
    const { actor, org, target, remove } = await fixture();
    const { assignment } = await appointment(org.id, target.id);
    const targetToken = await sessions.create(target.id, prisma, { mfaVerified: true });
    const projectId = randomUUID();
    await prisma.$executeRaw`INSERT INTO component_project_records (id, organization_id, code, name, stage, customer_engineer_assignment_id, created_by_user_id, updated_by_user_id)
      VALUES (${projectId}::uuid, ${org.id}::uuid, ${randomUUID()}, 'Current configuration', 'NEW_PRODUCT', ${assignment.id}::uuid, ${actor.id}::uuid, ${actor.id}::uuid)`;
    const project = () => prisma.$queryRaw`SELECT version, customer_engineer_assignment_id FROM component_project_records WHERE id = ${projectId}::uuid`;
    const key = randomUUID();
    expect((await remove('STANDARD', key).expect(409)).body.code).toBe('ADMIN_USER_ACTIVE_REFERENCES');
    expect(await project()).toEqual([{ version: 1, customer_engineer_assignment_id: assignment.id }]);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toEqual(target);
    expect(await prisma.userPosition.findUniqueOrThrow({ where: { id: assignment.id } })).toEqual(assignment);
    expect(await sessions.resolve(targetToken)).not.toBeNull();
    expect(await prisma.adminMutation.count({ where: { actorUserId: actor.id, key } })).toBe(0);
    expect(await prisma.auditEvent.findFirstOrThrow({ where: { actorUserId: actor.id, action: 'ACTION_REJECTED', outcome: 'DENIED' } }))
      .toMatchObject({ metadata: { reasonCode: 'ADMIN_USER_ACTIVE_REFERENCES' } });

    expect((await remove('FORCE').expect(200)).body).toMatchObject({ userId: target.id, deleted: true,
      effects: expect.arrayContaining([{ module: 'platform-configuration', changed: 1, pendingConfiguration: 1 }]) });
    expect(await project()).toEqual([{ version: 2, customer_engineer_assignment_id: null }]);
    expect(await sessions.resolve(targetToken)).toBeNull();
  });

  it('blocks on a department responsibility without ending the underlying appointment', async () => {
    const { org, target, remove } = await fixture();
    const { department, assignment } = await appointment(org.id, target.id);
    await prisma.$executeRaw`INSERT INTO department_responsible_appointments (organization_id, department_id, assignment_ids, primary_assignment_id, version)
      VALUES (${org.id}::uuid, ${department.id}::uuid, ARRAY[${assignment.id}::uuid], ${assignment.id}::uuid, 1)`;
    const configuration = () => prisma.$queryRaw`SELECT assignment_ids, primary_assignment_id, version FROM department_responsible_appointments
      WHERE organization_id = ${org.id}::uuid AND department_id = ${department.id}::uuid`;

    expect((await remove('STANDARD').expect(409)).body.code).toBe('ADMIN_USER_ACTIVE_REFERENCES');
    expect(await configuration()).toEqual([{ assignment_ids: [assignment.id], primary_assignment_id: assignment.id, version: 1 }]);
    expect(await prisma.userPosition.findUniqueOrThrow({ where: { id: assignment.id } })).toEqual(assignment);
  });

  it('blocks on a live workflow assignment and preserves the same reference once completed', async () => {
    const { org, target, remove } = await fixture();
    const organizationId = org.id;
    const definition = await prisma.workflowDefinition.create({ data: { organizationId, code: randomUUID(), name: 'User deletion workflow fixture' } });
    const version = await prisma.workflowVersion.create({ data: { organizationId, workflowDefinitionId: definition.id, version: 1, status: 'PUBLISHED' } });
    const node = await prisma.workflowNode.create({ data: { organizationId, workflowVersionId: version.id, nodeKey: 'assigned', name: 'Assigned', type: 'ACTION' } });
    const instance = await prisma.workflowInstance.create({ data: { organizationId, workflowDefinitionId: definition.id, workflowVersionId: version.id, instanceKey: randomUUID(), status: 'RUNNING' } });
    const task = await prisma.workflowTask.create({ data: { organizationId, workflowInstanceId: instance.id, workflowVersionId: version.id, workflowNodeId: node.id, assigneeUserId: target.id } });

    expect((await remove('STANDARD').expect(409)).body.code).toBe('ADMIN_USER_ACTIVE_REFERENCES');
    expect(await prisma.workflowTask.findUniqueOrThrow({ where: { id: task.id } })).toEqual(task);

    const completed = await prisma.workflowTask.update({ where: { id: task.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    await prisma.workflowInstance.update({ where: { id: instance.id }, data: { status: 'COMPLETED' } });
    await remove('STANDARD').expect(200);
    expect(await prisma.workflowTask.findUniqueOrThrow({ where: { id: task.id } })).toEqual(completed);
  });

  it('retires a user with only historical references and binds replay to the deletion mode', async () => {
    const { org, target, remove } = await fixture();
    const history = await prisma.auditEvent.create({ data: { actorUserId: target.id, organizationId: org.id, action: 'HISTORICAL_ACTION', resourceType: 'User', outcome: 'SUCCESS', traceId: randomUUID() } });
    const key = randomUUID();
    const first = await remove('STANDARD', key).expect(200);
    expect(first.body).toMatchObject({ userId: target.id, deleted: true });
    expect((await remove('STANDARD', key).expect(200)).body).toEqual(first.body);
    expect((await remove('FORCE', key).expect(409)).body.code).toBe('IDEMPOTENCY_REPLAY');
    expect(await prisma.auditEvent.count({ where: { resourceId: target.id, action: 'USER_DELETED' } })).toBe(1);
    expect(await prisma.auditEvent.findUniqueOrThrow({ where: { id: history.id } })).toEqual(history);
  });

  it('keeps omitted mode and explicit FORCE in the same idempotency namespace', async () => {
    const { target, remove } = await fixture();
    await remove('unknown').expect(400);
    const key = randomUUID();
    const first = await remove(undefined, key).expect(200);
    expect(first.body).toMatchObject({ userId: target.id, deleted: true });
    expect((await remove('FORCE', key).expect(200)).body).toEqual(first.body);
  });

  it('preserves the self-deletion protection in standard mode', async () => {
    const { actor, remove } = await fixture();
    expect((await remove('STANDARD', randomUUID(), actor).expect(409)).body.code).toBe('ADMIN_SELF_LOCK_FORBIDDEN');
    expect(await prisma.user.findUniqueOrThrow({ where: { id: actor.id } })).toEqual(actor);
  });

  it('requires recent authentication before standard deletion', async () => {
    const { target, remove } = await fixture(false);
    expect((await remove('STANDARD').expect(403)).body.code).toBe('AUTH_REAUTHENTICATION_REQUIRED');
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toEqual(target);
  });

  async function workflowFixture() {
    const context = await fixture();
    const editor = await context.person();
    await prisma.userRole.create({ data: { organizationId: context.org.id, userId: editor.id, roleId: context.role.id } });
    const token = await sessions.create(editor.id, prisma, { mfaVerified: true, reauthenticated: true });
    const path = '/api/v1/workflows';
    const authorize = (command: request.Test) => command.set('Cookie', `qms_session=${token}; qms_csrf=${csrf}`).set('x-csrf-token', csrf);
    const code = randomUUID();
    const graph = (assigneeUserId?: string, escalation = false) => ({
      nodes: [
        { id: 'handle', type: 'ACTION', name: 'Handle', config: { isStart: true,
          assignment: assigneeUserId && !escalation ? { assigneeUserId } : { permission: 'workflow:act' },
          ...(assigneeUserId && escalation ? { slaMinutes: 60, escalation: { assigneeUserId } } : {}) } },
        { id: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, assignment: { permission: 'workflow:act' } } },
      ],
      transitions: [{ id: 'finish', from: 'handle', to: 'close', action: 'SUBMIT' }],
    });
    const create = (assigneeUserId?: string) => authorize(request(app.getHttpServer()).post(path)).send({ code, name: 'Workflow race', ...graph(assigneeUserId) });
    const update = (id: string, versionId: string, revision: number, assigneeUserId: string) => authorize(request(app.getHttpServer()).patch(`${path}/${id}/draft`))
      .send({ draftVersionId: versionId, expectedRevision: revision, ...graph(assigneeUserId, true) });
    return { ...context, path, authorize, code, create, update };
  }

  it.each(['create', 'update'] as const)('fences workflow draft %s while standard deletion holds the user', async operation => {
    const { org, target, remove, code, create, update } = await workflowFixture();
    const previous = operation === 'update' ? (await create().expect(201)).body : null;
    const snapshot = () => prisma.workflowDefinition.findFirst({ where: { organizationId: org.id, code }, include: { versions: { include: { nodes: true, transitions: true } } } });
    const original = await snapshot();
    const held = signal<number>(), release = signal<void>();
    const gate = prisma.$transaction(async tx => {
      await tx.$executeRaw`LOCK TABLE admin_mutations IN SHARE MODE`;
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      held.resolve(backend!.pid);
      await release.promise;
    });
    const gatePid = await held.promise;
    const deletion = remove('STANDARD').then(response => response);
    let writing: ReturnType<typeof deletion> | undefined;
    try {
      const deleterPid = await waitForBlockedTransaction(gatePid);
      writing = (previous ? update(previous.id, previous.version.id, previous.revision, target.id) : create(target.id)).then(response => response);
      await waitForBlockedTransaction(deleterPid);
    } finally {
      release.resolve();
      await gate;
      await deletion;
      await writing;
    }
    expect((await deletion).status).toBe(200);
    expect(await writing).toMatchObject({ status: 409, body: { code: 'WORKFLOW_DRAFT_INVALID' } });
    expect(await snapshot()).toEqual(original);
  }, 15_000);

  it('blocks on a committed draft escalation even when a legacy graph stored uppercase UUIDs', async () => {
    const { target, remove, create, update } = await workflowFixture();
    const { body } = await create().expect(201);
    await update(body.id, body.version.id, body.revision, target.id).expect(200);
    await prisma.$executeRaw`UPDATE workflow_nodes SET config = jsonb_set(config, '{escalation,assigneeUserId}', to_jsonb(${target.id.toUpperCase()}::text))
      WHERE workflow_version_id = ${body.version.id}::uuid AND node_key = 'handle'`;
    expect((await remove('STANDARD').expect(409)).body.code).toBe('ADMIN_USER_ACTIVE_REFERENCES');
  });

  it('rechecks current workflow references after waiting for a draft writer to commit', async () => {
    const { target, remove, create } = await workflowFixture();
    const held = signal<number>(), release = signal<void>();
    const gate = prisma.$transaction(async tx => {
      await tx.$executeRaw`LOCK TABLE audit_events IN SHARE MODE`;
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      held.resolve(backend!.pid);
      await release.promise;
    });
    const gatePid = await held.promise;
    const writing = create(target.id).then(response => response);
    let deletion: ReturnType<typeof writing> | undefined;
    try {
      const writerPid = await waitForBlockedTransaction(gatePid);
      deletion = remove('STANDARD').then(response => response);
      await waitForBlockedTransaction(writerPid);
    } finally {
      release.resolve();
      await gate;
      await writing;
      await deletion;
    }
    expect((await writing).status).toBe(201);
    expect(await deletion).toMatchObject({ status: 409, body: { code: 'ADMIN_USER_ACTIVE_REFERENCES' } });
  }, 15_000);

  it('prevents publishing a copied direct assignment to a retired user', async () => {
    const { target, remove, create, path, authorize } = await workflowFixture();
    const { body } = await create(target.id).expect(201);
    const { body: published } = await authorize(request(app.getHttpServer()).post(`${path}/${body.id}/publish`))
      .send({ draftVersionId: body.version.id, expectedRevision: body.revision }).expect(201);
    await remove('FORCE').expect(200);
    const { body: copied } = await authorize(request(app.getHttpServer()).post(`${path}/${body.id}/copy`))
      .send({ sourceVersionId: published.version.id, expectedRevision: published.revision }).expect(201);
    expect((await authorize(request(app.getHttpServer()).post(`${path}/${body.id}/publish`))
      .send({ draftVersionId: copied.version.id, expectedRevision: copied.revision }).expect(409)).body.code).toBe('WORKFLOW_DRAFT_INVALID');
    expect(await prisma.workflowVersion.count({ where: { workflowDefinitionId: body.id, status: 'PUBLISHED' } })).toBe(1);
  });

  it('rejects transferring a task to a concurrently retired user', async () => {
    const { org, target, remove, create, path, authorize } = await workflowFixture();
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'workflow:act' } });
    const role = await prisma.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Task participant', permissions: { create: { permissionId: permission.id } } } });
    await prisma.userRole.create({ data: { organizationId: org.id, userId: target.id, roleId: role.id } });
    const { body } = await create().expect(201);
    await authorize(request(app.getHttpServer()).post(`${path}/${body.id}/publish`))
      .send({ draftVersionId: body.version.id, expectedRevision: body.revision }).expect(201);
    const node = await prisma.workflowNode.findFirstOrThrow({ where: { workflowVersionId: body.version.id, nodeKey: 'handle' } });
    const problem = await prisma.problemIndex.create({ data: { organizationId: org.id, reportNumber: randomUUID(), domainCode: 'test', problemType: 'test', sourceType: 'test', severity: 'LOW' } });
    const instance = await prisma.workflowInstance.create({ data: { organizationId: org.id, problemIndexId: problem.id,
      workflowDefinitionId: body.id, workflowVersionId: body.version.id, instanceKey: randomUUID(), currentNodeId: node.id } });
    await prisma.problemIndex.update({ where: { id: problem.id }, data: { workflowInstanceId: instance.id } });
    const task = await prisma.workflowTask.create({ data: { organizationId: org.id, workflowInstanceId: instance.id,
      workflowVersionId: body.version.id, workflowNodeId: node.id, entryInstanceVersion: instance.version } });
    const held = signal<number>(), release = signal<void>();
    const gate = prisma.$transaction(async tx => {
      await tx.$executeRaw`LOCK TABLE admin_mutations IN SHARE MODE`;
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      held.resolve(backend!.pid);
      await release.promise;
    });
    const gatePid = await held.promise;
    const deletion = remove('STANDARD').then(response => response);
    let writing: ReturnType<typeof deletion> | undefined;
    try {
      const deleterPid = await waitForBlockedTransaction(gatePid);
      writing = authorize(request(app.getHttpServer()).post('/api/v1/tasks/transfer')).set('Idempotency-Key', randomUUID())
        .send({ items: [{ id: task.id, expectedVersion: task.version }], assigneeUserId: target.id }).then(response => response);
      await waitForBlockedTransaction(deleterPid);
    } finally {
      release.resolve();
      await gate;
      await deletion;
      await writing;
    }
    expect((await deletion).status).toBe(200);
    expect(await writing).toMatchObject({ status: 409 });
    expect(await prisma.workflowTask.findUniqueOrThrow({ where: { id: task.id } })).toEqual(task);
  }, 15_000);

  it.each(['create', 'bulk apply'] as const)('fences project %s while standard deletion holds the target user', async path => {
    const { org, target, remove, person, role } = await fixture();
    const { assignment } = await appointment(org.id, target.id);
    const editor = await person();
    await prisma.userRole.create({ data: { organizationId: org.id, userId: editor.id, roleId: role.id } });
    const token = await sessions.create(editor.id, prisma, { mfaVerified: true });
    const post = (endpoint: string) => request(app.getHttpServer()).post(`/api/v1/admin/configuration/${endpoint}`)
      .set('Cookie', `qms_session=${token}; qms_csrf=${csrf}`).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID());
    const code = randomUUID();
    const records = 'component-project-records';
    const mappings = 'component-project-mappings';
    const pendingProject = async () => {
      if (path === 'create') return () => post(records).send({ code, name: 'Racing project', stage: 'NEW_PRODUCT', customerEngineerAssignmentId: assignment.id });
      const { body: project } = await post(records).send({ code, name: 'Bulk project', stage: 'NEW_PRODUCT' }).expect(201);
      const { body: mapping } = await post(mappings).send({ componentCode: randomUUID(), componentName: 'Bulk component', projectRecordId: project.id, productCategory: 'Body' }).expect(201);
      const command = { selection: [{ id: mapping.id, expectedVersion: mapping.version }], changes: { projectEngineerAssignmentId: assignment.id } };
      const { body: preview } = await post(`${mappings}/bulk-preview`).send(command).expect(200);
      return () => post(`${mappings}/bulk-apply`).send({ ...command, previewToken: preview.previewToken });
    };
    const write = await pendingProject();
    const held = signal<number>(), release = signal<void>();
    const gate = prisma.$transaction(async tx => {
      await tx.$executeRaw`LOCK TABLE admin_mutations IN SHARE MODE`;
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      held.resolve(backend!.pid);
      await release.promise;
    });
    const gatePid = await held.promise;
    const deletion = remove('STANDARD').then(response => response);
    let projectWrite: ReturnType<typeof deletion> | undefined;
    try {
      const deleterPid = await waitForBlockedTransaction(gatePid);
      projectWrite = write().then(response => response);
      await waitForBlockedTransaction(deleterPid);
    } finally {
      release.resolve();
      await gate;
      await deletion;
      await projectWrite;
    }
    expect((await deletion).status).toBe(200);
    const rejected = await projectWrite;
    expect(rejected).toMatchObject({ status: 409, body: { code: 'CONCURRENCY_CONFLICT' } });
    expect(await prisma.$queryRaw`SELECT customer_engineer_assignment_id, project_engineer_assignment_id
      FROM component_project_records WHERE organization_id = ${org.id}::uuid AND code = ${code}`)
      .toEqual(path === 'create' ? [] : [{ customer_engineer_assignment_id: null, project_engineer_assignment_id: null }]);
  }, 15_000);
});
