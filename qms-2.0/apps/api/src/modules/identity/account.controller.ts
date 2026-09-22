import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAuthenticated } from '../authorization/access.decorator.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { AccountProfileDto, AccountSessionDto, ChangePasswordDto, UpdateAccountProfileDto } from './dto/account.dto.js';
import { IdentityService } from './identity.service.js';
import { SessionService } from './session.service.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';

@Controller('api/v1/me')
@RequireAuthenticated()
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse, description: 'Controlled API error' })
export class AccountController {
  constructor(private readonly identity: IdentityService, private readonly sessionService: SessionService) {}

  @Get()
  @ApiOkResponse({ type: AccountProfileDto })
  profile(@Req() request: Request) {
    return this.identity.profile(this.session(request).user.id);
  }

  @Patch()
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: AccountProfileDto })
  update(@Body() dto: UpdateAccountProfileDto, @Req() request: Request) {
    return this.identity.updateProfile(this.session(request).user.id, dto, requestTraceId(request), this.session(request).id);
  }

  @Post('password')
  @UseGuards(RateLimitGuard)
  @ApiHeader({ name: 'x-csrf-token', required: true })
  async changePassword(@Body() dto: ChangePasswordDto, @Req() request: Request): Promise<void> {
    const session = this.session(request);
    await this.identity.changePassword({
      userId: session.user.id,
      currentSessionId: session.id,
      currentPassword: dto.currentPassword,
      newPassword: dto.newPassword,
      traceId: requestTraceId(request),
    });
  }

  @Get('sessions')
  @ApiOkResponse({ type: AccountSessionDto, isArray: true })
  sessions(@Req() request: Request) {
    const session = this.session(request);
    return this.sessionService.listForUser(session.user.id, session.id);
  }

  @Post('sessions/:sessionId/revoke')
  @ApiHeader({ name: 'x-csrf-token', required: true })
  async revoke(@Param('sessionId') sessionId: string, @Req() request: Request): Promise<void> {
    const session = this.session(request);
    await this.sessionService.revokeSession(session.user.id, sessionId, session.id, requestTraceId(request));
  }

  private session(request: Request) {
    const session = (request as AuthorizedRequest)[AUTHENTICATED_SESSION];
    if (!session) throw new Error('Authenticated session guard did not attach a session');
    return session;
  }
}
