export interface RoleTagSummary {
  id: number
  role_key: string
  role_name: string
  description?: string | null
  applicable_user_type?: 'internal' | 'supplier' | null
  is_active: boolean
  assigned_user_count: number
  created_at?: string
  updated_at?: string
}

export interface RoleTagCreateRequest {
  role_key: string
  role_name: string
  description?: string
  applicable_user_type?: 'internal' | 'supplier' | null
  is_active: boolean
}

export interface RoleTagUpdateRequest {
  role_name: string
  description?: string
  applicable_user_type?: 'internal' | 'supplier' | null
  is_active: boolean
}

export interface RolePermissionChange {
  module_path: string
  operation_type: 'create' | 'read' | 'update' | 'delete' | 'export'
  is_granted: boolean
}

export interface RoleTemplateInitializationResponse {
  success: boolean
  message: string
  created_roles: number
  existing_roles: number
  created_permissions: number
  role_keys: string[]
}
