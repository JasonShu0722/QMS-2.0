import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { AuditLogModule } from './modules/audit-log/audit-log.module.js';
import { AuthorizationModule } from './modules/authorization/authorization.module.js';
import { FileManagementModule } from './modules/file-management/file-management.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { TaskNotificationModule } from './modules/task-notification/task-notification.module.js';
import { ProblemIndexModule } from './modules/problem-index/problem-index.module.js';

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    AuthorizationModule,
    AuditLogModule,
    FileManagementModule,
    TaskNotificationModule,
    ProblemIndexModule,
  ],
})
export class AppModule {}
