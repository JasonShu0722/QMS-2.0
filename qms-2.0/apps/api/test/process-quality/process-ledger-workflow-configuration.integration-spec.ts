import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || connection.port === '55440') {
  throw new Error('Process ledger workflow tests require disposable PostgreSQL');
}

const path = '/api/v1/process-quality/ledger-workflow-configuration';
const boardNames = ['REGISTRATION', 'ANALYSIS', 'RESPONSIBILITY', 'DISPOSITION', 'CLOSURE'];
const read = 'process-quality:defects:read';
const write = 'process-quality:defects:write';
const close = 'process-quality:defects:close';
const review = 'process-quality:materials:review';
const manage = 'workflow:manage';

describe('process ledger workflow configuration', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => { await app?.close(); });

  function organization(type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    return prisma.organization.create({ data: { code: randomUUID(), name: 'Ledger configuration test', type } });
  }

  function position(organizationId: string, options: { status?: 'DISABLED'; departmentId?: string } = {}) {
    return prisma.position.create({ data: { organizationId, code: randomUUID(), name: randomUUID(), ...options } });
  }

  async function person(organizationId: string, codes: string[], accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const user = await prisma.user.create({ data: { organizationId, accountType, username: randomUUID(), passwordHash: 'unused' } });
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
    expect(permissions).toHaveLength(codes.length);
    const role = await prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'Ledger test permissions',
      permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { organizationId, userId: user.id, roleId: role.id } });
    const sessions = app.get(SessionService);
    const token = await sessions.create(user.id, prisma, { mfaVerified: true, reauthenticated: true });
    const session = (await sessions.resolve(token))!;
    const csrf = randomUUID();
    return { user, role, csrf, cookie: `qms_session=${token}; qms_csrf=${csrf}`,
      actor: { id: user.id, organizationId, accountType, sessionId: session.id } };
  }

  function get(who: { cookie: string }, url = path) {
    return request(app.getHttpServer()).get(url).set('Cookie', who.cookie);
  }

  function save(who: { cookie: string; csrf: string }, body: object, key = randomUUID()) {
    return request(app.getHttpServer()).put(path).set('Cookie', who.cookie).set('x-csrf-token', who.csrf).set('Idempotency-Key', key).send(body);
  }

  it('uses business permissions by default and restricts management to effective internal managers', async () => {
    const org = await organization();
    const active = await position(org.id);
    await position(org.id, { status: 'DISABLED' });
    const foreign = await position((await organization()).id);
    const administrator = await person(org.id, ['platform:admin']);
    const writer = await person(org.id, [read, write]);
    const reviewer = await person(org.id, [read, review]);
    const supplier = await person((await organization('SUPPLIER')).id, [manage, read, write], 'SUPPLIER');

    await get(administrator).expect(200, { version: 0, boards: boardNames.map(board => ({ board, positionIds: [] })),
      positions: [{ id: active.id, name: active.name }] });
    await get(writer).expect(403);
    await save(writer, { expectedVersion: 0, boards: [] }).expect(403);
    await get(writer, `${path}/capabilities`).expect(200, { boards: boardNames.slice(0, 4) });
    await get(writer, `${path}/capabilities?organizationId=${org.id}`).expect(200, { boards: boardNames.slice(0, 4) });
    await get(writer, `${path}/capabilities?organizationId=${foreign.organizationId}`).expect(403);
    await get(reviewer, `${path}/capabilities`).expect(200, { boards: ['MATERIAL_REVIEW'] });
    await get(supplier).expect(403);
    await get(supplier, `${path}/capabilities`).expect(403);
    await request(app.getHttpServer()).put(path).set('Cookie', administrator.cookie)
      .set('Idempotency-Key', randomUUID()).send({ expectedVersion: 0, boards: [] }).expect(403);
    await request(app.getHttpServer()).put(path).set('Cookie', administrator.cookie).set('x-csrf-token', administrator.csrf)
      .send({ expectedVersion: 0, boards: [] }).expect(400);
  });

  it('requires an effective current appointment and the base permission independently of setting another board', async () => {
    const org = await organization();
    const manager = await person(org.id, [manage]);
    const writer = await person(org.id, [read, write, close, review]);
    const readOnly = await person(org.id, [read]);
    const closer = await position(org.id);
    const analyst = await position(org.id);
    const disabledDepartment = await prisma.department.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Unavailable', status: 'DISABLED' } });
    const disabledDepartmentPosition = await position(org.id, { departmentId: disabledDepartment.id });
    const appointment = await prisma.userPosition.create({ data: { organizationId: org.id, userId: writer.user.id, positionId: analyst.id } });
    await prisma.userPosition.create({ data: { organizationId: org.id, userId: writer.user.id, positionId: closer.id, startedAt: new Date(Date.now() + 3600000) } });
    await prisma.userPosition.create({ data: { organizationId: org.id, userId: readOnly.user.id, positionId: analyst.id } });

    await save(manager, { expectedVersion: 0, boards: [{ board: 'ANALYSIS', positionIds: [disabledDepartmentPosition.id] }] }).expect(400);
    await save(manager, { expectedVersion: 0, boards: [{ board: 'ANALYSIS', positionIds: [analyst.id] },
      { board: 'CLOSURE', positionIds: [closer.id] }] }).expect(200);
    await get(writer, `${path}/capabilities`).expect(200, { boards: ['ANALYSIS', 'MATERIAL_REVIEW'] });
    await get(readOnly, `${path}/capabilities`).expect(200, { boards: [] });
    await prisma.userPosition.update({ where: { id: appointment.id }, data: { endedAt: new Date() } });
    await get(writer, `${path}/capabilities`).expect(200, { boards: ['MATERIAL_REVIEW'] });
  });

  it('saves atomically with version checks, replay authorization and audit snapshots', async () => {
    const org = await organization();
    const manager = await person(org.id, [manage]);
    const otherManager = await person(org.id, [manage]);
    const foreign = await position((await organization()).id);
    const local = await position(org.id);
    const key = randomUUID();
    const body = { expectedVersion: 0, boards: [{ board: 'ANALYSIS', positionIds: [local.id] }] };

    await save(manager, { ...body, organizationId: foreign.organizationId }).expect(400);
    await save(manager, { ...body, boards: [{ board: 'ANALYSIS', positionIds: [foreign.id] }] }).expect(400);
    await save(manager, { ...body, boards: [...body.boards, ...body.boards] }).expect(400);
    const winners = await Promise.all([save(manager, body, key), save(otherManager, body)]);
    expect(winners.map(result => result.status).sort()).toEqual([200, 409]);
    const effectiveManager = winners[0]!.status === 200 ? manager : otherManager;
    const nextBody = { expectedVersion: 1, boards: [] };
    const next = await save(effectiveManager, nextBody).expect(200);
    expect(next.body).toMatchObject({ version: 2, boards: boardNames.map(board => ({ board, positionIds: [] })) });

    const replayKey = randomUUID();
    const lastBody = { ...body, expectedVersion: 2 };
    const saved = await save(manager, lastBody, replayKey).expect(200);
    await save(manager, lastBody, replayKey).expect(200, saved.body);
    await save(manager, { ...lastBody, boards: [] }, replayKey).expect(409);
    await prisma.rolePermission.deleteMany({ where: { roleId: manager.role.id } });
    await save(manager, lastBody, replayKey).expect(403);

    const snapshots = await prisma.$queryRaw<{ version: number; boards: object; updated_by_id: string }[]>`
      SELECT version, boards, updated_by_id FROM process_ledger_workflow_configuration_revisions WHERE organization_id = ${org.id}::uuid ORDER BY version`;
    expect(snapshots).toEqual([
      { version: 1, boards: { REGISTRATION: [], ANALYSIS: [local.id], RESPONSIBILITY: [], DISPOSITION: [], CLOSURE: [] }, updated_by_id: effectiveManager.user.id },
      { version: 2, boards: Object.fromEntries(boardNames.map(board => [board, []])), updated_by_id: effectiveManager.user.id },
      { version: 3, boards: { REGISTRATION: [], ANALYSIS: [local.id], RESPONSIBILITY: [], DISPOSITION: [], CLOSURE: [] }, updated_by_id: manager.user.id },
    ]);
    const events = await prisma.auditEvent.findMany({ where: { organizationId: org.id, action: 'PROCESS_LEDGER_WORKFLOW_CONFIGURATION_UPDATED' }, orderBy: { createdAt: 'asc' } });
    expect(events.map(event => event.metadata)).toEqual([{ resourceVersion: 1 }, { resourceVersion: 2, previousResourceVersion: 1 }, { resourceVersion: 3, previousResourceVersion: 2 }]);
    expect(events.map(event => event.actorUserId)).toEqual([effectiveManager.user.id, effectiveManager.user.id, manager.user.id]);
  });

  it('uses the same board policy for bulk and legacy writes and reapplies it to both receipts', async () => {
    const org = await organization();
    const manager = await person(org.id, [manage]);
    const analyst = await person(org.id, [read, write]);
    const registrar = await person(org.id, [read, write]);
    const assessor = await person(org.id, [read, write]);
    const analystPosition = await position(org.id);
    const registrarPosition = await position(org.id);
    const assessorPosition = await position(org.id);
    await prisma.userPosition.createMany({ data: [
      { organizationId: org.id, userId: analyst.user.id, positionId: analystPosition.id },
      { organizationId: org.id, userId: registrar.user.id, positionId: registrarPosition.id },
      { organizationId: org.id, userId: assessor.user.id, positionId: assessorPosition.id },
    ] });
    const boards = [
      { board: 'REGISTRATION', positionIds: [registrarPosition.id] },
      { board: 'ANALYSIS', positionIds: [analystPosition.id] },
      { board: 'RESPONSIBILITY', positionIds: [assessorPosition.id] },
    ];
    await save(manager, { expectedVersion: 0, boards }).expect(200);

    function mutation(who: { cookie: string; csrf: string }, method: 'post' | 'put' | 'patch', suffix: string, body: object, key = randomUUID()) {
      return request(app.getHttpServer())[method](`/api/v1/process-quality/defects${suffix}`).set('Cookie', who.cookie)
        .set('x-csrf-token', who.csrf).set('Idempotency-Key', key).send(body);
    }
    const registration = { occurredAt: '2026-11-24T01:30:00Z', factoryCode: 'FACTORY_1', productCode: 'CONFIG-TEST', traceCode: randomUUID(), description: 'Initial facts' };
    await mutation(analyst, 'post', '', registration).expect(403);
    const created = await mutation(registrar, 'post', '', registration).expect(201);
    const defectId = created.body.id as string;
    const bulk = { organizationId: org.id, board: 'ANALYSIS', sources: [{ defectId, expectedVersion: 1, fields: { analysisProgress: 'Bulk analysis' } }] };
    const bulkKey = randomUUID();
    const legacyKey = randomUUID();
    await mutation(registrar, 'patch', '/bulk-maintenance', bulk).expect(403);
    await mutation(analyst, 'patch', '/bulk-maintenance', bulk, bulkKey).expect(200);
    const legacy = { expectedVersion: 2, analysisProgress: 'Single analysis' };
    await mutation(registrar, 'put', `/${defectId}`, legacy).expect(403);
    await mutation(analyst, 'put', `/${defectId}`, legacy, legacyKey).expect(200);
    await mutation(analyst, 'put', `/${defectId}`, { expectedVersion: 3, description: 'Cannot register' }).expect(403);
    await mutation(analyst, 'put', `/${defectId}`, { expectedVersion: 3, responsibilityCategory: 'PROCESS' }).expect(403);
    await mutation(assessor, 'put', `/${defectId}`, { expectedVersion: 3, responsibilityCategory: 'PROCESS' }).expect(200);
    await mutation(registrar, 'put', `/${defectId}`, { expectedVersion: 4, description: 'Updated facts' }).expect(200);
    await mutation(analyst, 'patch', '/bulk-maintenance', bulk, bulkKey).expect(200);
    await mutation(analyst, 'put', `/${defectId}`, legacy, legacyKey).expect(200);

    const lock = `process-ledger-workflow-configuration:${org.id}`;
    let queued: Promise<unknown> | undefined;
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))::text`;
      queued = mutation(analyst, 'patch', '/bulk-maintenance', bulk, bulkKey).expect(403).then(result => result);
      void queued.catch(() => {});
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
        const [state] = await tx.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND mode = 'ShareLock' AND NOT granted
            AND ((classid::bigint << 32) | objid::bigint) = hashtextextended(${lock}, 0)
        ) AS waiting`;
        waiting = state?.waiting ?? false;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await tx.$executeRaw`INSERT INTO process_ledger_workflow_configuration_revisions (organization_id, version, boards, updated_by_id)
        VALUES (${org.id}::uuid, 2, ${JSON.stringify({ REGISTRATION: [registrarPosition.id], RESPONSIBILITY: [assessorPosition.id] })}::jsonb, ${manager.user.id}::uuid)`;
    });
    await queued;
    await mutation(analyst, 'patch', '/bulk-maintenance', bulk, bulkKey).expect(403);
    await mutation(analyst, 'put', `/${defectId}`, legacy, legacyKey).expect(403);
    await get(registrar, `/api/v1/process-quality/defects/${defectId}`).expect(200).expect(({ body }) => {
      expect(body).toMatchObject({ version: 5, analysisProgress: 'Single analysis', responsibilityCategory: 'PROCESS', description: 'Updated facts' });
    });
  });

  it('allows physical organization deletion to cascade its configuration revisions', async () => {
    const org = await organization();
    await prisma.$executeRaw`INSERT INTO process_ledger_workflow_configuration_revisions (organization_id, version, boards, updated_by_id)
      VALUES (${org.id}::uuid, 1, '{}'::jsonb, ${randomUUID()}::uuid)`;
    await prisma.organization.delete({ where: { id: org.id } });
    const revisions = await prisma.$queryRaw`SELECT version FROM process_ledger_workflow_configuration_revisions WHERE organization_id = ${org.id}::uuid`;
    expect(revisions).toEqual([]);
  });
});
