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
import { createDisposableAppDatabase } from '../disposable-app-database.js';
import { domainFixture } from '../common/internal-eight-d-domains.fixture.js';
import { AdminUserLifecycleService } from '../../src/modules/identity/admin-user-lifecycle.service.js';
import { AdministrativeProblemReconfigurationService } from '../../src/administrative-problem-reconfiguration.service.js';
import { AdministrativeProblemDomain, AdministrativeProblemDuty } from '../../src/administrative-problem-reconfiguration.dto.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Disposable loopback PostgreSQL required, never 55440.');
describe('problem responsibility reconfiguration public administrative HTTP', () => {
  let app: INestApplication, db: PrismaService, sessions: SessionService;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = await createDisposableAppDatabase('qms_admin_problem_http');
  }, 120000);
  beforeAll(async () => {
    expect(process.env.DATABASE_URL).not.toBe(originalDatabaseUrl);
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init(); db = app.get(PrismaService); sessions = app.get(SessionService);
  });
  afterAll(async () => {
    try { await app?.close(); }
    finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });
  async function actor(marker: boolean) {
    const org = await db.organization.create({ data: { code: randomUUID(), name: 'Administrative survivor', type: 'INTERNAL' } });
    const user = await db.user.create({ data: { organizationId: org.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    const codes = ['organization:reconfigure', ...(marker ? ['platform:admin'] : [])];
    const permissions = await db.permission.findMany({ where: { code: { in: codes } } });
    const role = await db.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Actual source', permissions: { create: permissions.map(p => ({ permissionId: p.id })) } } });
    await db.userRole.create({ data: { organizationId: org.id, userId: user.id, roleId: role.id } });
    const token = await sessions.create(user.id, db, { mfaVerified: true, reauthenticated: true });
    return { org, user, role, actor: { id: user.id, organizationId: org.id, accountType: 'INTERNAL' as const, sessionId: (await sessions.resolve(token))!.id }, cookie: `qms_session=${token}; qms_csrf=admin-problem-reconfiguration` };
  }
  it('exposes each actual domain-owned pending window to the verified platform administrator only', async () => {
    const f = await actor(true);
    for (const domain of ['PROCESS', 'CUSTOMER', 'NEW_PRODUCT', 'SUPPLIER']) {
      const response = await request(app.getHttpServer()).get(`/api/v1/admin/problem-reconfiguration/${domain}?pageSize=1&offset=0`).set('Cookie', f.cookie).expect(200);
      expect(response.body).toMatchObject({ pageSize: 1, offset: 0, items: expect.any(Array) });
      expect(response.body).toHaveProperty('nextOffset');
      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
      await request(app.getHttpServer()).get(`/api/v1/admin/problem-reconfiguration/${domain}?pageSize=20&offset=10020`).set('Cookie', f.cookie).expect(200);
    }
    const ordinary = await actor(false);
    await request(app.getHttpServer()).get('/api/v1/admin/problem-reconfiguration/PROCESS').set('Cookie', ordinary.cookie).expect(403);
    await request(app.getHttpServer()).get('/api/v1/admin/problem-reconfiguration/PROCESS').expect(401);
  });
  it('rejects unbounded/unknown selection and never manufactures a replacement or actor', async () => {
    const f = await actor(true);
    await request(app.getHttpServer()).get('/api/v1/admin/problem-reconfiguration/UNKNOWN').set('Cookie', f.cookie).expect(400);
    await request(app.getHttpServer()).get('/api/v1/admin/problem-reconfiguration/PROCESS?pageSize=1000').set('Cookie', f.cookie).expect(400);
    await request(app.getHttpServer()).post(`/api/v1/admin/problem-reconfiguration/PROCESS/${randomUUID()}`).set('Cookie', f.cookie)
      .set('x-csrf-token', 'admin-problem-reconfiguration').set('Idempotency-Key', randomUUID()).send({ expectedVersion: 1, actorId: f.user.id }).expect(400);
  });
  it('uses a real new professional, replays only the original command, and rechecks revoked platform authority', async () => {
    const admin = await actor(true), f = await domainFixture(app, 'customer-quality');
    const problemId = await f.issue([f.chainSource]);
    const nextProfessional = await f.person(f.dept.id);
    const old = await db.user.findUniqueOrThrow({ where: { id: f.professional.user.id } });
    await app.get(AdminUserLifecycleService).deleteUser(admin.actor, old.id, { expectedSecurityVersion: old.securityVersion }, f.org.id, randomUUID(), randomUUID());
    const pending = await request(app.getHttpServer()).get('/api/v1/admin/problem-reconfiguration/CUSTOMER?pageSize=100').set('Cookie', admin.cookie).expect(200);
    const item = pending.body.items.find((row: { problemId: string }) => row.problemId === problemId);
    expect(item).toBeDefined();
    const candidates = await request(app.getHttpServer()).get(`/api/v1/admin/problem-reconfiguration/CUSTOMER/assignments?organizationId=${f.org.id}&duty=PROFESSIONAL&pageSize=100`).set('Cookie', admin.cookie).expect(200);
    expect(candidates.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ assignmentId: nextProfessional.assignment.id, userId: nextProfessional.user.id })]));
    expect(candidates.body.items.some((row: { userId: string }) => row.userId === old.id)).toBe(false);
    expect(JSON.stringify(candidates.body)).not.toContain('securityVersion');
    const path = `/api/v1/admin/problem-reconfiguration/CUSTOMER/${problemId}`, key = randomUUID();
    const input = { expectedVersion: item.version, professionalAssignmentId: nextProfessional.assignment.id };
    const send = () => request(app.getHttpServer()).post(path).set('Cookie', admin.cookie).set('x-csrf-token', 'admin-problem-reconfiguration').set('Idempotency-Key', key).send(input);
    const initial = await send().expect(201);
    expect(initial.body).toMatchObject({ problemId, originalOrganizationId: f.org.id, professionalUserId: nextProfessional.user.id, status: 'PROCESSING' });
    expect((await send().expect(201)).body).toEqual(initial.body);
    const scoped = { ...admin.actor, scopeOrganizationId: randomUUID() };
    const root = app.get(AdministrativeProblemReconfigurationService);
    await expect(root.reconfigure(scoped, AdministrativeProblemDomain.CUSTOMER, problemId, input, randomUUID(), key)).rejects.toMatchObject({ status: 403 });
    await expect(root.assignments(scoped, AdministrativeProblemDomain.CUSTOMER, { organizationId: f.org.id,
      duty: AdministrativeProblemDuty.PROFESSIONAL, pageSize: 10, offset: 0 })).rejects.toMatchObject({ status: 403 });
    const marker = await db.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
    await db.rolePermission.delete({ where: { roleId_permissionId: { roleId: admin.role.id, permissionId: marker.id } } });
    await send().expect(403);
    expect(await db.adminMutation.count({ where: { actorUserId: admin.user.id, key } })).toBe(1);
  });
  it('uses actual supplier duty permissions rather than requiring issue permission from a replacement SQE', async () => {
    const admin = await actor(true), target = await actor(false);
    await db.rolePermission.deleteMany({ where: { roleId: target.role.id } });
    const permissions = await db.permission.findMany({ where: { code: { in: ['supplier-quality:issues:read', 'supplier-quality:issues:work', 'workflow:act'] } } });
    await db.rolePermission.createMany({ data: permissions.map(p => ({ roleId: target.role.id, permissionId: p.id })) });
    const department = await db.department.create({ data: { organizationId: target.org.id, code: randomUUID(), name: 'Qualified SQE section' } });
    const position = await db.position.create({ data: { organizationId: target.org.id, departmentId: department.id, code: randomUUID(), name: 'Actual SQE position' } });
    const assignment = await db.userPosition.create({ data: { organizationId: target.org.id, userId: target.user.id, positionId: position.id, startedAt: new Date(Date.now() - 1000) } });
    const result = await request(app.getHttpServer()).get(`/api/v1/admin/problem-reconfiguration/SUPPLIER/assignments?organizationId=${target.org.id}&duty=PROFESSIONAL`).set('Cookie', admin.cookie).expect(200);
    expect(result.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ assignmentId: assignment.id, userId: target.user.id })]));
  });
});
