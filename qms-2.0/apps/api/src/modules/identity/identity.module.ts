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

@Module({
  imports: [AuditLogModule],
  controllers: [AuthController, AccountController, AdminUserController],
  providers: [
    PasswordHasherService,
    PasswordService,
    SessionService,
    IdentityService,
    AdminUserService,
    RateLimitService,
    RateLimitGuard,
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
  exports: [IdentityService, SessionService, PasswordService],
})
export class IdentityModule {}
