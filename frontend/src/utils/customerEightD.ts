import type {
  ApprovalLevel,
  D4D7Data,
  D8Data,
  EightDComplaintLinkSummary,
  EightDCustomer,
  EightDCustomerSubmit,
  EightDD8Submit,
  EightDSLAStatus,
  EightDStatus,
} from '@/types/customer-quality'

type BackendD4D7 = {
  d4_root_cause?: {
    analysis_method?: string
    root_cause?: string
    evidence_files?: string[]
  }
  d5_corrective_actions?: Array<{
    action?: string
    responsible?: string
    deadline?: string
  }>
  d6_verification?: {
    verification_report?: string
    test_data?: string | null
    result?: string
  }
  d7_standardization?: {
    document_modified?: boolean
    modified_files?: string[]
    attachment_paths?: string[]
  }
}

type BackendD8 = {
  horizontal_deployment?: Array<{
    product?: string
    action?: string
    status?: string
  }>
  lesson_learned?: {
    should_archive?: boolean
    lesson_title?: string
    lesson_content?: string
    preventive_action?: string
  }
}

export type BackendEightDCustomer = Omit<
  EightDCustomer,
  'd4_d7_responsible' | 'd8_horizontal'
> & {
  d4_d7_responsible?: BackendD4D7 | null
  d8_horizontal?: BackendD8 | null
}

export type EightDActiveTab = 'd0-d3' | 'd4-d7' | 'd8' | 'review'

const STATUS_LABELS: Record<EightDStatus, string> = {
  draft: '草稿',
  d0_d3_completed: 'D0-D3 已完成',
  d4_d7_in_progress: 'D4-D7 进行中',
  d4_d7_completed: 'D4-D7 已完成',
  d8_in_progress: 'D8 进行中',
  in_review: '审核中',
  approved: '已批准',
  rejected: '已驳回',
  closed: '已关闭',
}

const APPROVAL_LEVEL_LABELS: Record<ApprovalLevel, string> = {
  none: '未设置',
  section_manager: '科室经理',
  department_head: '部门负责人',
}

const COMPLAINT_TYPE_LABELS: Record<string, string> = {
  '0km': '0KM',
  after_sales: '售后',
}

function mapD4D7(data?: BackendD4D7 | null): D4D7Data | undefined {
  if (!data) {
    return undefined
  }

  return {
    root_cause: data.d4_root_cause?.root_cause ?? '',
    analysis_method: data.d4_root_cause?.analysis_method ?? '',
    corrective_actions: (data.d5_corrective_actions ?? [])
      .map((item) => item.action)
      .filter((item): item is string => Boolean(item))
      .join('\n'),
    verification_report_url: data.d6_verification?.verification_report ?? '',
    standardization: Boolean(data.d7_standardization?.document_modified),
    standardization_files: data.d7_standardization?.modified_files ?? [],
  }
}

function mapD8(data?: BackendD8 | null): D8Data | undefined {
  if (!data) {
    return undefined
  }

  return {
    horizontal_deployment: (data.horizontal_deployment ?? [])
      .map((item) => item.product)
      .filter((item): item is string => Boolean(item)),
    lessons_learned: data.lesson_learned?.lesson_content ?? '',
    save_to_library: Boolean(data.lesson_learned?.should_archive),
  }
}

function buildCorrectiveActionSummary(correctiveActions: string) {
  return [
    {
      action: correctiveActions,
      responsible: '待补责任人',
      deadline: new Date().toISOString().slice(0, 10),
    },
  ]
}

export function createEmptyD4D7Data(): D4D7Data {
  return {
    root_cause: '',
    analysis_method: '',
    corrective_actions: '',
    verification_report_url: '',
    standardization: false,
    standardization_files: [],
  }
}

export function createEmptyD8Data(): D8Data {
  return {
    horizontal_deployment: [],
    lessons_learned: '',
    save_to_library: false,
  }
}

export function deriveD4D7FormState(data?: D4D7Data): D4D7Data {
  const emptyState = createEmptyD4D7Data()
  if (!data) {
    return emptyState
  }

  return {
    ...emptyState,
    ...data,
    standardization_files: [...(data.standardization_files ?? [])],
  }
}

export function deriveD8FormState(data?: D8Data): D8Data {
  const emptyState = createEmptyD8Data()
  if (!data) {
    return emptyState
  }

  return {
    ...emptyState,
    ...data,
    horizontal_deployment: [...(data.horizontal_deployment ?? [])],
  }
}

export function normalizeEightDCustomer(payload: BackendEightDCustomer): EightDCustomer {
  return {
    ...payload,
    related_complaints: payload.related_complaints ?? [],
    d4_d7_responsible: mapD4D7(payload.d4_d7_responsible),
    d8_horizontal: mapD8(payload.d8_horizontal),
  }
}

export function buildEightDD4D7Payload(data: EightDCustomerSubmit) {
  const form = data.d4_d7_data
  return {
    d4_root_cause: {
      analysis_method: form.analysis_method,
      root_cause: form.root_cause,
      evidence_files: [],
    },
    d5_corrective_actions: buildCorrectiveActionSummary(form.corrective_actions),
    d6_verification: {
      verification_report: form.verification_report_url || 'N/A',
      test_data: null,
      result: '已上传验证报告，待补充验证结果',
    },
    d7_standardization: {
      document_modified: form.standardization,
      modified_files: form.standardization_files ?? [],
      attachment_paths: [],
    },
  }
}

export function buildEightDD8Payload(data: EightDD8Submit) {
  const form = data.d8_data
  return {
    horizontal_deployment: form.horizontal_deployment.map((product) => ({
      product,
      action: '应用本次 8D 对策',
      status: 'pending',
    })),
    lesson_learned: {
      should_archive: form.save_to_library,
      lesson_title: '客户投诉 8D 经验教训',
      lesson_content: form.lessons_learned,
      preventive_action: form.lessons_learned,
    },
  }
}

export function getEightDStatusLabel(status?: EightDStatus): string {
  if (!status) {
    return '已发起'
  }

  return STATUS_LABELS[status] ?? status
}

export function getEightDStageLabel(status?: EightDStatus): string {
  switch (status) {
    case 'draft':
    case 'd0_d3_completed':
      return 'D0-D3'
    case 'd4_d7_in_progress':
    case 'd4_d7_completed':
    case 'rejected':
      return 'D4-D7'
    case 'd8_in_progress':
      return 'D8'
    case 'in_review':
    case 'approved':
      return '审核'
    case 'closed':
      return '关闭'
    default:
      return '-'
  }
}

export function getEightDApprovalLevelLabel(level?: ApprovalLevel): string {
  if (!level) {
    return '未设置'
  }

  return APPROVAL_LEVEL_LABELS[level] ?? level
}

export function getEightDComplaintTypeLabel(complaintType?: string): string {
  if (!complaintType) {
    return '-'
  }

  return COMPLAINT_TYPE_LABELS[complaintType] ?? complaintType
}

export function getEightDComplaintScopeSummary(
  relatedComplaints: EightDComplaintLinkSummary[] = []
): string {
  if (!relatedComplaints.length) {
    return '当前 8D 暂未关联客诉范围'
  }

  if (relatedComplaints.length === 1) {
    return `当前 8D 关联 1 条客诉：${relatedComplaints[0].complaint_number}`
  }

  const primaryComplaint =
    relatedComplaints.find((item) => item.is_primary) ?? relatedComplaints[0]

  return `当前 8D 关联 ${relatedComplaints.length} 条客诉，主客诉为 ${primaryComplaint.complaint_number}`
}

export function canManageEightDComplaintScope(status?: EightDStatus): boolean {
  return status === 'd4_d7_in_progress'
}

export function canSwitchEightDPrimaryComplaint(
  row: Pick<EightDComplaintLinkSummary, 'is_primary'>,
  status?: EightDStatus
): boolean {
  return canManageEightDComplaintScope(status) && !row.is_primary
}

export function canRemoveComplaintFromEightDScope(
  row: Pick<EightDComplaintLinkSummary, 'complaint_id' | 'is_primary'>,
  currentComplaintId?: number
): boolean {
  return !row.is_primary && row.complaint_id !== currentComplaintId
}

export function getEightDNextStepHint(status?: EightDStatus): string {
  switch (status) {
    case 'draft':
      return '等待 CQE 完成 D0-D3 并启动责任板块分析。'
    case 'd0_d3_completed':
    case 'd4_d7_in_progress':
      return '责任板块需补充 D4-D7 根因、纠正措施和验证资料。'
    case 'd4_d7_completed':
    case 'd8_in_progress':
      return '请继续完成 D8 水平展开和经验教训沉淀。'
    case 'in_review':
      return '当前 8D 已提交审核，等待审批人处理。'
    case 'approved':
      return '当前 8D 已批准，可继续关注关闭归档。'
    case 'rejected':
      return '当前 8D 已被驳回，请根据审核意见补充后重新提交。'
    case 'closed':
      return '当前 8D 已完成关闭。'
    default:
      return '请根据当前阶段继续推进 8D 闭环。'
  }
}

export function getEightDSLAIndicator(
  sla?: Pick<EightDSLAStatus, 'eight_d_status' | 'is_submission_overdue' | 'is_archive_overdue' | 'remaining_days'>
): {
  label: string
  tagType: 'success' | 'warning' | 'info' | 'danger'
} {
  if (!sla) {
    return { label: '未计算', tagType: 'info' }
  }

  if (sla.eight_d_status === 'closed') {
    return { label: '已归档', tagType: 'success' }
  }

  if (sla.is_archive_overdue || sla.is_submission_overdue) {
    return { label: `已超期 ${Math.abs(sla.remaining_days)} 天`, tagType: 'danger' }
  }

  if (sla.remaining_days === 0) {
    return { label: '今日到期', tagType: 'warning' }
  }

  return { label: `剩余 ${sla.remaining_days} 天`, tagType: 'info' }
}

export function getEightDD0D3ComplaintSourceSummary(
  d0d3?: Record<string, unknown> | null
): string {
  if (!d0d3) {
    return '-'
  }

  const sourceComplaintNumbers = Array.isArray(d0d3.source_complaint_numbers)
    ? d0d3.source_complaint_numbers.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0
      )
    : []

  const sourceComplaintNumber =
    typeof d0d3.source_complaint_number === 'string' ? d0d3.source_complaint_number : ''

  const relatedComplaintCount =
    typeof d0d3.related_complaint_count === 'number' ? d0d3.related_complaint_count : undefined

  const normalizedNumbers = sourceComplaintNumbers.length
    ? sourceComplaintNumbers
    : sourceComplaintNumber
      ? [sourceComplaintNumber]
      : []

  if (!normalizedNumbers.length) {
    return '-'
  }

  if ((relatedComplaintCount ?? normalizedNumbers.length) <= 1) {
    return `来源客诉：${normalizedNumbers[0]}`
  }

  return `来源客诉 ${relatedComplaintCount ?? normalizedNumbers.length} 条：${normalizedNumbers.join('、')}`
}

export function getPreferredEightDTab(status?: EightDStatus): EightDActiveTab {
  switch (status) {
    case 'in_review':
      return 'review'
    case 'd4_d7_completed':
    case 'd8_in_progress':
    case 'approved':
    case 'closed':
      return 'd8'
    case 'draft':
    case 'd0_d3_completed':
    case 'd4_d7_in_progress':
    case 'rejected':
    default:
      return 'd4-d7'
  }
}
