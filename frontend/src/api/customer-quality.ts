/**
 * Customer quality management API client.
 */
import request from '@/utils/request'
import {
  type BackendEightDCustomer,
  buildEightDD4D7Payload,
  buildEightDD8Payload,
  normalizeEightDCustomer,
} from '@/utils/customerEightD'
import type {
  CustomerClaim,
  CustomerClaimCreate,
  CustomerClaimListQuery,
  CustomerClaimListResponse,
  CustomerComplaint,
  CustomerComplaintCreate,
  CustomerComplaintCustomerOption,
  CustomerComplaintInternalUserOption,
  CustomerComplaintPhysicalAnalysisRecord,
  CustomerComplaintPhysicalDispositionRecord,
  CustomerComplaintListQuery,
  CustomerComplaintListResponse,
  CustomerEightDListQuery,
  CustomerEightDListResponse,
  CustomerQualityAnalysis,
  EightDBatchInitRequest,
  EightDPrimaryComplaintSwitchRequest,
  EightDScopeAppendRequest,
  EightDCustomer,
  EightDSLAStatus,
  EightDCustomerSubmit,
  EightDD8Submit,
  EightDReview,
  PreliminaryAnalysis,
  SupplierClaim,
  SupplierClaimCreate,
  SupplierClaimListQuery,
  SupplierClaimListResponse,
} from '@/types/customer-quality'

export async function getCustomerComplaints(
  params: CustomerComplaintListQuery
): Promise<CustomerComplaintListResponse> {
  return request({
    url: '/api/v1/customer-complaints',
    method: 'get',
    params,
  })
}

export async function getCustomerComplaint(id: number): Promise<CustomerComplaint> {
  return request({
    url: `/api/v1/customer-complaints/${id}`,
    method: 'get',
  })
}

export async function getCustomerComplaintCustomerOptions(
  params?: { keyword?: string }
): Promise<CustomerComplaintCustomerOption[]> {
  return request({
    url: '/api/v1/customer-complaints/customers',
    method: 'get',
    params,
  })
}

export async function getCustomerComplaintInternalUserOptions(
  params?: { keyword?: string }
): Promise<CustomerComplaintInternalUserOption[]> {
  return request({
    url: '/api/v1/customer-complaints/internal-users',
    method: 'get',
    params,
  })
}

export async function createCustomerComplaint(data: CustomerComplaintCreate): Promise<CustomerComplaint> {
  return request({
    url: '/api/v1/customer-complaints',
    method: 'post',
    data,
  })
}

export async function submitPreliminaryAnalysis(
  id: number,
  data: PreliminaryAnalysis
): Promise<CustomerComplaint> {
  return request({
    url: `/api/v1/customer-complaints/${id}/preliminary-analysis`,
    method: 'post',
    data,
  })
}

export async function recordCustomerComplaintPhysicalDisposition(
  id: number,
  data: CustomerComplaintPhysicalDispositionRecord
): Promise<CustomerComplaint> {
  return request({
    url: `/api/v1/customer-complaints/${id}/physical-disposition`,
    method: 'post',
    data,
  })
}

export async function recordCustomerComplaintPhysicalAnalysis(
  id: number,
  data: CustomerComplaintPhysicalAnalysisRecord
): Promise<CustomerComplaint> {
  return request({
    url: `/api/v1/customer-complaints/${id}/physical-analysis`,
    method: 'post',
    data,
  })
}

export async function initCustomerComplaintEightD(complaintId: number): Promise<EightDCustomer> {
  const response = (await request({
    url: `/api/v1/customer-complaints/${complaintId}/8d/init`,
    method: 'post',
  })) as unknown as BackendEightDCustomer
  return normalizeEightDCustomer(response)
}

export async function initBatchCustomerComplaintEightD(
  data: EightDBatchInitRequest
): Promise<EightDCustomer> {
  const response = (await request({
    url: '/api/v1/customer-complaints/8d/init',
    method: 'post',
    data,
  })) as unknown as BackendEightDCustomer
  return normalizeEightDCustomer(response)
}

export async function appendCustomerComplaintEightDScope(
  complaintId: number,
  data: EightDScopeAppendRequest
): Promise<EightDCustomer> {
  const response = (await request({
    url: `/api/v1/customer-complaints/${complaintId}/8d/complaints`,
    method: 'post',
    data,
  })) as unknown as BackendEightDCustomer
  return normalizeEightDCustomer(response)
}

export async function removeCustomerComplaintEightDScopeComplaint(
  complaintId: number,
  linkedComplaintId: number
): Promise<EightDCustomer> {
  const response = (await request({
    url: `/api/v1/customer-complaints/${complaintId}/8d/complaints/${linkedComplaintId}`,
    method: 'delete',
  })) as unknown as BackendEightDCustomer
  return normalizeEightDCustomer(response)
}

export async function switchCustomerComplaintEightDPrimaryComplaint(
  complaintId: number,
  data: EightDPrimaryComplaintSwitchRequest
): Promise<EightDCustomer> {
  const response = (await request({
    url: `/api/v1/customer-complaints/${complaintId}/8d/primary-complaint`,
    method: 'post',
    data,
  })) as unknown as BackendEightDCustomer
  return normalizeEightDCustomer(response)
}

export async function getEightDCustomer(complaintId: number): Promise<EightDCustomer> {
  const response = (await request({
    url: `/api/v1/customer-complaints/${complaintId}/8d`,
    method: 'get',
  })) as unknown as BackendEightDCustomer
  return normalizeEightDCustomer(response)
}

export async function getCustomerEightDReports(
  params: CustomerEightDListQuery
): Promise<CustomerEightDListResponse> {
  return request({
    url: '/api/v1/customer-complaints/8d/reports',
    method: 'get',
    params,
  })
}

export async function submitEightDCustomer(
  complaintId: number,
  data: EightDCustomerSubmit
): Promise<EightDCustomer> {
  const response = (await request({
    url: `/api/v1/customer-complaints/${complaintId}/8d/d4-d7`,
    method: 'post',
    data: buildEightDD4D7Payload(data),
  })) as unknown as BackendEightDCustomer
  return normalizeEightDCustomer(response)
}

export async function submitEightDD8(
  complaintId: number,
  data: EightDD8Submit
): Promise<EightDCustomer> {
  const response = (await request({
    url: `/api/v1/customer-complaints/${complaintId}/8d/d8`,
    method: 'post',
    data: buildEightDD8Payload(data),
  })) as unknown as BackendEightDCustomer
  return normalizeEightDCustomer(response)
}

export async function reviewEightDCustomer(
  complaintId: number,
  data: EightDReview
): Promise<EightDCustomer> {
  const response = (await request({
    url: `/api/v1/customer-complaints/${complaintId}/8d/review`,
    method: 'post',
    data,
  })) as unknown as BackendEightDCustomer
  return normalizeEightDCustomer(response)
}

export async function archiveEightDCustomer(complaintId: number): Promise<EightDCustomer> {
  const response = (await request({
    url: `/api/v1/customer-complaints/${complaintId}/8d/archive`,
    method: 'post',
  })) as unknown as BackendEightDCustomer
  return normalizeEightDCustomer(response)
}

export async function getEightDSLAStatus(complaintId: number): Promise<EightDSLAStatus> {
  return request({
    url: `/api/v1/customer-complaints/${complaintId}/8d/sla`,
    method: 'get',
  })
}

export async function rejectEightDCustomer(
  complaintId: number,
  reason: string
): Promise<{ message: string }> {
  return request({
    url: `/api/v1/customer-complaints/${complaintId}/8d/reject`,
    method: 'post',
    data: { reason },
  })
}

export async function getCustomerClaims(params: CustomerClaimListQuery): Promise<CustomerClaimListResponse> {
  return request({
    url: '/api/v1/customer-claims',
    method: 'get',
    params,
  })
}

export async function getCustomerClaim(id: number): Promise<CustomerClaim> {
  return request({
    url: `/api/v1/customer-claims/${id}`,
    method: 'get',
  })
}

export async function createCustomerClaim(data: CustomerClaimCreate): Promise<CustomerClaim> {
  return request({
    url: '/api/v1/customer-claims',
    method: 'post',
    data,
  })
}

export async function getSupplierClaims(params: SupplierClaimListQuery): Promise<SupplierClaimListResponse> {
  return request({
    url: '/api/v1/supplier-claims',
    method: 'get',
    params,
  })
}

export async function getSupplierClaim(id: number): Promise<SupplierClaim> {
  return request({
    url: `/api/v1/supplier-claims/${id}`,
    method: 'get',
  })
}

export async function createSupplierClaim(data: SupplierClaimCreate): Promise<SupplierClaim> {
  return request({
    url: '/api/v1/supplier-claims',
    method: 'post',
    data,
  })
}

export async function transferToSupplierClaim(
  complaintId: number,
  data: Omit<SupplierClaimCreate, 'complaint_id'>
): Promise<SupplierClaim> {
  return request({
    url: `/api/v1/customer-complaints/${complaintId}/transfer-claim`,
    method: 'post',
    data,
  })
}

export async function getCustomerQualityAnalysis(
  params?: { start_date?: string; end_date?: string }
): Promise<CustomerQualityAnalysis> {
  return request({
    url: '/api/v1/quality-metrics/customer-analysis',
    method: 'get',
    params,
  })
}
