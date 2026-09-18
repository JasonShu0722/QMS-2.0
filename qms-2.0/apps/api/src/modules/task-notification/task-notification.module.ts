import { Module } from '@nestjs/common';
import { OutboxService } from './outbox.service.js';
import { OutboxWorkerService } from './outbox-worker.service.js';

@Module({
  providers: [OutboxService, OutboxWorkerService],
  exports: [OutboxService, OutboxWorkerService],
})
export class TaskNotificationModule {}
