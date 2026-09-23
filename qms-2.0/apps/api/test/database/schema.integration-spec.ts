import { PrismaService } from '../../src/database/prisma.service.js';
import { sanitizeMetadata } from '../../src/common/contracts/error-response.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FilePolicyService } from '../../src/modules/file-management/file-policy.service.js';
import { S3CompatibleObjectStorage } from '../../src/modules/file-management/object-storage.service.js';
import { FileResourceAccess } from '../../src/modules/file-management/file-resource-access.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { OutboxWorkerService } from '../../src/modules/task-notification/outbox-worker.service.js';
import 'reflect-metadata';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('PostgreSQL integration requires DATABASE_URL; skipping and SQLite fallback are forbidden.');
}

describe('PostgreSQL schema', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService(databaseUrl!);
    await prisma.$connect();
    const [version] = await prisma.$queryRaw<{ server_version_num: string }[]>`SHOW server_version_num`;
    expect(Number(version!.server_version_num)).toBeGreaterThanOrEqual(180000);
    expect(Number(version!.server_version_num)).toBeLessThan(190000);
  });
  afterAll(async () => prisma?.$disconnect());

  it('audits actual login failures and authorization denials with matching HTTP trace IDs', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    const traceIds: string[] = [];
    const supplier = await prisma.user.findFirstOrThrow({ where: { username: 'local.supplier' } });
    const internal = await prisma.organization.findUniqueOrThrow({ where: { code: 'LOCAL-INTERNAL' } });
    const sessions = app.get(SessionService);
    const token = await sessions.create(supplier.id);
    try {
      const csrf = await request(app.getHttpServer()).get('/api/v1/auth/csrf').expect(200);
      const csrfToken = csrf.body.csrfToken as string;
      for (const identifier of [`acceptance-missing-${crypto.randomUUID()}`, supplier.username]) {
        const rejected = await request(app.getHttpServer()).post('/api/v1/auth/login')
          .set('Cookie', `qms_csrf=${csrfToken}`).set('x-csrf-token', csrfToken)
          .send({ identifier, password: 'acceptance-wrong-password' }).expect(401);
        traceIds.push(rejected.body.traceId);
        const audit = await prisma.auditEvent.findFirstOrThrow({ where: { traceId: rejected.body.traceId } });
        expect(audit).toMatchObject({ action: 'LOGIN_FAILED', outcome: 'FAILURE',
          actorUserId: identifier === supplier.username ? supplier.id : null,
          organizationId: identifier === supplier.username ? supplier.organizationId : null });
        expect(JSON.stringify(audit.metadata)).not.toMatch(/password|cookie|token|acceptance-missing/i);
      }
      const denied = await request(app.getHttpServer())
        .get(`/api/v1/organizations/current?organizationId=${internal.id}`)
        .set('Cookie', `qms_session=${token}`).expect(403);
      traceIds.push(denied.body.traceId);
      const audit = await prisma.auditEvent.findFirstOrThrow({ where: { traceId: denied.body.traceId } });
      expect(audit).toMatchObject({ action: 'ACTION_REJECTED', outcome: 'DENIED',
        actorUserId: supplier.id, organizationId: supplier.organizationId,
        metadata: { permissionCode: 'organization:read', reasonCode: 'ORGANIZATION_SCOPE_DENIED' } });
    } finally {
      await prisma.auditEvent.deleteMany({ where: { traceId: { in: traceIds } } });
      const session = await sessions.resolve(token);
      if (session) await prisma.session.delete({ where: { id: session.id } });
      await app.close();
    }
  });

  it('rolls back session revocation when audit storage fails, then records one successful revocation', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma).compile();
    const sessions = moduleRef.get(SessionService);
    const audit = moduleRef.get(AuditLogService);
    const user = await prisma.user.findFirstOrThrow({ where: { username: 'local.internal' } });
    const token = await sessions.create(user.id, prisma, { mfaVerified: true, reauthenticated: true });
    const session = await sessions.resolve(token);
    const before = await prisma.auditEvent.findMany({ where: { actorUserId: user.id, action: 'SESSION_REVOKED' }, select: { id: true } });
    const failure = jest.spyOn(audit, 'record').mockRejectedValueOnce(new Error('acceptance audit unavailable'));
    try {
      await expect(sessions.revoke(token)).rejects.toThrow('acceptance audit unavailable');
      expect((await prisma.session.findUniqueOrThrow({ where: { id: session!.id } })).revokedAt).toBeNull();
      failure.mockRestore();
      await sessions.revoke(token);
      await expect(sessions.resolve(token)).resolves.toBeNull();
      await sessions.revoke(token);
      const records = await prisma.auditEvent.findMany({ where: {
        actorUserId: user.id, action: 'SESSION_REVOKED', id: { notIn: before.map((entry) => entry.id) },
      } });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ organizationId: user.organizationId, outcome: 'SUCCESS', metadata: {} });
      expect(records[0]!.traceId).toEqual(expect.any(String));
    } finally {
      failure.mockRestore();
      await prisma.auditEvent.deleteMany({ where: {
        actorUserId: user.id, action: 'SESSION_REVOKED', id: { notIn: before.map((entry) => entry.id) },
      } });
      await prisma.session.delete({ where: { id: session!.id } });
      await moduleRef.close();
    }
  });

  it('denies unregistered attachment resources instead of accepting caller scan verdicts', async () => {
    const supplier = await prisma.user.findFirstOrThrow({ where: { username: 'local.supplier' } });
    const files = new FileLifecycleService(prisma as never, new FilePolicyService(),
      new S3CompatibleObjectStorage(), new AuditLogService(prisma as never), new FileResourceAccess([]));
    await expect(files.initializeUpload({ id: supplier.id, organizationId: supplier.organizationId, accountType: 'SUPPLIER', sessionId: crypto.randomUUID() }, {
      resourceType: 'FoundationAttachment', resourceId: crypto.randomUUID(), originalName: 'acceptance.txt', contentType: 'text/plain', sizeBytes: 8, sha256: 'a'.repeat(64),
    }, crypto.randomUUID(), crypto.randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_RESOURCE_DENIED' } });
    expect(files).not.toHaveProperty('markAvailableAfterScan');
  });

  it('rolls back audit and Outbox writes in the caller transaction', async () => {
    const traceId = crypto.randomUUID();
    const eventKey = `acceptance-${traceId}`;
    const rollback = new Error('acceptance rollback');
    await expect(prisma.$transaction(async (transaction) => {
      await new AuditLogService(prisma as never).record({
        action: 'ACTION_REJECTED', resourceType: 'Foundation', outcome: 'DENIED', traceId,
        metadata: { reasonCode: 'ACCEPTANCE', password: 'must-not-persist' },
      }, transaction as never);
      await new OutboxService(prisma as never).enqueue({
        eventKey, aggregateType: 'Foundation', aggregateId: traceId, eventType: 'ACCEPTANCE', payload: {},
      }, transaction as never);
      throw rollback;
    })).rejects.toBe(rollback);
    expect(await prisma.auditEvent.count({ where: { traceId } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { eventKey } })).toBe(0);
  });

  it('retries real PostgreSQL Outbox failures, reaches the limit and recovers manually', async () => {
    const existing = await prisma.outboxEvent.findMany({
      where: { status: { in: ['PENDING', 'PROCESSING'] } },
      select: { availableAt: true, processingAt: true },
    });
    const earliest = Math.min(Date.now(), ...existing.flatMap(({ availableAt, processingAt }) =>
      [availableAt.getTime(), processingAt?.getTime()].filter((value): value is number => value !== undefined)));
    let now = new Date(earliest - 60_000);
    const worker = new OutboxWorkerService(prisma as never, () => now);
    const event = await prisma.outboxEvent.create({ data: {
      eventKey: `acceptance-${crypto.randomUUID()}`, aggregateType: 'Foundation',
      aggregateId: crypto.randomUUID(), eventType: 'ACCEPTANCE', payload: {}, availableAt: now,
    } });
    try {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const result = await worker.processDue(1, async () => { throw new Error('acceptance handler failure'); });
        expect(result).toEqual({ processed: 0, failed: attempt === 5 ? 1 : 0, retried: attempt < 5 ? 1 : 0 });
        const persisted = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
        expect(persisted.attempts).toBe(attempt);
        expect(persisted.status).toBe(attempt === 5 ? 'FAILED' : 'PENDING');
        expect(persisted.lastError).toBe('acceptance handler failure');
        if (attempt < 5) {
          expect(persisted.availableAt.getTime() - now.getTime()).toBe(1000 * 2 ** (attempt - 1));
          expect(await worker.processDue(1, async () => {})).toEqual({ processed: 0, failed: 0, retried: 0 });
          now = persisted.availableAt;
        }
      }
      await worker.retryFailed(event.id);
      const pending = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(pending).toMatchObject({ status: 'PENDING', attempts: 0, lastError: null });
      const handled: string[] = [];
      const results = await Promise.all([worker, new OutboxWorkerService(prisma as never, () => now)]
        .map((processor) => processor.processDue(1, async (claimed) => { handled.push(claimed.id); })));
      expect(handled).toEqual([event.id]);
      expect(results.reduce((total, result) => total + result.processed, 0)).toBe(1);
      expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('PROCESSED');
      await expect(worker.retryFailed(event.id)).rejects.toThrow('OUTBOX_RETRY_REQUIRES_FAILED');
    } finally {
      await prisma.outboxEvent.delete({ where: { id: event.id } });
    }
  });

  it('rejects duplicate global role codes through the partial unique index', async () => {
    const code = `GLOBAL-${crypto.randomUUID()}`;
    await expect(prisma.$transaction(async (tx) => {
      await tx.role.create({ data: { code, name: 'Global role' } });
      await tx.role.create({ data: { code, name: 'Duplicate global role' } });
    })).rejects.toMatchObject({ code: 'P2002' });
  });

  // test:integration runs migrate deploy and the local demo seed before this suite.
  // It requires development mode, a loopback DATABASE_URL, and seed passwords.
  // Missing seed data must fail rather than silently creating a replacement fixture.
  it.each([
    ['INTERNAL', 'local.internal'],
    ['SUPPLIER', 'local.supplier'],
  ] as const)('reads the seeded %s identity and role permissions', async (type, username) => {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { code: `LOCAL-${type}` },
    });
    expect(organization.type).toBe(type);
    const user = await prisma.user.findUniqueOrThrow({
      where: { organizationId_username: { organizationId: organization.id, username } },
      include: { userRoles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });
    expect(user.accountType).toBe(type);
    expect(user.status).toBe('ACTIVE');
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    const assignment = user.userRoles.find(({ role }) => role.code === 'LOCAL_MEMBER');
    expect(assignment).toBeDefined();
    expect(assignment?.organizationId).toBe(organization.id);
    expect(assignment?.role.organizationId).toBe(organization.id);
    expect(assignment?.role.permissions.map(({ permission }) => permission.code)).toContain('workbench:read');
  });

  it('persists the foundation entities in PostgreSQL', async () => {
    const rollback = new Error('integration rollback');
    await expect(prisma.$transaction(async (prisma) => {
    const suffix = crypto.randomUUID();
    const organization = await prisma.organization.create({
      data: {
        code: `INT-${suffix}`,
        name: '集成测试组织',
        type: 'INTERNAL',
      },
    });
    const user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        username: `integration-${suffix}`,
        passwordHash: '$argon2id$integration-test-hash',
        accountType: 'INTERNAL',
      },
    });
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: `sha256:${suffix}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const outbox = await prisma.outboxEvent.create({
      data: {
        eventKey: `integration-${suffix}`,
        aggregateType: 'User',
        aggregateId: user.id,
        eventType: 'foundation.integration-tested',
        payload: { userId: user.id },
      },
    });

    expect(session).not.toHaveProperty('token');
    expect(session.tokenHash).toBe(`sha256:${suffix}`);
    expect(outbox.attempts).toBe(0);
    expect(outbox.lastError).toBeNull();
    const metadata = sanitizeMetadata({
      reason: 'integration verification',
      password: 'sensitive-password-value',
      nested: [{ session_id: 'sensitive-session-value', object_storage_secret_key: 'sensitive-storage-value' }],
    }) as Prisma.InputJsonObject;
    const audit = await prisma.auditEvent.create({
      data: {
        organizationId: organization.id,
        actorUserId: user.id,
        action: 'foundation.integration-tested',
        resourceType: 'User',
        resourceId: user.id,
        outcome: 'SUCCESS',
        traceId: suffix,
        metadata,
      },
    });
    const persistedAudit = await prisma.auditEvent.findUniqueOrThrow({ where: { id: audit.id } });
    expect(persistedAudit.metadata).toEqual({
      reason: 'integration verification',
      password: '[REDACTED]',
      nested: [{ session_id: '[REDACTED]', object_storage_secret_key: '[REDACTED]' }],
    });
    expect(JSON.stringify(persistedAudit.metadata)).not.toContain('sensitive-');
    // The entire fixture is rolled back, including when an assertion fails.
    throw rollback;
    })).rejects.toBe(rollback);
  });
});
