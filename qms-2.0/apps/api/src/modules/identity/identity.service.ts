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

type RateLimitedRequest = Request & { [RATE_LIMIT_KEY]?: string };

@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly limits: RateLimitService,
    private readonly audit: AuditLogService,
  ) {}

  async login(
    dto: LoginDto,
    request: RateLimitedRequest,
  ): Promise<{ response: LoginResponseDto; sessionToken: string }> {
    const identifier = typeof dto.identifier === 'string' ? dto.identifier.trim() : '';
    const password = typeof dto.password === 'string' ? dto.password : '';
    const rateKey = request[RATE_LIMIT_KEY] ?? this.limits.key(identifier, request.ip ?? 'unknown');
    const user = identifier
      ? await this.prisma.user.findFirst({
          where: {
            OR: [
              { username: { equals: identifier, mode: 'insensitive' } },
              { email: { equals: identifier, mode: 'insensitive' } },
            ],
          },
        })
      : null;

    if (!user) {
      await this.passwords.verifyUnknown(password);
      return this.rejectLogin(rateKey, request);
    }

    const passwordMatches = await this.passwords.verify(user.passwordHash, password);
    if (!passwordMatches || user.status !== 'ACTIVE') return this.rejectLogin(rateKey, request, user);

    this.limits.recordSuccess(rateKey);
    const sessionToken = await this.sessions.create(user.id);
    const response: LoginResponseDto =
      user.accountType === 'SUPPLIER'
        ? { accountType: 'SUPPLIER', landingPath: '/supplier/inbox' }
        : { accountType: 'INTERNAL', landingPath: '/app/workbench' };
    return { response, sessionToken };
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

  async profile(userId: string): Promise<AccountProfileDto> {
    const user = await this.prisma.user.findUnique({
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

  async updateProfile(userId: string, dto: UpdateAccountProfileDto, traceId: string): Promise<AccountProfileDto> {
    await this.prisma.user.update({ where: { id: userId }, data: { email: dto.email ?? null } });
    await this.audit.record({
      actorUserId: userId, action: 'PROFILE_UPDATED', resourceType: 'User', resourceId: userId,
      outcome: 'SUCCESS', traceId,
    });
    return this.profile(userId);
  }

  async changePassword(input: {
    userId: string;
    currentSessionId: string;
    currentPassword: string;
    newPassword: string;
    traceId: string;
  }): Promise<void> {
    if (input.newPassword === input.currentPassword || input.newPassword.length < 12) {
      throw new HttpException({ code: 'AUTH_PASSWORD_POLICY_INVALID', message: '新密码不符合安全策略' }, 400);
    }
    const user = await this.prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, organizationId: true, passwordHash: true } });
    if (!user || !(await this.passwords.verify(user.passwordHash, input.currentPassword))) {
      throw new HttpException({ code: 'AUTH_CURRENT_PASSWORD_INVALID', message: '当前密码错误' }, 401);
    }
    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({ where: { id: input.userId }, data: { passwordHash } });
      await this.sessions.revokeOtherSessions(input.userId, input.currentSessionId, input.traceId, transaction);
      await this.audit.record({
        actorUserId: input.userId, organizationId: user.organizationId, action: 'PASSWORD_CHANGED',
        resourceType: 'User', resourceId: input.userId, outcome: 'SUCCESS', traceId: input.traceId,
      }, transaction);
    });
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
