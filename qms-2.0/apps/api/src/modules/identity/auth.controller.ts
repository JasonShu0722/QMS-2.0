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
    response.cookie(SESSION_COOKIE, result.sessionToken, sessionCookieOptions());
    return result.response;
  }

  @Get('session')
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiCookieAuth('qms_session')
  session(@Req() request: Request) {
    return this.identity.current(parseCookie(request.headers.cookie, SESSION_COOKIE));
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
    if (token) await this.sessions.revoke(token);
    response.clearCookie(SESSION_COOKIE, clearSessionCookieOptions());
  }
}
