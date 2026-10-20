import 'reflect-metadata';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';

describe('administrator user lifecycle HTTP contract', () => {
  let app: INestApplication;
  const user = {
    id: '10000000-0000-4000-8000-000000000001', organizationId: '20000000-0000-4000-8000-000000000001',
    username: 'internal.admin', email: 'internal@example.test', passwordHash: 'encoded',
    accountType: 'INTERNAL', status: 'ACTIVE', mfaEnabled: false,
    organization: { status: 'ACTIVE' },
  };
  const prisma = {
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(prisma)),
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    user: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    organization: { findUnique: jest.fn() },
    session: { findUnique: jest.fn(), updateMany: jest.fn() },
    userRole: { count: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.organization.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.userRole.findMany.mockImplementation(async ({ where }) => where.organizationId && where.organizationId !== user.organizationId ? [] : [{ organizationId: user.organizationId, role: { id: 'admin-role', organizationId: user.organizationId, permissions: ['account:users:read', 'account:users:create', 'account:users:update', 'account:users:status', 'account:users:transfer', 'account:users:reset'].map((code) => ({ permission: { code } })) } }]);
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1', mfaVerifiedAt: new Date(), reauthenticatedAt: new Date(), expiresAt: new Date(Date.now() + 60_000), revokedAt: null, user,
    });
    prisma.userRole.count.mockResolvedValue(1);
    prisma.userRole.findFirst.mockResolvedValue({ organizationId: user.organizationId });
    prisma.user.findMany.mockResolvedValue([]);
  });

  afterAll(async () => app.close());

  it('requires account permission before listing users', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/users').set('Cookie', 'qms_session=browser-token').expect(200);
    prisma.userRole.findMany.mockResolvedValue([{ organizationId: user.organizationId, role: { id: 'reader', organizationId: user.organizationId, permissions: [] } }]);
    await request(app.getHttpServer()).get('/api/v1/admin/users').set('Cookie', 'qms_session=browser-token').expect(403);
  });

  it('requires CSRF for administrator user creation', async () => {
    const body = { organizationId: user.organizationId, username: 'new.user', accountType: 'INTERNAL', initialPassword: 'new-password-1234' };
    await request(app.getHttpServer()).post('/api/v1/admin/users').set('Cookie', 'qms_session=browser-token').send(body).expect(403);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'status-only', body: { status: 'DISABLED' }, granted: [], denied: 'account:users:status' },
    { name: 'transfer-only', body: { accountType: 'SUPPLIER' }, granted: [], denied: 'account:users:transfer' },
    { name: 'mixed email and status', body: { email: 'private@example.test', status: 'DISABLED' }, granted: ['account:users:update'], denied: 'account:users:status' },
  ])('audits the denied operation for a $name PATCH', async ({ body, granted, denied }) => {
    prisma.userRole.findMany.mockResolvedValue([{ organizationId: user.organizationId, role: { id: 'patch-role', organizationId: user.organizationId, permissions: granted.map((code) => ({ permission: { code } })) } }]);

    const response = await request(app.getHttpServer()).patch(`/api/v1/admin/users/${user.id}`)
      .set('Cookie', 'qms_session=browser-token; qms_csrf=csrf-token')
      .set('x-csrf-token', 'csrf-token').send(body).expect(403);

    expect(response.body.code).toBe('FEATURE_PERMISSION_DENIED');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorUserId: user.id, organizationId: user.organizationId,
      action: 'ACTION_REJECTED', resourceType: 'Authorization', outcome: 'DENIED',
      traceId: response.body.traceId,
      metadata: { permissionCode: denied, reasonCode: 'FEATURE_PERMISSION_DENIED' },
    }) });
  });

  it.each([
    { name: 'unassigned', query: `organizationId=20000000-0000-4000-8000-000000000002`, status: 403, reasonCode: 'ORGANIZATION_SCOPE_DENIED' },
    { name: 'ambiguous', query: 'organizationId=first&organizationId=second', status: 400, reasonCode: 'ORGANIZATION_SCOPE_AMBIGUOUS' },
  ])('audits resolved operations when organization scope is $name', async ({ query, status, reasonCode }) => {
    prisma.userRole.findFirst.mockResolvedValue(null);

    const response = await request(app.getHttpServer()).patch(`/api/v1/admin/users/${user.id}?${query}`)
      .set('Cookie', 'qms_session=browser-token; qms_csrf=csrf-token')
      .set('x-csrf-token', 'csrf-token')
      .send({ status: 'DISABLED', accountType: 'SUPPLIER' }).expect(status);

    expect(response.body.code).toBe(reasonCode);
    expect(prisma.userRole.count).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'ACTION_REJECTED', resourceType: 'Authorization', outcome: 'DENIED',
      traceId: response.body.traceId,
      metadata: { permissionCode: 'account:users:status,account:users:transfer', reasonCode },
    }) });
  });
});
