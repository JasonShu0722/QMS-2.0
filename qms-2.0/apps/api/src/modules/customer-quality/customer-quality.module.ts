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

@Module({ imports: [AdminMutationModule, AuditLogModule, FileManagementModule, ProblemIndexModule, WorkflowModule], controllers: [CustomerQualityController], providers: [CustomerQualityService, CustomerIssueService, CustomerComplaintProcessingService, CustomerComplaintFileResourceAdapter], exports: [CustomerQualityService, CustomerIssueService] })
export class CustomerQualityModule {}
