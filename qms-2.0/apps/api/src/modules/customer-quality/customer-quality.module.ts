import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { CustomerQualityService } from './customer-quality.service.js';
import { CustomerQualityController } from './customer-quality.controller.js';
import { CustomerIssueService } from './customer-issue.service.js';
import { ProblemIndexModule } from '../problem-index/problem-index.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';

@Module({ imports: [AdminMutationModule, AuditLogModule, ProblemIndexModule, WorkflowModule], controllers: [CustomerQualityController], providers: [CustomerQualityService, CustomerIssueService], exports: [CustomerQualityService, CustomerIssueService] })
export class CustomerQualityModule {}
