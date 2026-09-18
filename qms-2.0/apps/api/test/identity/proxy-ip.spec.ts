import 'reflect-metadata';
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { configureHttpProxy } from '../../src/http-proxy.js';
import { RATE_LIMIT_KEY, RateLimitGuard, RateLimitService } from '../../src/modules/identity/rate-limit.guard.js';

@Controller('probe')
@UseGuards(RateLimitGuard)
class ProxyProbeController {
  @Get()
  read(@Req() incoming: Request & { [RATE_LIMIT_KEY]: string }) {
    return { ip: incoming.ip, key: incoming[RATE_LIMIT_KEY] };
  }
}

describe('trusted proxy client IP', () => {
  let app: NestExpressApplication;
  const originalTrust = process.env.QMS_TRUST_PROXY_HOPS;
  const originalSecret = process.env.QMS_RATE_LIMIT_SECRET;

  async function createApp(trust?: string): Promise<void> {
    if (trust === undefined) delete process.env.QMS_TRUST_PROXY_HOPS;
    else process.env.QMS_TRUST_PROXY_HOPS = trust;
    process.env.QMS_RATE_LIMIT_SECRET = 'proxy-test-rate-limit-secret';
    const moduleRef = await Test.createTestingModule({
      controllers: [ProxyProbeController],
      providers: [RateLimitGuard, RateLimitService],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureHttpProxy(app);
    await app.init();
  }

  afterEach(async () => {
    await app?.close();
    if (originalTrust === undefined) delete process.env.QMS_TRUST_PROXY_HOPS;
    else process.env.QMS_TRUST_PROXY_HOPS = originalTrust;
    if (originalSecret === undefined) delete process.env.QMS_RATE_LIMIT_SECRET;
    else process.env.QMS_RATE_LIMIT_SECRET = originalSecret;
  });

  it('ignores forged forwarding headers by default on a direct API connection', async () => {
    await createApp();
    const direct = await request(app.getHttpServer()).get('/probe').expect(200);
    const forged = await request(app.getHttpServer()).get('/probe')
      .set('X-Forwarded-For', '198.51.100.10').expect(200);
    expect(forged.body).toEqual(direct.body);
    expect(forged.body.ip).not.toBe('198.51.100.10');
  });

  it('uses the explicitly trusted single hop to separate two client rate limit keys', async () => {
    await createApp('1');
    const first = await request(app.getHttpServer()).get('/probe')
      .set('X-Forwarded-For', '198.51.100.10').expect(200);
    const second = await request(app.getHttpServer()).get('/probe')
      .set('X-Forwarded-For', '198.51.100.11').expect(200);
    expect(first.body.ip).toBe('198.51.100.10');
    expect(second.body.ip).toBe('198.51.100.11');
    expect(first.body.key).not.toBe(second.body.key);
  });

  it('does not let additional untrusted leftmost addresses change the rate limit key', async () => {
    await createApp('1');
    const genuine = await request(app.getHttpServer()).get('/probe')
      .set('X-Forwarded-For', '198.51.100.10').expect(200);
    const forged = await request(app.getHttpServer()).get('/probe')
      .set('X-Forwarded-For', '203.0.113.99, 198.51.100.10').expect(200);
    expect(genuine.body.ip).toBe('198.51.100.10');
    expect(forged.body).toEqual(genuine.body);
  });

  it('does not interpret true as unlimited proxy trust', async () => {
    await createApp('true');
    const direct = await request(app.getHttpServer()).get('/probe').expect(200);
    const forged = await request(app.getHttpServer()).get('/probe')
      .set('X-Forwarded-For', '198.51.100.10').expect(200);
    expect(forged.body).toEqual(direct.body);
  });

  it('blocks an exhausted client without blocking another client or accepting a forged prefix', async () => {
    await createApp('1');
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await request(app.getHttpServer()).get('/probe')
        .set('X-Forwarded-For', '198.51.100.10').expect(200);
    }
    await request(app.getHttpServer()).get('/probe')
      .set('X-Forwarded-For', '198.51.100.10').expect(429);
    await request(app.getHttpServer()).get('/probe')
      .set('X-Forwarded-For', '203.0.113.99, 198.51.100.10').expect(429);
    await request(app.getHttpServer()).get('/probe')
      .set('X-Forwarded-For', '198.51.100.11').expect(200);
  });
});
