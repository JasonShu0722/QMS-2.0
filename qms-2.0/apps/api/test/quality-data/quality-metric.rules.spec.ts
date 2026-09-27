import { abnormalPeriodSummary, calculateQualityMetric, classifyQualitySignal, getQualityMetricProfile } from '../../src/modules/quality-data/quality-metric.rules.js';

test('calculates standard quality metric formulas', () => {
  expect(calculateQualityMetric('INCOMING_ACCEPTANCE_RATE', 95, 100)).toBeCloseTo(0.95);
  expect(calculateQualityMetric('PPM', 12, 10000)).toBeCloseTo(1200);
  expect(calculateQualityMetric('PROCESS_DEFECT_RATE', 12, 1000)).toBeCloseTo(0.012);
  expect(calculateQualityMetric('FIRST_PASS_YIELD', 970, 1000)).toBeCloseTo(0.97);
});

test('classifies threshold status and abnormal duration', () => {
  const profile = getQualityMetricProfile('PPM');
  expect(profile.direction).toBe('LTE');
  expect(classifyQualitySignal(80, profile.thresholds, profile.direction)).toBe('NO_DATA');
  expect(classifyQualitySignal(80, { green: 100, yellow: 200 }, profile.direction)).toBe('GREEN');
  expect(classifyQualitySignal(150, { green: 100, yellow: 200 }, profile.direction)).toBe('YELLOW');
  expect(classifyQualitySignal(250, { green: 100, yellow: 200 }, profile.direction)).toBe('RED');
  const fpy = getQualityMetricProfile('FIRST_PASS_YIELD');
  expect(classifyQualitySignal(0.5, { green: 0.98, yellow: 0.95 }, fpy.direction)).toBe('RED');
});

test('rejects zero denominator', () => {
  expect(() => calculateQualityMetric('PPM', 1, 0)).toThrow('QUALITY_METRIC_DENOMINATOR_INVALID');
  expect(() => calculateQualityMetric('FIRST_PASS_YIELD', 101, 100)).toThrow('QUALITY_METRIC_NUMERATOR_INVALID');
});

test('counts consecutive red periods from the newest period and ignores unconfigured thresholds', () => {
  const profile = getQualityMetricProfile('PPM', { thresholds: { green: 100, yellow: 200 } });
  expect(abnormalPeriodSummary([400, 300, 80, 500], profile)).toEqual({ signal: 'RED', abnormalPeriods: 3, consecutiveRedPeriods: 2 });
  expect(abnormalPeriodSummary([400, 300], getQualityMetricProfile('PPM'))).toEqual({ signal: 'NO_DATA', abnormalPeriods: 0, consecutiveRedPeriods: 0 });
});
