import { HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../database/prisma.service.js';
import type { LoginDto, LoginResponseDto, SessionResponseDto } from './dto/login.dto.js';
import { PasswordService } from './password.service.js';
import { RATE_LIMIT_KEY, RateLimitService } from './rate-limit.guard.js';
import { SessionService, type IssuedSession } from './session.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import type { AccountProfileDto, UpdateAccountProfileDto } from './dto/account.dto.js';
import { adminError, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { MfaService } from './mfa.service.js';
import { assertRecentAuthentication } from '../../common/security/session-security.js';
import { rethrowSecurityRejection } from '../../common/security/security-rejection.js';
import { PasswordChangeChallengeService } from './password-change-challenge.service.js';
import { replacePassword } from './password-credentials.js';
import { adminMutationDigests } from '../../common/security/security-keyring.js';
import { profileData } from './profile-fields.js';

type RateLimitedRequest = Request & { [RATE_LIMIT_KEY]?: string };

@Injectable()
export class IdentityService {
  async internalResponders(organizationId: string, query: { search?: string; selectedId?: string; page: number; pageSize: number }, transaction: AdminTransaction = this.prisma) {
    const where = { organizationId, accountType: 'INTERNAL' as const, status: 'ACTIVE' as const, ...(query.selectedId ? { id: query.selectedId } : { username: { contains: query.search ?? '', mode: 'insensitive' as const } }) };
    const [items, total] = await Promise.all([
      transaction.user.findMany({ where, select: { id: true, username: true }, orderBy: [{ username: 'asc' }, { id: 'asc' }], skip: query.selectedId ? 0 : (query.page - 1) * query.pageSize, take: query.pageSize }),
      transaction.user.count({ where }),
    ]);
    return { items, total };
  }

  async isInternalResponder(userId: string, organizationId: string, transaction: AdminTransaction) {
    return (await transaction.user.count({ where: { id: userId, organizationId, accountType: 'INTERNAL', status: 'ACTIVE' } })) === 1;
  }
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly limits: RateLimitService,
    private readonly audit: AuditLogService,
    private readonly mfa: MfaService,
    private readonly passwordChanges: PasswordChangeChallengeService,
  ) {}

  async login(
    dto: LoginDto,
    request: RateLimitedRequest,
  ): Promise<{ response: LoginResponseDto; challengeToken?: string; passwordChangeToken?: string } & Partial<IssuedSession>> {
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

    const authentication = await this.prisma.$transaction(async (transaction): Promise<
      { passwordChangeToken: string } | { challenge: { token: string; enrollment: boolean } } | IssuedSession | null
    > => {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
      await transaction.$queryRaw`SELECT id FROM organizations WHERE id = ${user.organizationId}::uuid FOR SHARE`;
      const current = await transaction.user.findUnique({ where: { id: user.id }, include: { organization: { select: { status: true } } } });
      if (!current || current.status !== 'ACTIVE' || current.organization.status !== 'ACTIVE' || current.passwordHash !== user.passwordHash || current.organizationId !== user.organizationId || current.accountType !== user.accountType) return null;
      if (current.mustChangePassword) {
        const temporary = await transaction.userTemporaryPassword.findUnique({ where: { userId: current.id } });
        if (!temporary || temporary.credentialVersion !== current.credentialVersion || temporary.expiresAt.getTime() <= Date.now()) return null;
        return { passwordChangeToken: await this.passwordChanges.create(current, transaction, dto.rememberMe ?? false) };
      }
      const challenge = await this.mfa.createChallenge(current, transaction, dto.rememberMe ?? false);
      if (challenge) return { challenge };
      return this.sessions.createWithMetadata(current.id, transaction, { reauthenticated: true, rememberMe: dto.rememberMe ?? false });
    }).catch((error: unknown) => rethrowSecurityRejection(this.prisma, this.audit, error, { userId: user.id, resourceType: 'User', resourceId: user.id, traceId: requestTraceId(request), action: 'LOGIN_FAILED', outcome: 'FAILURE' }));
    if (!authentication) return this.rejectLogin(rateKey, request, user);
    this.limits.recordSuccess(rateKey);
    if ('passwordChangeToken' in authentication) return { passwordChangeToken: authentication.passwordChangeToken, response: { accountType: user.accountType, landingPath: '/change-password', securityState: 'PASSWORD_CHANGE_REQUIRED' } };
    if ('challenge' in authentication) return { challengeToken: authentication.challenge.token, response: { accountType: user.accountType, landingPath: '/mfa', securityState: authentication.challenge.enrollment ? 'MFA_ENROLLMENT_REQUIRED' : 'MFA_REQUIRED' } };
    const response: LoginResponseDto =
      user.accountType === 'SUPPLIER'
        ? { accountType: 'SUPPLIER', landingPath: '/supplier/inbox', securityState: 'AUTHENTICATED' }
        : { accountType: 'INTERNAL', landingPath: '/app/workbench', securityState: 'AUTHENTICATED' };
    return { response, sessionToken: authentication.sessionToken, sessionExpiresAt: authentication.sessionExpiresAt };
  }

  async current(sessionToken: string | undefined): Promise<SessionResponseDto> {
    if (!sessionToken) this.sessionRequired();
    const session = await this.sessions.resolve(sessionToken);
    if (!session) this.sessionRequired();
    return {
      landingPath: session.user.accountType === 'SUPPLIER' ? '/supplier/inbox' : '/app/workbench',
      securityState: 'AUTHENTICATED',
      lifetimeType: session.lifetimeType,
      expiresAt: session.expiresAt.toISOString(),
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
      fullName: user.fullName,
      phone: user.phone,
      profileVersion: user.profileVersion,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      accountType: user.accountType,
      status: user.status,
      mfaEnabled: user.mfaEnabled,
      avatarFileId: user.avatarFileId,
      avatarVersion: user.avatarVersion,
      organization: {
        id: user.organization.id ?? user.organizationId,
        code: user.organization.code,
        name: user.organization.name,
      },
    };
  }

  async updateProfile(userId: string, dto: UpdateAccountProfileDto, traceId: string, sessionId: string, key?: string): Promise<AccountProfileDto> {
    try {
      if (!key || !/^[a-zA-Z0-9._:-]{8,128}$/.test(key)) adminError('IDEMPOTENCY_KEY_REQUIRED', 400);
      const data = profileData(dto);
      const digests = adminMutationDigests(JSON.stringify({ userId, ...data, expectedProfileVersion: dto.expectedProfileVersion }), process.env.QMS_RATE_LIMIT_SECRET?.trim() ?? 'qms-development-rate-limit-secret-not-for-production');
      return await this.prisma.$transaction(async (transaction) => {
        const { user } = await assertRecentAuthentication(transaction, { id: userId, sessionId });
        const identity = { actorUserId: userId, organizationId: user.organizationId, key };
        const receipt = await transaction.adminMutation.findUnique({ where: { actorUserId_organizationId_key: identity } });
        if (receipt) {
          if (receipt.action !== 'PROFILE_UPDATED' || !digests.includes(receipt.requestDigest)) adminError('IDEMPOTENCY_REPLAY', 409);
          return this.profile(userId, transaction);
        }
        if (!Number.isInteger(dto.expectedProfileVersion) || dto.expectedProfileVersion < 1 || dto.expectedProfileVersion > 2147483647) throw new HttpException('Invalid profile version', 400);
        if (user.profileVersion !== dto.expectedProfileVersion || user.profileVersion === 2147483647) adminError('CONCURRENCY_CONFLICT', 409);
        const changedFields = Object.keys(data).filter((field) => data[field as keyof typeof data] !== user[field as keyof typeof data]);
        const version = user.profileVersion + Number(changedFields.length > 0);
        if (changedFields.length) await transaction.user.update({ where: { id: userId, profileVersion: dto.expectedProfileVersion }, data: { ...data, profileVersion: version } });
        await transaction.adminMutation.create({ data: { ...identity, action: 'PROFILE_UPDATED', requestDigest: digests[0]!, response: { value: { userId, profileVersion: version } } } });
        const profile = await this.profile(userId, transaction);
        await this.audit.record({ actorUserId: userId, organizationId: profile.organization.id, action: 'PROFILE_UPDATED', resourceType: 'User', resourceId: userId, outcome: 'SUCCESS', traceId, metadata: { changedFields: changedFields.join(','), resourceVersion: version } }, transaction);
        return profile;
      }, { isolationLevel: 'ReadCommitted' });
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
      if (input.newPassword === input.currentPassword || input.newPassword.length < 12 || input.newPassword.length > 256) {
        throw new HttpException({ code: 'AUTH_PASSWORD_POLICY_INVALID', message: '新密码不符合安全策略' }, 400);
      }
      const user = await this.prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, organizationId: true, passwordHash: true } });
      if (!user || !(await this.passwords.verify(user.passwordHash, input.currentPassword))) {
        throw new HttpException({ code: 'AUTH_CURRENT_PASSWORD_INVALID', message: '当前密码错误' }, 401);
      }
      const passwordHash = await this.passwords.hash(input.newPassword);
      await this.prisma.$transaction(async (transaction) => {
        await assertRecentAuthentication(transaction, { id: input.userId, sessionId: input.currentSessionId });
        const locked = await transaction.user.findUniqueOrThrow({ where: { id: input.userId } });
        if (locked.passwordHash !== user.passwordHash || locked.status !== 'ACTIVE') adminError('CONCURRENCY_CONFLICT', 409);
        const current = await replacePassword(transaction, input.userId, passwordHash);
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
