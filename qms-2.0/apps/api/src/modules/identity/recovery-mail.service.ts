import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import { createTransport } from 'nodemailer';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma, User } from '../../generated/prisma/client.js';
import { decryptSecret, encryptSecret } from '../../common/security/security-keyring.js';
import { securityError, digest } from '../../common/security/session-security.js';

export type RecoveryPurpose = 'VERIFY_EMAIL' | 'PASSWORD_RECOVERY';

@Injectable()
export class RecoveryMailService {
  constructor(private readonly prisma: PrismaService) {}

  configuration() {
    const host = process.env.SMTP_HOST?.trim();
    const port = Number(process.env.SMTP_PORT);
    const secure = process.env.SMTP_SECURE === 'true';
    const from = process.env.SMTP_FROM?.trim();
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !from || !/^[^\s<>@]+@[^\s<>@]+$/.test(from) || (!!user !== !!pass) || !['true', 'false'].includes(process.env.SMTP_SECURE ?? '')) securityError('AUTH_MAIL_UNAVAILABLE', 503);
    return { host, port, secure, from, requireTLS: process.env.NODE_ENV === 'production', ...(user && pass ? { auth: { user, pass } } : {}), connectionTimeout: 3000, greetingTimeout: 3000, socketTimeout: 5000, tls: { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true } };
  }

  async enqueue(transaction: Prisma.TransactionClient, user: User, purpose: RecoveryPurpose) {
    const now = new Date();
    if (!user.email) return;
    const recent = await transaction.emailVerification.count({ where: { userId: user.id, purpose, createdAt: { gt: new Date(now.getTime() - 60_000) } } });
    if (recent) return;
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const encryptedPayload = encryptSecret(JSON.stringify({ to: user.email, token, purpose }), `recovery-mail:${id}`);
    await transaction.emailVerification.updateMany({ where: { userId: user.id, purpose, consumedAt: null }, data: { consumedAt: now } });
    await transaction.emailVerification.create({ data: { userId: user.id, email: user.email, purpose, securityVersion: user.securityVersion, tokenHash: digest(token), expiresAt: new Date(now.getTime() + 15 * 60_000), delivery: { create: { id, encryptedPayload, keyId: (JSON.parse(encryptedPayload) as { keyId: string }).keyId } } } });
  }

  async dispatchPending(limit = 20) {
    const configuration = this.configuration();
    let processed = 0;
    for (let index = 0; index < Math.min(100, Math.max(0, limit)); index += 1) {
      const claim = await this.claim();
      if (!claim) break;
      if (claim.claimId) await this.sendClaim(claim, configuration);
      processed += 1;
    }
    return { processed };
  }

  private async claim() {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SET LOCAL lock_timeout = '2000ms'`;
      const candidates = await transaction.$queryRaw<{ id: string; userId: string }[]>`
        SELECT delivery.id, account.id AS "userId"
        FROM recovery_deliveries delivery
        JOIN email_verifications verification ON verification.id = delivery.verification_id
        JOIN users account ON account.id = verification.user_id
        WHERE (delivery.status = 'PENDING' AND delivery.available_at <= CURRENT_TIMESTAMP)
           OR (delivery.status = 'PROCESSING' AND delivery.processing_at <= CURRENT_TIMESTAMP - INTERVAL '60 seconds')
        ORDER BY delivery.created_at FOR UPDATE OF account SKIP LOCKED LIMIT 1`;
      const candidate = candidates[0];
      if (!candidate) return null;
      const delivery = await this.lockDelivery(transaction, candidate);
      if (!delivery || !(delivery.status === 'PENDING' && delivery.availableAt <= new Date() || delivery.status === 'PROCESSING' && delivery.processingAt && delivery.processingAt.getTime() <= Date.now() - 60000)) return null;
      if (this.invalid(delivery) || delivery.attempts >= 5) {
        await transaction.recoveryDelivery.update({ where: { id: delivery.id }, data: { status: delivery.attempts >= 5 ? 'FAILED' : 'CANCELLED', encryptedPayload: null, claimId: null, processingAt: null, ...(delivery.attempts >= 5 ? { lastError: 'MAIL_DELIVERY_FAILED' } : {}) } });
        return { ...candidate, claimId: null };
      }
      const claimId = randomUUID();
      await transaction.recoveryDelivery.update({ where: { id: delivery.id }, data: { status: 'PROCESSING', claimId, processingAt: new Date(), attempts: { increment: 1 } } });
      return { ...candidate, claimId };
    });
  }

  private async lockDelivery(transaction: Prisma.TransactionClient, claim: { id: string; userId: string }) {
    await transaction.$queryRaw`SELECT id FROM users WHERE id = ${claim.userId}::uuid FOR UPDATE`;
    const account = await transaction.user.findUnique({ where: { id: claim.userId }, select: { organizationId: true } });
    if (!account) return null;
    await transaction.$queryRaw`SELECT id FROM organizations WHERE id = ${account.organizationId}::uuid FOR SHARE`;
    await transaction.$queryRaw`SELECT id FROM recovery_deliveries WHERE id = ${claim.id}::uuid FOR UPDATE`;
    await transaction.$queryRaw`SELECT id FROM email_verifications WHERE id = (SELECT verification_id FROM recovery_deliveries WHERE id = ${claim.id}::uuid) FOR UPDATE`;
    return transaction.recoveryDelivery.findUnique({ where: { id: claim.id }, include: { verification: { include: { user: { include: { organization: true } } } } } });
  }

  private invalid(delivery: NonNullable<Awaited<ReturnType<RecoveryMailService['lockDelivery']>>>) {
    const verification = delivery.verification;
    const user = verification.user;
    return !delivery.encryptedPayload || !!verification.consumedAt || verification.expiresAt <= new Date() || user.status !== 'ACTIVE' || user.organization.status !== 'ACTIVE' || user.email !== verification.email || user.securityVersion !== verification.securityVersion || (verification.purpose === 'PASSWORD_RECOVERY' && !user.emailVerifiedAt);
  }

  private async sendClaim(claim: { id: string; userId: string; claimId: string | null }, configuration: ReturnType<RecoveryMailService['configuration']>) {
    await this.prisma.$transaction(async (transaction) => {
      const started = Date.now();
      await transaction.$executeRaw`SET LOCAL lock_timeout = '2000ms'`;
      const delivery = await this.lockDelivery(transaction, claim);
      if (!delivery || delivery.status !== 'PROCESSING' || delivery.claimId !== claim.claimId) return;
      if (this.invalid(delivery)) {
        await transaction.recoveryDelivery.update({ where: { id: delivery.id }, data: { status: 'CANCELLED', encryptedPayload: null, claimId: null, processingAt: null } });
        return;
      }
      try {
        const payload = JSON.parse(decryptSecret(delivery.encryptedPayload!, `recovery-mail:${delivery.id}`)) as { to: string; token: string; purpose: RecoveryPurpose };
        await this.send(configuration, payload, Math.min(7000, 10000 - (Date.now() - started)));
        await transaction.recoveryDelivery.update({ where: { id: delivery.id }, data: { status: 'SENT', sentAt: new Date(), encryptedPayload: null, lastError: null, claimId: null, processingAt: null } });
      } catch {
        const exhausted = delivery.attempts >= 5;
        await transaction.recoveryDelivery.update({ where: { id: delivery.id }, data: { status: exhausted ? 'FAILED' : 'PENDING', availableAt: new Date(Date.now() + 60_000 * 2 ** (delivery.attempts - 1)), lastError: 'MAIL_DELIVERY_FAILED', claimId: null, processingAt: null, ...(exhausted ? { encryptedPayload: null } : {}) } });
      }
    }, { timeout: 15000 });
  }

  private async send(configuration: ReturnType<RecoveryMailService['configuration']>, payload: { to: string; token: string; purpose: RecoveryPurpose }, timeout: number) {
    if (timeout <= 0) throw new Error('Mail deadline exceeded');
    let socket: Socket | undefined;
    let expired = false;
    let socketClosed: Promise<void> | undefined;
    const transport = createTransport({ ...configuration, getSocket: (_options, callback) => {
      if (expired) { callback(new Error('Mail deadline exceeded')); return; }
      socket = createConnection({ host: configuration.host, port: configuration.port });
      const currentSocket = socket;
      socketClosed = new Promise<void>((resolve) => currentSocket.once('close', resolve));
      const connectionError = (error: Error) => callback(error);
      currentSocket.once('error', connectionError);
      currentSocket.once('connect', () => {
        currentSocket.removeListener('error', connectionError);
        currentSocket.on('error', () => undefined);
        if (expired) { currentSocket.destroy(); callback(new Error('Mail deadline exceeded')); return; }
        callback(null, { connection: currentSocket });
      });
    } });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => {
          expired = true;
          socket?.destroy();
          reject(new Error('Mail deadline exceeded'));
        }, timeout);
        void transport.sendMail({ from: configuration.from, to: { address: payload.to, name: '' }, subject: payload.purpose === 'VERIFY_EMAIL' ? 'QMS 邮箱确认' : 'QMS 密码找回', text: `请在 QMS 安全页面输入以下一次性凭证（15 分钟内有效）：\n${payload.token}\n如非本人操作，请忽略本邮件。`, disableFileAccess: true, disableUrlAccess: true }).then((result) => {
          if (expired || result.rejected.length || !result.accepted.length) reject(new Error('Mail delivery failed'));
          else resolve();
        }, reject);
      });
    } finally {
      if (timer) clearTimeout(timer);
      expired = true;
      socket?.destroy();
      await socketClosed;
      transport.close();
    }
  }
}
