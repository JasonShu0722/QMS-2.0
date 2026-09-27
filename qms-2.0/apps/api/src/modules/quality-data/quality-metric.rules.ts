export type QualityMetricDirection = 'GTE' | 'LTE';
export type QualityMetricSignal = 'GREEN' | 'YELLOW' | 'RED' | 'NO_DATA';

export interface QualityMetricThresholds {
  green: number;
  yellow: number;
}

export interface QualityMetricProfile {
  code: string;
  name: string;
  unit: '%' | 'PPM';
  numeratorLabel: string;
  denominatorLabel: string;
  direction: QualityMetricDirection;
  thresholds: QualityMetricThresholds | null;
  formulaVersion: string;
}

const RATE_PROFILES: Record<string, QualityMetricProfile> = {
  INCOMING_ACCEPTANCE_RATE: { code: 'INCOMING_ACCEPTANCE_RATE', name: '来料合格率', unit: '%', numeratorLabel: '合格批次/数量', denominatorLabel: '来料批次/数量', direction: 'GTE', thresholds: null, formulaVersion: 'standard-v1' },
  IQC_PASS_RATE: { code: 'IQC_PASS_RATE', name: '来料合格率', unit: '%', numeratorLabel: '合格批次/数量', denominatorLabel: '来料批次/数量', direction: 'GTE', thresholds: null, formulaVersion: 'standard-v1' },
  PROCESS_DEFECT_RATE: { code: 'PROCESS_DEFECT_RATE', name: '制程不良率', unit: '%', numeratorLabel: '不良数量', denominatorLabel: '生产数量', direction: 'LTE', thresholds: null, formulaVersion: 'standard-v1' },
  DEFECT_RATE: { code: 'DEFECT_RATE', name: '制程不良率', unit: '%', numeratorLabel: '不良数量', denominatorLabel: '生产数量', direction: 'LTE', thresholds: null, formulaVersion: 'standard-v1' },
  FIRST_PASS_YIELD: { code: 'FIRST_PASS_YIELD', name: '直通率', unit: '%', numeratorLabel: '一次通过数量', denominatorLabel: '投入数量', direction: 'GTE', thresholds: null, formulaVersion: 'standard-v1' },
  FPY: { code: 'FPY', name: '直通率', unit: '%', numeratorLabel: '一次通过数量', denominatorLabel: '投入数量', direction: 'GTE', thresholds: null, formulaVersion: 'standard-v1' },
};

const PPM_PROFILE: QualityMetricProfile = { code: 'PPM', name: '不良 PPM', unit: 'PPM', numeratorLabel: '不良数量', denominatorLabel: '生产数量', direction: 'LTE', thresholds: null, formulaVersion: 'standard-v1' };

export function getQualityMetricProfile(code: string, overrides?: Partial<Pick<QualityMetricProfile, 'direction' | 'thresholds'>>): QualityMetricProfile {
  const normalized = code.trim().toUpperCase();
  const profile = normalized === 'PPM' || normalized === 'PROCESS_PPM' ? PPM_PROFILE : RATE_PROFILES[normalized];
  const fallback: QualityMetricProfile = { code: normalized, name: normalized, unit: '%', numeratorLabel: '分子', denominatorLabel: '分母', direction: 'GTE', thresholds: null, formulaVersion: 'ratio-v1' };
  const base = profile ?? fallback;
  return { ...base, direction: overrides?.direction ?? base.direction, thresholds: overrides?.thresholds ?? base.thresholds };
}

export function calculateQualityMetric(code: string, numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || numerator < 0 || !Number.isFinite(denominator) || denominator <= 0) throw new Error('QUALITY_METRIC_DENOMINATOR_INVALID');
  if (numerator > denominator) throw new Error('QUALITY_METRIC_NUMERATOR_INVALID');
  const normalized = code.trim().toUpperCase();
  return normalized === 'PPM' || normalized === 'PROCESS_PPM' ? numerator / denominator * 1_000_000 : numerator / denominator;
}

export function classifyQualitySignal(value: number | null | undefined, thresholds: QualityMetricThresholds | null, direction: QualityMetricDirection = 'GTE'): QualityMetricSignal {
  if (value == null || !Number.isFinite(value) || !thresholds) return 'NO_DATA';
  if (direction === 'LTE') return value <= thresholds.green ? 'GREEN' : value <= thresholds.yellow ? 'YELLOW' : 'RED';
  return value >= thresholds.green ? 'GREEN' : value >= thresholds.yellow ? 'YELLOW' : 'RED';
}

export function abnormalPeriodSummary(values: readonly number[], profile: QualityMetricProfile) {
  const signals = values.map((value) => classifyQualitySignal(value, profile.thresholds, profile.direction));
  const abnormal = signals.filter((signal) => signal === 'RED' || signal === 'YELLOW').length;
  let consecutive = 0;
  for (const signal of signals) {
    if (signal === 'RED') consecutive += 1;
    else break;
  }
  return { signal: signals[0] ?? 'NO_DATA', abnormalPeriods: abnormal, consecutiveRedPeriods: consecutive };
}
