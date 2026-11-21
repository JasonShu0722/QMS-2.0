import { Module } from '@nestjs/common';
import { WorkbenchGraphController } from './workbench-graph.controller.js';

@Module({ controllers: [WorkbenchGraphController] })
export class WorkbenchGraphModule {}
