import { Body, Controller, Get, Header, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { LoginResponseDto } from './dto/login.dto.js';
import { MfaCodeDto, MfaEnrollmentCompleteDto, MfaEnrollmentDto, ReauthenticateDto, ReauthenticationResponseDto, RecoveryCodesDto, SecurityStatusDto } from './dto/mfa.dto.js';
import { MFA_CHALLENGE_COOKIE, MfaService } from './mfa.service.js';
import { clearSessionCookieOptions, parseCookie, SESSION_COOKIE, sessionCookieOptions } from './session.service.js';

@Controller('api/v1')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse, description: 'Controlled API error' })
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  @Get('me/security')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: SecurityStatusDto })
  status(@Req() request: Request) {
    return this.mfa.status(this.authentication(request));
  }

  @Post('me/mfa/enrollment')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: MfaEnrollmentDto })
  enrollment(@Req() request: Request) {
    return this.mfa.beginEnrollment(this.authentication(request), requestTraceId(request));
  }

  @Post('me/mfa/enrollment/confirm')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: MfaEnrollmentCompleteDto })
  async confirm(@Body() dto: MfaCodeDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const { sessionToken, ...result } = await this.mfa.confirmEnrollment(this.authentication(request), dto.code, requestTraceId(request));
    response.cookie(SESSION_COOKIE, sessionToken, sessionCookieOptions());
    response.clearCookie(MFA_CHALLENGE_COOKIE, clearSessionCookieOptions());
    return result;
  }

  @Post('auth/mfa/verify')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: LoginResponseDto })
  async verify(@Body() dto: MfaCodeDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const { sessionToken, ...result } = await this.mfa.verifyChallenge(this.authentication(request).challengeToken, dto.code, requestTraceId(request));
    response.cookie(SESSION_COOKIE, sessionToken, sessionCookieOptions());
    response.clearCookie(MFA_CHALLENGE_COOKIE, clearSessionCookieOptions());
    return result;
  }

  @Post('me/reauthenticate')
  @HttpCode(200)
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: ReauthenticationResponseDto })
  reauthenticate(@Body() dto: ReauthenticateDto, @Req() request: Request) {
    return this.mfa.reauthenticate(this.authentication(request), dto.password, dto.code, requestTraceId(request));
  }

  @Post('me/mfa/recovery-codes')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: RecoveryCodesDto })
  recoveryCodes(@Req() request: Request) {
    return this.mfa.regenerateCodes(this.authentication(request), requestTraceId(request));
  }

  @Post('me/mfa/disable')
  @HttpCode(204)
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiNoContentResponse()
  async disable(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.mfa.disable(this.authentication(request), requestTraceId(request));
    response.clearCookie(SESSION_COOKIE, clearSessionCookieOptions());
  }

  private authentication(request: Request) {
    return { sessionToken: parseCookie(request.headers.cookie, SESSION_COOKIE), challengeToken: parseCookie(request.headers.cookie, MFA_CHALLENGE_COOKIE) };
  }
}
