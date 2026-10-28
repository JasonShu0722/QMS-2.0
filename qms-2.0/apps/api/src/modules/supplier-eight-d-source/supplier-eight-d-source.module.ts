import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { ProcessQualityModule } from '../process-quality/process-quality.module.js';
import { CustomerQualityModule } from '../customer-quality/customer-quality.module.js';
import { NewProductQualityModule } from '../new-product-quality/new-product-quality.module.js';
import { SupplierQualityModule } from '../supplier-quality/supplier-quality.module.js';
import { SupplierEightDSourceService } from './supplier-eight-d-source.service.js';
import { SupplierEightDSourceController } from './supplier-eight-d-source.controller.js';
import { SupplierSourceCollaborationReadModel } from '../problem-index/supplier-source-collaboration.read-model.js';
import { SupplierSourceCollaborationService } from './supplier-source-collaboration.service.js';
import { SupplierSourceCollaborationController } from './supplier-source-collaboration.controller.js';

@Module({ imports: [AdminMutationModule, AuditLogModule, ProcessQualityModule, CustomerQualityModule, NewProductQualityModule, SupplierQualityModule],
  providers: [SupplierEightDSourceService, SupplierSourceCollaborationReadModel, SupplierSourceCollaborationService],
  controllers: [SupplierEightDSourceController, SupplierSourceCollaborationController], exports: [SupplierEightDSourceService] })
export class SupplierEightDSourceModule {}
