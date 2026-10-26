import {
  complaintMileageBand,
  complaintMisTag,
  complaintServiceMonths,
  parseComplaintDate,
} from '../../src/modules/customer-quality/customer-complaint-derived.js';

describe('parseComplaintDate', () => {
  it.each([
    '0001-01-01', '0099-12-31', '2000-02-29', '2024-02-29',
    '2026-01-31', '2026-04-30', '2026-12-31', '9999-12-31',
  ])('preserves the Gregorian date %s without timezone conversion', (date) => {
    expect(parseComplaintDate(date)).toBe(date);
  });

  it.each([
    null, undefined, '', 0, 20260101, {}, [], new Date('2026-01-01'),
    '0000-01-01', '1900-02-29', '2100-02-29', '2026-02-29', '2026-02-30',
    '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32',
    '2026-1-01', '2026-01-1', '10000-01-01', '26-01-01', '2026/01/01',
    ' 2026-01-01', '2026-01-01 ', '2026-01-01\n', '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:00+08:00', '2026-01-01T23:00:00-08:00',
  ])('rejects invalid or non-date-only input %p', (value) => {
    expect(parseComplaintDate(value)).toBeNull();
  });
});

describe('complaintMileageBand', () => {
  it.each([
    [0, '\u22645000'], [-0, '\u22645000'], [4999.5, '\u22645000'], [5000, '\u22645000'],
    [5000.01, '5000<m\u226420000'], [20000, '5000<m\u226420000'],
    [20000.01, '20000<m\u226460000'], [60000, '20000<m\u226460000'],
    [60000.01, '60000<m\u2264100000'], [100000, '60000<m\u2264100000'],
    [100000.01, '>100000'], [Number.MAX_VALUE, '>100000'],
  ] as const)('classifies %p as %s', (mileage, expected) => {
    expect(complaintMileageBand(mileage)).toBe(expected);
  });

  it.each([null, -1, -0.01, NaN, Infinity, -Infinity])('does not classify %p', (mileage) => {
    expect(complaintMileageBand(mileage)).toBeNull();
  });
});

describe('complaintServiceMonths', () => {
  it.each([
    ['2026-01-24', '2026-01-24', 0],
    ['2026-01-24', '2026-01-31', 0],
    ['2026-01-24', '2026-02-23', 0],
    ['2026-01-24', '2026-02-24', 1],
    ['2026-01-24', '2026-04-23', 2],
    ['2026-01-24', '2026-04-24', 3],
    ['2026-01-24', '2026-04-25', 3],
    ['2026-01-31', '2026-02-27', 0],
    ['2026-01-31', '2026-02-28', 1],
    ['2026-01-31', '2026-03-30', 1],
    ['2026-01-31', '2026-03-31', 2],
    ['2026-01-31', '2026-04-29', 2],
    ['2026-01-31', '2026-04-30', 3],
    ['2026-01-31', '2026-05-01', 3],
    ['2024-02-29', '2025-02-27', 11],
    ['2024-02-29', '2025-02-28', 12],
    ['2024-02-29', '2025-03-01', 12],
    ['2025-12-31', '2026-01-30', 0],
    ['2025-12-31', '2026-01-31', 1],
    ['0099-12-31', '0100-02-28', 2],
    ['0001-01-01', '9999-12-31', 119987],
  ] as const)('counts completed clipped calendar months from %s to %s', (start, end, expected) => {
    expect(complaintServiceMonths(start, end)).toBe(expected);
  });
});

describe('complaintMisTag', () => {
  it.each([
    ['2026-01-24', '2026-01-24', '3MIS'],
    ['2026-01-24', '2026-04-23', '3MIS'],
    ['2026-01-24', '2026-04-24', '3MIS'],
    ['2026-01-24', '2026-04-25', '12MIS'],
    ['2026-01-24', '2027-01-24', '12MIS'],
    ['2026-01-24', '2027-01-25', 'OTHER'],
    ['2026-01-31', '2026-04-29', '3MIS'],
    ['2026-01-31', '2026-04-30', '3MIS'],
    ['2026-01-31', '2026-05-01', '12MIS'],
    ['2026-01-31', '2027-01-31', '12MIS'],
    ['2026-01-31', '2027-02-01', 'OTHER'],
    ['2024-02-29', '2024-05-29', '3MIS'],
    ['2024-02-29', '2024-05-30', '12MIS'],
    ['2024-02-29', '2025-02-27', '12MIS'],
    ['2024-02-29', '2025-02-28', '12MIS'],
    ['2024-02-29', '2025-03-01', 'OTHER'],
    ['2026-02-01', '2026-05-02', '12MIS'],
    ['2026-03-01', '2027-02-28', '12MIS'],
    ['0099-11-30', '0100-02-28', '3MIS'],
    ['9999-12-31', '9999-12-31', '3MIS'],
    ['0001-01-01', '9999-12-31', 'OTHER'],
  ] as const)('uses exact boundaries from the original date %s to %s', (start, end, expected) => {
    expect(complaintMisTag(start, end)).toBe(expected);
  });

  it('does not use the displayed completed month count for the MIS boundary', () => {
    expect(complaintServiceMonths('2026-01-31', '2026-05-01')).toBe(3);
    expect(complaintMisTag('2026-01-31', '2026-05-01')).toBe('12MIS');
    expect(complaintServiceMonths('2024-02-29', '2025-03-01')).toBe(12);
    expect(complaintMisTag('2024-02-29', '2025-03-01')).toBe('OTHER');
  });
});

describe.each([complaintServiceMonths, complaintMisTag])('%p invalid date pairs', (derive) => {
  it.each([
    [null, null], [null, '2026-01-01'], ['2026-01-01', null],
    ['', '2026-01-01'], ['2026-01-01', ''],
    ['2026-02-30', '2026-03-01'], ['2026-01-01', '2026-02-30'],
    ['2026-01-01T00:00:00Z', '2026-02-01'],
    ['2026-01-01', '2026-02-01T00:00:00+08:00'],
    ['2026-01-02', '2026-01-01'], ['2026-01-01', '2025-12-31'],
  ])('returns no result from %p to %p', (start, end) => {
    expect(derive(start, end)).toBeNull();
  });
});
