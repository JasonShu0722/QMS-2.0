import { normalizeProcessDefectFacts as currentNormalizer } from '../../src/modules/process-quality/process-defect-ledger.service.js';
import { ProcessDefectCompletionService } from '../../src/modules/process-quality/process-defect-completion.service.js';
import type { AdminTransaction } from '../../src/common/security/admin-mutation.service.js';
import type { PrismaService } from '../../src/database/prisma.service.js';
import type { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import type { ProcessDefect } from '../../src/generated/prisma/client.js';

const normalizeProcessDefectFacts = currentNormalizer as (input: Record<string, unknown>, mode?: 'MANUAL' | 'UPDATE' | 'IMS') => Record<string, unknown>;

describe('process defect registration facts', () => {
  const valid = () => ({ occurredAt: new Date('2026-11-16T00:30:00Z'), productCode: '00001', traceCode: 'TRACE', description: '不良', factoryCode: 'FACTORY_1' });

  it('defaults new manual registration quantity to one', () => {
    expect(normalizeProcessDefectFacts(valid(), 'MANUAL').defectQuantity).toBe(1);
  });

  it.each(['occurredAt', 'productCode', 'traceCode', 'description'] as const)('requires manual %s', field => {
    expect(() => normalizeProcessDefectFacts({ ...valid(), [field]: undefined }, 'MANUAL')).toThrow();
  });

  it.each([undefined, null, '', '1', 'FACTORY_3'])('rejects manual factory value %p', factoryCode => {
    expect(() => normalizeProcessDefectFacts({ ...valid(), factoryCode }, 'MANUAL')).toThrow();
  });

  it.each(['FACTORY_1', 'FACTORY_2'])('preserves manual factory %s', factoryCode => {
    expect(normalizeProcessDefectFacts({ ...valid(), factoryCode }, 'MANUAL').factoryCode).toBe(factoryCode);
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
    expect(normalizeProcessDefectFacts({ externalSourceSystem: 'IMS' }, 'IMS')).toMatchObject({ defectQuantity: 1, occurredAt: null, factoryCode: null, shift: null });
  });

  it.each(['factory:EMPTY', 'factory:INVALID'])('retains intake issue %s until factory is corrected', async issue => {
    const completion = new ProcessDefectCompletionService({} as PrismaService, {} as AuditLogService);
    const tx = {} as AdminTransaction;
    const facts = { ...valid(), operationCode: null, operationName: null, factoryCode: null as string | null };
    const previous = { ...facts, registrationIssues: [issue, 'lineName:INVALID'] } as ProcessDefect;
    await expect(completion.derive(tx, 'organization', facts)).resolves.toMatchObject({ registrationIssues: [], pendingCompletion: false });
    await expect(completion.derive(tx, 'organization', facts, previous, ['description'])).resolves.toMatchObject({ registrationIssues: [issue, 'lineName:INVALID'], pendingCompletion: true });
    await expect(completion.derive(tx, 'organization', facts, previous, ['factoryCode'])).resolves.toMatchObject({ registrationIssues: ['lineName:INVALID'], pendingCompletion: true });
    const corrected = { ...facts, factoryCode: 'FACTORY_2' };
    await expect(completion.derive(tx, 'organization', corrected, previous)).resolves.toMatchObject({ registrationIssues: ['lineName:INVALID'], pendingCompletion: true });
  });
});
