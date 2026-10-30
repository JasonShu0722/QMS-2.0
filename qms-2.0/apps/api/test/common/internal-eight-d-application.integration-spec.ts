import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { CustomerEightDService } from '../../src/modules/customer-quality/customer-eight-d.service.js';
import { NewProductEightDService } from '../../src/modules/new-product-quality/new-product-eight-d.service.js';
import { CUSTOMER_EIGHT_D_RUNTIME, NEW_PRODUCT_EIGHT_D_RUNTIME, type InternalEightDRuntime } from '../../src/common/eight-d/internal-eight-d-runtime.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { APPLICATION_OUTBOX_HANDLER, type AtomicOutboxHandler } from '../../src/modules/task-notification/outbox-worker.service.js';
import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { domainFixture } from './internal-eight-d-domains.fixture.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Internal domain application validation requires disposable loopback PostgreSQL.');
}

it('boots both real domain runtimes and protects their public read, report and task routes', async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = module.createNestApplication();
  try {
    await app.init();
    expect(app.get(CustomerEightDService).core.domain.domainCode).toBe('customer-quality');
    expect(app.get(NewProductEightDService).core.domain.domainCode).toBe('new-product-quality');
    const handler = app.get<AtomicOutboxHandler>(APPLICATION_OUTBOX_HANDLER);
    expect(handler.eventTypes).toEqual(expect.arrayContaining(['CUSTOMER_EIGHT_D_REMINDER_DUE', 'NEW_PRODUCT_EIGHT_D_REMINDER_DUE']));
    for (const [domain, token] of [['customer-quality', CUSTOMER_EIGHT_D_RUNTIME], ['new-product-quality', NEW_PRODUCT_EIGHT_D_RUNTIME]] as const) {
      const runtime = app.get<InternalEightDRuntime>(token);
      expect(runtime.core.domain.domainCode).toBe(domain);
      for (const suffix of ['binding', 'tasks', 'notifications', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000/report']) {
        await request(app.getHttpServer()).get(`/api/v1/${domain}/eight-d/${suffix}`).expect(401);
      }
    }
  } finally { await app.close(); }
});

it('lists ordinary direct customer collaborators consistently with writes without widening section duties', async () => {
  const app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  try {
    await app.init();
    const f = await domainFixture(app, 'customer-quality'), id = await f.issue([f.chainSource]), direct = await f.person(f.section.id);
    const prisma = f.prisma;
    await prisma.position.update({ where: { id: direct.position.id }, data: { departmentId: null } });
    await prisma.userRole.deleteMany({ where: { userId: direct.user.id } });
    const permissions = await prisma.permission.findMany({ where: { code: { in: ['customer-quality:issues:read', 'customer-quality:issues:work'] } } });
    expect(permissions).toHaveLength(2);
    const role = await prisma.role.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'Ordinary direct collaborator', permissions: { create: permissions.map(({ id: permissionId }) => ({ permissionId })) } } });
    await prisma.positionRole.create({ data: { organizationId: f.org.id, positionId: direct.position.id, roleId: role.id, isCanonical: true } });
    await f.service.collaborators(f.owner.actor, id, { expectedVersion: (await f.read(id)).version, userIds: [direct.user.id] }, randomUUID(), randomUUID());
    expect((await f.read(id)).collaboratorUserIds).toEqual([direct.user.id]);
    const cookie = `qms_session=${await app.get(SessionService).create(f.owner.user.id, prisma, { reauthenticated: true, mfaVerified: true })}`;
    const options = async (action = 'COLLABORATORS', extra: Record<string, string> = {}) => (await request(app.getHttpServer())
      .get(`/api/v1/customer-quality/eight-d/assignment-options?${new URLSearchParams({ action, ...(action === 'ISSUE' ? {} : { problemId: id }), search: direct.user.username, pageSize: '1', ...extra })}`)
      .set('Cookie', cookie).expect(200)).body;
    expect(await options()).toMatchObject({ users: [{ id: direct.user.id, username: direct.user.username, fullName: null }], userTotal: 1 });
    expect(await options('COLLABORATORS', { page: '2' })).toMatchObject({ users: [], userTotal: 1 });
    expect(await options('COLLABORATORS', { sectionDepartmentId: f.section.id })).toMatchObject({ users: [], userTotal: 0 });
    for (const action of ['ISSUE', 'REASSIGN']) expect(await options(action)).toMatchObject({ users: [], userTotal: 0 });
    await prisma.user.update({ where: { id: direct.user.id }, data: { status: 'DISABLED' } });
    expect((await options()).userTotal).toBe(0);
    await prisma.user.update({ where: { id: direct.user.id }, data: { status: 'ACTIVE' } });
    await prisma.userPosition.update({ where: { id: direct.assignment.id }, data: { startedAt: new Date(Date.now() + 60_000) } });
    expect((await options()).userTotal).toBe(0);
    await prisma.userPosition.update({ where: { id: direct.assignment.id }, data: { startedAt: direct.assignment.startedAt, endedAt: new Date() } });
    expect((await options()).userTotal).toBe(0);
    await prisma.userPosition.update({ where: { id: direct.assignment.id }, data: { endedAt: null } });
    await prisma.position.update({ where: { id: direct.position.id }, data: { status: 'DISABLED', configurationRequired: true } });
    expect((await options()).userTotal).toBe(0);
    await prisma.position.update({ where: { id: direct.position.id }, data: { status: 'ACTIVE', configurationRequired: false } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permission: { code: 'customer-quality:issues:work' } } });
    expect((await options()).userTotal).toBe(0);
    await expect(f.service.collaborators(f.owner.actor, id, { expectedVersion: (await f.read(id)).version, userIds: [direct.user.id] }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
  } finally { await app.close(); }
}, 120_000);
