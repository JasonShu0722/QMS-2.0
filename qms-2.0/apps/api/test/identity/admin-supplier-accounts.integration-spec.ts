import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Disposable loopback PostgreSQL required, never 55440.');
describe('platform-wide supplier identity lifecycle, not supplier business access', () => {
  let app: INestApplication, db: PrismaService, sessions: SessionService;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init(); db = app.get(PrismaService); sessions = app.get(SessionService);
  });
  afterAll(() => app?.close());
  async function fixture(marker = true) {
    const home = await db.organization.create({ data: { code: randomUUID(), name: 'Surviving identity administrator', type: 'INTERNAL' } });
    const permissions = await db.permission.findMany({ where: { code: { in: ['account:users:read', 'account:users:delete', ...(marker ? ['platform:admin'] : [])] } } });
    const role = await db.role.create({ data: { organizationId: home.id, code: randomUUID(), name: 'Explicit source', permissions: { create: permissions.map(p => ({ permissionId: p.id })) } } });
    const admin = await db.user.create({ data: { organizationId: home.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL', userRoles: { create: { organizationId: home.id, roleId: role.id } } } });
    const token = await sessions.create(admin.id, db, { mfaVerified: true, reauthenticated: true });
    const enterprise = await db.organization.create({ data: { code: randomUUID(), name: 'Unbound external enterprise', type: 'SUPPLIER' } });
    const user = await db.user.create({ data: { organizationId: enterprise.id, username: randomUUID(), passwordHash: 'unused', accountType: 'SUPPLIER' } });
    return { home, role, admin, enterprise, user, cookie: `qms_session=${token}; qms_csrf=supplier-lifecycle` };
  }
  it('finds and deletes an exact unbound supplier account without an active business-profile owner', async () => {
    const f = await fixture();
    const listing = await request(app.getHttpServer()).get(`/api/v1/admin/supplier-accounts?search=${f.user.username}&pageSize=1`).set('Cookie', f.cookie).expect(200);
    expect(listing.body).toMatchObject({ total: 1, items: [expect.objectContaining({ id: f.user.id, organizationId: f.enterprise.id, securityVersion: f.user.securityVersion })] });
    expect(JSON.stringify(listing.body)).not.toMatch(/passwordHash|tokenHash|temporaryPassword|permissionCodes|mfaEnabled|phone|emailVerifiedAt/);
    const path = `/api/v1/admin/supplier-accounts/${f.user.id}?organizationId=${f.enterprise.id}`, key = randomUUID();
    const remove = () => request(app.getHttpServer()).delete(path).set('Cookie', f.cookie).set('x-csrf-token', 'supplier-lifecycle').set('Idempotency-Key', key).send({ expectedSecurityVersion: f.user.securityVersion });
    const initial = (await remove().expect(200)).body;
    expect(initial).toMatchObject({ userId: f.user.id, deleted: true });
    expect((await remove().expect(200)).body).toEqual(initial);
    expect(await db.organization.findUniqueOrThrow({ where: { id: f.enterprise.id } })).toEqual(f.enterprise);
    expect((await request(app.getHttpServer()).get(`/api/v1/admin/supplier-accounts?search=${f.user.username}`).set('Cookie', f.cookie).expect(200)).body.total).toBe(0);
    await db.userRole.deleteMany({ where: { userId: f.admin.id } });
    await remove().expect(403);
  });
  it('denies ordinary and portal callers and preserves the exact account when scope or version is wrong', async () => {
    const ordinary = await fixture(false);
    await request(app.getHttpServer()).get('/api/v1/admin/supplier-accounts').set('Cookie', ordinary.cookie).expect(403);
    const portal = await sessions.create(ordinary.user.id, db, { mfaVerified: true });
    await request(app.getHttpServer()).get('/api/v1/admin/supplier-accounts').set('Cookie', `qms_session=${portal}`).expect(403);
    await request(app.getHttpServer()).get('/api/v1/admin/supplier-accounts').expect(401);
    const f = await fixture();
    for (const [organizationId, version, status] of [[ordinary.enterprise.id, f.user.securityVersion, 404], [f.enterprise.id, f.user.securityVersion + 1, 409]] as const) {
      await request(app.getHttpServer()).delete(`/api/v1/admin/supplier-accounts/${f.user.id}?organizationId=${organizationId}`).set('Cookie', f.cookie)
        .set('x-csrf-token', 'supplier-lifecycle').set('Idempotency-Key', randomUUID()).send({ expectedSecurityVersion: version }).expect(status);
    }
    expect(await db.user.findUniqueOrThrow({ where: { id: f.user.id } })).toEqual(f.user);
  });
});
