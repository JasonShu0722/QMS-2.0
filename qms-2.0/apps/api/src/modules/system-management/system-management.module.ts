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
import { FileManagementModule } from '../file-management/file-management.module.js';
import { ServiceOperationsService } from './service-operations.service.js';
import { ServiceOperationsController } from './service-operations.controller.js';

@Module({
  imports: [IdentityModule, OrganizationModule, AuditQueryModule, TaskNotificationModule, FileManagementModule],
  controllers: [SystemManagementController, ApiObservationController, DataExchangeObservationController, ServiceOperationsController],
  providers: [SystemManagementService, ApiObservationCollectorService, ApiObservationService, DataExchangeRegistryService, DataExchangeObservationService, ServiceOperationsService],
  exports: [ApiObservationCollectorService, DataExchangeRegistryService, DataExchangeObservationService],
})
export class SystemManagementModule {}
