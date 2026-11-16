import { normalizeProcessDefectFacts as currentNormalizer } from '../../src/modules/process-quality/process-defect-ledger.service.js';

const normalizeProcessDefectFacts = currentNormalizer as (input: Record<string, unknown>, mode?: 'MANUAL' | 'UPDATE' | 'IMS') => Record<string, unknown>;

describe('process defect registration facts', () => {
  const valid = () => ({ occurredAt: new Date('2026-11-16T00:30:00Z'), productCode: '00001', traceCode: 'TRACE', description: '不良' });

  it('defaults new manual registration quantity to one', () => {
    expect(normalizeProcessDefectFacts(valid(), 'MANUAL').defectQuantity).toBe(1);
  });

  it.each(['occurredAt', 'productCode', 'traceCode', 'description'] as const)('requires manual %s', field => {
    expect(() => normalizeProcessDefectFacts({ ...valid(), [field]: undefined }, 'MANUAL')).toThrow();
  });

  it.each([0, -1, 1.5, 2147483648])('rejects invalid quantity %s', defectQuantity => {
    expect(() => normalizeProcessDefectFacts({ ...valid(), defectQuantity }, 'MANUAL')).toThrow();
  });

  it('preserves unknown quantity for existing records and separate name/code values', () => {
    const value = normalizeProcessDefectFacts({ description: '', defectQuantity: null, lineCode: '01', lineName: '一线', operationName: '  装配  ' }, 'UPDATE');
    expect(value).toMatchObject({ defectQuantity: null, productCode: null, lineCode: '01', lineName: '一线', operationCode: null, operationName: '装配' });
  });

  it.each([
    ['2026-11-16T00:29:59Z', 'NIGHT'], ['2026-11-16T00:30:00Z', 'DAY'],
    ['2026-11-16T12:29:59Z', 'DAY'], ['2026-11-16T12:30:00Z', 'NIGHT'],
    ['2026-11-16T08:30:00+08:00', 'DAY'],
  ])('derives Beijing shift from %s', (time, shift) => {
    expect(normalizeProcessDefectFacts({ ...valid(), occurredAt: new Date(time) }, 'MANUAL').shift).toBe(shift);
  });

  it('accepts IMS missing facts and rejects only invalid supplied facts at this normalized boundary', () => {
    expect(normalizeProcessDefectFacts({ externalSourceSystem: 'IMS' }, 'IMS')).toMatchObject({ defectQuantity: 1, occurredAt: null, shift: null });
  });
});
