import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig, AxiosResponse } from 'axios'
import { ElMessage } from 'element-plus'

/**
 * API 错误响应接口
 */
interface ApiErrorResponse {
  detail?: unknown
  message?: unknown
}

function formatValidationLocation(value: unknown): string {
  if (!Array.isArray(value)) {
    return ''
  }

  return value
    .filter((item) => item !== 'body')
    .map(String)
    .join('.')
}

export function formatApiErrorMessage(value: unknown, fallback = '请求失败'): string {
  if (value === undefined || value === null || value === '') {
    return fallback
  }

  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    const messages = value
      .map((item) => formatApiErrorMessage(item, ''))
      .filter(Boolean)

    return messages.length ? messages.join('；') : fallback
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const nested = record.detail ?? record.message
    if (nested !== undefined) {
      return formatApiErrorMessage(nested, fallback)
    }

    const validationMessage = record.msg
    if (validationMessage !== undefined) {
      const location = formatValidationLocation(record.loc)
      const message = formatApiErrorMessage(validationMessage, fallback)
      return location ? `${location}: ${message}` : message
    }

    try {
      return JSON.stringify(value)
    } catch {
      return fallback
    }
  }

  return String(value)
}

/**
 * 创建 Axios 实例
 */
const request: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

/**
 * 请求拦截器
 * 自动添加 Authorization Header
 */
request.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // 从 localStorage 获取 Token
    const token = localStorage.getItem('access_token')
    
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`
    }
    
    return config
  },
  (error: AxiosError) => {
    console.error('Request interceptor error:', error)
    return Promise.reject(error)
  }
)

/**
 * 响应拦截器
 * 统一处理错误（401/403/500）
 */
request.interceptors.response.use(
  (response: AxiosResponse) => {
    // 直接返回响应数据
    return response.data
  },
  async (error: AxiosError<ApiErrorResponse>) => {
    const { response } = error

    if (!response) {
      // 网络错误或请求超时
      ElMessage.error('网络连接失败，请检查网络设置')
      return Promise.reject(error)
    }

    const { status, data } = response
    const errorMessage = formatApiErrorMessage(data?.detail ?? data?.message)

    switch (status) {
      case 401:
        // 未授权 - Token 失效或未登录
        ElMessage.error('登录已过期，请重新登录')
        
        // 清除本地存储
        localStorage.removeItem('access_token')
        localStorage.removeItem('user_info')
        
        // 动态导入 router 避免循环依赖
        const { default: router } = await import('@/router')
        
        // 重定向到登录页（避免重复跳转）
        if (router.currentRoute.value.path !== '/login') {
          router.push({
            path: '/login',
            query: { redirect: router.currentRoute.value.fullPath }
          })
        }
        break

      case 403:
        // 权限不足
        ElMessage.error('权限不足，无法访问该资源')
        break

      case 404:
        // 资源不存在
        ElMessage.error('请求的资源不存在')
        break

      case 422:
        // 数据验证失败
        ElMessage.error(`数据验证失败: ${errorMessage}`)
        break

      case 500:
        // 服务器内部错误
        ElMessage.error('服务器内部错误，请稍后重试')
        console.error('Server error:', data)
        break

      case 503:
        // 服务不可用（如 IMS 系统连接失败）
        ElMessage.error(`服务暂时不可用: ${errorMessage}`)
        break

      default:
        // 其他错误
        ElMessage.error(errorMessage)
    }

    return Promise.reject(error)
  }
)

/**
 * 导出 request 实例
 */
export default request

/**
 * 便捷方法：GET 请求
 */
export function get<T = any>(url: string, params?: any): Promise<T> {
  return request.get(url, { params })
}

/**
 * 便捷方法：POST 请求
 */
export function post<T = any>(url: string, data?: any): Promise<T> {
  return request.post(url, data)
}

/**
 * 便捷方法：PUT 请求
 */
export function put<T = any>(url: string, data?: any): Promise<T> {
  return request.put(url, data)
}

/**
 * 便捷方法：DELETE 请求
 */
export function del<T = any>(url: string, params?: any): Promise<T> {
  return request.delete(url, { params })
}

/**
 * 便捷方法：PATCH 请求
 */
export function patch<T = any>(url: string, data?: any): Promise<T> {
  return request.patch(url, data)
}
