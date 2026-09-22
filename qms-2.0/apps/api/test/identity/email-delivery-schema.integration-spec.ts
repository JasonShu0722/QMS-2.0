import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { EmailRecoveryService } from '../../src/modules/identity/email-recovery.service.js';
import { RecoveryMailService } from '../../src/modules/identity/recovery-mail.service.js';

if (!process.env.DATABASE_URL) throw new Error('PostgreSQL integration requires DATABASE_URL; no skipping.');

async function smtpServer(options: { delay?: number; gate?: boolean; reject?: boolean } = {}) {
  const sockets = new Set<Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let connections = 0;
  let closed = 0;
  let accepted = 0;
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const server = createServer((socket) => {
    sockets.add(socket);
    connections += 1;
    socket.on('error', () => undefined);
    socket.on('close', () => { sockets.delete(socket); closed += 1; });
    const respond = (line: string) => {
      const timer = setTimeout(() => { timers.delete(timer); if (!socket.destroyed) socket.write(`${line}\r\n`); }, options.delay ?? 0);
      timers.add(timer);
    };
    respond('220 local acceptance SMTP');
    let buffered = '';
    let data = false;
    socket.on('data', (chunk) => {
      buffered += chunk.toString();
      let separator: number;
      while ((separator = buffered.indexOf('\r\n')) >= 0) {
        const line = buffered.slice(0, separator);
        buffered = buffered.slice(separator + 2);
        if (data) {
          if (line === '.') { data = false; accepted += 1; respond('250 accepted'); }
        } else if (line.startsWith('EHLO') || line.startsWith('HELO')) respond('250 local');
        else if (line.startsWith('MAIL FROM')) respond(options.reject ? '550 refused' : '250 sender');
        else if (line.startsWith('RCPT TO')) {
          enter();
          if (options.gate) void gate.then(() => respond('250 recipient'));
          else respond('250 recipient');
        } else if (line === 'STARTTLS') respond('454 TLS unavailable');
        else if (line === 'DATA') { data = true; respond('354 continue'); }
        else if (line === 'QUIT') socket.end('221 bye\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('SMTP test listener unavailable');
  return { port: address.port, entered, release, stats: () => ({ connections, closed, accepted }), close: async () => {
    release();
    for (const timer of timers) clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  } };
}

describe('SMTP concurrency and absolute deadline', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: RecoveryMailService;
  let recovery: EmailRecoveryService;
  let organizationId: string;
  const original = { ...process.env };
  beforeAll(async () => {
    process.env.QMS_SECURITY_CURRENT_KEY_ID = 'delivery-test';
    process.env.QMS_SECURITY_KEYRING = JSON.stringify({ 'delivery-test': randomBytes(32).toString('base64') });
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_FROM = 'qms@example.test';
    process.env.SMTP_SECURE = 'false';
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    mail = app.get(RecoveryMailService);
    recovery = app.get(EmailRecoveryService);
    organizationId = (await prisma.organization.create({ data: { code: randomUUID(), name: 'SMTP concurrency', type: 'INTERNAL' } })).id;
  });
  afterAll(async () => {
    if (organizationId) {
      await prisma.auditEvent.deleteMany({ where: { organizationId } });
      await prisma.user.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await app?.close();
    process.env = original;
  });
  async function queued() {
    const id = randomUUID();
    const user = await prisma.user.create({ data: { organizationId, username: id, email: `${id}@example.test`, emailVerifiedAt: new Date(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    await recovery.requestRecovery({ identifier: user.email! }, randomUUID());
    const delivery = await prisma.recoveryDelivery.findFirstOrThrow({ where: { verification: { userId: user.id } } });
    return { user, delivery };
  }

  it.each(['email', 'status', 'securityVersion', 'organization'])('linearizes %s mutation after an already sending message', async (kind) => {
    const smtp = await smtpServer({ gate: true });
    process.env.SMTP_PORT = String(smtp.port);
    const { user, delivery } = await queued();
    let dispatch: Promise<unknown> | undefined;
    let mutation: Promise<unknown> | undefined;
    try {
      dispatch = mail.dispatchPending(1);
      await smtp.entered;
      expect(await prisma.recoveryDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({ status: 'PROCESSING', attempts: 1 });
      let changed = false;
      mutation = (kind === 'organization'
        ? prisma.organization.update({ where: { id: organizationId }, data: { status: 'DISABLED' } })
        : prisma.user.update({ where: { id: user.id }, data: kind === 'email' ? { email: `${randomUUID()}@example.test` } : kind === 'status' ? { status: 'DISABLED' } : { securityVersion: { increment: 1 } } })).then(() => { changed = true; });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(changed).toBe(false);
      smtp.release();
      await dispatch;
      await mutation;
      expect((await prisma.recoveryDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe('SENT');
      expect(smtp.stats().accepted).toBe(1);
    } finally {
      smtp.release();
      await Promise.allSettled([dispatch, mutation]);
      if (kind === 'organization') await prisma.organization.update({ where: { id: organizationId }, data: { status: 'ACTIVE' } });
      await smtp.close();
    }
  });

  it('destroys a slow multi-stage SMTP socket before the transaction deadline and persists its attempt', async () => {
    const smtp = await smtpServer({ delay: 2800 });
    process.env.SMTP_PORT = String(smtp.port);
    const { delivery } = await queued();
    try {
      const started = Date.now();
      await Promise.all([mail.dispatchPending(1), mail.dispatchPending(1)]);
      expect(Date.now() - started).toBeLessThan(11000);
      const actual = await prisma.recoveryDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(actual).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'MAIL_DELIVERY_FAILED' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(smtp.stats()).toMatchObject({ connections: 1, closed: 1, accepted: 0 });
    } finally { await smtp.close(); }
  }, 30000);

  it('bounds parallel-worker SMTP attempts to five', async () => {
    const smtp = await smtpServer({ reject: true });
    process.env.SMTP_PORT = String(smtp.port);
    const { delivery } = await queued();
    try {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await prisma.recoveryDelivery.update({ where: { id: delivery.id }, data: { availableAt: new Date(Date.now() - 1000) } });
        await Promise.all([mail.dispatchPending(1), mail.dispatchPending(1), mail.dispatchPending(1)]);
      }
      expect(await prisma.recoveryDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({ status: 'FAILED', attempts: 5, encryptedPayload: null });
      expect(smtp.stats().connections).toBe(5);
    } finally { await smtp.close(); }
  });

  it('recovers expired claims without resetting durable attempts', async () => {
    const smtp = await smtpServer({ reject: true });
    process.env.SMTP_PORT = String(smtp.port);
    const { delivery } = await queued();
    try {
      await prisma.recoveryDelivery.update({ where: { id: delivery.id }, data: { status: 'PROCESSING', processingAt: new Date(Date.now() - 61000), claimId: randomUUID(), attempts: 4 } });
      await Promise.all([mail.dispatchPending(1), mail.dispatchPending(1)]);
      expect(await prisma.recoveryDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({ status: 'FAILED', attempts: 5, encryptedPayload: null, claimId: null, processingAt: null });
      const exhausted = await queued();
      await prisma.recoveryDelivery.update({ where: { id: exhausted.delivery.id }, data: { status: 'PROCESSING', processingAt: new Date(Date.now() - 61000), claimId: randomUUID(), attempts: 5 } });
      await Promise.all([mail.dispatchPending(1), mail.dispatchPending(1)]);
      expect(await prisma.recoveryDelivery.findUniqueOrThrow({ where: { id: exhausted.delivery.id } })).toMatchObject({ status: 'FAILED', attempts: 5, encryptedPayload: null });
      expect(smtp.stats().connections).toBe(1);
    } finally { await smtp.close(); }
  });

  it('fails closed when implicit TLS or production STARTTLS cannot be established', async () => {
    const smtp = await smtpServer();
    process.env.SMTP_PORT = String(smtp.port);
    try {
      const implicit = await queued();
      process.env.SMTP_SECURE = 'true';
      await mail.dispatchPending(1);
      expect(await prisma.recoveryDelivery.findUniqueOrThrow({ where: { id: implicit.delivery.id } })).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'MAIL_DELIVERY_FAILED' });
      process.env.SMTP_SECURE = 'false';
      process.env.NODE_ENV = 'production';
      const starttls = await queued();
      await mail.dispatchPending(1);
      expect(await prisma.recoveryDelivery.findUniqueOrThrow({ where: { id: starttls.delivery.id } })).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'MAIL_DELIVERY_FAILED' });
      expect(smtp.stats().accepted).toBe(0);
    } finally {
      if (original.NODE_ENV === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original.NODE_ENV;
      process.env.SMTP_SECURE = 'false';
      await smtp.close();
    }
  }, 20000);
});
