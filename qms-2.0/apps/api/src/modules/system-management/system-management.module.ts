import { Module } from '@nestjs/common';
import { AuditQueryModule } from '../audit-log/audit-query.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { TaskNotificationModule } from '../task-notification/task-notification.module.js';
import { SystemManagementController } from './system-management.controller.js';
import { SystemManagementService } from './system-management.service.js';
import { ApiObservationCollectorService } from './api-observation-collector.service.js';
import { ApiObservationService } from './api-observation.service.js';
import { ApiObservationController } from './api-observation.controller.js';

@Module({
  imports: [IdentityModule, OrganizationModule, AuditQueryModule, TaskNotificationModule],
  controllers: [SystemManagementController, ApiObservationController],
  providers: [SystemManagementService, ApiObservationCollectorService, ApiObservationService],
  exports: [ApiObservationCollectorService],
})
export class SystemManagementModule {}
