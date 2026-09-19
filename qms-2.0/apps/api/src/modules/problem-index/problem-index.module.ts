import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { TaskNotificationModule } from '../task-notification/task-notification.module.js';
import { NumberingService } from './numbering.service.js';
import { ProblemIndexController } from './problem-index.controller.js';
import { ProblemIndexService } from './problem-index.service.js';

@Module({
  imports: [DatabaseModule, AuditLogModule, TaskNotificationModule],
  controllers: [ProblemIndexController],
  providers: [NumberingService, ProblemIndexService],
  exports: [NumberingService, ProblemIndexService],
})
export class ProblemIndexModule {}
