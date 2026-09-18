/**
 * Process Quality Management Types
 */

// ==================== Process Defect ====================

export type ResponsibilityCategory =
  | 'material_defect'
  | 'operation_defect'
  | 'equipment_defect'
  | 'process_defect'
  | 'design_defect'

export interface ProcessDefect {
  id: number
  defect_date: string
  work_order: string
  process_id: string
  line_id: string
  defect_type: string
  defect_qty: number
  responsibility_category: ResponsibilityCategory
  operator_id: number | null
  recorded_by: number
  material_code: string | null
  supplier_id: number | null
  remarks: string | null
  created_at: string
  updated_at: string
  operator_name?: string
  recorded_by_name?: string
  supplier_name?: string
}

export interface ProcessDefectCreate {
  defect_date: string
  work_order: string
  process_id: string
  line_id: string
  defect_type: string
  defect_qty: number
  responsibility_category: ResponsibilityCategory
  operator_id?: number
  material_code?: string
  supplier_id?: number
  remarks?: string
}

export interface ProcessDefectUpdate {
  defect_date?: string
  work_order?: string
  process_id?: string
  line_id?: string
  defect_type?: string
  defect_qty?: number
  responsibility_category?: ResponsibilityCategory
  operator_id?: number
  material_code?: string
  supplier_id?: number
  remarks?: string
}

export interface ProcessDefectListQuery {
  defect_date_start?: string
  defect_date_end?: string
  work_order?: string
  process_id?: string
  line_id?: string
  defect_type?: string
  responsibility_category?: ResponsibilityCategory
  supplier_id?: number
  material_code?: string
  page?: number
  page_size?: number
}

export interface DefectTypeOption {
  value: string
  label: string
  category?: string
}

export interface ResponsibilityCategoryOption {
  value: ResponsibilityCategory
  label: string
  description: string
  links_to_metric?: string
}

// ==================== Process Issue ====================

export type ProcessIssueStatus =
  | 'open'
  | 'in_analysis'
  | 'in_verification'
  | 'closed'
  | 'cancelled'

export interface ProcessIssue {
  id: number
  issue_number: string
  issue_description: string
  responsibility_category: ResponsibilityCategory
  assigned_to: number
  root_cause: string | null
  containment_action: string | null
  corrective_action: string | null
  verification_period: number | null
  verification_start_date: string | null
  verification_end_date: string | null
  status: ProcessIssueStatus
  related_defect_ids: string | null
  evidence_files: string | null
  created_by: number
  verified_by: number | null
  closed_by: number | null
  closed_at: string | null
  created_at: string
  updated_at: string
  is_overdue: boolean
}

export interface ProcessIssueCreate {
  issue_description: string
  responsibility_category: ResponsibilityCategory
  assigned_to: number
  related_defect_ids?: number[]
}

export interface ProcessIssueResponse {
  root_cause: string
  containment_action: string
  corrective_action: string
  verification_period: number
  evidence_files?: string[]
}

export interface ProcessIssueVerification {
  verification_result: boolean
  verification_comments?: string
}

export interface ProcessIssueClose {
  close_comments?: string
}

export interface ProcessIssueFilter {
  status?: ProcessIssueStatus
  responsibility_category?: ResponsibilityCategory
  assigned_to?: number
  created_by?: number
  is_overdue?: boolean
  start_date?: string
  end_date?: string
  page?: number
  page_size?: number
}

export interface ProcessIssueListResponse {
  total: number
  page: number
  page_size: number
  items: ProcessIssue[]
}

export interface ProcessIssueCreateResponse {
  id: number
  issue_number: string
  message: string
}

export interface ProcessIssueOperationResponse {
  success: boolean
  message: string
  issue_number: string
}
