import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { SupplierIncomingModule } from '../supplier-incoming/supplier-incoming.module.js';
import { SupplierConcessionController } from './supplier-concession.controller.js';
import { SupplierConcessionService } from './supplier-concession.service.js';

@Module({ imports: [AdminMutationModule, AuditLogModule, SupplierIncomingModule], controllers: [SupplierConcessionController], providers: [SupplierConcessionService] })
export class SupplierConcessionModule {}
