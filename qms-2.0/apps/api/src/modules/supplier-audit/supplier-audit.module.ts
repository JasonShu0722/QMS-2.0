import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { FileManagementModule } from '../file-management/file-management.module.js';
import { SupplierQualityModule } from '../supplier-quality/supplier-quality.module.js';
import { SupplierAuditController } from './supplier-audit.controller.js';
import { SupplierAuditFileResourceAdapter } from './supplier-audit-file-resource.adapter.js';
import { SupplierAuditService } from './supplier-audit.service.js';

@Module({
  imports: [AdminMutationModule, AuditLogModule, FileManagementModule, SupplierQualityModule],
  controllers: [SupplierAuditController],
  providers: [SupplierAuditService, SupplierAuditFileResourceAdapter],
  exports: [SupplierAuditService],
})
export class SupplierAuditModule {}
