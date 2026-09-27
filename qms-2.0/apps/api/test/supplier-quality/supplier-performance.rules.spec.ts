import { describe, expect, it } from '@jest/globals';
import { monthRange, scoreCard } from '../../src/modules/supplier-performance/supplier-performance.rules.js';

describe('supplier performance scorecard rules', () => {
  it('uses a UTC calendar month and rejects invalid months', () => {
    expect(monthRange('2026-02')).toEqual({ start: new Date('2026-02-01T00:00:00.000Z'), end: new Date('2026-03-01T00:00:00.000Z') });
    expect(() => monthRange('2026-13')).toThrow();
    expect(() => monthRange('2026-2')).toThrow();
    expect(() => monthRange('0099-01')).toThrow();
  });

  it('calculates a reproducible weighted score from completed inspection facts', () => {
    expect(scoreCard({ inspectionCount: 4, passCount: 3, cooperationScore: 90, incomingWeight: 60, cooperationWeight: 40 })).toEqual({ incomingScore: 75, totalScore: 81 });
  });

  it('rejects missing samples and weights that do not sum to 100', () => {
    expect(() => scoreCard({ inspectionCount: 0, passCount: 0, cooperationScore: 80, incomingWeight: 60, cooperationWeight: 40 })).toThrow();
    expect(() => scoreCard({ inspectionCount: 1, passCount: 1, cooperationScore: 80, incomingWeight: 50, cooperationWeight: 40 })).toThrow();
  });
});
