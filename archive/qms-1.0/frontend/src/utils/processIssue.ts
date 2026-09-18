import type { ProcessIssueStatus } from '@/types/process-quality'

type ProcessIssueStatusLike = ProcessIssueStatus | 'in_progress' | 'verifying'

type ProcessIssueStatusMeta = {
  label: string
  tagType: string
}

type ProcessIssueStatusOption = {
  value: ProcessIssueStatus
  label: string
}

type ProcessIssueSummary = {
  status?: ProcessIssueStatusLike | null
  assigned_to?: number | null
  verified_by?: number | null
  is_overdue?: boolean | null
}

type ProcessIssueStatistics = {
  total: number
  open: number
  inAnalysis: number
  inVerification: number
  active: number
  closed: number
  cancelled: number
  overdue: number
}

const LEGACY_PROCESS_ISSUE_STATUS_MAP: Record<'in_progress' | 'verifying', ProcessIssueStatus> = {
  in_progress: 'in_analysis',
  verifying: 'in_verification',
}

const PROCESS_ISSUE_STATUS_META: Record<ProcessIssueStatus, ProcessIssueStatusMeta> = {
  open: { label: '待处理', tagType: 'warning' },
  in_analysis: { label: '分析中', tagType: 'primary' },
  in_verification: { label: '验证中', tagType: 'info' },
  closed: { label: '已关闭', tagType: 'success' },
  cancelled: { label: '已取消', tagType: 'danger' },
}

export function normalizeProcessIssueStatus(
  status?: ProcessIssueStatusLike | null
): ProcessIssueStatus | undefined {
  if (!status) {
    return undefined
  }

  return LEGACY_PROCESS_ISSUE_STATUS_MAP[status as keyof typeof LEGACY_PROCESS_ISSUE_STATUS_MAP] ?? status
}

export function getProcessIssueStatusLabel(status?: ProcessIssueStatusLike | null): string {
  const normalizedStatus = normalizeProcessIssueStatus(status)
  if (!normalizedStatus) {
    return ''
  }

  return PROCESS_ISSUE_STATUS_META[normalizedStatus].label
}

export function getProcessIssueStatusType(status?: ProcessIssueStatusLike | null): string {
  const normalizedStatus = normalizeProcessIssueStatus(status)
  if (!normalizedStatus) {
    return 'info'
  }

  return PROCESS_ISSUE_STATUS_META[normalizedStatus].tagType
}

export function buildProcessIssueStatusOptions(): ProcessIssueStatusOption[] {
  return [
    { value: 'open', label: PROCESS_ISSUE_STATUS_META.open.label },
    { value: 'in_analysis', label: PROCESS_ISSUE_STATUS_META.in_analysis.label },
    { value: 'in_verification', label: PROCESS_ISSUE_STATUS_META.in_verification.label },
    { value: 'closed', label: PROCESS_ISSUE_STATUS_META.closed.label },
    { value: 'cancelled', label: PROCESS_ISSUE_STATUS_META.cancelled.label },
  ]
}

export function canRespondToProcessIssue(
  issue: ProcessIssueSummary | null | undefined,
  currentUserId?: number | null
): boolean {
  const normalizedStatus = normalizeProcessIssueStatus(issue?.status)
  if (!issue || !currentUserId || issue.assigned_to !== currentUserId || !normalizedStatus) {
    return false
  }

  return normalizedStatus === 'open' || normalizedStatus === 'in_analysis'
}

export function canVerifyProcessIssue(issue: ProcessIssueSummary | null | undefined): boolean {
  return normalizeProcessIssueStatus(issue?.status) === 'in_verification' && !issue?.verified_by
}

export function canCloseProcessIssue(issue: ProcessIssueSummary | null | undefined): boolean {
  return normalizeProcessIssueStatus(issue?.status) === 'in_verification' && Boolean(issue?.verified_by)
}

export function buildProcessIssueStatistics(
  issues: ProcessIssueSummary[]
): ProcessIssueStatistics {
  return issues.reduce<ProcessIssueStatistics>(
    (stats, issue) => {
      const normalizedStatus = normalizeProcessIssueStatus(issue.status)
      stats.total += 1

      if (normalizedStatus === 'open') {
        stats.open += 1
      }
      if (normalizedStatus === 'in_analysis') {
        stats.inAnalysis += 1
      }
      if (normalizedStatus === 'in_verification') {
        stats.inVerification += 1
      }
      if (normalizedStatus === 'closed') {
        stats.closed += 1
      }
      if (normalizedStatus === 'cancelled') {
        stats.cancelled += 1
      }
      if (issue.is_overdue) {
        stats.overdue += 1
      }

      stats.active = stats.inAnalysis + stats.inVerification
      return stats
    },
    {
      total: 0,
      open: 0,
      inAnalysis: 0,
      inVerification: 0,
      active: 0,
      closed: 0,
      cancelled: 0,
      overdue: 0,
    }
  )
}
