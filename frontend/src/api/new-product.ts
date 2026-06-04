import request from '@/utils/request'
import type {
  LessonLearned,
  LessonLearnedCreate,
  ProjectLessonCheck,
  ProjectLessonCheckRequest,
  NewProductProject,
  NewProductProjectCreate,
  StageReview,
  StageReviewCreate,
  StageReviewApproval,
  TrialProduction,
  TrialProductionCreate,
  ManualMetricsInput,
  TrialProductionSummary,
  TrialIssue,
  TrialIssueCreate,
  TrialIssueStatistics,
  NewProductDefect,
  NewProductDefectCreate,
  NewProductDefectListResponse,
  NewProductDefectProblemReportCreate,
  NewProductDefectProblemReportResponse,
  NewProductDefectUpdate,
  PaginatedResponse
} from '@/types/new-product'

/**
 * 新品质量管理相关 API
 */
export const newProductApi = {
  // ==================== 经验教训库管理 ====================

  /**
   * 获取经验教训列表
   */
  getLessonLearnedList(params?: any): Promise<PaginatedResponse<LessonLearned>> {
    return request.get('/v1/lesson-learned', { params })
  },

  /**
   * 获取经验教训详情
   */
  getLessonLearned(id: number): Promise<LessonLearned> {
    return request.get(`/v1/lesson-learned/${id}`)
  },

  /**
   * 创建经验教训
   */
  createLessonLearned(data: LessonLearnedCreate): Promise<LessonLearned> {
    return request.post('/v1/lesson-learned', data)
  },

  /**
   * 更新经验教训
   */
  updateLessonLearned(id: number, data: Partial<LessonLearned>): Promise<LessonLearned> {
    return request.put(`/v1/lesson-learned/${id}`, data)
  },

  /**
   * 删除经验教训
   */
  deleteLessonLearned(id: number): Promise<void> {
    return request.delete(`/v1/lesson-learned/${id}`)
  },

  // ==================== 新品项目管理 ====================

  /**
   * 获取新品项目列表
   */
  getProjectList(params?: any): Promise<PaginatedResponse<NewProductProject>> {
    return request.get('/v1/projects', { params })
  },

  /**
   * 获取项目详情
   */
  getProject(id: number): Promise<NewProductProject> {
    return request.get(`/v1/projects/${id}`)
  },

  /**
   * 创建新品项目
   */
  createProject(data: NewProductProjectCreate): Promise<NewProductProject> {
    return request.post('/v1/projects', data)
  },

  /**
   * 更新项目信息
   */
  updateProject(id: number, data: Partial<NewProductProject>): Promise<NewProductProject> {
    return request.put(`/v1/projects/${id}`, data)
  },

  // ==================== 经验教训点检 ====================

  /**
   * 获取项目经验教训点检列表
   */
  getProjectLessonChecks(projectId: number): Promise<ProjectLessonCheck[]> {
    return request.get(`/v1/projects/${projectId}/lesson-checks`)
  },

  /**
   * 批量提交经验教训点检
   */
  submitLessonChecks(projectId: number, checks: ProjectLessonCheckRequest[]): Promise<void> {
    return request.post(`/v1/projects/${projectId}/lesson-checks`, { checks })
  },

  /**
   * 上传规避证据
   */
  uploadEvidence(projectId: number, checkId: number, file: File): Promise<{ file_path: string }> {
    const formData = new FormData()
    formData.append('file', file)
    return request.post(`/v1/projects/${projectId}/lesson-checks/${checkId}/evidence`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },

  /**
   * 推送相关经验教训到项目
   */
  pushLessonsToProject(projectId: number): Promise<{ pushed_lessons: LessonLearned[]; total_pushed: number }> {
    return request.post(`/v1/projects/${projectId}/push-lessons`)
  },

  // ==================== 阶段评审管理 ====================

  /**
   * 获取项目阶段评审列表
   */
  getStageReviews(projectId: number): Promise<StageReview[]> {
    return request.get(`/v1/projects/${projectId}/stage-reviews`)
  },

  /**
   * 创建阶段评审
   */
  createStageReview(projectId: number, data: StageReviewCreate): Promise<StageReview> {
    return request.post(`/v1/projects/${projectId}/stage-reviews`, data)
  },

  /**
   * 更新阶段评审
   */
  updateStageReview(projectId: number, stageId: number, data: Partial<StageReview>): Promise<StageReview> {
    return request.put(`/v1/projects/${projectId}/stage-reviews/${stageId}`, data)
  },

  /**
   * 上传交付物
   */
  uploadDeliverable(projectId: number, stageId: number, data: { deliverable_name: string; file: File; description?: string }): Promise<void> {
    const formData = new FormData()
    formData.append('file', data.file)
    formData.append('deliverable_name', data.deliverable_name)
    if (data.description) {
      formData.append('description', data.description)
    }
    return request.post(`/v1/projects/${projectId}/stage-reviews/${stageId}/deliverables`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },

  /**
   * 批准阶段评审
   */
  approveStageReview(projectId: number, stageId: number, data: StageReviewApproval): Promise<void> {
    return request.post(`/v1/projects/${projectId}/stage-reviews/${stageId}/approve`, data)
  },

  // ==================== 试产管理 ====================

  /**
   * 获取试产记录列表
   */
  getTrialProductionList(params?: any): Promise<PaginatedResponse<TrialProduction>> {
    return request.get('/v1/trial-production', { params })
  },

  /**
   * 获取试产记录详情
   */
  getTrialProduction(id: number): Promise<TrialProduction> {
    return request.get(`/v1/trial-production/${id}`)
  },

  /**
   * 创建试产记录
   */
  createTrialProduction(data: TrialProductionCreate): Promise<TrialProduction> {
    return request.post('/v1/trial-production', data)
  },

  /**
   * 更新试产记录
   */
  updateTrialProduction(id: number, data: Partial<TrialProduction>): Promise<TrialProduction> {
    return request.put(`/v1/trial-production/${id}`, data)
  },

  /**
   * 同步IMS数据
   */
  syncIMSData(id: number, force?: boolean): Promise<{ success: boolean; message: string; synced_data?: any }> {
    return request.post(`/v1/trial-production/${id}/sync-ims`, { force_sync: force })
  },

  /**
   * 手动补录实绩数据
   */
  inputManualMetrics(id: number, data: ManualMetricsInput): Promise<TrialProduction> {
    return request.post(`/v1/trial-production/${id}/manual-metrics`, data)
  },

  /**
   * 获取试产总结报告
   */
  getTrialSummary(id: number): Promise<TrialProductionSummary> {
    return request.get(`/v1/trial-production/${id}/summary`)
  },

  /**
   * 导出试产总结报告
   */
  exportTrialSummary(id: number, format: 'excel' | 'pdf'): Promise<Blob> {
    return request.get(`/v1/trial-production/${id}/export`, {
      params: { format },
      responseType: 'blob'
    })
  },

  // ==================== 试产问题管理 ====================

  /**
   * 获取试产问题列表
   */
  getTrialIssueList(params?: any): Promise<PaginatedResponse<TrialIssue>> {
    return request.get('/v1/trial-issues', { params })
  },

  /**
   * 获取试产问题详情
   */
  getTrialIssue(id: number): Promise<TrialIssue> {
    return request.get(`/v1/trial-issues/${id}`)
  },

  /**
   * 创建试产问题
   */
  createTrialIssue(data: TrialIssueCreate): Promise<TrialIssue> {
    return request.post('/v1/trial-issues', data)
  },

  /**
   * 更新试产问题
   */
  updateTrialIssue(id: number, data: Partial<TrialIssue>): Promise<TrialIssue> {
    return request.put(`/v1/trial-issues/${id}`, data)
  },

  /**
   * 指派问题
   */
  assignIssue(id: number, data: { assigned_to: number; assigned_dept?: string; deadline?: string }): Promise<void> {
    return request.post(`/v1/trial-issues/${id}/assign`, data)
  },

  /**
   * 提交解决方案
   */
  submitSolution(id: number, data: { root_cause: string; solution: string; verification_method?: string }): Promise<void> {
    return request.post(`/v1/trial-issues/${id}/solution`, data)
  },

  /**
   * 验证解决方案
   */
  verifySolution(id: number, data: { verification_result: 'passed' | 'failed'; verification_comments?: string }): Promise<void> {
    return request.post(`/v1/trial-issues/${id}/verify`, data)
  },

  /**
   * 关闭问题
   */
  closeIssue(id: number): Promise<void> {
    return request.post(`/v1/trial-issues/${id}/close`)
  },

  /**
   * 升级为8D报告
   */
  escalateTo8D(id: number, data: { escalation_reason: string }): Promise<{ eight_d_id: number }> {
    return request.post(`/v1/trial-issues/${id}/escalate`, data)
  },

  /**
   * 带病量产特批
   */
  approveLegacyIssue(id: number, data: { approval_status: 'approved' | 'rejected'; approval_comments?: string }): Promise<void> {
    return request.post(`/v1/trial-issues/${id}/legacy-approval`, data)
  },

  /**
   * 获取试产问题统计
   */
  getTrialIssueStatistics(trialId: number): Promise<TrialIssueStatistics> {
    return request.get(`/v1/trial-issues/statistics`, { params: { trial_id: trialId } })
  },

  getNewProductDefects(params?: any): Promise<NewProductDefectListResponse> {
    return request.get('/v1/new-product-defects', { params })
  },

  getNewProductDefect(id: number): Promise<NewProductDefect> {
    return request.get(`/v1/new-product-defects/${id}`)
  },

  createNewProductDefect(data: NewProductDefectCreate): Promise<NewProductDefect> {
    return request.post('/v1/new-product-defects', data)
  },

  updateNewProductDefect(id: number, data: NewProductDefectUpdate): Promise<NewProductDefect> {
    return request.put(`/v1/new-product-defects/${id}`, data)
  },

  createNewProductDefectProblemReport(
    id: number,
    data: NewProductDefectProblemReportCreate
  ): Promise<NewProductDefectProblemReportResponse> {
    return request.post(`/v1/new-product-defects/${id}/problem-report`, data)
  }
}
