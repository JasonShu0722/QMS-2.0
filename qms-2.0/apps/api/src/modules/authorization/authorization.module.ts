import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthenticatedGuard } from '../../common/guards/authenticated.guard.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { AuthorizationService } from './authorization.service.js';
import { PermissionsController } from './permissions.controller.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { AdminRoleController } from './admin-role.controller.js';
import { AdminRoleService } from './admin-role.service.js';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';

@Module({
  imports: [IdentityModule, OrganizationModule, AuditLogModule, AdminMutationModule],
  controllers: [PermissionsController, AdminRoleController],
  providers: [
    AuthorizationService,
    AdminRoleService,
    { provide: APP_GUARD, useClass: AuthenticatedGuard },
  ],
  exports: [AuthorizationService],
})
export class AuthorizationModule {}
