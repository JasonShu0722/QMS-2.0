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
  };
  const prisma = {
    $transaction: jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(prisma)),
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    user: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    organization: { findUnique: jest.fn() },
    session: { findUnique: jest.fn(), updateMany: jest.fn() },
    userRole: { count: jest.fn(), findFirst: jest.fn() },
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
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1', expiresAt: new Date(Date.now() + 60_000), revokedAt: null, user,
    });
    prisma.userRole.count.mockResolvedValue(1);
    prisma.userRole.findFirst.mockResolvedValue({ organizationId: user.organizationId });
    prisma.user.findMany.mockResolvedValue([]);
  });

  afterAll(async () => app.close());

  it('requires account permission before listing users', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/users').set('Cookie', 'qms_session=browser-token').expect(200);
    prisma.userRole.count.mockResolvedValue(0);
    await request(app.getHttpServer()).get('/api/v1/admin/users').set('Cookie', 'qms_session=browser-token').expect(403);
  });

  it('requires CSRF for administrator user creation', async () => {
    const body = { organizationId: user.organizationId, username: 'new.user', accountType: 'INTERNAL', initialPassword: 'new-password-1234' };
    await request(app.getHttpServer()).post('/api/v1/admin/users').set('Cookie', 'qms_session=browser-token').send(body).expect(403);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});
