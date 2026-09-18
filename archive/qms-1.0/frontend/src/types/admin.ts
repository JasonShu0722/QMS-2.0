/**
 * 管理后台相关类型定义。
 */
import type { RoleTagSummary } from './role'

export type { User, UserStatus } from './user'

export type OperationType = 'create' | 'read' | 'update' | 'delete' | 'export'

export interface Permission {
  id: number
  user_id: number
  module_path: string
  operation_type: OperationType
  is_granted: boolean
  created_at: string
  updated_at: string
}

export interface PermissionMatrixRow {
  role: RoleTagSummary
  permissions: Record<string, boolean>
}

export interface PermissionMatrixColumn {
  module_path: string
  module_name: string
  group_key?: string | null
  group_name?: string | null
  operations: OperationType[]
}

export interface OperationLog {
  id: number
  user_id: number
  user_name: string
  operation_type: string
  target_type: string
  target_id?: number
  before_snapshot?: string
  after_snapshot?: string
  description?: string
  ip_address: string
  user_agent: string
  created_at: string
}

export interface OperationLogQuery {
  user_id?: number
  operation_type?: string
  target_type?: string
  start_date?: string
  end_date?: string
  page?: number
  page_size?: number
}

export interface TodoTask {
  id: string
  task_type: string
  task_id: number
  title: string
  description?: string
  deadline: string
  remaining_hours: number
  urgency: 'overdue' | 'urgent' | 'normal'
  color: 'red' | 'yellow' | 'green'
  link: string
  handler_id: number
  handler_name: string
}

export interface TaskStatistics {
  total_tasks: number
  overdue_tasks: number
  urgent_tasks: number
  normal_tasks: number
  by_department: Record<string, number>
  by_user: Record<string, number>
}

export interface TaskReassignRequest {
  from_user_id: number
  to_user_id: number
  task_ids: string[]
}

export interface FeatureFlag {
  id: number
  feature_key: string
  feature_name: string
  description: string
  is_enabled: boolean
  scope: 'global' | 'whitelist'
  whitelist_user_ids: number[]
  whitelist_supplier_ids: number[]
  environment: 'stable' | 'preview'
  created_at: string
  updated_at: string
  created_by?: number
}

export interface FeatureFlagUpdateRequest {
  is_enabled: boolean
  scope?: 'global' | 'whitelist'
  whitelist_user_ids?: number[]
  whitelist_supplier_ids?: number[]
  environment?: 'stable' | 'preview'
}

export interface UserApprovalRequest {
  user_id: number
  action: 'approve' | 'reject'
  reason?: string
}

export interface UserListQuery {
  keyword?: string
  department?: string
  position?: string
  user_type?: 'internal' | 'supplier'
  status?: 'active' | 'frozen' | 'rejected'
  role_tag_id?: number
}

export interface UserUpdateRequest {
  full_name: string
  email: string
  phone?: string
  department?: string
  position?: string
  allowed_environments: string
}

export interface AdminUserCreateRequest {
  username: string
  full_name: string
  email: string
  phone?: string
  department?: string
  position?: string
  supplier_identifier?: string
  user_type: 'internal' | 'supplier'
  allowed_environments: string
  role_tag_ids: number[]
}

export interface AdminBulkUserCreateItem {
  username: string
  full_name: string
  email: string
  phone?: string
  department?: string
  position?: string
  supplier_identifier?: string
}

export interface AdminUserCreateResponse {
  message: string
  user: import('./user').User
  temporary_password: string
  email_sent: boolean
}

export interface AdminBulkUserCreateItemResponse {
  row_number: number
  user: import('./user').User
  temporary_password: string
  email_sent: boolean
}

export interface AdminBulkUserCreateRequest {
  user_type: 'internal' | 'supplier'
  allowed_environments: string
  role_tag_ids: number[]
  items: AdminBulkUserCreateItem[]
}

export interface AdminBulkUserCreateResponse {
  message: string
  total_count: number
  created_count: number
  results: AdminBulkUserCreateItemResponse[]
}

export type SupplierMasterStatus = 'active' | 'suspended'

export interface SupplierListQuery {
  keyword?: string
  status?: SupplierMasterStatus
}

export interface SupplierMaster {
  id: number
  code: string
  name: string
  contact_person?: string
  contact_email?: string
  contact_phone?: string
  status: SupplierMasterStatus
  linked_user_count: number
  active_user_count: number
  created_at: string
  updated_at: string
}

export interface SupplierMasterCreateRequest {
  code: string
  name: string
  contact_person?: string
  contact_email?: string
  contact_phone?: string
  status?: SupplierMasterStatus
}

export interface SupplierMasterUpdateRequest extends SupplierMasterCreateRequest {
  status: SupplierMasterStatus
}

export interface SupplierMasterBulkCreateItem {
  code: string
  name: string
  contact_person?: string
  contact_email?: string
  contact_phone?: string
}

export interface SupplierMasterBulkCreateRequest {
  status?: SupplierMasterStatus
  items: SupplierMasterBulkCreateItem[]
}

export interface SupplierMasterBulkCreateResponse {
  message: string
  total_count: number
  created_count: number
  suppliers: SupplierMaster[]
}

export type CustomerMasterStatus = 'active' | 'suspended'

export interface CustomerListQuery {
  keyword?: string
  status?: CustomerMasterStatus
}

export interface CustomerMaster {
  id: number
  code: string
  name: string
  contact_person?: string
  contact_email?: string
  contact_phone?: string
  status: CustomerMasterStatus
  created_at: string
  updated_at: string
}

export interface CustomerMasterCreateRequest {
  code: string
  name: string
  contact_person?: string
  contact_email?: string
  contact_phone?: string
  status?: CustomerMasterStatus
}

export interface CustomerMasterUpdateRequest extends CustomerMasterCreateRequest {
  status: CustomerMasterStatus
}

export interface CustomerMasterBulkCreateItem {
  code: string
  name: string
  contact_person?: string
  contact_email?: string
  contact_phone?: string
}

export interface CustomerMasterBulkCreateRequest {
  status?: CustomerMasterStatus
  items: CustomerMasterBulkCreateItem[]
}

export interface CustomerMasterBulkCreateResponse {
  message: string
  total_count: number
  created_count: number
  customers: CustomerMaster[]
}
