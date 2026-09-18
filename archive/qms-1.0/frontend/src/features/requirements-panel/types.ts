export type RequirementPriority = 'high' | 'medium' | 'low'
export type RequirementScope = '核心需求' | '期望增强' | '预留功能'
export type RequirementStatus = 'todo' | 'doing' | 'dev-done' | 'verified' | 'reserved'
export type RequirementPanelRole = 'admin' | 'viewer'

export interface RequirementStatusLegendItem {
  key: RequirementStatus
  label: string
}

export interface RequirementCatalogItem {
  id: string
  title: string
  priority: RequirementPriority
  scope: RequirementScope
  phase: string
  status: RequirementStatus
  acceptance: string
}

export interface RequirementCatalogModule {
  id: string
  name: string
  overallPriority: RequirementPriority
  summary: string
  items: RequirementCatalogItem[]
}

export interface RequirementPanelCatalog {
  metadata: {
    title: string
    version: string
    owner: string
    sources: string[]
    statusLegend: RequirementStatusLegendItem[]
  }
  modules: RequirementCatalogModule[]
}

export interface RequirementPanelUser {
  id: number
  username: string
  full_name: string
  role: RequirementPanelRole
  is_active: boolean
  last_login_at?: string | null
}

export interface RequirementPanelLoginRequest {
  username: string
  password: string
}

export interface RequirementPanelLoginResponse {
  access_token: string
  token_type: string
  user: RequirementPanelUser
}

export interface RequirementStatusOverride {
  item_id: string
  status: RequirementStatus
  updated_at: string
  updated_by?: number | null
  updated_by_name?: string | null
}

export interface RequirementStatusListResponse {
  can_update: boolean
  items: RequirementStatusOverride[]
}

export interface RequirementStatusUpdateRequest {
  status: RequirementStatus
}
