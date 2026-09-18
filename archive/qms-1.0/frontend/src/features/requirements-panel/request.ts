import axios, { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { ElMessage } from 'element-plus'

import type { RequirementPanelUser } from './types'

export const REQUIREMENTS_PANEL_TOKEN_KEY = 'requirements_panel_access_token'
export const REQUIREMENTS_PANEL_USER_KEY = 'requirements_panel_user'
export const REQUIREMENTS_PANEL_AUTH_EXPIRED_EVENT = 'requirements-panel-auth-expired'

const requirementsPanelRequest: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

export function saveRequirementsPanelSession(token: string, user: RequirementPanelUser) {
  localStorage.setItem(REQUIREMENTS_PANEL_TOKEN_KEY, token)
  localStorage.setItem(REQUIREMENTS_PANEL_USER_KEY, JSON.stringify(user))
}

export function getStoredRequirementsPanelUser(): RequirementPanelUser | null {
  const raw = localStorage.getItem(REQUIREMENTS_PANEL_USER_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw) as RequirementPanelUser
  } catch {
    return null
  }
}

export function clearRequirementsPanelSession() {
  localStorage.removeItem(REQUIREMENTS_PANEL_TOKEN_KEY)
  localStorage.removeItem(REQUIREMENTS_PANEL_USER_KEY)
}

requirementsPanelRequest.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem(REQUIREMENTS_PANEL_TOKEN_KEY)
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error: AxiosError) => Promise.reject(error)
)

requirementsPanelRequest.interceptors.response.use(
  (response: AxiosResponse) => response.data,
  async (error: AxiosError<{ detail?: string; message?: string }>) => {
    const { response } = error

    if (!response) {
      ElMessage.error('需求面板网络连接失败，请稍后重试')
      return Promise.reject(error)
    }

    const { status, data } = response
    const message = data?.detail || data?.message || '请求失败'

    if (status === 401) {
      clearRequirementsPanelSession()
      window.dispatchEvent(new CustomEvent(REQUIREMENTS_PANEL_AUTH_EXPIRED_EVENT))
      ElMessage.error('需求面板登录已失效，请重新登录')
    } else if (status === 403) {
      ElMessage.error(message || '当前账号没有操作权限')
    } else if (status >= 500) {
      ElMessage.error('需求面板服务异常，请稍后重试')
    } else {
      ElMessage.error(message)
    }

    return Promise.reject(error)
  }
)

export default requirementsPanelRequest
