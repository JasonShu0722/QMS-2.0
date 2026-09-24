import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { AuditManagementService } from './audit-management.service.js';
import { AuditManagementController } from './audit-management.controller.js';
import { ProblemIndexModule } from '../problem-index/problem-index.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';

@Module({
  imports: [AdminMutationModule, AuditLogModule, ProblemIndexModule, WorkflowModule],
  controllers: [AuditManagementController],
  providers: [AuditManagementService],
  exports: [AuditManagementService],
})
export class AuditManagementModule {}
