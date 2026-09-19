import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { NeutralDomainAdapter } from '../fixtures/neutral-domain.adapter.js';

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
  const createdProblemIds: string[] = [];
  const cleanupOrganizationIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    const [server] = await prisma.$queryRaw<{ server_version_num: string }[]>`SHOW server_version_num`;
    expect(Number(server!.server_version_num)).toBeGreaterThanOrEqual(180000);
    organizationId = randomUUID();
    cleanupOrganizationIds.push(organizationId);
    await prisma.organization.create({
      data: { id: organizationId, code: `PI-${organizationId.slice(0, 8)}`, name: 'Problem index integration', type: 'INTERNAL' },
    });
    await numbering.publishRuleVersion({ organizationId, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}' });
  });

  afterAll(async () => {
    if (createdProblemIds.length > 0) {
      await prisma.outboxEvent.deleteMany({ where: { aggregateType: 'ProblemIndex', aggregateId: { in: createdProblemIds } } });
      await prisma.auditEvent.deleteMany({ where: { resourceId: { in: createdProblemIds } } });
    }
    for (const id of cleanupOrganizationIds.reverse()) {
      await prisma.problemIndex.deleteMany({ where: { organizationId: id } });
      await prisma.numberSequence.deleteMany({ where: { organizationId: id } });
      await prisma.numberRuleVersion.deleteMany({ where: { organizationId: id } });
      await prisma.organization.delete({ where: { id } });
    }
    await prisma.$disconnect();
  });

  it('commits an index transaction and makes source creation idempotent', async () => {
    const sourceId = randomUUID();
    const traceId = randomUUID();
    const first = await prisma.$transaction((tx) => service.createFromDomain(tx as never, {
      organizationId, domainCode: 'neutral-test', problemType: 'DEMO', sourceType: 'neutral-test', sourceId,
      severity: 'LOW', traceId,
    }));
    problemId = String(first.id);
    createdProblemIds.push(problemId);
    expect(first.reportNumber).toMatch(/^NEUTRAL-TEST-\d{4}-\d{3}$/);

    const second = await prisma.$transaction((tx) => service.createFromDomain(tx as never, {
      organizationId, domainCode: 'neutral-test', problemType: 'DEMO', sourceType: 'neutral-test', sourceId,
      severity: 'LOW',
    }));
    expect(second.id).toBe(first.id);
    expect(await prisma.problemIndex.count({ where: { organizationId, sourceId } })).toBe(1);
    const auditEvent = await prisma.auditEvent.findFirstOrThrow({ where: { resourceId: problemId, action: 'PROBLEM_INDEX_CREATED' } });
    expect(auditEvent.traceId).toBe(traceId);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: problemId, eventType: 'PROBLEM_INDEX_CREATED' } })).toBe(1);
  });

  it('creates a real problem through the neutral adapter with only thin shared fields', async () => {
    const result = await new NeutralDomainAdapter(prisma, service).createProblem({
      organizationId,
      sourceId: randomUUID(),
      problemType: 'NEUTRAL_DEMO',
      severity: 'LOW',
    });
    const resultId = String(result.id);
    createdProblemIds.push(resultId);
    expect(result).toEqual(expect.objectContaining({
      organizationId,
      domainCode: 'neutral-test',
      problemType: 'NEUTRAL_DEMO',
      sourceType: 'neutral-test',
      severity: 'LOW',
      status: 'OPEN',
      version: 1,
    }));
    expect(result).not.toHaveProperty('supplierCode');
    expect(result).not.toHaveProperty('customerCode');
  });

  it('does not disclose a problem when the requested organization does not own it', async () => {
    await expect(service.findById(problemId, randomUUID())).rejects.toThrow('PROBLEM_INDEX_NOT_FOUND');
  });

  it('rolls back the problem, number sequence, audit and outbox when audit writing fails', async () => {
    const rollbackOrganizationId = randomUUID();
    cleanupOrganizationIds.push(rollbackOrganizationId);
    await prisma.organization.create({
      data: { id: rollbackOrganizationId, code: `PI-${rollbackOrganizationId.slice(0, 8)}`, name: 'Audit rollback', type: 'INTERNAL' },
    });
    await numbering.publishRuleVersion({ organizationId: rollbackOrganizationId, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}' });
    const outboxBefore = await prisma.outboxEvent.count({ where: { aggregateType: 'ProblemIndex' } });
    const failingAudit = { record: async () => { throw new Error('AUDIT_WRITE_FAILED'); } };
    const failingService = new ProblemIndexService(prisma, numbering, failingAudit as never, outbox);
    const sourceId = randomUUID();
    await expect(prisma.$transaction((tx) => failingService.createFromDomain(tx as never, {
      organizationId: rollbackOrganizationId, domainCode: 'neutral-test', problemType: 'AUDIT_FAIL', sourceType: 'neutral-test', sourceId,
      severity: 'LOW',
    }))).rejects.toThrow('AUDIT_WRITE_FAILED');
    expect(await prisma.problemIndex.count({ where: { organizationId: rollbackOrganizationId } })).toBe(0);
    expect(await prisma.numberSequence.count({ where: { organizationId: rollbackOrganizationId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { organizationId: rollbackOrganizationId } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { aggregateType: 'ProblemIndex' } })).toBe(outboxBefore);
  });

  it('rolls back the problem, number sequence, audit and outbox when outbox writing fails', async () => {
    const rollbackOrganizationId = randomUUID();
    cleanupOrganizationIds.push(rollbackOrganizationId);
    await prisma.organization.create({
      data: { id: rollbackOrganizationId, code: `PI-${rollbackOrganizationId.slice(0, 8)}`, name: 'Outbox rollback', type: 'INTERNAL' },
    });
    await numbering.publishRuleVersion({ organizationId: rollbackOrganizationId, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}' });
    const outboxBefore = await prisma.outboxEvent.count({ where: { aggregateType: 'ProblemIndex' } });
    const failingOutbox = { enqueue: async () => { throw new Error('OUTBOX_WRITE_FAILED'); } };
    const failingService = new ProblemIndexService(prisma, numbering, audit, failingOutbox as never);
    const sourceId = randomUUID();
    await expect(prisma.$transaction((tx) => failingService.createFromDomain(tx as never, {
      organizationId: rollbackOrganizationId, domainCode: 'neutral-test', problemType: 'OUTBOX_FAIL', sourceType: 'neutral-test', sourceId,
      severity: 'LOW',
    }))).rejects.toThrow('OUTBOX_WRITE_FAILED');
    expect(await prisma.problemIndex.count({ where: { organizationId: rollbackOrganizationId } })).toBe(0);
    expect(await prisma.numberSequence.count({ where: { organizationId: rollbackOrganizationId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { organizationId: rollbackOrganizationId } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { aggregateType: 'ProblemIndex' } })).toBe(outboxBefore);
  });
});
