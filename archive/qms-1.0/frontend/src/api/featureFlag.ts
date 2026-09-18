import request from '@/utils/request'
import type { FeatureFlag } from '@/stores/featureFlag'

/**
 * 功能特性开关 API
 * 
 * 对应需求：2.12.3 功能特性开关
 */

/**
 * 获取当前用户可用的功能列表
 */
export function getMyFeatures(): Promise<FeatureFlag[]> {
  return request({
    url: '/v1/feature-flags/my-features',
    method: 'get'
  })
}

/**
 * 获取所有功能开关列表（管理员）
 */
export function getAllFeatureFlags(): Promise<FeatureFlag[]> {
  return request({
    url: '/v1/admin/feature-flags',
    method: 'get'
  }).then((response: any) => response.feature_flags || [])
}

/**
 * 更新功能开关配置（管理员）
 */
export function updateFeatureFlag(
  featureFlagId: number,
  data: Partial<FeatureFlag>
): Promise<FeatureFlag> {
  return request({
    url: `/v1/admin/feature-flags/${featureFlagId}`,
    method: 'put',
    data
  })
}

export const featureFlagApi = {
  getMyFeatures,
  getAllFeatureFlags,
  updateFeatureFlag
}
