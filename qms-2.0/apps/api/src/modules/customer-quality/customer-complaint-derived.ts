export type ComplaintMileageBand =
  | '\u22645000'
  | '5000<m\u226420000'
  | '20000<m\u226460000'
  | '60000<m\u2264100000'
  | '>100000';

export type ComplaintMisTag = '3MIS' | '12MIS' | 'OTHER';

function daysInMonth(year: number, month: number): number {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function parseComplaintDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return value;
}

export function complaintMileageBand(mileage: number | null): ComplaintMileageBand | null {
  if (mileage === null || !Number.isFinite(mileage) || mileage < 0) return null;
  if (mileage <= 5000) return '\u22645000';
  if (mileage <= 20000) return '5000<m\u226420000';
  if (mileage <= 60000) return '20000<m\u226460000';
  if (mileage <= 100000) return '60000<m\u2264100000';
  return '>100000';
}

function dateKey(date: string): number {
  return Number(date.replaceAll('-', ''));
}

function calendarMonthBoundary(date: string, months: number): number {
  const monthIndex = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 + months;
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex % 12 + 1;
  const day = Math.min(Number(date.slice(8, 10)), daysInMonth(year, month));
  return year * 10000 + month * 100 + day;
}

// Display completed months; the next day after a MIS boundary can still display 3 or 12.
export function complaintServiceMonths(productionDate: string | null, occurredDate: string | null): number | null {
  const start = parseComplaintDate(productionDate);
  const end = parseComplaintDate(occurredDate);
  if (start === null || end === null || end < start) return null;
  const months = (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12
    + Number(end.slice(5, 7)) - Number(start.slice(5, 7));
  return months - (dateKey(end) < calendarMonthBoundary(start, months) ? 1 : 0);
}

// Compare exact clipped boundaries from the original production date, not displayed months.
export function complaintMisTag(productionDate: string | null, occurredDate: string | null): ComplaintMisTag | null {
  const start = parseComplaintDate(productionDate);
  const end = parseComplaintDate(occurredDate);
  if (start === null || end === null || end < start) return null;
  if (dateKey(end) <= calendarMonthBoundary(start, 3)) return '3MIS';
  if (dateKey(end) <= calendarMonthBoundary(start, 12)) return '12MIS';
  return 'OTHER';
}
