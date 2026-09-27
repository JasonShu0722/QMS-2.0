import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { SupplierQualityModule } from '../supplier-quality/supplier-quality.module.js';
import { SupplierQualityTargetsController } from './supplier-quality-targets.controller.js';
import { SupplierQualityTargetsService } from './supplier-quality-targets.service.js';
@Module({ imports: [AdminMutationModule, AuditLogModule, SupplierQualityModule], controllers: [SupplierQualityTargetsController], providers: [SupplierQualityTargetsService], exports: [SupplierQualityTargetsService] })
export class SupplierQualityTargetsModule {}
