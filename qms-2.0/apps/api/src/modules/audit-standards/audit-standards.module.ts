import { Module } from '@nestjs/common';
import { AuditManagementModule } from '../audit-management/audit-management.module.js';
import { AuditStandardsController } from './audit-standards.controller.js';

@Module({ imports: [AuditManagementModule], controllers: [AuditStandardsController] })
export class AuditStandardsModule {}
