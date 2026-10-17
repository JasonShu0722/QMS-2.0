import { SupplierQualityModule } from '../supplier-quality/supplier-quality.module.js';
import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { FileManagementModule } from '../file-management/file-management.module.js';
import { SupplierAdmissionController, SupplierAdmissionPortalController } from './supplier-admission.controller.js';
import { SupplierAdmissionFileResourceAdapter } from './supplier-admission-file-resource.adapter.js';
import { SupplierAdmissionService } from './supplier-admission.service.js';

@Module({
  imports: [SupplierQualityModule, AdminMutationModule, AuditLogModule, FileManagementModule],
  controllers: [SupplierAdmissionController, SupplierAdmissionPortalController],
  providers: [SupplierAdmissionService, SupplierAdmissionFileResourceAdapter],
})
export class SupplierAdmissionModule {}
