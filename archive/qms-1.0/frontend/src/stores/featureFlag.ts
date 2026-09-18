import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 功能特性开关类型
 */
export interface FeatureFlag {
  key: string
  name: string
  description: string
  is_enabled: boolean
  scope: 'global' | 'whitelist'
  whitelist_user_ids?: number[]
  whitelist_supplier_ids?: number[]
}

/**
 * 功能特性开关 Store
 * 管理系统功能的可见性和可用性
 * 
 * 对应需求：2.12.3 功能特性开关
 */
export const useFeatureFlagStore = defineStore('featureFlag', () => {
  // State
  const features = ref<Record<string, FeatureFlag>>({})
  const loading = ref(false)
  const loadedContext = ref<string | null>(null)

  /**
   * 检查功能是否启用
   * @param featureKey 功能键名
   * @returns 是否启用
   */
  function isFeatureEnabled(featureKey: string): boolean {
    const feature = features.value[featureKey]

    if (!feature) {
      // 功能不存在，默认不启用
      return false
    }

    if (!feature.is_enabled) {
      // 功能全局禁用
      return false
    }

    if (feature.scope === 'global') {
      // 全局启用
      return true
    }

    // 白名单模式：需要检查当前用户是否在白名单中
    // 这里简化处理，实际应该从 authStore 获取当前用户信息
    const userInfoStr = localStorage.getItem('user_info')
    if (!userInfoStr) {
      return false
    }

    try {
      const userInfo = JSON.parse(userInfoStr)

      // 检查用户ID白名单
      if (feature.whitelist_user_ids && feature.whitelist_user_ids.includes(userInfo.id)) {
        return true
      }

      // 检查供应商ID白名单
      if (userInfo.supplier_id && feature.whitelist_supplier_ids &&
        feature.whitelist_supplier_ids.includes(userInfo.supplier_id)) {
        return true
      }

      return false
    } catch (error) {
      console.error('Failed to parse user info:', error)
      return false
    }
  }

  /**
   * 从后端加载功能开关配置
   */
  async function loadFeatureFlags(force = false): Promise<void> {
    const userInfoStr = localStorage.getItem('user_info')
    const environment = localStorage.getItem('current_environment') || 'stable'
    const contextKey = `${environment}:${userInfoStr || 'anonymous'}`
    if (!force && loadedContext.value === contextKey) {
      return
    }

    loading.value = true

    try {
      // 动态导入避免循环依赖
      const { featureFlagApi } = await import('@/api/featureFlag')
      const response = await featureFlagApi.getMyFeatures() as any

      // 后端返回格式: { user_id: number, enabled_features: string[] }
      // 将启用的功能键列表转换为 Map 结构
      const enabledKeys: string[] = response?.enabled_features || response || []

      if (Array.isArray(enabledKeys)) {
        // 后端返回的是功能键列表（string[]），构造最小 FeatureFlag 对象
        const flagMap: Record<string, FeatureFlag> = {}
        for (const key of enabledKeys) {
          if (typeof key === 'string') {
            flagMap[key] = {
              key,
              name: key,
              description: '',
              is_enabled: true,
              scope: 'global'
            }
          } else if (typeof key === 'object' && key !== null && 'key' in key) {
            // 兼容返回完整 FeatureFlag 对象数组的情况
            flagMap[(key as FeatureFlag).key] = key as FeatureFlag
          }
        }
        features.value = flagMap
        loadedContext.value = contextKey
      } else {
        features.value = {}
        loadedContext.value = contextKey
      }
    } catch (error) {
      console.error('Failed to load feature flags:', error)
      // 加载失败时使用默认配置（所有预留功能默认禁用）
      features.value = {
        'instruments.management': {
          key: 'instruments.management',
          name: '仪器量具管理',
          description: '仪器量具全生命周期管理功能',
          is_enabled: false,
          scope: 'global'
        },
        'quality_costs.management': {
          key: 'quality_costs.management',
          name: '质量成本管理',
          description: '质量成本统计与分析功能',
          is_enabled: false,
          scope: 'global'
        }
      }
      loadedContext.value = contextKey
    } finally {
      loading.value = false
    }
  }

  /**
   * 更新功能开关状态（管理员功能）
   * @param featureKey 功能键名
   * @param enabled 是否启用
   */
  async function updateFeatureFlag(
    featureFlagId: number,
    featureKey: string,
    enabled: boolean
  ): Promise<void> {
    try {
      const { featureFlagApi } = await import('@/api/featureFlag')
      await featureFlagApi.updateFeatureFlag(featureFlagId, { is_enabled: enabled })

      // 更新本地状态
      if (features.value[featureKey]) {
        features.value[featureKey].is_enabled = enabled
      }
    } catch (error) {
      console.error('Failed to update feature flag:', error)
      throw error
    }
  }

  return {
    // State
    features,
    loading,
    loadedContext,

    // Actions
    isFeatureEnabled,
    loadFeatureFlags,
    updateFeatureFlag
  }
})
