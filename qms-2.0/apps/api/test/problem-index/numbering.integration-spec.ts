import 'reflect-metadata';
import { PrismaService } from '../../src/database/prisma.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('PostgreSQL integration requires DATABASE_URL; SQLite fallback is forbidden.');

describe('PostgreSQL immutable numbering', () => {
  const prisma = new PrismaService(databaseUrl);
  const service = new NumberingService(prisma);
  let organizationId: string;
  let ruleCode: string;

  beforeAll(async () => {
    await prisma.$connect();
    const [version] = await prisma.$queryRaw<{ server_version_num: string }[]>`SHOW server_version_num`;
    expect(Number(version!.server_version_num)).toBeGreaterThanOrEqual(180000);
    organizationId = crypto.randomUUID();
    ruleCode = `TEST_${crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
    await prisma.organization.create({ data: { id: organizationId, code: `NUM-${ruleCode}`, name: 'Numbering test', type: 'INTERNAL' } });
  });

  afterAll(async () => {
    await prisma.numberSequence.deleteMany({ where: { organizationId } });
    await prisma.numberRuleVersion.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
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

  it('rolls sequence allocation back with the caller transaction', async () => {
    await expect(prisma.$transaction(async (tx) => {
      await service.allocateReportNumber(tx, { organizationId, ruleCode, classificationCode: 'QA' });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    const next = await prisma.$transaction((tx) => service.allocateReportNumber(tx, { organizationId, ruleCode, classificationCode: 'QA' }));
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
});
