import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PasswordService } from '../../src/modules/identity/password.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';

export async function accountDeliveryFixture() {
  if (!process.env.DATABASE_URL) throw new Error('PostgreSQL integration requires DATABASE_URL; no skipping.');
  if (new URL(process.env.DATABASE_URL).port === '55440') throw new Error('Reserved preview database is forbidden.');
  process.env.QMS_SECURITY_CURRENT_KEY_ID ??= 'account-delivery-test';
  process.env.QMS_SECURITY_KEYRING ??= JSON.stringify({ [process.env.QMS_SECURITY_CURRENT_KEY_ID]: randomBytes(32).toString('base64') });
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  const prisma = app.get(PrismaService);
  const organization = await prisma.organization.create({ data: { code: `DELIVERY-${randomUUID()}`, name: 'Account delivery', type: 'INTERNAL' } });
  const password = 'account-delivery-original-password';
  const actor = await prisma.user.create({ data: { organizationId: organization.id, username: `admin-${randomUUID()}`, accountType: 'INTERNAL', passwordHash: await app.get(PasswordService).hash(password) } });
  const permissions = await Promise.all(['account:users:create', 'account:users:read', 'account:users:reset'].map((code) => prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} })));
  const role = await prisma.role.create({ data: { organizationId: organization.id, code: 'DELIVERY_ADMIN', name: 'Delivery administrator', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
  await prisma.userRole.create({ data: { userId: actor.id, organizationId: organization.id, roleId: role.id } });
  const csrf = randomUUID();
  const sessionToken = await app.get(SessionService).create(actor.id, prisma, { mfaVerified: true, reauthenticated: true });
  const cookie = `qms_session=${sessionToken}; qms_csrf=${csrf}`;
  const post = (path: string, body: object = {}, key = randomUUID(), customCookie = cookie) => request(app.getHttpServer()).post(`/api/v1${path}`).set('Cookie', customCookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  const target = () => prisma.user.create({ data: { organizationId: organization.id, username: `target-${randomUUID()}`, accountType: 'INTERNAL', passwordHash: actor.passwordHash } });
  const reset = (userId: string, body: object = {}, key = randomUUID()) => post(`/admin/users/${userId}/temporary-password/reset`, body, key);
  const read = (userId: string) => post(`/admin/users/${userId}/temporary-password/read`);
  const login = (identifier: string, suppliedPassword: string) => post('/auth/login', { identifier, password: suppliedPassword });
  const challengeCookie = (response: { headers: Record<string, unknown> }) => {
    const values = response.headers['set-cookie'] as string[];
    return `${values.find((value) => value.startsWith('qms_password_change='))!.split(';')[0]}; qms_csrf=${csrf}`;
  };
  const close = async () => {
    await prisma.auditEvent.deleteMany({ where: { organizationId: organization.id } });
    await prisma.user.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
    await app.close();
  };
  return { app, prisma, actor, organization, password, cookie, csrf, post, target, reset, read, login, challengeCookie, close };
}

export type AccountDeliveryFixture = Awaited<ReturnType<typeof accountDeliveryFixture>>;
