import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Test } from '@nestjs/testing';
import { Body, Controller, Post, ValidationPipe, type INestApplication } from '@nestjs/common';
import { jest } from '@jest/globals';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { DataExchangeRegistryService, type DataExchangeSourceHandle, type TrustedExchangeScope } from '../../src/modules/system-management/data-exchange-registry.service.js';
import { DataExchangeObservationService, type DataExchangeStageEvent } from '../../src/modules/system-management/data-exchange-observation.service.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') {
  throw new Error('Data exchange observations require disposable loopback PostgreSQL.');
}

let receiverService: DataExchangeObservationService;
let receiverHandle: DataExchangeSourceHandle;
let receiverScope: TrustedExchangeScope;
@Controller('api/v1/exchange-technical-fixture')
class TechnicalReceiver {
  @Post('receive') async receive(@Body() event: DataExchangeStageEvent) {
    return { accepted: true, observation: await receiverService.tryRecordStageResult(receiverHandle, receiverScope, event) };
  }
}
const path = '/api/v1/admin/console/data-exchanges';
describe('data exchange observations through real HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let production: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  let registry: DataExchangeRegistryService;
  let exchanges: DataExchangeObservationService;
  let handle: DataExchangeSourceHandle;
  const organizationIds: string[] = [];
  const allowedBatches = new Map<string, string>();
  const deniedSourceScopes = new Set<string>();
  const receiptIds: string[] = [];
  beforeAll(async () => {
    production = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    production.useGlobalFilters(new GlobalExceptionFilter()); await production.init();
    registry = new DataExchangeRegistryService();
    handle = registry.register({ key: 'TECHNICAL_TEST', label: '技术验证来源', directions: ['INBOUND', 'OUTBOUND'], objectTypes: ['FIXTURE'], authorizeScope: async (id, identity) => organizationIds.includes(id) && !deniedSourceScopes.has(id) && (!identity?.batchId || allowedBatches.get(identity.batchId) === id) });
    app = (await Test.createTestingModule({ imports: [AppModule], controllers: [TechnicalReceiver] }).overrideProvider(DataExchangeRegistryService).useValue(registry).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService); sessions = app.get(SessionService); exchanges = app.get(DataExchangeObservationService);
    await prisma.permission.upsert({ where: { code: 'platform:admin' }, update: {}, create: { code: 'platform:admin', name: 'Platform fixture' } });
    expect(await prisma.permission.count({ where: { code: 'console:exchanges:read' } })).toBe(1);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    if (prisma) {
      await prisma.dataExchangeAttempt.deleteMany({ where: { scopeKey: { in: organizationIds } } });
      await prisma.dataExchangeReceipt.deleteMany({ where: { id: { in: receiptIds } } });
      const where = { organizationId: { in: organizationIds } };
      await prisma.auditEvent.deleteMany({ where }); await prisma.userRole.deleteMany({ where }); await prisma.user.deleteMany({ where }); await prisma.role.deleteMany({ where });
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    }
    await app?.close(); await production?.close();
  });
  async function fixture(codes = ['console:exchanges:read'], accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Private exchange fixture', type: accountType } }); organizationIds.push(organization.id);
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), accountType, passwordHash: 'not-a-login-credential' } });
    if (codes.length) {
      const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } }); expect(permissions).toHaveLength(codes.length);
      const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Exchange reader', permissions: { create: permissions.map(permission => ({ permissionId: permission.id })) } } });
      await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: role.id } });
    }
    const token = await sessions.create(user.id, prisma, { mfaVerified: true });
    return { organization, user, cookie: `qms_session=${token}`, scope: await registry.bindScope(handle, organization.id) };
  }
  function event(organizationId: string, overrides: Partial<DataExchangeStageEvent> = {}): DataExchangeStageEvent {
    const batchId = randomUUID(); allowedBatches.set(batchId, organizationId);
    return { eventKey: randomUUID(), idempotencyKey: randomUUID(), direction: 'INBOUND', objectType: 'FIXTURE', level: 'BATCH', correlationId: randomUUID(), batchId, attemptNumber: 1, stage: 'transfer', outcome: 'SUCCEEDED', observedCount: 3, ...overrides };
  }
  async function blocked() {
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%pg_advisory_xact_lock%') AS waiting`;
      if (rows[0]?.waiting) return;
      await delay(10);
    }
    throw new Error('Expected the real exchange transaction to wait for a database lock.');
  }
  it('requires a real session at the read-only exchange endpoint', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/console/data-exchanges').expect(401);
  });
  it('has dedicated metadata attempts and idempotent receipts', async () => {
    expect(await prisma.$queryRaw`SELECT to_regclass('public.data_exchange_attempts')::text AS attempts, to_regclass('public.data_exchange_receipts')::text AS receipts`)
      .toEqual([{ attempts: 'data_exchange_attempts', receipts: 'data_exchange_receipts' }]);
  });
  it('keeps the actual production module unconnected and never registers a technical source there', async () => {
    const f = await fixture();
    const response = await request(production.getHttpServer()).get(path).set('Cookie', f.cookie).expect(200);
    expect(response.body).toMatchObject({ sources: [], items: [], connectionStatus: 'NOT_CONNECTED', total: 0, collection: { status: 'UNKNOWN' } });
    await request(app.getHttpServer()).post(path).set('Cookie', `${f.cookie}; qms_csrf=test`).set('x-csrf-token', 'test').send({}).expect(404);
  });
  it('allows only explicit internal readers and never derives the read from a platform marker', async () => {
    for (const f of [await fixture([]), await fixture(['platform:admin']), await fixture(['console:exchanges:read'], 'SUPPLIER')]) await request(app.getHttpServer()).get(path).set('Cookie', f.cookie).expect(403);
    const f = await fixture();
    const response = await request(app.getHttpServer()).get(path).set('Cookie', f.cookie).expect(200);
    expect(response.body.sources).toEqual([{ key: 'TECHNICAL_TEST', label: '技术验证来源', directions: ['INBOUND', 'OUTBOUND'], objectTypes: ['FIXTURE'] }]);
    await request(app.getHttpServer()).get(path).query({ scope: 'PLATFORM' }).set('Cookie', f.cookie).expect(403);
  });
  it('preserves independent stage outcomes and never calls transfer success business completion', async () => {
    const f = await fixture(); const input = event(f.organization.id);
    const transfer = await exchanges.recordStageResult(handle, f.scope, input);
    const first = await request(app.getHttpServer()).get(`${path}/attempts/${transfer.attemptId}`).set('Cookie', f.cookie).expect(200);
    expect(first.body.stages).toMatchObject({ transfer: { outcome: 'SUCCEEDED', observedCount: 3 }, validation: { outcome: 'NOT_REPORTED' }, processing: { outcome: 'NOT_REPORTED' }, reconciliation: { outcome: 'NOT_REPORTED' } }); expect(first.body.finishedAt).toBeNull();
    await exchanges.recordStageResult(handle, f.scope, { ...input, eventKey: randomUUID(), stage: 'processing', outcome: 'FAILED', errorCode: 'PROCESSING_FAILED' });
    const page = await request(app.getHttpServer()).get(path).set('Cookie', f.cookie).expect(200);
    expect(page.body.summary).toMatchObject({ batchAttempts: 1, recordAttempts: 0, transferSucceededBatches: 1, processingFailedBatches: 1, reconciliationSucceededBatches: 0 });
    expect(JSON.stringify(page.body)).not.toMatch(/eventKeyHash|inputHash|idempotencyKeyHash|attemptKey/);
  });
  it('updates stage counts as snapshots and finishes only after all four independent terminal facts', async () => {
    const f = await fixture(); const input = event(f.organization.id, { outcome: 'PENDING', observedCount: 3 });
    const result = await exchanges.recordStageResult(handle, f.scope, input);
    await exchanges.recordStageResult(handle, f.scope, { ...input, eventKey: randomUUID(), outcome: 'UNKNOWN', observedCount: 5 });
    await expect(exchanges.recordStageResult(handle, f.scope, { ...input, eventKey: randomUUID(), outcome: 'PENDING' })).rejects.toMatchObject({ status: 409 });
    await exchanges.recordStageResult(handle, f.scope, { ...input, eventKey: randomUUID(), outcome: 'SUCCEEDED', observedCount: 7 });
    for (const stage of ['validation', 'processing'] as const) await exchanges.recordStageResult(handle, f.scope, { ...input, eventKey: randomUUID(), stage, outcome: 'SUCCEEDED', observedCount: 7 });
    expect((await prisma.dataExchangeAttempt.findUniqueOrThrow({ where: { id: result.attemptId } })).finishedAt).toBeNull();
    await exchanges.recordStageResult(handle, f.scope, { ...input, eventKey: randomUUID(), stage: 'reconciliation', outcome: 'FAILED', errorCode: 'RECONCILIATION_FAILED', observedCount: 6 });
    const response = await request(app.getHttpServer()).get(`${path}/attempts/${result.attemptId}`).set('Cookie', f.cookie).expect(200);
    expect(response.body.stages.transfer).toMatchObject({ outcome: 'SUCCEEDED', observedCount: 7 });
    expect(response.body.finishedAt).not.toBeNull();
    expect(response.body.stages.reconciliation).toMatchObject({ outcome: 'FAILED', observedCount: 6 });
  });
  it('replays exact event receipts, rejects changed metadata and preserves terminal outcomes and retries', async () => {
    const f = await fixture(); const input = event(f.organization.id);
    const receipt = await exchanges.recordStageResult(handle, f.scope, input);
    expect(await exchanges.recordStageResult(handle, f.scope, input)).toEqual(receipt);
    await expect(exchanges.recordStageResult(handle, f.scope, { ...input, observedCount: 4 })).rejects.toMatchObject({ status: 409 });
    await expect(exchanges.recordStageResult(handle, f.scope, { ...input, eventKey: randomUUID(), outcome: 'PENDING' })).rejects.toMatchObject({ status: 409 });
    await expect(exchanges.recordStageResult(handle, f.scope, { ...input, eventKey: randomUUID(), outcome: 'FAILED' })).rejects.toMatchObject({ status: 409 });
    const retry = await exchanges.recordStageResult(handle, f.scope, { ...input, eventKey: randomUUID(), attemptNumber: 2, idempotencyKey: randomUUID(), outcome: 'FAILED' });
    expect(retry.attemptId).not.toBe(receipt.attemptId);
    expect(await prisma.dataExchangeAttempt.count({ where: { scopeKey: f.organization.id } })).toBe(2);
  });
  it('serializes real concurrent duplicate attempts and prevents committed-response-loss duplication', async () => {
    const f = await fixture(); const input = event(f.organization.id);
    const pair = await Promise.all([exchanges.recordStageResult(handle, f.scope, input), exchanges.recordStageResult(handle, f.scope, input)]);
    expect(pair[0]).toEqual(pair[1]);
    const original = prisma.$transaction.bind(prisma); let once = true;
    jest.spyOn(prisma, '$transaction').mockImplementation((async (...args: unknown[]) => { const result = await (original as (...values: unknown[]) => Promise<unknown>)(...args); if (once) { once = false; throw new Error('Commit acknowledgement lost'); } return result; }) as never);
    const lost = event(f.organization.id);
    await expect(exchanges.recordStageResult(handle, f.scope, lost)).rejects.toMatchObject({ status: 503 });
    const replay = await exchanges.recordStageResult(handle, f.scope, lost);
    expect(await prisma.dataExchangeReceipt.count({ where: { attemptId: replay.attemptId } })).toBe(1);
    expect(await prisma.dataExchangeAttempt.count({ where: { scopeKey: f.organization.id } })).toBe(2);
  });
  it('waits for an unresolved original transaction before confirming the same unknown event receipt', async () => {
    const f = await fixture(); const input = event(f.organization.id);
    const original = prisma.$transaction.bind(prisma);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    let originalTransaction: Promise<unknown> | undefined; let first = true;
    jest.spyOn(prisma, '$transaction').mockImplementation((async (work: (tx: unknown) => Promise<unknown>, options?: unknown) => {
      if (!first) return (original as (...args: unknown[]) => Promise<unknown>)(work, options);
      first = false;
      let wrote!: () => void; const written = new Promise<void>(resolve => { wrote = resolve; });
      originalTransaction = (original as (...args: unknown[]) => Promise<unknown>)(async (tx: unknown) => { const result = await work(tx); wrote(); await gate; return result; }, options);
      await written; throw new Error('Transport failed before the original COMMIT result was known');
    }) as never);
    let retry: ReturnType<typeof exchanges.recordStageResult> | undefined;
    try {
      await expect(exchanges.recordStageResult(handle, f.scope, input)).rejects.toMatchObject({ status: 503 });
      retry = exchanges.recordStageResult(handle, f.scope, input);
      await blocked(); release(); await originalTransaction;
      const result = await retry;
      expect(await prisma.dataExchangeAttempt.count({ where: { scopeKey: f.organization.id } })).toBe(1);
      expect(await prisma.dataExchangeReceipt.count({ where: { attemptId: result.attemptId } })).toBe(1);
    } finally { release(); await Promise.allSettled([originalTransaction, retry].filter(Boolean)); }
  });
  it('rechecks source authorization after waiting for the receipt lock', async () => {
    const f = await fixture(); const input = event(f.organization.id);
    const eventKeyHash = createHash('sha256').update(input.eventKey).digest('hex');
    const lockKey = JSON.stringify(['TECHNICAL_TEST', f.organization.id, eventKeyHash]);
    const blocker = new Client({ connectionString: process.env.DATABASE_URL }); await blocker.connect();
    let recording: ReturnType<typeof exchanges.recordStageResult> | undefined;
    try {
      await blocker.query('BEGIN'); await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
      recording = exchanges.recordStageResult(handle, f.scope, input);
      const result = recording.then(() => 'RECORDED', (error: { status: number }) => error.status);
      await blocked(); deniedSourceScopes.add(f.organization.id); await blocker.query('COMMIT');
      expect(await result).toBe(403);
      expect(await prisma.dataExchangeAttempt.count({ where: { scopeKey: f.organization.id } })).toBe(0);
    } finally { await blocker.query('ROLLBACK'); await blocker.end(); await Promise.allSettled([recording].filter(Boolean)); }
  });
  it('keeps batch and record ownership aligned and never sums their counts', async () => {
    const a = await fixture(); const b = await fixture(); const batch = event(a.organization.id);
    await exchanges.recordStageResult(handle, a.scope, batch);
    const record = { ...batch, eventKey: randomUUID(), idempotencyKey: randomUUID(), level: 'RECORD' as const, recordId: randomUUID(), observedCount: 1 };
    await expect(exchanges.recordStageResult(handle, b.scope, record)).rejects.toMatchObject({ status: 403 });
    await exchanges.recordStageResult(handle, a.scope, record);
    const response = await request(app.getHttpServer()).get(path).query({ batchId: batch.batchId }).set('Cookie', a.cookie).expect(200);
    expect(response.body.total).toBe(2); expect(response.body.summary).toMatchObject({ batchAttempts: 1, recordAttempts: 1, transferSucceededBatches: 1 });
    await request(app.getHttpServer()).get(path).query({ organizationId: a.organization.id }).set('Cookie', b.cookie).expect(403);
    const foreign = response.body.items[0].id;
    await request(app.getHttpServer()).get(`${path}/attempts/${foreign}`).set('Cookie', b.cookie).expect(404);
  });
  it('keeps level-filtered summaries and pagination consistent with the filtered attempts', async () => {
    const f = await fixture(); const batch = event(f.organization.id);
    await exchanges.recordStageResult(handle, f.scope, batch);
    await exchanges.recordStageResult(handle, f.scope, { ...batch, eventKey: randomUUID(), idempotencyKey: randomUUID(), level: 'RECORD', recordId: randomUUID(), observedCount: 1 });
    const response = await request(app.getHttpServer()).get(path).query({ level: 'RECORD', limit: 1 }).set('Cookie', f.cookie).expect(200);
    expect(response.body).toMatchObject({ total: 1, page: 1, limit: 1, summary: { batchAttempts: 0, recordAttempts: 1, transferSucceededBatches: 0 } });
    const beyond = await request(app.getHttpServer()).get(path).query({ level: 'RECORD', limit: 1, page: 2 }).set('Cookie', f.cookie).expect(200);
    expect(beyond.body).toMatchObject({ total: 1, items: [], summary: { batchAttempts: 0, recordAttempts: 1 } });
  });
  it('isolates identical idempotency event keys across organizations without retaining the raw key', async () => {
    const a = await fixture(); const b = await fixture(); const key = randomUUID();
    const first = await exchanges.recordStageResult(handle, a.scope, event(a.organization.id, { eventKey: key }));
    const second = await exchanges.recordStageResult(handle, b.scope, event(b.organization.id, { eventKey: key }));
    expect(first.attemptId).not.toBe(second.attemptId);
    const rows = await prisma.dataExchangeReceipt.findMany({ where: { attemptId: { in: [first.attemptId, second.attemptId] } } });
    expect(rows).toHaveLength(2); expect(JSON.stringify(rows)).not.toContain(key);
  });
  it('refuses forged handles/scopes and revoked owner authorization without partial metadata', async () => {
    const f = await fixture(); const input = event(f.organization.id);
    await expect(exchanges.recordStageResult({} as never, f.scope, input)).rejects.toMatchObject({ status: 403 });
    await expect(exchanges.recordStageResult(handle, {} as never, input)).rejects.toMatchObject({ status: 403 });
    allowedBatches.delete(input.batchId!);
    await expect(exchanges.recordStageResult(handle, f.scope, input)).rejects.toMatchObject({ status: 403 });
    expect(await prisma.dataExchangeAttempt.count({ where: { scopeKey: f.organization.id } })).toBe(0);
  });
  it('hides retained source rows and totals after the source owner revokes that scope', async () => {
    const f = await fixture(); const input = event(f.organization.id);
    const recorded = await exchanges.recordStageResult(handle, f.scope, input);
    deniedSourceScopes.add(f.organization.id);
    const response = await request(app.getHttpServer()).get(path).set('Cookie', f.cookie).expect(200);
    expect(response.body).toMatchObject({ sources: [], total: 0, items: [], summary: { batchAttempts: 0, recordAttempts: 0 } });
    await request(app.getHttpServer()).get(`${path}/attempts/${recorded.attemptId}`).set('Cookie', f.cookie).expect(404);
  });
  it('requires explicit marker and read to query platform metadata and rechecks read revocation', async () => {
    const a = await fixture(); const p = await fixture(['platform:admin', 'console:exchanges:read']);
    const input = event(a.organization.id); await exchanges.recordStageResult(handle, a.scope, input);
    const platform = await request(app.getHttpServer()).get(path).query({ scope: 'PLATFORM' }).set('Cookie', p.cookie).expect(200);
    expect(platform.body.items.some((row: { organizationId: string }) => row.organizationId === a.organization.id)).toBe(true);
    await prisma.userRole.deleteMany({ where: { userId: a.user.id } });
    await request(app.getHttpServer()).get(path).set('Cookie', a.cookie).expect(403);
  });
  it.each([{ page: 10001 }, { limit: 101 }, { direction: 'PRIVATE' }, { stage: 'transfer' }, { sourceKey: 'https://private' }, { sourceKey: 'UNKNOWN' }, { from: '2020-01-01T00:00:00Z', to: new Date().toISOString() }, { batchId: 'private?token=SECRET' }])('bounds query metadata %j', async query => {
    const f = await fixture(); await request(app.getHttpServer()).get(path).query(query).set('Cookie', f.cookie).expect(400);
  });
  it('never changes successful loopback reception into a business failure when observation storage fails', async () => {
    const f = await fixture(); receiverService = exchanges; receiverHandle = handle; receiverScope = f.scope;
    jest.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('PRIVATE_DATABASE_FAILURE'));
    const result = await request(app.getHttpServer()).post('/api/v1/exchange-technical-fixture/receive').set('Cookie', 'qms_csrf=test').set('x-csrf-token', 'test').send(event(f.organization.id)).expect(201);
    expect(result.body).toEqual({ accepted: true, observation: { status: 'UNAVAILABLE' } });
    const page = await request(app.getHttpServer()).get(path).set('Cookie', f.cookie).expect(200);
    expect(page.body.collection).toEqual({ status: 'UNAVAILABLE' });
    expect(JSON.stringify(page.body)).not.toContain('PRIVATE_DATABASE_FAILURE');
  });
  it('purges at most 1000 expired attempts and their receipts, without deleting recent or business facts', async () => {
    const f = await fixture(); const input = event(f.organization.id); const recent = await exchanges.recordStageResult(handle, f.scope, input);
    const old = new Date(Date.now() - 31 * 86400000); const ids = Array.from({ length: 1001 }, () => randomUUID());
    await prisma.dataExchangeAttempt.createMany({ data: ids.map(id => ({ id, scopeKey: f.organization.id, sourceKey: 'TECHNICAL_TEST', attemptKey: id, direction: 'INBOUND', objectType: 'FIXTURE', level: 'BATCH', correlationId: id, attemptNumber: 1, idempotencyKeyHash: '0'.repeat(64), stages: {}, startedAt: old, observedAt: old })) });
    const receipts = ids.map(id => ({ id: randomUUID(), scopeKey: f.organization.id, sourceKey: 'TECHNICAL_TEST', eventKeyHash: id, inputHash: '0'.repeat(64), attemptId: id, recordedAt: old }));receiptIds.push(...receipts.map(row => row.id)); await prisma.dataExchangeReceipt.createMany({ data: receipts });
    expect(await exchanges.purgeExpired()).toBe(1000);
    expect(await prisma.dataExchangeAttempt.count({ where: { id: { in: ids } } })).toBe(1);
    expect(await prisma.dataExchangeReceipt.count({ where: { id: { in: receiptIds } } })).toBe(1);
    expect(await prisma.dataExchangeAttempt.findUnique({ where: { id: recent.attemptId } })).not.toBeNull();
    expect(await prisma.organization.findUnique({ where: { id: f.organization.id } })).not.toBeNull();
  });
  it('uses an actual separate Node Worker to report processing after real loopback reception', async () => {
    const f = await fixture(); receiverService = exchanges; receiverHandle = handle; receiverScope = f.scope;
    await app.listen(0, '127.0.0.1'); const url = await app.getUrl(); const input = event(f.organization.id);
    const response = await fetch(`${url}/api/v1/exchange-technical-fixture/receive`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'qms_csrf=test', 'x-csrf-token': 'test' }, body: JSON.stringify(input) });
    expect(response.status).toBe(201); const accepted = await response.json() as { observation: { attemptId: string } };
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./data-exchange-technical.worker.mts', import.meta.url))], { cwd: process.cwd(), windowsHide: true, env: { ...process.env, QMS_EXCHANGE_FIXTURE_SCOPE: f.organization.id, QMS_EXCHANGE_FIXTURE_EVENT: JSON.stringify({ ...input, eventKey: randomUUID(), stage: 'processing', outcome: 'FAILED', errorCode: 'PROCESSING_FAILED' }) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let errors = ''; child.stdout.on('data', data => { output += String(data); }); child.stderr.on('data', data => { errors += String(data); });
    const timeout = setTimeout(() => child.kill(), 15000);
    const code = await new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); }); clearTimeout(timeout);
    expect({ code, errors }).toEqual({ code: 0, errors: '' }); expect(output).toContain('TECHNICAL_EXCHANGE_WORKER_RECORDED');
    const row = await request(app.getHttpServer()).get(`${path}/attempts/${accepted.observation.attemptId}`).set('Cookie', f.cookie).expect(200);
    expect(row.body.stages).toMatchObject({ transfer: { outcome: 'SUCCEEDED' }, processing: { outcome: 'FAILED' }, reconciliation: { outcome: 'NOT_REPORTED' } });
  }, 25000);
});
