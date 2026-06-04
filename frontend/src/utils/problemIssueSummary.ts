import type { LocationQuery, RouteLocationRaw } from 'vue-router'

import type {
  ProblemCategoryKey,
  ProblemIssueSummaryItem,
  ProblemIssueSummaryQuery,
  ProblemModuleKey,
  ProblemResponseMode,
  ProblemRiskLevel,
  UnifiedProblemStatus,
} from '@/types/problem-management'

type StatusMeta = {
  label: string
  tagType: 'success' | 'warning' | 'info' | 'primary' | 'danger'
}

type QuickActionKind =
  | 'process-respond'
  | 'process-verify'
  | 'process-close'
  | 'audit-respond'
  | 'audit-verify'
  | 'audit-close'
  | 'trial-solution'
  | 'trial-close'
  | 'complaint-analysis'
  | 'complaint-disposition'
  | 'scar-review-8d'

export type ProblemIssueCenterQuickFilter = 'all' | 'actionable' | 'overdue' | 'created'

export type ProblemIssueModuleSummary = {
  moduleKey: ProblemModuleKey
  label: string
  count: number
}

type ProblemIssueRouteSource = Pick<
  ProblemIssueSummaryItem,
  | 'source_type'
  | 'source_id'
  | 'assigned_to'
  | 'action_owner_id'
  | 'unified_status'
  | 'verified_by'
  | 'requires_physical_analysis'
> &
  Partial<Pick<ProblemIssueSummaryItem, 'problem_category_key' | 'source_parent_id'>>

type ProblemIssueSourceLabelSource = Pick<ProblemIssueSummaryItem, 'source_type'> &
  Partial<Pick<ProblemIssueSummaryItem, 'problem_category_key'>>

type ProblemIssueSourceRouteLookup = Pick<ProblemIssueSummaryItem, 'source_type' | 'source_id'> &
  Partial<Pick<ProblemIssueSummaryItem, 'source_parent_id' | 'problem_category_key'>>

type ProblemIssueTrackingNumberSource = Partial<
  Pick<ProblemIssueSummaryItem, 'eight_d_number' | 'problem_number' | 'reference_no'>
>

type ScarRouteName = 'SCARList' | 'ScarManagement'
type CustomerComplaintRouteName =
  | 'CustomerComplaintList'
  | 'CustomerEightDList'
  | 'CustomerComplaintDetail'
  | 'EightDCustomerForm'
  | 'ProblemIssueCenter'

const MODULE_LABELS: Record<ProblemModuleKey, string> = {
  customer_quality: '客户质量',
  process_quality: '制程质量',
  incoming_quality: '供应商质量',
  new_product_quality: '新品质量',
  audit_management: '审核管理',
}

const STATUS_META: Record<UnifiedProblemStatus, StatusMeta> = {
  open: { label: '待处理', tagType: 'warning' },
  assigned: { label: '已分派', tagType: 'primary' },
  responding: { label: '处理中', tagType: 'primary' },
  pending_review: { label: '待审核', tagType: 'info' },
  verifying: { label: '待验证', tagType: 'warning' },
  approved: { label: '已批准', tagType: 'success' },
  closed: { label: '已关闭', tagType: 'success' },
  rejected: { label: '已驳回', tagType: 'danger' },
}

const RISK_META: Record<ProblemRiskLevel, StatusMeta> = {
  low: { label: '低', tagType: 'info' },
  medium: { label: '中', tagType: 'primary' },
  high: { label: '高', tagType: 'warning' },
  critical: { label: '严重', tagType: 'danger' },
}

const RESPONSE_MODE_META: Record<ProblemResponseMode, string> = {
  brief: '简报',
  eight_d: '8D',
}

const MODULE_KEYS = new Set<ProblemModuleKey>(Object.keys(MODULE_LABELS) as ProblemModuleKey[])
const STATUS_KEYS = new Set<UnifiedProblemStatus>(Object.keys(STATUS_META) as UnifiedProblemStatus[])
const RISK_KEYS = new Set<ProblemRiskLevel>(Object.keys(RISK_META) as ProblemRiskLevel[])
const RESPONSE_MODE_KEYS = new Set<ProblemResponseMode>(
  Object.keys(RESPONSE_MODE_META) as ProblemResponseMode[]
)
const PROBLEM_ISSUE_MODULE_ORDER = Object.keys(MODULE_LABELS) as ProblemModuleKey[]
const SCAR_ROUTE_NAMES = new Set<ScarRouteName>(['SCARList', 'ScarManagement'])
const CUSTOMER_COMPLAINT_ROUTE_NAMES = new Set<CustomerComplaintRouteName>([
  'CustomerComplaintList',
  'CustomerComplaintDetail',
  'EightDCustomerForm',
  'ProblemIssueCenter',
])

function buildScarReturnQuery(
  scarId: number,
  sourceRouteName: ScarRouteName = 'ScarManagement'
): Record<string, string> {
  return {
    focusId: String(scarId),
    sourceRouteName,
    sourceFocusId: String(scarId),
  }
}

export function isScarRouteName(value: string): value is ScarRouteName {
  return SCAR_ROUTE_NAMES.has(value as ScarRouteName)
}

export function isCustomerComplaintRouteName(value: string): value is CustomerComplaintRouteName {
  return CUSTOMER_COMPLAINT_ROUTE_NAMES.has(value as CustomerComplaintRouteName)
}

function isActionOwnerCurrentUser(
  item: ProblemIssueRouteSource,
  currentUserId?: number | null
): boolean {
  const actionOwnerId = item.action_owner_id ?? item.assigned_to
  return Boolean(currentUserId && actionOwnerId === currentUserId)
}

function getProblemIssueQuickActionKind(
  item: ProblemIssueRouteSource,
  currentUserId?: number | null
): QuickActionKind | null {
  if (!isActionOwnerCurrentUser(item, currentUserId)) {
    return null
  }

  if (item.source_type === 'process_issue' && ['open', 'responding'].includes(item.unified_status)) {
    return 'process-respond'
  }

  if (item.source_type === 'process_issue' && item.unified_status === 'verifying') {
    return item.verified_by ? 'process-close' : 'process-verify'
  }

  if (item.source_type === 'audit_nc' && item.unified_status === 'assigned') {
    return 'audit-respond'
  }

  if (item.source_type === 'audit_nc' && item.unified_status === 'pending_review') {
    return 'audit-verify'
  }

  if (item.source_type === 'audit_nc' && item.unified_status === 'verifying') {
    return 'audit-close'
  }

  if (item.source_type === 'trial_issue' && ['open', 'responding'].includes(item.unified_status)) {
    return 'trial-solution'
  }

  if (item.source_type === 'trial_issue' && item.unified_status === 'verifying') {
    return 'trial-close'
  }

  if (
    item.source_type === 'customer_complaint' &&
    item.requires_physical_analysis !== false &&
    item.unified_status === 'responding'
  ) {
    return 'complaint-analysis'
  }

  if (
    item.source_type === 'customer_complaint' &&
    item.requires_physical_analysis === false &&
    ['open', 'responding'].includes(item.unified_status)
  ) {
    return 'complaint-disposition'
  }

  if (item.source_type === 'scar' && item.unified_status === 'pending_review') {
    return 'scar-review-8d'
  }

  return null
}

function getSingleQueryValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0]
  }

  return undefined
}

function parseBooleanQuery(value: unknown): boolean {
  const normalized = getSingleQueryValue(value)
  return normalized === 'true' || normalized === '1'
}

function parsePositiveIntegerQuery(value: unknown): number | undefined {
  const normalized = getSingleQueryValue(value)
  if (!normalized) {
    return undefined
  }

  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined
  }

  return parsed
}

export function buildProblemIssueModuleOptions() {
  return PROBLEM_ISSUE_MODULE_ORDER.map((moduleKey) => ({
    value: moduleKey,
    label: MODULE_LABELS[moduleKey],
  }))
}

export function buildUnifiedProblemStatusOptions() {
  return (Object.keys(STATUS_META) as UnifiedProblemStatus[]).map((status) => ({
    value: status,
    label: STATUS_META[status].label,
  }))
}

export function buildProblemIssueRiskLevelOptions() {
  return (Object.keys(RISK_META) as ProblemRiskLevel[]).map((riskLevel) => ({
    value: riskLevel,
    label: RISK_META[riskLevel].label,
  }))
}

export function buildProblemIssueResponseModeOptions() {
  return (Object.keys(RESPONSE_MODE_META) as ProblemResponseMode[]).map((responseMode) => ({
    value: responseMode,
    label: RESPONSE_MODE_META[responseMode],
  }))
}

export function getProblemIssueModuleLabel(moduleKey: string): string {
  return MODULE_LABELS[moduleKey as ProblemModuleKey] ?? moduleKey
}

export function normalizeProblemIssueModuleCounts(
  moduleCounts: Record<string, number> | undefined,
  fallbackItems: Pick<ProblemIssueSummaryItem, 'module_key'>[] = [],
  moduleOrder: ProblemModuleKey[] = PROBLEM_ISSUE_MODULE_ORDER
): Partial<Record<ProblemModuleKey, number>> {
  const counts: Partial<Record<ProblemModuleKey, number>> = {}
  const allowedModuleKeys = new Set(moduleOrder)

  if (moduleCounts && Object.keys(moduleCounts).length) {
    for (const moduleKey of moduleOrder) {
      const count = moduleCounts[moduleKey]
      if (count > 0) {
        counts[moduleKey] = count
      }
    }

    return counts
  }

  for (const item of fallbackItems) {
    const moduleKey = item.module_key as ProblemModuleKey
    if (allowedModuleKeys.has(moduleKey)) {
      counts[moduleKey] = (counts[moduleKey] || 0) + 1
    }
  }

  return counts
}

export function buildProblemIssueModuleSummaries(
  moduleCounts: Partial<Record<ProblemModuleKey, number>>,
  moduleOrder: ProblemModuleKey[] = PROBLEM_ISSUE_MODULE_ORDER
): ProblemIssueModuleSummary[] {
  return moduleOrder
    .map((moduleKey) => ({
      moduleKey,
      count: moduleCounts[moduleKey] || 0,
      label: getProblemIssueModuleLabel(moduleKey),
    }))
    .filter((item) => item.count > 0)
}

export function getUnifiedProblemStatusLabel(status: UnifiedProblemStatus): string {
  return STATUS_META[status]?.label ?? status
}

export function getUnifiedProblemStatusType(status: UnifiedProblemStatus): StatusMeta['tagType'] {
  return STATUS_META[status]?.tagType ?? 'info'
}

export function getProblemIssueRiskLevelLabel(riskLevel?: string | null): string {
  return RISK_META[riskLevel as ProblemRiskLevel]?.label ?? '-'
}

export function getProblemIssueRiskLevelType(riskLevel?: string | null): StatusMeta['tagType'] {
  return RISK_META[riskLevel as ProblemRiskLevel]?.tagType ?? 'info'
}

export function getProblemIssueResponseModeLabel(
  responseMode: ProblemIssueSummaryItem['response_mode']
): string {
  return RESPONSE_MODE_META[responseMode as ProblemResponseMode] ?? '-'
}

export function getProblemIssueTrackingNumber(item: ProblemIssueTrackingNumberSource): string {
  return item.eight_d_number || item.problem_number || item.reference_no || '-'
}

export function getProblemIssueSourceActionLabel(_item: ProblemIssueSourceLabelSource): string {
  return '查看问题单'
}

export function getProblemIssueSourceRoute(item: ProblemIssueSourceRouteLookup): RouteLocationRaw | null {
  if (item.source_type === 'customer_complaint') {
    return {
      name: 'CustomerComplaintDetail',
      params: { id: item.source_id },
      query: { sourceRouteName: 'ProblemIssueCenter' },
    }
  }

  if (item.source_type === 'process_issue') {
    return {
      name: 'ProcessIssueDetail',
      params: { id: item.source_id },
    }
  }

  if (item.source_type === 'scar') {
    return {
      name: 'ScarManagement',
      query: { focusId: String(item.source_id) },
    }
  }

  if (item.source_type === 'trial_issue') {
    return {
      name: 'TrialIssueList',
      query: { focusId: String(item.source_id) },
    }
  }

  if (item.source_type === 'audit_nc') {
    if (item.problem_category_key === 'AQ3' && item.source_parent_id) {
      return {
        name: 'CustomerAuditList',
        query: {
          focusId: String(item.source_parent_id),
          issueTaskId: String(item.source_id),
          openIssueTasks: 'true',
        },
      }
    }

    return {
      name: 'AuditNCList',
      query: { focusId: String(item.source_id) },
    }
  }

  return null
}

export function isProblemIssueQuickActionable(
  item: ProblemIssueRouteSource,
  currentUserId?: number | null
): boolean {
  return getProblemIssueQuickActionKind(item, currentUserId) !== null
}

export function getProblemIssueQuickActionLabel(
  item: ProblemIssueRouteSource,
  currentUserId?: number | null
): string | null {
  const quickActionKind = getProblemIssueQuickActionKind(item, currentUserId)

  if (quickActionKind === 'process-respond' || quickActionKind === 'audit-respond') return '填写对策'
  if (quickActionKind === 'process-verify') return '验证对策'
  if (quickActionKind === 'process-close') return '关闭问题单'
  if (quickActionKind === 'audit-verify') return '验证'
  if (quickActionKind === 'audit-close' || quickActionKind === 'trial-close') return '关闭'
  if (quickActionKind === 'trial-solution') return '提交方案'
  if (quickActionKind === 'complaint-analysis') return '实物解析'
  if (quickActionKind === 'complaint-disposition') return '实物处理'
  if (quickActionKind === 'scar-review-8d') return '审核8D'

  return null
}

export function getProblemIssueWorkbenchPreviewActionLabel(
  item: ProblemIssueRouteSource,
  currentUserId?: number | null
): string {
  return (
    getProblemIssueQuickActionLabel(item, currentUserId) ||
    getProblemIssueSourceActionLabel(item) ||
    '-'
  )
}

export function getProblemIssueQuickActionRoute(
  item: ProblemIssueRouteSource,
  currentUserId?: number | null
): RouteLocationRaw | null {
  const quickActionKind = getProblemIssueQuickActionKind(item, currentUserId)
  const customerAuditSourceQuery =
    item.problem_category_key === 'AQ3' && item.source_parent_id
      ? {
          sourceParentId: String(item.source_parent_id),
          sourceCategoryKey: 'AQ3',
        }
      : {}

  if (quickActionKind === 'process-respond') {
    return {
      name: 'ProcessIssueDetail',
      params: { id: item.source_id },
      query: { action: 'respond' },
    }
  }

  if (quickActionKind === 'process-verify') {
    return {
      name: 'ProcessIssueDetail',
      params: { id: item.source_id },
      query: { action: 'verify' },
    }
  }

  if (quickActionKind === 'process-close') {
    return {
      name: 'ProcessIssueDetail',
      params: { id: item.source_id },
      query: { action: 'close' },
    }
  }

  if (quickActionKind === 'audit-respond') {
    return {
      name: 'AuditNCList',
      query: {
        focusId: String(item.source_id),
        action: 'respond',
        ...customerAuditSourceQuery,
      },
    }
  }

  if (quickActionKind === 'audit-verify') {
    return {
      name: 'AuditNCList',
      query: {
        focusId: String(item.source_id),
        action: 'verify',
        ...customerAuditSourceQuery,
      },
    }
  }

  if (quickActionKind === 'audit-close') {
    return {
      name: 'AuditNCList',
      query: {
        focusId: String(item.source_id),
        action: 'close',
        ...customerAuditSourceQuery,
      },
    }
  }

  if (quickActionKind === 'trial-solution') {
    return {
      name: 'TrialIssueList',
      query: {
        focusId: String(item.source_id),
        action: 'solution',
      },
    }
  }

  if (quickActionKind === 'trial-close') {
    return {
      name: 'TrialIssueList',
      query: {
        focusId: String(item.source_id),
        action: 'close',
      },
    }
  }

  if (quickActionKind === 'complaint-analysis') {
    return {
      name: 'CustomerComplaintDetail',
      params: { id: item.source_id },
      query: {
        action: 'analysis',
        sourceRouteName: 'ProblemIssueCenter',
      },
    }
  }

  if (quickActionKind === 'complaint-disposition') {
    return {
      name: 'CustomerComplaintDetail',
      params: { id: item.source_id },
      query: {
        action: 'disposition',
        sourceRouteName: 'ProblemIssueCenter',
      },
    }
  }

  if (quickActionKind === 'scar-review-8d') {
    return {
      name: 'ScarEightDReview',
      params: { id: item.source_id },
      query: {
        action: 'review',
        ...buildScarReturnQuery(item.source_id, 'ScarManagement'),
      },
    }
  }

  return null
}

export function getProblemIssueCenterRoute(
  quickFilter: ProblemIssueCenterQuickFilter = 'all',
  moduleKey?: ProblemModuleKey
): RouteLocationRaw {
  const query: Record<string, string> = {}

  if (quickFilter === 'actionable') {
    query.only_actionable_to_me = 'true'
  }

  if (quickFilter === 'overdue') {
    query.only_overdue = 'true'
  }

  if (quickFilter === 'created') {
    query.only_created_by_me = 'true'
  }

  if (moduleKey) {
    query.module_key = moduleKey
  }

  return Object.keys(query).length
    ? {
        name: 'ProblemIssueCenter',
        query,
      }
    : {
        name: 'ProblemIssueCenter',
      }
}

export function parseProblemIssueCenterRouteQuery(
  query: LocationQuery
): Partial<ProblemIssueSummaryQuery> {
  const moduleKey = getSingleQueryValue(query.module_key)
  const categoryKey = getSingleQueryValue(query.problem_category_key)
  const riskLevel = getSingleQueryValue(query.risk_level)
  const responseMode = getSingleQueryValue(query.response_mode)
  const unifiedStatus = getSingleQueryValue(query.unified_status)
  const keyword = getSingleQueryValue(query.keyword)

  const parsed: Partial<ProblemIssueSummaryQuery> = {
    only_assigned_to_me: parseBooleanQuery(query.only_assigned_to_me),
    only_actionable_to_me: parseBooleanQuery(query.only_actionable_to_me),
    only_created_by_me: parseBooleanQuery(query.only_created_by_me),
    only_overdue: parseBooleanQuery(query.only_overdue),
  }

  if (moduleKey && MODULE_KEYS.has(moduleKey as ProblemModuleKey)) {
    parsed.module_key = moduleKey as ProblemModuleKey
  }

  if (categoryKey) {
    parsed.problem_category_key = categoryKey as ProblemCategoryKey
  }

  if (riskLevel && RISK_KEYS.has(riskLevel as ProblemRiskLevel)) {
    parsed.risk_level = riskLevel as ProblemRiskLevel
  }

  if (responseMode && RESPONSE_MODE_KEYS.has(responseMode as ProblemResponseMode)) {
    parsed.response_mode = responseMode as ProblemResponseMode
  }

  if (unifiedStatus && STATUS_KEYS.has(unifiedStatus as UnifiedProblemStatus)) {
    parsed.unified_status = unifiedStatus as UnifiedProblemStatus
  }

  if (keyword) {
    parsed.keyword = keyword
  }

  const page = parsePositiveIntegerQuery(query.page)
  if (page) {
    parsed.page = page
  }

  const pageSize = parsePositiveIntegerQuery(query.page_size)
  if (pageSize) {
    parsed.page_size = pageSize
  }

  return parsed
}
