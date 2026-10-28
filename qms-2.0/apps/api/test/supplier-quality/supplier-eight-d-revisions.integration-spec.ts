import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { supplierEightDDocument, supplierEightDFixture } from './supplier-eight-d.fixture.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Supplier revision directory requires disposable loopback PostgreSQL, never preview 55440.');

describe('supplier immutable revision metadata directory', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter()); await app.init();
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  it('enumerates older submitted revisions using a bounded cursor, without draft evidence or private payloads', async () => {
    const f = await supplierEightDFixture(app);
    const permission = await f.db.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:issues:report' } });
    await f.db.rolePermission.create({ data: { roleId: f.f.role.id, permissionId: permission.id } });
    expect((await f.http(f.sqe.cookie, 'get', `${f.prefix}/revisions`).expect(200)).body).toEqual({ items: [], nextBefore: null });
    await f.http(f.vendor.cookie, 'get', `${f.portal}/revisions`).expect(404);
    const preview = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, { expectedRowVersion: f.issued.rowVersion, selectedFileIds: [] }).expect(200)).body;
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, { expectedRowVersion: f.issued.rowVersion, selectedFileIds: [], previewToken: preview.previewToken, confirmed: true }).expect(200);
    let current = await f.read();
    current = (await f.http(f.vendor.cookie, 'put', f.portal, { ...f.version(current), document: supplierEightDDocument() }).expect(200)).body;
    current = (await f.http(f.vendor.cookie, 'post', `${f.portal}/analysis-complete`, { ...f.version(current), submissionDueAt: '2099-11-20T00:00:00Z' }).expect(201)).body;
    const first = (await f.http(f.vendor.cookie, 'post', `${f.portal}/submit`, f.version(current)).expect(201)).body;
    expect((await f.decide(f.sqe, first.closure, ['PROFESSIONAL'], 'RETURN')).status).toBe(200);
    current = await f.read();
    const second = (await f.http(f.vendor.cookie, 'post', `${f.portal}/submit`, f.version(current)).expect(201)).body;
    const latest = (await f.http(f.vendor.cookie, 'get', `${f.portal}/revisions?pageSize=1`).expect(200)).body;
    expect(latest.items).toEqual([expect.objectContaining({ id: second.submittedRevisionId, revision: 2, approved: false })]);
    expect(latest.nextBefore).toBe(2);
    const older = (await f.http(f.sqe.cookie, 'get', `${f.prefix}/revisions?pageSize=1&before=${latest.nextBefore}`).expect(200)).body;
    expect(older.items).toEqual([expect.objectContaining({ id: first.submittedRevisionId, revision: 1 })]);
    expect(older.nextBefore).toBeNull();
    expect(Object.keys(older.items[0]).sort()).toEqual(['approved', 'createdAt', 'id', 'revision']);
    await f.http(f.otherVendor.cookie, 'get', `${f.portal}/revisions`).expect(404);
    await f.db.rolePermission.deleteMany({ where: { roleId: f.f.role.id, permissionId: permission.id } });
    await f.http(f.sqe.cookie, 'get', `${f.prefix}/revisions`).expect(403);
  }, 30_000);
});
