import { auditActionFilter, auditActionLabel } from '../../src/modules/audit-log/audit-event-read-model.js';

describe('internal 8D audit labels', () => {
  const actions = ['BINDING_CHANGED', 'ISSUED', 'SAVE', 'ANALYSIS_COMPLETE', 'COLLABORATORS', 'REASSIGN', 'RISK', 'SOURCES',
    'DEADLINES', 'SUBMIT', 'CLOSED', 'DEADLINE_EXTENDED', 'REPORT_READ', 'REPORT_PDF', 'REPORT_REJECTED'];
  it.each([['CUSTOMER', '客户'], ['NEW_PRODUCT', '新品']])('labels and searches %s events without changing process labels', (prefix, name) => {
    for (const action of actions) {
      const code = `${prefix}_EIGHT_D_${action}`;
      const original = auditActionLabel(`PROCESS_EIGHT_D_${action}`);
      expect(auditActionLabel(code)).toBe(original.includes('制程') ? original.replaceAll('制程', name) : `${name}8D：${original}`);
      expect(JSON.stringify(auditActionFilter(name))).toContain(code);
    }
    expect(auditActionLabel(`${prefix}_EIGHT_D_UNKNOWN`)).toBe(`${prefix}_EIGHT_D_UNKNOWN`);
  });
});
