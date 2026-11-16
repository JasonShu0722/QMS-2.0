export type ProcessShift = 'DAY' | 'NIGHT';

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
