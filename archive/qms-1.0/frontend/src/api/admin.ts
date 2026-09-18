import request from '@/utils/request'
import type {
  AdminBulkUserCreateRequest,
  AdminBulkUserCreateResponse,
  AdminUserCreateRequest,
  AdminUserCreateResponse,
  CustomerListQuery,
  CustomerMaster,
  CustomerMasterBulkCreateRequest,
  CustomerMasterBulkCreateResponse,
  CustomerMasterCreateRequest,
  CustomerMasterUpdateRequest,
  FeatureFlag,
  FeatureFlagUpdateRequest,
  OperationLog,
  OperationLogQuery,
  Permission,
  PermissionMatrixColumn,
  PermissionMatrixRow,
  SupplierListQuery,
  SupplierMaster,
  SupplierMasterBulkCreateRequest,
  SupplierMasterBulkCreateResponse,
  SupplierMasterCreateRequest,
  SupplierMasterUpdateRequest,
  TaskReassignRequest,
  TaskStatistics,
  TodoTask,
  User,
  UserListQuery,
  UserUpdateRequest,
} from '@/types/admin'
import type {
  RolePermissionChange,
  RoleTagCreateRequest,
  RoleTagSummary,
  RoleTagUpdateRequest,
  RoleTemplateInitializationResponse,
} from '@/types/role'

/**
 * 管理后台相关 API。
 */
export const adminApi = {
  getPendingUsers(): Promise<User[]> {
    return request.get('/v1/admin/users/pending')
  },

  getUsers(params?: UserListQuery): Promise<User[]> {
    return request.get('/v1/admin/users', { params })
  },

  createUser(data: AdminUserCreateRequest): Promise<AdminUserCreateResponse> {
    return request.post('/v1/admin/users', data)
  },

  bulkCreateUsers(data: AdminBulkUserCreateRequest): Promise<AdminBulkUserCreateResponse> {
    return request.post('/v1/admin/users/bulk', data)
  },

  updateUser(userId: number, data: UserUpdateRequest): Promise<User> {
    return request.patch(`/v1/admin/users/${userId}`, data)
  },

  assignUserRoles(userId: number, roleTagIds: number[]): Promise<User> {
    return request.put(`/v1/admin/users/${userId}/roles`, { role_tag_ids: roleTagIds })
  },

  approveUser(userId: number): Promise<void> {
    return request.post(`/v1/admin/users/${userId}/approve`)
  },

  rejectUser(userId: number, reason: string): Promise<void> {
    return request.post(`/v1/admin/users/${userId}/reject`, { reason })
  },

  freezeUser(userId: number, reason?: string): Promise<void> {
    return request.post(`/v1/admin/users/${userId}/freeze`, reason ? { reason } : {})
  },

  unfreezeUser(userId: number): Promise<void> {
    return request.post(`/v1/admin/users/${userId}/unfreeze`)
  },

  resetUserPassword(userId: number): Promise<{ temporary_password: string }> {
    return request.post(`/v1/admin/users/${userId}/reset-password`)
  },

  deleteUser(userId: number): Promise<void> {
    return request.delete(`/v1/admin/users/${userId}`)
  },

  getSuppliers(params?: SupplierListQuery): Promise<SupplierMaster[]> {
    return request.get('/v1/admin/suppliers', { params })
  },

  createSupplier(data: SupplierMasterCreateRequest): Promise<SupplierMaster> {
    return request.post('/v1/admin/suppliers', data)
  },

  bulkCreateSuppliers(data: SupplierMasterBulkCreateRequest): Promise<SupplierMasterBulkCreateResponse> {
    return request.post('/v1/admin/suppliers/bulk', data)
  },

  updateSupplier(supplierId: number, data: SupplierMasterUpdateRequest): Promise<SupplierMaster> {
    return request.patch(`/v1/admin/suppliers/${supplierId}`, data)
  },

  updateSupplierStatus(
    supplierId: number,
    status: 'active' | 'suspended'
  ): Promise<SupplierMaster> {
    return request.post(`/v1/admin/suppliers/${supplierId}/status`, { status })
  },

  getCustomers(params?: CustomerListQuery): Promise<CustomerMaster[]> {
    return request.get('/v1/admin/customers', { params })
  },

  createCustomer(data: CustomerMasterCreateRequest): Promise<CustomerMaster> {
    return request.post('/v1/admin/customers', data)
  },

  bulkCreateCustomers(data: CustomerMasterBulkCreateRequest): Promise<CustomerMasterBulkCreateResponse> {
    return request.post('/v1/admin/customers/bulk', data)
  },

  updateCustomer(customerId: number, data: CustomerMasterUpdateRequest): Promise<CustomerMaster> {
    return request.patch(`/v1/admin/customers/${customerId}`, data)
  },

  updateCustomerStatus(
    customerId: number,
    status: 'active' | 'suspended'
  ): Promise<CustomerMaster> {
    return request.post(`/v1/admin/customers/${customerId}/status`, { status })
  },

  getRoleTags(params?: {
    include_inactive?: boolean
    applicable_user_type?: 'internal' | 'supplier'
  }): Promise<RoleTagSummary[]> {
    return request.get('/v1/admin/permissions/roles', { params })
  },

  createRoleTag(data: RoleTagCreateRequest): Promise<RoleTagSummary> {
    return request.post('/v1/admin/permissions/roles', data)
  },

  updateRoleTag(roleId: number, data: RoleTagUpdateRequest): Promise<RoleTagSummary> {
    return request.put(`/v1/admin/permissions/roles/${roleId}`, data)
  },

  deleteRoleTag(roleId: number): Promise<void> {
    return request.delete(`/v1/admin/permissions/roles/${roleId}`)
  },

  updateRolePermissions(roleId: number, permissions: RolePermissionChange[]): Promise<void> {
    return request.put(`/v1/admin/permissions/roles/${roleId}/permissions`, { permissions })
  },

  initializeRoleTemplates(): Promise<RoleTemplateInitializationResponse> {
    return request.post('/v1/admin/permissions/initialize-role-templates')
  },

  getPermissionMatrix(): Promise<{
    modules: PermissionMatrixColumn[]
    rows: PermissionMatrixRow[]
  }> {
    return request.get('/v1/admin/permissions/matrix')
  },

  grantPermissions(data: {
    user_ids: number[]
    permissions: Array<{ module_path: string; operation_type: string }>
  }): Promise<void> {
    return request.put('/v1/admin/permissions/grant', data)
  },

  revokePermissions(data: {
    user_ids: number[]
    permissions: Array<{ module_path: string; operation_type: string }>
  }): Promise<void> {
    return request.put('/v1/admin/permissions/revoke', data)
  },

  getUserPermissions(userId: number): Promise<Permission[]> {
    return request.get(`/v1/admin/permissions/users/${userId}`)
  },

  getOperationLogs(query: OperationLogQuery): Promise<{
    logs: OperationLog[]
    total: number
    page: number
    page_size: number
  }> {
    return request.get('/v1/admin/operation-logs', { params: query })
  },

  getOperationLogDetail(logId: number): Promise<OperationLog> {
    return request.get(`/v1/admin/operation-logs/${logId}`)
  },

  exportOperationLogs(query: OperationLogQuery): Promise<Blob> {
    return request.get('/v1/admin/operation-logs/export', {
      params: query,
      responseType: 'blob',
    })
  },

  getTaskStatistics(): Promise<TaskStatistics> {
    return request.get('/v1/admin/tasks/statistics')
  },

  getAllTasks(filters?: {
    urgency?: string
    department?: string
    user_id?: number
  }): Promise<TodoTask[]> {
    return request.get('/v1/admin/tasks', { params: filters })
  },

  reassignTasks(data: TaskReassignRequest): Promise<void> {
    return request.post('/v1/admin/tasks/reassign', data)
  },

  getFeatureFlags(environment?: 'stable' | 'preview'): Promise<FeatureFlag[]> {
    return request
      .get('/v1/admin/feature-flags', {
        params: environment ? { environment } : undefined,
      })
      .then((response: any) => response.feature_flags || [])
  },

  updateFeatureFlag(flagId: number, data: FeatureFlagUpdateRequest): Promise<void> {
    return request.put(`/v1/admin/feature-flags/${flagId}`, data)
  },

  getFeatureFlagDetail(flagId: number): Promise<FeatureFlag> {
    return request.get(`/v1/admin/feature-flags/${flagId}`)
  },
}
