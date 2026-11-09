import 'reflect-metadata';
import { Body, Controller, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { ACTIVE_PERMISSION_CODES, INTERNAL_PLATFORM_PERMISSION_CODES } from '../../src/modules/authorization/permission-catalog.js';
import { configureHttpBodyParser } from '../../src/http-body-parser.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';

@Controller('api/v1/integrations/inbound')
class RawReceiver {
  @Post(':endpointId/messages')
  receive(@Body() body: unknown) { return { raw: Buffer.isBuffer(body), bytes: Buffer.isBuffer(body) ? body.length : 0 }; }

  @Post('ordinary-json')
  ordinary(@Body() body: unknown) { return body; }
}

it('includes integration capabilities in explicit platform administrator projections', () => {
  for (const code of ['integration:read', 'integration:manage', 'integration:credentials:manage', 'integration:receipts:read', 'integration:payload:read']) {
    expect(ACTIVE_PERMISSION_CODES).toContain(code);
    expect(INTERNAL_PLATFORM_PERMISSION_CODES).toContain(code);
  }
});

it('retains bounded machine provenance and rejects invalid audit metadata', () => {
  const audit = new AuditLogService({ auditEvent: { create: async () => ({}) } });
  const endpointId = '2b15bf72-fc50-4ca2-8e42-33a07be072dc';
  expect(audit.safeMetadata({ endpointId, credentialId: endpointId, receiptId: endpointId, returnReceipt: false })).toEqual({ endpointId, credentialId: endpointId, receiptId: endpointId, returnReceipt: false });
  expect(audit.safeMetadata({ endpointId: 'malformed', returnReceipt: 'false', authorization: 'Bearer private', payload: 'private' })).toEqual({});
});

it('bounds machine raw bodies independently of ordinary JSON writes', async () => {
  const app = (await Test.createTestingModule({ controllers: [RawReceiver] }).compile()).createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureHttpBodyParser(app);
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  try {
    const payload = JSON.stringify({ value: 'x'.repeat(150000) });
    const response = await request(app.getHttpServer()).post('/api/v1/integrations/inbound/2b15bf72-fc50-4ca2-8e42-33a07be072dc/messages').set('Content-Type', 'application/json').send(payload).expect(201);
    expect(response.body).toEqual({ raw: true, bytes: Buffer.byteLength(payload) });
    const mixedCase = await request(app.getHttpServer()).post('/api/v1/Integrations/Inbound/2b15bf72-fc50-4ca2-8e42-33a07be072dc/Messages').set('Content-Type', 'application/json').send(payload).expect(201);
    expect(mixedCase.body).toEqual({ raw: true, bytes: Buffer.byteLength(payload) });
    const oversized = await request(app.getHttpServer()).post('/api/v1/integrations/inbound/2b15bf72-fc50-4ca2-8e42-33a07be072dc/messages').set('Content-Type', 'application/json').send('x'.repeat(1048577)).expect(413);
    expect(oversized.headers['x-request-id']).toBe(oversized.body.traceId);
    const compressed = await request(app.getHttpServer()).post('/api/v1/integrations/inbound/2b15bf72-fc50-4ca2-8e42-33a07be072dc/messages').set('Content-Type', 'application/octet-stream').set('Content-Encoding', 'gzip').send(Buffer.from('private compressed input')).expect(415);
    expect(compressed.headers['x-request-id']).toBe(compressed.body.traceId);
  } finally { await app.close(); }
});

it('bounds the public receiving path in both gateway configurations', () => {
  for (const name of ['nginx.conf', 'nginx.tls.conf']) {
    const config = readFileSync(resolve('../../deployment', name), 'utf8');
    expect(config).toContain('limit_req_zone $binary_remote_addr zone=qms_inbound:10m rate=10r/s;');
    const receiver = config.match(/location ~\* \^\/api\/v1\/integrations\/inbound\/ \{([^}]+)\}/)?.[1];
    expect(receiver).toContain('client_max_body_size 1m;');
    expect(receiver).toContain('client_body_timeout 10s;');
    expect(receiver).toContain('limit_req zone=qms_inbound burst=100 nodelay;');
    expect(receiver).toContain('limit_req_status 429;');
    expect(receiver).toContain('proxy_read_timeout 20s;');
    expect(receiver).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
  }
});

it('preserves raw bytes for percent-encoded endpoint UUIDs without widening ordinary JSON limits', async () => {
  const app = (await Test.createTestingModule({ controllers: [RawReceiver] }).compile()).createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureHttpBodyParser(app);
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  try {
    const endpointId = '2b15bf72-fc50-4ca2-8e42-33a07be072dc';
    const encoded = `%32${endpointId.slice(1)}`;
    for (const length of [8, 150000]) {
      const payload = JSON.stringify({ value: 'x'.repeat(length) });
      for (const path of [
        `/api/v1/integrations/inbound/${encoded}/messages`,
        `/api/v1/Integrations/Inbound/${encoded.toUpperCase()}/Messages/`,
      ]) {
        const response = await request(app.getHttpServer()).post(path).set('Content-Type', 'application/json').send(payload).expect(201);
        expect(response.body).toEqual({ raw: true, bytes: Buffer.byteLength(payload) });
      }
    }
    await request(app.getHttpServer()).post(`/api/v1/integrations/inbound/${encoded}/messages`).set('Content-Type', 'application/json').send('x'.repeat(1048577)).expect(413);
    await request(app.getHttpServer()).post('/api/v1/integrations/inbound/ordinary-json').send({ value: 'x'.repeat(150000) }).expect(413);
  } finally { await app.close(); }
});
