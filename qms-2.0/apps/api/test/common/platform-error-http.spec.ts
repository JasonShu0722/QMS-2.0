import 'reflect-metadata';
import { Controller, Get, HttpException, Param, Req, Res, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request, Response } from 'express';
import request from 'supertest';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PLATFORM_ERROR_CODES, PLATFORM_ERROR_MESSAGES } from '../../src/common/contracts/platform-error.js';
import { requestTraceId } from '../../src/common/contracts/request-trace.js';

@Controller('errors')
class ErrorTestController {
  @Get(':status/:code')
  fail(@Param('status') status: string, @Param('code') code: string,
    @Req() incoming: Request, @Res({ passthrough: true }) response: Response): never {
    response.setHeader('x-test-trace-id', requestTraceId(incoming));
    if (code === 'UNEXPECTED') throw new Error('SELECT password FROM C:\\private');
    throw new HttpException({ code, message: 'SELECT password FROM C:\\private',
      fields: { token: ['secret'] } }, Number(status));
  }
}

describe('platform error HTTP contract', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ErrorTestController] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => { await app.close(); });

  it.each(PLATFORM_ERROR_CODES)('returns a fixed safe message and request trace for %s', async (code) => {
    const response = await request(app.getHttpServer()).get(`/errors/409/${code}`).expect(409);
    expect(response.body).toEqual({ code, message: PLATFORM_ERROR_MESSAGES[code], fields: {},
      traceId: response.headers['x-test-trace-id'] });
    expect(response.body.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(response.body)).not.toMatch(/SELECT|password|private|token|secret/);
  });

  it.each(['PROBLEM_NOT_FOUND', 'UNKNOWN', 'UNEXPECTED'])('always returns the generic 500 message for %s', async (code) => {
    const response = await request(app.getHttpServer()).get(`/errors/500/${code}`).expect(500);
    expect(response.body).toEqual({ code: 'INTERNAL_ERROR', message: '服务暂时不可用', fields: {},
      traceId: response.headers['x-test-trace-id'] });
  });

  it('maps unknown codes to a safe HTTP error and generates distinct request traces', async () => {
    const first = await request(app.getHttpServer()).get('/errors/400/SQL_SECRET').expect(400);
    const second = await request(app.getHttpServer()).get('/errors/400/SQL_SECRET').expect(400);
    expect(first.body).toEqual({ code: 'HTTP_400', message: '请求无法处理', fields: {},
      traceId: first.headers['x-test-trace-id'] });
    expect(first.body.traceId).not.toBe(second.body.traceId);
  });
});
