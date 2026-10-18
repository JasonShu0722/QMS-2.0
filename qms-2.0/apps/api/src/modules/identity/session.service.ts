import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions } from 'express';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { HttpException } from '@nestjs/common';
import { assertRecentAuthentication, isGovernancePermission, mfaPolicy } from '../../common/security/session-security.js';
import { rethrowSecurityRejection } from '../../common/security/security-rejection.js';
import { sessionLifetimeMs } from './session-policy.js';
import type { AccountSessionHistoryQueryDto } from './dto/account.dto.js';

export const SESSION_COOKIE = 'qms_session';
export const CSRF_COOKIE = 'qms_csrf';

type SessionTransaction = Pick<PrismaService, '$queryRaw' | 'user' | 'session' | 'auditEvent'>;

type SessionCreationTransaction = Pick<PrismaService, 'session' | 'user' | 'userRole'>;
type SessionCreationOptions = { mfaVerified?: boolean; reauthenticated?: boolean; rememberMe?: boolean; expiresAt?: Date };
export type IssuedSession = { sessionToken: string; sessionExpiresAt: Date };

export function sessionCookieOptions(environment = process.env.NODE_ENV, expiresAt?: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: environment === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: expiresAt ? Math.max(0, expiresAt.getTime() - Date.now()) : sessionLifetimeMs(false, false),
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
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  private tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async create(userId: string, transaction: SessionCreationTransaction = this.prisma, verified: SessionCreationOptions = {}): Promise<string> {
    return (await this.createWithMetadata(userId, transaction, verified)).sessionToken;
  }

  async createWithMetadata(userId: string, transaction: SessionCreationTransaction = this.prisma, verified: SessionCreationOptions = {}): Promise<IssuedSession> {
    const token = randomBytes(32).toString('base64url');
    const user = await transaction.user.findUniqueOrThrow({ where: { id: userId }, select: { securityVersion: true, mustChangePassword: true } });
    if (user.mustChangePassword) throw new HttpException({ code: 'AUTH_PASSWORD_CHANGE_REQUIRED', message: '请先修改临时密码' }, 401);
    const grants = verified.rememberMe ? await transaction.userRole.findMany({ where: { userId }, include: { role: { include: { permissions: { include: { permission: true } } } } } }) : [];
    const administrator = grants.some(({ role }) => role.permissions.some(({ permission }) => isGovernancePermission(permission.code)));
    const lifetimeType = verified.rememberMe ? administrator ? 'REMEMBERED_ADMIN' : 'REMEMBERED_USER' : 'STANDARD';
    const expiresAt = new Date(Math.min(Date.now() + sessionLifetimeMs(verified.rememberMe ?? false, administrator), verified.expiresAt?.getTime() ?? Infinity));
    await transaction.session.create({
      data: {
        userId,
        securityVersion: user.securityVersion,
        mfaVerifiedAt: verified.mfaVerified ? new Date() : null,
        reauthenticatedAt: verified.reauthenticated ? new Date() : null,
        tokenHash: this.tokenHash(token),
        lifetimeType,
        expiresAt,
      },
    });
    return { sessionToken: token, sessionExpiresAt: expiresAt };
  }

  async resolve(token: string) {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: this.tokenHash(token) },
      include: { user: { include: { organization: { select: { status: true } } } } },
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;
    if (session.user.status !== 'ACTIVE' || session.user.organization.status !== 'ACTIVE' || session.user.mustChangePassword) return null;
    if (session.securityVersion !== session.user.securityVersion) return null;
    const policy = await mfaPolicy(this.prisma, session.user.id);
    if (policy.required && !session.mfaVerifiedAt) return null;
    return session;
  }

  async revoke(token: string, traceId = requestTraceId()): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.prisma.$transaction(async (transaction) => {
          const tokenHash = this.tokenHash(token);
          const session = await transaction.session.findUnique({
            where: { tokenHash }, include: { user: true },
          });
          if (!session || session.revokedAt) return;
          await transaction.$queryRaw`SELECT id FROM users WHERE id = ${session.user.id}::uuid FOR UPDATE`;
          const changed = await transaction.session.updateMany({
            where: { tokenHash, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          if (changed.count !== 1) return;
          await this.audit.record({
            actorUserId: session.user.id, organizationId: session.user.organizationId,
            action: 'SESSION_REVOKED', resourceType: 'User', resourceId: session.user.id,
            outcome: 'SUCCESS', traceId,
          }, transaction);
        });
        return;
      } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
        const message = error instanceof Error ? error.message : String(error);
        if (attempt === 2 || (code !== 'P2034' && !/deadlock detected/i.test(message))) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  }

  async listForUser(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, expiresAt: true, revokedAt: true },
    });
    return sessions.map((session) => ({
      ...session,
      isCurrent: session.id === currentSessionId,
    }));
  }

  async historyForUser(userId: string, currentSessionId: string, { page, pageSize }: AccountSessionHistoryQueryDto) {
    return this.prisma.$transaction(async (transaction) => {
      const now = Date.now();
      const where = { userId };
      const total = await transaction.session.count({ where });
      const sessions = await transaction.session.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, createdAt: true, expiresAt: true, revokedAt: true, lifetimeType: true },
      });
      return {
        items: sessions.map((session) => ({
          ...session,
          isCurrent: session.id === currentSessionId,
          status: session.revokedAt ? 'REVOKED' : session.expiresAt.getTime() <= now ? 'EXPIRED' : 'ACTIVE',
        })),
        total, page, pageSize,
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async revokeOtherSessions(
    userId: string,
    currentSessionId: string,
    traceId = requestTraceId(),
    transaction: SessionTransaction = this.prisma,
  ): Promise<void> {
    const changed = await transaction.session.updateMany({
      where: { userId, id: { not: currentSessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (changed.count > 0) {
      const user = await transaction.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
      await this.audit.record({
        actorUserId: userId,
        organizationId: user?.organizationId,
        action: 'SESSION_REVOKED',
        resourceType: 'Session',
        resourceId: userId,
        outcome: 'SUCCESS',
        traceId,
      }, transaction);
    }
  }

  async revokeSession(
    userId: string,
    sessionId: string,
    currentSessionId: string,
    traceId = requestTraceId(),
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (transaction) => {
        const { user } = await assertRecentAuthentication(transaction, { id: userId, sessionId: currentSessionId });
        if (sessionId === currentSessionId) {
          throw new HttpException({ code: 'AUTH_CURRENT_SESSION_REVOKE_FORBIDDEN', message: '当前会话请使用退出登录' }, 409);
        }
        const changed = await transaction.session.updateMany({
          where: { id: sessionId, userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        if (changed.count !== 1) {
          throw new HttpException({ code: 'AUTH_SESSION_NOT_FOUND', message: '会话不存在或已撤销' }, 404);
        }
        await this.audit.record({
          actorUserId: userId, organizationId: user.organizationId,
          action: 'SESSION_REVOKED', resourceType: 'Session', resourceId: sessionId,
          outcome: 'SUCCESS', traceId,
        }, transaction);
      });
    } catch (error) {
      return rethrowSecurityRejection(this.prisma, this.audit, error, { userId, resourceType: 'Session', resourceId: sessionId, traceId });
    }
  }
}
