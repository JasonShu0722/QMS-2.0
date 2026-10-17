import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { MaterialMasterController } from './material-master.controller.js';
import { MaterialMasterService } from './material-master.service.js';

@Module({ imports: [AdminMutationModule, AuditLogModule], controllers: [MaterialMasterController], providers: [MaterialMasterService], exports: [MaterialMasterService] })
export class MaterialMasterModule {}
