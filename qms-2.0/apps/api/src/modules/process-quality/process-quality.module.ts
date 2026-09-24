import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { FileManagementModule } from '../file-management/file-management.module.js';
import { ProcessDefectFileResourceAdapter } from './process-defect-file-resource.adapter.js';
import { ProcessDefectLedgerService } from './process-defect-ledger.service.js';
import { ProcessQualityController } from './process-quality.controller.js';

@Module({ imports: [AdminMutationModule, AuditLogModule, FileManagementModule], controllers: [ProcessQualityController], providers: [ProcessDefectLedgerService, ProcessDefectFileResourceAdapter], exports: [ProcessDefectLedgerService] })
export class ProcessQualityModule {}
