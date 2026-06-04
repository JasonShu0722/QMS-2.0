import type { RoleTagSummary } from './role'

/**
 * 用户类型定义
 */
export type UserType = 'internal' | 'supplier'

/**
 * 用户状态
 */
export type UserStatus = 'pending' | 'active' | 'frozen' | 'rejected'
export type PermissionOperation = 'create' | 'read' | 'update' | 'delete' | 'export'
export type PermissionTree = Record<string, Partial<Record<PermissionOperation, boolean>>>

/**
 * 用户信息接口
 */
export interface User {
  id: number
  username: string
  full_name: string
  email: string
  phone?: string
  user_type: UserType
  status: UserStatus

  // 内部员工字段
  department?: string
  position?: string
  role_id?: number

  // 供应商字段
  supplier_id?: number
  supplier_name?: string

  // 头像
  avatar_image_path?: string

  // 电子签名
  signature_image_path?: string
  digital_signature?: string

  // 环境权限（逗号分隔："stable", "preview", "stable,preview"）
  allowed_environments?: string
  is_platform_admin?: boolean
  role_tags?: RoleTagSummary[]

  // 审计字段
  created_at: string
  updated_at: string
  last_login_at?: string
}

/**
 * 登录请求参数
 */
export interface LoginRequest {
  username: string
  password: string
  user_type: UserType
  captcha?: string
  captcha_id?: string
}

/**
 * 登录响应
 */
export interface LoginResponse {
  access_token: string
  token_type: string
  user_info: User
  environment: string
  allowed_environments: string[]
  password_expired: boolean
}

/**
 * 权限检查请求
 */
export interface PermissionCheckRequest {
  module_path: string
  operation: PermissionOperation
}
