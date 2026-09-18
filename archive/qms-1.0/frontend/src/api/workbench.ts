import request from '@/utils/request'
import type { User } from '@/types/user'
import type {
  DashboardData,
  ChangePasswordRequest,
  ProfileUpdateRequest,
  SignatureUploadResponse
} from '@/types/workbench'

/**
 * 工作台相关 API
 */
export const workbenchApi = {
  /**
   * 获取工作台数据（根据用户类型返回不同数据）
   */
  getDashboardData(): Promise<DashboardData> {
    return request.get('/v1/workbench/dashboard')
  },

  /**
   * 获取个人信息
   */
  getProfile(): Promise<any> {
    return request.get('/v1/profile')
  },

  /**
   * 更新个人资料
   */
  updateProfile(data: ProfileUpdateRequest): Promise<User> {
    return request.patch('/v1/profile', data)
  },

  /**
   * 修改密码
   */
  changePassword(data: ChangePasswordRequest): Promise<{ message: string }> {
    return request.put('/v1/profile/password', data)
  },

  /**
   * 上传电子签名
   */
  uploadSignature(file: File): Promise<SignatureUploadResponse> {
    const formData = new FormData()
    formData.append('file', file)

    return request.post('/v1/profile/signature', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })
  },

  /**
   * 上传头像（裁剪后的图片 Blob）
   */
  uploadAvatar(file: Blob): Promise<{ message: string; avatar_path: string }> {
    const formData = new FormData()
    formData.append('file', file, 'avatar.png')

    return request.post('/v1/profile/avatar', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })
  }
}
