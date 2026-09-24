export interface AuditBusinessCalendar {
  timeZone: string;
  workingWeekdays: number[];
  exceptions: Record<string, boolean>;
}

export function calculateAuditDueDate(startedAt: Date, businessDays: number, calendar: AuditBusinessCalendar): string {
  if (!Number.isInteger(businessDays) || businessDays < 1 || businessDays > 366
    || !Array.isArray(calendar.workingWeekdays) || calendar.workingWeekdays.length === 0
    || calendar.workingWeekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error('AUDIT_CALENDAR_INVALID');
  }
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: calendar.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = Object.fromEntries(formatter.formatToParts(startedAt).map((part) => [part.type, part.value]));
  const date = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`);
  const weekdays = new Set(calendar.workingWeekdays);
  let remaining = businessDays;
  for (let day = 0; day < 1096; day += 1) {
    date.setUTCDate(date.getUTCDate() + 1);
    const dateKey = date.toISOString().slice(0, 10);
    if ((calendar.exceptions[dateKey] ?? weekdays.has(date.getUTCDay())) && --remaining === 0) return dateKey;
  }
  throw new Error('AUDIT_CALENDAR_INSUFFICIENT');
}
