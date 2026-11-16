import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AdministrativeLifecycleModule } from '../../common/security/administrative-lifecycle.registry.js';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { IntegrationAdminController } from './integration-admin.controller.js';
import { IntegrationAdminService } from './integration-admin.service.js';
import { IntegrationCredentialService } from './integration-credential.service.js';
import { InboundController } from './inbound.controller.js';
import { InboundGuard } from './inbound.guard.js';
import { InboundService } from './inbound.service.js';
import { SystemManagementModule } from '../system-management/system-management.module.js';
import { IntegrationReceiptController } from './integration-receipt.controller.js';
import { IntegrationReceiptService } from './integration-receipt.service.js';
import { IntegrationRetentionService } from './integration-retention.service.js';
import { IntegrationObservationInterceptor } from './integration-observation.interceptor.js';
import { IntegrationLifecycleEffect } from './integration-lifecycle.effect.js';
import { MaterialMasterModule } from '../material-master/material-master.module.js';
import { SupplierQualityModule } from '../supplier-quality/supplier-quality.module.js';
import { CustomerQualityModule } from '../customer-quality/customer-quality.module.js';
import { PlatformConfigurationModule } from '../platform-configuration/platform-configuration.module.js';
import { IngestionController } from './ingestion.controller.js';
import { IngestionService } from './ingestion.service.js';
import { IngestionTargetsService } from './ingestion-targets.service.js';
import { IngestionWorkerService } from './ingestion-worker.service.js';
import { ProcessQualityModule } from '../process-quality/process-quality.module.js';
import { AiConnectionsModule } from '../ai-configuration/ai-connections.module.js';
import { AiDescriptionService } from './ai-description.service.js';
import { AiDescriptionController } from './ai-description.controller.js';

@Module({
  imports: [AdminMutationModule, AuditLogModule, SystemManagementModule, AdministrativeLifecycleModule, MaterialMasterModule, SupplierQualityModule, CustomerQualityModule, PlatformConfigurationModule, ProcessQualityModule, AiConnectionsModule],
  controllers: [IntegrationAdminController, InboundController, IntegrationReceiptController, IngestionController, AiDescriptionController],
  providers: [IntegrationAdminService, IntegrationCredentialService, InboundGuard, InboundService, IntegrationReceiptService,
    IntegrationRetentionService, IntegrationLifecycleEffect, IngestionService, IngestionTargetsService, IngestionWorkerService, AiDescriptionService, { provide: APP_INTERCEPTOR, useClass: IntegrationObservationInterceptor }],
  exports: [IntegrationAdminService, IntegrationCredentialService, IntegrationRetentionService, IngestionWorkerService, IngestionService, AiDescriptionService],
})
export class ApiIntegrationModule {}
