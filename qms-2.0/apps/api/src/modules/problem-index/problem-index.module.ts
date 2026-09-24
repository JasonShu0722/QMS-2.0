import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { TaskNotificationModule } from '../task-notification/task-notification.module.js';
import { NumberingService } from './numbering.service.js';
import { ProblemIndexController } from './problem-index.controller.js';
import { ProblemIndexService } from './problem-index.service.js';
import { ProblemReadModule } from './problem-read.module.js';
import { DomainSourceIssueService } from './domain-source-issue.service.js';

@Module({
  imports: [DatabaseModule, AuditLogModule, TaskNotificationModule, ProblemReadModule],
  controllers: [ProblemIndexController],
  providers: [NumberingService, ProblemIndexService, DomainSourceIssueService],
  exports: [NumberingService, ProblemIndexService, DomainSourceIssueService],
})
export class ProblemIndexModule {}
