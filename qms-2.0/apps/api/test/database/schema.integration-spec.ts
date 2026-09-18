import { PrismaService } from '../../src/database/prisma.service.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

if (!databaseUrl) {
  console.warn(
    'Skipping PostgreSQL integration test: DATABASE_URL is not configured; SQLite fallback is forbidden.',
  );
}

describeWithDatabase('PostgreSQL schema', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService(databaseUrl!);
    await prisma.$connect();
  });
  afterAll(async () => prisma?.$disconnect());

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
    // The entire fixture is rolled back, including when an assertion fails.
    throw rollback;
    })).rejects.toBe(rollback);
  });
});
