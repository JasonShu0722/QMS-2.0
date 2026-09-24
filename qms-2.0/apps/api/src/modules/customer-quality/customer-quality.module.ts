import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { CustomerQualityService } from './customer-quality.service.js';
import { CustomerQualityController } from './customer-quality.controller.js';

@Module({ imports: [AdminMutationModule, AuditLogModule], controllers: [CustomerQualityController], providers: [CustomerQualityService], exports: [CustomerQualityService] })
export class CustomerQualityModule {}
