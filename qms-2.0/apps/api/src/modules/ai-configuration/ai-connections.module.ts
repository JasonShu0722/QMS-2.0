import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { AiConnectionController } from './ai-connection.controller.js';
import { AiConnectionService } from './ai-connection.service.js';
import { AiApplicationService } from './ai-application.service.js';
import { AiApplicationController } from './ai-application.controller.js';

@Module({ imports: [AdminMutationModule, AuditLogModule], controllers: [AiConnectionController, AiApplicationController], providers: [AiConnectionService, AiApplicationService], exports: [AiConnectionService, AiApplicationService] })
export class AiConnectionsModule {}
