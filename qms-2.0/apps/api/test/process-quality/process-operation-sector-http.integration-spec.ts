import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { AdminMutationService, type AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { configureHttpBodyParser } from '../../src/http-body-parser.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') {
  throw new Error('Operation sector HTTP tests require disposable loopback PostgreSQL, never 55440.');
}

const path = '/api/v1/process-quality/operation-sectors';
const bulkPath = `${path}/bulk-create`;
const bulkSectorPath = `${path}/bulk-sector`;

describe('manual operation management through the API and PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let manager: Awaited<ReturnType<typeof login>>;
  const csrf = randomUUID();

  beforeAll(async () => {
    const expressApp = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureHttpBodyParser(expressApp);
    app = expressApp;
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    manager = await login('process-quality:configuration:manage');
  });
  afterAll(async () => { await app?.close(); });

  async function login(permissionCode?: string, sameOrganizationId?: string) {
    const organizationId = sameOrganizationId ?? (await prisma.organization.create({ data: { code: randomUUID(), name: 'Operation sector HTTP', type: 'INTERNAL' } })).id;
    const user = await prisma.user.create({ data: { organizationId, username: randomUUID(), passwordHash: 'test-only', accountType: 'INTERNAL' } });
    if (permissionCode) {
      const permission = await prisma.permission.upsert({ where: { code: permissionCode }, create: { code: permissionCode, name: permissionCode }, update: {} });
      const role = await prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'Operation sector HTTP', permissions: { create: { permissionId: permission.id } } } });
      await prisma.userRole.create({ data: { organizationId, userId: user.id, roleId: role.id } });
    }
    const token = await app.get(SessionService).create(user.id, prisma, { mfaVerified: true });
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    const actor: AdminActor = { id: user.id, organizationId, accountType: 'INTERNAL', sessionId: session.id };
    return { actor, cookie: `qms_session=${token}; qms_csrf=${csrf}` };
  }

  function send(target: string, body: object | string, key = randomUUID(), cookie = manager.cookie, method: 'post' | 'put' = 'post') {
    return request(app.getHttpServer())[method](target).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).type('json').send(body);
  }

  it('documents the required single fields, optional update code and typed bulk endpoint', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    expect(document.components!.schemas!.ProcessOperationSectorInputDto).toMatchObject({ required: ['operationCode', 'operationName'], properties: { operationCode: { type: 'string' } } });
    expect(document.components!.schemas!.UpdateProcessOperationSectorDto).not.toMatchObject({ required: expect.arrayContaining(['operationCode']) });
    expect(document.components!.schemas!.BulkCreateProcessOperationSectorsDto).toMatchObject({ required: ['items'], properties: { items: { minItems: 1, maxItems: 100 } } });
    expect(document.paths[bulkPath]!.post!.responses['201']).toMatchObject({ content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ProcessOperationSectorDto' } } } } });
  });

  it('requires a nonblank code and name on new manual creates and preserves leading zeroes', async () => {
    await send(path, { operationName: 'Uncoded', sectorName: 'Board' }).expect(400);
    await send(path, { operationCode: null, operationName: 'Uncoded', sectorName: 'Board' }).expect(400);
    await send(path, { operationCode: '   ', operationName: 'Uncoded', sectorName: 'Board' }).expect(400);
    await send(path, { operationCode: '001', operationName: '　 ' }).expect(400);
    const key = randomUUID();
    const created = await send(path, { operationCode: ' 001 ', operationName: ' Manual ' }, key).expect(201);
    expect(created.body).toMatchObject({ operationCode: '001', operationName: 'Manual', sectorName: null, version: 1 });
    expect((await send(path, { operationCode: '001', operationName: 'Manual', sectorName: null }, key).expect(201)).body).toEqual(created.body);
  });

  it('replays an old uncoded receipt and edits then binds the same legacy row through HTTP', async () => {
    const { actor } = manager;
    const id = randomUUID(), key = randomUUID();
    const input = { operationName: 'Legacy operation', sectorName: 'Legacy board' };
    const record = { id, organizationId: actor.organizationId, ...input, active: true, version: 1 };
    await app.get(AdminMutationService).run({ actor, organizationId: actor.organizationId, key, traceId: randomUUID(),
      action: 'PROCESS_OPERATION_SECTOR_CREATED', permission: 'process-quality:configuration:manage', payload: input, authentication: 'active' }, async tx => {
      await tx.$executeRaw`INSERT INTO process_operation_sectors (id, organization_id, operation_name, sector_name, created_by_id, updated_by_id)
        VALUES (${id}::uuid, ${actor.organizationId}::uuid, ${input.operationName}, ${input.sectorName}, ${actor.id}::uuid, ${actor.id}::uuid)`;
      return record;
    });
    expect((await send(path, { ...input, operationCode: null }, key).expect(201)).body).toEqual({ ...record, operationCode: null });
    const update = { operationName: 'Updated legacy operation', expectedVersion: 1, active: true };
    const editKey = randomUUID();
    const edited = await send(`${path}/${id}`, update, editKey, manager.cookie, 'put').expect(200);
    expect(edited.body).toMatchObject({ id, operationCode: null, sectorName: input.sectorName, version: 2 });
    expect((await send(`${path}/${id}`, update, editKey, manager.cookie, 'put').expect(200)).body).toEqual(edited.body);
    expect((await send(`${path}/${id}`, { ...update, expectedVersion: 2, operationCode: ' 002 ' }, randomUUID(), manager.cookie, 'put').expect(200)).body)
      .toMatchObject({ id, operationCode: '002', sectorName: input.sectorName, version: 3 });
    expect((await send(path, input, key).expect(201)).body).toEqual({ ...record, operationCode: null });
  });

  it('accepts 100 ordered rows and safely replays a simultaneous retry with one normal audit per row', async () => {
    const key = randomUUID();
    const operationName = '工'.repeat(200);
    const items = Array.from({ length: 100 }, (_, index) => ({ operationCode: ` ${'序'.repeat(98)}${String(index).padStart(2, '0')} `, operationName: ` ${operationName} ` }));
    const escapedBody = JSON.stringify({ items }).replace(/[工序]/g, character => `\\u${character.charCodeAt(0).toString(16)}`);
    const [first, replay] = await Promise.all([send(bulkPath, escapedBody, key).expect(201), send(bulkPath, { items }, key).expect(201)]);
    expect(replay.body).toEqual(first.body);
    expect(first.body).toHaveLength(100);
    expect(first.body.map((row: { operationCode: string }) => row.operationCode)).toEqual(items.map(row => row.operationCode.trim()));
    expect(first.body[0]).toMatchObject({ organizationId: manager.actor.organizationId, operationName, sectorName: null, active: true, version: 1 });
    expect(await prisma.auditEvent.count({ where: { action: 'PROCESS_OPERATION_SECTOR_CREATED', resourceId: { in: first.body.map((row: { id: string }) => row.id) } } })).toBe(100);
    const mismatch = await send(bulkPath, { items: items.slice(1) }, key).expect(409);
    expect(mismatch.body.code).toBe('IDEMPOTENCY_REPLAY');
  });

  it('reports zero-based item fields on invalid and duplicate input and rejects over-limit payloads', async () => {
    const first = { operationCode: 'CHECK-ROW', operationName: 'First' };
    const invalid = await send(bulkPath, { items: [first, { operationCode: 'CHECK-2', operationName: '　 ' }] }).expect(400);
    expect(invalid.body.fields).toHaveProperty(['items[1].operationName']);
    const duplicate = await send(bulkPath, { items: [first, { operationCode: ` ${first.operationCode} `, operationName: 'Duplicate' }] }).expect(400);
    expect(duplicate.body).toMatchObject({ code: 'PROCESS_OPERATION_CODE_CONFLICT', fields: { 'items[1].operationCode': expect.any(Array) } });
    await send(bulkPath, { items: Array.from({ length: 101 }, () => first) }).expect(400);
    await send(bulkPath, { items: [] }).expect(400);
    await send(bulkPath, { items: [{ ...first, sectorName: 'Unexpected' }] }).expect(400);
    await send(bulkPath, { items: [first] }).expect(201);
  });

  it('rolls back rows, success audits and the receipt when a later code already exists', async () => {
    const existing = { operationCode: 'ALREADY', operationName: 'Original' };
    const created = await send(path, existing).expect(201);
    const first = { operationCode: 'ROLLBACK-FIRST', operationName: 'Rolled back' };
    const key = randomUUID();
    const failed = await send(bulkPath, { items: [first, { ...existing, operationName: 'Overwrite' }] }, key).expect(400);
    expect(failed.body).toMatchObject({ code: 'PROCESS_OPERATION_CODE_CONFLICT', fields: { 'items[1].operationCode': expect.any(Array) } });
    expect(await prisma.auditEvent.count({ where: { traceId: failed.body.traceId, action: 'PROCESS_OPERATION_SECTOR_CREATED' } })).toBe(0);
    expect(await prisma.$queryRaw`SELECT operation_name FROM process_operation_master WHERE id = ${created.body.id}::uuid`).toEqual([{ operation_name: existing.operationName }]);
    await send(bulkPath, { items: [first] }, key).expect(201);
  });

  it('creates single and bulk operations when distinct managers hold concurrent organization SHARE locks', async () => {
    const { organizationId } = manager.actor;
    const other = await login('process-quality:configuration:manage', organizationId);
    const single = { operationCode: 'CONCURRENT-SINGLE', operationName: 'Single' };
    const batch = { operationCode: 'CONCURRENT-BULK', operationName: 'Bulk' };
    const keys = [randomUUID(), randomUUID()];
    let responses: Promise<[request.Response, request.Response]> | undefined;
    try {
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM sessions WHERE id IN (${manager.actor.sessionId}::uuid, ${other.actor.sessionId}::uuid) FOR UPDATE`;
        const [blocker] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        responses = Promise.all([
          send(path, single, keys[0], manager.cookie),
          send(bulkPath, { items: [batch] }, keys[1], other.cookie),
        ]);
        for (let attempt = 0; attempt < 200; attempt++) {
          await tx.$queryRaw`SELECT pg_stat_clear_snapshot()::text`;
          const [waiting] = await tx.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname = current_database() AND ${blocker!.pid} = ANY(pg_blocking_pids(pid)) AND query LIKE '%FROM sessions%FOR UPDATE%'`;
          if (waiting?.count === 2) return;
          await delay(10);
        }
        throw new Error('Both requests must reach the session lock after locking the same organization');
      });
    } finally {
      await responses;
    }
    const [created, bulkCreated] = await responses!;
    expect([created.status, bulkCreated.status]).toEqual([201, 201]);
    expect(created.body).toMatchObject(single);
    expect(bulkCreated.body).toMatchObject([batch]);
  });

  it('reports an indexed conflict when two managers submit overlapping codes in reverse order', async () => {
    const other = await login('process-quality:configuration:manage', manager.actor.organizationId);
    const first = { operationCode: 'OVERLAP-A', operationName: 'First' };
    const second = { operationCode: 'OVERLAP-Z', operationName: 'Second' };
    const results = await Promise.all([
      send(bulkPath, { items: [first, second] }),
      send(bulkPath, { items: [second, first] }, randomUUID(), other.cookie),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([201, 400]);
    const loser = results[0].status === 400 ? 0 : 1;
    expect(results[loser]!.body).toMatchObject({ code: 'PROCESS_OPERATION_CODE_CONFLICT', fields: { [`items[${loser}].operationCode`]: expect.any(Array) } });
    expect(results[1 - loser]!.body).toMatchObject(loser === 0 ? [second, first] : [first, second]);
  });

  it('enforces organization authority and lets a platform administrator reuse a code in another organization', async () => {
    const ordinary = await login();
    const administrator = await login('platform:admin');
    const items = [{ operationCode: 'SCOPED', operationName: 'Scoped operation' }];
    await send(bulkPath, { items }, randomUUID(), ordinary.cookie).expect(403);
    await send(bulkPath, { items, organizationId: ordinary.actor.organizationId }).expect(403);
    await request(app.getHttpServer()).post(bulkPath).set('Cookie', manager.cookie).set('Idempotency-Key', randomUUID()).send({ items }).expect(403);
    await request(app.getHttpServer()).post(bulkPath).set('Cookie', manager.cookie).set('x-csrf-token', csrf).send({ items }).expect(400);
    await send(bulkPath, { items }).expect(201);
    const scoped = await send(bulkPath, { items, organizationId: ordinary.actor.organizationId }, randomUUID(), administrator.cookie).expect(201);
    expect(scoped.body[0]).toMatchObject({ organizationId: ordinary.actor.organizationId, operationCode: 'SCOPED' });
  });

  it('documents the bulk sector request and typed array response', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    expect(document.components!.schemas!.BulkUpdateProcessOperationSectorsDto).toMatchObject({
      required: expect.arrayContaining(['sectorName', 'items']),
      properties: { organizationId: { format: 'uuid' }, sectorName: { maxLength: 200 }, items: { minItems: 1, maxItems: 1000 } },
    });
    expect(document.paths[bulkSectorPath]!.post!.responses['200']).toMatchObject({ content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ProcessOperationSectorDto' } } } } });
  });

  it('changes only the sector and update metadata for coded and legacy rows and replays without duplicate audits', async () => {
    const { actor } = manager;
    const editor = await login('process-quality:configuration:manage', actor.organizationId);
    const created = await send(path, { operationCode: 'BULK-SECTOR-MIXED', operationName: 'Coded', sectorName: 'Original' }).expect(201);
    const codedId: string = created.body.id;
    const legacyId = randomUUID();
    await prisma.$executeRaw`INSERT INTO process_operation_sectors (id, organization_id, operation_name, sector_name, active, created_by_id, updated_by_id)
      VALUES (${legacyId}::uuid, ${actor.organizationId}::uuid, 'Legacy', 'Legacy board', false, ${actor.id}::uuid, ${actor.id}::uuid)`;
    const snapshot = { ruleId: codedId, operationCode: created.body.operationCode, ruleVersion: 1 };
    const defect = await prisma.processDefect.create({ data: { organizationId: actor.organizationId, createdById: actor.id, updatedById: actor.id,
      description: 'Historical defect', operationCode: created.body.operationCode, operationName: 'Coded', operationSector: 'Original', sectorSnapshot: snapshot } });
    const readCoded = async () => (await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM process_operation_master WHERE id = ${codedId}::uuid`)[0]!;
    const readLegacy = async () => (await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM process_operation_sectors WHERE id = ${legacyId}::uuid`)[0]!;
    const beforeCoded = await readCoded(), beforeLegacy = await readLegacy();
    const key = randomUUID();
    const body = { sectorName: '  新板块  ', items: [{ id: legacyId, expectedVersion: 1 }, { id: codedId, expectedVersion: 1 }] };
    const [first, replay] = await Promise.all([send(bulkSectorPath, body, key, editor.cookie).expect(200), send(bulkSectorPath, body, key, editor.cookie).expect(200)]);
    expect(first.body).toMatchObject([
      { id: legacyId, operationCode: null, operationName: 'Legacy', sectorName: '新板块', active: false, version: 2 },
      { ...created.body, sectorName: '新板块', version: 2 },
    ]);
    expect(replay.body).toEqual(first.body);
    expect((await send(bulkSectorPath, { ...body, sectorName: 'Different' }, key, editor.cookie).expect(409)).body.code).toBe('IDEMPOTENCY_REPLAY');
    for (const [before, after] of [[beforeCoded, await readCoded()], [beforeLegacy, await readLegacy()]] as const) {
      expect(after).toEqual({ ...before, sector_name: '新板块', version: 2, updated_by_id: editor.actor.id, updated_at: expect.any(Date) });
      expect((after.updated_at as Date).getTime()).toBeGreaterThan((before.updated_at as Date).getTime());
    }
    expect(await prisma.processDefect.findUniqueOrThrow({ where: { id: defect.id } })).toEqual(defect);
    const audits = await prisma.auditEvent.findMany({ where: { resourceId: { in: [codedId, legacyId] }, action: 'PROCESS_OPERATION_SECTOR_UPDATED' } });
    expect(audits).toHaveLength(2);
    expect(audits).toEqual(expect.arrayContaining([codedId, legacyId].map(id => expect.objectContaining({ resourceId: id, actorUserId: editor.actor.id, outcome: 'SUCCESS', metadata: expect.objectContaining({ resourceVersion: 2 }) }))));
  });

  it('rejects invalid sector names, duplicate UUIDs and malformed selections', async () => {
    const item = { id: randomUUID(), expectedVersion: 1 };
    for (const body of [
      { items: [item] }, { sectorName: '　 ', items: [item] }, { sectorName: 'X\u0000X', items: [item] },
      { sectorName: '工'.repeat(201), items: [item] }, { sectorName: 'Valid', items: [] },
      { sectorName: 'Valid', items: [item, { ...item, id: item.id.toUpperCase() }] },
      { sectorName: 'Valid', items: [{ ...item, active: false }] }, { sectorName: 'Valid', items: [null] },
      { sectorName: 'Valid', items: [{ ...item, id: 'not-a-uuid' }] }, { sectorName: 'Valid', items: [{ ...item, expectedVersion: '1' }] },
      { sectorName: 'Valid', items: [{ ...item, expectedVersion: 0 }] },
      { sectorName: 'Valid', items: Array.from({ length: 1001 }, () => ({ ...item, id: randomUUID() })) },
    ]) await send(bulkSectorPath, body).expect(400);
  });

  it('rolls back the whole selection and receipt on stale, missing, or out-of-scope records', async () => {
    const other = await login('process-quality:configuration:manage');
    const created = await send(path, { operationCode: 'BULK-SECTOR-LOCAL', operationName: 'Local' }).expect(201);
    const stale = await send(path, { operationCode: 'BULK-SECTOR-STALE', operationName: 'Stale' }).expect(201);
    const foreign = await send(path, { operationCode: 'BULK-SECTOR-FOREIGN', operationName: 'Foreign' }, randomUUID(), other.cookie).expect(201);
    const local = { id: created.body.id, expectedVersion: 1 };
    const body = { sectorName: 'New sector' };
    const key = randomUUID();
    for (const invalid of [{ id: stale.body.id, expectedVersion: 9 }, { id: randomUUID(), expectedVersion: 1 }, { id: foreign.body.id, expectedVersion: 1 }]) {
      const failed = await send(bulkSectorPath, { ...body, items: [local, invalid] }, key).expect(409);
      expect(failed.body.code).toBe('CONCURRENCY_CONFLICT');
      expect(await prisma.auditEvent.count({ where: { traceId: failed.body.traceId, action: 'PROCESS_OPERATION_SECTOR_UPDATED' } })).toBe(0);
    }
    expect(await prisma.$queryRaw`SELECT version, sector_name FROM process_operation_master WHERE id IN (${local.id}::uuid, ${foreign.body.id}::uuid)`).toEqual([
      { version: 1, sector_name: null }, { version: 1, sector_name: null },
    ]);
    await send(bulkSectorPath, { ...body, items: [local] }, key).expect(200);
  });

  it('allows only one of two overlapping batches with the same record versions to commit', async () => {
    const { actor } = manager;
    const other = await login('process-quality:configuration:manage', actor.organizationId);
    const coded = await send(path, { operationCode: 'BULK-SECTOR-RACE', operationName: 'Race coded' }).expect(201);
    const legacyId = randomUUID();
    await prisma.$executeRaw`INSERT INTO process_operation_sectors (id, organization_id, operation_name, sector_name, created_by_id, updated_by_id)
      VALUES (${legacyId}::uuid, ${actor.organizationId}::uuid, 'Race legacy', 'Original', ${actor.id}::uuid, ${actor.id}::uuid)`;
    const items = [{ id: coded.body.id, expectedVersion: 1 }, { id: legacyId, expectedVersion: 1 }];
    const results = await Promise.all([
      send(bulkSectorPath, { sectorName: 'First', items }),
      send(bulkSectorPath, { sectorName: 'Second', items: [...items].reverse() }, randomUUID(), other.cookie),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect(results.find(result => result.status === 409)?.body.code).toBe('CONCURRENCY_CONFLICT');
    const winner = results.find(result => result.status === 200)!;
    expect(winner.body).toHaveLength(2);
    expect(winner.body[0]).toMatchObject({ version: 2, sectorName: winner === results[0] ? 'First' : 'Second' });
    expect(winner.body[1]).toMatchObject({ version: 2, sectorName: winner.body[0].sectorName });
    expect(await prisma.auditEvent.count({ where: { action: 'PROCESS_OPERATION_SECTOR_UPDATED', resourceId: { in: items.map(item => item.id) } } })).toBe(2);
  });

  it.each(['promotion', 'bulk update'] as const)('preserves exactly one identity when %s reaches a locked legacy row first', async first => {
    const { actor } = manager;
    const other = await login('process-quality:configuration:manage', actor.organizationId);
    const id = randomUUID();
    const operationCode = `PROMOTION-${id}`, operationName = `Legacy ${id}`;
    await prisma.$executeRaw`INSERT INTO process_operation_sectors (id, organization_id, operation_name, sector_name, created_by_id, updated_by_id)
      VALUES (${id}::uuid, ${actor.organizationId}::uuid, ${operationName}, 'Original', ${actor.id}::uuid, ${actor.id}::uuid)`;
    const promote = () => send(`${path}/${id}`, { operationCode, operationName, active: true, expectedVersion: 1 }, randomUUID(), manager.cookie, 'put');
    const configure = () => send(bulkSectorPath, { sectorName: 'New board', items: [{ id, expectedVersion: 1 }] }, randomUUID(), other.cookie);
    const [startWinner, startLoser] = first === 'promotion' ? [promote, configure] : [configure, promote];
    const pending: Promise<request.Response>[] = [];
    try {
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM process_operation_sectors WHERE id = ${id}::uuid FOR UPDATE`;
        const [blocker] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        pending.push(startWinner().then(response => response));
        for (let attempt = 0; attempt < 200; attempt++) {
          await tx.$queryRaw`SELECT pg_stat_clear_snapshot()::text`;
          const [waiting] = await tx.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname = current_database() AND ${blocker!.pid} = ANY(pg_blocking_pids(pid)) AND query LIKE '%process_operation_sectors%FOR UPDATE%'`;
          if (waiting?.count === 1) {
            pending.push(startLoser().then(response => response));
            return;
          }
          await delay(10);
        }
        throw new Error('First request did not reach the legacy row lock');
      });
    } finally {
      await Promise.all(pending);
    }
    const [winner, loser] = await Promise.all(pending);
    expect(winner?.status).toBe(200);
    expect(loser?.status).toBe(409);
    expect(loser?.body.code).toBe('CONCURRENCY_CONFLICT');
    const rows = await prisma.$queryRaw`SELECT operation_code, sector_name, version FROM process_operation_master WHERE id = ${id}::uuid
      UNION ALL SELECT NULL, sector_name, version FROM process_operation_sectors WHERE id = ${id}::uuid`;
    expect(rows).toEqual([first === 'promotion'
      ? { operation_code: operationCode, sector_name: 'Original', version: 2 }
      : { operation_code: null, sector_name: 'New board', version: 2 }]);
    expect(await prisma.auditEvent.count({ where: { action: 'PROCESS_OPERATION_SECTOR_UPDATED', resourceId: id } })).toBe(1);
  });

  it('enforces CSRF, idempotency and organization permissions including on replay', async () => {
    const reader = await login('process-quality:configuration:read', manager.actor.organizationId);
    const administrator = await login('platform:admin');
    const created = await send(path, { operationCode: 'BULK-SECTOR-AUTH', operationName: 'Auth' }).expect(201);
    const key = randomUUID();
    const body = { sectorName: 'Allowed', organizationId: manager.actor.organizationId, items: [{ id: created.body.id, expectedVersion: 1 }] };
    await send(bulkSectorPath, body, key, reader.cookie).expect(403);
    await send(bulkSectorPath, { ...body, organizationId: administrator.actor.organizationId }).expect(403);
    await request(app.getHttpServer()).post(bulkSectorPath).set('Cookie', manager.cookie).set('Idempotency-Key', key).send(body).expect(403);
    await request(app.getHttpServer()).post(bulkSectorPath).set('Cookie', manager.cookie).set('x-csrf-token', csrf).send(body).expect(400);
    await send(bulkSectorPath, body, key, administrator.cookie).expect(200);
    await prisma.organization.update({ where: { id: body.organizationId }, data: { status: 'DISABLED', configurationRequired: true } });
    try { await send(bulkSectorPath, body, key, administrator.cookie).expect(403); }
    finally { await prisma.organization.update({ where: { id: body.organizationId }, data: { status: 'ACTIVE', configurationRequired: false } }); }
  });

  it('accepts 1000 records in one transaction and returns them in request order', async () => {
    const { actor } = manager;
    const items = Array.from({ length: 1000 }, () => ({ id: randomUUID(), expectedVersion: 1 }));
    const codedIds = items.filter((_item, index) => index % 2 === 0).map(item => item.id);
    const legacyIds = items.filter((_item, index) => index % 2 !== 0).map(item => item.id);
    await prisma.$executeRaw`INSERT INTO process_operation_master (id, organization_id, operation_code, operation_name, created_by_id, updated_by_id)
      SELECT ids.id, ${actor.organizationId}::uuid, ids.id::text, 'Large batch', ${actor.id}::uuid, ${actor.id}::uuid
      FROM unnest(${codedIds}::uuid[]) AS ids(id)`;
    await prisma.$executeRaw`INSERT INTO process_operation_sectors (id, organization_id, operation_name, sector_name, created_by_id, updated_by_id)
      SELECT ids.id, ${actor.organizationId}::uuid, ids.id::text, 'Original', ${actor.id}::uuid, ${actor.id}::uuid
      FROM unnest(${legacyIds}::uuid[]) AS ids(id)`;
    const sectorName = '工'.repeat(200), key = randomUUID();
    const response = await send(bulkSectorPath, JSON.stringify({ sectorName, items }, null, 2), key).expect(200);
    expect(response.body.map((row: { id: string }) => row.id)).toEqual(items.map(item => item.id));
    expect(response.body.every((row: { sectorName: string; version: number }) => row.sectorName === sectorName && row.version === 2)).toBe(true);
    expect(await prisma.$queryRaw`SELECT count(*)::int FROM process_operation_master WHERE id = ANY(${codedIds}::uuid[]) AND sector_name = ${sectorName} AND version = 2
      UNION ALL SELECT count(*)::int FROM process_operation_sectors WHERE id = ANY(${legacyIds}::uuid[]) AND sector_name = ${sectorName} AND version = 2`)
      .toEqual([{ count: 500 }, { count: 500 }]);
    expect(await prisma.auditEvent.count({ where: { action: 'PROCESS_OPERATION_SECTOR_UPDATED', resourceId: { in: items.map(item => item.id) }, outcome: 'SUCCESS' } })).toBe(1000);
    expect(await prisma.adminMutation.count({ where: { actorUserId: actor.id, organizationId: actor.organizationId, key } })).toBe(1);
  });
});
