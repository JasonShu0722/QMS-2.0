import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { ProblemIndexModule } from '../problem-index/problem-index.module.js';
import { SupplierPortalController, SupplierQualityController } from './supplier-quality.controller.js';
import { SupplierQualityService } from './supplier-quality.service.js';
import { SupplierWorkflowAccess } from './supplier-workflow-access.js';
import { SupplierWorkflowBindingService } from './supplier-workflow-binding.service.js';
import { SupplierWorkflowBindingController } from './supplier-workflow-binding.controller.js';

@Module({ imports: [AdminMutationModule, AuditLogModule, IdentityModule, OrganizationModule, ProblemIndexModule], controllers: [SupplierQualityController, SupplierPortalController, SupplierWorkflowBindingController], providers: [SupplierQualityService, SupplierWorkflowAccess, SupplierWorkflowBindingService], exports: [SupplierQualityService, SupplierWorkflowAccess, SupplierWorkflowBindingService] })
export class SupplierQualityModule {}
