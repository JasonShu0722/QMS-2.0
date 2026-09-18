export type AuditNCLegacyStatus = 'pending' | 'responded'
export type AuditNCCanonicalStatus = 'open' | 'assigned' | 'submitted' | 'verified' | 'rejected' | 'closed'
export type AuditNCStatus = AuditNCCanonicalStatus | AuditNCLegacyStatus
import type { ProblemCategoryItem, ProblemCategoryKey } from '@/types/problem-management'

type ProblemCategoryResolver = (categoryKey: ProblemCategoryKey) => ProblemCategoryItem | null

type AuditNCStatusMeta = {
  label: string
  type: 'info' | 'warning' | 'primary' | 'success' | 'danger'
}

const AUDIT_NC_STATUS_ALIASES: Record<AuditNCLegacyStatus, AuditNCCanonicalStatus> = {
  pending: 'open',
  responded: 'submitted'
}

const AUDIT_NC_STATUS_META: Record<AuditNCCanonicalStatus, AuditNCStatusMeta> = {
  open: { label: '待指派', type: 'info' },
  assigned: { label: '已指派', type: 'warning' },
  submitted: { label: '已提交', type: 'primary' },
  verified: { label: '已验证', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' },
  closed: { label: '已关闭', type: 'success' }
}

export function normalizeAuditNCStatus(status: string): AuditNCCanonicalStatus | string {
  return AUDIT_NC_STATUS_ALIASES[status as AuditNCLegacyStatus] ?? status
}

export function getAuditNCStatusLabel(status: string): string {
  const normalizedStatus = normalizeAuditNCStatus(status)
  return AUDIT_NC_STATUS_META[normalizedStatus as AuditNCCanonicalStatus]?.label ?? status
}

export function getAuditNCStatusType(status: string): AuditNCStatusMeta['type'] {
  const normalizedStatus = normalizeAuditNCStatus(status)
  return AUDIT_NC_STATUS_META[normalizedStatus as AuditNCCanonicalStatus]?.type ?? 'info'
}

export function canAssignAuditNC(status: string): boolean {
  return normalizeAuditNCStatus(status) === 'open'
}

export function canRespondAuditNC(status: string): boolean {
  return normalizeAuditNCStatus(status) === 'assigned'
}

export function canVerifyAuditNC(status: string): boolean {
  return normalizeAuditNCStatus(status) === 'submitted'
}

export function canCloseAuditNC(status: string): boolean {
  return normalizeAuditNCStatus(status) === 'verified'
}

export function getAuditNCStatusOptions() {
  return (Object.entries(AUDIT_NC_STATUS_META) as Array<[AuditNCCanonicalStatus, AuditNCStatusMeta]>).map(
    ([value, meta]) => ({
      value,
      label: meta.label
    })
  )
}

export function getAuditNCProblemCategoryLabel(
  problemCategoryKey?: string | null,
  problemCategoryLabel?: string | null,
  resolveCategory?: ProblemCategoryResolver
): string {
  if (problemCategoryKey) {
    const category = resolveCategory?.(problemCategoryKey as ProblemCategoryKey)
    return category?.label ?? problemCategoryLabel ?? problemCategoryKey
  }

  return problemCategoryLabel ?? '-'
}

export function buildAuditNCProblemCategoryOptions(categories: ProblemCategoryItem[]) {
  return categories.map((category) => ({
    value: category.key,
    label: category.label
  }))
}
