import 'reflect-metadata';
import { PrismaService } from '../../src/database/prisma.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('PostgreSQL integration requires DATABASE_URL; SQLite fallback is forbidden.');

describe('PostgreSQL immutable numbering', () => {
  const prisma = new PrismaService(databaseUrl);
  const service = new NumberingService(prisma);
  let organizationId: string;
  let otherOrganizationId: string;
  let ruleCode: string;
  let problemRule: Awaited<ReturnType<NumberingService['publishRuleVersion']>>;

  beforeAll(async () => {
    await prisma.$connect();
    const [version] = await prisma.$queryRaw<{ server_version_num: string }[]>`SHOW server_version_num`;
    expect(Number(version!.server_version_num)).toBeGreaterThanOrEqual(180000);
    organizationId = crypto.randomUUID();
    otherOrganizationId = crypto.randomUUID();
    ruleCode = `TEST_${crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
    await prisma.organization.createMany({ data: [
      { id: organizationId, code: `NUM-${ruleCode}`, name: 'Numbering test', type: 'INTERNAL' },
      { id: otherOrganizationId, code: `OTHER-NUM-${ruleCode}`, name: 'Numbering test without rules', type: 'INTERNAL' },
    ] });
    await service.publishRuleVersion({ organizationId, ruleCode: 'PROBLEM' });
    problemRule = await service.publishRuleVersion({ organizationId, ruleCode: 'PROBLEM', pattern: '{CODE}/{YYMM}/{SEQ3}' });
  });

  afterAll(async () => {
    const organizations = { in: [organizationId, otherOrganizationId] };
    await prisma.numberSequence.deleteMany({ where: { organizationId: organizations } });
    await prisma.numberRuleVersion.deleteMany({ where: { organizationId: organizations } });
    await prisma.organization.deleteMany({ where: { id: organizations } });
    await prisma.$disconnect();
  });

  it('publishes versions and allocates 20 concurrent unique consecutive numbers', async () => {
    const first = await service.publishRuleVersion({ organizationId, ruleCode });
    const second = await service.publishRuleVersion({ organizationId, ruleCode, pattern: '{CODE}/{YYMM}/{SEQ3}' });
    expect(second.version).toBe(first.version + 1);
    const old = await prisma.numberRuleVersion.findUniqueOrThrow({ where: { id: first.id } });
    const allocations = await Promise.all(Array.from({ length: 20 }, () => prisma.$transaction((tx) =>
      service.allocateReportNumber(tx, { organizationId, ruleCode, classificationCode: 'QA', at: new Date('2026-09-18T00:00:00.000Z') }))));

    expect(new Set(allocations.map((value) => value.reportNumber)).size).toBe(20);
    expect(allocations.every((value) => value.ruleVersionId === second.id)).toBe(true);
    expect(allocations.map((value) => value.sequence).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(allocations[0]!.reportNumber).toMatch(/^QA\/2609\/\d{3}$/);

    const historical = await prisma.$transaction((tx) => service.allocateReportNumber(tx, {
      organizationId, ruleCode, classificationCode: 'QA', ruleVersionId: old.id, at: new Date('2026-09-18T00:00:00.000Z'),
    }));
    expect(historical.reportNumber).toMatch(/^QA-2609-021$/);
    expect(historical.ruleVersionId).toBe(old.id);
  });

  it('rejects explicit versions from another organization or rule code', async () => {
    const current = await prisma.numberRuleVersion.findFirstOrThrow({
      where: { organizationId, ruleCode },
      orderBy: { version: 'desc' },
    });

    await expect(prisma.$transaction((tx) => service.allocateReportNumber(tx, {
      organizationId: crypto.randomUUID(),
      ruleCode,
      classificationCode: 'QA',
      ruleVersionId: current.id,
    }))).rejects.toThrow('NUMBER_RULE_NOT_FOUND');

    await expect(prisma.$transaction((tx) => service.allocateReportNumber(tx, {
      organizationId,
      ruleCode: 'OTHER',
      classificationCode: 'QA',
      ruleVersionId: current.id,
    }))).rejects.toThrow('NUMBER_RULE_NOT_FOUND');
  });

  it('publishes concurrent versions as a unique monotonic sequence', async () => {
    const concurrentRuleCode = `CONC_${crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
    const published = await Promise.all(Array.from({ length: 12 }, () => service.publishRuleVersion({
      organizationId,
      ruleCode: concurrentRuleCode,
    })));
    const versions = published.map((value) => value.version).sort((left, right) => left - right);

    expect(versions).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(new Set(published.map((value) => value.id)).size).toBe(12);
    expect(await prisma.numberRuleVersion.count({ where: { organizationId, ruleCode: concurrentRuleCode, active: true } })).toBe(1);
    expect((await prisma.numberRuleVersion.findFirstOrThrow({
      where: { organizationId, ruleCode: concurrentRuleCode, active: true },
    })).version).toBe(12);
  });

  it('rolls sequence allocation back with the caller transaction', async () => {
    await expect(prisma.$transaction(async (tx) => {
      await service.allocateReportNumber(tx, { organizationId, ruleCode, classificationCode: 'QA', at: new Date('2026-09-18T00:00:00.000Z') });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    const next = await prisma.$transaction((tx) => service.allocateReportNumber(tx, { organizationId, ruleCode, classificationCode: 'QA', at: new Date('2026-09-18T00:00:00.000Z') }));
    expect(next.sequence).toBe(22);
  });

  it('returns a stable overflow error without incrementing the sequence', async () => {
    await prisma.numberSequence.upsert({
      where: { organizationId_ruleCode_scopeKey: { organizationId, ruleCode, scopeKey: 'OV:2609' } },
      update: { nextValue: 1000n },
      create: { organizationId, ruleCode, scopeKey: 'OV:2609', nextValue: 1000n },
    });
    await expect(prisma.$transaction((tx) => service.allocateReportNumber(tx, {
      organizationId, ruleCode, classificationCode: 'OV', at: new Date('2026-09-18T00:00:00.000Z'),
    }))).rejects.toThrow('NUMBER_SEQUENCE_EXHAUSTED');
    const sequence = await prisma.numberSequence.findUnique({ where: { organizationId_ruleCode_scopeKey: { organizationId, ruleCode, scopeKey: 'OV:2609' } } });
    expect(sequence?.nextValue).toBe(1000n);
  });

  it('allocates one concurrent process 8D sequence across both boards, separate from generic PROBLEM numbers', async () => {
    const at = new Date('2026-11-25T00:00:00.000Z');
    const allocateGeneric = () => prisma.$transaction((tx) => service.allocateReportNumber(tx, {
      organizationId, ruleCode: 'PROBLEM', classificationCode: 'PROCESS_EIGHT_D', at,
    }));
    expect(await allocateGeneric()).toEqual({
      reportNumber: 'PROCESS_EIGHT_D/2611/001', ruleVersionId: problemRule.id, ruleVersion: problemRule.version, sequence: 1,
    });

    const allocations = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
      const boardCode = index % 2 === 0 ? '0' : '1';
      const number = await prisma.$transaction((tx) => service.allocateProcessEightDReportNumber(tx, {
        organizationId, boardCode, at,
      }));
      expect(number).toEqual({
        reportNumber: `ZX8D-PQ${boardCode}-2611-${String(number.sequence).padStart(3, '0')}`,
        sequence: number.sequence,
      });
      return number.sequence;
    }));

    expect(allocations.sort((left, right) => left - right)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect((await allocateGeneric()).reportNumber).toBe('PROCESS_EIGHT_D/2611/002');
  });

  it('resets process 8D numbering at Beijing midnight while generic numbering stays in the UTC month', async () => {
    const beforeMidnight = new Date('2026-12-31T15:59:59.999Z');
    const atMidnight = new Date('2026-12-31T16:00:00.000Z');
    const allocateGeneric = (at: Date) => prisma.$transaction((tx) => service.allocateReportNumber(tx, {
      organizationId, ruleCode: 'PROBLEM', classificationCode: 'UTC-BOUNDARY', at,
    }));
    const before = await prisma.$transaction((tx) => service.allocateProcessEightDReportNumber(tx, {
      organizationId, boardCode: '0', at: beforeMidnight,
    }));
    const after = await prisma.$transaction((tx) => service.allocateProcessEightDReportNumber(tx, {
      organizationId, boardCode: '1', at: atMidnight,
    }));

    expect(before.reportNumber).toBe('ZX8D-PQ0-2612-001');
    expect(after.reportNumber).toBe('ZX8D-PQ1-2701-001');
    expect((await allocateGeneric(beforeMidnight)).reportNumber).toBe('UTC-BOUNDARY/2612/001');
    expect((await allocateGeneric(atMidnight)).reportNumber).toBe('UTC-BOUNDARY/2612/002');
  });

  it('starts each organization at 001 even when an organization has no numbering rules', async () => {
    const at = new Date('2026-09-18T00:00:00.000Z');
    const allocate = (id: string) => prisma.$transaction((tx) => service.allocateProcessEightDReportNumber(tx, {
      organizationId: id, boardCode: '0', at,
    }));

    expect((await allocate(organizationId)).sequence).toBe(1);
    expect(await allocate(otherOrganizationId)).toEqual({ reportNumber: 'ZX8D-PQ0-2609-001', sequence: 1 });
    expect(await allocate(organizationId)).toEqual({ reportNumber: 'ZX8D-PQ0-2609-002', sequence: 2 });
  });

  it('rolls back process 8D allocation and exhausts the shared counter after 999', async () => {
    const at = new Date('2026-10-18T00:00:00.000Z');
    const allocatePcba = () => prisma.$transaction((tx) => service.allocateProcessEightDReportNumber(tx, {
      organizationId, boardCode: '0', at,
    }));
    expect((await allocatePcba()).sequence).toBe(1);
    const where = { organizationId_ruleCode_scopeKey: { organizationId, ruleCode: 'PROCESS_EIGHT_D', scopeKey: '2610' } };
    await prisma.numberSequence.update({ where, data: { nextValue: 999n } });

    await expect(prisma.$transaction(async (tx) => {
      await service.allocateProcessEightDReportNumber(tx, { organizationId, boardCode: '0', at });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');

    const last = await prisma.$transaction((tx) => service.allocateProcessEightDReportNumber(tx, {
      organizationId, boardCode: '1', at,
    }));
    expect(last.reportNumber).toBe('ZX8D-PQ1-2610-999');
    await expect(allocatePcba()).rejects.toThrow('NUMBER_SEQUENCE_EXHAUSTED');
    expect((await prisma.numberSequence.findUniqueOrThrow({ where })).nextValue).toBe(1000n);
  });
});
