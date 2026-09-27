import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { CoordinateInspectionController } from './coordinate-inspection.controller.js';
import { CoordinateInspectionService } from './coordinate-inspection.service.js';

@Module({ imports: [AdminMutationModule, AuditLogModule], controllers: [CoordinateInspectionController], providers: [CoordinateInspectionService], exports: [CoordinateInspectionService] })
export class CoordinateInspectionModule {}
