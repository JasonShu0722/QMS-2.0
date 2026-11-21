import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { WorkbenchGraphController } from './workbench-graph.controller.js';
import { WorkbenchGraphService } from './workbench-graph.service.js';

@Module({ imports: [AuditLogModule], controllers: [WorkbenchGraphController], providers: [WorkbenchGraphService] })
export class WorkbenchGraphModule {}
