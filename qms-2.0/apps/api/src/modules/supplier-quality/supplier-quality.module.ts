import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { ProblemIndexModule } from '../problem-index/problem-index.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { FileManagementModule } from '../file-management/file-management.module.js';
import { SupplierPortalController, SupplierQualityController } from './supplier-quality.controller.js';
import { SupplierQualityService } from './supplier-quality.service.js';
import { SupplierWorkflowAccess } from './supplier-workflow-access.js';
import { SupplierWorkflowBindingService } from './supplier-workflow-binding.service.js';
import { SupplierWorkflowBindingController } from './supplier-workflow-binding.controller.js';
import { SupplierQualityFileResourceAdapter } from './supplier-quality-file-resource.adapter.js';
import { SupplierQualityUpgradeAdapter } from './supplier-quality-upgrade.adapter.js';
import { SupplierMasterController } from './supplier-master.controller.js';
import { SupplierAccountService } from './supplier-account.service.js';
import { SupplierProfileImportService } from './supplier-profile-import.service.js';
import { TaskNotificationModule } from '../task-notification/task-notification.module.js';
import { SupplierEightDService } from './supplier-eight-d.service.js';
import { SupplierEightDController, SupplierPortalEightDController } from './supplier-eight-d.controller.js';
import { SupplierEightDClosureAdapter } from './supplier-eight-d-closure.adapter.js';
import { SupplierEightDSupplementFileAdapter } from './supplier-eight-d-supplement-file.adapter.js';
import { SupplierEightDDisclosureService } from './supplier-eight-d-disclosure.service.js';
import { SupplierEightDDisclosureController } from './supplier-eight-d-disclosure.controller.js';
import { SupplierEightDDisclosureFileAdapter } from './supplier-eight-d-disclosure-file.adapter.js';
import { SupplierEightDDeadlineService } from './supplier-eight-d-deadline.service.js';
import { SupplierEightDDeadlineController, SupplierPortalEightDDeadlineController } from './supplier-eight-d-deadline.controller.js';
import { SupplierEightDReportService } from './supplier-eight-d-report.service.js';
import { SupplierEightDReportController, SupplierPortalEightDReportController } from './supplier-eight-d-report.controller.js';
import { SupplierEightDReminderService } from './supplier-eight-d-reminder.service.js';
import { SupplierEightDTaskService } from './supplier-eight-d-task.service.js';
import { SupplierEightDTaskController, SupplierPortalEightDTaskController } from './supplier-eight-d-task.controller.js';
import { SupplierEightDAssignmentController } from './supplier-eight-d-assignment.controller.js';
import { SupplierEightDAssignmentService } from './supplier-eight-d-assignment.service.js';
import { SupplierEightDRevisionService } from './supplier-eight-d-revision.service.js';
import { SupplierEightDRevisionController, SupplierPortalEightDRevisionController } from './supplier-eight-d-revision.controller.js';
import { ProblemReadModule } from '../problem-index/problem-read.module.js';
import { SupplierEightDReadAdapter } from './supplier-eight-d-read.adapter.js';

@Module({
  imports: [AdminMutationModule, AuditLogModule, FileManagementModule, IdentityModule, OrganizationModule, ProblemIndexModule, ProblemReadModule, WorkflowModule, TaskNotificationModule],
  controllers: [SupplierQualityController, SupplierPortalController, SupplierWorkflowBindingController, SupplierMasterController, SupplierEightDAssignmentController, SupplierEightDTaskController, SupplierPortalEightDTaskController, SupplierEightDController, SupplierPortalEightDController, SupplierEightDDisclosureController,
    SupplierEightDDeadlineController, SupplierPortalEightDDeadlineController, SupplierEightDReportController, SupplierPortalEightDReportController,
    SupplierEightDRevisionController, SupplierPortalEightDRevisionController],
  providers: [SupplierQualityService, SupplierWorkflowAccess, SupplierWorkflowBindingService, SupplierQualityFileResourceAdapter, SupplierQualityUpgradeAdapter, SupplierAccountService, SupplierProfileImportService,
    SupplierEightDService, SupplierEightDClosureAdapter, SupplierEightDSupplementFileAdapter, SupplierEightDDisclosureService, SupplierEightDDisclosureFileAdapter,
    SupplierEightDDeadlineService, SupplierEightDReportService, SupplierEightDTaskService, SupplierEightDReminderService, SupplierEightDAssignmentService, SupplierEightDRevisionService, SupplierEightDReadAdapter],
  exports: [SupplierQualityService, SupplierWorkflowAccess, SupplierWorkflowBindingService, SupplierEightDService, SupplierEightDReminderService],
})
export class SupplierQualityModule {}
