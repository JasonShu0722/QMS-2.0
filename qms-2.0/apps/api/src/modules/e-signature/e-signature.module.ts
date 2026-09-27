import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { ESignatureController } from './e-signature.controller.js';
import { ESignatureService } from './e-signature.service.js';
@Module({ imports: [AdminMutationModule, AuditLogModule], controllers: [ESignatureController], providers: [ESignatureService] })
export class ESignatureModule {}
