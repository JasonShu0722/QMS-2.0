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
import { DataExchangeRegistryService } from './data-exchange-registry.service.js';
import { DataExchangeObservationService } from './data-exchange-observation.service.js';
import { DataExchangeObservationController } from './data-exchange-observation.controller.js';

@Module({
  imports: [IdentityModule, OrganizationModule, AuditQueryModule, TaskNotificationModule],
  controllers: [SystemManagementController, ApiObservationController, DataExchangeObservationController],
  providers: [SystemManagementService, ApiObservationCollectorService, ApiObservationService, DataExchangeRegistryService, DataExchangeObservationService],
  exports: [ApiObservationCollectorService, DataExchangeRegistryService, DataExchangeObservationService],
})
export class SystemManagementModule {}
