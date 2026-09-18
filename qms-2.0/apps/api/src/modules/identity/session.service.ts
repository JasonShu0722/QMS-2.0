import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions } from 'express';
import { PrismaService } from '../../database/prisma.service.js';

export const SESSION_COOKIE = 'qms_session';
export const CSRF_COOKIE = 'qms_csrf';

const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;

export function sessionCookieOptions(environment = process.env.NODE_ENV): CookieOptions {
  return {
    httpOnly: true,
    secure: environment === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_LIFETIME_MS,
  };
}

export function csrfCookieOptions(environment = process.env.NODE_ENV): CookieOptions {
  return {
    httpOnly: false,
    secure: environment === 'production',
    sameSite: 'lax',
    path: '/',
  };
}

export function clearSessionCookieOptions(environment = process.env.NODE_ENV): CookieOptions {
  const { maxAge: _maxAge, ...options } = sessionCookieOptions(environment);
  return options;
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  private tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async create(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: this.tokenHash(token),
        expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
      },
    });
    return token;
  }

  async resolve(token: string) {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: this.tokenHash(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;
    if (session.user.status !== 'ACTIVE') return null;
    return session;
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash: this.tokenHash(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
