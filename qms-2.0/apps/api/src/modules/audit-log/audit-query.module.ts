import { Module } from '@nestjs/common';
import { AuditLogModule } from './audit-log.module.js';
import { AuditQueryController } from './audit-query.controller.js';
import { AuditQueryService } from './audit-query.service.js';
import { AuditExportService } from './audit-export.service.js';
import { AuditExportController } from './audit-export.controller.js';

@Module({ imports: [AuditLogModule], controllers: [AuditQueryController, AuditExportController], providers: [AuditQueryService, AuditExportService], exports: [AuditQueryService, AuditExportService] })
export class AuditQueryModule {}
