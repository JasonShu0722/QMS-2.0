import type {
  ComplaintStatus,
  CustomerComplaint,
  CustomerComplaintPhysicalAnalysisStatus,
  CustomerComplaintPhysicalDispositionStatus,
} from '@/types/customer-quality'

export type CustomerComplaintStatusLike =
  | ComplaintStatus
  | 'pending_analysis'
  | 'in_progress'
  | 'pending_8d'
  | 'under_review'

type StatusMeta = {
  label: string
  tagType: 'success' | 'warning' | 'info' | 'primary' | 'danger'
}

type SimpleStatusMeta = {
  label: string
  tagType: 'success' | 'warning' | 'info' | 'primary'
}

type EightDLaunchCandidate = Pick<
  CustomerComplaint,
  | 'complaint_type'
  | 'customer_id'
  | 'customer_code'
  | 'requires_physical_analysis'
  | 'physical_analysis_status'
  | 'physical_disposition_plan'
  | 'eight_d_report_id'
>

const STATUS_META: Record<CustomerComplaintStatusLike, StatusMeta> = {
  pending: { label: '待处理', tagType: 'warning' },
  in_analysis: { label: '分析中', tagType: 'primary' },
  in_response: { label: '待回复', tagType: 'warning' },
  in_review: { label: '审核中', tagType: 'info' },
  closed: { label: '已关闭', tagType: 'success' },
  rejected: { label: '已驳回', tagType: 'danger' },
  pending_analysis: { label: '待一次因分析', tagType: 'warning' },
  in_progress: { label: '进行中', tagType: 'primary' },
  pending_8d: { label: '待 8D 提交', tagType: 'warning' },
  under_review: { label: '审核中', tagType: 'info' },
}

const DISPOSITION_STATUS_META: Record<CustomerComplaintPhysicalDispositionStatus, SimpleStatusMeta> = {
  pending: { label: '待备案', tagType: 'info' },
  in_progress: { label: '处理中', tagType: 'warning' },
  completed: { label: '已完成', tagType: 'success' },
}

const ANALYSIS_STATUS_META: Record<CustomerComplaintPhysicalAnalysisStatus, SimpleStatusMeta> = {
  pending: { label: '待分派', tagType: 'info' },
  assigned: { label: '已分派', tagType: 'primary' },
  completed: { label: '已完成', tagType: 'success' },
}

export function buildCustomerComplaintStatusOptions() {
  return [
    { value: 'pending', label: STATUS_META.pending.label },
    { value: 'in_analysis', label: STATUS_META.in_analysis.label },
    { value: 'in_response', label: STATUS_META.in_response.label },
    { value: 'in_review', label: STATUS_META.in_review.label },
    { value: 'rejected', label: STATUS_META.rejected.label },
    { value: 'closed', label: STATUS_META.closed.label },
  ] as Array<{ value: ComplaintStatus; label: string }>
}

export function getCustomerComplaintStatusLabel(status: CustomerComplaintStatusLike): string {
  return STATUS_META[status]?.label ?? status
}

export function getCustomerComplaintStatusType(
  status: CustomerComplaintStatusLike
): StatusMeta['tagType'] {
  return STATUS_META[status]?.tagType ?? 'info'
}

export function buildCustomerComplaintDispositionStatusOptions() {
  return [
    { value: 'in_progress', label: DISPOSITION_STATUS_META.in_progress.label },
    { value: 'completed', label: DISPOSITION_STATUS_META.completed.label },
  ] as Array<{ value: Exclude<CustomerComplaintPhysicalDispositionStatus, 'pending'>; label: string }>
}

export function getCustomerComplaintDispositionStatusLabel(
  status: CustomerComplaintPhysicalDispositionStatus
): string {
  return DISPOSITION_STATUS_META[status]?.label ?? status
}

export function getCustomerComplaintDispositionStatusType(
  status: CustomerComplaintPhysicalDispositionStatus
): SimpleStatusMeta['tagType'] {
  return DISPOSITION_STATUS_META[status]?.tagType ?? 'info'
}

export function buildCustomerComplaintAnalysisStatusOptions() {
  return [
    { value: 'assigned', label: ANALYSIS_STATUS_META.assigned.label },
    { value: 'completed', label: ANALYSIS_STATUS_META.completed.label },
  ] as Array<{ value: Exclude<CustomerComplaintPhysicalAnalysisStatus, 'pending'>; label: string }>
}

export function getCustomerComplaintPhysicalAnalysisStatusLabel(
  status: CustomerComplaintPhysicalAnalysisStatus
): string {
  return ANALYSIS_STATUS_META[status]?.label ?? status
}

export function getCustomerComplaintPhysicalAnalysisStatusType(
  status: CustomerComplaintPhysicalAnalysisStatus
): SimpleStatusMeta['tagType'] {
  return ANALYSIS_STATUS_META[status]?.tagType ?? 'info'
}

export function canHandleCustomerComplaintAnalysis(
  complaint: Pick<CustomerComplaint, 'status' | 'requires_physical_analysis'>
): boolean {
  return complaint.requires_physical_analysis && complaint.status !== 'closed'
}

export function canHandleCustomerComplaintDisposition(
  complaint: Pick<CustomerComplaint, 'status' | 'requires_physical_analysis'>
): boolean {
  return !complaint.requires_physical_analysis && complaint.status !== 'closed'
}

export function canOpenCustomerComplaintEightD(
  complaint: Pick<
    CustomerComplaint,
    'requires_physical_analysis' | 'physical_analysis_status' | 'physical_disposition_plan' | 'eight_d_report_id'
  >
): boolean {
  if (Boolean(complaint.eight_d_report_id)) {
    return true
  }

  if (complaint.requires_physical_analysis) {
    return complaint.physical_analysis_status === 'completed'
  }

  return Boolean(complaint.physical_disposition_plan)
}

export function canBatchLaunchCustomerComplaintEightD(
  complaints: EightDLaunchCandidate[]
): boolean {
  return getCustomerComplaintBatchLaunchHint(complaints) === ''
}

export function canLaunchCustomerComplaintEightDSelection(
  complaints: EightDLaunchCandidate[]
): boolean {
  return getCustomerComplaintEightDSelectionLaunchHint(complaints) === ''
}

export function getCustomerComplaintEightDSelectionLaunchHint(
  complaints: EightDLaunchCandidate[]
): string {
  if (!complaints.length) {
    return '请至少选择一条客诉记录'
  }

  if (complaints.length === 1) {
    const complaint = complaints[0]
    if (canOpenCustomerComplaintEightD(complaint)) {
      return ''
    }
    return '请先完成客诉的实物处理方案备案或实物解析'
  }

  return getCustomerComplaintBatchLaunchHint(complaints)
}

export function getCustomerComplaintBatchLaunchHint(
  complaints: EightDLaunchCandidate[]
): string {
  if (!complaints.length) {
    return '请选择至少两条客诉后再批量发起 8D'
  }

  if (complaints.length < 2) {
    return '批量发起 8D 需要至少选择两条客诉'
  }

  if (complaints.some((complaint) => Boolean(complaint.eight_d_report_id))) {
    return '已发起 8D 的客诉不能再次参与批量发起'
  }

  const firstComplaint = complaints[0]
  const sameComplaintType = complaints.every(
    (complaint) => complaint.complaint_type === firstComplaint.complaint_type
  )
  if (!sameComplaintType) {
    return '批量发起 8D 仅支持同一客诉类型'
  }

  const sameCustomer = complaints.every(
    (complaint) =>
      (complaint.customer_id ?? null) === (firstComplaint.customer_id ?? null) &&
      complaint.customer_code === firstComplaint.customer_code
  )
  if (!sameCustomer) {
    return '批量发起 8D 仅支持同一客户的客诉'
  }

  const allReady = complaints.every((complaint) => canOpenCustomerComplaintEightD(complaint))
  if (!allReady) {
    return '请先完成所选客诉的实物处理备案或实物解析'
  }

  return ''
}

export function getCustomerComplaintEightDActionLabel(
  complaint: Pick<CustomerComplaint, 'eight_d_report_id'>
): string {
  return complaint.eight_d_report_id ? '查看8D' : '发起8D'
}

export function getCustomerComplaintNextStepHint(
  complaint: Pick<
    CustomerComplaint,
    'requires_physical_analysis' | 'physical_analysis_status' | 'physical_disposition_plan' | 'eight_d_report_id'
  >
): string {
  if (complaint.eight_d_report_id) {
    return '已进入 8D 报告跟进，可继续查看并推进 D4-D8 闭环。'
  }

  if (complaint.requires_physical_analysis) {
    if (complaint.physical_analysis_status === 'pending') {
      return '待分派实物解析责任人，完成一次因分析后再评估是否发起 8D。'
    }

    if (complaint.physical_analysis_status === 'assigned') {
      return '实物解析处理中，待一次因分析完成后可发起 8D。'
    }

    return '实物解析已完成，可按需发起 8D 报告。'
  }

  if (complaint.physical_disposition_plan) {
    return '实物处理方案已备案，可按需发起 8D 报告。'
  }

  return '待补充实物处理方案备案。'
}
