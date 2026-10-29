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
import { OrganizationModule } from '../organization/organization.module.js';
import { WorkflowClosurePreviewController } from './workflow-closure-preview.controller.js';
import { WorkflowClosurePreviewService } from './workflow-closure-preview.service.js';
import { WorkflowClosureRoundService } from './workflow-closure-round.service.js';
import { WorkflowClosureRegistry, WORKFLOW_CLOSURE_ADAPTERS } from './workflow-closure-registry.js';
import { WorkflowClosureTemplateController } from './workflow-closure-template.controller.js';
import { WorkflowClosureTemplateService } from './workflow-closure-template.service.js';
import { WorkflowClosureRoundController } from './workflow-closure-round.controller.js';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { ClosureInboxService } from '../task-notification/closure-inbox.service.js';
import { ClosureInboxController, ClosureNotificationController } from './workflow-closure-inbox.controller.js';
import { ClosureEventHandler } from '../task-notification/closure-event.handler.js';
import { WorkflowDeadlineExtensionService } from './workflow-deadline-extension.service.js';
import { WorkflowDeadlineExtensionController } from './workflow-deadline-extension.controller.js';
import { AdministrativeLifecycleModule } from '../../common/security/administrative-lifecycle.registry.js';
import { WorkflowAdministrativeInvalidationService } from './workflow-administrative-invalidation.service.js';

@Module({
  imports: [DatabaseModule, AuditLogModule, ProblemIndexModule, TaskNotificationModule, OrganizationModule, AdminMutationModule, AdministrativeLifecycleModule],
  controllers: [WorkflowClosurePreviewController, WorkflowClosureTemplateController, WorkflowClosureRoundController, ClosureInboxController, ClosureNotificationController, WorkflowController, WorkflowUpgradeController, WorkflowDeadlineExtensionController],
  providers: [WorkflowValidationService, WorkflowDefinitionService, WorkflowRuntimeService, WorkflowUpgradeService, WorkflowUpgradeRegistry, WorkflowClosurePreviewService,
    WorkflowClosureRoundService, WorkflowClosureRegistry, WorkflowClosureTemplateService,
    ClosureInboxService, ClosureEventHandler, WorkflowDeadlineExtensionService,
    WorkflowAdministrativeInvalidationService,
    { provide: WORKFLOW_CLOSURE_ADAPTERS, useValue: [] },
    { provide: WORKFLOW_UPGRADE_ADAPTERS, useValue: [] }],
  exports: [WorkflowValidationService, WorkflowDefinitionService, WorkflowRuntimeService, WorkflowUpgradeService, WorkflowUpgradeRegistry, WorkflowClosureRoundService, WorkflowClosureRegistry, ClosureEventHandler, WorkflowDeadlineExtensionService],
})
export class WorkflowModule {}
