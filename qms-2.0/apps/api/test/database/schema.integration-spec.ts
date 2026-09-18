import { PrismaService } from '../../src/database/prisma.service.js';
import { sanitizeMetadata } from '../../src/common/contracts/error-response.js';
import type { Prisma } from '../../src/generated/prisma/client.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('PostgreSQL integration requires DATABASE_URL; skipping and SQLite fallback are forbidden.');
}

describe('PostgreSQL schema', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService(databaseUrl!);
    await prisma.$connect();
  });
  afterAll(async () => prisma?.$disconnect());

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
