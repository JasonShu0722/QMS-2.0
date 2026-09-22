import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { AuditLogModule } from './modules/audit-log/audit-log.module.js';
import { AuditQueryModule } from './modules/audit-log/audit-query.module.js';
import { PlatformConfigurationModule } from './modules/platform-configuration/platform-configuration.module.js';
import { AuthorizationModule } from './modules/authorization/authorization.module.js';
import { FileManagementModule } from './modules/file-management/file-management.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { TaskNotificationModule } from './modules/task-notification/task-notification.module.js';
import { ReportingModule } from './modules/reporting/reporting.module.js';
import { ProblemIndexModule } from './modules/problem-index/problem-index.module.js';
import { ProblemSavedViewModule } from './modules/problem-index/problem-saved-view.module.js';
import { WorkflowModule } from './modules/workflow/workflow.module.js';

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    AuthorizationModule,
    AuditLogModule,
    AuditQueryModule,
    PlatformConfigurationModule,
    FileManagementModule,
    TaskNotificationModule,
    ReportingModule,
    ProblemIndexModule,
    ProblemSavedViewModule,
    WorkflowModule,
  ],
})
export class AppModule {}
