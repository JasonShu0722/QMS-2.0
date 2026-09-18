import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import { parseCookie, SESSION_COOKIE } from './session.service.js';

const RATE_LIMIT_SECRET_ENV = 'QMS_RATE_LIMIT_SECRET';
const DEVELOPMENT_RATE_LIMIT_SECRET =
  'qms-development-rate-limit-secret-not-for-production';

interface RateEntry {
  failures: number;
  blockedUntil: number;
  windowStartedAt: number;
  requests: number;
}

@Injectable()
export class RateLimitService {
  private readonly entries = new Map<string, RateEntry>();
  private readonly secret: string;

  constructor() {
    const configuredSecret = process.env[RATE_LIMIT_SECRET_ENV]?.trim();
    if (configuredSecret) {
      this.secret = configuredSecret;
      return;
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`${RATE_LIMIT_SECRET_ENV} must be configured in production`);
    }
    this.secret = DEVELOPMENT_RATE_LIMIT_SECRET;
  }

  key(accountIdentifier: string, ip: string): string {
    const normalizedIdentifier = accountIdentifier.trim().toLowerCase();
    const normalizedIp = ip.trim().toLowerCase();
    return createHmac('sha256', this.secret)
      .update(`${normalizedIdentifier}\0${normalizedIp}`)
      .digest('hex');
  }

  assertAllowed(key: string, now = Date.now()): void {
    let entry = this.entries.get(key);
    if (!entry || now - entry.windowStartedAt >= 60_000) {
      entry = { failures: 0, blockedUntil: 0, windowStartedAt: now, requests: 0 };
      this.entries.set(key, entry);
    }
    entry.requests += 1;
    if (entry.blockedUntil > now || entry.requests > 30) {
      throw new HttpException(
        { code: 'AUTH_RATE_LIMITED', message: '请求过于频繁，请稍后再试' },
        429,
      );
    }
  }

  recordFailure(key: string, now = Date.now()): void {
    const entry = this.entries.get(key) ?? {
      failures: 0,
      blockedUntil: 0,
      windowStartedAt: now,
      requests: 0,
    };
    entry.failures += 1;
    if (entry.failures >= 5) {
      entry.blockedUntil = now + Math.min(30_000, 1_000 * 2 ** (entry.failures - 5));
    }
    this.entries.set(key, entry);
  }

  recordSuccess(key: string): void {
    this.entries.delete(key);
  }
}

export const RATE_LIMIT_KEY = Symbol('RATE_LIMIT_KEY');

type RateLimitedRequest = Request & { [RATE_LIMIT_KEY]?: string };

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly limits: RateLimitService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RateLimitedRequest>();
    const body = request.body as { identifier?: unknown } | undefined;
    const identifier =
      typeof body?.identifier === 'string'
        ? body.identifier
        : (parseCookie(request.headers.cookie, SESSION_COOKIE) ?? 'anonymous');
    const key = this.limits.key(identifier, request.ip ?? request.socket.remoteAddress ?? 'unknown');
    this.limits.assertAllowed(key);
    request[RATE_LIMIT_KEY] = key;
    return true;
  }
}
