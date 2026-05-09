import request from '@/utils/request'
import type {
  SCAR,
  EightDReport,
  SupplierAudit,
  SupplierPerformance,
  SupplierTarget,
  PPAP,
  InspectionSpec,
  BarcodeValidation,
  SupplierDashboardData,
  SCARListParams,
  SCARHistoryItem,
  SCARInternalUserOption,
  SCARSupplierOption,
  PaginatedResponse
} from '@/types/supplier'

/**
 * 供应商质量管理相关 API
 */
export const supplierApi = {
  /**
   * 获取供应商仪表盘数据
   */
  getDashboardData(): Promise<SupplierDashboardData> {
    return request.get('/v1/supplier/dashboard')
  },

  /**
   * 获取 SCAR 列表
   */
  getSCARList(params?: SCARListParams): Promise<PaginatedResponse<SCAR>> {
    return request.get('/v1/scar', { params })
  },

  /**
   * SCAR 创建时按供应商代码/名称检索供应商
   */
  getSCARSupplierOptions(params?: { keyword?: string; limit?: number }): Promise<SCARSupplierOption[]> {
    return request.get('/v1/scar/supplier-options', { params })
  },

  /**
   * SCAR 8D 提交审核时检索供应商质量工程师
   */
  getSCARSQEOptions(params?: { keyword?: string; limit?: number }): Promise<SCARInternalUserOption[]> {
    return request.get('/v1/scar/sqe-options', { params })
  },

  /**
   * 获取 SCAR 详情
   */
  getSCAR(id: number): Promise<SCAR> {
    return request.get(`/v1/scar/${id}`)
  },

  /**
   * 创建 SCAR（内部用户）
   */
  createSCAR(data: Partial<SCAR>): Promise<SCAR> {
    return request.post('/v1/scar', data)
  },

  updateSCAR(id: number, data: Partial<SCAR>): Promise<SCAR> {
    return request.patch(`/v1/scar/${id}`, data)
  },

  getSCARHistory(id: number): Promise<SCARHistoryItem[]> {
    return request.get(`/v1/scar/${id}/history`)
  },

  /**
   * 提交 8D 报告（供应商）
   */
  submit8DReport(scarId: number, data: Partial<EightDReport>): Promise<EightDReport> {
    return request.post(`/v1/scar/${scarId}/8d`, data)
  },

  /**
   * 获取 8D 报告
   */
  get8DReport(scarId: number): Promise<EightDReport> {
    return request.get(`/v1/scar/${scarId}/8d`)
  },

  /**
   * 审核 8D 报告（SQE）
   */
  review8DReport(scarId: number, data: { approved: boolean; review_comments: string }): Promise<EightDReport> {
    return request.post(`/v1/scar/${scarId}/8d/review`, data)
  },

  /**
   * 驳回 8D 报告（SQE）
   */
  reject8DReport(scarId: number, data: { approved: boolean; review_comments: string }): Promise<EightDReport> {
    return request.post(`/v1/scar/${scarId}/8d/reject`, data)
  },

  /**
   * 获取供应商审核计划列表
   */
  getAuditPlanList(params?: any): Promise<PaginatedResponse<SupplierAudit>> {
    return request.get('/v1/suppliers/audits/plan', { params })
  },

  /**
   * 创建审核记录
   */
  createAudit(data: Partial<SupplierAudit>): Promise<SupplierAudit> {
    return request.post('/v1/suppliers/audits', data)
  },

  /**
   * 录入不符合项（NC）
   */
  createNC(auditId: number, data: any): Promise<void> {
    return request.post(`/v1/suppliers/audits/${auditId}/nc`, data)
  },

  /**
   * 获取供应商绩效列表
   */
  getPerformanceList(params?: any): Promise<PaginatedResponse<SupplierPerformance>> {
    return request.get('/v1/supplier-performance', { params })
  },

  /**
   * 获取供应商质量目标列表
   */
  getTargetsList(params?: any): Promise<PaginatedResponse<SupplierTarget>> {
    return request.get('/v1/supplier-targets', { params })
  },

  /**
   * 批量设定目标
   */
  batchSetTargets(data: any): Promise<void> {
    return request.post('/v1/supplier-targets/batch', data)
  },

  /**
   * 单独设定目标
   */
  setIndividualTarget(data: Partial<SupplierTarget>): Promise<SupplierTarget> {
    return request.post('/v1/supplier-targets/individual', data)
  },

  /**
   * 供应商签署目标
   */
  signTarget(targetId: number): Promise<void> {
    return request.post(`/v1/supplier-targets/${targetId}/sign`)
  },

  /**
   * 获取 PPAP 列表
   */
  getPPAPList(params?: any): Promise<PaginatedResponse<PPAP>> {
    return request.get('/v1/ppap', { params })
  },

  /**
   * 创建 PPAP 提交任务
   */
  createPPAP(data: Partial<PPAP>): Promise<PPAP> {
    return request.post('/v1/ppap', data)
  },

  /**
   * 供应商上传 PPAP 文件
   */
  uploadPPAPDocuments(ppapId: number, data: FormData): Promise<void> {
    return request.post(`/v1/ppap/${ppapId}/documents`, data, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },

  /**
   * SQE 审核 PPAP
   */
  reviewPPAP(ppapId: number, data: { approved: boolean; comments?: string }): Promise<void> {
    return request.post(`/v1/ppap/${ppapId}/review`, data)
  },

  /**
   * 获取检验规范列表
   */
  getInspectionSpecsList(params?: any): Promise<PaginatedResponse<InspectionSpec>> {
    return request.get('/v1/inspection-specs', { params })
  },

  /**
   * SQE 发起规范提交任务
   */
  createInspectionSpec(data: Partial<InspectionSpec>): Promise<InspectionSpec> {
    return request.post('/v1/inspection-specs', data)
  },

  /**
   * 供应商提交 SIP
   */
  submitInspectionSpec(specId: number, data: FormData): Promise<void> {
    return request.post(`/v1/inspection-specs/${specId}/submit`, data, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },

  /**
   * SQE 审批检验规范
   */
  approveInspectionSpec(specId: number, data: { approved: boolean; comments?: string }): Promise<void> {
    return request.post(`/v1/inspection-specs/${specId}/approve`, data)
  },

  /**
   * 扫码验证
   */
  scanBarcode(data: { material_code: string; barcode: string }): Promise<BarcodeValidation> {
    return request.post('/v1/barcode-validation/scan', data)
  },

  /**
   * 批次提交归档
   */
  submitBarcodeBatch(data: { material_code: string; batch_id: string; barcodes: string[] }): Promise<void> {
    return request.post('/v1/barcode-validation/submit', data)
  },

  /**
   * 获取条码校验历史
   */
  getBarcodeHistory(params?: any): Promise<PaginatedResponse<BarcodeValidation>> {
    return request.get('/v1/barcode-validation/history', { params })
  }
}
