import type { QuickAction } from '@/types/workbench'

export interface WorkbenchQuickActionOption extends QuickAction {
  id: string
  category: string
  audience?: 'all' | 'internal' | 'supplier'
  requiresPlatformAdmin?: boolean
  featureKey?: string
}

export interface WorkbenchQuickActionContext {
  isInternal: boolean
  isSupplier: boolean
  isPlatformAdmin: boolean
  isFeatureEnabled: (featureKey: string) => boolean
  canAccessRoute: (path: string) => boolean
}

const WORKBENCH_QUICK_ACTION_CATALOG: WorkbenchQuickActionOption[] = [
  {
    id: 'workbench-profile',
    category: '基础入口',
    title: '个人中心',
    description: '查看资料、修改密码与电子签名',
    link: '/workbench'
  },
  {
    id: 'quality-dashboard',
    category: '质量数据面板',
    title: '质量数据看板',
    description: '查看核心质量指标与可视化看板',
    link: '/quality-dashboard'
  },
  {
    id: 'quality-analysis',
    category: '质量数据面板',
    title: '专项数据分析',
    description: '进入专题分析页查看质量趋势与明细',
    link: '/quality-dashboard/analysis'
  },
  {
    id: 'quality-eight-d-workspace',
    category: '质量数据面板',
    title: '8D 报告中心',
    description: '在同一工作区内切换处理供应商 8D 与客户 8D',
    link: '/quality/eight-d-workspace'
  },
  {
    id: 'supplier-scar',
    category: '供应商质量管理',
    title: 'SCAR 管理',
    description: '处理供应商纠正预防措施与闭环跟踪',
    link: '/supplier/scar'
  },
  {
    id: 'supplier-audit-plan',
    category: '供应商质量管理',
    title: '供应商审核',
    description: '管理供应商审核计划与执行进度',
    link: '/supplier/audit-plan'
  },
  {
    id: 'supplier-targets',
    category: '供应商质量管理',
    title: '目标管理',
    description: '维护供应商目标与改善方向',
    link: '/supplier/targets'
  },
  {
    id: 'supplier-performance',
    category: '供应商质量管理',
    title: '绩效评价',
    description: '查看供应商绩效得分与趋势',
    link: '/supplier/performance'
  },
  {
    id: 'supplier-meetings',
    category: '供应商质量管理',
    title: '供应商会议',
    description: '追踪例会纪要与行动项',
    link: '/supplier/meetings'
  },
  {
    id: 'supplier-ppap',
    category: '供应商质量管理',
    title: 'PPAP 管理',
    description: '处理生产件批准与资料审核',
    link: '/supplier/ppap'
  },
  {
    id: 'supplier-inspection-specs',
    category: '供应商质量管理',
    title: '检验规范',
    description: '查看来料检验规范与版本要求',
    link: '/supplier/inspection-specs'
  },
  {
    id: 'supplier-barcode',
    category: '供应商质量管理',
    title: '防错扫码',
    description: '进入扫码入口进行防错校验',
    link: '/supplier/barcode'
  },
  {
    id: 'supplier-claims',
    category: '供应商质量管理',
    title: '供应商索赔',
    description: '查看供应商索赔记录与处置状态',
    link: '/supplier/claims'
  },
  {
    id: 'supplier-change-management',
    category: '供应商质量管理',
    title: '供应商变更',
    description: '跟踪供应商变更申请与审批进度',
    link: '/supplier/change-management'
  },
  {
    id: 'process-defects',
    category: '过程质量管理',
    title: '不合格品数据',
    description: '查看过程不合格数据与趋势',
    link: '/quality/process-defects'
  },
  {
    id: 'process-issues',
    category: '过程质量管理',
    title: '过程问题管理',
    description: '追踪过程质量问题与关闭状态',
    link: '/quality/process-issues'
  },
  {
    id: 'customer-complaints',
    category: '客户质量管理',
    title: '客诉管理',
    description: '处理客户投诉与反馈闭环',
    link: '/quality/customer-complaints'
  },
  {
    id: 'customer-claims',
    category: '客户质量管理',
    title: '客户索赔',
    description: '管理客户索赔记录与进度',
    link: '/quality/customer-claims'
  },
  {
    id: 'lesson-learned',
    category: '新品质量管理',
    title: '经验教训库',
    description: '沉淀与检索历史质量经验',
    link: '/quality/lesson-learned'
  },
  {
    id: 'newproduct-projects',
    category: '新品质量管理',
    title: '项目管理',
    description: '查看新品项目推进状态',
    link: '/newproduct/projects'
  },
  {
    id: 'newproduct-stage-review',
    category: '新品质量管理',
    title: '阶段评审',
    description: '跟踪项目阶段评审与结论',
    link: '/newproduct/stage-review'
  },
  {
    id: 'newproduct-lesson-check',
    category: '新品质量管理',
    title: '经验教训检查',
    description: '执行项目经验教训落地检查',
    link: '/newproduct/lesson-check'
  },
  {
    id: 'newproduct-trial',
    category: '新品质量管理',
    title: '试产管理',
    description: '维护试产计划、问题与状态',
    link: '/newproduct/trial'
  },
  {
    id: 'newproduct-defects',
    category: '新品质量管理',
    title: '新品不良登记',
    description: '登记新品客诉和试产不良并发起问题跟进',
    link: '/newproduct/defects'
  },
  {
    id: 'newproduct-trial-issues',
    category: '新品质量管理',
    title: '试产问题',
    description: '查看试产阶段问题清单',
    link: '/newproduct/trial-issues'
  },
  {
    id: 'newproduct-trial-summary',
    category: '新品质量管理',
    title: '试产总结',
    description: '汇总试产结果与改进项',
    link: '/newproduct/trial-summary'
  },
  {
    id: 'audit-plans',
    category: '审核管理',
    title: '审核计划',
    description: '查看审核计划排程与任务',
    link: '/audit/plans'
  },
  {
    id: 'audit-templates',
    category: '审核管理',
    title: '审核模板',
    description: '维护审核模板与检查项',
    link: '/audit/templates'
  },
  {
    id: 'audit-execution',
    category: '审核管理',
    title: '审核执行',
    description: '进入审核执行与记录流程',
    link: '/audit/execution'
  },
  {
    id: 'audit-nc-list',
    category: '审核管理',
    title: '不符合项',
    description: '跟踪不符合项整改与验证',
    link: '/audit/nc-list'
  },
  {
    id: 'audit-report',
    category: '审核管理',
    title: '审核报告',
    description: '查看审核结论与报告归档',
    link: '/audit/report'
  },
  {
    id: 'audit-customer',
    category: '审核管理',
    title: '客户审核',
    description: '管理客户审核记录与结果',
    link: '/audit/customer'
  },
  {
    id: 'admin-users',
    category: '系统管理',
    title: '用户管理',
    description: '审核注册申请并治理账号状态',
    link: '/admin/users'
  },
  {
    id: 'admin-permissions',
    category: '系统管理',
    title: '权限矩阵',
    description: '配置模块权限与操作授权',
    link: '/admin/permissions'
  },
  {
    id: 'admin-tasks',
    category: '系统管理',
    title: '任务监控',
    description: '查看平台聚合任务与超期情况',
    link: '/admin/tasks'
  },
  {
    id: 'admin-operation-logs',
    category: '系统管理',
    title: '操作日志',
    description: '审计关键系统操作记录',
    link: '/admin/operation-logs'
  },
  {
    id: 'admin-feature-flags',
    category: '系统管理',
    title: '功能开关',
    description: '治理正式与预览环境功能开关',
    link: '/admin/feature-flags'
  },
  {
    id: 'instruments',
    category: '预留能力',
    title: '仪器量具管理',
    description: '管理仪器量具全生命周期',
    link: '/instruments',
    featureKey: 'instruments.management'
  },
  {
    id: 'quality-costs',
    category: '预留能力',
    title: '质量成本管理',
    description: '查看质量成本统计与分析',
    link: '/quality-costs',
    featureKey: 'quality_costs.management'
  }
]

export function getWorkbenchQuickActionStorageKey(userId: number | string) {
  return `workbench.quick-actions.${userId}`
}

export function getConfigurableQuickActions(context: WorkbenchQuickActionContext) {
  return WORKBENCH_QUICK_ACTION_CATALOG.filter((item) => {
    const matchesAudience =
      item.audience === undefined ||
      item.audience === 'all' ||
      (item.audience === 'internal' && context.isInternal) ||
      (item.audience === 'supplier' && context.isSupplier)

    if (!matchesAudience) {
      return false
    }

    if (item.requiresPlatformAdmin && !context.isPlatformAdmin) {
      return false
    }

    if (!context.canAccessRoute(item.link)) {
      return false
    }

    return true
  })
}

export function getVisibleQuickActions(
  selectedIds: string[],
  options: WorkbenchQuickActionOption[],
  context: WorkbenchQuickActionContext
) {
  const optionMap = new Map(options.map((item) => [item.id, item]))

  return selectedIds
    .map((id) => optionMap.get(id))
    .filter((item): item is WorkbenchQuickActionOption => {
      if (!item) {
        return false
      }

      if (item.featureKey && !context.isFeatureEnabled(item.featureKey)) {
        return false
      }

      return true
    })
    .map(({ title, description, link }) => ({ title, description, link }))
}

export function getDefaultQuickActionIds(
  backendQuickActions: QuickAction[],
  options: WorkbenchQuickActionOption[]
) {
  const matchedIds = backendQuickActions
    .map((action) => options.find((option) => option.link === action.link)?.id)
    .filter((id): id is string => Boolean(id))

  if (matchedIds.length > 0) {
    return Array.from(new Set(matchedIds))
  }

  return options.slice(0, 6).map((item) => item.id)
}

export function sanitizeQuickActionIds(
  selectedIds: string[],
  options: WorkbenchQuickActionOption[]
) {
  const optionIds = new Set(options.map((item) => item.id))

  return Array.from(
    new Set(selectedIds.filter((id) => optionIds.has(id)))
  )
}

export function isQuickActionCurrentlyAvailable(
  option: WorkbenchQuickActionOption,
  context: WorkbenchQuickActionContext
) {
  if (!option.featureKey) {
    return true
  }

  return context.isFeatureEnabled(option.featureKey)
}

export { WORKBENCH_QUICK_ACTION_CATALOG }
