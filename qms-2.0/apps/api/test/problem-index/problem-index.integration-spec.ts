import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('PostgreSQL integration requires DATABASE_URL; SQLite fallback is forbidden.');

describe('PostgreSQL problem index transaction', () => {
  const prisma = new PrismaService(databaseUrl);
  const numbering = new NumberingService(prisma);
  const audit = new AuditLogService(prisma as never);
  const outbox = new OutboxService(prisma as never);
  const service = new ProblemIndexService(prisma, numbering, audit, outbox);
  let organizationId: string;
  let problemId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const [server] = await prisma.$queryRaw<{ server_version_num: string }[]>`SHOW server_version_num`;
    expect(Number(server!.server_version_num)).toBeGreaterThanOrEqual(180000);
    organizationId = randomUUID();
    await prisma.organization.create({
      data: { id: organizationId, code: `PI-${organizationId.slice(0, 8)}`, name: 'Problem index integration', type: 'INTERNAL' },
    });
    await numbering.publishRuleVersion({ organizationId, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}' });
  });

  afterAll(async () => {
    if (organizationId) {
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: problemId } });
      await prisma.auditEvent.deleteMany({ where: { resourceId: problemId } });
      await prisma.problemIndex.deleteMany({ where: { organizationId } });
      await prisma.numberSequence.deleteMany({ where: { organizationId } });
      await prisma.numberRuleVersion.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await prisma.$disconnect();
  });

  it('commits an index transaction and makes source creation idempotent', async () => {
    const sourceId = randomUUID();
    const first = await prisma.$transaction((tx) => service.createFromDomain(tx as never, {
      organizationId, domainCode: 'neutral-test', problemType: 'DEMO', sourceType: 'neutral-test', sourceId,
      severity: 'LOW', traceId: randomUUID(),
    }));
    problemId = String(first.id);
    expect(first.reportNumber).toMatch(/^NEUTRAL-TEST-\d{4}-\d{3}$/);

    const second = await prisma.$transaction((tx) => service.createFromDomain(tx as never, {
      organizationId, domainCode: 'neutral-test', problemType: 'DEMO', sourceType: 'neutral-test', sourceId,
      severity: 'LOW',
    }));
    expect(second.id).toBe(first.id);
    expect(await prisma.problemIndex.count({ where: { organizationId, sourceId } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { resourceId: problemId, action: 'PROBLEM_INDEX_CREATED' } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: problemId, eventType: 'PROBLEM_INDEX_CREATED' } })).toBe(1);
  });
});
