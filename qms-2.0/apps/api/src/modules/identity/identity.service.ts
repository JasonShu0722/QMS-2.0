import { HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../database/prisma.service.js';
import type { LoginDto, LoginResponseDto, SessionResponseDto } from './dto/login.dto.js';
import { PasswordService } from './password.service.js';
import { RATE_LIMIT_KEY, RateLimitService } from './rate-limit.guard.js';
import { SessionService } from './session.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import type { AccountProfileDto, UpdateAccountProfileDto } from './dto/account.dto.js';
import { adminError, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { MfaService } from './mfa.service.js';
import { assertRecentAuthentication } from '../../common/security/session-security.js';
import { rethrowSecurityRejection } from '../../common/security/security-rejection.js';

type RateLimitedRequest = Request & { [RATE_LIMIT_KEY]?: string };

@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly limits: RateLimitService,
    private readonly audit: AuditLogService,
    private readonly mfa: MfaService,
  ) {}

  async login(
    dto: LoginDto,
    request: RateLimitedRequest,
  ): Promise<{ response: LoginResponseDto; sessionToken?: string; challengeToken?: string }> {
    const identifier = typeof dto.identifier === 'string' ? dto.identifier.trim() : '';
    const password = typeof dto.password === 'string' ? dto.password : '';
    const rateKey = request[RATE_LIMIT_KEY] ?? this.limits.key(identifier, request.ip ?? 'unknown');
    const user = identifier
      ? await this.prisma.user.findFirst({
          where: {
            ...(identifier.includes('@') ? { email: { equals: identifier, mode: 'insensitive' } } : { username: { equals: identifier, mode: 'insensitive' } }),
          },
          include: { organization: { select: { status: true } } },
        })
      : null;

    if (!user) {
      await this.passwords.verifyUnknown(password);
      return this.rejectLogin(rateKey, request);
    }

    const passwordMatches = await this.passwords.verify(user.passwordHash, password);
    if (!passwordMatches || user.status !== 'ACTIVE' || user.organization.status !== 'ACTIVE') return this.rejectLogin(rateKey, request, user);

    const authentication = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
      await transaction.$queryRaw`SELECT id FROM organizations WHERE id = ${user.organizationId}::uuid FOR SHARE`;
      const current = await transaction.user.findUnique({ where: { id: user.id }, include: { organization: { select: { status: true } } } });
      if (!current || current.status !== 'ACTIVE' || current.organization.status !== 'ACTIVE' || current.passwordHash !== user.passwordHash || current.organizationId !== user.organizationId || current.accountType !== user.accountType) return null;
      const challenge = await this.mfa.createChallenge(current, transaction);
      if (challenge) return { challenge };
      return { sessionToken: await this.sessions.create(current.id, transaction, { reauthenticated: true }) };
    }).catch((error: unknown) => rethrowSecurityRejection(this.prisma, this.audit, error, { userId: user.id, resourceType: 'User', resourceId: user.id, traceId: requestTraceId(request), action: 'LOGIN_FAILED', outcome: 'FAILURE' }));
    if (!authentication) return this.rejectLogin(rateKey, request, user);
    this.limits.recordSuccess(rateKey);
    if (authentication.challenge) return { challengeToken: authentication.challenge.token, response: { accountType: user.accountType, landingPath: '/mfa', securityState: authentication.challenge.enrollment ? 'MFA_ENROLLMENT_REQUIRED' : 'MFA_REQUIRED' } };
    const response: LoginResponseDto =
      user.accountType === 'SUPPLIER'
        ? { accountType: 'SUPPLIER', landingPath: '/supplier/inbox', securityState: 'AUTHENTICATED' }
        : { accountType: 'INTERNAL', landingPath: '/app/workbench', securityState: 'AUTHENTICATED' };
    return { response, sessionToken: authentication.sessionToken };
  }

  async current(sessionToken: string | undefined): Promise<SessionResponseDto> {
    if (!sessionToken) this.sessionRequired();
    const session = await this.sessions.resolve(sessionToken);
    if (!session) this.sessionRequired();
    return {
      user: {
        id: session.user.id,
        organizationId: session.user.organizationId,
        accountType: session.user.accountType,
      },
    };
  }

  async profile(userId: string, transaction: Pick<AdminTransaction, 'user'> = this.prisma): Promise<AccountProfileDto> {
    const user = await transaction.user.findUnique({
      where: { id: userId },
      include: { organization: { select: { id: true, code: true, name: true } } },
    });
    if (!user) throw new HttpException({ code: 'AUTH_SESSION_REQUIRED', message: '请先登录' }, 401);
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      accountType: user.accountType,
      status: user.status,
      mfaEnabled: user.mfaEnabled,
      organization: {
        id: user.organization.id ?? user.organizationId,
        code: user.organization.code,
        name: user.organization.name,
      },
    };
  }

  async updateProfile(userId: string, dto: UpdateAccountProfileDto, traceId: string, sessionId: string): Promise<AccountProfileDto> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await assertRecentAuthentication(transaction, { id: userId, sessionId });
        await transaction.user.update({ where: { id: userId }, data: dto.email === undefined ? {} : { email: dto.email?.trim().toLowerCase() ?? null } });
        const profile = await this.profile(userId, transaction);
        await this.audit.record({ actorUserId: userId, organizationId: profile.organization.id, action: 'PROFILE_UPDATED', resourceType: 'User', resourceId: userId, outcome: 'SUCCESS', traceId }, transaction);
        return profile;
      });
    } catch (error) {
      return rethrowSecurityRejection(this.prisma, this.audit, error, { userId, resourceType: 'User', resourceId: userId, traceId, duplicateCode: 'ADMIN_USER_DUPLICATE' });
    }
  }

  async changePassword(input: {
    userId: string;
    currentSessionId: string;
    currentPassword: string;
    newPassword: string;
    traceId: string;
  }): Promise<void> {
    try {
      if (input.newPassword === input.currentPassword || input.newPassword.length < 12) {
        throw new HttpException({ code: 'AUTH_PASSWORD_POLICY_INVALID', message: '新密码不符合安全策略' }, 400);
      }
      const user = await this.prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, organizationId: true, passwordHash: true } });
      if (!user || !(await this.passwords.verify(user.passwordHash, input.currentPassword))) {
        throw new HttpException({ code: 'AUTH_CURRENT_PASSWORD_INVALID', message: '当前密码错误' }, 401);
      }
      const passwordHash = await this.passwords.hash(input.newPassword);
      await this.prisma.$transaction(async (transaction) => {
        await assertRecentAuthentication(transaction, { id: input.userId, sessionId: input.currentSessionId });
        const changed = await transaction.user.updateMany({ where: { id: input.userId, passwordHash: user.passwordHash, status: 'ACTIVE' }, data: { passwordHash, securityVersion: { increment: 1 } } });
        if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
        const current = await transaction.user.findUniqueOrThrow({ where: { id: input.userId }, select: { securityVersion: true } });
        await transaction.session.update({ where: { id: input.currentSessionId }, data: { securityVersion: current.securityVersion } });
        await transaction.passwordReset.updateMany({ where: { userId: input.userId, consumedAt: null }, data: { consumedAt: new Date() } });
        await this.sessions.revokeOtherSessions(input.userId, input.currentSessionId, input.traceId, transaction);
        await this.audit.record({
          actorUserId: input.userId, organizationId: user.organizationId, action: 'PASSWORD_CHANGED',
          resourceType: 'User', resourceId: input.userId, outcome: 'SUCCESS', traceId: input.traceId,
        }, transaction);
      });
    } catch (error) {
      return rethrowSecurityRejection(this.prisma, this.audit, error, { userId: input.userId, resourceType: 'User', resourceId: input.userId, traceId: input.traceId });
    }
  }

  private async rejectLogin(
    rateKey: string,
    request: Request,
    user?: { id: string; organizationId: string },
  ): Promise<never> {
    this.limits.recordFailure(rateKey);
    await this.audit.record({
      actorUserId: user?.id, organizationId: user?.organizationId,
      action: 'LOGIN_FAILED', resourceType: 'User', resourceId: user?.id,
      outcome: 'FAILURE', traceId: requestTraceId(request),
      metadata: { reasonCode: 'AUTH_INVALID_CREDENTIALS' },
    });
    throw new HttpException(
      { code: 'AUTH_INVALID_CREDENTIALS', message: '账号或密码错误' },
      401,
    );
  }

  private sessionRequired(): never {
    throw new HttpException(
      { code: 'AUTH_SESSION_REQUIRED', message: '请先登录' },
      401,
    );
  }
}
