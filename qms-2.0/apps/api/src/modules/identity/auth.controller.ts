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
import type { LoginDto } from './dto/login.dto.js';
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
export class AuthController {
  constructor(
    private readonly identity: IdentityService,
    private readonly sessions: SessionService,
  ) {}

  @Get('csrf')
  csrf(@Res({ passthrough: true }) response: Response) {
    const csrfToken = randomBytes(32).toString('base64url');
    response.cookie(CSRF_COOKIE, csrfToken, csrfCookieOptions());
    return { csrfToken };
  }

  @Post('login')
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
  session(@Req() request: Request) {
    return this.identity.current(parseCookie(request.headers.cookie, SESSION_COOKIE));
  }

  @Post('logout')
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
