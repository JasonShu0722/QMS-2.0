import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { OutboxWorkerService } from './modules/task-notification/outbox-worker.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const worker = app.get(OutboxWorkerService);
  await worker.processDue(25, async () => {
    throw new Error('No outbox handlers are registered in phase 1');
  });
  await app.close();
}

void bootstrap();
