import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { FileManagementModule } from '../file-management/file-management.module.js';
import { SupplierQualityModule } from '../supplier-quality/supplier-quality.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { SupplierIncomingController } from './supplier-incoming.controller.js';
import { SupplierIncomingFileResourceAdapter } from './supplier-incoming-file-resource.adapter.js';
import { SupplierIncomingService } from './supplier-incoming.service.js';

@Module({ imports: [AdminMutationModule, AuditLogModule, FileManagementModule, SupplierQualityModule, WorkflowModule], controllers: [SupplierIncomingController], providers: [SupplierIncomingService, SupplierIncomingFileResourceAdapter], exports: [SupplierIncomingService] })
export class SupplierIncomingModule {}
