import request from '@/utils/request'
import type { LoginRequest, LoginResponse, PermissionCheckRequest, PermissionTree, User } from '@/types/user'

/**
 * 认证相关 API。
 */
export const authApi = {
  login(data: LoginRequest): Promise<LoginResponse> {
    return request.post('/v1/auth/login', data)
  },

  register(data: any): Promise<any> {
    return request.post('/v1/auth/register', data)
  },

  getCurrentUser(): Promise<User> {
    return request.get('/v1/auth/me')
  },

  getPermissionTree(): Promise<PermissionTree> {
    return request.get('/v1/auth/permissions-tree').then((res: any) => res?.permissions ?? {})
  },

  checkPermission(modulePath: string, operation: string): Promise<boolean> {
    return request
      .post('/v1/auth/check-permission', {
        module_path: modulePath,
        operation,
      } as PermissionCheckRequest)
      .then((res: any) => res?.has_permission ?? false)
  },

  getCaptcha(): Promise<{ captcha_id: string; captcha_image: string }> {
    return request.get('/v1/auth/captcha')
  },

  logout(): Promise<void> {
    return request.post('/v1/auth/logout')
  },
}
