import { SupplierQualityModule } from '../supplier-quality/supplier-quality.module.js';
import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { FileManagementModule } from '../file-management/file-management.module.js';
import { SupplierPpapController } from './supplier-ppap.controller.js';
import { SupplierPpapFileResourceAdapter } from './supplier-ppap-file-resource.adapter.js';
import { SupplierPpapService } from './supplier-ppap.service.js';

@Module({ imports: [SupplierQualityModule, AdminMutationModule, AuditLogModule, FileManagementModule], controllers: [SupplierPpapController], providers: [SupplierPpapService, SupplierPpapFileResourceAdapter] })
export class SupplierPpapModule {}
