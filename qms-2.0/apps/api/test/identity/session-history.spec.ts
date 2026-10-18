import 'reflect-metadata';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { createOpenApiDocument } from '../../src/openapi.js';

describe('account session history HTTP behavior', () => {
  let app: INestApplication;
  const user = {
    id: '10000000-0000-4000-8000-000000000001', organizationId: '20000000-0000-4000-8000-000000000001',
    status: 'ACTIVE', accountType: 'INTERNAL', mfaEnabled: false, mfaPreference: 'DEFAULT',
    securityVersion: 1, mustChangePassword: false, organization: { status: 'ACTIVE' },
  };
  const now = new Date();
  const future = new Date(now.getTime() + 3_600_000);
  const past = new Date(now.getTime() - 3_600_000);
  const rows = [
    { id: 'current', createdAt: now, expiresAt: future, revokedAt: null, lifetimeType: 'STANDARD' },
    { id: 'revoked', createdAt: past, expiresAt: past, revokedAt: past, lifetimeType: 'REMEMBERED_ADMIN' },
    { id: 'expired', createdAt: past, expiresAt: past, revokedAt: null, lifetimeType: 'REMEMBERED_USER' },
    { id: 'other-active', createdAt: past, expiresAt: future, revokedAt: null, lifetimeType: 'STANDARD' },
  ];
  const prisma = {
    $transaction: jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(prisma)),
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    userRole: { findMany: jest.fn().mockResolvedValue([]) },
    session: {
      findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue(rows),
      count: jest.fn().mockResolvedValue(rows.length),
    },
  };
  const history = (query = '') => request(app.getHttpServer()).get(`/api/v1/me/sessions/history${query}`).set('Cookie', 'qms_session=unit-token');

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.session.findUnique.mockResolvedValue({ ...rows[0], user, securityVersion: 1 });
    prisma.session.findMany.mockResolvedValue(rows);
    prisma.session.count.mockResolvedValue(rows.length);
  });
  afterAll(async () => { await app?.close(); });

  it('returns default pagination, lifetime types and revoked-before-expired status from safe columns', async () => {
    const response = await history().expect(200);
    expect(response.body).toEqual({
      items: rows.map((row) => ({
        ...row, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
        revokedAt: row.revokedAt?.toISOString() ?? null, isCurrent: row.id === 'current',
        status: row.revokedAt ? 'REVOKED' : row.expiresAt <= now ? 'EXPIRED' : 'ACTIVE',
      })), total: 4, page: 1, pageSize: 20,
    });
    expect(prisma.session.findMany).toHaveBeenCalledWith({
      where: { userId: user.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 0, take: 20,
      select: { id: true, createdAt: true, expiresAt: true, revokedAt: true, lifetimeType: true },
    });
    expect(prisma.session.count).toHaveBeenCalledWith({ where: { userId: user.id } });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' });
  });

  it.each([
    ['?page=2&pageSize=3', 2, 3, 3], ['?page=1000000&pageSize=100', 1_000_000, 100, 99_999_900],
    ['?page=1&pageSize=1', 1, 1, 0],
  ])('converts bounded numeric query %s', async (query, page, pageSize, skip) => {
    prisma.session.findMany.mockResolvedValue([]);
    const response = await history(query).expect(200);
    expect(response.body).toEqual({ items: [], total: 4, page, pageSize });
    expect(prisma.session.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip, take: pageSize }));
  });

  it.each([
    'page=0', 'page=-1', 'page=1.5', 'page=1000001', 'page=NaN', 'page=Infinity', 'page=', 'page=1&page=2',
    'pageSize=0', 'pageSize=-1', 'pageSize=1.5', 'pageSize=101', 'pageSize=no', 'pageSize=', 'pageSize=1&pageSize=2',
    'userId=other', 'organizationId=other', 'accountType=SUPPLIER', 'status=ACTIVE',
  ])('rejects invalid or unsupported query %s before reading history', async (query) => {
    await history(`?${query}`).expect(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.session.findMany).not.toHaveBeenCalled();
  });

  it('requires a complete session', async () => {
    await request(app.getHttpServer()).get('/api/v1/me/sessions/history').expect(401);
    prisma.session.findUnique.mockResolvedValue(null);
    await history().expect(401);
    expect(prisma.session.findMany).not.toHaveBeenCalled();
  });

  it('propagates a failed history transaction as a controlled error without leaking database diagnostics', async () => {
    prisma.session.count.mockRejectedValueOnce(new Error('private SQL and tokenHash'));
    const response = await history().expect(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toMatch(/private SQL|tokenHash/);
  });

  it('describes the paginated history and inherited safe item fields in Swagger', () => {
    const document = createOpenApiDocument(app);
    const operation = document.paths['/api/v1/me/sessions/history']?.get;
    expect(operation).toBeDefined();
    expect(operation?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'page', in: 'query', schema: expect.objectContaining({ default: 1, minimum: 1, maximum: 1_000_000 }) }),
      expect.objectContaining({ name: 'pageSize', in: 'query', schema: expect.objectContaining({ default: 20, minimum: 1, maximum: 100 }) }),
    ]));
    expect(operation?.responses['200']).toMatchObject({ content: { 'application/json': { schema: { $ref: '#/components/schemas/AccountSessionHistoryPageDto' } } } });
    expect(document.components?.schemas?.AccountSessionHistoryPageDto).toMatchObject({ properties: {
      items: { type: 'array', items: { $ref: '#/components/schemas/AccountSessionHistoryItemDto' } },
      total: { type: 'number' }, page: { type: 'number' }, pageSize: { type: 'number' },
    } });
    expect(document.components?.schemas?.AccountSessionHistoryItemDto).toMatchObject({ properties: {
      id: { type: 'string' }, createdAt: { type: 'string' }, expiresAt: { type: 'string' },
      revokedAt: { type: 'string', nullable: true }, isCurrent: { type: 'boolean' },
      lifetimeType: { enum: ['STANDARD', 'REMEMBERED_ADMIN', 'REMEMBERED_USER'] },
      status: { enum: ['ACTIVE', 'REVOKED', 'EXPIRED'] },
    } });
  });
});
