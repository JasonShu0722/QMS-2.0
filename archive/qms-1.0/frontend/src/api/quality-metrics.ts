/**
 * 质量数据 API 客户端
 * Quality Metrics API Client
 */
import request from '@/utils/request';
import type {
  DashboardResponse,
  MetricTrendResponse,
  TopSuppliersResponse,
  ProcessAnalysisResponse,
  CustomerAnalysisResponse,
  AIDiagnoseRequest,
  AIDiagnoseResponse,
  AIQueryRequest,
  AIQueryResponse
} from '@/types/quality-metrics';

/**
 * 获取仪表盘数据
 */
export function getDashboard(targetDate?: string): Promise<DashboardResponse> {
  return request({
    url: '/v1/quality-metrics/dashboard',
    method: 'get',
    params: { target_date: targetDate }
  });
}

/**
 * 获取指标趋势
 */
export function getMetricTrend(params: {
  metric_type: string;
  start_date: string;
  end_date: string;
  supplier_id?: number;
  product_type?: string;
  line_id?: string;
  process_id?: string;
}): Promise<MetricTrendResponse> {
  return request({
    url: '/v1/quality-metrics/trend',
    method: 'get',
    params
  });
}

/**
 * 获取Top5供应商清单
 */
export function getTopSuppliers(params: {
  metric_type: string;
  period?: string;
  target_date?: string;
}): Promise<TopSuppliersResponse> {
  return request({
    url: '/v1/quality-metrics/top-suppliers',
    method: 'get',
    params
  });
}

/**
 * 获取制程质量分析
 */
export function getProcessAnalysis(params: {
  start_date: string;
  end_date: string;
}): Promise<ProcessAnalysisResponse> {
  return request({
    url: '/v1/quality-metrics/process-analysis',
    method: 'get',
    params
  });
}

/**
 * 获取客户质量分析
 */
export function getCustomerAnalysis(params: {
  start_date: string;
  end_date: string;
}): Promise<CustomerAnalysisResponse> {
  return request({
    url: '/v1/quality-metrics/customer-analysis',
    method: 'get',
    params
  });
}

/**
 * AI 异常诊断
 */
export function diagnoseAnomaly(data: AIDiagnoseRequest): Promise<AIDiagnoseResponse> {
  return request({
    url: '/v1/ai/diagnose',
    method: 'post',
    data
  });
}

/**
 * AI 自然语言查询
 */
export function naturalLanguageQuery(data: AIQueryRequest): Promise<AIQueryResponse> {
  return request({
    url: '/v1/ai/query',
    method: 'post',
    data
  });
}
