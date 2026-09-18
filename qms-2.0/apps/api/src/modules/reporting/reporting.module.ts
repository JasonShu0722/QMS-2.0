import { Module } from '@nestjs/common'; import { ReportingController } from './reporting.controller.js'; import { ReportingService } from './reporting.service.js'; import { DatabaseModule } from '../../database/database.module.js';
@Module({ imports: [DatabaseModule], controllers: [ReportingController], providers: [ReportingService], exports: [ReportingService] }) export class ReportingModule {}
