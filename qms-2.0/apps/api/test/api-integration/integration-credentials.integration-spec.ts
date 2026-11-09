import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') throw new Error('Integration credentials require disposable PostgreSQL.');

const path = '/api/v1/admin/integrations/endpoints';
const codes = ['integration:read', 'integration:manage', 'integration:credentials:manage'];

describe('Integration machine credential lifecycle with real sessions and PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  const organizationIds: string[] = [];
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter()); await app.init();
    prisma = app.get(PrismaService); sessions = app.get(SessionService);
    for (const code of codes) await prisma.permission.upsert({ where: { code }, update: {}, create: { code, name: code } });
  });
  afterAll(async () => {
    if (prisma && organizationIds.length) {
      await prisma.$executeRaw`DELETE FROM integration_credentials WHERE organization_id = ANY(${organizationIds}::uuid[])`;
      await prisma.$executeRaw`DELETE FROM integration_endpoints WHERE organization_id = ANY(${organizationIds}::uuid[])`;
      const where = { organizationId: { in: organizationIds } };
      await prisma.auditEvent.deleteMany({ where }); await prisma.adminMutation.deleteMany({ where });
      await prisma.userRole.deleteMany({ where }); await prisma.user.deleteMany({ where }); await prisma.role.deleteMany({ where });
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    }
    await app?.close();
  });
  async function fixture() {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Credential private fixture', type: 'INTERNAL' } }); organizationIds.push(organization.id);
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'not-a-login-credential' } });
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Credential administrator', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: role.id } });
    const token = await sessions.create(user.id, prisma, { mfaVerified: true });
    await prisma.session.updateMany({ where: { userId: user.id }, data: { reauthenticatedAt: new Date() } });
    const cookie = `qms_session=${token}; qms_csrf=fixture`;
    const endpoint = await request(app.getHttpServer()).post(path).set('Cookie', cookie).set('x-csrf-token', 'fixture').set('Idempotency-Key', randomUUID()).send({ code: randomUUID(), name: 'ERP receiver', sourceCode: 'ERP', sourceName: 'Company ERP' }).expect(201);
    return { organization, user, role, cookie, endpointId: endpoint.body.id as string };
  }
  const create = (cookie: string, endpointId: string, key = randomUUID(), input: object = { name: 'ERP primary' }) => request(app.getHttpServer()).post(`${path}/${endpointId}/credentials`).set('Cookie', cookie).set('x-csrf-token', 'fixture').set('Idempotency-Key', key).send(input);
  const revoke = (cookie: string, endpointId: string, credentialId: string, key = randomUUID()) => request(app.getHttpServer()).post(`${path}/${endpointId}/credentials/${credentialId}/revoke`).set('Cookie', cookie).set('x-csrf-token', 'fixture').set('Idempotency-Key', key).send({});

  it('returns a 256-bit secret once and never stores it in credentials, receipts or audits', async () => {
    const fixtureValue = await fixture(); const key = randomUUID();
    const created = await create(fixtureValue.cookie, fixtureValue.endpointId, key).expect(201);
    expect(created.headers['cache-control']).toBe('no-store');
    expect(created.body.createdById).toBe(fixtureValue.user.id);
    const [credentialId, secret] = (created.body.secret as string).split('.');
    expect(credentialId).toBe(created.body.id); expect(Buffer.from(secret!, 'base64url')).toHaveLength(32);
    const [stored] = await prisma.$queryRaw<{ secretHash: string }[]>`SELECT secret_hash AS "secretHash" FROM integration_credentials WHERE id = ${credentialId}::uuid`;
    expect(stored?.secretHash).toBe(createHash('sha256').update(secret!).digest('hex'));
    const mutation = await prisma.adminMutation.findFirstOrThrow({ where: { actorUserId: fixtureValue.user.id, key } });
    expect(mutation.response).toMatchObject({ value: { createdById: fixtureValue.user.id } });
    expect(JSON.stringify(mutation.response)).not.toContain(secret!); expect(JSON.stringify(mutation.response)).not.toContain('secretHash');
    const audits = await prisma.auditEvent.findMany({ where: { organizationId: fixtureValue.organization.id, action: 'INTEGRATION_CREDENTIAL_CREATED' } });
    expect(audits).toHaveLength(1); expect(audits[0]?.metadata).toMatchObject({ endpointId: fixtureValue.endpointId, credentialId });
    expect(JSON.stringify(audits)).not.toContain(secret!);
    const listed = await request(app.getHttpServer()).get(`${path}/${fixtureValue.endpointId}/credentials`).set('Cookie', fixtureValue.cookie).expect(200);
    expect(listed.body).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(listed.body.items[0].createdById).toBe(fixtureValue.user.id);
    expect(listed.body.items[0].secret).toBeUndefined(); expect(listed.body.items[0].secretHash).toBeUndefined();
    const days = (Date.parse(created.body.expiresAt) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(89); expect(days).toBeLessThanOrEqual(90);
    await prisma.$executeRaw`UPDATE integration_credentials SET created_by_id = NULL WHERE id = ${credentialId}::uuid`;
    const legacy = await request(app.getHttpServer()).get(`${path}/${fixtureValue.endpointId}/credentials`).set('Cookie', fixtureValue.cookie).expect(200);
    expect(legacy.body.items[0].createdById).toBeNull();
  });
  it('replays a lost response without a recoverable secret or a second credential', async () => {
    const fixtureValue = await fixture(); const key = randomUUID();
    const created = await create(fixtureValue.cookie, fixtureValue.endpointId, key).expect(201);
    const replay = await create(fixtureValue.cookie, fixtureValue.endpointId, key).expect(201);
    expect(replay.body.id).toBe(created.body.id); expect(replay.body.secret).toBeUndefined();
    expect(replay.body.createdById).toBe(fixtureValue.user.id);
    await create(fixtureValue.cookie, fixtureValue.endpointId, key, { name: 'Different credential' }).expect(409);
    const [count] = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM integration_credentials WHERE endpoint_id = ${fixtureValue.endpointId}::uuid`;
    expect(count?.count).toBe(1);
  });
  it('limits active credentials to two and releases the slot after revocation', async () => {
    const fixtureValue = await fixture();
    const first = await create(fixtureValue.cookie, fixtureValue.endpointId).expect(201);
    await create(fixtureValue.cookie, fixtureValue.endpointId).expect(201);
    await create(fixtureValue.cookie, fixtureValue.endpointId).expect(409);
    const key = randomUUID(); const revoked = await revoke(fixtureValue.cookie, fixtureValue.endpointId, first.body.id, key).expect(201);
    expect(revoked.body.revokedAt).not.toBeNull(); expect(revoked.body.secret).toBeUndefined();
    expect((await revoke(fixtureValue.cookie, fixtureValue.endpointId, first.body.id, key).expect(201)).body).toEqual(revoked.body);
    await create(fixtureValue.cookie, fixtureValue.endpointId).expect(201);
  });
  it('limits concurrent issuance and permits a replacement after expiry', async () => {
    const fixtureValue = await fixture();
    const results = await Promise.all(Array.from({ length: 3 }, () => create(fixtureValue.cookie, fixtureValue.endpointId)));
    expect(results.map(response => response.status).sort()).toEqual([201, 201, 409]);
    await prisma.$executeRaw`UPDATE integration_credentials SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE endpoint_id = ${fixtureValue.endpointId}::uuid`;
    await create(fixtureValue.cookie, fixtureValue.endpointId).expect(201);
  });
  it('requires both credential and endpoint management rights and honors revocation of those rights', async () => {
    const fixtureValue = await fixture();
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'integration:manage' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: fixtureValue.role.id, permissionId: permission.id } } });
    await create(fixtureValue.cookie, fixtureValue.endpointId).expect(403);
  });
  it('does not allow cross-organization credential operations', async () => {
    const owner = await fixture(), other = await fixture();
    const credential = await create(owner.cookie, owner.endpointId).expect(201);
    await create(other.cookie, owner.endpointId).expect(404);
    await revoke(other.cookie, owner.endpointId, credential.body.id).expect(404);
    await request(app.getHttpServer()).get(`${path}/${owner.endpointId}/credentials`).set('Cookie', other.cookie).expect(404);
  });
  it('rejects inactive organizations and invalid validity ranges', async () => {
    const fixtureValue = await fixture();
    for (const validityDays of [0, 366, 1.5]) await create(fixtureValue.cookie, fixtureValue.endpointId, randomUUID(), { name: 'ERP', validityDays }).expect(400);
    await create(fixtureValue.cookie, fixtureValue.endpointId, randomUUID(), { name: 'ERP', createdById: randomUUID() }).expect(400);
    await create(fixtureValue.cookie, fixtureValue.endpointId, randomUUID(), { name: '', validityDays: 1 }).expect(400);
    await prisma.organization.update({ where: { id: fixtureValue.organization.id }, data: { status: 'DISABLED' } });
    await create(fixtureValue.cookie, fixtureValue.endpointId).expect(401);
  });
});
