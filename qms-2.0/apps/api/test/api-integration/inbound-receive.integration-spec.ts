import 'reflect-metadata';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { raw } from 'express';
import { jest } from '@jest/globals';
import request from 'supertest';
import { PrismaService } from '../../src/database/prisma.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { decryptSecret } from '../../src/common/security/security-keyring.js';
import { InboundController } from '../../src/modules/api-integration/inbound.controller.js';
import { InboundGuard } from '../../src/modules/api-integration/inbound.guard.js';
import { InboundService } from '../../src/modules/api-integration/inbound.service.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') {
  throw new Error('Inbound integration tests require disposable loopback PostgreSQL.');
}

describe('API inbound durable reception', () => {
  let prisma: PrismaService;
  let app: NestExpressApplication;
  let audit: AuditLogService;
  const organizations: string[] = [];

  beforeAll(async () => {
    app = (await Test.createTestingModule({ controllers: [InboundController], providers: [PrismaService, AuditLogService, InboundGuard, InboundService] }).compile())
      .createNestApplication<NestExpressApplication>({ bodyParser: false });
    app.use(raw({ type: () => true, limit: '1mb', inflate: false }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.listen(0, '127.0.0.1'); prisma = app.get(PrismaService); audit = app.get(AuditLogService);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    for (const organizationId of organizations) {
      await prisma.$executeRaw`DELETE FROM integration_receipts WHERE organization_id=${organizationId}::uuid`;
      await prisma.$executeRaw`DELETE FROM integration_rate_windows WHERE endpoint_id IN (SELECT id FROM integration_endpoints WHERE organization_id=${organizationId}::uuid)`;
      await prisma.$executeRaw`DELETE FROM integration_scope_capacities WHERE organization_id=${organizationId}::uuid`;
      await prisma.auditEvent.deleteMany({ where: { organizationId } });
      await prisma.$executeRaw`DELETE FROM integration_credentials WHERE organization_id=${organizationId}::uuid`;
      await prisma.$executeRaw`DELETE FROM integration_endpoints WHERE organization_id=${organizationId}::uuid`;
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await app?.close();
  });

  async function fixture() {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Inbound technical fixture', type: 'INTERNAL' } }); organizations.push(organization.id);
    const endpointId = randomUUID(), credentialId = randomUUID(), secret = randomBytes(32).toString('base64url');
    await prisma.$executeRaw`INSERT INTO integration_endpoints(id,organization_id,code,name,source_code,source_name,status)
      VALUES(${endpointId}::uuid,${organization.id}::uuid,${randomUUID()},'Technical receiver','TECHNICAL','Technical source','ENABLED')`;
    await prisma.$executeRaw`INSERT INTO integration_credentials(id,organization_id,endpoint_id,name,secret_hash,expires_at)
      VALUES(${credentialId}::uuid,${organization.id}::uuid,${endpointId}::uuid,'Test credential',${createHash('sha256').update(secret).digest('hex')},CURRENT_TIMESTAMP+interval '1 day')`;
    return { organizationId: organization.id, endpointId, credentialId, token: `${credentialId}.${secret}`, path: `/api/v1/integrations/inbound/${endpointId}/messages` };
  }
  function send(receiver: { path: string; token: string }, messageId = randomUUID(), body: string | Buffer = '{"reading":1}') {
    return request(app.getHttpServer()).post(receiver.path).set('Authorization', `Bearer ${receiver.token}`).set('Idempotency-Key', messageId).set('Content-Type', 'application/json').send(body);
  }

  it('has receipt, rate and scope capacity constraints in real PostgreSQL', async () => {
    expect(await prisma.$queryRaw`SELECT to_regclass('public.integration_receipts')::text AS receipts,
      to_regclass('public.integration_rate_windows')::text AS windows,
      to_regclass('public.integration_scope_capacities')::text AS capacities`)
      .toEqual([{ receipts: 'integration_receipts', windows: 'integration_rate_windows', capacities: 'integration_scope_capacities' }]);
  });

  it('requires a machine credential and ignores personnel cookies', async () => {
    const receiver = await fixture();
    await request(app.getHttpServer()).post(receiver.path).set('Cookie', 'qms_session=not-a-machine-credential').send({}).expect(401);
    await send({ ...receiver, token: `${randomUUID()}.${randomBytes(32).toString('base64url')}` }).expect(401);
    const another = await fixture(); await send({ ...receiver, token: another.token }).expect(401);
    await request(app.getHttpServer()).post(receiver.path).set('Authorization', [`Bearer ${receiver.token}`, `Bearer ${receiver.token}`]).send({}).expect(401);
  });

  it('encrypts one durable record and returns the same receipt for byte-identical retries', async () => {
    const receiver = await fixture(), messageId = randomUUID(), body = '{"reading":"confidential fixture value"}';
    const first = await send(receiver, messageId, body).expect(201);
    const duplicate = await send(receiver, messageId, body).expect(200);
    expect(first.body).toMatchObject({ messageId, status: 'RECEIVED', duplicate: false });
    expect(duplicate.body).toEqual({ ...first.body, duplicate: true });
    expect(first.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    const rows = await prisma.$queryRaw<{ id: string; ciphertext: string; bytes: number; version: number }[]>`SELECT id,payload_ciphertext AS ciphertext,payload_bytes AS bytes,configuration_version AS version FROM integration_receipts WHERE endpoint_id=${receiver.endpointId}::uuid`;
    expect(rows).toHaveLength(1); expect(rows[0]!.ciphertext).not.toContain('confidential fixture value'); expect(rows[0]!.version).toBe(1);
    expect(decryptSecret(rows[0]!.ciphertext, `integration:${receiver.organizationId}:${receiver.endpointId}:${rows[0]!.id}`)).toBe(body);
    const counters = await prisma.$queryRaw<{ requests: number; used: number; receipts: number }[]>`SELECT w.requests,c.used_body_bytes::float8 AS used,c.receipt_count AS receipts
      FROM integration_rate_windows w JOIN integration_endpoints e ON e.id=w.endpoint_id JOIN integration_scope_capacities c ON c.organization_id=e.organization_id WHERE e.id=${receiver.endpointId}::uuid`;
    expect(counters).toEqual([{ requests: 2, used: rows[0]!.bytes, receipts: 1 }]);
  });

  it('uses the current returnReceipt switch, always preserving internal receipt identity', async () => {
    const receiver = await fixture(), messageId = randomUUID();
    await prisma.$executeRaw`UPDATE integration_endpoints SET return_receipt=false WHERE id=${receiver.endpointId}::uuid`;
    const first = await send(receiver, messageId).expect(204); expect(first.text).toBe(''); expect(first.headers['x-request-id']).toBeTruthy();
    expect(Object.keys(first.headers)).not.toContain('x-receipt-id');
    const second = await send(receiver, messageId).expect(204); expect(second.text).toBe('');
    await prisma.$executeRaw`UPDATE integration_endpoints SET return_receipt=true,version=version+1 WHERE id=${receiver.endpointId}::uuid`;
    const restored = await send(receiver, messageId).expect(200); expect(restored.body.duplicate).toBe(true);
    const records = await prisma.$queryRaw<{ id: string; version: number }[]>`SELECT id,configuration_version AS version FROM integration_receipts WHERE endpoint_id=${receiver.endpointId}::uuid`;
    expect(records).toEqual([{ id: restored.body.receiptId, version: 1 }]);
    await prisma.$executeRaw`UPDATE integration_endpoints SET return_receipt=false WHERE id=${receiver.endpointId}::uuid`;
    await send(receiver, messageId, '{"reading":2}').expect(409);
  });

  it('rejects conflicting bytes, invalid messages and excessive bodies without saving them', async () => {
    const receiver = await fixture(), messageId = randomUUID(); await send(receiver, messageId).expect(201);
    await send(receiver, messageId, '{ "reading":1}').expect(409);
    for (const body of ['[]', 'null', '{', '[{}]', '{"x":' + '['.repeat(33) + '0' + ']'.repeat(33) + '}']) await send(receiver, randomUUID(), body).expect(400);
    await send(receiver, 'short').expect(400);
    const base = await app.getUrl();
    const invalidUtf8Status = await new Promise<number>((resolve, reject) => {
      const bytesRequest = httpRequest(`${base}${receiver.path}`, { method: 'POST', headers: { Authorization: `Bearer ${receiver.token}`, 'Idempotency-Key': randomUUID(), 'Content-Type': 'application/json' } }, response => {
        response.resume(); response.once('end', () => resolve(response.statusCode!));
      });
      bytesRequest.once('error', reject); bytesRequest.end(Buffer.from([0xff]));
    });
    expect(invalidUtf8Status).toBe(400);
    await request(app.getHttpServer()).post(receiver.path).set('Authorization', `Bearer ${receiver.token}`).set('Idempotency-Key', randomUUID()).set('Content-Type', 'text/plain').send('data').expect(415);
    await prisma.$executeRaw`UPDATE integration_endpoints SET max_body_bytes=4 WHERE id=${receiver.endpointId}::uuid`;
    await send(receiver).expect(413);
    const count = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM integration_receipts WHERE endpoint_id=${receiver.endpointId}::uuid`;
    expect(count).toEqual([{ count: 1 }]);
  });

  it('revalidates expired, revoked, disabled and unconfigured organizations', async () => {
    const receiver = await fixture();
    await prisma.$executeRaw`UPDATE integration_credentials SET expires_at=CURRENT_TIMESTAMP-interval '1 second' WHERE id=${receiver.credentialId}::uuid`; await send(receiver).expect(401);
    await prisma.$executeRaw`UPDATE integration_credentials SET expires_at=CURRENT_TIMESTAMP+interval '1 day',revoked_at=CURRENT_TIMESTAMP WHERE id=${receiver.credentialId}::uuid`; await send(receiver).expect(401);
    await prisma.$executeRaw`UPDATE integration_credentials SET revoked_at=NULL WHERE id=${receiver.credentialId}::uuid`;
    await prisma.$executeRaw`UPDATE integration_endpoints SET status='DISABLED' WHERE id=${receiver.endpointId}::uuid`; await send(receiver).expect(403);
    await prisma.$executeRaw`UPDATE integration_endpoints SET status='ENABLED' WHERE id=${receiver.endpointId}::uuid`;
    await prisma.organization.update({ where: { id: receiver.organizationId }, data: { configurationRequired: true, status: 'DISABLED' } }); await send(receiver).expect(403);
  });

  it('persists per-minute limits in PostgreSQL and counts duplicate attempts', async () => {
    const receiver = await fixture(), messageId = randomUUID();
    await prisma.$executeRaw`UPDATE integration_endpoints SET rate_per_minute=2 WHERE id=${receiver.endpointId}::uuid`;
    await send(receiver, messageId).expect(201); await send(receiver, messageId).expect(200);
    const limited = await send(receiver, messageId).expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    const windows = await prisma.$queryRaw<{ requests: number }[]>`SELECT requests FROM integration_rate_windows WHERE endpoint_id=${receiver.endpointId}::uuid`;
    expect(windows).toEqual([{ requests: 2 }]);
  });

  it('checks IPv4 and IPv6 CIDRs against the actual peer, not an untrusted forwarding header', async () => {
    const receiver = await fixture();
    await prisma.$executeRaw`UPDATE integration_endpoints SET allowed_ips=ARRAY['192.0.2.0/24'] WHERE id=${receiver.endpointId}::uuid`;
    await send(receiver).set('X-Forwarded-For', '192.0.2.12').expect(403);
    await prisma.$executeRaw`UPDATE integration_endpoints SET allowed_ips=ARRAY['127.0.0.0/8','::1/128'] WHERE id=${receiver.endpointId}::uuid`;
    await send(receiver).expect(201);
  });

  it('rolls back record and quota when required audit fails, including receipt-off mode', async () => {
    const receiver = await fixture(); await prisma.$executeRaw`UPDATE integration_endpoints SET return_receipt=false WHERE id=${receiver.endpointId}::uuid`;
    jest.spyOn(audit, 'record').mockRejectedValueOnce(new Error('required audit fixture failure'));
    await send(receiver).expect(503);
    expect(await prisma.$queryRaw`SELECT count(*)::int AS count FROM integration_receipts WHERE endpoint_id=${receiver.endpointId}::uuid`).toEqual([{ count: 0 }]);
    expect(await prisma.$queryRaw`SELECT used_body_bytes::float8 AS used,receipt_count AS receipts FROM integration_scope_capacities WHERE organization_id=${receiver.organizationId}::uuid`).toEqual([]);
  });

  it('serves an existing receipt when storage is full but rejects new messages', async () => {
    const receiver = await fixture(), messageId = randomUUID(); await send(receiver, messageId).expect(201);
    await prisma.$executeRaw`UPDATE integration_scope_capacities SET used_body_bytes=1073741824 WHERE organization_id=${receiver.organizationId}::uuid`;
    await send(receiver, messageId).expect(200); await send(receiver).expect(503);
  });

  it('resolves an unknown commit acknowledgement by retrying the original message identity', async () => {
    const receiver = await fixture(), messageId = randomUUID(), transaction = prisma.$transaction.bind(prisma);
    let transactions = 0;
    jest.spyOn(prisma, '$transaction').mockImplementation(async (work, options) => {
      const result = await transaction(work, options);
      if (++transactions === 2) throw new Error('commit acknowledgement fixture lost after actual commit');
      return result;
    });
    await send(receiver, messageId).expect(503);
    jest.restoreAllMocks();
    const retry = await send(receiver, messageId).expect(200); expect(retry.body.duplicate).toBe(true);
    expect(await prisma.$queryRaw`SELECT id FROM integration_receipts WHERE endpoint_id=${receiver.endpointId}::uuid`).toEqual([{ id: retry.body.receiptId }]);
    expect(await prisma.auditEvent.count({ where: { organizationId: receiver.organizationId, action: 'INTEGRATION_MESSAGE_RECEIVED' } })).toBe(1);
  });

  it('accepts a 128-byte message identifier without truncating its identity', async () => {
    const receiver = await fixture(), messageId = 'message_'.padEnd(128, 'x');
    const accepted = await send(receiver, messageId).expect(201); expect(accepted.body.messageId).toBe(messageId);
    const retry = await send(receiver, messageId).expect(200); expect(retry.body.receiptId).toBe(accepted.body.receiptId);
  });
  it('allows an expired message key to be reused before the cleanup worker has run', async () => {
    const receiver = await fixture(), messageId = randomUUID(); const first = await send(receiver, messageId).expect(201);
    await prisma.$executeRaw`UPDATE integration_receipts SET metadata_expires_at=CURRENT_TIMESTAMP-interval '1 second' WHERE id=${first.body.receiptId}::uuid`;
    const next = await send(receiver, messageId, '{"reading":2}').expect(201); expect(next.body.receiptId).not.toBe(first.body.receiptId);
    expect(await prisma.$queryRaw`SELECT receipt_count AS count FROM integration_scope_capacities WHERE organization_id=${receiver.organizationId}::uuid`).toEqual([{ count: 1 }]);
  });
});
