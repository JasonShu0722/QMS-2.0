import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PasswordHasherService } from '../../common/security/password-hasher.service.js';
import { AuthController } from './auth.controller.js';
import { CsrfGuard } from './csrf.guard.js';
import { IdentityService } from './identity.service.js';
import { PasswordService } from './password.service.js';
import { RateLimitGuard, RateLimitService } from './rate-limit.guard.js';
import { SessionService } from './session.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { AccountController } from './account.controller.js';
import { AdminUserController } from './admin-user.controller.js';
import { AdminUserService } from './admin-user.service.js';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { AdminOrganizationController } from './admin-organization.controller.js';
import { MfaService } from './mfa.service.js';
import { MfaController } from './mfa.controller.js';
import { EmailRecoveryController } from './email-recovery.controller.js';
import { EmailRecoveryService } from './email-recovery.service.js';
import { RecoveryMailService } from './recovery-mail.service.js';
import { PasswordChangeChallengeService } from './password-change-challenge.service.js';
import { TemporaryPasswordService } from './temporary-password.service.js';
import { AdminUserBatchService } from './admin-user-batch.service.js';
import { FileManagementModule } from '../file-management/file-management.module.js';
import { AccountAvatarService } from './account-avatar.service.js';
import { AccountAvatarFileResourceAdapter } from './account-avatar-file-resource.adapter.js';
import { SupplierAccountIdentityService } from './supplier-account-identity.service.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { AdministrativeLifecycleModule } from '../../common/security/administrative-lifecycle.registry.js';
import { AdminUserLifecycleService } from './admin-user-lifecycle.service.js';
import { AdminUserLifecycleController } from './admin-user-lifecycle.controller.js';
import { ESignatureModule } from '../e-signature/e-signature.module.js';
import { AdminUserReconfigurationService } from './admin-user-reconfiguration.service.js';
import { AdminSupplierAccountsController } from './admin-supplier-accounts.controller.js';
import { AdminSupplierAccountsService } from './admin-supplier-accounts.service.js';

@Module({
  imports: [AuditLogModule, AdminMutationModule, FileManagementModule, OrganizationModule, AdministrativeLifecycleModule, ESignatureModule],
  controllers: [AuthController, AccountController, AdminUserLifecycleController, AdminSupplierAccountsController, AdminUserController, AdminOrganizationController, MfaController, EmailRecoveryController],
  providers: [
    AdminUserReconfigurationService,
    AdminSupplierAccountsService,
    PasswordHasherService,
    AccountAvatarService,
    AccountAvatarFileResourceAdapter,
    PasswordService,
    SessionService,
    IdentityService,
    PasswordChangeChallengeService,
    TemporaryPasswordService,
    MfaService,
    EmailRecoveryService,
    RecoveryMailService,
    AdminUserService,
    AdminUserLifecycleService,
    AdminUserBatchService,
    SupplierAccountIdentityService,
    PasswordResetService,
    RateLimitService,
    RateLimitGuard,
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
  exports: [IdentityService, SessionService, PasswordService, RecoveryMailService, TemporaryPasswordService, SupplierAccountIdentityService, AdminUserReconfigurationService, AdminUserLifecycleService],
})
export class IdentityModule {}
