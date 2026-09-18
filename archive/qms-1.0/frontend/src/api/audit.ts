/**
 * 审核管理 API 客户端
 * Audit Management API Client
 */
import request from '@/utils/request';
import type {
  AuditPlan,
  AuditPlanCreate,
  AuditPlanUpdate,
  AuditPlanPostponeRequest,
  AuditPlanListResponse,
  AuditPlanYearViewResponse,
  AuditTemplate,
  AuditTemplateCreate,
  AuditTemplateUpdate,
  AuditTemplateListResponse,
  AuditExecution,
  AuditExecutionCreate,
  AuditExecutionUpdate,
  ChecklistSubmit,
  AuditExecutionListResponse,
  AuditReportRequest,
  AuditReportResponse,
  AuditNC,
  AuditNCAssign,
  AuditNCResponse as AuditNCResponseData,
  AuditNCVerify,
  AuditNCClose,
  AuditNCQuery,
  AuditNCListResponse,
  CustomerAudit,
  CustomerAuditCreate,
  CustomerAuditUpdate,
  CustomerAuditListResponse,
  CustomerAuditQuery,
  CustomerAuditIssueTaskCreate,
  CustomerAuditIssueTaskResponse
} from '@/types/audit';

// ==================== 审核计划 API ====================

/**
 * 获取审核计划列表
 */
export async function getAuditPlans(params?: {
  audit_type?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  page?: number;
  page_size?: number;
}): Promise<AuditPlanListResponse> {
  return request({
    url: '/api/v1/audit-plans',
    method: 'get',
    params
  });
}

/**
 * 获取年度审核计划视图
 */
export async function getAuditPlanYearView(year: number): Promise<AuditPlanYearViewResponse> {
  return request({
    url: `/api/v1/audit-plans/year/${year}`,
    method: 'get'
  });
}

/**
 * 获取审核计划详情
 */
export async function getAuditPlan(id: number): Promise<AuditPlan> {
  return request({
    url: `/api/v1/audit-plans/${id}`,
    method: 'get'
  });
}

/**
 * 创建审核计划
 */
export async function createAuditPlan(data: AuditPlanCreate): Promise<AuditPlan> {
  return request({
    url: '/api/v1/audit-plans',
    method: 'post',
    data
  });
}

/**
 * 更新审核计划
 */
export async function updateAuditPlan(id: number, data: AuditPlanUpdate): Promise<AuditPlan> {
  return request({
    url: `/api/v1/audit-plans/${id}`,
    method: 'put',
    data
  });
}

/**
 * 删除审核计划
 */
export async function deleteAuditPlan(id: number): Promise<{ message: string }> {
  return request({
    url: `/api/v1/audit-plans/${id}`,
    method: 'delete'
  });
}

/**
 * 申请延期
 */
export async function postponeAuditPlan(id: number, data: AuditPlanPostponeRequest): Promise<{ message: string }> {
  return request({
    url: `/api/v1/audit-plans/${id}/postpone`,
    method: 'post',
    data
  });
}

// ==================== 审核模板 API ====================

/**
 * 获取审核模板列表
 */
export async function getAuditTemplates(params?: {
  audit_type?: string;
  is_active?: boolean;
  page?: number;
  page_size?: number;
}): Promise<AuditTemplateListResponse> {
  return request({
    url: '/api/v1/audit-templates',
    method: 'get',
    params
  });
}

/**
 * 获取审核模板详情
 */
export async function getAuditTemplate(id: number): Promise<AuditTemplate> {
  return request({
    url: `/api/v1/audit-templates/${id}`,
    method: 'get'
  });
}

/**
 * 创建审核模板
 */
export async function createAuditTemplate(data: AuditTemplateCreate): Promise<AuditTemplate> {
  return request({
    url: '/api/v1/audit-templates',
    method: 'post',
    data
  });
}

/**
 * 更新审核模板
 */
export async function updateAuditTemplate(id: number, data: AuditTemplateUpdate): Promise<AuditTemplate> {
  return request({
    url: `/api/v1/audit-templates/${id}`,
    method: 'put',
    data
  });
}

/**
 * 删除审核模板
 */
export async function deleteAuditTemplate(id: number): Promise<{ message: string }> {
  return request({
    url: `/api/v1/audit-templates/${id}`,
    method: 'delete'
  });
}

// ==================== 审核执行 API ====================

/**
 * 获取审核执行记录列表
 */
export async function getAuditExecutions(params?: {
  audit_plan_id?: number;
  status?: string;
  start_date?: string;
  end_date?: string;
  page?: number;
  page_size?: number;
}): Promise<AuditExecutionListResponse> {
  return request({
    url: '/api/v1/audit-executions',
    method: 'get',
    params
  });
}

/**
 * 获取审核执行记录详情
 */
export async function getAuditExecution(id: number): Promise<AuditExecution> {
  return request({
    url: `/api/v1/audit-executions/${id}`,
    method: 'get'
  });
}

/**
 * 创建审核执行记录
 */
export async function createAuditExecution(data: AuditExecutionCreate): Promise<AuditExecution> {
  return request({
    url: '/api/v1/audit-executions',
    method: 'post',
    data
  });
}

/**
 * 更新审核执行记录
 */
export async function updateAuditExecution(id: number, data: AuditExecutionUpdate): Promise<AuditExecution> {
  return request({
    url: `/api/v1/audit-executions/${id}`,
    method: 'put',
    data
  });
}

/**
 * 提交检查表
 */
export async function submitChecklist(id: number, data: ChecklistSubmit): Promise<{ message: string; final_score: number; grade: string }> {
  return request({
    url: `/api/v1/audit-executions/${id}/checklist`,
    method: 'post',
    data
  });
}

/**
 * 生成审核报告
 */
export async function generateAuditReport(id: number, data?: AuditReportRequest): Promise<AuditReportResponse> {
  return request({
    url: `/api/v1/audit-executions/${id}/report`,
    method: 'post',
    data: data || {}
  });
}

// ==================== 审核NC API ====================

/**
 * 获取审核NC列表
 */
export async function getAuditNCs(params: AuditNCQuery): Promise<AuditNCListResponse> {
  return request({
    url: '/api/v1/audit-nc',
    method: 'get',
    params
  });
}

/**
 * 获取审核NC详情
 */
export async function getAuditNC(id: number): Promise<AuditNC> {
  return request({
    url: `/api/v1/audit-nc/${id}`,
    method: 'get'
  });
}

/**
 * 指派审核NC
 */
export async function assignAuditNC(id: number, data: AuditNCAssign): Promise<AuditNC> {
  return request({
    url: `/api/v1/audit-nc/${id}/assign`,
    method: 'post',
    data
  });
}

/**
 * 响应审核NC（责任人填写原因和措施）
 */
export async function respondAuditNC(id: number, data: AuditNCResponseData): Promise<AuditNC> {
  return request({
    url: `/api/v1/audit-nc/${id}/response`,
    method: 'post',
    data
  });
}

/**
 * 验证审核NC
 */
export async function verifyAuditNC(id: number, data: AuditNCVerify): Promise<AuditNC> {
  return request({
    url: `/api/v1/audit-nc/${id}/verify`,
    method: 'post',
    data
  });
}

/**
 * 关闭审核NC
 */
export async function closeAuditNC(id: number, data?: AuditNCClose): Promise<AuditNC> {
  return request({
    url: `/api/v1/audit-nc/${id}/close`,
    method: 'post',
    data: data || {}
  });
}

// ==================== 客户审核 API ====================

/**
 * 获取客户审核列表
 */
export async function getCustomerAudits(params: CustomerAuditQuery): Promise<CustomerAuditListResponse> {
  return request({
    url: '/api/v1/customer-audits',
    method: 'get',
    params
  });
}

/**
 * 获取客户审核详情
 */
export async function getCustomerAudit(id: number): Promise<CustomerAudit> {
  return request({
    url: `/api/v1/customer-audits/${id}`,
    method: 'get'
  });
}

/**
 * 创建客户审核
 */
export async function createCustomerAudit(data: CustomerAuditCreate): Promise<CustomerAudit> {
  return request({
    url: '/api/v1/customer-audits',
    method: 'post',
    data
  });
}

/**
 * 更新客户审核
 */
export async function updateCustomerAudit(id: number, data: CustomerAuditUpdate): Promise<CustomerAudit> {
  return request({
    url: `/api/v1/customer-audits/${id}`,
    method: 'put',
    data
  });
}

/**
 * 删除客户审核
 */
export async function deleteCustomerAudit(id: number): Promise<{ message: string }> {
  return request({
    url: `/api/v1/customer-audits/${id}`,
    method: 'delete'
  });
}

/**
 * 创建客户审核问题任务
 */
export async function createCustomerAuditIssueTask(data: CustomerAuditIssueTaskCreate): Promise<CustomerAuditIssueTaskResponse> {
  return request({
    url: `/api/v1/customer-audits/${data.customer_audit_id}/issue-tasks`,
    method: 'post',
    data
  });
}

/**
 * 获取客户审核问题任务列表
 */
export async function getCustomerAuditIssueTasks(customerAuditId: number): Promise<CustomerAuditIssueTaskResponse[]> {
  return request({
    url: `/api/v1/customer-audits/${customerAuditId}/issue-tasks`,
    method: 'get'
  });
}
