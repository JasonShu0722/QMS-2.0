import { Module } from '@nestjs/common';
import { ReportingController } from './reporting.controller.js';
import { ReportingService } from './reporting.service.js';
import { DatabaseModule } from '../../database/database.module.js';
import { ProblemReadModule } from '../problem-index/problem-read.module.js';
import { ProblemAuditQueryService } from '../audit-log/problem-audit-query.service.js';
@Module({ imports: [DatabaseModule, ProblemReadModule], controllers: [ReportingController], providers: [ReportingService, ProblemAuditQueryService], exports: [ReportingService, ProblemAuditQueryService] })
export class ReportingModule {}
