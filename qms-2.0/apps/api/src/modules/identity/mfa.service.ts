import { HttpException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma, User } from '../../generated/prisma/client.js';
import { assertRecentAuthentication, digest, isSecurityConcurrencyConflict, mfaPolicy, securityError } from '../../common/security/session-security.js';
import { decryptSecret, encryptSecret } from '../../common/security/security-keyring.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { SessionService } from './session.service.js';
import { PasswordService } from './password.service.js';
import type { MfaPreferenceDto } from './dto/mfa.dto.js';

export const MFA_CHALLENGE_COOKIE = 'qms_mfa_challenge';
type Transaction = Prisma.TransactionClient;
type Authentication = { sessionToken?: string; challengeToken?: string };

@Injectable()
export class MfaService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService, private readonly sessions: SessionService, private readonly passwords: PasswordService) {}

  async cancelChallenge(token: string | undefined) {
    if (!token) return;
    const challenge = await this.prisma.mfaChallenge.findUnique({ where: { tokenHash: digest(token) } });
    if (!challenge) return;
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${challenge.userId}::uuid FOR UPDATE`;
      await transaction.mfaChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
    });
  }

  async createChallenge(user: User, transaction: Transaction, rememberMe = false) {
    if (user.mustChangePassword) securityError('AUTH_PASSWORD_CHANGE_REQUIRED');
    const policy = await mfaPolicy(transaction, user.id);
    if (!policy.required) return null;
    if (user.mfaBlockedUntil && user.mfaBlockedUntil.getTime() > Date.now()) securityError('AUTH_MFA_RATE_LIMITED', 429);
    const token = randomBytes(32).toString('base64url');
    await transaction.mfaChallenge.create({ data: { userId: user.id, organizationId: user.organizationId, tokenHash: digest(token), securityVersion: user.securityVersion, passwordDigest: digest(user.passwordHash), policyDigest: policy.digest, enrollment: !user.mfaEnabled, rememberMe, expiresAt: new Date(Date.now() + 300_000) } });
    return { token, enrollment: !user.mfaEnabled };
  }

  async status(authentication: Authentication) {
    return this.prisma.$transaction(async (transaction) => {
      const { user, challenge, session } = await this.authenticate(transaction, authentication);
      const policy = await mfaPolicy(transaction, user.id);
      return { emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null, mfaEnabled: user.mfaEnabled, mfaRequired: policy.required, isAdministrator: policy.administrator, mfaPreference: user.mfaPreference, canUnbindMfa: false, securityState: challenge ? challenge.enrollment ? 'MFA_ENROLLMENT_REQUIRED' : 'MFA_REQUIRED' : 'AUTHENTICATED', recoveryCodesRemaining: await transaction.mfaRecoveryCode.count({ where: { userId: user.id, consumedAt: null } }), reauthenticationExpiresAt: session?.reauthenticatedAt ? new Date(session.reauthenticatedAt.getTime() + 300_000).toISOString() : null };
    });
  }

  async beginEnrollment(authentication: Authentication, traceId: string) {
    return this.run(authentication, traceId, async (transaction) => {
      const { user, challenge, session } = await this.authenticate(transaction, authentication);
      if (user.mfaEnabled) securityError('AUTH_MFA_ALREADY_ENABLED', 409);
      if (!challenge?.enrollment) await assertRecentAuthentication(transaction, { id: user.id, sessionId: session!.id });
      const totp = new TOTP({ issuer: 'QMS', label: user.username, secret: new Secret({ size: 32 }), period: 30, digits: 6 });
      const pendingSecret = encryptSecret(totp.secret.base32, `mfa:${user.id}`);
      await transaction.mfaCredential.upsert({ where: { userId: user.id }, create: { userId: user.id, pendingSecret, pendingExpiresAt: new Date(Date.now() + 300_000) }, update: { pendingSecret, pendingExpiresAt: new Date(Date.now() + 300_000) } });
      await this.record(transaction, user, 'MFA_ENROLLMENT_STARTED', traceId);
      return { secret: totp.secret.base32, otpauthUri: totp.toString(), expiresAt: new Date(Date.now() + 300_000).toISOString() };
    });
  }

  async confirmEnrollment(authentication: Authentication, code: string, traceId: string) {
    const result = await this.run(authentication, traceId, async (transaction) => {
      const { user, challenge, session } = await this.authenticate(transaction, authentication);
      if (user.mfaEnabled) securityError('AUTH_MFA_ALREADY_ENABLED', 409);
      if (!challenge?.enrollment) await assertRecentAuthentication(transaction, { id: user.id, sessionId: session!.id });
      if (await this.blocked(transaction, user, challenge?.id, traceId)) return { error: 'AUTH_MFA_RATE_LIMITED' };
      const credential = await transaction.mfaCredential.findUnique({ where: { userId: user.id } });
      const step = credential?.pendingSecret && credential.pendingExpiresAt && credential.pendingExpiresAt.getTime() > Date.now() ? this.timeStep(credential.pendingSecret, user.id, code) : null;
      if (step === null) return this.failure(transaction, user, challenge?.id, traceId);
      await transaction.mfaCredential.update({ where: { userId: user.id }, data: { encryptedSecret: credential!.pendingSecret, pendingSecret: null, pendingExpiresAt: null, lastTimeStep: step } });
      await transaction.user.update({ where: { id: user.id }, data: { mfaEnabled: true, securityVersion: { increment: 1 }, mfaFailures: 0, mfaBlockedUntil: null } });
      await transaction.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await transaction.mfaChallenge.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } });
      const recoveryCodes = await this.generateCodes(transaction, user.id);
      const issued = await this.sessions.createWithMetadata(user.id, transaction, { mfaVerified: true, reauthenticated: true, rememberMe: challenge?.rememberMe ?? (session?.lifetimeType !== 'STANDARD'), expiresAt: session?.expiresAt });
      await this.record(transaction, user, 'MFA_ENABLED', traceId);
      return { recoveryCodes, ...issued, accountType: user.accountType, landingPath: user.accountType === 'INTERNAL' ? '/app/workbench' as const : '/supplier/inbox' as const, securityState: 'AUTHENTICATED' as const };
    });
    if ('error' in result) securityError(result.error!, result.error === 'AUTH_MFA_RATE_LIMITED' ? 429 : 401);
    return result;
  }

  async verifyChallenge(challengeToken: string | undefined, code: string, traceId: string) {
    const result = await this.run({ challengeToken }, traceId, async (transaction) => {
      const { user, challenge } = await this.authenticate(transaction, { challengeToken });
      if (!challenge || challenge.enrollment || !user.mfaEnabled) securityError('AUTH_MFA_CHALLENGE_INVALID');
      if (await this.blocked(transaction, user, challenge.id, traceId)) return { error: 'AUTH_MFA_RATE_LIMITED' };
      if (!(await this.consumeFactor(transaction, user.id, code))) return this.failure(transaction, user, challenge.id, traceId);
      await transaction.mfaChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
      await transaction.user.update({ where: { id: user.id }, data: { mfaFailures: 0, mfaBlockedUntil: null } });
      const issued = await this.sessions.createWithMetadata(user.id, transaction, { mfaVerified: true, reauthenticated: true, rememberMe: challenge.rememberMe });
      await this.record(transaction, user, 'MFA_LOGIN_SUCCEEDED', traceId);
      return { ...issued, accountType: user.accountType, landingPath: user.accountType === 'INTERNAL' ? '/app/workbench' as const : '/supplier/inbox' as const, securityState: 'AUTHENTICATED' as const };
    });
    if ('error' in result) securityError(result.error!, result.error === 'AUTH_MFA_RATE_LIMITED' ? 429 : 401);
    return result;
  }

  async reauthenticate(authentication: Authentication, password: string, code: string | undefined, traceId: string) {
    const result = await this.run(authentication, traceId, async (transaction) => {
      const { user, session } = await this.authenticate(transaction, { sessionToken: authentication.sessionToken });
      if (await this.blocked(transaction, user, undefined, traceId)) return { error: 'AUTH_MFA_RATE_LIMITED' };
      const policy = await mfaPolicy(transaction, user.id);
      if (!(await this.passwords.verify(user.passwordHash, password)) || (policy.required && !(await this.consumeFactor(transaction, user.id, code ?? '')))) return this.failure(transaction, user, undefined, traceId);
      const now = new Date();
      await transaction.session.update({ where: { id: session!.id }, data: { reauthenticatedAt: now, ...(policy.required ? { mfaVerifiedAt: now } : {}) } });
      await transaction.user.update({ where: { id: user.id }, data: { mfaFailures: 0, mfaBlockedUntil: null } });
      await this.record(transaction, user, 'REAUTHENTICATION_SUCCEEDED', traceId);
      return { reauthenticationExpiresAt: new Date(now.getTime() + 300_000).toISOString() };
    });
    if ('error' in result) securityError(result.error!, result.error === 'AUTH_MFA_RATE_LIMITED' ? 429 : 401);
    return result;
  }

  async regenerateCodes(authentication: Authentication, traceId: string) {
    return this.run(authentication, traceId, async (transaction) => {
      const { user, session } = await this.authenticate(transaction, { sessionToken: authentication.sessionToken });
      await assertRecentAuthentication(transaction, { id: user.id, sessionId: session!.id });
      if (!user.mfaEnabled) securityError('AUTH_MFA_NOT_ENABLED', 409);
      const recoveryCodes = await this.generateCodes(transaction, user.id);
      await this.record(transaction, user, 'MFA_RECOVERY_CODES_REGENERATED', traceId);
      return { recoveryCodes };
    });
  }

  async disable(authentication: Authentication, traceId: string) {
    return this.run(authentication, traceId, async (transaction) => {
      await this.authenticate(transaction, { sessionToken: authentication.sessionToken });
      securityError('FEATURE_PERMISSION_DENIED', 403);
    });
  }

  async setPreference(authentication: Authentication, _input: MfaPreferenceDto, _key: string | undefined, traceId: string) {
    return this.run(authentication, traceId, async (transaction) => {
      await this.authenticate(transaction, { sessionToken: authentication.sessionToken });
      securityError('FEATURE_PERMISSION_DENIED', 403);
    });
  }

  private async authenticate(transaction: Transaction, authentication: Authentication) {
    const preliminaryChallenge = authentication.challengeToken ? await transaction.mfaChallenge.findUnique({ where: { tokenHash: digest(authentication.challengeToken) } }) : null;
    const preliminarySession = !preliminaryChallenge && authentication.sessionToken ? await transaction.session.findUnique({ where: { tokenHash: digest(authentication.sessionToken) } }) : null;
    const userId = preliminaryChallenge?.userId ?? preliminarySession?.userId;
    if (!userId) securityError('AUTH_MFA_CHALLENGE_INVALID');
    await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const user = await transaction.user.findUnique({ where: { id: userId }, include: { organization: true } });
    if (!user || user.status !== 'ACTIVE' || user.organization.status !== 'ACTIVE' || user.mustChangePassword) securityError('AUTH_SESSION_REQUIRED');
    await transaction.$queryRaw`SELECT id FROM organizations WHERE id = ${user.organizationId}::uuid FOR SHARE`;
    const activeOrganization = await transaction.organization.findUnique({ where: { id: user.organizationId } });
    if (activeOrganization?.status !== 'ACTIVE') securityError('AUTH_SESSION_REQUIRED');
    const policy = await mfaPolicy(transaction, user.id);
    if (preliminarySession) await transaction.$queryRaw`SELECT id FROM sessions WHERE id = ${preliminarySession.id}::uuid FOR UPDATE`;
    const challenge = preliminaryChallenge ? await transaction.mfaChallenge.findUnique({ where: { id: preliminaryChallenge.id } }) : null;
    const session = preliminarySession ? await transaction.session.findUnique({ where: { id: preliminarySession.id } }) : null;
    if (challenge && (challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now() || challenge.securityVersion !== user.securityVersion || challenge.passwordDigest !== digest(user.passwordHash) || challenge.organizationId !== user.organizationId || challenge.policyDigest !== policy.digest)) securityError('AUTH_MFA_CHALLENGE_INVALID');
    if (session && (session.revokedAt || session.expiresAt.getTime() <= Date.now() || session.securityVersion !== user.securityVersion || (policy.required && !session.mfaVerifiedAt))) securityError('AUTH_SESSION_REQUIRED');
    if (!session && !challenge) securityError('AUTH_SESSION_REQUIRED');
    return { user, challenge, session };
  }

  private timeStep(encrypted: string, userId: string, code: string): bigint | null {
    if (!/^\d{6}$/.test(code)) return null;
    const totp = new TOTP({ secret: decryptSecret(encrypted, `mfa:${userId}`), period: 30, digits: 6 });
    const timestamp = Date.now();
    const delta = totp.validate({ token: code, window: 1, timestamp });
    return delta === null ? null : BigInt(Math.floor(timestamp / 30_000) + delta);
  }

  private async consumeFactor(transaction: Transaction, userId: string, code: string): Promise<boolean> {
    if (/^[A-Za-z0-9_-]{43}$/.test(code)) return (await transaction.mfaRecoveryCode.updateMany({ where: { userId, codeHash: digest(code), consumedAt: null }, data: { consumedAt: new Date() } })).count === 1;
    const credential = await transaction.mfaCredential.findUnique({ where: { userId } });
    if (!credential?.encryptedSecret) return false;
    const step = this.timeStep(credential.encryptedSecret, userId, code);
    if (step === null || (credential.lastTimeStep !== null && step <= credential.lastTimeStep)) return false;
    return (await transaction.mfaCredential.updateMany({ where: { userId, lastTimeStep: credential.lastTimeStep }, data: { lastTimeStep: step } })).count === 1;
  }

  private async generateCodes(transaction: Transaction, userId: string) {
    const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(32).toString('base64url'));
    await transaction.mfaRecoveryCode.deleteMany({ where: { userId } });
    await transaction.mfaRecoveryCode.createMany({ data: recoveryCodes.map((code) => ({ userId, codeHash: digest(code) })) });
    return recoveryCodes;
  }

  private async blocked(transaction: Transaction, user: User, challengeId: string | undefined, traceId: string) {
    const challenge = challengeId ? await transaction.mfaChallenge.findUnique({ where: { id: challengeId } }) : null;
    const blocked = (user.mfaBlockedUntil?.getTime() ?? 0) > Date.now() || (challenge?.attempts ?? 0) >= 5;
    if (blocked) await this.record(transaction, user, 'MFA_VERIFICATION_REJECTED', traceId, 'AUTH_MFA_RATE_LIMITED');
    return blocked;
  }

  private async failure(transaction: Transaction, user: User, challengeId: string | undefined, traceId: string) {
    const failures = user.mfaBlockedUntil && user.mfaBlockedUntil.getTime() <= Date.now() ? 1 : user.mfaFailures + 1;
    await transaction.user.update({ where: { id: user.id }, data: { mfaFailures: failures, mfaBlockedUntil: failures >= 5 ? new Date(Date.now() + 900_000) : null } });
    if (challengeId) await transaction.mfaChallenge.update({ where: { id: challengeId }, data: { attempts: { increment: 1 } } });
    await this.record(transaction, user, 'MFA_VERIFICATION_REJECTED', traceId, 'AUTH_MFA_CODE_INVALID');
    return { error: 'AUTH_MFA_CODE_INVALID' };
  }

  private record(transaction: Transaction, user: User, action: string, traceId: string, reasonCode?: string) {
    return this.audit.record({ actorUserId: user.id, organizationId: user.organizationId, resourceType: 'User', resourceId: user.id, action, traceId, outcome: reasonCode ? 'DENIED' : 'SUCCESS', metadata: reasonCode ? { reasonCode } : {} }, transaction);
  }

  private async run<Result>(authentication: Authentication, traceId: string, work: (transaction: Transaction) => Promise<Result>): Promise<Result> {
    try {
      return await this.prisma.$transaction(work);
    } catch (error) {
      const rejection = isSecurityConcurrencyConflict(error)
        ? new HttpException({ code: 'CONCURRENCY_CONFLICT', message: '并发修改冲突' }, 409) : error;
      if (rejection instanceof HttpException) {
        const challenge = authentication.challengeToken ? await this.prisma.mfaChallenge.findUnique({ where: { tokenHash: digest(authentication.challengeToken) } }) : null;
        const session = authentication.sessionToken ? await this.prisma.session.findUnique({ where: { tokenHash: digest(authentication.sessionToken) } }) : null;
        const userId = challenge?.userId ?? session?.userId;
        const user = userId ? await this.prisma.user.findUnique({ where: { id: userId } }) : null;
        await this.audit.record({ actorUserId: user?.id, organizationId: user?.organizationId, resourceType: 'User', resourceId: user?.id, action: 'MFA_VERIFICATION_REJECTED', outcome: 'DENIED', traceId, metadata: { reasonCode: (rejection.getResponse() as { code: string }).code } });
      }
      throw rejection;
    }
  }
}
