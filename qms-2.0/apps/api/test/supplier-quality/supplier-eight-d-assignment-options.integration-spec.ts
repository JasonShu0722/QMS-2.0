import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { supplierEightDFixture } from './supplier-eight-d.fixture.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Supplier directory requires disposable loopback PostgreSQL, never preview 55440.');

describe('supplier 8D bounded actual SQE appointment directory', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  it('returns actual eligible appointment IDs, filters before count and rejects external/permissionless access', async () => {
    const f = await supplierEightDFixture(app);
    const path = 'supplier-quality/eight-d/assignment-options';
    const result = (await f.http(f.sqe.cookie, 'get', `${path}?departmentId=${f.f.section.id}`).expect(200)).body;
    expect(result.items).toEqual(expect.arrayContaining([expect.objectContaining({ assignmentId: f.f.owner.assignment.id, userId: f.sqe.actor.id, departmentId: f.f.section.id })]));
    expect(result.items.every((row: { departmentId: string }) => row.departmentId === f.f.section.id)).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(result.items.length);
    expect(JSON.stringify(result)).not.toMatch(/passwordHash|securityVersion|email|permissions/);
    const beyond = (await f.http(f.sqe.cookie, 'get', `${path}?departmentId=${f.f.section.id}&limit=1&offset=10000`).expect(200)).body;
    expect(beyond).toEqual({ items: [], total: result.total });
    const missing = (await f.http(f.sqe.cookie, 'get', `${path}?search=NO-SUCH-APPOINTMENT-9223`).expect(200)).body;
    expect(missing).toMatchObject({ items: [], total: 0 });
    await f.db.userPosition.update({ where: { id: f.f.owner.assignment.id }, data: { endedAt: new Date() } });
    const expired = (await f.http(f.sqe.cookie, 'get', `${path}?departmentId=${f.f.section.id}`).expect(200)).body;
    expect(expired.items.some((row: { assignmentId: string }) => row.assignmentId === f.f.owner.assignment.id)).toBe(false);
    await f.http(f.vendor.cookie, 'get', path).expect(403);
    await f.db.userRole.deleteMany({ where: { userId: f.outsider.actor.id } });
    await f.http(f.outsider.cookie, 'get', path).expect(403);
  }, 30_000);
});
