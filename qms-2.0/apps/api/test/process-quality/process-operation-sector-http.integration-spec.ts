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

describe('manual operation creation through the API and PostgreSQL', () => {
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
});
