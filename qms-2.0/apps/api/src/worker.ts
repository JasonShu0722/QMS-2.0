import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { OUTBOX_HANDLER, OutboxWorkerService, runConfiguredWorker, type OutboxHandler } from './modules/task-notification/outbox-worker.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    await runConfiguredWorker(app.get(OutboxWorkerService), app.get<OutboxHandler | null>(OUTBOX_HANDLER));
  } finally {
    await app.close();
  }
}

void bootstrap();
