import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { CustomerQualityService } from './customer-quality.service.js';
import { CustomerQualityController } from './customer-quality.controller.js';
import { CustomerIssueService } from './customer-issue.service.js';
import { CustomerComplaintProcessingService } from './customer-complaint-processing.service.js';
import { ProblemIndexModule } from '../problem-index/problem-index.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { FileManagementModule } from '../file-management/file-management.module.js';
import { CustomerComplaintFileResourceAdapter } from './customer-complaint-file-resource.adapter.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { PlatformConfigurationModule } from '../platform-configuration/platform-configuration.module.js';
import { CustomerComplaintLedgerService } from './customer-complaint-ledger.service.js';
import { CustomerComplaintLedgerController } from './customer-complaint-ledger.controller.js';
import { CustomerComplaintAnalysisController } from './customer-complaint-analysis.controller.js';
import { CustomerComplaintAnalysisService } from './customer-complaint-analysis.service.js';
import { CustomerComplaintAnalysisFileAdapter } from './customer-complaint-analysis-file.adapter.js';

@Module({ imports: [AdminMutationModule, AuditLogModule, FileManagementModule, ProblemIndexModule, WorkflowModule, OrganizationModule, PlatformConfigurationModule],
  controllers: [CustomerQualityController, CustomerComplaintLedgerController, CustomerComplaintAnalysisController],
  providers: [CustomerQualityService, CustomerIssueService, CustomerComplaintProcessingService, CustomerComplaintFileResourceAdapter,
    CustomerComplaintLedgerService, CustomerComplaintAnalysisService, CustomerComplaintAnalysisFileAdapter],
  exports: [CustomerQualityService, CustomerIssueService, CustomerComplaintLedgerService] })
export class CustomerQualityModule {}
