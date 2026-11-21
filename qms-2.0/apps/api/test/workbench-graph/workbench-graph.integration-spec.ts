import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SESSION_COOKIE, SessionService } from '../../src/modules/identity/session.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') {
  throw new Error('Workbench graph requires disposable loopback PostgreSQL; preview 55440 is forbidden.');
}

jest.setTimeout(60_000);

describe('workbench graph with persisted sessions', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const organizationIds: string[] = [];
  const path = '/api/v1/workbench/graph';

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    try {
      if (prisma && organizationIds.length) {
        const scope = { organizationId: { in: organizationIds } };
        await prisma.auditEvent.deleteMany({ where: scope });
        await prisma.user.deleteMany({ where: scope });
        await prisma.role.deleteMany({ where: scope });
        await prisma.organization.deleteMany({ where: { id: scope.organizationId } });
      }
    } finally { await app?.close(); }
  });

  async function organization(type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const org = await prisma.organization.create({ data: { code: randomUUID(), name: 'Workbench graph fixture', type } });
    organizationIds.push(org.id);
    return org;
  }

  async function identity(org: Awaited<ReturnType<typeof organization>>, admin = false) {
    const user = await prisma.user.create({ data: { organizationId: org.id, username: randomUUID(), accountType: org.type, passwordHash: 'not-a-login-fixture' } });
    if (admin) {
      const marker = await prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
      const role = await prisma.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Platform admin fixture', permissions: { create: { permissionId: marker.id } } } });
      await prisma.userRole.create({ data: { organizationId: org.id, userId: user.id, roleId: role.id } });
    }
    const token = await app.get(SessionService).create(user.id, prisma, { mfaVerified: admin, reauthenticated: admin });
    return { user, cookie: `${SESSION_COOKIE}=${token}` };
  }

  it('serves the same complete graph to staff and platform admin without granting admin access', async () => {
    const org = await organization();
    const staff = await identity(org);
    const admin = await identity(org, true);
    const http = request(app.getHttpServer());
    const staffGraph = await http.get(path).set('Cookie', staff.cookie).expect(200).expect('Cache-Control', 'no-store');
    const adminGraph = await http.get(path).set('Cookie', admin.cookie).expect(200).expect('Cache-Control', 'no-store');
    expect(staffGraph.body).toEqual(adminGraph.body);
    expect(staffGraph.body.nodes.length).toBeGreaterThan(0);
    const guardedRoute = '/api/v1/admin/integrations/endpoints';
    await http.get(guardedRoute).set('Cookie', staff.cookie).expect(403);
    await http.get(guardedRoute).set('Cookie', admin.cookie).expect(200);
  });

  it('rejects unauthenticated and supplier identities', async () => {
    const supplier = await identity(await organization('SUPPLIER'));
    const http = request(app.getHttpServer());
    await http.get(path).expect(401);
    await http.get(path).set('Cookie', supplier.cookie).expect(403);
  });

  it.each(['disabled user', 'mandatory password change', 'disabled organization'] as const)('rejects an existing session after %s', async (condition) => {
    const org = await organization();
    const { user, cookie } = await identity(org);
    const http = request(app.getHttpServer());
    await http.get(path).set('Cookie', cookie).expect(200);
    if (condition === 'disabled organization') {
      await prisma.organization.update({ where: { id: org.id }, data: { status: 'DISABLED' } });
    } else {
      await prisma.user.update({ where: { id: user.id }, data: condition === 'disabled user' ? { status: 'DISABLED' } : { mustChangePassword: true } });
    }
    await http.get(path).set('Cookie', cookie).expect(401);
  });
});
