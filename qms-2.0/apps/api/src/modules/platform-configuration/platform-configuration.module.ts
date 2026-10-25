import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { PlatformConfigurationController } from './platform-configuration.controller.js';
import { PlatformConfigurationService } from './platform-configuration.service.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { ComponentProjectController } from './component-project.controller.js';
import { ComponentProjectService } from './component-project.service.js';
import { ComponentProjectBulkController } from './component-project-bulk.controller.js';
import { ComponentProjectBulkService } from './component-project-bulk.service.js';

@Module({ imports: [AdminMutationModule, AuditLogModule, OrganizationModule], controllers: [PlatformConfigurationController, ComponentProjectController, ComponentProjectBulkController], providers: [PlatformConfigurationService, ComponentProjectService, ComponentProjectBulkService], exports: [ComponentProjectService] })
export class PlatformConfigurationModule {}
