import type {
  ProblemCategoryKey,
  ProblemReportResponse,
  ProblemResponseMode,
  ProblemRiskLevel,
} from './problem-management'

/**
 * New Product Quality Management Types
 * 新品质量管理类型定义
 */

// ==================== 经验教训相关 ====================

export type SourceModuleType = 'supplier_quality' | 'process_quality' | 'customer_quality' | 'manual'

export interface LessonLearned {
  id: number
  lesson_title: string
  lesson_content: string
  source_module: SourceModuleType
  source_record_id?: number
  root_cause: string
  preventive_action: string
  applicable_scenarios?: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface LessonLearnedCreate {
  lesson_title: string
  lesson_content: string
  source_module: SourceModuleType
  source_record_id?: number
  root_cause: string
  preventive_action: string
  applicable_scenarios?: string
  is_active?: boolean
}

export interface ProjectLessonCheck {
  id: number
  project_id: number
  lesson_id: number
  lesson_title: string
  is_applicable: boolean
  reason_if_not?: string
  evidence_file_path?: string
  evidence_description?: string
  checked_by?: number
  checked_at?: string
  verified_by?: number
  verified_at?: string
  verification_result?: string
  verification_comment?: string
  created_at: string
  updated_at: string
}

export interface ProjectLessonCheckRequest {
  lesson_id: number
  is_applicable: boolean
  reason_if_not?: string
  evidence_description?: string
}

// ==================== 新品项目相关 ====================

export type ProjectStage = 'concept' | 'design' | 'development' | 'validation' | 'trial_production' | 'sop' | 'closed'
export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'cancelled'
export type ReviewResult = 'passed' | 'conditional_pass' | 'failed' | 'pending'

export interface NewProductProject {
  id: number
  project_code: string
  project_name: string
  product_type?: string
  project_manager?: string
  project_manager_id?: number
  current_stage: ProjectStage
  status: ProjectStatus
  planned_sop_date?: string
  actual_sop_date?: string
  created_at: string
  updated_at: string
}

export interface NewProductProjectCreate {
  project_code: string
  project_name: string
  product_type?: string
  project_manager?: string
  project_manager_id?: number
  planned_sop_date?: string
}

// ==================== 阶段评审相关 ====================

export interface DeliverableItem {
  name: string
  required: boolean
  file_path?: string
  status: 'missing' | 'submitted' | 'approved'
  description?: string
  uploaded_at?: string
  uploaded_by?: number
}

export interface StageReview {
  id: number
  project_id: number
  stage_name: string
  review_date?: string
  planned_review_date?: string
  deliverables?: DeliverableItem[]
  review_result: ReviewResult
  review_comments?: string
  reviewer_ids?: string
  conditional_requirements?: string
  conditional_deadline?: string
  created_at: string
  updated_at: string
}

export interface StageReviewCreate {
  stage_name: string
  planned_review_date?: string
  deliverables?: DeliverableItem[]
  reviewer_ids?: string
}

export interface StageReviewApproval {
  review_result: ReviewResult
  review_comments?: string
  conditional_requirements?: string
  conditional_deadline?: string
}

// ==================== 试产管理相关 ====================

export type TrialStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled'
export type IMSSyncStatus = 'pending' | 'synced' | 'failed'

export interface TrialProduction {
  id: number
  project_id: number
  work_order: string
  trial_batch?: string
  trial_date?: string
  target_metrics?: Record<string, any>
  actual_metrics?: Record<string, any>
  ims_sync_status?: IMSSyncStatus
  ims_sync_at?: string
  ims_sync_error?: string
  status: TrialStatus
  summary_report_path?: string
  summary_comments?: string
  created_at: string
  updated_at: string
}

export interface TrialProductionCreate {
  project_id: number
  work_order: string
  trial_batch?: string
  trial_date?: string
  target_metrics?: Record<string, any>
  summary_comments?: string
}

export interface ManualMetricsInput {
  cpk?: number
  destructive_test_result?: string
  appearance_score?: number
  dimension_pass_rate?: number
  other_metrics?: Record<string, any>
}

export interface TrialProductionSummary {
  trial_production: TrialProduction
  target_vs_actual: Record<string, any>
  overall_status: 'pass' | 'fail'
  pass_count: number
  fail_count: number
  recommendations?: string
}

// ==================== 试产问题相关 ====================

export type IssueType = 'design' | 'tooling' | 'process' | 'material' | 'equipment' | 'other'
export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed' | 'escalated'
export type LegacyApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface TrialIssue {
  id: number
  trial_id: number
  issue_number?: string
  issue_description: string
  issue_type: IssueType
  assigned_to?: number
  assigned_dept?: string
  root_cause?: string
  solution?: string
  solution_file_path?: string
  verification_method?: string
  verification_result?: string
  verified_by?: number
  verified_at?: string
  status: IssueStatus
  is_escalated_to_8d: boolean
  eight_d_id?: number
  escalated_at?: string
  escalation_reason?: string
  is_legacy_issue: boolean
  legacy_approval_status?: LegacyApprovalStatus
  legacy_approval_by?: number
  legacy_approval_at?: string
  risk_acknowledgement_path?: string
  deadline?: string
  resolved_at?: string
  closed_at?: string
  created_at: string
  updated_at: string
}

export interface TrialIssueCreate {
  trial_id: number
  issue_description: string
  issue_type: IssueType
  assigned_to?: number
  assigned_dept?: string
  deadline?: string
}

export interface TrialIssueStatistics {
  total_issues: number
  open_issues: number
  in_progress_issues: number
  resolved_issues: number
  closed_issues: number
  escalated_issues: number
  legacy_issues: number
  issues_by_type: Record<string, number>
}

// ==================== 分页响应 ====================

export type NewProductDefectSourceType = 'trial_defect' | 'customer_complaint'
export type NewProductDefectStatus = 'registered' | 'promoted' | 'closed'

export interface NewProductDefect {
  id: number
  defect_number: string
  source_type: NewProductDefectSourceType
  status: NewProductDefectStatus
  defect_date: string
  project_id?: number | null
  trial_id?: number | null
  customer_name?: string | null
  customer_complaint_number?: string | null
  product_code?: string | null
  product_name?: string | null
  defect_type: string
  defect_description: string
  defect_qty?: number | null
  responsible_dept?: string | null
  recorded_by: number
  problem_report_id?: number | null
  problem_number?: string | null
  eight_d_number?: string | null
  remarks?: string | null
  created_at: string
  updated_at: string
}

export interface NewProductDefectCreate {
  source_type: NewProductDefectSourceType
  defect_date: string
  project_id?: number | null
  trial_id?: number | null
  customer_name?: string | null
  customer_complaint_number?: string | null
  product_code?: string | null
  product_name?: string | null
  defect_type: string
  defect_description: string
  defect_qty?: number | null
  responsible_dept?: string | null
  remarks?: string | null
}

export interface NewProductDefectUpdate extends Partial<NewProductDefectCreate> {}

export interface NewProductDefectProblemReportCreate {
  problem_category_key?: Extract<ProblemCategoryKey, 'DQ0' | 'DQ1'>
  response_mode?: ProblemResponseMode
  risk_level?: ProblemRiskLevel
  assigned_to?: number | null
  due_at?: string | null
  title?: string | null
  description?: string | null
}

export interface NewProductDefectProblemReportResponse {
  defect: NewProductDefect
  report: ProblemReportResponse
}

export interface NewProductDefectListResponse {
  items: NewProductDefect[]
  total: number
  page: number
  page_size: number
}

export interface PaginatedResponse<T> {
  total: number
  items: T[]
  page: number
  page_size: number
}
