import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { FileManagementModule } from '../file-management/file-management.module.js';
import { SupplierAsnController } from './supplier-asn.controller.js';
import { SupplierAsnFileResourceAdapter } from './supplier-asn-file-resource.adapter.js';
import { SupplierAsnService } from './supplier-asn.service.js';
@Module({ imports: [AdminMutationModule, AuditLogModule, FileManagementModule], controllers: [SupplierAsnController], providers: [SupplierAsnService, SupplierAsnFileResourceAdapter] })
export class SupplierAsnModule {}
