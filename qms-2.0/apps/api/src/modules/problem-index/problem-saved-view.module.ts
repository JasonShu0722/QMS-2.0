import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { ProblemSavedViewController } from './problem-saved-view.controller.js';
import { ProblemSavedViewService } from './problem-saved-view.service.js';

@Module({ imports: [DatabaseModule, AuditLogModule], controllers: [ProblemSavedViewController], providers: [ProblemSavedViewService], exports: [ProblemSavedViewService] })
export class ProblemSavedViewModule {}
