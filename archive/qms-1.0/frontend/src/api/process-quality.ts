/**
 * 过程质量管理 API 客户端
 * Process Quality Management API Client
 */
import request from '@/utils/request';
import type {
  ProcessDefect,
  ProcessDefectCreate,
  ProcessDefectUpdate,
  ProcessDefectListQuery,
  DefectTypeOption,
  ResponsibilityCategoryOption,
  ProcessIssue,
  ProcessIssueCreate,
  ProcessIssueResponse,
  ProcessIssueVerification,
  ProcessIssueClose,
  ProcessIssueFilter,
  ProcessIssueListResponse,
  ProcessIssueCreateResponse,
  ProcessIssueOperationResponse
} from '@/types/process-quality';

// 定义列表响应类型
interface ProcessDefectListResponse {
  total: number;
  page: number;
  page_size: number;
  items: ProcessDefect[];
}

// ==================== 不良品记录 API ====================

/**
 * 获取不良品记录列表
 */
export async function getProcessDefects(params: ProcessDefectListQuery): Promise<ProcessDefectListResponse> {
  return request({
    url: '/v1/process-defects',
    method: 'get',
    params
  });
}

/**
 * 获取不良品记录详情
 */
export async function getProcessDefect(id: number): Promise<ProcessDefect> {
  return request({
    url: `/v1/process-defects/${id}`,
    method: 'get'
  });
}

/**
 * 创建不良品记录
 */
export async function createProcessDefect(data: ProcessDefectCreate): Promise<ProcessDefect> {
  return request({
    url: '/v1/process-defects',
    method: 'post',
    data
  });
}

/**
 * 更新不良品记录
 */
export async function updateProcessDefect(id: number, data: ProcessDefectUpdate): Promise<ProcessDefect> {
  return request({
    url: `/v1/process-defects/${id}`,
    method: 'put',
    data
  });
}

/**
 * 删除不良品记录
 */
export async function deleteProcessDefect(id: number): Promise<{ message: string }> {
  return request({
    url: `/v1/process-defects/${id}`,
    method: 'delete'
  });
}

/**
 * 获取失效类型预设选项
 */
export async function getDefectTypes(): Promise<{ defect_types: DefectTypeOption[] }> {
  return request({
    url: '/v1/process-defects/options/defect-types',
    method: 'get'
  });
}

/**
 * 获取责任类别选项
 */
export async function getResponsibilityCategories(): Promise<{ categories: ResponsibilityCategoryOption[] }> {
  return request({
    url: '/v1/process-defects/options/responsibility-categories',
    method: 'get'
  });
}

// ==================== 制程问题单 API ====================

/**
 * 获取制程问题单列表
 */
export async function getProcessIssues(params: ProcessIssueFilter): Promise<ProcessIssueListResponse> {
  return request({
    url: '/v1/process-issues',
    method: 'get',
    params
  });
}

/**
 * 获取制程问题单详情
 */
export async function getProcessIssue(id: number): Promise<ProcessIssue> {
  return request({
    url: `/v1/process-issues/${id}`,
    method: 'get'
  });
}

/**
 * 创建制程问题单
 */
export async function createProcessIssue(data: ProcessIssueCreate): Promise<ProcessIssueCreateResponse> {
  return request({
    url: '/v1/process-issues',
    method: 'post',
    data
  });
}

/**
 * 责任板块填写分析和对策
 */
export async function respondToProcessIssue(id: number, data: ProcessIssueResponse): Promise<ProcessIssueOperationResponse> {
  return request({
    url: `/v1/process-issues/${id}/response`,
    method: 'post',
    data
  });
}

/**
 * PQE 验证对策有效性
 */
export async function verifyProcessIssue(id: number, data: ProcessIssueVerification): Promise<ProcessIssueOperationResponse> {
  return request({
    url: `/v1/process-issues/${id}/verify`,
    method: 'post',
    data
  });
}

/**
 * 关闭制程问题单
 */
export async function closeProcessIssue(id: number, data: ProcessIssueClose): Promise<ProcessIssueOperationResponse> {
  return request({
    url: `/v1/process-issues/${id}/close`,
    method: 'post',
    data
  });
}
