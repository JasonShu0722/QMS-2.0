import 'reflect-metadata';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { jest } from '@jest/globals';
import request from 'supertest';
import { PrismaService } from '../../src/database/prisma.service.js';
import { configureHttpBodyParser } from '../../src/http-body-parser.js';
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
    configureHttpBodyParser(app);
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

  async function fixture(code = randomUUID()) {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Inbound technical fixture', type: 'INTERNAL' } }); organizations.push(organization.id);
    const endpointId = randomUUID(), credentialId = randomUUID(), secret = randomBytes(32).toString('base64url');
    await prisma.$executeRaw`INSERT INTO integration_endpoints(id,organization_id,code,name,source_code,source_name,status)
      VALUES(${endpointId}::uuid,${organization.id}::uuid,${code},'Technical receiver','TECHNICAL','Technical source','ENABLED')`;
    await prisma.$executeRaw`INSERT INTO integration_credentials(id,organization_id,endpoint_id,name,secret_hash,expires_at)
      VALUES(${credentialId}::uuid,${organization.id}::uuid,${endpointId}::uuid,'Test credential',${createHash('sha256').update(secret).digest('hex')},CURRENT_TIMESTAMP+interval '1 day')`;
    return { organizationId: organization.id, endpointId, credentialId, token: `${credentialId}.${secret}`, path: `/api/v1/integrations/inbound/${endpointId}/messages` };
  }
  function send(receiver: { path: string; token: string }, messageId = randomUUID(), body: string | Buffer = '[{"reading":1}]') {
    return request(app.getHttpServer()).post(receiver.path).set('Authorization', `Bearer ${receiver.token}`).set('Idempotency-Key', messageId).set('Content-Type', 'application/json').send(body);
  }
  const codePath = (code: string) => `/api/v1/integrations/inbound/${encodeURIComponent(code)}/messages`;
  async function receiptIds(endpointId: string) {
    return prisma.integrationReceipt.findMany({ where: { endpointId }, orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }], select: { id: true, messageId: true } });
  }

  it('accepts object arrays as one raw receipt including empty and multiple items', async () => {
    const receiver = await fixture();
    for (const body of ['[]', '[{}]', '[ {"reading":1}, {"reading":2,"nested":{"values":[1,null]}} ]']) {
      const accepted = await send(receiver, randomUUID(), body).expect(200);
      expect(accepted.body).toBe(true);
      const stored = await prisma.integrationReceipt.findFirstOrThrow({ where: { endpointId: receiver.endpointId }, orderBy: { receivedAt: 'desc' } });
      expect(decryptSecret(stored.payloadCiphertext!, `integration:${receiver.organizationId}:${receiver.endpointId}:${stored.id}`)).toBe(body);
      expect(stored.messageId).toBe(stored.id);
    }
    expect(await prisma.integrationReceipt.count({ where: { endpointId: receiver.endpointId } })).toBe(3);
  });

  it('returns HTTP 200 for successful receipt responses with and without the receipt body', async () => {
    const receiver = await fixture();
    const withReceipt = await send(receiver, randomUUID()).expect(200);
    expect(withReceipt.body).toBe(true);
    await prisma.$executeRaw`UPDATE integration_endpoints SET return_receipt=false WHERE id=${receiver.endpointId}::uuid`;
    const withoutReceipt = await send(receiver, randomUUID()).expect(200);
    expect(withoutReceipt.text).toBe('');
  });

  it('rejects a root object and non-object array items without persisting a receipt', async () => {
    const receiver = await fixture();
    for (const body of ['{}', '{"reading":1}', 'null', 'true', '1', '"text"', '[null]', '[1]', '["text"]', '[true]', '[[]]', '[{},null]']) {
      await send(receiver, randomUUID(), body).expect(400);
    }
    expect(await prisma.integrationReceipt.count({ where: { endpointId: receiver.endpointId } })).toBe(0);
  });

  it('accepts messages without a caller idempotency key and assigns a server message identity', async () => {
    const receiver = await fixture();
    const accepted = await request(app.getHttpServer()).post(receiver.path).set('Authorization', `Bearer ${receiver.token}`)
      .set('Content-Type', 'application/json').send('[{"reading":1}]').expect(200);
    expect(accepted.body).toBe(true);
    const [stored] = await receiptIds(receiver.endpointId);
    expect(stored!.messageId).toBe(stored!.id);
    expect(stored!.id).toMatch(/^[a-f0-9-]{36}$/);
  });

  it('stores each request independently when an old caller key is reused with different content', async () => {
    const receiver = await fixture(), oldKey = randomUUID();
    const first = await send(receiver, oldKey, '[{"reading":1}]').expect(200);
    const second = await send(receiver, oldKey, '[{"reading":2}]').expect(200);
    expect(first.body).toBe(true); expect(second.body).toBe(true);
    const stored = await receiptIds(receiver.endpointId);
    expect(stored[0]!.id).not.toBe(stored[1]!.id);
    expect(await prisma.$queryRaw`SELECT count(*)::int AS count FROM integration_receipts WHERE endpoint_id=${receiver.endpointId}::uuid`).toEqual([{ count: 2 }]);
  });

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

  it('uses the same endpoint across an encoded interface code and the legacy UUID with independent receipts', async () => {
    const code = 'Erp:inbound', receiver = await fixture(code), messageId = randomUUID();
    const first = await send({ ...receiver, path: codePath(code) }, messageId).expect(200);
    const retry = await send({ ...receiver, path: codePath(receiver.endpointId.toUpperCase()) }, messageId).expect(200);
    expect(first.body).toBe(true); expect(retry.body).toBe(true);
    expect(retry.headers['x-request-id']).not.toBe(first.headers['x-request-id']);
    await send({ ...receiver, path: codePath(code.toLowerCase()) }).expect(401);
    await send({ ...receiver, path: codePath('A'.repeat(65)) }).expect(401);
    expect(await prisma.$queryRaw`SELECT id,organization_id,endpoint_id,credential_id FROM integration_receipts WHERE endpoint_id=${receiver.endpointId}::uuid`)
      .toEqual(expect.arrayContaining((await receiptIds(receiver.endpointId)).map(response => ({ id: response.id, organization_id: receiver.organizationId, endpoint_id: receiver.endpointId, credential_id: receiver.credentialId }))));
  });

  it('binds a shared interface code to each credential’s own organization', async () => {
    const code = 'test', first = await fixture(code), second = await fixture(code), other = await fixture('different-code');
    const path = codePath(code), messageId = randomUUID();
    await send({ ...other, path }, messageId).expect(401);
    await send({ ...first, path: second.path }, messageId).expect(401);
    const accepted = await send({ ...first, path }, messageId).expect(200);
    const separate = await send({ ...second, path }, messageId).expect(200);
    expect(accepted.body).toBe(true); expect(separate.body).toBe(true);
    const acceptedId = (await receiptIds(first.endpointId))[0]!.id;
    const separateId = (await receiptIds(second.endpointId))[0]!.id;
    const receipts = await prisma.$queryRaw<unknown[]>`SELECT id,organization_id,endpoint_id FROM integration_receipts WHERE id IN (${acceptedId}::uuid,${separateId}::uuid)`;
    expect(receipts).toHaveLength(2);
    expect(receipts).toEqual(expect.arrayContaining([
      { id: acceptedId, organization_id: first.organizationId, endpoint_id: first.endpointId },
      { id: separateId, organization_id: second.organizationId, endpoint_id: second.endpointId },
    ]));
  });

  it('matches a UUID-shaped interface code against the endpoint bound to the credential', async () => {
    const original = await fixture(), alias = await fixture(original.endpointId);
    const messageId = randomUUID();
    const first = await send(original, messageId).expect(200);
    const second = await send({ ...alias, path: original.path }, messageId).expect(200);
    const retry = await send(alias, messageId).expect(200);
    expect(first.body).toBe(true); expect(second.body).toBe(true); expect(retry.body).toBe(true);
    const originalIds = await receiptIds(original.endpointId), aliasIds = await receiptIds(alias.endpointId);
    const ids = [...originalIds, ...aliasIds].map(row => row.id);
    expect(ids).toHaveLength(3); expect(new Set(ids).size).toBe(3);
  });

  it('accepts a permanent credential on the code address until it is revoked', async () => {
    const code = 'permanent', receiver = await fixture(code), messageId = randomUUID();
    await prisma.$executeRaw`UPDATE integration_credentials SET expires_at=NULL WHERE id=${receiver.credentialId}::uuid`;
    await prisma.$executeRaw`UPDATE integration_endpoints SET return_receipt=false WHERE id=${receiver.endpointId}::uuid`;
    const coded = { ...receiver, path: codePath(code) };
    const accepted = await send(coded, messageId).expect(200);
    expect(accepted.text).toBe('');
    await send(receiver, messageId).expect(200);
    await prisma.$executeRaw`UPDATE integration_credentials SET revoked_at=clock_timestamp() WHERE id=${receiver.credentialId}::uuid`;
    await send(coded).expect(401);
    const records = await prisma.$queryRaw<{ id: string; message_id: string }[]>`SELECT id,message_id FROM integration_receipts WHERE endpoint_id=${receiver.endpointId}::uuid`;
    expect(records).toHaveLength(2); expect(records.every(row => row.message_id === row.id)).toBe(true);
  });

  it('encrypts separate durable records and accounts for every byte-identical retry', async () => {
    const receiver = await fixture(), messageId = randomUUID(), body = '[{"reading":"confidential fixture value"}]';
    const first = await send(receiver, messageId, body).expect(200);
    const repeated = await send(receiver, messageId, body).expect(200);
    expect(first.body).toBe(true); expect(repeated.body).toBe(true);
    expect(first.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    const rows = await prisma.$queryRaw<{ id: string; ciphertext: string; bytes: number; version: number }[]>`SELECT id,payload_ciphertext AS ciphertext,payload_bytes AS bytes,configuration_version AS version FROM integration_receipts WHERE endpoint_id=${receiver.endpointId}::uuid`;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.ciphertext).not.toContain('confidential fixture value'); expect(row.version).toBe(1);
      expect(decryptSecret(row.ciphertext, `integration:${receiver.organizationId}:${receiver.endpointId}:${row.id}`)).toBe(body);
    }
    expect(await prisma.$queryRaw`SELECT body_digest FROM integration_receipts WHERE endpoint_id=${receiver.endpointId}::uuid`).toEqual([{ body_digest: null }, { body_digest: null }]);
    const counters = await prisma.$queryRaw<{ requests: number; used: number; receipts: number }[]>`SELECT w.requests,c.used_body_bytes::float8 AS used,c.receipt_count AS receipts
      FROM integration_rate_windows w JOIN integration_endpoints e ON e.id=w.endpoint_id JOIN integration_scope_capacities c ON c.organization_id=e.organization_id WHERE e.id=${receiver.endpointId}::uuid`;
    expect(counters).toEqual([{ requests: 2, used: rows.reduce((total, row) => total + row.bytes, 0), receipts: 2 }]);
  });

  it('uses the current returnReceipt switch, always preserving internal receipt identity', async () => {
    const receiver = await fixture(), messageId = randomUUID();
    await prisma.$executeRaw`UPDATE integration_endpoints SET return_receipt=false WHERE id=${receiver.endpointId}::uuid`;
    const first = await send(receiver, messageId).expect(200); expect(first.text).toBe(''); expect(first.headers['x-request-id']).toBeTruthy();
    expect(Object.keys(first.headers)).not.toContain('x-receipt-id');
    const second = await send(receiver, messageId).expect(200); expect(second.text).toBe('');
    await prisma.$executeRaw`UPDATE integration_endpoints SET return_receipt=true,version=version+1 WHERE id=${receiver.endpointId}::uuid`;
    const restored = await send(receiver, messageId).expect(200); expect(restored.body).toBe(true);
    const records = await prisma.$queryRaw<{ id: string; version: number }[]>`SELECT id,configuration_version AS version FROM integration_receipts WHERE endpoint_id=${receiver.endpointId}::uuid`;
    expect(records).toHaveLength(3); expect(records).toEqual(expect.arrayContaining([{ id: records.find(record => record.version === 2)!.id, version: 2 }]));
    expect(records.filter(row => row.version === 1)).toHaveLength(2);
    await prisma.$executeRaw`UPDATE integration_endpoints SET return_receipt=false WHERE id=${receiver.endpointId}::uuid`;
    await send(receiver, messageId, '[{"reading":2}]').expect(200);
  });

  it('accepts changed bytes but rejects invalid JSON and excessive bodies without saving them', async () => {
    const receiver = await fixture(), messageId = randomUUID(); await send(receiver, messageId).expect(200);
    await send(receiver, messageId, '[{ "reading":1}]').expect(200);
    for (const body of ['null', '{', '[', '[{}', '[{"x":' + '['.repeat(32) + '0' + ']'.repeat(32) + '}]']) await send(receiver, randomUUID(), body).expect(400);
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
    expect(count).toEqual([{ count: 2 }]);
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

  it('persists per-minute limits in PostgreSQL and counts every repeated request', async () => {
    const receiver = await fixture(), messageId = randomUUID();
    await prisma.$executeRaw`UPDATE integration_endpoints SET rate_per_minute=2 WHERE id=${receiver.endpointId}::uuid`;
    await send(receiver, messageId).expect(200); await send(receiver, messageId).expect(200);
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
    await send(receiver).expect(200);
  });

  it('rolls back record and quota when required audit fails, including receipt-off mode', async () => {
    const receiver = await fixture(); await prisma.$executeRaw`UPDATE integration_endpoints SET return_receipt=false WHERE id=${receiver.endpointId}::uuid`;
    jest.spyOn(audit, 'record').mockRejectedValueOnce(new Error('required audit fixture failure'));
    await send(receiver).expect(503);
    expect(await prisma.$queryRaw`SELECT count(*)::int AS count FROM integration_receipts WHERE endpoint_id=${receiver.endpointId}::uuid`).toEqual([{ count: 0 }]);
    expect(await prisma.$queryRaw`SELECT used_body_bytes::float8 AS used,receipt_count AS receipts FROM integration_scope_capacities WHERE organization_id=${receiver.organizationId}::uuid`).toEqual([]);
  });

  it('rejects every new request when storage is full even when an old key is reused', async () => {
    const receiver = await fixture(), messageId = randomUUID(); await send(receiver, messageId).expect(200);
    await prisma.$executeRaw`UPDATE integration_scope_capacities SET used_body_bytes=1073741824 WHERE organization_id=${receiver.organizationId}::uuid`;
    await send(receiver, messageId).expect(503); await send(receiver).expect(503);
    expect(await prisma.$queryRaw`SELECT count(*)::int AS count FROM integration_receipts WHERE endpoint_id=${receiver.endpointId}::uuid`).toEqual([{ count: 1 }]);
  });

  it('preserves an unknown committed receipt and saves a retry as another receipt', async () => {
    const receiver = await fixture(), messageId = randomUUID(), transaction = prisma.$transaction.bind(prisma);
    let transactions = 0;
    jest.spyOn(prisma, '$transaction').mockImplementation(async (work, options) => {
      const result = await transaction(work, options);
      if (++transactions === 2) throw new Error('commit acknowledgement fixture lost after actual commit');
      return result;
    });
    await send(receiver, messageId).expect(503);
    jest.restoreAllMocks();
    const retry = await send(receiver, messageId).expect(200); expect(retry.body).toBe(true);
    const rows = await prisma.$queryRaw`SELECT id FROM integration_receipts WHERE endpoint_id=${receiver.endpointId}::uuid`;
    expect(rows).toHaveLength(2);
    expect(await prisma.auditEvent.count({ where: { organizationId: receiver.organizationId, action: 'INTEGRATION_MESSAGE_RECEIVED' } })).toBe(2);
  });

  it('ignores malformed and repeated legacy key headers instead of using them as message identity', async () => {
    const receiver = await fixture();
    for (const key of ['short', 'x'.repeat(129), 'not a message id']) {
      const accepted = await send(receiver, key).expect(200);
      expect(accepted.body).toBe(true);
    }
    const repeatedHeader = await request(app.getHttpServer()).post(receiver.path).set('Authorization', `Bearer ${receiver.token}`)
      .set('Idempotency-Key', ['legacy-one', 'legacy-two']).set('Content-Type', 'application/json').send('[{}]').expect(200);
    expect(repeatedHeader.body).toBe(true);
  });
  it('leaves expired historical metadata for cleanup while accepting an independent new receipt', async () => {
    const receiver = await fixture(), messageId = randomUUID(); const first = await send(receiver, messageId).expect(200); expect(first.body).toBe(true);
    const firstId = (await receiptIds(receiver.endpointId))[0]!.id;
    await prisma.$executeRaw`UPDATE integration_receipts SET metadata_expires_at=CURRENT_TIMESTAMP-interval '1 second' WHERE id=${firstId}::uuid`;
    const next = await send(receiver, messageId, '[{"reading":2}]').expect(200); expect(next.body).toBe(true);
    expect(await prisma.$queryRaw`SELECT receipt_count AS count FROM integration_scope_capacities WHERE organization_id=${receiver.organizationId}::uuid`).toEqual([{ count: 2 }]);
    expect(await prisma.$queryRaw`SELECT id FROM integration_receipts WHERE id=${firstId}::uuid`).toEqual([{ id: firstId }]);
  });
});
