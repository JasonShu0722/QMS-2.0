import 'reflect-metadata';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { PasswordHasherService } from '../../src/common/security/password-hasher.service.js';

const INTERNAL_USER = {
  id: '10000000-0000-4000-8000-000000000001',
  organizationId: '20000000-0000-4000-8000-000000000001',
  username: 'internal.admin',
  email: 'internal@example.test',
  accountType: 'INTERNAL',
  status: 'ACTIVE',
};

const SUPPLIER_USER = {
  id: '10000000-0000-4000-8000-000000000002',
  organizationId: '20000000-0000-4000-8000-000000000002',
  username: 'supplier.user',
  email: 'supplier@example.test',
  accountType: 'SUPPLIER',
  status: 'ACTIVE',
};

function cookieValue(cookies: string[], name: string): string {
  const cookie = cookies.find((entry) => entry.startsWith(`${name}=`));
  if (!cookie) throw new Error(`Missing ${name} cookie`);
  return cookie.split(';', 1)[0].slice(name.length + 1);
}

describe('identity HTTP contract', () => {
  let app: INestApplication;
  let passwordHash: string;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalRateLimitSecret = process.env.QMS_RATE_LIMIT_SECRET;
  const prisma = {
    user: { findFirst: jest.fn() },
    session: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.QMS_RATE_LIMIT_SECRET = 'identity-test-rate-limit-secret';
    passwordHash = await new PasswordHasherService().hash('Correct horse battery staple!');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.session.create.mockResolvedValue({ id: 'database-session-id' });
    prisma.session.updateMany.mockResolvedValue({ count: 1 });
  });

  afterAll(async () => {
    await app.close();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalRateLimitSecret === undefined) delete process.env.QMS_RATE_LIMIT_SECRET;
    else process.env.QMS_RATE_LIMIT_SECRET = originalRateLimitSecret;
  });

  async function csrf(): Promise<{ cookie: string; token: string }> {
    const response = await request(app.getHttpServer()).get('/api/v1/auth/csrf').expect(200);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(cookies.join(';')).not.toContain('HttpOnly');
    return {
      cookie: `qms_csrf=${cookieValue(cookies, 'qms_csrf')}`,
      token: cookieValue(cookies, 'qms_csrf'),
    };
  }

  it.each([
    [INTERNAL_USER, '/app/workbench'],
    [SUPPLIER_USER, '/supplier/inbox'],
  ])('routes %s accounts from server-owned identity', async (user, landingPath) => {
    prisma.user.findFirst.mockResolvedValue({ ...user, passwordHash });
    const protection = await csrf();

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Cookie', protection.cookie)
      .set('x-csrf-token', protection.token)
      .set('x-forwarded-for', `192.0.2.${user.accountType === 'INTERNAL' ? '10' : '11'}`)
      .send({ identifier: user.username, password: 'Correct horse battery staple!' })
      .expect(200);

    expect(response.body).toEqual({ accountType: user.accountType, landingPath });
    expect(JSON.stringify(response.body)).not.toMatch(/token|session|password|stack/i);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookies.find((entry) => entry.startsWith('qms_session='));
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/SameSite=Lax/i);
    expect(sessionCookie).toMatch(/Path=\//i);
    expect(sessionCookie).toMatch(/Secure/i);
    expect(prisma.session.create.mock.calls[0][0].data.tokenHash).not.toContain(
      cookieValue(cookies, 'qms_session'),
    );
  });

  it('uses one safe error for an unknown account and a wrong password', async () => {
    const protection = await csrf();
    prisma.user.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      ...INTERNAL_USER,
      passwordHash,
    });
    const attempt = (identifier: string, password: string, ip: string) =>
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Cookie', protection.cookie)
        .set('x-csrf-token', protection.token)
        .set('x-forwarded-for', ip)
        .send({ identifier, password });

    const unknown = await attempt('missing.user', 'wrong', '192.0.2.21').expect(401);
    const wrong = await attempt(INTERNAL_USER.username, 'wrong', '192.0.2.22').expect(401);

    expect(unknown.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(wrong.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(unknown.body.message).toBe(wrong.body.message);
    expect(JSON.stringify(unknown.body)).not.toMatch(/stack|sql|\\|passwordHash/i);
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ identifier: '', password: 'x' }],
    [{ identifier: 'valid.user', password: '' }],
    [{ identifier: 42, password: 'x' }],
    [null],
    [{ identifier: 'valid.user', password: 'x', unexpected: true }],
  ])('rejects malformed login payload %j with controlled validation response', async (payload) => {
    const protection = await csrf();
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Cookie', protection.cookie)
      .set('x-csrf-token', protection.token)
      .send(payload)
      .expect(400);

    expect(response.body.code).toBe('HTTP_400');
    expect(response.body.message).toBe('请求无法处理');
    expect(JSON.stringify(response.body)).not.toMatch(/TypeError|stack|passwordHash|sql/i);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('does not authenticate a disabled account', async () => {
    prisma.user.findFirst.mockResolvedValue({
      ...INTERNAL_USER,
      status: 'DISABLED',
      passwordHash,
    });
    const protection = await csrf();

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Cookie', protection.cookie)
      .set('x-csrf-token', protection.token)
      .set('x-forwarded-for', '192.0.2.23')
      .send({ identifier: INTERNAL_USER.username, password: 'Correct horse battery staple!' })
      .expect(401);

    expect(response.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it.each([undefined, 'not-the-cookie'])('rejects a missing or mismatched CSRF token', async (token) => {
    const protection = await csrf();
    const pending = request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Cookie', protection.cookie)
      .send({ identifier: INTERNAL_USER.username, password: 'irrelevant' });
    if (token) pending.set('x-csrf-token', token);

    const response = await pending.expect(403);

    expect(response.body.code).toBe('CSRF_INVALID');
  });

  it('reads and revokes only a hashed server-side session', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'database-session-id',
      tokenHash: 'stored-hash',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: INTERNAL_USER,
    });
    const current = await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Cookie', 'qms_session=raw-browser-session')
      .expect(200);

    expect(current.body).toEqual({
      user: {
        id: INTERNAL_USER.id,
        organizationId: INTERNAL_USER.organizationId,
        accountType: 'INTERNAL',
      },
    });
    expect(prisma.session.findUnique.mock.calls[0][0].where.tokenHash).not.toBe(
      'raw-browser-session',
    );

    const protection = await csrf();
    const logout = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', [`qms_session=raw-browser-session`, protection.cookie])
      .set('x-csrf-token', protection.token)
      .expect(204);
    expect(logout.headers['set-cookie'].join(';')).toMatch(
      /qms_session=;.*HttpOnly.*SameSite=Lax/i,
    );
    expect(prisma.session.updateMany.mock.calls[0][0].where.tokenHash).not.toBe(
      'raw-browser-session',
    );
  });

  it('rate limits repeated failures without reflecting the account key', async () => {
    prisma.user.findFirst.mockResolvedValue({ ...INTERNAL_USER, passwordHash });
    const protection = await csrf();
    let response: request.Response | undefined;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Cookie', protection.cookie)
        .set('x-csrf-token', protection.token)
        .set('x-forwarded-for', '192.0.2.30')
        .send({ identifier: INTERNAL_USER.username, password: 'wrong' });
    }

    expect(response?.status).toBe(429);
    expect(response?.body.code).toBe('AUTH_RATE_LIMITED');
    expect(JSON.stringify(response?.body)).not.toContain(INTERNAL_USER.username);
  });
});
