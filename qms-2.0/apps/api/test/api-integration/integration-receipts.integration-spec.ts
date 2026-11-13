import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { encryptSecret } from '../../src/common/security/security-keyring.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { jest } from '@jest/globals';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { IntegrationRetentionService } from '../../src/modules/api-integration/integration-retention.service.js';
import { IntegrationReceiptService } from '../../src/modules/api-integration/integration-receipt.service.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') throw new Error('Receipt tests require disposable PostgreSQL.');

describe('API integration receipt reads with real PostgreSQL and sessions', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  const organizationIds: string[] = [];
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService); sessions = app.get(SessionService);
  });
  afterAll(async () => {
    if (prisma) {
      const scope = { organizationId: { in: organizationIds } };
      await prisma.integrationRequestAttempt.deleteMany({ where: scope });
      await prisma.integrationReceipt.deleteMany({ where: scope });
      await prisma.integrationCredential.deleteMany({ where: scope });
      await prisma.integrationScopeCapacity.deleteMany({ where: scope });
      await prisma.integrationEndpoint.deleteMany({ where: scope });
      await prisma.auditEvent.deleteMany({ where: scope }); await prisma.adminMutation.deleteMany({ where: scope }); await prisma.userRole.deleteMany({ where: scope });
      await prisma.user.deleteMany({ where: scope }); await prisma.role.deleteMany({ where: scope });
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    }
    await app?.close();
  });
  async function fixture(codes = ['integration:receipts:read', 'integration:payload:read'], sourceCode = 'COMPANY') {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Private receipt fixture', type: 'INTERNAL' } }); organizationIds.push(organization.id);
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'unused-test-hash', accountType: 'INTERNAL' } });
    if (codes.length) {
      const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } }); expect(permissions).toHaveLength(codes.length);
      const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Receipt permissions', permissions: { create: permissions.map(permission => ({ permissionId: permission.id })) } } });
      await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: role.id } });
    }
    const cookie = `qms_session=${await sessions.create(user.id, prisma, { mfaVerified: true, reauthenticated: true })}; qms_csrf=fixture-csrf`;
    const endpoint = await prisma.integrationEndpoint.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Private endpoint', sourceCode, sourceName: 'Internal platform', status: 'ENABLED' } });
    const credential = await prisma.integrationCredential.create({ data: { organizationId: organization.id, endpointId: endpoint.id, name: 'Read fixture', secretHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 86400000) } });
    const receiptId = `a${randomUUID().slice(1)}`, text = '{"private":"<script>not executed</script>"}';
    const ciphertext = encryptSecret(text, `integration:${organization.id}:${endpoint.id}:${receiptId}`);
    const receipt = await prisma.integrationReceipt.create({ data: { id: receiptId, organizationId: organization.id, endpointId: endpoint.id, credentialId: credential.id, messageId: randomUUID(), bodyDigest: 'b'.repeat(64), configurationVersion: 1, configurationSnapshot: { returnReceipt: true }, bodyExpiresAt: new Date(Date.now() + 86400000), metadataExpiresAt: new Date(Date.now() + 90 * 86400000), payloadCiphertext: ciphertext, payloadBytes: Buffer.byteLength(ciphertext) } });
    return { organization, user, cookie, endpoint, credential, receipt, text };
  }
  const base = '/api/v1/admin/integrations';
  it('requires a real session at the receipt listing', async () => {
    await request(app.getHttpServer()).get(`${base}/receipts`).expect(401);
  });
  it('prevents caching of all authorized receipt, request result and plaintext responses', async () => {
    const item = await fixture();
    for (const suffix of ['receipts', 'attempts', 'status', `receipts/${item.receipt.id}`, `receipts/${item.receipt.id}/payload`]) {
      const response = await request(app.getHttpServer()).get(`${base}/${suffix}`).set('Cookie', item.cookie).expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });
  it('lists metadata without body or digest and permits separate audited plaintext reads', async () => {
    const item = await fixture();
    const page = await request(app.getHttpServer()).get(`${base}/receipts`).set('Cookie', item.cookie).expect(200);
    expect(page.body).toMatchObject({ total: 1, page: 1, limit: 20, items: [{ id: item.receipt.id, sourceCode: 'COMPANY', bodyAvailable: true }] });
    expect(JSON.stringify(page.body)).not.toMatch(/payloadCiphertext|bodyDigest|private|secret_hash/);
    const payload = await request(app.getHttpServer()).get(`${base}/receipts/${item.receipt.id}/payload`).set('Cookie', item.cookie).expect(200);
    expect(payload.body.text).toBe(item.text);
    expect(await prisma.auditEvent.count({ where: { organizationId: item.organization.id, action: 'INTEGRATION_PAYLOAD_READ', resourceId: item.receipt.id } })).toBe(1);
  });
  it('lists one thousand receipt and attempt metadata rows and rejects larger pages', async () => {
    const item = await fixture();
    await prisma.integrationReceipt.createMany({ data: Array.from({ length: 999 }, () => ({ organizationId: item.organization.id, endpointId: item.endpoint.id, credentialId: item.credential.id, messageId: randomUUID(), bodyDigest: 'c'.repeat(64), configurationVersion: 1, configurationSnapshot: {}, bodyExpiresAt: item.receipt.bodyExpiresAt, metadataExpiresAt: item.receipt.metadataExpiresAt, payloadBytes: 0 })) });
    const receipts = await prisma.integrationReceipt.findMany({ where: { organizationId: item.organization.id }, select: { id: true } });
    await prisma.integrationRequestAttempt.createMany({ data: receipts.map(receipt => ({ id: randomUUID(), organizationId: item.organization.id, endpointId: item.endpoint.id, credentialId: item.credential.id, receiptId: receipt.id, configurationVersion: 1, returnReceipt: true, statusCode: 201, outcome: 'RECEIVED', durationMs: 1 })) });
    for (const view of ['receipts', 'attempts']) {
      const response = await request(app.getHttpServer()).get(`${base}/${view}`).query({ limit: 1000 }).set('Cookie', item.cookie).expect(200);
      expect(response.body).toMatchObject({ total: 1000, page: 1, limit: 1000 });
      expect(response.body.items).toHaveLength(1000);
      expect(new Set(response.body.items.map((row: { id: string }) => row.id)).size).toBe(1000);
      expect(JSON.stringify(response.body)).not.toMatch(/payloadCiphertext|bodyDigest|secret_hash/);
      await request(app.getHttpServer()).get(`${base}/${view}`).query({ limit: 1001 }).set('Cookie', item.cookie).expect(400);
    }
  });
  it('enforces the one thousand page boundary in the service independently of DTO validation', async () => {
    const item = await fixture();
    const session = await prisma.session.findFirstOrThrow({ where: { userId: item.user.id } });
    const actor = { id: item.user.id, organizationId: item.organization.id, sessionId: session.id, accountType: 'INTERNAL' as const };
    const service = app.get(IntegrationReceiptService);
    for (const method of ['listReceipts', 'listAttempts'] as const) {
      await expect(service[method](actor, { limit: 1000 })).resolves.toMatchObject({ limit: 1000 });
      await expect(service[method](actor, { limit: 1001 })).rejects.toMatchObject({ response: { code: 'INTEGRATION_INPUT_INVALID' }, status: 400 });
    }
  });
  it('deletes selected receipts, releases stored bytes, keeps attempts, and records audit', async () => {
    const item = await fixture(['integration:receipts:read', 'integration:payload:read', 'integration:manage']);
    const secondId = randomUUID();
    const secondText = '{"private":"second"}';
    const secondCiphertext = encryptSecret(secondText, `integration:${item.organization.id}:${item.endpoint.id}:${secondId}`);
    const second = await prisma.integrationReceipt.create({ data: { id: secondId, organizationId: item.organization.id, endpointId: item.endpoint.id, credentialId: item.credential.id, messageId: randomUUID(), bodyDigest: 'c'.repeat(64), configurationVersion: 1, configurationSnapshot: { returnReceipt: true }, bodyExpiresAt: new Date(Date.now() + 86400000), metadataExpiresAt: new Date(Date.now() + 90 * 86400000), payloadCiphertext: secondCiphertext, payloadBytes: Buffer.byteLength(secondCiphertext) } });
    const releasedBytes = item.receipt.payloadBytes + second.payloadBytes;
    await prisma.integrationEndpoint.update({ where: { id: item.endpoint.id }, data: { usedBodyBytes: releasedBytes } });
    await prisma.integrationScopeCapacity.create({ data: { organizationId: item.organization.id, usedBodyBytes: releasedBytes, receiptCount: 2 } });
    await prisma.integrationRequestAttempt.create({ data: { id: randomUUID(), organizationId: item.organization.id, endpointId: item.endpoint.id, credentialId: item.credential.id, messageId: item.receipt.messageId, receiptId: item.receipt.id, configurationVersion: 1, returnReceipt: true, statusCode: 201, outcome: 'RECEIVED', durationMs: 1 } });
    const response = await request(app.getHttpServer()).delete(`${base}/receipts`).set('Cookie', item.cookie).set('x-csrf-token', 'fixture-csrf').set('Idempotency-Key', randomUUID()).send({ organizationId: item.organization.id, receiptIds: [item.receipt.id, second.id] }).expect(200);
    expect(response.body).toEqual({ deletedCount: 2, receiptIds: [item.receipt.id, second.id].sort() });
    expect(await prisma.integrationReceipt.count({ where: { organizationId: item.organization.id } })).toBe(0);
    expect(await prisma.integrationRequestAttempt.count({ where: { organizationId: item.organization.id, receiptId: item.receipt.id } })).toBe(1);
    expect(await prisma.integrationEndpoint.findUniqueOrThrow({ where: { id: item.endpoint.id } })).toMatchObject({ usedBodyBytes: BigInt(0) });
    expect(await prisma.integrationScopeCapacity.findUniqueOrThrow({ where: { organizationId: item.organization.id } })).toMatchObject({ usedBodyBytes: BigInt(0), receiptCount: 0 });
    expect(await prisma.auditEvent.count({ where: { organizationId: item.organization.id, action: 'INTEGRATION_RECEIPTS_DELETED' } })).toBe(2);
  });
  it('deletes one thousand receipts and releases their exact bytes and receipt capacity', async () => {
    const item = await fixture(['integration:receipts:read', 'integration:manage']);
    const additionalIds = Array.from({ length: 999 }, () => randomUUID());
    await prisma.integrationReceipt.createMany({ data: additionalIds.map(id => ({ id, organizationId: item.organization.id, endpointId: item.endpoint.id, credentialId: item.credential.id, messageId: randomUUID(), bodyDigest: 'c'.repeat(64), configurationVersion: 1, configurationSnapshot: {}, bodyExpiresAt: item.receipt.bodyExpiresAt, metadataExpiresAt: item.receipt.metadataExpiresAt, payloadCiphertext: item.receipt.payloadCiphertext, payloadBytes: item.receipt.payloadBytes })) });
    const bytes = item.receipt.payloadBytes * 1000;
    await prisma.integrationEndpoint.update({ where: { id: item.endpoint.id }, data: { usedBodyBytes: bytes } });
    await prisma.integrationScopeCapacity.create({ data: { organizationId: item.organization.id, usedBodyBytes: bytes, receiptCount: 1000 } });
    const receiptIds = [item.receipt.id, ...additionalIds];
    const response = await request(app.getHttpServer()).delete(`${base}/receipts`).set('Cookie', item.cookie).set('x-csrf-token', 'fixture-csrf').set('Idempotency-Key', randomUUID()).send({ organizationId: item.organization.id, receiptIds }).expect(200);
    expect(response.body).toEqual({ deletedCount: 1000, receiptIds: receiptIds.sort() });
    expect(await prisma.integrationReceipt.count({ where: { organizationId: item.organization.id } })).toBe(0);
    expect(await prisma.integrationEndpoint.findUniqueOrThrow({ where: { id: item.endpoint.id } })).toMatchObject({ usedBodyBytes: 0n });
    expect(await prisma.integrationScopeCapacity.findUniqueOrThrow({ where: { organizationId: item.organization.id } })).toMatchObject({ usedBodyBytes: 0n, receiptCount: 0 });
    expect(await prisma.auditEvent.count({ where: { organizationId: item.organization.id, action: 'INTEGRATION_RECEIPTS_DELETED' } })).toBe(1000);
  });
  it('requires session, CSRF, recent authentication and management permission, and rolls back mixed organization IDs', async () => {
    const item = await fixture(['integration:receipts:read', 'integration:manage']);
    const foreign = await fixture(['integration:receipts:read', 'integration:manage']);
    const body = { organizationId: item.organization.id, receiptIds: [item.receipt.id] };
    const remove = (candidate: typeof item, requestBody = body, key = randomUUID()) => request(app.getHttpServer()).delete(`${base}/receipts`).set('Cookie', candidate.cookie).set('x-csrf-token', 'fixture-csrf').set('Idempotency-Key', key).send(requestBody);
    await request(app.getHttpServer()).delete(`${base}/receipts`).set('x-csrf-token', 'fixture-csrf').set('Idempotency-Key', randomUUID()).send(body).expect(403);
    await request(app.getHttpServer()).delete(`${base}/receipts`).set('Cookie', item.cookie).set('Idempotency-Key', randomUUID()).send(body).expect(403);
    const readOnly = await fixture(['integration:receipts:read']);
    await remove(readOnly).expect(403);
    await prisma.session.updateMany({ where: { userId: item.user.id }, data: { reauthenticatedAt: new Date(Date.now() - 600000) } });
    await remove(item).expect(403);
    await prisma.session.updateMany({ where: { userId: item.user.id }, data: { reauthenticatedAt: new Date() } });
    const endpointBefore = await prisma.integrationEndpoint.findUniqueOrThrow({ where: { id: item.endpoint.id } });
    const mixed = await remove(item, { organizationId: item.organization.id, receiptIds: [item.receipt.id, foreign.receipt.id] });
    expect(mixed.status).toBe(404);
    expect(await prisma.integrationReceipt.count({ where: { organizationId: item.organization.id, id: item.receipt.id } })).toBe(1);
    expect((await prisma.integrationEndpoint.findUniqueOrThrow({ where: { id: item.endpoint.id } })).usedBodyBytes).toBe(endpointBefore.usedBodyBytes);
    await remove(foreign, { organizationId: foreign.organization.id, receiptIds: [item.receipt.id] }).expect(404);
  });
  it.each([
    { label: 'empty', receiptIds: [] },
    { label: 'duplicate', receiptIds: Array(2).fill('abcdef01-2345-4678-9abc-def012345678') as string[] },
    { label: 'case duplicate', receiptIds: ['Abcdef01-2345-4678-9abc-def012345678', 'abcdef01-2345-4678-9abc-def012345678'] },
    { label: 'non UUID', receiptIds: ['not-a-uuid'] },
    { label: 'too many', receiptIds: Array.from({ length: 1001 }, () => randomUUID()) },
  ])('rejects $label receipt deletion input without changing data', async ({ receiptIds }) => {
    const item = await fixture(['integration:receipts:read', 'integration:manage']);
    const before = await prisma.integrationReceipt.count({ where: { organizationId: item.organization.id } });
    await request(app.getHttpServer()).delete(`${base}/receipts`).set('Cookie', item.cookie).set('x-csrf-token', 'fixture-csrf').set('Idempotency-Key', randomUUID()).send({ organizationId: item.organization.id, receiptIds }).expect(400);
    expect(await prisma.integrationReceipt.count({ where: { organizationId: item.organization.id } })).toBe(before);
  });
  it('rejects one thousand and one deletion IDs in the service before touching retained data', async () => {
    const item = await fixture(['integration:receipts:read', 'integration:manage']);
    const session = await prisma.session.findFirstOrThrow({ where: { userId: item.user.id } });
    const actor = { id: item.user.id, organizationId: item.organization.id, sessionId: session.id, accountType: 'INTERNAL' as const };
    await expect(app.get(IntegrationReceiptService).deleteReceipts(actor, { receiptIds: [item.receipt.id, ...Array.from({ length: 1000 }, () => randomUUID())] }, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'INTEGRATION_INPUT_INVALID' }, status: 400 });
    expect(await prisma.integrationReceipt.count({ where: { organizationId: item.organization.id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { organizationId: item.organization.id, action: 'INTEGRATION_RECEIPTS_DELETED' } })).toBe(0);
  });
  it('replays the same deletion result without decrementing capacity or adding audit rows', async () => {
    const item = await fixture(['integration:receipts:read', 'integration:manage']);
    const bytes = item.receipt.payloadBytes;
    await prisma.integrationEndpoint.update({ where: { id: item.endpoint.id }, data: { usedBodyBytes: bytes } });
    await prisma.integrationScopeCapacity.create({ data: { organizationId: item.organization.id, usedBodyBytes: bytes, receiptCount: 1 } });
    const key = randomUUID(), body = { organizationId: item.organization.id, receiptIds: [item.receipt.id] };
    const send = () => request(app.getHttpServer()).delete(`${base}/receipts`).set('Cookie', item.cookie).set('x-csrf-token', 'fixture-csrf').set('Idempotency-Key', key).send(body);
    const first = await send().expect(200);
    const second = await send().expect(200);
    expect(second.body).toEqual(first.body);
    expect(await prisma.integrationReceipt.count({ where: { organizationId: item.organization.id } })).toBe(0);
    expect(await prisma.integrationEndpoint.findUniqueOrThrow({ where: { id: item.endpoint.id } })).toMatchObject({ usedBodyBytes: BigInt(0) });
    expect(await prisma.integrationScopeCapacity.findUniqueOrThrow({ where: { organizationId: item.organization.id } })).toMatchObject({ usedBodyBytes: BigInt(0), receiptCount: 0 });
    expect(await prisma.auditEvent.count({ where: { organizationId: item.organization.id, action: 'INTEGRATION_RECEIPTS_DELETED' } })).toBe(1);
  });
  it('deletes a payload-cleared receipt without decrementing bytes', async () => {
    const item = await fixture(['integration:receipts:read', 'integration:manage']);
    await prisma.integrationReceipt.update({ where: { id: item.receipt.id }, data: { payloadCiphertext: null } });
    await prisma.integrationEndpoint.update({ where: { id: item.endpoint.id }, data: { usedBodyBytes: 0 } });
    await prisma.integrationScopeCapacity.create({ data: { organizationId: item.organization.id, usedBodyBytes: 0, receiptCount: 1 } });
    await request(app.getHttpServer()).delete(`${base}/receipts`).set('Cookie', item.cookie).set('x-csrf-token', 'fixture-csrf').set('Idempotency-Key', randomUUID()).send({ organizationId: item.organization.id, receiptIds: [item.receipt.id] }).expect(200);
    expect(await prisma.integrationEndpoint.findUniqueOrThrow({ where: { id: item.endpoint.id } })).toMatchObject({ usedBodyBytes: BigInt(0) });
    expect(await prisma.integrationScopeCapacity.findUniqueOrThrow({ where: { organizationId: item.organization.id } })).toMatchObject({ usedBodyBytes: BigInt(0), receiptCount: 0 });
  });
  it('rolls back receipt deletion and capacity when its required audit write fails', async () => {
    const item = await fixture(['integration:receipts:read', 'integration:manage']);
    const bytes = item.receipt.payloadBytes;
    await prisma.integrationEndpoint.update({ where: { id: item.endpoint.id }, data: { usedBodyBytes: bytes } });
    await prisma.integrationScopeCapacity.create({ data: { organizationId: item.organization.id, usedBodyBytes: bytes, receiptCount: 1 } });
    const audit = app.get(AuditLogService), original = audit.record.bind(audit);
    const injected = jest.spyOn(audit, 'record').mockImplementation(async (input, transaction) => {
      if (input.action === 'INTEGRATION_RECEIPTS_DELETED') throw new Error('injected receipt delete audit failure');
      return original(input, transaction);
    });
    try {
      await request(app.getHttpServer()).delete(`${base}/receipts`).set('Cookie', item.cookie).set('x-csrf-token', 'fixture-csrf').set('Idempotency-Key', randomUUID()).send({ organizationId: item.organization.id, receiptIds: [item.receipt.id] }).expect(500);
    } finally { injected.mockRestore(); }
    expect(await prisma.integrationReceipt.count({ where: { organizationId: item.organization.id, id: item.receipt.id } })).toBe(1);
    expect(await prisma.integrationEndpoint.findUniqueOrThrow({ where: { id: item.endpoint.id } })).toMatchObject({ usedBodyBytes: BigInt(bytes) });
    expect(await prisma.integrationScopeCapacity.findUniqueOrThrow({ where: { organizationId: item.organization.id } })).toMatchObject({ usedBodyBytes: BigInt(bytes), receiptCount: 1 });
  });
  it('serializes concurrent deletion and retention without double releasing capacity', async () => {
    const item = await fixture(['integration:receipts:read', 'integration:manage']);
    const bytes = item.receipt.payloadBytes;
    await prisma.integrationReceipt.update({ where: { id: item.receipt.id }, data: { bodyExpiresAt: new Date(Date.now() - 1000) } });
    await prisma.integrationEndpoint.update({ where: { id: item.endpoint.id }, data: { usedBodyBytes: bytes } });
    await prisma.integrationScopeCapacity.create({ data: { organizationId: item.organization.id, usedBodyBytes: bytes, receiptCount: 1 } });
    const deletion = request(app.getHttpServer()).delete(`${base}/receipts`).set('Cookie', item.cookie).set('x-csrf-token', 'fixture-csrf').set('Idempotency-Key', randomUUID()).send({ organizationId: item.organization.id, receiptIds: [item.receipt.id] });
    const retention = app.get(IntegrationRetentionService).purgeExpired();
    const [response] = await Promise.all([deletion, retention]);
    expect([200, 404]).toContain(response.status);
    expect(await prisma.integrationReceipt.count({ where: { organizationId: item.organization.id, id: item.receipt.id } })).toBe(0);
    expect(await prisma.integrationEndpoint.findUniqueOrThrow({ where: { id: item.endpoint.id } })).toMatchObject({ usedBodyBytes: BigInt(0) });
    expect(await prisma.integrationScopeCapacity.findUniqueOrThrow({ where: { organizationId: item.organization.id } })).toMatchObject({ usedBodyBytes: BigInt(0), receiptCount: 0 });
  });
  it('projects actual endpoint names and codes for receipts and attempts including deleted history', async () => {
    const item = await fixture(['integration:receipts:read']);
    await prisma.integrationRequestAttempt.create({ data: { id: randomUUID(), organizationId: item.organization.id, endpointId: item.endpoint.id, credentialId: item.credential.id, receiptId: item.receipt.id, configurationVersion: 1, returnReceipt: true, statusCode: 201, outcome: 'RECEIVED', durationMs: 1 } });
    await prisma.integrationEndpoint.update({ where: { id: item.endpoint.id }, data: { deletedAt: new Date(), status: 'DISABLED' } });
    for (const suffix of ['receipts', 'attempts', `receipts/${item.receipt.id}`]) {
      const response = await request(app.getHttpServer()).get(`${base}/${suffix}`).set('Cookie', item.cookie).expect(200);
      const row = suffix.includes('/') ? response.body : response.body.items[0];
      expect(row).toMatchObject({ endpointId: item.endpoint.id, endpointName: item.endpoint.name, endpointCode: item.endpoint.code });
    }
  });
  it('offers paginated endpoint candidates to receipt readers with organization isolation and deleted history', async () => {
    const item = await fixture(['integration:receipts:read']), foreign = await fixture();
    await prisma.integrationEndpoint.update({ where: { id: item.endpoint.id }, data: { name: 'Search Alpha', code: 'candidate-alpha', deletedAt: new Date(), status: 'DISABLED' } });
    const second = await prisma.integrationEndpoint.create({ data: { organizationId: item.organization.id, code: 'candidate-beta', name: 'Search Beta', sourceCode: 'COMPANY', sourceName: 'Internal platform' } });
    const response = await request(app.getHttpServer()).get(`${base}/receipt-endpoints`).query({ search: ' Search ', page: 1, limit: 1 }).set('Cookie', item.cookie).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({ total: 2, page: 1, limit: 1, items: [{ id: item.endpoint.id, name: 'Search Alpha', code: 'candidate-alpha' }] });
    const next = await request(app.getHttpServer()).get(`${base}/receipt-endpoints`).query({ search: 'candidate-', page: 2, limit: 1 }).set('Cookie', item.cookie).expect(200);
    expect(next.body).toMatchObject({ total: 2, page: 2, items: [{ id: second.id }] });
    const missing = await request(app.getHttpServer()).get(`${base}/receipt-endpoints`).query({ search: foreign.endpoint.code }).set('Cookie', item.cookie).expect(200);
    expect(missing.body).toMatchObject({ total: 0, items: [] });
    await request(app.getHttpServer()).get(`${base}/receipt-endpoints`).query({ organizationId: foreign.organization.id }).set('Cookie', item.cookie).expect(403);
    await request(app.getHttpServer()).get(`${base}/receipt-endpoints`).query({ search: 'x'.repeat(121) }).set('Cookie', item.cookie).expect(400);
    await request(app.getHttpServer()).get(`${base}/receipt-endpoints`).query({ limit: 101 }).set('Cookie', item.cookie).expect(400);
    await request(app.getHttpServer()).get(`${base}/receipt-endpoints`).expect(401);
    const ungranted = await fixture([]);
    await request(app.getHttpServer()).get(`${base}/receipt-endpoints`).set('Cookie', ungranted.cookie).expect(403);
  });
  it('reads the same audited plaintext with an uppercase receipt UUID and returns canonical IDs', async () => {
    const item = await fixture();
    const uppercaseId = item.receipt.id.toUpperCase();
    expect(uppercaseId).not.toBe(item.receipt.id);
    const canonical = await request(app.getHttpServer()).get(`${base}/receipts/${item.receipt.id}/payload`).set('Cookie', item.cookie).expect(200);
    const uppercase = await request(app.getHttpServer()).get(`${base}/receipts/${uppercaseId}/payload`).set('Cookie', item.cookie).expect(200);
    expect(uppercase.body).toEqual(canonical.body);
    expect(uppercase.body).toMatchObject({ id: item.receipt.id, text: item.text });
    expect(uppercase.headers['cache-control']).toBe('no-store');
    const audits = await prisma.auditEvent.findMany({ where: { organizationId: item.organization.id, action: 'INTEGRATION_PAYLOAD_READ' } });
    expect(audits).toHaveLength(2);
    for (const audit of audits) expect(audit).toMatchObject({ resourceId: item.receipt.id, outcome: 'SUCCESS', metadata: { endpointId: item.endpoint.id, receiptId: item.receipt.id } });
  });
  it('does not imply payload disclosure or integration configuration access from receipt read', async () => {
    const item = await fixture(['integration:receipts:read']);
    await request(app.getHttpServer()).get(`${base}/receipts`).set('Cookie', item.cookie).expect(200);
    await request(app.getHttpServer()).get(`${base}/receipts/${item.receipt.id}/payload`).set('Cookie', item.cookie).expect(403);
    await request(app.getHttpServer()).get(`${base}/endpoints`).set('Cookie', item.cookie).expect(403);
  });
  it('filters receipts and request results by exact source without crossing organization', async () => {
    const item = await fixture(), foreign = await fixture(undefined, 'FOREIGN');
    const secondEndpoint = await prisma.integrationEndpoint.create({ data: { organizationId: item.organization.id, code: randomUUID(), name: 'Second source', sourceCode: 'OTHER', sourceName: 'Other internal platform', status: 'ENABLED' } });
    const secondCredential = await prisma.integrationCredential.create({ data: { organizationId: item.organization.id, endpointId: secondEndpoint.id, name: 'Other source credential', secretHash: 'c'.repeat(64), expiresAt: new Date(Date.now() + 86400000) } });
    const secondReceipt = await prisma.integrationReceipt.create({ data: { organizationId: item.organization.id, endpointId: secondEndpoint.id, credentialId: secondCredential.id, messageId: randomUUID(), bodyDigest: 'd'.repeat(64), configurationVersion: 1, configurationSnapshot: {}, bodyExpiresAt: new Date(Date.now() + 86400000), metadataExpiresAt: new Date(Date.now() + 90 * 86400000), payloadBytes: 0 } });
    const candidates = [
      { organizationId: item.organization.id, endpointId: item.endpoint.id, credentialId: item.credential.id, receiptId: item.receipt.id, messageId: item.receipt.messageId },
      { organizationId: item.organization.id, endpointId: secondEndpoint.id, credentialId: secondCredential.id, receiptId: secondReceipt.id, messageId: secondReceipt.messageId },
      { organizationId: foreign.organization.id, endpointId: foreign.endpoint.id, credentialId: foreign.credential.id, receiptId: foreign.receipt.id, messageId: foreign.receipt.messageId },
    ];
    const attempts = await Promise.all(candidates.map(candidate => prisma.integrationRequestAttempt.create({ data: { ...candidate, id: randomUUID(), configurationVersion: 1, returnReceipt: true, statusCode: 201, outcome: 'RECEIVED', durationMs: 1 } })));
    for (const view of ['receipts', 'attempts']) {
      const first = await request(app.getHttpServer()).get(`${base}/${view}`).query({ sourceCode: 'COMPANY' }).set('Cookie', item.cookie).expect(200);
      expect(first.body.total).toBe(1);
      expect(first.body.items.map((row: { id: string }) => row.id)).toEqual([view === 'receipts' ? item.receipt.id : attempts[0]!.id]);
      const second = await request(app.getHttpServer()).get(`${base}/${view}`).query({ sourceCode: 'OTHER' }).set('Cookie', item.cookie).expect(200);
      expect(second.body.total).toBe(1);
      expect(second.body.items.map((row: { id: string }) => row.id)).toEqual([view === 'receipts' ? secondReceipt.id : attempts[1]!.id]);
      for (const sourceCode of ['MISSING', 'company', 'FOREIGN']) {
        const empty = await request(app.getHttpServer()).get(`${base}/${view}`).query({ sourceCode }).set('Cookie', item.cookie).expect(200);
        expect(empty.body).toMatchObject({ total: 0, items: [] });
      }
    }
  });
  it('refuses cross organization receipt IDs and ungranted target scopes', async () => {
    const first = await fixture(), second = await fixture();
    await request(app.getHttpServer()).get(`${base}/receipts/${second.receipt.id}`).set('Cookie', first.cookie).expect(404);
    await request(app.getHttpServer()).get(`${base}/receipts`).query({ organizationId: second.organization.id }).set('Cookie', first.cookie).expect(403);
  });
  it('hides expired plaintext before a retention worker runs', async () => {
    const item = await fixture();
    await prisma.integrationReceipt.update({ where: { id: item.receipt.id }, data: { bodyExpiresAt: new Date(Date.now() - 1000) } });
    const page = await request(app.getHttpServer()).get(`${base}/receipts`).set('Cookie', item.cookie).expect(200);
    expect(page.body.items[0].bodyAvailable).toBe(false);
    await request(app.getHttpServer()).get(`${base}/receipts/${item.receipt.id}/payload`).set('Cookie', item.cookie).expect(410);
    expect((await prisma.integrationReceipt.findUniqueOrThrow({ where: { id: item.receipt.id } })).payloadCiphertext).not.toBeNull();
  });
  it('rejects malformed filters and a window exceeding ninety days', async () => {
    const item = await fixture();
    await request(app.getHttpServer()).get(`${base}/receipts`).query({ from: new Date(Date.now() - 91 * 86400000).toISOString() }).set('Cookie', item.cookie).expect(400);
    await request(app.getHttpServer()).get(`${base}/receipts`).query({ traceId: 'not-a-uuid' }).set('Cookie', item.cookie).expect(400);
  });
  it('keeps an aged ninety-day query stable across pages while hiding expired records', async () => {
    const item = await fixture();
    const [clock] = await prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const now = clock!.now.getTime(), to = new Date(now - 120000).toISOString();
    const from = new Date(new Date(to).getTime() - 90 * 86400000 + 60000).toISOString();
    await prisma.integrationReceipt.update({ where: { id: item.receipt.id }, data: { receivedAt: new Date(now - 180000) } });
    const secondReceiptId = randomUUID(), expiredReceiptId = randomUUID();
    await prisma.integrationReceipt.createMany({ data: [
      { id: secondReceiptId, receivedAt: new Date(now - 240000), bodyExpiresAt: new Date(now + 86400000), metadataExpiresAt: new Date(now + 90 * 86400000) },
      { id: expiredReceiptId, receivedAt: new Date(new Date(from).getTime() + 30000), bodyExpiresAt: new Date(now - 83 * 86400000), metadataExpiresAt: new Date(now - 30000) },
    ].map(receipt => ({ ...receipt, organizationId: item.organization.id, endpointId: item.endpoint.id, credentialId: item.credential.id, messageId: randomUUID(), bodyDigest: 'd'.repeat(64), configurationVersion: 1, configurationSnapshot: {}, payloadBytes: 0 })) });
    const attemptIds = [randomUUID(), randomUUID(), randomUUID()];
    await prisma.integrationRequestAttempt.createMany({ data: [180000, 240000, 8 * 86400000].map((offset, index) => ({ id: attemptIds[index]!, organizationId: item.organization.id, endpointId: item.endpoint.id, credentialId: item.credential.id, configurationVersion: 1, returnReceipt: true, statusCode: 201, outcome: 'RECEIVED', durationMs: 1, observedAt: new Date(now - offset) })) });
    for (const view of ['receipts', 'attempts']) {
      const expectedIds = view === 'receipts' ? [item.receipt.id, secondReceiptId] : attemptIds.slice(0, 2);
      for (const page of [1, 2]) {
        const response = await request(app.getHttpServer()).get(`${base}/${view}`).query({ from, to, page, limit: 1 }).set('Cookie', item.cookie).expect(200);
        expect(response.body).toMatchObject({ total: 2, page, limit: 1, from, to, items: [{ id: expectedIds[page - 1] }] });
      }
    }
    expect(await prisma.integrationReceipt.count({ where: { organizationId: item.organization.id } })).toBe(3);
    expect(await prisma.integrationRequestAttempt.count({ where: { organizationId: item.organization.id } })).toBe(3);
  });
  it('does not disclose plaintext when the required audit write fails', async () => {
    const item = await fixture();
    const original = app.get(AuditLogService).record.bind(app.get(AuditLogService));
    const audit = jest.spyOn(app.get(AuditLogService), 'record').mockImplementation(async (input, transaction) => {
      if (input.action==='INTEGRATION_PAYLOAD_READ') throw new Error('injected audit unavailable');
      return original(input, transaction);
    });
    try {
      const response = await request(app.getHttpServer()).get(`${base}/receipts/${item.receipt.id}/payload`).set('Cookie', item.cookie).expect(500);
      expect(JSON.stringify(response.body)).not.toContain(item.text);
    } finally { audit.mockRestore(); }
  });
});
