import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { SupplierQualityModule } from '../supplier-quality/supplier-quality.module.js';
import { SupplierMeetingsController } from './supplier-meetings.controller.js';
import { SupplierMeetingsService } from './supplier-meetings.service.js';
@Module({ imports: [AdminMutationModule, AuditLogModule, SupplierQualityModule], controllers: [SupplierMeetingsController], providers: [SupplierMeetingsService], exports: [SupplierMeetingsService] })
export class SupplierMeetingsModule {}
