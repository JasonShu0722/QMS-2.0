import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { WorkflowController } from './workflow.controller.js';
import { WorkflowDefinitionService } from './workflow-definition.service.js';
import { WorkflowValidationService } from './workflow-validation.service.js';
import { WorkflowRuntimeService } from './workflow-runtime.service.js';
import { ProblemIndexModule } from '../problem-index/problem-index.module.js';
import { TaskNotificationModule } from '../task-notification/task-notification.module.js';
import { WorkflowUpgradeController } from './workflow-upgrade.controller.js';
import { WorkflowUpgradeService } from './workflow-upgrade.service.js';
import { WORKFLOW_UPGRADE_ADAPTERS, WorkflowUpgradeRegistry } from './workflow-upgrade.registry.js';

@Module({
  imports: [DatabaseModule, AuditLogModule, ProblemIndexModule, TaskNotificationModule],
  controllers: [WorkflowController, WorkflowUpgradeController],
  providers: [WorkflowValidationService, WorkflowDefinitionService, WorkflowRuntimeService, WorkflowUpgradeService, WorkflowUpgradeRegistry,
    { provide: WORKFLOW_UPGRADE_ADAPTERS, useValue: [] }],
  exports: [WorkflowValidationService, WorkflowDefinitionService, WorkflowRuntimeService, WorkflowUpgradeService, WorkflowUpgradeRegistry],
})
export class WorkflowModule {}
