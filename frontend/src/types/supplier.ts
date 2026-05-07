/**
 * 供应商质量管理相关类型定义
 */

/**
 * 供应商基本信息
 */
export interface Supplier {
  id: number
  name: string
  code: string
  contact_person?: string
  contact_email?: string
  contact_phone?: string
  iso9001_cert?: string
  iso9001_expiry?: string
  iatf16949_cert?: string
  iatf16949_expiry?: string
  status: 'active' | 'frozen' | 'pending'
  created_at: string
  updated_at: string
}

/**
 * SCAR (Supplier Corrective Action Request) 单据
 */
export interface SCAR {
  id: number
  scar_number: string
  supplier_id: number
  supplier_name?: string
  material_code: string
  material_category?: 'structure' | 'electronic'
  defect_description: string
  defect_qty: number
  severity: 'low' | 'medium' | 'high' | 'critical'
  status: 'open' | 'supplier_responding' | 'under_review' | 'approved' | 'rejected' | 'closed'
  current_handler_id?: number
  current_handler_name?: string
  deadline: string
  created_at: string
  updated_at: string
  created_by?: number
  has_8d_report?: boolean
  eight_d_report?: EightDReport
}

/**
 * 8D 报告
 */
export interface EightDReport {
  id: number
  scar_id: number
  d0_d3_data?: Record<string, any>
  d4_d7_data?: Record<string, any>
  d8_data?: Record<string, any>
  status: 'draft' | 'submitted' | 'approved' | 'rejected'
  submitted_by?: number
  reviewed_by?: number
  review_comments?: string
  submitted_at?: string
  reviewed_at?: string
  submitter_name?: string
  reviewer_name?: string
  scar_number?: string
  created_at: string
  updated_at: string
}

/**
 * 供应商审核
 */
export interface SupplierAudit {
  id: number
  supplier_id: number
  supplier_name?: string
  audit_type: 'qualification' | 'annual' | 'special'
  audit_date: string
  auditor_id: number
  auditor_name?: string
  audit_result: 'pass' | 'conditional_pass' | 'fail'
  score?: number
  nc_items?: Array<{
    item: string
    description: string
    severity: string
  }>
  created_at: string
  updated_at: string
}

/**
 * 供应商绩效
 */
export interface SupplierPerformance {
  id: number
  supplier_id: number
  supplier_name?: string
  month: string
  incoming_quality_score: number
  process_quality_score: number
  cooperation_score: number
  final_score: number
  grade: 'A' | 'B' | 'C' | 'D'
  deduction_details?: Record<string, any>
  created_at: string
  updated_at: string
}

/**
 * 供应商质量目标
 */
export interface SupplierTarget {
  id: number
  supplier_id: number
  supplier_name?: string
  year: number
  target_type: string
  target_value: number
  is_signed: boolean
  signed_at?: string
  created_at: string
  updated_at: string
}

/**
 * PPAP 提交
 */
export interface PPAP {
  id: number
  supplier_id: number
  supplier_name?: string
  material_code: string
  ppap_level: 1 | 2 | 3 | 4 | 5
  submission_date: string
  status: 'pending' | 'in_review' | 'approved' | 'rejected'
  documents?: Record<string, any>
  reviewer_id?: number
  reviewer_name?: string
  review_comments?: string
  created_at: string
  updated_at: string
}

/**
 * 检验规范
 */
export interface InspectionSpec {
  id: number
  material_code: string
  supplier_id: number
  supplier_name?: string
  version: string
  sip_file_path?: string
  key_characteristics?: Array<{
    name: string
    specification: string
    method: string
  }>
  status: 'draft' | 'submitted' | 'approved' | 'active' | 'archived'
  created_at: string
  updated_at: string
}

/**
 * 条码校验记录
 */
export interface BarcodeValidation {
  id: number
  material_code: string
  barcode: string
  validation_result: 'pass' | 'fail'
  validation_message?: string
  scanned_at: string
  scanned_by?: number
  batch_id?: string
}

/**
 * 供应商仪表盘数据
 */
export interface SupplierDashboardData {
  performance_status: {
    grade: 'A' | 'B' | 'C' | 'D'
    score: number
    deduction_this_month: number
  }
  action_required_tasks: Array<{
    id: number
    title: string
    description: string
    urgency: 'normal' | 'warning' | 'danger'
    link: string
    deadline?: string
  }>
  recent_scars: SCAR[]
  recent_audits: SupplierAudit[]
}

/**
 * SCAR 列表查询参数
 */
export interface SCARListParams {
  page?: number
  page_size?: number
  status?: string
  supplier_id?: number
  severity?: string
  start_date?: string
  end_date?: string
}

export interface SCARSupplierOption {
  id: number
  code: string
  name: string
  status: string
}

export interface SCARInternalUserOption {
  id: number
  username: string
  full_name: string
  department?: string
  position?: string
}

/**
 * 分页响应
 */
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  total_pages: number
}
