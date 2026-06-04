import request from '@/utils/request'
import type {
  InternalUserOption,
  ProblemReportBriefResponse,
  ProblemReportClose,
  ProblemReportCreate,
  ProblemReportResponse,
  ProblemReportReview,
  ProblemReportSourcesUpdate,
  ProblemIssueSummaryListResponse,
  ProblemIssueSummaryQuery,
  ProblemManagementCatalogResponse,
} from '@/types/problem-management'

export const problemManagementApi = {
  getCatalog(): Promise<ProblemManagementCatalogResponse> {
    return request.get('/v1/problem-management/catalog')
  },
  getInternalUsers(params?: { keyword?: string }): Promise<InternalUserOption[]> {
    return request.get('/v1/problem-management/internal-users', { params })
  },
  getIssueSummaries(params: ProblemIssueSummaryQuery): Promise<ProblemIssueSummaryListResponse> {
    return request.get('/v1/problem-management/issues', { params })
  },
  createProblemReport(data: ProblemReportCreate): Promise<ProblemReportResponse> {
    return request.post('/v1/problem-management/reports', data)
  },
  getProblemReport(reportId: number): Promise<ProblemReportResponse> {
    return request.get(`/v1/problem-management/reports/${reportId}`)
  },
  updateProblemReportSources(
    reportId: number,
    data: ProblemReportSourcesUpdate
  ): Promise<ProblemReportResponse> {
    return request.put(`/v1/problem-management/reports/${reportId}/sources`, data)
  },
  submitBriefResponse(
    reportId: number,
    data: ProblemReportBriefResponse
  ): Promise<ProblemReportResponse> {
    return request.post(`/v1/problem-management/reports/${reportId}/brief-response`, data)
  },
  reviewProblemReport(reportId: number, data: ProblemReportReview): Promise<ProblemReportResponse> {
    return request.post(`/v1/problem-management/reports/${reportId}/review`, data)
  },
  closeProblemReport(reportId: number, data: ProblemReportClose): Promise<ProblemReportResponse> {
    return request.post(`/v1/problem-management/reports/${reportId}/close`, data)
  }
}
