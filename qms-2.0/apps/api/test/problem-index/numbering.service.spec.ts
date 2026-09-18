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
});
