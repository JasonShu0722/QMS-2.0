import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { WorkflowController } from './workflow.controller.js';
import { WorkflowDefinitionService } from './workflow-definition.service.js';
import { WorkflowValidationService } from './workflow-validation.service.js';

@Module({
  imports: [DatabaseModule, AuditLogModule],
  controllers: [WorkflowController],
  providers: [WorkflowValidationService, WorkflowDefinitionService],
  exports: [WorkflowValidationService, WorkflowDefinitionService],
})
export class WorkflowModule {}
