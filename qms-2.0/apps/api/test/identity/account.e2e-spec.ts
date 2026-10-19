import 'reflect-metadata';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';

describe('account center HTTP contract', () => {
  let app: INestApplication;
  const user = {
    id: '10000000-0000-4000-8000-000000000001', organizationId: '20000000-0000-4000-8000-000000000001',
    username: 'internal.admin', email: 'internal@example.test', passwordHash: 'encoded',
    accountType: 'INTERNAL', status: 'ACTIVE', mfaEnabled: false, avatarFileId: null, avatarVersion: 1,
    organization: { status: 'ACTIVE' },
  };
  const prisma = {
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(prisma)),
    $queryRaw: jest.fn(),
    userRole: { findMany: jest.fn().mockResolvedValue([]) },
    organization: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    user: { findUnique: jest.fn(), update: jest.fn() },
    session: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
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
    prisma.session.findFirst.mockResolvedValue({ id: 'session-1', reauthenticatedAt: new Date() });
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1', expiresAt: new Date(Date.now() + 60_000), revokedAt: null, user,
    });
    prisma.user.findUnique.mockResolvedValue({ ...user, organization: { id: user.organizationId, status: 'ACTIVE', code: 'internal', name: 'Internal' } });
    prisma.session.findMany.mockResolvedValue([{ id: 'session-1', createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000), revokedAt: null }]);
    prisma.session.updateMany.mockResolvedValue({ count: 1 });
  });

  afterAll(async () => app.close());

  it('requires a session and returns a safe profile and session list', async () => {
    await request(app.getHttpServer()).get('/api/v1/me').expect(401);
    const profile = await request(app.getHttpServer()).get('/api/v1/me').set('Cookie', 'qms_session=browser-token').expect(200);
    expect(profile.body).toMatchObject({ id: user.id, username: user.username, organization: { id: user.organizationId } });
    expect(JSON.stringify(profile.body)).not.toMatch(/passwordHash|encoded/);

    const sessions = await request(app.getHttpServer()).get('/api/v1/me/sessions').set('Cookie', 'qms_session=browser-token').expect(200);
    expect(sessions.body[0]).toMatchObject({ id: 'session-1', isCurrent: true });
    expect(JSON.stringify(sessions.body)).not.toMatch(/tokenHash|browser-token/);
  });

  it('uses CSRF protection for profile writes', async () => {
    const csrf = await request(app.getHttpServer()).get('/api/v1/auth/csrf').expect(200);
    const cookie = (csrf.headers['set-cookie'] as unknown as string[]).find((entry) => entry.startsWith('qms_csrf='))!.split(';', 1)[0];
    await request(app.getHttpServer()).patch('/api/v1/me').set('Cookie', ['qms_session=browser-token', cookie]).send({ email: 'new@example.test' }).expect(403);
    await request(app.getHttpServer()).patch('/api/v1/me').set('Cookie', ['qms_session=browser-token', cookie]).set('x-csrf-token', cookie.split('=', 2)[1]).send({ email: 'new@example.test' }).expect(200);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: user.id }, data: { email: 'new@example.test' } });
  });
});
