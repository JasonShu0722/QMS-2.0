/**
 * 质量数据类型定义
 * Quality Metrics Type Definitions
 */

// 指标类型枚举
export enum MetricType {
  INCOMING_BATCH_PASS_RATE = 'incoming_batch_pass_rate',
  MATERIAL_ONLINE_PPM = 'material_online_ppm',
  PROCESS_DEFECT_RATE = 'process_defect_rate',
  PROCESS_FPY = 'process_fpy',
  OKM_PPM = '0km_ppm',
  MIS_3_PPM = '3mis_ppm',
  MIS_12_PPM = '12mis_ppm'
}

// 指标状态
export type MetricStatus = 'good' | 'warning' | 'danger' | 'unknown';

// 趋势方向
export type TrendDirection = 'up' | 'down' | 'stable';

// 仪表盘指标摘要
export interface DashboardMetricSummary {
  metric_type: string;
  metric_name: string;
  current_value: number;
  target_value: number | null;
  is_target_met: boolean | null;
  status: MetricStatus;
  trend: TrendDirection;
  change_percentage: number | null;
}

// 仪表盘响应
export interface DashboardResponse {
  date: string;
  metrics: DashboardMetricSummary[];
  summary: {
    total_metrics: number;
    good_count: number;
    danger_count: number;
    date: string;
  };
}

// 质量指标数据点
export interface QualityMetricDataPoint {
  id: number;
  metric_type: string;
  metric_date: string;
  value: number;
  target_value: number | null;
  product_type: string | null;
  supplier_id: number | null;
  line_id: string | null;
  process_id: string | null;
  is_target_met: boolean | null;
  created_at: string;
  updated_at: string;
}

// 指标趋势响应
export interface MetricTrendResponse {
  metric_type: string;
  metric_name: string;
  start_date: string;
  end_date: string;
  data_points: QualityMetricDataPoint[];
  statistics: {
    count: number;
    average: number;
    max: number;
    min: number;
    latest: number;
  };
}

// Top供应商项
export interface TopSupplierItem {
  supplier_id: number;
  supplier_name: string;
  metric_value: number;
  rank: number;
  status: MetricStatus;
}

// Top供应商响应
export interface TopSuppliersResponse {
  metric_type: string;
  metric_name: string;
  period: string;
  date: string;
  top_suppliers: TopSupplierItem[];
}

// 制程分析项
export interface ProcessAnalysisItem {
  category: string;
  category_name: string;
  defect_rate: number;
  fpy: number;
  defect_count: number;
  total_count: number;
  trend: TrendDirection;
}

// 制程分析响应
export interface ProcessAnalysisResponse {
  period: string;
  start_date: string;
  end_date: string;
  by_responsibility: ProcessAnalysisItem[];
  by_process: ProcessAnalysisItem[];
  by_line: ProcessAnalysisItem[];
  monthly_trend: Array<{
    month: string;
    avg_defect_rate: number;
    avg_fpy: number;
  }>;
}

// 客户分析项
export interface CustomerAnalysisItem {
  product_type: string;
  okm_ppm: number;
  mis_3_ppm: number;
  mis_12_ppm: number;
  complaint_count: number;
  trend: TrendDirection;
}

// 客户分析响应
export interface CustomerAnalysisResponse {
  period: string;
  start_date: string;
  end_date: string;
  by_product_type: CustomerAnalysisItem[];
  monthly_trend: Array<{
    month: string;
    avg_okm_ppm: number;
    avg_mis_3_ppm: number;
    avg_mis_12_ppm: number;
  }>;
  severity_distribution: {
    critical: number;
    major: number;
    minor: number;
  };
}

// AI 诊断请求
export interface AIDiagnoseRequest {
  metric_type: string;
  metric_date: string;
  current_value: number;
  historical_avg: number;
  supplier_id?: number;
  product_type?: string;
}

// AI 诊断响应
export interface AIDiagnoseResponse {
  severity: 'low' | 'medium' | 'high' | 'critical';
  root_causes: string[];
  recommendations: string[];
  related_metrics: Array<{
    metric_type: string;
    correlation: number;
    description: string;
  }>;
  analysis_summary: string;
}

// AI 查询请求
export interface AIQueryRequest {
  question: string;
}

// AI 查询响应
export interface AIQueryResponse {
  answer: string;
  data: unknown;
  chart_config: unknown | null;
  sql_query: string | null;
  explanation: string;
}
