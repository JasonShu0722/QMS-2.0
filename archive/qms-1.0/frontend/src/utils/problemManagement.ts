import { ComplaintType } from '@/types/customer-quality'
import type { ProblemCategoryItem, ProblemCategoryKey } from '@/types/problem-management'

type ProblemCategoryResolver = (categoryKey: ProblemCategoryKey) => ProblemCategoryItem | null

const CUSTOMER_COMPLAINT_CATEGORY_MAP: Record<ComplaintType, ProblemCategoryKey> = {
  [ComplaintType.ZERO_KM]: 'CQ0',
  [ComplaintType.AFTER_SALES]: 'CQ1'
}

const CUSTOMER_COMPLAINT_FALLBACK_LABEL_MAP: Record<ComplaintType, string> = {
  [ComplaintType.ZERO_KM]: '0KM',
  [ComplaintType.AFTER_SALES]: '售后'
}

function normalizeProblemCategoryLabel(label: string): string {
  return label.toLowerCase() === '0km' ? '0KM' : label
}

export function getProblemCategoryLabel(
  categoryKey: ProblemCategoryKey,
  fallbackLabel: string,
  resolveCategory?: ProblemCategoryResolver
): string {
  const category = resolveCategory?.(categoryKey)
  return normalizeProblemCategoryLabel(category?.label ?? fallbackLabel)
}

export function getCustomerComplaintCategoryKey(complaintType: ComplaintType): ProblemCategoryKey {
  return CUSTOMER_COMPLAINT_CATEGORY_MAP[complaintType]
}

export function getCustomerComplaintTypeLabel(
  complaintType: ComplaintType,
  resolveCategory?: ProblemCategoryResolver,
  withSuffix = false
): string {
  const baseLabel = getProblemCategoryLabel(
    getCustomerComplaintCategoryKey(complaintType),
    CUSTOMER_COMPLAINT_FALLBACK_LABEL_MAP[complaintType],
    resolveCategory
  )

  return withSuffix ? `${baseLabel}客诉` : baseLabel
}

export function buildCustomerComplaintTypeOptions(resolveCategory?: ProblemCategoryResolver) {
  return (Object.values(ComplaintType) as ComplaintType[]).map((complaintType) => ({
    value: complaintType,
    label: getCustomerComplaintTypeLabel(complaintType, resolveCategory, true)
  }))
}
