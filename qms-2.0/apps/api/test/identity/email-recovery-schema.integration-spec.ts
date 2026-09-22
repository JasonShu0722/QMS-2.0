import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { PasswordService } from '../../src/modules/identity/password.service.js';
import { EmailRecoveryService } from '../../src/modules/identity/email-recovery.service.js';
import { RecoveryMailService } from '../../src/modules/identity/recovery-mail.service.js';
import { decryptSecret } from '../../src/common/security/security-keyring.js';
import { digest } from '../../src/common/security/session-security.js';

if (!process.env.DATABASE_URL) throw new Error('PostgreSQL integration requires DATABASE_URL; no skipping.');

describe('Email recovery PostgreSQL boundaries', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let recovery: EmailRecoveryService;
  let mail: RecoveryMailService;
  let organizationId: string;
  let passwordHash: string;
  const original = { ...process.env };
  const csrf = 'email-test-csrf';
  beforeAll(async () => {
    process.env.QMS_SECURITY_CURRENT_KEY_ID = 'mail-test';
    process.env.QMS_SECURITY_KEYRING = JSON.stringify({ 'mail-test': randomBytes(32).toString('base64') });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    recovery = app.get(EmailRecoveryService);
    mail = app.get(RecoveryMailService);
    organizationId = (await prisma.organization.create({ data: { code: randomUUID(), name: 'Mail test', type: 'INTERNAL' } })).id;
    passwordHash = await app.get(PasswordService).hash('Original safe password 123!');
  });
  afterAll(async () => {
    if (organizationId) {
      await prisma.auditEvent.deleteMany({ where: { organizationId } });
      await prisma.user.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await app?.close(); process.env = original;
  });
  beforeEach(() => {
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '51026';
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_FROM = 'qms@example.test';
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });
  async function account(verified = false) {
    const id = randomUUID();
    return prisma.user.create({ data: { organizationId, username: id, email: `${id}@example.test`, emailVerifiedAt: verified ? new Date() : null, passwordHash, accountType: 'INTERNAL' } });
  }
  async function credential(userId: string, purpose: string) {
    const record = await prisma.emailVerification.findFirstOrThrow({ where: { userId, purpose }, include: { delivery: true }, orderBy: { createdAt: 'desc' } });
    const token = (JSON.parse(decryptSecret(record.delivery!.encryptedPayload!, `recovery-mail:${record.delivery!.id}`)) as { token: string }).token;
    return { record, token };
  }
  function post(path: string, body: object, session?: string) {
    return request(app.getHttpServer()).post(`/api/v1/${path}`).set('Cookie', `qms_csrf=${csrf}${session ? `;qms_session=${session}` : ''}`).set('x-csrf-token', csrf).send(body);
  }
  it('fails closed uniformly when SMTP configuration is absent', async () => {
    delete process.env.SMTP_HOST;
    await request(app.getHttpServer()).post('/api/v1/auth/password-recovery').set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send({ identifier: randomUUID() }).expect(503);
    const user = await account(true);
    await post('auth/password-recovery', { identifier: user.email }).expect(503);
    expect(await prisma.emailVerification.count({ where: { userId: user.id } })).toBe(0);
  });

  it('requires CSRF and recent complete authentication before confirming email', async () => {
    const user = await account();
    await request(app.getHttpServer()).post('/api/v1/me/email-verification').send({}).expect(403);
    await post('me/email-verification', {}).expect(401);
    const stale = await app.get(SessionService).create(user.id);
    await post('me/email-verification', {}, stale).expect(403);
    const session = await app.get(SessionService).create(user.id, prisma, { reauthenticated: true });
    const response = await post('me/email-verification', {}, session).expect(202);
    expect(response.text).toBe('');
    const { record, token } = await credential(user.id, 'VERIFY_EMAIL');
    expect(record.tokenHash).toBe(digest(token));
    expect(JSON.stringify(record)).not.toContain(token);
    expect(record.delivery!.keyId).toBe('mail-test');
    await post('auth/email-verification/complete', { token }).expect(204);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();
    await post('auth/email-verification/complete', { token }).expect(400);
  });

  it('returns identical acceptance for unknown, unverified, disabled and eligible accounts', async () => {
    const unverified = await account();
    const disabled = await account(true);
    const eligible = await account(true);
    await prisma.user.update({ where: { id: disabled.id }, data: { status: 'DISABLED' } });
    for (const identifier of [randomUUID(), unverified.email, disabled.email, eligible.email]) {
      const response = await post('auth/password-recovery', { identifier }).expect(202);
      expect(response.text).toBe('');
    }
    expect(await prisma.emailVerification.count({ where: { userId: { in: [unverified.id, disabled.id] } } })).toBe(0);
    expect(await prisma.emailVerification.count({ where: { userId: eligible.id } })).toBe(1);
    await recovery.requestRecovery({ identifier: eligible.email! }, randomUUID());
    expect(await prisma.emailVerification.count({ where: { userId: eligible.id } })).toBe(1);
  });

  it('sends encrypted queued credentials through real SMTP and scrubs payload after acceptance', async () => {
    const user = await account(true);
    await recovery.requestRecovery({ identifier: user.email! }, randomUUID());
    const { record, token } = await credential(user.id, 'PASSWORD_RECOVERY');
    await mail.dispatchPending();
    const delivery = await prisma.recoveryDelivery.findUniqueOrThrow({ where: { id: record.delivery!.id } });
    expect(delivery).toMatchObject({ status: 'SENT', attempts: 1, encryptedPayload: null });
    const messages = await fetch('http://127.0.0.1:51027/api/v1/messages').then((response) => response.json()) as { messages: { ID: string; To: { Address: string }[] }[] };
    const message = messages.messages.find((entry) => entry.To.some((recipient) => recipient.Address === user.email));
    expect(message).toBeDefined();
    const body = await fetch(`http://127.0.0.1:51027/api/v1/message/${message!.ID}`).then((response) => response.json()) as { Text: string };
    expect(body.Text).toContain(token);
    const audits = await prisma.auditEvent.findMany({ where: { organizationId } });
    expect(JSON.stringify(audits)).not.toContain(token);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: record.id } })).toBe(0);
  });

  it('requires organization match and denies disabled organization credentials', async () => {
    const user = await account(true);
    await recovery.requestRecovery({ identifier: user.username, organizationCode: 'wrong-organization' }, randomUUID());
    expect(await prisma.emailVerification.count({ where: { userId: user.id } })).toBe(0);
    await recovery.requestRecovery({ identifier: user.email! }, randomUUID());
    const { token } = await credential(user.id, 'PASSWORD_RECOVERY');
    await prisma.organization.update({ where: { id: organizationId }, data: { status: 'DISABLED' } });
    try {
      await expect(recovery.complete(token, 'PASSWORD_RECOVERY', randomUUID(), 'Replacement safe password 123!')).rejects.toMatchObject({ status: 400 });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(passwordHash);
    } finally { await prisma.organization.update({ where: { id: organizationId }, data: { status: 'ACTIVE' } }); }
  });

  it('atomically consumes recovery, applies password policy, revokes credentials, and preserves MFA binding', async () => {
    const user = await account(true);
    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    await prisma.mfaCredential.create({ data: { userId: user.id, encryptedSecret: 'preserved-ciphertext' } });
    const session = await app.get(SessionService).create(user.id, prisma, { mfaVerified: true });
    const reset = await prisma.passwordReset.create({ data: { userId: user.id, codeHash: digest(randomUUID()), expiresAt: new Date(Date.now() + 60000) } });
    await recovery.requestRecovery({ identifier: user.email! }, randomUUID());
    const { token } = await credential(user.id, 'PASSWORD_RECOVERY');
    await expect(recovery.complete(token, 'PASSWORD_RECOVERY', randomUUID(), 'short')).rejects.toMatchObject({ status: 400 });
    const results = await Promise.allSettled([recovery.complete(token, 'PASSWORD_RECOVERY', randomUUID(), 'Replacement safe password 123!'), recovery.complete(token, 'PASSWORD_RECOVERY', randomUUID(), 'Other replacement password 123!')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await app.get(SessionService).resolve(session)).toBeNull();
    expect((await prisma.passwordReset.findUniqueOrThrow({ where: { id: reset.id } })).consumedAt).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mfaEnabled).toBe(true);
    expect((await prisma.mfaCredential.findUniqueOrThrow({ where: { userId: user.id } })).encryptedSecret).toBe('preserved-ciphertext');
    expect(await prisma.emailVerification.count({ where: { userId: user.id, consumedAt: null } })).toBe(0);
  });

  it('rejects purpose mismatch, expiry and changed security versions', async () => {
    const user = await account(true);
    await recovery.requestRecovery({ identifier: user.email! }, randomUUID());
    const { record, token } = await credential(user.id, 'PASSWORD_RECOVERY');
    await expect(recovery.complete(token, 'VERIFY_EMAIL', randomUUID())).rejects.toMatchObject({ status: 400 });
    await prisma.emailVerification.update({ where: { id: record.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(recovery.complete(token, 'PASSWORD_RECOVERY', randomUUID(), 'Replacement safe password 123!')).rejects.toMatchObject({ status: 400 });
    await prisma.emailVerification.update({ where: { id: record.id }, data: { expiresAt: new Date(Date.now() + 60000) } });
    await prisma.user.update({ where: { id: user.id }, data: { securityVersion: { increment: 1 } } });
    await expect(recovery.complete(token, 'PASSWORD_RECOVERY', randomUUID(), 'Replacement safe password 123!')).rejects.toMatchObject({ status: 400 });
  });

  it('invalidates verified status and all email credentials whenever the address changes', async () => {
    const user = await account(true);
    await recovery.requestRecovery({ identifier: user.email! }, randomUUID());
    const { record, token } = await credential(user.id, 'PASSWORD_RECOVERY');
    await prisma.user.update({ where: { id: user.id }, data: { email: `${randomUUID()}@example.test` } });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toBeNull();
    expect((await prisma.emailVerification.findUniqueOrThrow({ where: { id: record.id } })).consumedAt).not.toBeNull();
    await expect(recovery.complete(token, 'PASSWORD_RECOVERY', randomUUID(), 'Replacement safe password 123!')).rejects.toMatchObject({ status: 400 });
    await mail.dispatchPending();
    expect((await prisma.recoveryDelivery.findUniqueOrThrow({ where: { id: record.delivery!.id } })).status).toBe('CANCELLED');
  });

  it('retains bounded retry state and never records raw SMTP failures', async () => {
    const user = await account(true);
    await recovery.requestRecovery({ identifier: user.email! }, randomUUID());
    const { record } = await credential(user.id, 'PASSWORD_RECOVERY');
    process.env.SMTP_PORT = '59999';
    await mail.dispatchPending();
    expect(await prisma.recoveryDelivery.findUniqueOrThrow({ where: { id: record.delivery!.id } })).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'MAIL_DELIVERY_FAILED' });
    await prisma.recoveryDelivery.update({ where: { id: record.delivery!.id }, data: { attempts: 4, availableAt: new Date(Date.now() - 1000) } });
    await mail.dispatchPending();
    expect(await prisma.recoveryDelivery.findUniqueOrThrow({ where: { id: record.delivery!.id } })).toMatchObject({ status: 'FAILED', attempts: 5, encryptedPayload: null, lastError: 'MAIL_DELIVERY_FAILED' });
  });

  it('rejects IP flood even when account identifiers vary', async () => {
    let limited = false;
    for (let index = 0; index < 31; index += 1) {
      const response = await post('auth/password-recovery', { identifier: randomUUID() });
      if (response.status === 429) { limited = true; break; }
      expect(response.status).toBe(202);
    }
    expect(limited).toBe(true);
  });
});
