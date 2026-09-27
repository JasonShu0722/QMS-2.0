import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { DatabaseModule } from '../../database/database.module.js';
import { ProblemIndexModule } from '../problem-index/problem-index.module.js';
import { QualityDataController } from './quality-data.controller.js';
import { QualityDataService } from './quality-data.service.js';

@Module({ imports: [DatabaseModule, AdminMutationModule, ProblemIndexModule], controllers: [QualityDataController], providers: [QualityDataService], exports: [QualityDataService] })
export class QualityDataModule {}
