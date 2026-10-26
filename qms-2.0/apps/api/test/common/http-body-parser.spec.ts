import 'reflect-metadata';
import { Body, Controller, Module, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { configureHttpBodyParser } from '../../src/http-body-parser.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';

@Controller('api/v1/customer-quality/complaints')
class BodyLimitController {
  @Post('import')
  receive(@Body() body: { rows: string[] }) { return { rows: body.rows.length }; }

  @Post('other')
  other(@Body() body: { rows: string[] }) { return { rows: body.rows.length }; }
}

@Controller('api/v1/admin/configuration/component-project-mappings')
class ComponentImportBodyController {
  @Post('import')
  receive(@Body() body: { rows: unknown[] }) { return { rows: body.rows.length }; }

  @Post('other')
  other(@Body() body: { rows: unknown[] }) { return { rows: body.rows.length }; }
}

@Controller('api/v1/customer-quality/ledger')
class CustomerLedgerBodyController {
  @Post('import/preview')
  preview(@Body() body: { rows: unknown[] }) { return { rows: body.rows.length }; }
  @Post('import/commit')
  commit(@Body() body: { rows: unknown[] }) { return { rows: body.rows.length }; }
  @Post('other')
  other(@Body() body: { rows: unknown[] }) { return { rows: body.rows.length }; }
}

@Module({ controllers: [BodyLimitController, ComponentImportBodyController, CustomerLedgerBodyController] })
class BodyLimitModule {}

it('accepts a legal complaint import JSON batch while bounding oversized bodies', async () => {
  const module = await Test.createTestingModule({ imports: [BodyLimitModule] }).compile();
  const app = module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureHttpBodyParser(app);
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  try {
    const description = '质量'.repeat(10000);
    await request(app.getHttpServer()).post('/api/v1/customer-quality/complaints/import').send({ rows: Array(100).fill(description) }).expect(201);
    const oversized = await request(app.getHttpServer()).post('/api/v1/customer-quality/complaints/import').send({ rows: ['a'.repeat(7 * 1024 * 1024)] }).expect(413);
    expect(oversized.body.code).toBe('HTTP_413');
    await request(app.getHttpServer()).post('/api/v1/customer-quality/complaints/other').send({ rows: Array(10).fill(description) }).expect(413);
  } finally {
    await app.close();
  }
});

it('accepts the Unicode component batch boundary only on the bounded import route', async () => {
  const app = (await Test.createTestingModule({ imports: [BodyLimitModule] }).compile())
    .createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureHttpBodyParser(app);
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  try {
    const rows = Array.from({ length: 100 }, (_, index) => ({ rowNumber: index + 1,
      componentCode: '\u{20000}'.repeat(97) + String(index).padStart(3, '0'), componentName: '\u{20000}'.repeat(200) }));
    const path = '/api/v1/admin/configuration/component-project-mappings';
    await request(app.getHttpServer()).post(`${path}/import`).send({ rows }).expect(201);
    const escaped = JSON.stringify({ rows }).replace(/[^\x00-\x7f]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
    await request(app.getHttpServer()).post(`${path}/import`).set('content-type', 'application/json').send(escaped).expect(201);
    await request(app.getHttpServer()).post(`${path}/other`).send({ rows }).expect(413);
    await request(app.getHttpServer()).post(`${path}/import`).send({ rows: ['x'.repeat(513 * 1024)] }).expect(413);
  } finally { await app.close(); }
});

it.each(['preview', 'commit'])('accepts the full bounded customer ledger %s envelope without widening ordinary writes', async action => {
  const app = (await Test.createTestingModule({ imports: [BodyLimitModule] }).compile())
    .createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureHttpBodyParser(app);
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  try {
    const rows = Array.from({ length: 100 }, (_, index) => ({ rowNumber: index + 1, action: 'ADD', fields: {
      defectDescription: '质'.repeat(10000), investigation: '量'.repeat(10000), customerName: 'A'.repeat(200),
      serviceMode: '待补'.repeat(500),
    } }));
    expect(Buffer.byteLength(JSON.stringify(rows[0]!.fields))).toBeLessThanOrEqual(64000);
    expect(Buffer.byteLength(JSON.stringify({ mode: 'CONTINUE', rows }))).toBeGreaterThan(6 * 1024 * 1024);
    const path = `/api/v1/customer-quality/ledger/import/${action}`;
    await request(app.getHttpServer()).post(path).send({ mode: 'CONTINUE', rows }).expect(201);
    await request(app.getHttpServer()).post('/api/v1/customer-quality/ledger/other').send({ rows }).expect(413);
    await request(app.getHttpServer()).post(path).send({ rows: ['x'.repeat(7 * 1024 * 1024)] }).expect(413);
  } finally { await app.close(); }
});

it('keeps the matching gateway allowances restricted to the two exact ledger import endpoints', () => {
  const config = readFileSync(resolve('../../deployment/nginx.conf'), 'utf8');
  for (const action of ['preview', 'commit']) {
    expect(config).toMatch(new RegExp(`location = /api/v1/customer-quality/ledger/import/${action} \\{\\s+client_max_body_size 7m;\\s+proxy_pass http://api:3000;`));
  }
  expect(config.slice(0, config.indexOf('location'))).not.toContain('client_max_body_size');
  expect(config.match(/location \/api\/ \{([^}]+)\}/)?.[1]).not.toContain('client_max_body_size');
});
