import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { FileManagementModule } from '../file-management/file-management.module.js';
import { ProcessDefectFileResourceAdapter } from './process-defect-file-resource.adapter.js';
import { ProcessDefectLedgerService } from './process-defect-ledger.service.js';
import { ProcessIssueService } from './process-issue.service.js';
import { ProcessProductionService } from './process-production.service.js';
import { ProcessShipmentReportService } from './process-shipment-report.service.js';
import { ProcessShipmentReportFileResourceAdapter } from './process-shipment-report-file-resource.adapter.js';
import { ProcessQualityController } from './process-quality.controller.js';
import { ProblemIndexModule } from '../problem-index/problem-index.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';

@Module({ imports: [AdminMutationModule, AuditLogModule, FileManagementModule, ProblemIndexModule, WorkflowModule], controllers: [ProcessQualityController], providers: [ProcessDefectLedgerService, ProcessIssueService, ProcessProductionService, ProcessShipmentReportService, ProcessDefectFileResourceAdapter, ProcessShipmentReportFileResourceAdapter], exports: [ProcessDefectLedgerService, ProcessIssueService, ProcessProductionService, ProcessShipmentReportService] })
export class ProcessQualityModule {}
