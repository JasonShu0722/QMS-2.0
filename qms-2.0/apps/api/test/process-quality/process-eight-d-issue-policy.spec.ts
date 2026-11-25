import { assertProcessIssueRecurrence, resolveProcessIssueBoard, resolveProcessIssueTitle } from '../../src/modules/process-quality/process-eight-d-policy.js';

describe('formal process 8D issuance', () => {
  it('prefills a common description, permits an edited title and rejects missing mixed-source titles', () => {
    expect(resolveProcessIssueTitle([{ description: '划伤' }, { description: ' 划伤 ' }])).toBe('划伤');
    expect(resolveProcessIssueTitle([{ description: '划伤' }, { description: '缺件' }], ' 产线异常 ')).toBe('产线异常');
    expect(() => resolveProcessIssueTitle([{ description: '划伤' }, { description: '缺件' }])).toThrow('PROCESS_EIGHT_D_TITLE_REQUIRED');
  });
  it('derives a known unanimous board without accepting a conflicting override', () => {
    expect(resolveProcessIssueBoard([{ operationSector: 'PCBA' }, { operationSector: 'PCBA' }])).toBe('0');
    expect(resolveProcessIssueBoard([{ operationSector: '装配' }], '1')).toBe('1');
    expect(() => resolveProcessIssueBoard([{ operationSector: 'PCBA' }], '1')).toThrow('PROCESS_EIGHT_D_BOARD_REQUIRED');
  });

  it.each([
    [{ operationSector: 'PCBA' }, { operationSector: '装配' }],
    [{ operationSector: 'PCBA' }, { operationSector: null }],
    [{ operationSector: '未确认' }],
  ])('requires one explicit choice for mixed or unknown sectors (%j)', (...snapshots) => {
    expect(() => resolveProcessIssueBoard(snapshots)).toThrow('PROCESS_EIGHT_D_BOARD_REQUIRED');
    expect(resolveProcessIssueBoard(snapshots, '1')).toBe('1');
  });

  it('requires every source to agree on a single valid recurrence outcome', () => {
    const first = { defectId: 'source-a', relatedProblemIds: [], recurrence: 'RECURRENCE' as const };
    const second = { ...first, defectId: 'source-b' };
    expect(() => assertProcessIssueRecurrence(2, [first, second])).not.toThrow();
    expect(() => assertProcessIssueRecurrence(2, [first])).toThrow('PROCESS_EIGHT_D_SOURCE_CONFIRMATION_INVALID');
    expect(() => assertProcessIssueRecurrence(2, [first, { ...second, recurrence: 'NOT_RECURRENCE' }])).toThrow('PROCESS_EIGHT_D_SOURCE_CONFIRMATION_INVALID');
  });
});
