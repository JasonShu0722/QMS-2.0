import { calculateAuditDueDate } from '../../src/modules/audit-management/audit-deadline.js';

describe('audit NC business-day deadline', () => {
  const calendar = {
    timeZone: 'Asia/Shanghai',
    workingWeekdays: [1, 2, 3, 4, 5],
    exceptions: { '2026-10-01': false, '2026-10-03': true },
  };

  it('uses the persisted timezone and holiday/makeup-day calendar', () => {
    expect(calculateAuditDueDate(new Date('2026-09-30T10:00:00.000Z'), 2, calendar)).toBe('2026-10-03');
  });

  it('starts on the next working day and crosses a year boundary', () => {
    expect(calculateAuditDueDate(new Date('2026-12-31T10:00:00.000Z'), 1, { ...calendar, exceptions: {} })).toBe('2027-01-01');
  });

  it('rejects an invalid timezone or insufficient calendar coverage', () => {
    expect(() => calculateAuditDueDate(new Date('2026-09-30T10:00:00.000Z'), 1, { ...calendar, timeZone: 'Fake/Zone' })).toThrow();
    expect(() => calculateAuditDueDate(new Date('2026-09-30T10:00:00.000Z'), 1, { ...calendar, workingWeekdays: [] })).toThrow();
  });
});
