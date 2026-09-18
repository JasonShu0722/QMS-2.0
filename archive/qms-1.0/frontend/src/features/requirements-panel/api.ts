import requirementsPanelRequest from './request'
import type {
  RequirementPanelLoginRequest,
  RequirementPanelLoginResponse,
  RequirementPanelUser,
  RequirementStatusListResponse,
  RequirementStatusUpdateRequest,
  RequirementStatusOverride
} from './types'

export const requirementsPanelApi = {
  login(data: RequirementPanelLoginRequest): Promise<RequirementPanelLoginResponse> {
    return requirementsPanelRequest.post('/v1/requirements-panel-auth/login', data)
  },

  getCurrentUser(): Promise<RequirementPanelUser> {
    return requirementsPanelRequest.get('/v1/requirements-panel-auth/me')
  },

  getStatuses(): Promise<RequirementStatusListResponse> {
    return requirementsPanelRequest.get('/v1/requirements-panel')
  },

  updateStatus(itemId: string, data: RequirementStatusUpdateRequest): Promise<RequirementStatusOverride> {
    return requirementsPanelRequest.put(`/v1/requirements-panel/items/${itemId}`, data)
  }
}
