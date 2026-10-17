import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { ApiCookieAuth, ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { CsrfResponseDto, LoginDto, LoginResponseDto, SessionResponseDto } from './dto/login.dto.js';
import { IdentityService } from './identity.service.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { PasswordResetService } from './password-reset.service.js';
import { CompletePasswordResetDto } from './dto/admin-user.dto.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { MFA_CHALLENGE_COOKIE, MfaService } from './mfa.service.js';
import { PASSWORD_CHANGE_COOKIE, PasswordChangeChallengeService } from './password-change-challenge.service.js';
import { CompletePasswordChangeDto } from './dto/password-change-challenge.dto.js';
import {
  clearSessionCookieOptions,
  csrfCookieOptions,
  CSRF_COOKIE,
  parseCookie,
  SESSION_COOKIE,
  sessionCookieOptions,
  SessionService,
} from './session.service.js';

@Controller('api/v1/auth')
@ApiResponse({ status: 'default', type: ErrorResponse, description: 'Controlled API error' })
export class AuthController {
  constructor(
    private readonly identity: IdentityService,
    private readonly sessions: SessionService,
    private readonly resets: PasswordResetService,
    private readonly mfa: MfaService,
    private readonly passwordChanges: PasswordChangeChallengeService,
  ) {}

  @Get('csrf')
  @ApiOkResponse({ type: CsrfResponseDto })
  csrf(@Res({ passthrough: true }) response: Response) {
    const csrfToken = randomBytes(32).toString('base64url');
    response.cookie(CSRF_COOKIE, csrfToken, csrfCookieOptions());
    return { csrfToken };
  }

  @Post('login')
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.identity.login(dto, request);
    if (result.sessionToken) response.cookie(SESSION_COOKIE, result.sessionToken, sessionCookieOptions(undefined, result.sessionExpiresAt));
    else response.clearCookie(SESSION_COOKIE, clearSessionCookieOptions());
    if (result.challengeToken) response.cookie(MFA_CHALLENGE_COOKIE, result.challengeToken, { ...sessionCookieOptions(), maxAge: 300_000 });
    else response.clearCookie(MFA_CHALLENGE_COOKIE, clearSessionCookieOptions());
    if (result.passwordChangeToken) response.cookie(PASSWORD_CHANGE_COOKIE, result.passwordChangeToken, { ...sessionCookieOptions(), maxAge: 300_000 });
    else response.clearCookie(PASSWORD_CHANGE_COOKIE, clearSessionCookieOptions());
    return result.response;
  }

  @Get('password-change')
  @ApiOkResponse({ type: LoginResponseDto })
  passwordChangeStatus(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.set('Cache-Control', 'no-store');
    return this.passwordChanges.status(parseCookie(request.headers.cookie, PASSWORD_CHANGE_COOKIE));
  }

  @Post('password-change/complete')
  @HttpCode(200)
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: LoginResponseDto })
  @UseGuards(RateLimitGuard)
  async completePasswordChange(@Body() dto: CompletePasswordChangeDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.passwordChanges.complete(parseCookie(request.headers.cookie, PASSWORD_CHANGE_COOKIE), dto.newPassword, requestTraceId(request));
    response.set('Cache-Control', 'no-store');
    response.clearCookie(PASSWORD_CHANGE_COOKIE, clearSessionCookieOptions());
    response.clearCookie(SESSION_COOKIE, clearSessionCookieOptions());
    response.clearCookie(MFA_CHALLENGE_COOKIE, clearSessionCookieOptions());
    if (result.sessionToken) response.cookie(SESSION_COOKIE, result.sessionToken, sessionCookieOptions(undefined, result.sessionExpiresAt));
    if (result.challengeToken) response.cookie(MFA_CHALLENGE_COOKIE, result.challengeToken, { ...sessionCookieOptions(), maxAge: 300_000 });
    return result.response;
  }

  @Get('session')
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiCookieAuth('qms_session')
  session(@Req() request: Request) {
    return this.identity.current(parseCookie(request.headers.cookie, SESSION_COOKIE));
  }

  @Post('password-reset/complete')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @UseGuards(RateLimitGuard)
  completePasswordReset(@Body() dto: CompletePasswordResetDto, @Req() request: Request) {
    return this.resets.complete(dto, requestTraceId(request));
  }

  @Post('logout')
  @ApiNoContentResponse()
  @ApiCookieAuth('qms_session')
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @HttpCode(204)
  @UseGuards(RateLimitGuard)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = parseCookie(request.headers.cookie, SESSION_COOKIE);
    if (token) await this.sessions.revoke(token, requestTraceId(request));
    await this.mfa.cancelChallenge(parseCookie(request.headers.cookie, MFA_CHALLENGE_COOKIE));
    await this.passwordChanges.cancel(parseCookie(request.headers.cookie, PASSWORD_CHANGE_COOKIE));
    response.clearCookie(SESSION_COOKIE, clearSessionCookieOptions());
    response.clearCookie(MFA_CHALLENGE_COOKIE, clearSessionCookieOptions());
    response.clearCookie(PASSWORD_CHANGE_COOKIE, clearSessionCookieOptions());
  }
}
