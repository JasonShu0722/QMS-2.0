import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { jest } from '@jest/globals';
import request from 'supertest';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { InboundController } from '../../src/modules/api-integration/inbound.controller.js';
import { InboundGuard } from '../../src/modules/api-integration/inbound.guard.js';
import { InboundService } from '../../src/modules/api-integration/inbound.service.js';

describe('inbound success response representation', () => {
  let app: NestExpressApplication;
  const receive = jest.fn<InboundService['receive']>();
  const receipt = { receiptId: '11111111-1111-4111-8111-111111111111', messageId: '11111111-1111-4111-8111-111111111111', receivedAt: '2026-11-13T00:00:00.000Z', status: 'RECEIVED' as const };
  beforeAll(async () => {
    app = (await Test.createTestingModule({ controllers: [InboundController], providers: [{ provide: InboundService, useValue: { receive } }] })
      .overrideGuard(InboundGuard).useValue({ canActivate: () => true }).compile()).createNestApplication<NestExpressApplication>();
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => receive.mockReset());

  it.each([true, false])('keeps HTTP 200 and the configured body: returnReceipt=%s', async returnReceipt => {
    receive.mockResolvedValue({ organizationId: receipt.receiptId, endpointId: receipt.receiptId, credentialId: receipt.receiptId, statusCode: 200, receipt, traceId: receipt.receiptId, configurationVersion: 1, returnReceipt });
    const response = await request(app.getHttpServer()).post('/api/v1/integrations/inbound/test/messages').send([{}]).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    if (returnReceipt) {
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.text).toBe('true');
      expect(response.body).toBe(true);
    } else expect(response.text).toBe('');
  });

  it('preserves a controlled JSON error rather than turning failure into true', async () => {
    receive.mockRejectedValue(new HttpException({ code: 'INTEGRATION_MESSAGE_INVALID', message: 'JSON正文必须是对象数组' }, 400));
    const response = await request(app.getHttpServer()).post('/api/v1/integrations/inbound/test/messages').send({}).expect(400);
    expect(response.body).toMatchObject({ code: 'INTEGRATION_MESSAGE_INVALID' });
    expect(response.body).not.toBe(true);
  });
});
