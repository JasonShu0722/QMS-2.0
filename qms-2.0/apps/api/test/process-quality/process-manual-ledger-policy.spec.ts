import 'reflect-metadata';
import * as ledger from '../../src/modules/process-quality/process-defect-ledger.service.js';

describe('manual process ledger normalization', () => {
  it('retains unknown facts as null rather than manufacturing quantities, dates or categories', () => {
    expect(typeof ledger.normalizeProcessDefectFacts).toBe('function');
    expect(ledger.normalizeProcessDefectFacts({})).toMatchObject({ description: '', defectTypeCode: null, defectQuantity: null, occurredAt: null, responsibilityCategory: null });
    expect(ledger.normalizeProcessDefectFacts({ responsibilityCategory: 'FALSE_POSITIVE' }).responsibilityCategory).toBe('FALSE_POSITIVE');
  });

  it('rejects malformed facts even for non-HTTP consumers', () => {
    expect(typeof ledger.normalizeProcessDefectFacts).toBe('function');
    for (const body of [{ description: null }, { description: 2 }, { defectQuantity: 0 }, { defectQuantity: -1 }, { defectQuantity: 1.5 }, { defectQuantity: 2147483648 }, { occurredAt: new Date('invalid') }, { occurredAt: '2026-10-25' }, { responsibilityCategory: 'UNKNOWN' }, { operationCode: 2 }]) {
      expect(() => ledger.normalizeProcessDefectFacts(body as never)).toThrow();
    }
  });

  it('does not persist empty UI groups, flatten multiple groups, or accept forged SQE conclusions', () => {
    expect(typeof ledger.normalizeProcessDefectMaterials).toBe('function');
    expect(ledger.normalizeProcessDefectMaterials([{}, { materialCode: '   ', notes: '' }])).toEqual([]);
    const items = ledger.normalizeProcessDefectMaterials([{ materialCode: ' M1 ', materialBatch: ' B1 ' }, { materialName: 'Part two', notes: 'unknown supplier' }]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ materialCode: 'M1', materialBatch: 'B1', sqeUserId: null });
    for (const input of [[null], [{ verification: 'CONFIRMED_DEFECT' }], [{ materialCode: 123 }], [{ sqeUserId: 'free text' }]]) expect(() => ledger.normalizeProcessDefectMaterials(input as never)).toThrow();
  });
});
