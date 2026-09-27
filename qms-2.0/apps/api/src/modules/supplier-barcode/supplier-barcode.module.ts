import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { SupplierBarcodeController } from './supplier-barcode.controller.js';
import { SupplierBarcodeService } from './supplier-barcode.service.js';
@Module({ imports: [AdminMutationModule, AuditLogModule], controllers: [SupplierBarcodeController], providers: [SupplierBarcodeService] })
export class SupplierBarcodeModule {}
