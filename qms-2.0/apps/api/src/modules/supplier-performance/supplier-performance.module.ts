import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { SupplierIncomingModule } from '../supplier-incoming/supplier-incoming.module.js';
import { SupplierQualityModule } from '../supplier-quality/supplier-quality.module.js';
import { SupplierPerformanceController, SupplierPerformanceAppealController, SupplierPerformancePortalCardController, SupplierPerformancePortalAppealController } from './supplier-performance.controller.js';
import { SupplierPerformanceService } from './supplier-performance.service.js';

@Module({ imports: [AdminMutationModule, AuditLogModule, SupplierIncomingModule, SupplierQualityModule], controllers: [SupplierPerformanceController, SupplierPerformanceAppealController, SupplierPerformancePortalCardController, SupplierPerformancePortalAppealController], providers: [SupplierPerformanceService] })
export class SupplierPerformanceModule {}
