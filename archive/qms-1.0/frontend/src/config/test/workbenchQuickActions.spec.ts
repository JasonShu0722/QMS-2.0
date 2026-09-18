import { describe, expect, it } from 'vitest'
import {
  getConfigurableQuickActions,
  getDefaultQuickActionIds,
  getVisibleQuickActions,
  sanitizeQuickActionIds
} from '../workbenchQuickActions'

const adminContext = {
  isInternal: true,
  isSupplier: false,
  isPlatformAdmin: true,
  isFeatureEnabled: (featureKey: string) => featureKey !== 'quality_costs.management',
  canAccessRoute: (path: string) => path !== '/quality-costs'
}

describe('workbenchQuickActions', () => {
  it('includes system management items for platform admins', () => {
    const options = getConfigurableQuickActions(adminContext)

    expect(options.some((item) => item.id === 'admin-users')).toBe(true)
    expect(options.some((item) => item.id === 'admin-feature-flags')).toBe(true)
  })

  it('filters out actions whose routes are not currently accessible', () => {
    const options = getConfigurableQuickActions({
      ...adminContext,
      canAccessRoute: (path: string) => !['/admin/users', '/quality-costs'].includes(path)
    })

    expect(options.some((item) => item.id === 'admin-users')).toBe(false)
    expect(options.some((item) => item.id === 'quality-dashboard')).toBe(true)
  })

  it('maps backend default shortcuts to catalog ids', () => {
    const options = getConfigurableQuickActions(adminContext)
    const defaultIds = getDefaultQuickActionIds(
      [
        {
          title: '个人中心',
          description: '查看资料、修改密码与电子签名',
          link: '/workbench'
        },
        {
          title: '用户管理',
          description: '审核注册申请并治理平台账号',
          link: '/admin/users'
        }
      ],
      options
    )

    expect(defaultIds).toEqual(['workbench-profile', 'admin-users'])
  })

  it('filters hidden feature-gated actions from workbench display while keeping selections valid', () => {
    const options = getConfigurableQuickActions(adminContext)
    const selectedIds = sanitizeQuickActionIds(
      ['admin-users', 'instruments', 'quality-costs', 'not-exists'],
      options
    )
    const visibleActions = getVisibleQuickActions(selectedIds, options, adminContext)

    expect(selectedIds).toEqual(['admin-users', 'instruments'])
    expect(visibleActions.map((item) => item.link)).toEqual(['/admin/users', '/instruments'])
  })
})
