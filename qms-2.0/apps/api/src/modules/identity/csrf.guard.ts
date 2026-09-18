import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { CSRF_COOKIE, parseCookie } from './session.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

    const cookieToken = parseCookie(request.headers.cookie, CSRF_COOKIE);
    const submitted = request.headers['x-csrf-token'];
    const headerToken = Array.isArray(submitted) ? submitted[0] : submitted;
    if (!cookieToken || !headerToken || !this.matches(cookieToken, headerToken)) {
      throw new HttpException(
        { code: 'CSRF_INVALID', message: 'CSRF 校验失败' },
        403,
      );
    }
    return true;
  }

  private matches(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
