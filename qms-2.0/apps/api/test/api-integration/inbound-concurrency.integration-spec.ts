import 'reflect-metadata';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { raw } from 'express';
import { Client } from 'pg';
import request from 'supertest';
import { PrismaService } from '../../src/database/prisma.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { InboundController } from '../../src/modules/api-integration/inbound.controller.js';
import { InboundGuard } from '../../src/modules/api-integration/inbound.guard.js';
import { InboundService, inboundIpAllowed } from '../../src/modules/api-integration/inbound.service.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') throw new Error('Inbound concurrency requires disposable PostgreSQL.');

describe('inbound transactional concurrency', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const organizations: string[] = [];
  beforeAll(async () => {
    app = (await Test.createTestingModule({ controllers: [InboundController], providers: [PrismaService, AuditLogService, InboundGuard, InboundService] }).compile()).createNestApplication<NestExpressApplication>({ bodyParser: false });
    app.use(raw({ type: () => true, limit: '1mb', inflate: false })); app.useGlobalFilters(new GlobalExceptionFilter());
    await app.listen(0, '127.0.0.1'); prisma = app.get(PrismaService);
  });
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
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Inbound concurrency fixture', type: 'INTERNAL' } }); organizations.push(organization.id);
    const endpointId = randomUUID(), credentialId = randomUUID(), secret = randomBytes(32).toString('base64url');
    await prisma.$executeRaw`INSERT INTO integration_endpoints(id,organization_id,code,name,source_code,source_name,status)
      VALUES(${endpointId}::uuid,${organization.id}::uuid,${randomUUID()},'Concurrent receiver','TECHNICAL','Technical source','ENABLED')`;
    await prisma.$executeRaw`INSERT INTO integration_credentials(id,organization_id,endpoint_id,name,secret_hash,expires_at)
      VALUES(${credentialId}::uuid,${organization.id}::uuid,${endpointId}::uuid,'Concurrent credential',${createHash('sha256').update(secret).digest('hex')},clock_timestamp()+interval '1 day')`;
    return { organizationId: organization.id, endpointId, credentialId, token: `${credentialId}.${secret}`, path: `/api/v1/integrations/inbound/${endpointId}/messages` };
  }
  const send = (receiver: { token: string; path: string }, messageId: string, body = '{"value":1}') => request(app.getHttpServer()).post(receiver.path).set('Authorization', `Bearer ${receiver.token}`).set('Idempotency-Key', messageId).set('Content-Type', 'application/json').send(body);
  async function waitingForRowLock(table: 'organizations' | 'integration_credentials') {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${`%${table}%`} AND query LIKE '%FOR UPDATE%') AS waiting`;
      if (rows[0]!.waiting) return;
      await delay(10);
    }
    throw new Error(`Inbound request did not reach the ${table} row lock.`);
  }

  it('receives one row and performs one required audit for eight simultaneous identical requests', async () => {
    const receiver = await fixture(), messageId = randomUUID();
    const responses = await Promise.all(Array.from({ length: 8 }, () => send(receiver, messageId)));
    expect(responses.map(response => response.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
    expect(new Set(responses.map(response => response.body.receiptId)).size).toBe(1);
    expect(await prisma.$queryRaw`SELECT count(*)::int AS count FROM integration_receipts WHERE endpoint_id=${receiver.endpointId}::uuid`).toEqual([{ count: 1 }]);
    expect(await prisma.auditEvent.count({ where: { organizationId: receiver.organizationId, action: 'INTEGRATION_MESSAGE_RECEIVED' } })).toBe(1);
    expect(await prisma.$queryRaw`SELECT receipt_count AS count FROM integration_scope_capacities WHERE organization_id=${receiver.organizationId}::uuid`).toEqual([{ count: 1 }]);
  });

  it('does not overwrite whichever different payload wins the same message identity', async () => {
    const receiver = await fixture(), messageId = randomUUID();
    const responses = await Promise.all([send(receiver, messageId, '{"value":1}'), send(receiver, messageId, '{"value":2}')]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect(await prisma.$queryRaw`SELECT count(*)::int AS count FROM integration_receipts WHERE endpoint_id=${receiver.endpointId}::uuid`).toEqual([{ count: 1 }]);
  });

  it('rechecks revocation after waiting for a real organization row lock', async () => {
    const receiver = await fixture(), connection = new Client({ connectionString: process.env.DATABASE_URL }); await connection.connect();
    try {
      await connection.query('BEGIN'); await connection.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [receiver.organizationId]);
      const pending = send(receiver, randomUUID()).then(response => response);
      await waitingForRowLock('organizations');
      await connection.query('UPDATE integration_credentials SET revoked_at=clock_timestamp() WHERE id=$1', [receiver.credentialId]);
      await connection.query('COMMIT'); expect((await pending).status).toBe(401);
      expect(await prisma.$queryRaw`SELECT count(*)::int AS count FROM integration_receipts WHERE endpoint_id=${receiver.endpointId}::uuid`).toEqual([{ count: 0 }]);
    } finally { await connection.query('ROLLBACK'); await connection.end(); }
  });

  it('uses database wall-clock expiry after waiting for the credential row lock', async () => {
    const receiver = await fixture(), connection = new Client({ connectionString: process.env.DATABASE_URL }); await connection.connect();
    try {
      await prisma.$executeRaw`UPDATE integration_credentials SET expires_at=clock_timestamp()+interval '800 milliseconds' WHERE id=${receiver.credentialId}::uuid`;
      await connection.query('BEGIN'); await connection.query('SELECT id FROM integration_credentials WHERE id=$1 FOR UPDATE', [receiver.credentialId]);
      const pending = send(receiver, randomUUID()).then(response => response);
      await waitingForRowLock('integration_credentials'); await connection.query('SELECT pg_sleep(0.9)');
      await connection.query('COMMIT'); expect((await pending).status).toBe(401);
    } finally { await connection.query('ROLLBACK'); await connection.end(); }
  });

  it('rechecks organization disable after waiting and never falls back to the initial identity', async () => {
    const receiver = await fixture(), connection = new Client({ connectionString: process.env.DATABASE_URL }); await connection.connect();
    try {
      await connection.query('BEGIN'); await connection.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [receiver.organizationId]);
      const pending = send(receiver, randomUUID()).then(response => response);
      await waitingForRowLock('organizations'); await connection.query('UPDATE organizations SET status=\'DISABLED\' WHERE id=$1', [receiver.organizationId]);
      await connection.query('COMMIT'); expect((await pending).status).toBe(403);
    } finally { await connection.query('ROLLBACK'); await connection.end(); }
  });

  it('returns the original receipt when the first response body is lost after commit', async () => {
    const receiver = await fixture(), messageId = randomUUID(), base = await app.getUrl();
    await new Promise<void>((resolve, reject) => {
      const outgoing = httpRequest(`${base}${receiver.path}`, { method: 'POST', headers: { Authorization: `Bearer ${receiver.token}`, 'Idempotency-Key': messageId, 'Content-Type': 'application/json' } }, response => {
        expect(response.statusCode).toBe(201); response.destroy(); resolve();
      });
      outgoing.once('error', reject); outgoing.end('{"value":1}');
    });
    const retry = await send(receiver, messageId).expect(200); expect(retry.body.duplicate).toBe(true);
    expect(await prisma.$queryRaw`SELECT id FROM integration_receipts WHERE endpoint_id=${receiver.endpointId}::uuid`).toEqual([{ id: retry.body.receiptId }]);
  });

  it('matches IPv6 subnets and IPv4-mapped peers without accepting malformed allowlists', () => {
    expect(inboundIpAllowed('2001:db8:1::1234', ['2001:db8:1::/48'])).toBe(true);
    expect(inboundIpAllowed('2001:db8:2::1', ['2001:db8:1::/48'])).toBe(false);
    expect(inboundIpAllowed('::ffff:127.0.0.1', ['127.0.0.0/8'])).toBe(true);
    expect(inboundIpAllowed('127.0.0.1', ['127.0.0.0/33'])).toBe(false);
    expect(inboundIpAllowed('127.0.0.1', ['not-an-address'])).toBe(false);
  });
});
