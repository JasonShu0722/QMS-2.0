import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { FileManagementModule } from '../file-management/file-management.module.js';
import { NewProductFileResourceAdapter } from './new-product-file-resource.adapter.js';
import { NewProductQualityController } from './new-product-quality.controller.js';
import { NewProductQualityService } from './new-product-quality.service.js';
import { ProblemIndexModule } from '../problem-index/problem-index.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { NewProductQualityUpgradeAdapter } from './new-product-quality-upgrade.adapter.js';

@Module({
  imports: [AdminMutationModule, AuditLogModule, FileManagementModule, ProblemIndexModule, WorkflowModule],
  controllers: [NewProductQualityController],
  providers: [NewProductQualityService, NewProductFileResourceAdapter, NewProductQualityUpgradeAdapter],
  exports: [NewProductQualityService],
})
export class NewProductQualityModule {}
