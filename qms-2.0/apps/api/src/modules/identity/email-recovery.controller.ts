import { Body, Controller, Header, HttpCode, Post, Req } from '@nestjs/common';
import { ApiAcceptedResponse, ApiHeader, ApiNoContentResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { EmailRecoveryService } from './email-recovery.service.js';
import { CompleteEmailVerificationDto, CompletePasswordRecoveryDto, PasswordRecoveryDto } from './dto/email-recovery.dto.js';
import { parseCookie, SESSION_COOKIE } from './session.service.js';
import { RateLimitService } from './rate-limit.guard.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';

@Controller('api/v1')
@ApiHeader({ name: 'x-csrf-token', required: true })
@ApiResponse({ status: 'default', type: ErrorResponse, description: 'Controlled API error' })
export class EmailRecoveryController {
  constructor(private readonly recovery: EmailRecoveryService, private readonly limits: RateLimitService, private readonly audit: AuditLogService) {}

  @Post('me/email-verification')
  @HttpCode(202) @Header('Cache-Control', 'no-store') @ApiAcceptedResponse()
  async requestVerification(@Req() request: Request) {
    await this.limit(request);
    await this.recovery.requestVerification(parseCookie(request.headers.cookie, SESSION_COOKIE), requestTraceId(request));
  }

  @Post('auth/email-verification/complete')
  @HttpCode(204) @Header('Cache-Control', 'no-store') @ApiNoContentResponse()
  async verify(@Body() dto: CompleteEmailVerificationDto, @Req() request: Request) {
    await this.limit(request);
    await this.recovery.complete(dto.token, 'VERIFY_EMAIL', requestTraceId(request));
  }

  @Post('auth/password-recovery')
  @HttpCode(202) @Header('Cache-Control', 'no-store') @ApiAcceptedResponse()
  async requestRecovery(@Body() dto: PasswordRecoveryDto, @Req() request: Request) {
    await this.limit(request, dto.identifier);
    await this.recovery.requestRecovery(dto, requestTraceId(request));
  }

  @Post('auth/password-recovery/complete')
  @HttpCode(204) @Header('Cache-Control', 'no-store') @ApiNoContentResponse()
  async complete(@Body() dto: CompletePasswordRecoveryDto, @Req() request: Request) {
    await this.limit(request);
    await this.recovery.complete(dto.token, 'PASSWORD_RECOVERY', requestTraceId(request), dto.newPassword);
  }

  private async limit(request: Request, identifier?: string) {
    try {
      this.limits.assertAllowed(this.limits.key('email-recovery:ip', request.ip ?? request.socket.remoteAddress ?? 'unknown'));
      if (identifier) this.limits.assertAllowed(this.limits.key(`email-recovery:identifier:${identifier}`, 'all-addresses'));
    } catch (error) {
      await this.audit.record({ action: 'EMAIL_RECOVERY_RATE_LIMITED', resourceType: 'Authentication', outcome: 'DENIED', traceId: requestTraceId(request), metadata: { reasonCode: 'AUTH_RATE_LIMITED' } });
      throw error;
    }
  }
}
