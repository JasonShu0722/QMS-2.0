import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { AnnouncementController } from './announcement.controller.js';
import { AnnouncementService } from './announcement.service.js';

@Module({ imports: [AdminMutationModule, AuditLogModule], controllers: [AnnouncementController], providers: [AnnouncementService] })
export class AnnouncementModule {}
