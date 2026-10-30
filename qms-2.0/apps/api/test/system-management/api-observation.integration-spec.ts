import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { Controller, Get, HttpException, INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { jest } from '@jest/globals';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { RequireAccess, RequireAuthenticated } from '../../src/modules/authorization/access.decorator.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { configureHttpBodyParser } from '../../src/http-body-parser.js';
import { ApiObservationCollectorService } from '../../src/modules/system-management/api-observation-collector.service.js';
import { installApiObservation } from '../../src/modules/system-management/api-observation.middleware.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') {
  throw new Error('API observations require disposable loopback PostgreSQL, never preserved preview 55440.');
}
@Controller('api/v1/observation-fixture')
class ObservedFixtureController {
  @Get('guarded/:id') @RequireAccess({ featurePermission: 'audit:read', organizationScope: { source: 'query' } }) guarded() { return { accepted: true }; }
  @Get('failed') @RequireAccess({ featurePermission: 'audit:read', organizationScope: { source: 'query' } }) failed() { throw new HttpException('PRIVATE_FAILURE', 503); }
  @Get('session-only') @RequireAuthenticated() sessionOnly() { return { accepted: true }; }
}
const path = '/api/v1/admin/console/api-observations';

describe('API observations actual HTTP and PostgreSQL', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  let collector: ApiObservationCollectorService;
  const organizations: string[] = [];
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule], controllers: [ObservedFixtureController] }).compile()).createNestApplication<NestExpressApplication>({ bodyParser: false });
    installApiObservation(app);
    configureHttpBodyParser(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService); sessions = app.get(SessionService); collector = app.get(ApiObservationCollectorService);
    for (const code of ['audit:read', 'platform:admin']) await prisma.permission.upsert({ where: { code }, update: {}, create: { code, name: code } });
    expect(await prisma.permission.count({ where: { code: 'console:api:read' } })).toBe(1);
  });
  afterAll(async () => {
    if (!app) return;
    await collector.onModuleDestroy();
    await prisma.apiObservationBucket.deleteMany({ where: { OR: [{ scopeKey: { in: organizations } }, { route: { startsWith: '/api/v1/observation-fixture' } }] } });
    await prisma.apiObservationCollector.deleteMany({ where: { producerId: collector.producerId } });
    const where = { organizationId: { in: organizations } };
    await prisma.auditEvent.deleteMany({ where }); await prisma.userRole.deleteMany({ where }); await prisma.user.deleteMany({ where }); await prisma.role.deleteMany({ where });
    await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
    await app.close();
  });
  async function fixture(codes: string[], accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Private observation scope', type: accountType } }); organizations.push(organization.id);
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'test-not-credential', accountType } });
    if (codes.length) {
      const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } }); expect(permissions).toHaveLength(codes.length);
      const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Observation fixture', permissions: { create: permissions.map(permission => ({ permissionId: permission.id })) } } });
      await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: role.id } });
    }
    const token = await sessions.create(user.id, prisma, { mfaVerified: true });
    return { organization, user, cookie: `qms_session=${token}` };
  }
  async function drain() { for (let i = 0; i < 12; i++) { await collector.flush(); if (!collector.liveStatus().pendingBuckets) break; } }
  const query = (cookie: string, values: Record<string, unknown> = {}) => request(app.getHttpServer()).get(path).set('Cookie', cookie).query(values);
  const call = (cookie: string, organizationId: string, suffix = 'guarded/PRIVATE_RESOURCE') => request(app.getHttpServer()).get(`/api/v1/observation-fixture/${suffix}`).set('Cookie', cookie).query({ organizationId, secret: 'PRIVATE_QUERY', token: 'SECRET' });

  it('protects the real observation endpoint before any monitoring data is queried', async () => { await request(app.getHttpServer()).get(path).expect(401); });
  it('has dedicated minute aggregates and collector receipts, not a raw request log', async () => {
    const result = await prisma.$queryRaw<Array<{ buckets: string | null; collectors: string | null }>>`SELECT to_regclass('public.api_observation_buckets')::text AS buckets, to_regclass('public.api_observation_collectors')::text AS collectors`;
    expect(result).toEqual([{ buckets: 'api_observation_buckets', collectors: 'api_observation_collectors' }]);
  });
  it('grants explicit monitoring specialists a real context entry but denies ordinary and supplier accounts', async () => {
    const specialist = await fixture(['console:api:read']); const ordinary = await fixture([]); const supplier = await fixture(['console:api:read'], 'SUPPLIER');
    const context = await request(app.getHttpServer()).get('/api/v1/admin/console/context').set('Cookie', specialist.cookie).expect(200);
    expect(context.body.modules).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'api-monitoring', permissions: ['console:api:read'] })]));
    const result = await query(specialist.cookie).expect(200);
    expect(result.body).toMatchObject({ scope: 'ORGANIZATION', organizationId: specialist.organization.id, summary: { requests: 0 }, collector: { status: 'UNKNOWN' } });
    expect(result.body.collector).toEqual({ status: 'UNKNOWN' });
    await query(ordinary.cookie).expect(403); await query(supplier.cookie).expect(403);
  });
  it('persists actual successful and failed HTTP completions using trusted target and static route templates', async () => {
    const f = await fixture(['console:api:read', 'audit:read']);
    await call(f.cookie, f.organization.id).expect(200); await call(f.cookie, f.organization.id, 'failed').expect(503); await drain();
    const result = await query(f.cookie).expect(200);
    expect(result.body.summary).toMatchObject({ requests: 2, errors: 1 });
    expect(result.body.items.map((item: { route: string }) => item.route).sort()).toEqual(['/api/v1/observation-fixture/failed', '/api/v1/observation-fixture/guarded/:id']);
    for (const item of result.body.items) expect(item.le50 + item.le200 + item.le1000 + item.le5000 + item.gt5000).toBe(item.count);
    expect(JSON.stringify(result.body)).not.toMatch(/PRIVATE_RESOURCE|PRIVATE_QUERY|PRIVATE_FAILURE|SECRET|cookie|payload|passwordHash/);
  });
  it('does not leak another organization or global producer metadata and rejects forged target queries', async () => {
    const a = await fixture(['console:api:read', 'audit:read']); const b = await fixture(['console:api:read', 'audit:read']);
    await call(a.cookie, a.organization.id).expect(200); await call(b.cookie, b.organization.id).expect(200); await drain();
    const result = await query(a.cookie).expect(200);
    expect(result.body.summary.requests).toBe(1); expect(result.body.items.every((item: { scopeKey: string }) => item.scopeKey === a.organization.id)).toBe(true);
    expect(result.body.collector).toEqual({ status: 'UNKNOWN' });
    await query(a.cookie, { organizationId: b.organization.id }).expect(403); await query(a.cookie, { scope: 'PLATFORM' }).expect(403);
    await call(a.cookie, b.organization.id).expect(403); await drain();
    const bResult = await query(b.cookie).expect(200); expect(bResult.body.summary.requests).toBe(1);
  });
  it('requires a real marker plus explicit read for PLATFORM and never grants new read from marker alone', async () => {
    const markerOnly = await fixture(['platform:admin']); const observer = await fixture(['platform:admin', 'console:api:read']);
    await query(markerOnly.cookie).expect(403);
    await request(app.getHttpServer()).get('/api/v1/never-registered/PRIVATE_URL?organizationId=FORGED&token=SECRET').expect(404);
    await request(app.getHttpServer()).get('/api/v1/observation-fixture/guarded/PRIVATE_NOSESSION').query({ organizationId: observer.organization.id }).expect(401);
    await call(observer.cookie, observer.organization.id, 'session-only').expect(200); await drain();
    const result = await query(observer.cookie, { scope: 'PLATFORM' }).expect(200);
    expect(result.body.collector.producers).toEqual(expect.arrayContaining([expect.objectContaining({ producerId: collector.producerId })]));
    expect(JSON.stringify(result.body.collector)).not.toMatch(/committedBatch|committed_batch/);
    expect(result.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ route: 'UNKNOWN', scopeKey: 'UNSCOPED', statusClass: 4 }), expect.objectContaining({ route: '/api/v1/observation-fixture/guarded/:id', scopeKey: 'UNSCOPED', statusClass: 4 }), expect.objectContaining({ route: '/api/v1/observation-fixture/session-only', scopeKey: 'UNSCOPED', statusClass: 2 })]));
    expect(JSON.stringify(result.body)).not.toMatch(/PRIVATE_URL|PRIVATE_NOSESSION|FORGED|SECRET/);
    const defaultScope = await query(observer.cookie).expect(200); expect(defaultScope.body.items.every((item: { scopeKey: string }) => item.scopeKey === observer.organization.id)).toBe(true);
  });
  it('marks platform collection partial when a stale producer exists beside a fresh receipt', async () => {
    const observer = await fixture(['platform:admin', 'console:api:read']); await drain();
    const staleId = randomUUID();
    await prisma.apiObservationCollector.create({ data: { producerId: staleId, startedAt: new Date(Date.now() - 60000), lastFlushedAt: new Date(Date.now() - 60000), failures: 0, dropped: 0 } });
    try { const result = await query(observer.cookie, { scope: 'PLATFORM' }).expect(200); expect(result.body.collector.status).toBe('PARTIAL'); }
    finally { await prisma.apiObservationCollector.deleteMany({ where: { producerId: staleId } }); }
  });
  it('rejects revoked read without returning retained observations', async () => {
    const f = await fixture(['console:api:read']); await query(f.cookie).expect(200);
    await prisma.userRole.deleteMany({ where: { userId: f.user.id } }); await query(f.cookie).expect(403);
  });
  it.each([{ limit: 101 }, { page: 10001 }, { page: 0 }, { scope: 'ALL' }, { method: 'SECRET' }, { statusClass: 6 }, { route: '/api/v1/users/123?token=SECRET' }, { from: 'invalid' }, { from: '2020-01-01T00:00:00Z', to: new Date().toISOString() }])('rejects unbounded or malformed query %j', async values => {
    const f = await fixture(['console:api:read']); await query(f.cookie, values).expect(400);
  });
  it('excludes observation requests themselves and keeps real pagination independent from totals', async () => {
    const f = await fixture(['console:api:read', 'audit:read']); await call(f.cookie, f.organization.id).expect(200); await call(f.cookie, f.organization.id, 'failed').expect(503); await drain();
    const first = await query(f.cookie, { limit: 1 }).expect(200); const second = await query(f.cookie, { limit: 1, page: 2 }).expect(200); await drain();
    expect(first.headers['cache-control']).toBe('no-store'); expect(first.body.total).toBe(2); expect(first.body.summary.requests).toBe(2); expect(second.body.total).toBe(2); expect(first.body.items[0].route).not.toBe(second.body.items[0].route);
    expect(await prisma.apiObservationBucket.count({ where: { scopeKey: f.organization.id, route: { contains: 'api-observations' } } })).toBe(0);
  });
  it('captures parser failures before route guards without saving malformed input or spoofed organization', async () => {
    const observer = await fixture(['platform:admin', 'console:api:read']);
    await request(app.getHttpServer()).post('/api/v1/observation-fixture/body?organizationId=FORGED').set('Content-Type', 'application/json').send('{"SECRET":').expect(400);
    await request(app.getHttpServer()).post('/api/v1/observation-fixture/body').send({ data: 'x'.repeat(110000) }).expect(413); await drain();
    const result = await query(observer.cookie, { scope: 'PLATFORM', route: 'UNKNOWN', method: 'POST' }).expect(200);
    expect(result.body.summary.errors).toBeGreaterThanOrEqual(2); expect(result.body.items.every((item: { scopeKey: string }) => item.scopeKey === 'UNSCOPED')).toBe(true);
    expect(JSON.stringify(result.body)).not.toMatch(/SECRET|FORGED|110000/);
  });
  it('does not change a successful business response on collector database failure and persists gap after recovery', async () => {
    const f = await fixture(['console:api:read', 'audit:read']); await drain();
    const transaction = jest.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('PRIVATE_DATABASE_FAILURE'));
    await call(f.cookie, f.organization.id).expect(200); await collector.flush(); transaction.mockRestore();
    expect(collector.liveStatus().failures).toBeGreaterThan(0); expect(collector.liveStatus().pendingBuckets).toBeGreaterThan(0);
    await drain(); const result = await query(f.cookie).expect(200); expect(result.body.summary.requests).toBe(1); expect(result.body.collector).toEqual({ status: 'UNKNOWN' });
    const receipt = await prisma.apiObservationCollector.findUniqueOrThrow({ where: { producerId: collector.producerId } }); expect(receipt.failures).toBeGreaterThan(0); expect(receipt.lastFailureAt).not.toBeNull();
  });
  it('deduplicates a retry when the transaction committed but its transport acknowledgement was lost', async () => {
    const f = await fixture(['console:api:read']); await drain();
    collector.record({ scopeKey: f.organization.id, method: 'GET', route: '/api/v1/commit-unknown', statusCode: 200, duration: 1 });
    const original = prisma.$transaction.bind(prisma);
    const transport = jest.spyOn(prisma, '$transaction').mockImplementationOnce((async (...args: unknown[]) => {
      await (original as (...arguments_: unknown[]) => Promise<unknown>)(...args);
      throw new Error('Transport failed after COMMIT');
    }) as never);
    await collector.flush(); transport.mockRestore();
    expect(await prisma.apiObservationBucket.findMany({ where: { scopeKey: f.organization.id, route: '/api/v1/commit-unknown' } })).toEqual([expect.objectContaining({ count: 1 })]);
    await drain();
    const rows = await prisma.apiObservationBucket.findMany({ where: { scopeKey: f.organization.id, route: '/api/v1/commit-unknown' } });
    expect(rows).toEqual([expect.objectContaining({ count: 1, durationTotal: 1, le50: 1 })]);
  });
  it('waits for the original producer transaction lock before reconciling an unknown commit', async () => {
    const f = await fixture(['console:api:read']); await drain();
    let release!: () => void; let written!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const hasWritten = new Promise<void>(resolve => { written = resolve; });
    const original = prisma.$transaction.bind(prisma);
    let originalTransaction: Promise<unknown> | undefined;
    collector.record({ scopeKey: f.organization.id, method: 'GET', route: '/api/v1/commit-pending', statusCode: 200, duration: 1 });
    const transport = jest.spyOn(prisma, '$transaction').mockImplementationOnce(((work: (tx: unknown) => Promise<unknown>) => {
      originalTransaction = (original as (callback: (tx: unknown) => Promise<unknown>) => Promise<unknown>)(async tx => { await work(tx); written(); await gate; });
      return hasWritten.then(() => { throw new Error('COMMIT outcome still in progress'); });
    }) as never);
    let retry: Promise<void> | undefined;
    try {
      await collector.flush(); transport.mockRestore();
      retry = collector.flush();
      const deadline = Date.now() + 2000;
      let blocked = false;
      while (!blocked && Date.now() < deadline) {
        const [state] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
        blocked = Number(state!.count) > 0;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true); release(); await originalTransaction; await retry;
      expect(await prisma.apiObservationBucket.findMany({ where: { scopeKey: f.organization.id, route: '/api/v1/commit-pending' } })).toEqual([expect.objectContaining({ count: 1, durationTotal: 1 })]);
    } finally { transport.mockRestore(); release(); await originalTransaction; await retry; }
  });
  it('never overflows a persisted integer bucket and exposes rejected increments as dropped', async () => {
    const f = await fixture(['console:api:read']); const minute = new Date(Math.floor(Date.now() / 60000) * 60000);
    const row = await prisma.apiObservationBucket.create({ data: { minute, scopeKey: f.organization.id, method: 'GET', route: '/api/v1/counter-limit', statusClass: 2, count: 2_000_000_000, durationTotal: 2_000_000_000, durationMax: 1, le50: 2_000_000_000, le200: 0, le1000: 0, le5000: 0, gt5000: 0 } });
    const before = collector.liveStatus().dropped;
    collector.record({ at: minute, scopeKey: f.organization.id, method: 'GET', route: '/api/v1/counter-limit', statusCode: 200, duration: 1 }); await drain();
    expect((await prisma.apiObservationBucket.findUniqueOrThrow({ where: { id: row.id } })).count).toBe(2_000_000_000);
    expect(collector.liveStatus().dropped).toBeGreaterThanOrEqual(before + 1);
  });
  it('drains a full normal-close queue and marks its producer stopped instead of freshly collecting', async () => {
    const f = await fixture(['console:api:read']); await drain();
    for (let index = 0; index < 101; index++) collector.record({ scopeKey: f.organization.id, method: 'GET', route: '/api/v1/close-' + index, statusCode: 200, duration: 1 });
    await collector.onModuleDestroy();
    expect(collector.liveStatus()).toMatchObject({ active: false, pendingBuckets: 0, lastFlushedAt: null });
    expect(await prisma.apiObservationBucket.count({ where: { scopeKey: f.organization.id } })).toBe(101);
    expect((await prisma.apiObservationCollector.findUniqueOrThrow({ where: { producerId: collector.producerId } })).lastFlushedAt).toBeNull();
  });
  it('deletes at most 1000 expired observation buckets per flush while preserving recent data and business facts', async () => {
    const old = new Date(Date.now() - 8 * 86400000); const scopeKey = randomUUID(); const recent = new Date();
    await prisma.apiObservationBucket.createMany({ data: Array.from({ length: 1002 }, (_, index) => ({ minute: old, scopeKey, method: 'GET', route: `/api/v1/retention-${index}`, statusClass: 2, count: 1, durationTotal: 1, durationMax: 1, le50: 1, le200: 0, le1000: 0, le5000: 0, gt5000: 0 })) });
    await prisma.apiObservationBucket.create({ data: { minute: recent, scopeKey, method: 'GET', route: '/api/v1/recent', statusClass: 2, count: 1, durationTotal: 1, durationMax: 1, le50: 1, le200: 0, le1000: 0, le5000: 0, gt5000: 0 } });
    const before = await prisma.organization.count(); await collector.flush();
    expect(await prisma.apiObservationBucket.count({ where: { scopeKey, minute: old } })).toBe(2); expect(await prisma.apiObservationBucket.count({ where: { scopeKey, minute: recent } })).toBe(1); expect(await prisma.organization.count()).toBe(before);
    await prisma.apiObservationBucket.deleteMany({ where: { scopeKey } });
  });
});
