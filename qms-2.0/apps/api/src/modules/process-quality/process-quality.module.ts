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
import { PlatformConfigurationModule } from '../platform-configuration/platform-configuration.module.js';
import { SupplierQualityModule } from '../supplier-quality/supplier-quality.module.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { ProblemReadModule } from '../problem-index/problem-read.module.js';
import { TaskNotificationModule } from '../task-notification/task-notification.module.js';
import { ProcessEightDService } from './process-eight-d.service.js';
import { ProcessEightDController } from './process-eight-d.controller.js';
import { ProcessEightDClosureAdapter } from './process-eight-d-closure.adapter.js';
import { ProcessEightDReadAdapter } from './process-eight-d-read.adapter.js';
import { ProcessEightDFileAdapter } from './process-eight-d-file.adapter.js';
import { ProcessEightDTaskService } from './process-eight-d-task.service.js';
import { ProcessEightDTaskController } from './process-eight-d-task.controller.js';
import { ProcessEightDReminderService } from './process-eight-d-reminder.service.js';
import { ProcessEightDReportService } from './process-eight-d-report.service.js';
import { ProcessEightDReportController } from './process-eight-d-report.controller.js';

@Module({
  imports: [AdminMutationModule, AuditLogModule, FileManagementModule, ProblemIndexModule, WorkflowModule,
    PlatformConfigurationModule, SupplierQualityModule, OrganizationModule, ProblemReadModule, TaskNotificationModule],
  controllers: [ProcessQualityController, ProcessEightDTaskController, ProcessEightDReportController, ProcessEightDController],
  providers: [ProcessDefectLedgerService, ProcessIssueService, ProcessProductionService, ProcessShipmentReportService,
    ProcessDefectFileResourceAdapter, ProcessShipmentReportFileResourceAdapter, ProcessEightDService, ProcessEightDClosureAdapter,
    ProcessEightDReadAdapter, ProcessEightDFileAdapter, ProcessEightDTaskService, ProcessEightDReminderService, ProcessEightDReportService],
  exports: [ProcessDefectLedgerService, ProcessIssueService, ProcessProductionService, ProcessShipmentReportService,
    ProcessEightDService, ProcessEightDReminderService],
})
export class ProcessQualityModule {}
