import { jest } from '@jest/globals';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';

describe('NumberingService', () => {
  it('allocates a stable classification, YYMM and three-digit sequence', async () => {
    const service = new NumberingService({} as never);
    const tx = {
      numberRuleVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'rule-1',
          version: 1,
          pattern: '{CODE}-{YYMM}-{SEQ3}',
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ allocated: 7n }]),
    };

    await expect(service.allocateReportNumber(tx as never, {
      organizationId: 'org-1',
      ruleCode: 'PROBLEM',
      classificationCode: 'QA',
      at: new Date('2026-09-18T00:00:00.000Z'),
    })).resolves.toEqual({
      reportNumber: 'QA-2609-007',
      ruleVersionId: 'rule-1',
      ruleVersion: 1,
      sequence: 7,
    });
  });

  it('rejects an invalid classification code and an exhausted sequence', async () => {
    const service = new NumberingService({} as never);
    await expect(service.allocateReportNumber({} as never, {
      organizationId: 'org-1', ruleCode: 'PROBLEM', classificationCode: 'bad',
    })).rejects.toThrow('NUMBER_CLASSIFICATION_INVALID');

    const tx = {
      numberRuleVersion: { findFirst: jest.fn().mockResolvedValue({ id: 'rule-1', version: 1, pattern: '{CODE}-{YYMM}-{SEQ3}' }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    await expect(service.allocateReportNumber(tx as never, {
      organizationId: 'org-1', ruleCode: 'PROBLEM', classificationCode: 'QA',
    })).rejects.toThrow('NUMBER_SEQUENCE_EXHAUSTED');
  });

  it('keeps a generated number immutable', () => {
    const service = new NumberingService({} as never);
    expect(() => service.assertImmutable('QA-2609-001', 'QA-2609-001')).not.toThrow();
    expect(() => service.assertImmutable('QA-2609-001', 'QA-2609-002')).toThrow('NUMBER_IMMUTABLE');
  });

  it('scopes an explicit rule version to the requested organization and rule code', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const tx = {
      numberRuleVersion: { findFirst },
      $queryRaw: jest.fn(),
    };
    const service = new NumberingService({} as never);

    await expect(service.allocateReportNumber(tx as never, {
      organizationId: 'org-2',
      ruleCode: 'PROBLEM',
      classificationCode: 'QA',
      ruleVersionId: 'rule-1',
    })).rejects.toThrow('NUMBER_RULE_NOT_FOUND');
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'rule-1', organizationId: 'org-2', ruleCode: 'PROBLEM' },
    }));
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('takes a transaction advisory lock before publishing a rule version', async () => {
    const tx = {
      numberRuleVersion: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'rule-1', version: 1, pattern: '{CODE}-{YYMM}-{SEQ3}' }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const service = new NumberingService({
      $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    } as never);

    await service.publishRuleVersion({ organizationId: 'org-1', ruleCode: 'PROBLEM' });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
