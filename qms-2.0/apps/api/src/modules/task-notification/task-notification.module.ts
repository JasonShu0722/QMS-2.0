import { Module } from '@nestjs/common';
import { OutboxService } from './outbox.service.js';
import { OUTBOX_HANDLER, OutboxWorkerService } from './outbox-worker.service.js';

@Module({
  providers: [OutboxService, OutboxWorkerService, { provide: OUTBOX_HANDLER, useValue: null }],
  exports: [OutboxService, OutboxWorkerService],
})
export class TaskNotificationModule {}
