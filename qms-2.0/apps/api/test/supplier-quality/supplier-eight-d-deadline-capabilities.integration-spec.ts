import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { supplierEightDFixture } from './supplier-eight-d.fixture.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Supplier capabilities require disposable loopback PostgreSQL, never preview 55440.');

describe('supplier deadline current per-row capabilities', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  it('projects SQE then manager eligibility and applicant cancellation without upgrading concurrent read locks', async () => {
    const f = await supplierEightDFixture(app, 'HIGH');
    let current = (await f.http(f.sqe.cookie, 'put', `${f.prefix}/deadlines`, { ...f.version(f.issued), analysisDueAt: '2099-11-20T00:00:00Z' }).expect(200)).body;
    const preview = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, { expectedRowVersion: current.rowVersion, selectedFileIds: [] }).expect(200)).body;
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, { expectedRowVersion: current.rowVersion, selectedFileIds: [], previewToken: preview.previewToken, confirmed: true }).expect(200);
    current = await f.read();
    const created = (await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions`, {
      stage: 'ANALYSIS', requestedDueAt: '2099-11-21T00:00:00Z', reason: 'Need an additional verified batch',
      expectedRowVersion: current.rowVersion, expectedContentVersion: current.contentVersion, expectedInstanceVersion: current.instanceVersion,
    }).expect(201)).body;
    const [sqe, manager, vendor] = await Promise.all([
      f.http(f.sqe.cookie, 'get', `${f.prefix}/deadline-extensions`),
      f.http(f.manager.cookie, 'get', `${f.prefix}/deadline-extensions`),
      f.http(f.vendor.cookie, 'get', `${f.portal}/deadline-extensions`),
    ]);
    expect([sqe.status, manager.status, vendor.status]).toEqual([200, 200, 200]);
    expect(sqe.body[0].allowedActions).toEqual(['approve-sqe', 'return-sqe']);
    expect(manager.body[0].allowedActions).toEqual([]);
    expect(vendor.body[0].allowedActions).toEqual(['cancel']);
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/deadline-extensions/${created.id}/decide`, { expectedVersion: created.version, duty: 'SQE', decision: 'APPROVE', comment: 'SQE verified' }).expect(200);
    const next = (await f.http(f.manager.cookie, 'get', `${f.prefix}/deadline-extensions`).expect(200)).body[0];
    expect(next.allowedActions).toEqual(['approve-manager', 'return-manager']);
    const permission = await f.db.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:issues:deadlines' } });
    await f.db.rolePermission.deleteMany({ where: { roleId: f.f.role.id, permissionId: permission.id } });
    expect((await f.http(f.manager.cookie, 'get', `${f.prefix}/deadline-extensions`).expect(200)).body[0].allowedActions).toEqual([]);
  }, 30_000);
});
