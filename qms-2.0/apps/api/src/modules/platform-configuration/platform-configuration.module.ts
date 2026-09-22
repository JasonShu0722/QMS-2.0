import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { PlatformConfigurationController } from './platform-configuration.controller.js';
import { PlatformConfigurationService } from './platform-configuration.service.js';

@Module({ imports: [AdminMutationModule, AuditLogModule], controllers: [PlatformConfigurationController], providers: [PlatformConfigurationService] })
export class PlatformConfigurationModule {}
