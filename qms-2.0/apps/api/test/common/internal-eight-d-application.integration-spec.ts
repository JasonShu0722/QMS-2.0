import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { CustomerEightDService } from '../../src/modules/customer-quality/customer-eight-d.service.js';
import { NewProductEightDService } from '../../src/modules/new-product-quality/new-product-eight-d.service.js';
import { CUSTOMER_EIGHT_D_RUNTIME, NEW_PRODUCT_EIGHT_D_RUNTIME, type InternalEightDRuntime } from '../../src/common/eight-d/internal-eight-d-runtime.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { APPLICATION_OUTBOX_HANDLER, type AtomicOutboxHandler } from '../../src/modules/task-notification/outbox-worker.service.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Internal domain application validation requires disposable loopback PostgreSQL.');
}

it('boots both real domain runtimes and protects their public read, report and task routes', async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = module.createNestApplication();
  try {
    await app.init();
    expect(app.get(CustomerEightDService).core.domain.domainCode).toBe('customer-quality');
    expect(app.get(NewProductEightDService).core.domain.domainCode).toBe('new-product-quality');
    const handler = app.get<AtomicOutboxHandler>(APPLICATION_OUTBOX_HANDLER);
    expect(handler.eventTypes).toEqual(expect.arrayContaining(['CUSTOMER_EIGHT_D_REMINDER_DUE', 'NEW_PRODUCT_EIGHT_D_REMINDER_DUE']));
    for (const [domain, token] of [['customer-quality', CUSTOMER_EIGHT_D_RUNTIME], ['new-product-quality', NEW_PRODUCT_EIGHT_D_RUNTIME]] as const) {
      const runtime = app.get<InternalEightDRuntime>(token);
      expect(runtime.core.domain.domainCode).toBe(domain);
      for (const suffix of ['binding', 'tasks', 'notifications', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000/report']) {
        await request(app.getHttpServer()).get(`/api/v1/${domain}/eight-d/${suffix}`).expect(401);
      }
    }
  } finally { await app.close(); }
});
