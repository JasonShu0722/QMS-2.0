import 'reflect-metadata';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';

describe('administrator role HTTP contract', () => {
  let app: INestApplication;
  const organizationId = '20000000-0000-4000-8000-000000000001';
  const roleId = '30000000-0000-4000-8000-000000000001';
  const user = { id: '10000000-0000-4000-8000-000000000001', organizationId, accountType: 'INTERNAL', status: 'ACTIVE', organization: { status: 'ACTIVE' } };
  const prisma = {
    $transaction: jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(prisma)),
    $queryRaw: jest.fn(),
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    role: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    permission: { findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    organization: { findUnique: jest.fn() },
    adminMutation: { findUnique: jest.fn(), create: jest.fn() },
    session: { findUnique: jest.fn(), findFirst: jest.fn() },
    userRole: { count: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
  };
  const cookies = 'qms_session=browser-token; qms_csrf=csrf-token';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.organization.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.adminMutation.findUnique.mockResolvedValue(null);
    prisma.session.findUnique.mockResolvedValue({ id: 'session', mfaVerifiedAt: new Date(), reauthenticatedAt: new Date(), expiresAt: new Date(Date.now() + 60_000), revokedAt: null, user });
    prisma.session.findFirst.mockResolvedValue({ id: 'session', mfaVerifiedAt: new Date(), reauthenticatedAt: new Date() });
    prisma.userRole.count.mockResolvedValue(1);
    prisma.userRole.findFirst.mockResolvedValue({ organizationId });
    prisma.userRole.findMany.mockResolvedValue([{ role: { permissions: ['account:roles:read', 'account:roles:create', 'account:roles:update', 'account:roles:delete', 'account:roles:assign'].map((code) => ({ permission: { code } })) } }]);
    prisma.role.findMany.mockResolvedValue([]);
    prisma.permission.findMany.mockResolvedValue([]);
    prisma.role.create.mockResolvedValue({ id: roleId, organizationId, code: 'QUALITY', name: 'Quality', permissions: [] });
  });

  afterAll(async () => app.close());

  it('returns ordered module groups with supplier-quality grantable codes', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/admin/permission-catalog').set('Cookie', cookies).expect(200);
    expect(response.body.map((group: { key: string }) => group.key)).toEqual(['platform', 'supplier', 'process', 'customer', 'new-product', 'audit', 'system']);
    const supplier = response.body[1];
    expect(supplier.status).toBe('active');
    expect(supplier.modules.find((module: { key: string }) => module.key === 'supplier-problems').operations.map((operation: { code: string }) => operation.code)).toEqual(['supplier-quality:problems:read', 'supplier-quality:problems:write']);
    for (const group of response.body.slice(2, 6)) {
      expect(group.status).toBe('planned');
      expect(group.modules.length).toBeGreaterThan(0);
      for (const module of group.modules) expect(module.operations).toEqual([]);
    }
  });

  it('requires authentication and feature permission for directory and roles', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/roles').expect(401);
    await request(app.getHttpServer()).get('/api/v1/admin/permissions').set('Cookie', cookies).expect(200);
    prisma.userRole.count.mockResolvedValue(0);
    await request(app.getHttpServer()).get('/api/v1/admin/roles').set('Cookie', cookies).expect(403);
  });

  it('checks feature permission in the requested organization, even when the guard accepted membership', async () => {
    prisma.userRole.findMany.mockResolvedValue([]);
    for (const endpoint of ['/roles', '/permissions', `/roles/${roleId}`, `/users/${user.id}/roles`]) {
      await request(app.getHttpServer()).get(`/api/v1/admin${endpoint}?organizationId=${organizationId}`).set('Cookie', cookies).expect(403);
    }
  });

  it('rejects management without CSRF and accepts a valid role creation', async () => {
    const body = { organizationId, code: 'QUALITY', name: 'Quality', permissionCodes: [] };
    await request(app.getHttpServer()).post('/api/v1/admin/roles').set('Cookie', cookies).send(body).expect(403);
    await request(app.getHttpServer()).post('/api/v1/admin/roles').set('Cookie', cookies).set('x-csrf-token', 'csrf-token').set('Idempotency-Key', 'test-key-1').send(body).expect(201);
    expect(prisma.role.create).toHaveBeenCalledTimes(1);
  });

  it('rejects UUID, blank name, duplicate permissions and unrecognized fields', async () => {
    const valid = { organizationId, code: 'QUALITY', name: 'Quality', permissionCodes: [] };
    for (const body of [
      { ...valid, organizationId: 'not-a-uuid' },
      { ...valid, name: '   ' },
      { ...valid, permissionCodes: ['workbench:read', 'workbench:read'] },
      { ...valid, arbitraryScript: 'script' },
    ]) {
      await request(app.getHttpServer()).post('/api/v1/admin/roles').set('Cookie', cookies).set('x-csrf-token', 'csrf-token').set('Idempotency-Key', 'test-key-1').send(body).expect(400);
    }
    expect(prisma.role.create).not.toHaveBeenCalled();
  });

  it('does not expose a permission directory write endpoint', async () => {
    await request(app.getHttpServer()).post('/api/v1/admin/permissions').set('Cookie', cookies).set('x-csrf-token', 'csrf-token').set('Idempotency-Key', 'test-key-1').send({ code: 'new:permission' }).expect(404);
  });

  it('rejects explicit nulls in optional role update fields', async () => {
    for (const body of [{ name: null }, { permissionCodes: null }]) {
      await request(app.getHttpServer()).patch(`/api/v1/admin/roles/${roleId}`).set('Cookie', cookies).set('x-csrf-token', 'csrf-token').set('Idempotency-Key', 'test-key-1').send(body).expect(400);
    }
  });
});
