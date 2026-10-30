import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { OutboxAdministrationService } from '../../src/modules/task-notification/outbox-administration.service.js';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { ServiceOperationsService } from '../../src/modules/system-management/service-operations.service.js';
import { ServiceOperationReceiptService } from '../../src/modules/task-notification/service-operation-receipt.service.js';
import { FileOperationsReadService } from '../../src/modules/file-management/file-operations-read.service.js';
import { MailOperationsReadService } from '../../src/modules/identity/mail-operations-read.service.js';
import { jest } from '@jest/globals';
import { Client } from 'pg';
import { ProcessEightDReportService } from '../../src/modules/process-quality/process-eight-d-report.service.js';
import { SupplierEightDReportService } from '../../src/modules/supplier-quality/supplier-eight-d-report.service.js';
import { CUSTOMER_EIGHT_D_RUNTIME, NEW_PRODUCT_EIGHT_D_RUNTIME, type InternalEightDRuntime } from '../../src/common/eight-d/internal-eight-d-runtime.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') {
  throw new Error('Service operations require disposable loopback PostgreSQL.');
}

describe('service operation facts through HTTP and PostgreSQL owners', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  const organizations: string[] = [];
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    sessions = app.get(SessionService);
    for (const code of ['platform:admin', 'outbox:read']) await prisma.permission.upsert({ where: { code }, update: {}, create: { code, name: code } });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    try {
      const where = { organizationId: { in: organizations } };
      await prisma.serviceOperationReceipt.deleteMany({ where: { scopeKey: { in: organizations } } });
      await prisma.auditEvent.deleteMany({ where });
      await prisma.userRole.deleteMany({ where });
      await prisma.user.deleteMany({ where });
      await prisma.role.deleteMany({ where });
      await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
    } finally { await app?.close(); }
  });
  async function fixture(codes: string[], accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const org = await prisma.organization.create({ data: { code: randomUUID(), name: 'Private service scope', type: accountType } });
    organizations.push(org.id);
    const user = await prisma.user.create({ data: { organizationId: org.id, username: randomUUID(), passwordHash: 'not-a-login-credential', accountType } });
    if (codes.length) {
      const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
      expect(permissions).toHaveLength(codes.length);
      const role = await prisma.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Fixture service role' } });
      await prisma.rolePermission.createMany({ data: permissions.map(permission => ({ roleId: role.id, permissionId: permission.id })) });
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: org.id } });
    }
    const token = await sessions.create(user.id, prisma, { mfaVerified: true });
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    return { org, user, cookie: `qms_session=${token}`, actor: { id: user.id, accountType, organizationId: org.id, sessionId: session.id } };
  }
  const read = (cookie: string, query = '') => request(app.getHttpServer()).get(`/api/v1/admin/console/services${query}`).set('Cookie', cookie);
  it('requires a real session at the service operations endpoint', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/console/services').expect(401);
  });
  it('has a dedicated bounded latest-execution receipt store', async () => {
    const rows = await prisma.$queryRaw<Array<{ receipts: string | null }>>`SELECT to_regclass('public.service_operation_receipts')::text AS receipts`;
    expect(rows).toEqual([{ receipts: 'service_operation_receipts' }]);
  });
  it('has an owner-owned metadata port rather than exposing failure queue payloads', () => {
    expect(typeof (app.get(OutboxAdministrationService) as unknown as { operationsSummary?: unknown }).operationsSummary).toBe('function');
  });
  it('injects the actual receipt owner into all four production report render callers', () => {
    const owner = app.get(ServiceOperationReceiptService);
    const reports = [app.get(ProcessEightDReportService), app.get(SupplierEightDReportService), app.get<InternalEightDRuntime>(CUSTOMER_EIGHT_D_RUNTIME).report, app.get<InternalEightDRuntime>(NEW_PRODUCT_EIGHT_D_RUNTIME).report];
    for (const report of reports) expect((report as unknown as { operationReceipts: unknown }).operationReceipts).toBe(owner);
  });
  it('allows explicit specialists but rejects ordinary, supplier and platform-marker-only users', async () => {
    const specialist = await fixture(['console:services:read']);
    const result = await read(specialist.cookie).expect(200);
    expect(result.body.scope).toBe('ORGANIZATION');
    expect(result.body.sources.map((source: { key: string }) => source.key)).toEqual(['outbox', 'files', 'mail', 'pdf', 'worker']);
    for (const actor of [await fixture([]), await fixture(['console:services:read'], 'SUPPLIER'), await fixture(['platform:admin'])]) await read(actor.cookie).expect(403);
  });
  it('keeps configuration, unavailable collection and actual results distinct and never invents service health', async () => {
    const specialist = await fixture(['console:services:read']);
    const result = await read(specialist.cookie).expect(200);
    const worker = result.body.sources.find((source: { key: string }) => source.key === 'worker');
    expect(worker).toMatchObject({ status: 'UNKNOWN', reasonCode: 'GLOBAL_SCOPE_REQUIRED' });
    expect(worker).not.toHaveProperty('results');
    const pdf = result.body.sources.find((source: { key: string }) => source.key === 'pdf');
    expect(pdf).toMatchObject({ status: 'UNKNOWN', reasonCode: 'NO_RECEIPT', results: [] });
    expect(JSON.stringify(result.body)).not.toMatch(/online|healthy|实时在线|SMTP_HOST|objectKey|encryptedPayload|passwordHash|producerId/);
  });
  it('requires an explicit platform request and marker before exposing global Worker receipts', async () => {
    const specialist = await fixture(['console:services:read']);
    const administrator = await fixture(['console:services:read', 'platform:admin']);
    const producer = randomUUID();
    await app.get(ServiceOperationReceiptService).recordWorker(producer, 'SUCCEEDED', new Date(), { processed: 5, failed: 1, retried: 0 });
    try {
      await read(specialist.cookie, '?scope=PLATFORM').expect(403);
      const organization = await read(administrator.cookie).expect(200);
      expect(organization.body.sources.find((source: { key: string }) => source.key === 'worker')).not.toHaveProperty('results');
      const platform = await read(administrator.cookie, '?scope=PLATFORM').expect(200);
      expect(platform.body.sources.find((source: { key: string }) => source.key === 'worker')).toMatchObject({ status: 'RECENT_RESULT', results: [expect.objectContaining({ counts: { processed: 5, failed: 1, retried: 0 } })] });
    } finally { await prisma.serviceOperationReceipt.deleteMany({ where: { producerId: producer } }); }
  });
  it('denies foreign targets and revoked reads without exposing private organization data', async () => {
    const a = await fixture(['console:services:read']); const b = await fixture(['console:services:read']);
    await app.get(ServiceOperationReceiptService).recordPdf(b.org.id, 'customer-quality', randomUUID(), 'SUCCEEDED', new Date());
    const result = await read(a.cookie, `?organizationId=${b.org.id}`).expect(403);
    expect(JSON.stringify(result.body)).not.toContain('Private service scope');
    await prisma.userRole.deleteMany({ where: { userId: a.user.id } });
    await read(a.cookie).expect(403);
  });
  it('keeps failed sources unavailable without hiding successful safe sources or leaking backend details', async () => {
    const specialist = await fixture(['console:services:read']);
    jest.spyOn(app.get(FileOperationsReadService), 'read').mockRejectedValueOnce(new Error('PRIVATE_STORAGE_KEY'));
    const result = await read(specialist.cookie).expect(200);
    expect(result.body.sources.find((source: { key: string }) => source.key === 'files')).toMatchObject({ status: 'UNAVAILABLE', reasonCode: 'SOURCE_UNAVAILABLE' });
    expect(result.body.sources.find((source: { key: string }) => source.key === 'mail').status).not.toBe('UNAVAILABLE');
    expect(JSON.stringify(result.body)).not.toContain('PRIVATE_STORAGE_KEY');
  });
  it('marks old PDF receipts stale and never describes a PDF producer as a persistent queue', async () => {
    const specialist = await fixture(['console:services:read']);
    await app.get(ServiceOperationReceiptService).recordPdf(specialist.org.id, 'process-quality', randomUUID(), 'FAILED', new Date());
    await prisma.serviceOperationReceipt.updateMany({ where: { scopeKey: specialist.org.id }, data: { observedAt: new Date(Date.now() - 2 * 86400000) } });
    const result = await read(specialist.cookie).expect(200);
    expect(result.body.sources.find((source: { key: string }) => source.key === 'pdf')).toMatchObject({ status: 'STALE', results: [expect.objectContaining({ status: 'FAILED', reasonCode: 'PDF_RENDER_FAILED' })] });
    expect(JSON.stringify(result.body)).not.toMatch(/PDF.*(?:queue|online)|producerId|identityKey/);
  });
  it('does not let a hundred newer Worker producers hide the latest organizational PDF fact', async () => {
    const administrator = await fixture(['console:services:read', 'platform:admin']);
    await app.get(ServiceOperationReceiptService).recordPdf(administrator.org.id, 'process-quality', randomUUID(), 'SUCCEEDED', new Date());
    await prisma.serviceOperationReceipt.updateMany({ where: { scopeKey: administrator.org.id }, data: { observedAt: new Date(Date.now() - 1000) } });
    const producers = Array.from({ length: 100 }, () => randomUUID());
    await prisma.serviceOperationReceipt.createMany({ data: producers.map(producerId => ({ identityKey: `worker:${producerId}`, scopeKey: 'UNSCOPED', operation: 'WORKER', producerId, status: 'SUCCEEDED', startedAt: new Date(), observedAt: new Date(), processed: 1 })) });
    try {
      const result = await read(administrator.cookie, '?scope=PLATFORM').expect(200);
      expect(result.body.sources.find((source: { key: string }) => source.key === 'pdf')).toMatchObject({ status: 'RECENT_RESULT', results: [expect.objectContaining({ domainCode: 'process-quality', status: 'SUCCEEDED' })] });
      expect(result.body.sources.find((source: { key: string }) => source.key === 'worker').results).toHaveLength(1);
    } finally { await prisma.serviceOperationReceipt.deleteMany({ where: { producerId: { in: producers } } }); }
  });
  it('retains the latest PDF execution when an older render completes late', async () => {
    const specialist = await fixture(['console:services:read']); const receipts = app.get(ServiceOperationReceiptService);
    const oldStart = new Date(Date.now() - 3000), newStart = new Date(Date.now() - 1000);
    const oldId = randomUUID(), newId = randomUUID();
    await receipts.recordPdf(specialist.org.id, 'process-quality', oldId, 'STARTED', oldStart);
    await receipts.recordPdf(specialist.org.id, 'process-quality', newId, 'SUCCEEDED', newStart);
    await receipts.recordPdf(specialist.org.id, 'process-quality', oldId, 'FAILED', oldStart);
    expect(await prisma.serviceOperationReceipt.findMany({ where: { scopeKey: specialist.org.id } })).toEqual([expect.objectContaining({ producerId: newId, status: 'SUCCEEDED' })]);
  });
  it('does not regress a completed render when its own STARTED receipt arrives late', async () => {
    const specialist = await fixture(['console:services:read']); const receipts = app.get(ServiceOperationReceiptService);
    const startedAt = new Date(), producer = randomUUID();
    await receipts.recordPdf(specialist.org.id, 'customer-quality', producer, 'SUCCEEDED', startedAt);
    await receipts.recordPdf(specialist.org.id, 'customer-quality', producer, 'STARTED', startedAt);
    expect(await prisma.serviceOperationReceipt.findFirst({ where: { scopeKey: specialist.org.id } })).toMatchObject({ status: 'SUCCEEDED', completedAt: expect.any(Date) });
  });
  it('bounds an observation write blocked by a database lock and leaves the original receipt intact', async () => {
    const specialist = await fixture(['console:services:read']); const receipts = app.get(ServiceOperationReceiptService);
    const startedAt = new Date(), producer = randomUUID();
    await receipts.recordPdf(specialist.org.id, 'process-quality', producer, 'STARTED', startedAt);
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    let writing: Promise<boolean> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM service_operation_receipts WHERE scope_key=$1 FOR UPDATE', [specialist.org.id]);
      const start = Date.now();
      writing = receipts.recordPdf(specialist.org.id, 'process-quality', producer, 'SUCCEEDED', startedAt);
      expect(await Promise.race([writing, new Promise<string>(resolve => { timer = setTimeout(() => resolve('UNBOUNDED'), 1800); })])).toBe(false);
      expect(Date.now() - start).toBeLessThan(2000);
    } finally { if (timer) clearTimeout(timer); await blocker.query('ROLLBACK'); await blocker.end(); await writing; }
    expect(await prisma.serviceOperationReceipt.findFirst({ where: { scopeKey: specialist.org.id } })).toMatchObject({ status: 'STARTED' });
  });
  it('deletes at most 1000 expired receipt snapshots and preserves current facts', async () => {
    const specialist = await fixture(['console:services:read']);
    const old = new Date(Date.now() - 8 * 86400000);
    await prisma.serviceOperationReceipt.createMany({ data: Array.from({ length: 1001 }, (_, index) => ({ identityKey: `pdf:${specialist.org.id}:old-${index}`, scopeKey: specialist.org.id, operation: 'PDF', domainCode: 'process-quality', producerId: randomUUID(), status: 'SUCCEEDED', startedAt: old, observedAt: old })) });
    await app.get(ServiceOperationReceiptService).recordPdf(specialist.org.id, 'process-quality', randomUUID(), 'SUCCEEDED', new Date());
    expect(await app.get(ServiceOperationReceiptService).purgeExpired()).toBe(1000);
    expect(await prisma.serviceOperationReceipt.count({ where: { scopeKey: specialist.org.id } })).toBe(2);
    expect(await prisma.organization.count({ where: { id: specialist.org.id } })).toBe(1);
  });
  it('persists an actual compiled Worker lifecycle instead of inferring it from configuration or stdout', async () => {
    const before = await prisma.serviceOperationReceipt.findMany({ where: { operation: 'WORKER' }, select: { id: true } });
    const child = spawn(process.execPath, ['dist/worker.js', '--once'], { cwd: process.cwd(), env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = ''; child.stderr.on('data', data => { errors += data.toString(); });
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    expect({ code, errors: code === 0 ? '' : errors }).toEqual({ code: 0, errors: '' });
    const after = await prisma.serviceOperationReceipt.findMany({ where: { operation: 'WORKER', id: { notIn: before.map(row => row.id) } } });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ scopeKey: 'UNSCOPED', status: 'STOPPED', processed: expect.any(Number), completedAt: expect.any(Date) });
  }, 20000);
});
