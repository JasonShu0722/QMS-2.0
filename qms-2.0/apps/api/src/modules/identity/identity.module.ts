import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PasswordHasherService } from '../../common/security/password-hasher.service.js';
import { AuthController } from './auth.controller.js';
import { CsrfGuard } from './csrf.guard.js';
import { IdentityService } from './identity.service.js';
import { PasswordService } from './password.service.js';
import { RateLimitGuard, RateLimitService } from './rate-limit.guard.js';
import { SessionService } from './session.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    PasswordHasherService,
    PasswordService,
    SessionService,
    IdentityService,
    RateLimitService,
    RateLimitGuard,
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
  exports: [IdentityService, SessionService, PasswordService],
})
export class IdentityModule {}
