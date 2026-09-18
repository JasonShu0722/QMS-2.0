/**
 * 审核管理类型定义
 * Audit Management Type Definitions
 */

// ==================== 审核计划类型 ====================

export interface AuditPlan {
  id: number;
  audit_type: 'system_audit' | 'process_audit' | 'product_audit' | 'customer_audit';
  audit_name: string;
  planned_date: string;
  auditor_id: number;
  auditee_dept: string;
  notes?: string;
  status: 'planned' | 'in_progress' | 'completed' | 'postponed' | 'cancelled';
  postpone_reason?: string;
  postpone_approved_by?: number;
  postpone_approved_at?: string;
  created_at: string;
  updated_at: string;
  created_by?: number;
}

export interface AuditPlanCreate {
  audit_type: string;
  audit_name: string;
  planned_date: string;
  auditor_id: number;
  auditee_dept: string;
  notes?: string;
}

export interface AuditPlanUpdate {
  audit_type?: string;
  audit_name?: string;
  planned_date?: string;
  auditor_id?: number;
  auditee_dept?: string;
  notes?: string;
  status?: string;
}

export interface AuditPlanPostponeRequest {
  new_planned_date: string;
  postpone_reason: string;
}

export interface AuditPlanListResponse {
  total: number;
  items: AuditPlan[];
  page: number;
  page_size: number;
}

export interface AuditPlanYearViewResponse {
  year: number;
  total_plans: number;
  by_type: Record<string, number>;
  by_status: Record<string, number>;
  by_month: Record<string, AuditPlan[]>;
}

// ==================== 审核模板类型 ====================

export interface AuditTemplate {
  id: number;
  template_name: string;
  audit_type: 'system_audit' | 'process_audit' | 'product_audit' | 'custom';
  checklist_items: Record<string, any>;
  scoring_rules: Record<string, any>;
  description?: string;
  is_active: boolean;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
  created_by?: number;
}

export interface AuditTemplateCreate {
  template_name: string;
  audit_type: string;
  checklist_items: Record<string, any>;
  scoring_rules: Record<string, any>;
  description?: string;
  is_active?: boolean;
}

export interface AuditTemplateUpdate {
  template_name?: string;
  audit_type?: string;
  checklist_items?: Record<string, any>;
  scoring_rules?: Record<string, any>;
  description?: string;
  is_active?: boolean;
}

export interface AuditTemplateListResponse {
  total: number;
  items: AuditTemplate[];
  page: number;
  page_size: number;
}

// ==================== 审核执行类型 ====================

export interface AuditExecution {
  id: number;
  audit_plan_id: number;
  template_id: number;
  audit_date: string;
  auditor_id: number;
  audit_team?: Record<string, any>;
  checklist_results: Record<string, any>;
  final_score?: number;
  grade?: string;
  audit_report_path?: string;
  summary?: string;
  status: 'draft' | 'completed' | 'nc_open' | 'nc_closed';
  created_at: string;
  updated_at: string;
  created_by?: number;
}

export interface AuditExecutionCreate {
  audit_plan_id: number;
  template_id: number;
  audit_date: string;
  auditor_id: number;
  audit_team?: Record<string, any>;
  summary?: string;
}

export interface AuditExecutionUpdate {
  audit_date?: string;
  auditor_id?: number;
  audit_team?: Record<string, any>;
  summary?: string;
  status?: string;
}

export interface ChecklistItemScore {
  item_id: string;
  score: number;
  comment?: string;
  evidence_photos?: string[];
  is_nc: boolean;
  nc_description?: string;
}

export interface ChecklistSubmit {
  checklist_results: ChecklistItemScore[];
}

export interface AuditExecutionListResponse {
  total: number;
  items: AuditExecution[];
  page: number;
  page_size: number;
}

export interface AuditReportRequest {
  include_radar_chart?: boolean;
  include_photos?: boolean;
}

export interface AuditReportResponse {
  report_path: string;
  report_url: string;
}

// ==================== 审核NC类型 ====================

export interface AuditNC {
  id: number;
  audit_id: number;
  audit_type?: AuditPlan['audit_type'];
  problem_category_key?: 'AQ0' | 'AQ1' | 'AQ2' | 'AQ3';
  problem_category_label?: string;
  nc_item: string;
  nc_description: string;
  evidence_photo_path?: string;
  responsible_dept: string;
  assigned_to?: number;
  root_cause?: string;
  corrective_action?: string;
  corrective_evidence?: string;
  verification_status: 'open' | 'assigned' | 'submitted' | 'verified' | 'rejected' | 'closed' | 'pending' | 'responded';
  verified_by?: number;
  verified_at?: string;
  verification_comment?: string;
  deadline: string;
  closed_at?: string;
  created_at: string;
  updated_at: string;
  created_by?: number;
  is_overdue: boolean;
  remaining_hours?: number;
}

export interface AuditNCAssign {
  assigned_to: number;
  deadline: string;
  comment?: string;
}

export interface AuditNCResponse {
  root_cause: string;
  corrective_action: string;
  corrective_evidence?: string;
}

export interface AuditNCVerify {
  is_approved: boolean;
  verification_comment: string;
}

export interface AuditNCClose {
  closing_comment?: string;
}

export interface AuditNCQuery {
  audit_id?: number;
  assigned_to?: number;
  responsible_dept?: string;
  problem_category_key?: 'AQ0' | 'AQ1' | 'AQ2' | 'AQ3';
  verification_status?: string;
  is_overdue?: boolean;
  page?: number;
  page_size?: number;
}

export interface AuditNCListResponse {
  items: AuditNC[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// ==================== 客户审核类型 ====================

export interface CustomerAudit {
  id: number;
  customer_name: string;
  audit_type: 'system' | 'process' | 'product' | 'qualification' | 'potential_supplier';
  audit_date: string;
  final_result: 'passed' | 'conditional_passed' | 'failed' | 'pending';
  score?: number;
  external_issue_list_path?: string;
  internal_contact?: string;
  audit_report_path?: string;
  summary?: string;
  status: 'completed' | 'issue_open' | 'issue_closed';
  created_at: string;
  updated_at: string;
  created_by?: number;
}

export interface CustomerAuditCreate {
  customer_name: string;
  audit_type: string;
  audit_date: string;
  final_result: string;
  score?: number;
  external_issue_list_path?: string;
  internal_contact?: string;
  audit_report_path?: string;
  summary?: string;
}

export interface CustomerAuditUpdate {
  customer_name?: string;
  audit_type?: string;
  audit_date?: string;
  final_result?: string;
  score?: number;
  external_issue_list_path?: string;
  internal_contact?: string;
  audit_report_path?: string;
  summary?: string;
  status?: string;
}

export interface CustomerAuditQuery {
  customer_name?: string;
  audit_type?: string;
  final_result?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  page?: number;
  page_size?: number;
}

export interface CustomerAuditListResponse {
  total: number;
  items: CustomerAudit[];
}

export interface CustomerAuditIssueTaskCreate {
  customer_audit_id: number;
  issue_description: string;
  responsible_dept: string;
  assigned_to?: number;
  deadline: string;
  priority?: string;
  response_mode?: 'brief' | 'eight_d';
}

export interface CustomerAuditIssueTaskResponse {
  id: number;
  customer_audit_id: number;
  issue_description: string;
  responsible_dept: string;
  assigned_to?: number;
  deadline: string;
  priority?: string;
  status: string;
  root_cause?: string;
  corrective_action?: string;
  corrective_evidence?: string;
  verified_by?: number;
  verified_at?: string;
  verification_comment?: string;
  closed_at?: string;
  created_at: string;
  updated_at: string;
  created_by?: number;
  problem_category_key?: 'AQ3';
  problem_category_label?: string;
  response_mode?: 'brief' | 'eight_d';
  problem_number?: string;
  eight_d_number?: string;
}
