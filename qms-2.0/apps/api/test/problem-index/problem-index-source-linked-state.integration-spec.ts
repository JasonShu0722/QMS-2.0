import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Disposable PostgreSQL is required');

describe('public source-linked problem state on PostgreSQL', () => {
  const prisma = new PrismaService();
  const service = new ProblemIndexService(prisma, new NumberingService(prisma), new AuditLogService(prisma), new OutboxService(prisma));
  const domainCode = 'new-product-quality', sourceType = 'new-product-defect-selection';
  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  it('reads only current links or primary in the same transaction, organization, domain and source type without duplicate problems', async () => {
    const org = await prisma.organization.create({ data: { code: randomUUID(), name: 'Source state', type: 'INTERNAL' } });
    const otherOrg = await prisma.organization.create({ data: { code: randomUUID(), name: 'Other source state', type: 'INTERNAL' } });
    const [first, second, removed, primary, irrelevant] = Array.from({ length: 5 }, () => randomUUID()) as [string, string, string, string, string];
    const create = (organizationId = org.id, domain = domainCode, type = sourceType, sourceId = irrelevant) => prisma.problemIndex.create({ data: {
      organizationId, domainCode: domain, sourceType: type, sourceId, reportNumber: randomUUID(), problemType: 'NEW_PRODUCT_ISSUE', severity: 'LOW' } });
    const linked = await create(org.id, domainCode, sourceType, first), primaryOnly = await create(org.id, domainCode, sourceType, primary), removedOnly = await create(org.id, domainCode, sourceType, removed);
    const wrongDomain = await create(org.id, 'process-quality'), wrongType = await create(org.id, domainCode, 'new-product-issue'), foreign = await create(otherOrg.id);
    for (const [problem, sourceId, removedAt] of [
      [linked, first, null], [linked, second, null], [removedOnly, removed, new Date()],
      [wrongDomain, first, null], [wrongType, first, null], [foreign, first, null],
    ] as const) await prisma.domainSourceIssueLink.create({ data: { organizationId: problem.organizationId, problemIndexId: problem.id, sourceDomain: domainCode,
      sourceType, sourceId, sourceVersion: 1, sourceSnapshot: { private: 'Must not be returned' }, createdBy: 'test', removedAt } });
    // The cast lets the initial RED exercise a missing public method rather than fail TypeScript compilation.
    const reader = service as unknown as { readSourceLinkedStates: (tx: Prisma.TransactionClient, input: {
      organizationId: string; domainCode: string; sourceType: string; sourceIds: string[];
    }) => Promise<Record<string, unknown>[]> };
    expect(typeof reader.readSourceLinkedStates).toBe('function');
    const input = { organizationId: org.id, domainCode, sourceType, sourceIds: [first, second, removed, primary, first] };
    const states = await prisma.$transaction(async tx => {
      await tx.problemIndex.update({ where: { id: linked.id }, data: { status: 'PENDING', version: { increment: 1 } } });
      return reader.readSourceLinkedStates(tx, input);
    });
    expect(states).toHaveLength(2);
    expect(states).toEqual(expect.arrayContaining([
      { problemId: linked.id, reportNumber: linked.reportNumber, status: 'PENDING', severity: 'LOW', problemVersion: 2,
        createdAt: linked.createdAt.toISOString(), sourceIds: [first, second].sort() },
      { problemId: primaryOnly.id, reportNumber: primaryOnly.reportNumber, status: 'OPEN', severity: 'LOW', problemVersion: 1,
        createdAt: primaryOnly.createdAt.toISOString(), sourceIds: [primary] },
    ]));
    await prisma.problemIndex.createMany({ data: Array.from({ length: 101 }, () => ({ organizationId: org.id, domainCode, sourceType,
      sourceId: first, reportNumber: randomUUID(), problemType: 'NEW_PRODUCT_ISSUE', severity: 'LOW', status: 'OPEN' as const })) });
    expect(await prisma.$transaction(tx => reader.readSourceLinkedStates(tx, input))).toHaveLength(103);
    expect(await prisma.$transaction(tx => reader.readSourceLinkedStates(tx, { ...input, sourceIds: [] }))).toEqual([]);
    expect(await prisma.$transaction(tx => reader.readSourceLinkedStates(tx, { ...input, domainCode: "x' OR TRUE --" }))).toEqual([]);
    await expect(prisma.$transaction(tx => reader.readSourceLinkedStates(tx, { ...input, sourceIds: ['not-a-uuid'] }))).rejects.toMatchObject({ status: 400 });
  });
});
