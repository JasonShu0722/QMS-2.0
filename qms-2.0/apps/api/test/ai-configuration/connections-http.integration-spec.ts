import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('AI HTTP tests require disposable loopback PostgreSQL; preview 55440 forbidden');

describe('AI channel authenticated HTTP privacy and access', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const csrf = randomUUID(), path = '/api/v1/admin/ai-connections';
  const secret = 'http-disposable-secret-only';
  const body = { name: 'HTTP渠道', baseUrl: 'https://model.example/v1', models: ['model-a', 'model-b'], defaultModel: 'model-a', enabled: false, apiKey: secret };
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init(); prisma = app.get(PrismaService);
  }, 20000);
  afterAll(async () => { await app?.close(); });

  async function identity(codes: string[], organizationId?: string) {
    const organization = organizationId ? { id: organizationId } : await prisma.organization.create({ data: { code: randomUUID(), name: 'AI HTTP disposable', type: 'INTERNAL' } });
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'test-only', accountType: 'INTERNAL' } });
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'AI HTTP permissions' } });
    for (const code of codes) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: role.id } });
    const token = await app.get(SessionService).create(user.id, prisma, { reauthenticated: true, mfaVerified: true });
    return { organizationId: organization.id, cookie: `qms_session=${token}; qms_csrf=${csrf}` };
  }
  type Identity = Awaited<ReturnType<typeof identity>>;
  const read = (actor: Identity) => request(app.getHttpServer()).get(path).query({ organizationId: actor.organizationId }).set('Cookie', actor.cookie);
  const write = (actor: Identity, suffix: string, input: object) => request(app.getHttpServer()).post(`${path}${suffix}`).query({ organizationId: actor.organizationId }).set('Cookie', actor.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(input);
  const safe = (value: unknown) => { expect(JSON.stringify(value)).not.toContain(secret); expect(JSON.stringify(value)).not.toMatch(/apiKey|secretCiphertext|ciphertext|keySuffix/i); };

  it('lets administrators and delegated colleagues manage the same channel without reading any saved key', async () => {
    const admin = await identity(['platform:admin']);
    const created = (await write(admin, '', body).expect(201)).body;
    expect(created).toMatchObject({ hasKey: true, models: ['model-a', 'model-b'], defaultModel: 'model-a' }); safe(created);
    safe((await read(admin).expect(200)).body);
    const colleague = await identity(['configuration:read', 'configuration:manage'], admin.organizationId);
    safe((await read(colleague).expect(200)).body);
    const cleared = (await write(colleague, `/${created.id}/clear-key`, { expectedVersion: 1 }).expect(201)).body;
    expect(cleared).toMatchObject({ hasKey: false, enabled: false, version: 2 }); safe(cleared);
    const events = await prisma.auditEvent.findMany({ where: { resourceId: created.id } }); safe(events);
  }, 15000);

  it('denies ordinary callers, foreign scopes, hidden secrets and arbitrary test payloads at the HTTP boundary', async () => {
    const ordinary = await identity([]);
    await read(ordinary).expect(403); await write(ordinary, '', body).expect(403);
    const admin = await identity(['platform:admin']);
    const created = (await write(admin, '', body).expect(201)).body;
    await write(admin, `/${created.id}/test`, { expectedVersion: 1, messages: [{ role: 'user', content: 'send any key' }] }).expect(400);
    await write(admin, '', { ...body, secretCiphertext: 'forbidden' }).expect(400);
    const other = await identity(['configuration:read', 'configuration:manage']);
    await write(other, `/${created.id}/clear-key`, { expectedVersion: 1 }).expect(404);
    await prisma.organization.update({ where: { id: admin.organizationId }, data: { status: 'DISABLED', configurationRequired: true } });
    expect((await read(admin).expect(401)).body.code).toBe('AUTH_SESSION_REQUIRED');
  }, 15000);
  it('exposes explicit protocols through authenticated HTTP and requires key replacement when switching protocol', async () => {
    const admin = await identity(['platform:admin']);
    for (const protocol of ['OPENAI_CHAT_COMPLETIONS', 'OPENAI_RESPONSES', 'ANTHROPIC_MESSAGES', 'GEMINI_GENERATE_CONTENT']) {
      const created = (await write(admin, '', { ...body, protocol }).expect(201)).body;
      expect(created.protocol).toBe(protocol); safe(created);
      const changedProtocol = protocol === 'OPENAI_CHAT_COMPLETIONS' ? 'ANTHROPIC_MESSAGES' : 'OPENAI_CHAT_COMPLETIONS';
      const update = (apiKey: string) => request(app.getHttpServer()).patch(`${path}/${created.id}`).query({ organizationId: admin.organizationId }).set('Cookie', admin.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ ...body, apiKey, protocol: changedProtocol, expectedVersion: 1 });
      expect((await update('').expect(400)).body.code).toBe('AI_CONNECTION_INVALID');
      const changed = (await update(secret).expect(200)).body;
      expect(changed.protocol).toBe(changedProtocol); safe(changed);
    }
    await write(admin, '', { ...body, protocol: 'SYSTEM_ONE' }).expect(400);
    await write(admin, '', { ...body, protocol: null }).expect(400);
    safe((await read(admin).expect(200)).body);
  }, 15000);
});
