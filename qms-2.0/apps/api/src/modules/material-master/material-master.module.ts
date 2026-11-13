import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { MaterialMasterController } from './material-master.controller.js';
import { MaterialMasterService } from './material-master.service.js';
import { MaterialMasterIngestionAdapter } from './material-master-ingestion.adapter.js';

@Module({ imports: [AdminMutationModule, AuditLogModule], controllers: [MaterialMasterController], providers: [MaterialMasterService, MaterialMasterIngestionAdapter], exports: [MaterialMasterService, MaterialMasterIngestionAdapter] })
export class MaterialMasterModule {}
