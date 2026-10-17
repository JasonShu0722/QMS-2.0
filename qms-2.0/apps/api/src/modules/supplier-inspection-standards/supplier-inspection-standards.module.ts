import { SupplierQualityModule } from '../supplier-quality/supplier-quality.module.js';
import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { SupplierInspectionStandardsController } from './supplier-inspection-standards.controller.js';
import { SupplierInspectionStandardsService } from './supplier-inspection-standards.service.js';
@Module({ imports: [SupplierQualityModule, AdminMutationModule, AuditLogModule], controllers: [SupplierInspectionStandardsController], providers: [SupplierInspectionStandardsService] })
export class SupplierInspectionStandardsModule {}
