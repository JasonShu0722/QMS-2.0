export type ProcessShift = 'DAY' | 'NIGHT';
export const PROCESS_FACTORY_CODES = ['FACTORY_1', 'FACTORY_2'] as const;
export type ProcessFactoryCode = (typeof PROCESS_FACTORY_CODES)[number];

export function isProcessFactoryCode(value: unknown): value is ProcessFactoryCode {
  return PROCESS_FACTORY_CODES.some(code => code === value);
}

export function processDefectShift(occurredAt: Date | null): ProcessShift | null {
  if (!occurredAt) return null;
  const minutes = (occurredAt.getUTCHours() * 60 + occurredAt.getUTCMinutes() + 480) % 1440;
  return minutes >= 510 && minutes < 1230 ? 'DAY' : 'NIGHT';
}

export function processDefectRequiredIssues(facts: { occurredAt: Date | null; productCode: string | null; traceCode: string | null; description: string }) {
  return [
    ...(!facts.occurredAt ? ['OCCURRED_AT_REQUIRED'] : []),
    ...(!facts.productCode ? ['PRODUCT_CODE_REQUIRED'] : []),
    ...(!facts.traceCode ? ['TRACE_CODE_REQUIRED'] : []),
    ...(!facts.description.trim() ? ['DESCRIPTION_REQUIRED'] : []),
  ];
}
