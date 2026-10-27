import { analysisContent, assertAnalysisWriter, assertAnalysisTransfer, faeAnalysisStatus } from '../../src/modules/customer-quality/customer-complaint-analysis.types.js';

describe('customer complaint analysis policy', () => {
  it('counts trimmed FAE text OR verified bound files, not optional facts', () => {
    expect(faeAnalysisStatus(' \n\t ', 0)).toBe('NOT_ANALYSED');
    expect(faeAnalysisStatus(' root cause ', 0)).toBe('ANALYSED');
    expect(faeAnalysisStatus(null, 1)).toBe('ANALYSED');
    expect(analysisContent({ text: ' \t ' }, 'FAE')).toEqual({ text: null, progress: null, result: null, completedOn: null, failedPart: null, failedMaterialCode: null, supplierAnalysisRequired: null, fileIds: [] });
  });
  it('keeps supplier progress/result separate without applying FAE completion', () => {
    expect(analysisContent({ progress: ' waiting ', result: ' checking ' }, 'SUPPLIER')).toMatchObject({ progress: 'waiting', result: 'checking', text: null });
    expect(() => analysisContent({ text: 'overwrite FAE' }, 'SUPPLIER')).toThrow();
    expect(() => analysisContent({ progress: 'overwrite SQE' }, 'FAE')).toThrow();
  });
  it('does not invent a completion date or require extra fields; rejects invalid dates', () => {
    expect(analysisContent({ text: 'done' }, 'FAE').completedOn).toBeNull();
    expect(analysisContent({ completedOn: '2026-02-28' }, 'FAE').completedOn).toBe('2026-02-28');
    expect(() => analysisContent({ completedOn: '2026-02-30' }, 'FAE')).toThrow();
    expect(() => analysisContent({ receivedQuantity: 1 } as never, 'FAE')).toThrow();
    expect(() => analysisContent({ text: 'x'.repeat(10001) }, 'FAE')).toThrow();
  });
  it('only lets the current assignee write and transfer within the current department', () => {
    expect(() => assertAnalysisWriter('old', 'new', true, 'FOLLOWING')).toThrow();
    expect(() => assertAnalysisWriter('new', 'new', false, 'FOLLOWING')).toThrow();
    expect(() => assertAnalysisWriter('new', 'new', true, 'CLOSED')).toThrow();
    expect(() => assertAnalysisWriter('new', 'new', true, 'FOLLOWING')).not.toThrow();
    expect(() => assertAnalysisTransfer('FAE', 'one', 'one')).not.toThrow();
    expect(() => assertAnalysisTransfer('FAE', 'one', 'two')).toThrow();
    expect(() => assertAnalysisTransfer('SUPPLIER', 'one', 'one')).toThrow();
  });
});
