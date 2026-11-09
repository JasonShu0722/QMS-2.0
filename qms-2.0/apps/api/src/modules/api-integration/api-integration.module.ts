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

@Module({
  imports: [AdminMutationModule, AuditLogModule, SystemManagementModule, AdministrativeLifecycleModule],
  controllers: [IntegrationAdminController, InboundController, IntegrationReceiptController],
  providers: [IntegrationAdminService, IntegrationCredentialService, InboundGuard, InboundService, IntegrationReceiptService,
    IntegrationRetentionService, IntegrationLifecycleEffect, { provide: APP_INTERCEPTOR, useClass: IntegrationObservationInterceptor }],
  exports: [IntegrationAdminService, IntegrationCredentialService, IntegrationRetentionService],
})
export class ApiIntegrationModule {}
