import { Module } from '@nestjs/common';
import { OutboxService } from './outbox.service.js';
import { OUTBOX_HANDLER, OutboxWorkerService } from './outbox-worker.service.js';
import { TaskService } from './task.service.js';
import { NotificationService } from './notification.service.js';
import { WorkflowEventHandler } from './workflow-event.handler.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { OutboxAdministrationService } from './outbox-administration.service.js';
import { OutboxAdministrationController } from './outbox-administration.controller.js';
import { TaskInboxController, NotificationInboxController } from './task-inbox.controller.js';

@Module({
  imports: [AuditLogModule],
  controllers: [OutboxAdministrationController, TaskInboxController, NotificationInboxController],
  providers: [OutboxService, OutboxWorkerService, TaskService, NotificationService, WorkflowEventHandler, OutboxAdministrationService, { provide: OUTBOX_HANDLER, useExisting: WorkflowEventHandler }],
  exports: [OutboxService, OutboxWorkerService, TaskService, NotificationService],
})
export class TaskNotificationModule {}
