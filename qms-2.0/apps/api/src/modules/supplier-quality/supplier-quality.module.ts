import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { ProblemIndexModule } from '../problem-index/problem-index.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { FileManagementModule } from '../file-management/file-management.module.js';
import { SupplierPortalController, SupplierQualityController } from './supplier-quality.controller.js';
import { SupplierQualityService } from './supplier-quality.service.js';
import { SupplierWorkflowAccess } from './supplier-workflow-access.js';
import { SupplierWorkflowBindingService } from './supplier-workflow-binding.service.js';
import { SupplierWorkflowBindingController } from './supplier-workflow-binding.controller.js';
import { SupplierQualityFileResourceAdapter } from './supplier-quality-file-resource.adapter.js';
import { SupplierQualityUpgradeAdapter } from './supplier-quality-upgrade.adapter.js';

@Module({ imports: [AdminMutationModule, AuditLogModule, FileManagementModule, IdentityModule, OrganizationModule, ProblemIndexModule, WorkflowModule], controllers: [SupplierQualityController, SupplierPortalController, SupplierWorkflowBindingController], providers: [SupplierQualityService, SupplierWorkflowAccess, SupplierWorkflowBindingService, SupplierQualityFileResourceAdapter, SupplierQualityUpgradeAdapter], exports: [SupplierQualityService, SupplierWorkflowAccess, SupplierWorkflowBindingService] })
export class SupplierQualityModule {}
