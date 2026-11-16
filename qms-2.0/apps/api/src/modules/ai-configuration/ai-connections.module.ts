import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { AiConnectionController } from './ai-connection.controller.js';
import { AiConnectionService } from './ai-connection.service.js';

@Module({ imports: [AdminMutationModule, AuditLogModule], controllers: [AiConnectionController], providers: [AiConnectionService], exports: [AiConnectionService] })
export class AiConnectionsModule {}
