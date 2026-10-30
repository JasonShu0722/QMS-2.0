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
import { SupplierPortalNotificationController } from './supplier-portal-notification.controller.js';
import { SupplierPortalNotificationService } from './supplier-portal-notification.service.js';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { TaskTransferService } from './task-transfer.service.js';

@Module({
  imports: [AuditLogModule, AdminMutationModule],
  controllers: [OutboxAdministrationController, TaskInboxController, NotificationInboxController, SupplierPortalNotificationController],
  providers: [OutboxService, OutboxWorkerService, TaskService, TaskTransferService, NotificationService, SupplierPortalNotificationService, WorkflowEventHandler, OutboxAdministrationService, { provide: OUTBOX_HANDLER, useExisting: WorkflowEventHandler }],
  exports: [OutboxService, OutboxWorkerService, TaskService, NotificationService, SupplierPortalNotificationService, WorkflowEventHandler, OutboxAdministrationService],
})
export class TaskNotificationModule {}
