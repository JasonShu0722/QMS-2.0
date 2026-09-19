import { Module } from '@nestjs/common';
import { OutboxService } from './outbox.service.js';
import { OUTBOX_HANDLER, OutboxWorkerService } from './outbox-worker.service.js';
import { TaskService } from './task.service.js';
import { NotificationService } from './notification.service.js';

@Module({
  providers: [OutboxService, OutboxWorkerService, TaskService, NotificationService, { provide: OUTBOX_HANDLER, useValue: null }],
  exports: [OutboxService, OutboxWorkerService, TaskService, NotificationService],
})
export class TaskNotificationModule {}
