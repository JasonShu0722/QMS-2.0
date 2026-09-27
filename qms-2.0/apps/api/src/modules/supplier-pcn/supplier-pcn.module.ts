import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { FileManagementModule } from '../file-management/file-management.module.js';
import { ProblemIndexModule } from '../problem-index/problem-index.module.js';
import { SupplierQualityModule } from '../supplier-quality/supplier-quality.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { SupplierPcnController, SupplierPcnPortalController } from './supplier-pcn.controller.js';
import { SupplierPcnFileResourceAdapter } from './supplier-pcn-file-resource.adapter.js';
import { SupplierPcnService } from './supplier-pcn.service.js';

@Module({ imports: [AdminMutationModule, AuditLogModule, FileManagementModule, ProblemIndexModule, SupplierQualityModule, WorkflowModule],
  controllers: [SupplierPcnController, SupplierPcnPortalController], providers: [SupplierPcnService, SupplierPcnFileResourceAdapter] })
export class SupplierPcnModule {}
