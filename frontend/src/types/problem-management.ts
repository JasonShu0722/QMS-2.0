export type ProblemResponseMode = 'brief' | 'eight_d'

export type ProblemHandlingLevel = 'simple' | 'complex' | 'major'

export type ProblemRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type ProblemModuleKey =
  | 'customer_quality'
  | 'process_quality'
  | 'incoming_quality'
  | 'new_product_quality'
  | 'audit_management'

export type ProblemCategoryKey =
  | 'CQ0'
  | 'CQ1'
  | 'PQ0'
  | 'PQ1'
  | 'IQ0'
  | 'IQ1'
  | 'DQ0'
  | 'DQ1'
  | 'AQ0'
  | 'AQ1'
  | 'AQ2'
  | 'AQ3'

export type UnifiedProblemStatus =
  | 'open'
  | 'assigned'
  | 'responding'
  | 'pending_review'
  | 'verifying'
  | 'approved'
  | 'closed'
  | 'rejected'

export interface ProblemCategoryItem {
  key: ProblemCategoryKey
  category_code: string
  subcategory_code: string
  module_key: ProblemModuleKey
  label: string
}

export interface NumberingRuleItem {
  issue_prefix: string
  report_prefix: string
  issue_pattern: string
  report_pattern: string
}

export interface ProblemManagementCatalogResponse {
  response_modes: ProblemResponseMode[]
  handling_levels: ProblemHandlingLevel[]
  categories: ProblemCategoryItem[]
  numbering_rule: NumberingRuleItem
}

export interface InternalUserOption {
  id: number
  username: string
  full_name: string
  department?: string | null
  position?: string | null
}

export interface ProblemIssueSummaryQuery {
  module_key?: ProblemModuleKey
  problem_category_key?: ProblemCategoryKey
  risk_level?: ProblemRiskLevel
  response_mode?: ProblemResponseMode
  unified_status?: UnifiedProblemStatus
  keyword?: string
  only_assigned_to_me?: boolean
  only_actionable_to_me?: boolean
  only_created_by_me?: boolean
  only_overdue?: boolean
  page?: number
  page_size?: number
}

export interface ProblemIssueSummaryItem {
  source_type: 'customer_complaint' | 'process_issue' | 'trial_issue' | 'audit_nc' | 'scar' | string
  source_id: number
  source_parent_id?: number | null
  source_label: string
  problem_report_id?: number | null
  problem_number?: string | null
  eight_d_number?: string | null
  risk_level?: ProblemRiskLevel | string | null
  module_key: ProblemModuleKey | string
  problem_category_key: ProblemCategoryKey | string
  problem_category_label: string
  reference_no?: string | null
  title: string
  raw_status: string
  unified_status: UnifiedProblemStatus
  responsible_dept?: string | null
  assigned_to?: number | null
  action_owner_id?: number | null
  created_by_id?: number | null
  owner_id?: number | null
  verified_by?: number | null
  response_mode?: ProblemResponseMode | null
  customer_name?: string | null
  requires_physical_analysis?: boolean | null
  is_overdue: boolean
  due_at?: string | null
  created_at: string
  updated_at: string
}

export interface ProblemIssueSummaryListResponse {
  total: number
  page: number
  page_size: number
  module_counts?: Record<string, number>
  items: ProblemIssueSummaryItem[]
}

export interface ProblemReportSourceCreate {
  source_type: string
  source_id: number
  source_parent_id?: number | null
  source_number?: string | null
  is_primary?: boolean
}

export interface ProblemReportSourceResponse extends ProblemReportSourceCreate {
  id: number
  problem_report_id?: number | null
  created_at?: string | null
}

export interface ProblemReportSourcesUpdate {
  sources: ProblemReportSourceCreate[]
}

export interface ProblemReportCreate {
  module_key?: ProblemModuleKey | string | null
  problem_category_key: ProblemCategoryKey | string
  title: string
  description?: string | null
  risk_level?: ProblemRiskLevel
  response_mode?: ProblemResponseMode
  responsible_dept?: string | null
  assigned_to?: number | null
  due_at?: string | null
  sources?: ProblemReportSourceCreate[]
}

export interface ProblemReportBriefResponse {
  root_cause?: string | null
  containment_action?: string | null
  corrective_action?: string | null
  evidence_files?: string[]
}

export interface ProblemReportReview {
  approved: boolean
  review_comment?: string | null
}

export interface ProblemReportClose {
  close_comment?: string | null
}

export interface ProblemReportResponse {
  id: number
  problem_number: string
  eight_d_number?: string | null
  module_key: ProblemModuleKey | string
  problem_category_key: ProblemCategoryKey | string
  problem_category_label: string
  title: string
  description?: string | null
  risk_level: ProblemRiskLevel | string
  response_mode: ProblemResponseMode | string
  status: UnifiedProblemStatus | string
  responsible_dept?: string | null
  assigned_to?: number | null
  action_owner_id?: number | null
  owner_id?: number | null
  created_by?: number | null
  verified_by?: number | null
  closed_by?: number | null
  brief_response?: Record<string, unknown> | null
  due_at?: string | null
  reviewed_at?: string | null
  closed_at?: string | null
  rejected_reason?: string | null
  reopened_count: number
  created_at: string
  updated_at: string
  sources: ProblemReportSourceResponse[]
}
