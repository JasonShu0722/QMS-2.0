import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ElMessage } from 'element-plus'
import { matchesRouteAudience } from '@/utils/accessControl'

/**
 * 路由元信息接口
 */
declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    requiresAuth?: boolean
    requiresPlatformAdmin?: boolean
    featureKey?: string
    audience?: 'all' | 'internal' | 'supplier'
    permission?: {
      modulePath: string
      operation: 'create' | 'read' | 'update' | 'delete' | 'export'
    }
  }
}

/**
 * 路由配置
 */
function getSingleQueryValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0]
  }

  return undefined
}

type EightDRedirectSource = {
  params: Record<string, unknown>
  query: Record<string, unknown>
}

function buildSupplierEightDRedirect(
  to: EightDRedirectSource,
  sourceRouteName: string,
  defaultAction?: string,
) {
  const id = getSingleQueryValue(to.params.id)
  if (!id) {
    return { name: 'EightDWorkspace' }
  }

  return {
    name: 'EightDWorkspace',
    query: {
      kind: 'supplier',
      recordId: id,
      action: getSingleQueryValue(to.query.action) ?? defaultAction,
      sourceRouteName: getSingleQueryValue(to.query.sourceRouteName) ?? sourceRouteName,
      sourceFocusId: getSingleQueryValue(to.query.sourceFocusId) ?? id,
    },
  }
}

function buildCustomerEightDRedirect(to: EightDRedirectSource) {
  const id = getSingleQueryValue(to.params.id)
  if (!id) {
    return { name: 'EightDWorkspace' }
  }

  return {
    name: 'EightDWorkspace',
    query: {
      kind: 'customer',
      recordId: id,
      sourceRouteName: getSingleQueryValue(to.query.sourceRouteName) ?? 'CustomerComplaintList',
      sourceFocusId: getSingleQueryValue(to.query.sourceFocusId) ?? id,
      sourceComplaintId: getSingleQueryValue(to.query.sourceComplaintId) ?? id,
    },
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/layouts/MainLayout.vue'),
    children: [
      {
        path: '',
        redirect: '/workbench'
      },
      // ==================== 工作台 ====================
      {
        path: 'workbench',
        name: 'Workbench',
        component: () => import('@/views/Workbench.vue'),
        meta: { title: '工作台', requiresAuth: true }
      },
      // ==================== 供应商管理 ====================
      {
        path: 'supplier/dashboard',
        name: 'SupplierDashboard',
        component: () => import('@/views/supplier/SupplierDashboard.vue'),
        meta: { title: '供应商总览', requiresAuth: true, permission: { modulePath: 'supplier.management', operation: 'read' } }
      },
      {
        path: 'supplier/performance',
        name: 'SupplierPerformance',
        component: () => import('@/views/supplier/SupplierPerformance.vue'),
        meta: { title: '供应商绩效', requiresAuth: true, permission: { modulePath: 'supplier.performance', operation: 'read' } }
      },
      {
        path: 'supplier/targets',
        name: 'SupplierTargets',
        component: () => import('@/views/supplier/SupplierTargets.vue'),
        meta: { title: '目标管理', requiresAuth: true, permission: { modulePath: 'supplier.performance', operation: 'read' } }
      },
      {
        path: 'supplier/audit-plan',
        name: 'SupplierAuditPlan',
        component: () => import('@/views/supplier/SupplierAuditPlan.vue'),
        meta: { title: '供应商审核计划', requiresAuth: true, permission: { modulePath: 'supplier.audit', operation: 'read' } }
      },
      {
        path: 'supplier/ppap',
        name: 'PPAPManagement',
        component: () => import('@/views/supplier/PPAPManagement.vue'),
        meta: { title: 'PPAP管理', requiresAuth: true, permission: { modulePath: 'supplier.ppap', operation: 'read' } }
      },
      {
        path: 'supplier/scar',
        name: 'SCARList',
        component: () => import('@/views/supplier/SCARList.vue'),
        meta: { title: 'SCAR管理', requiresAuth: true, permission: { modulePath: 'supplier.scar', operation: 'read' } }
      },
      {
        path: 'supplier/eight-d/:id?',
        name: 'EightDForm',
        redirect: (to) => buildSupplierEightDRedirect(to, 'SCARList'),
        meta: { title: '8D报告', requiresAuth: true, permission: { modulePath: 'supplier.scar', operation: 'read' } }
      },
      {
        path: 'supplier/inspection-specs',
        name: 'InspectionSpecs',
        component: () => import('@/views/supplier/InspectionSpecs.vue'),
        meta: { title: '检验规范', requiresAuth: true, permission: { modulePath: 'quality.incoming', operation: 'read' } }
      },
      {
        path: 'supplier/barcode',
        name: 'BarcodeScanner',
        component: () => import('@/views/supplier/BarcodeScanner.vue'),
        meta: { title: '条码扫描', requiresAuth: true, permission: { modulePath: 'supplier.management', operation: 'read' } }
      },
      {
        path: 'supplier/claims',
        name: 'SupplierClaimList',
        component: () => import('@/views/SupplierClaimList.vue'),
        meta: { title: '供应商索赔', requiresAuth: true, permission: { modulePath: 'supplier.scar', operation: 'read' } }
      },
      {
        path: 'supplier/change-management',
        name: 'SupplierChangeManagement',
        component: () => import('@/views/supplier/SupplierChangeManagement.vue'),
        meta: { title: '供应商变更', requiresAuth: true, permission: { modulePath: 'supplier.management', operation: 'read' } }
      },
      {
        path: 'supplier/meetings',
        name: 'SupplierMeetings',
        component: () => import('@/views/supplier/SupplierMeetings.vue'),
        meta: { title: '供应商会议', requiresAuth: true, permission: { modulePath: 'supplier.performance', operation: 'read' } }
      },
      // ==================== 质量管理 - 来料 ====================
      {
        path: 'quality/scar',
        name: 'ScarManagement',
        component: () => import('@/views/supplier/SCARList.vue'),
        meta: { title: 'SCAR管理', requiresAuth: true, permission: { modulePath: 'quality.incoming', operation: 'read' } }
      },
      {
        path: 'quality/scar/eight-d/:id?',
        name: 'ScarEightDReview',
        redirect: (to) => buildSupplierEightDRedirect(to, 'ScarManagement', 'review'),
        meta: { title: 'SCAR 8D审核', requiresAuth: true, permission: { modulePath: 'quality.incoming', operation: 'read' } }
      },
      // ==================== 质量管理 - 过程 ====================
      {
        path: 'quality/process-defects',
        name: 'ProcessDefectList',
        component: () => import('@/views/ProcessDefectList.vue'),
        meta: { title: '过程不良', requiresAuth: true, permission: { modulePath: 'quality.process', operation: 'read' } }
      },
      {
        path: 'quality/process-issues',
        name: 'ProcessIssueList',
        component: () => import('@/views/ProcessIssueList.vue'),
        meta: { title: '过程问题', requiresAuth: true, permission: { modulePath: 'quality.process', operation: 'read' } }
      },
      {
        path: 'quality/process-issues/:id',
        name: 'ProcessIssueDetail',
        component: () => import('@/views/ProcessIssueDetail.vue'),
        meta: { title: '问题详情', requiresAuth: true, permission: { modulePath: 'quality.process', operation: 'read' } }
      },
      // ==================== 质量管理 - 客户 ====================
      {
        path: 'quality/customer-complaints',
        name: 'CustomerComplaintList',
        component: () => import('@/views/CustomerComplaintList.vue'),
        meta: { title: '客户投诉', requiresAuth: true, permission: { modulePath: 'quality.customer', operation: 'read' } }
      },
      {
        path: 'quality/customer-complaints/:id',
        name: 'CustomerComplaintDetail',
        component: () => import('@/views/CustomerComplaintDetail.vue'),
        meta: { title: '客诉详情', requiresAuth: true, permission: { modulePath: 'quality.customer', operation: 'read' } }
      },
      {
        path: 'quality/eight-d-customer/:id?',
        name: 'EightDCustomerForm',
        redirect: (to) => buildCustomerEightDRedirect(to),
        meta: { title: '客户8D报告', requiresAuth: true, permission: { modulePath: 'quality.customer', operation: 'read' } }
      },
      {
        path: 'quality/customer-eight-d',
        name: 'CustomerEightDList',
        component: () => import('@/views/CustomerEightDList.vue'),
        meta: { title: '客诉8D', requiresAuth: true, permission: { modulePath: 'quality.customer', operation: 'read' } }
      },
      {
        path: 'quality/eight-d-workspace',
        name: 'EightDWorkspace',
        component: () => import('@/views/EightDWorkspace.vue'),
        meta: { title: '8D报告', requiresAuth: true }
      },
      {
        path: 'quality/customer-claims',
        name: 'CustomerClaimList',
        component: () => import('@/views/CustomerClaimList.vue'),
        meta: { title: '客户索赔', requiresAuth: true, permission: { modulePath: 'quality.customer', operation: 'read' } }
      },
      // ==================== 质量管理 - 数据 ====================
      {
        path: 'quality-dashboard',
        name: 'QualityDashboard',
        component: () => import('@/views/QualityDashboard.vue'),
        meta: { title: '质量数据仪表盘', requiresAuth: true }
      },
      {
        path: 'quality-dashboard/analysis',
        name: 'QualityDataAnalysis',
        component: () => import('@/views/QualityDataAnalysis.vue'),
        meta: { title: '专项数据分析', requiresAuth: true, audience: 'internal' }
      },
      {
        path: 'quality/lesson-learned',
        name: 'LessonLearnedLibrary',
        component: () => import('@/views/LessonLearnedLibrary.vue'),
        meta: { title: '经验教训库', requiresAuth: true, permission: { modulePath: 'quality.process', operation: 'read' } }
      },
      // ==================== 审核管理 ====================
      {
        path: 'quality/problem-center',
        name: 'ProblemIssueCenter',
        component: () => import('@/views/ProblemIssueCenter.vue'),
        meta: {
          title: '问题中心',
          requiresAuth: true,
          audience: 'internal',
          permission: { modulePath: 'quality.data_panel', operation: 'read' }
        }
      },
      {
        path: 'audit/plans',
        name: 'AuditPlanCalendar',
        component: () => import('@/views/AuditPlanCalendar.vue'),
        meta: { title: '审核计划', requiresAuth: true, permission: { modulePath: 'audit.system', operation: 'read' } }
      },
      {
        path: 'audit/templates',
        name: 'AuditTemplates',
        component: () => import('@/views/AuditTemplates.vue'),
        meta: { title: '审核模板', requiresAuth: true, permission: { modulePath: 'audit.system', operation: 'read' } }
      },
      {
        path: 'audit/execution',
        name: 'AuditExecution',
        component: () => import('@/views/AuditExecution.vue'),
        meta: { title: '审核执行', requiresAuth: true, permission: { modulePath: 'audit.system', operation: 'read' } }
      },
      {
        path: 'audit/checklist',
        name: 'AuditChecklistMobile',
        component: () => import('@/views/AuditChecklistMobile.vue'),
        meta: { title: '检查清单', requiresAuth: true, permission: { modulePath: 'audit.system', operation: 'read' } }
      },
      {
        path: 'audit/nc-list',
        name: 'AuditNCList',
        component: () => import('@/views/AuditNCList.vue'),
        meta: { title: '不符合项', requiresAuth: true, permission: { modulePath: 'audit.system', operation: 'read' } }
      },
      {
        path: 'audit/report',
        name: 'AuditReport',
        component: () => import('@/views/AuditReport.vue'),
        meta: { title: '审核报告', requiresAuth: true, permission: { modulePath: 'audit.system', operation: 'read' } }
      },
      {
        path: 'audit/customer',
        name: 'CustomerAuditList',
        component: () => import('@/views/CustomerAuditList.vue'),
        meta: { title: '客户审核', requiresAuth: true, permission: { modulePath: 'audit.system', operation: 'read' } }
      },
      // ==================== 新产品管理 ====================
      {
        path: 'newproduct/projects',
        name: 'NewProductProjects',
        component: () => import('@/views/NewProductProjects.vue'),
        meta: { title: '新产品项目', requiresAuth: true, permission: { modulePath: 'newproduct.management', operation: 'read' } }
      },
      {
        path: 'newproduct/stage-review',
        name: 'StageReview',
        component: () => import('@/views/StageReview.vue'),
        meta: { title: '阶段评审', requiresAuth: true, permission: { modulePath: 'newproduct.management', operation: 'read' } }
      },
      {
        path: 'newproduct/lesson-check',
        name: 'ProjectLessonCheck',
        component: () => import('@/views/ProjectLessonCheck.vue'),
        meta: { title: '经验教训检查', requiresAuth: true, permission: { modulePath: 'newproduct.management', operation: 'read' } }
      },
      {
        path: 'newproduct/trial',
        name: 'TrialProduction',
        component: () => import('@/views/TrialProduction.vue'),
        meta: { title: '试产管理', requiresAuth: true, permission: { modulePath: 'newproduct.trial', operation: 'read' } }
      },
      {
        path: 'newproduct/trial-issues',
        name: 'TrialIssueList',
        component: () => import('@/views/TrialIssueList.vue'),
        meta: { title: '试产问题', requiresAuth: true, permission: { modulePath: 'newproduct.trial', operation: 'read' } }
      },
      {
        path: 'newproduct/trial-summary',
        name: 'TrialProductionSummary',
        component: () => import('@/views/TrialProductionSummary.vue'),
        meta: { title: '试产总结', requiresAuth: true, permission: { modulePath: 'newproduct.trial', operation: 'read' } }
      },
      // ==================== 系统管理 ====================
      {
        path: 'admin/users',
        name: 'UserApproval',
        component: () => import('@/views/admin/UserApproval.vue'),
        meta: { title: '用户管理', requiresAuth: true, audience: 'internal', permission: { modulePath: 'system.users', operation: 'read' } }
      },
      {
        path: 'admin/suppliers',
        name: 'SupplierMaster',
        component: () => import('@/views/admin/SupplierMaster.vue'),
        meta: { title: '供应商基础信息', requiresAuth: true, audience: 'internal', permission: { modulePath: 'system.master_data', operation: 'read' } }
      },
      {
        path: 'admin/customers',
        name: 'CustomerMaster',
        component: () => import('@/views/admin/CustomerMaster.vue'),
        meta: { title: '客户基础信息', requiresAuth: true, audience: 'internal', permission: { modulePath: 'system.master_data', operation: 'read' } }
      },
      {
        path: 'admin/permissions',
        name: 'PermissionMatrix',
        component: () => import('@/views/admin/PermissionMatrix.vue'),
        meta: { title: '权限管理', requiresAuth: true, audience: 'internal', permission: { modulePath: 'system.permissions', operation: 'read' } }
      },
      {
        path: 'admin/tasks',
        name: 'TaskMonitor',
        component: () => import('@/views/admin/TaskMonitor.vue'),
        meta: { title: '任务监控', requiresAuth: true, audience: 'internal', permission: { modulePath: 'system.tasks', operation: 'read' } }
      },
      {
        path: 'admin/operation-logs',
        name: 'OperationLogs',
        component: () => import('@/views/admin/OperationLogs.vue'),
        meta: { title: '操作日志', requiresAuth: true, audience: 'internal', permission: { modulePath: 'system.logs', operation: 'read' } }
      },
      {
        path: 'admin/feature-flags',
        name: 'FeatureFlags',
        component: () => import('@/views/admin/FeatureFlags.vue'),
        meta: { title: '功能开关', requiresAuth: true, audience: 'internal', permission: { modulePath: 'system.feature_flags', operation: 'read' } }
      },
      // ==================== 预留功能 ====================
      {
        path: 'instruments',
        name: 'Instruments',
        component: () => import('@/views/Instruments.vue'),
        meta: { title: '仪器量具管理', requiresAuth: true, featureKey: 'instruments.management' }
      },
      {
        path: 'quality-costs',
        name: 'QualityCosts',
        component: () => import('@/views/QualityCosts.vue'),
        meta: { title: '质量成本管理', requiresAuth: true, featureKey: 'quality_costs.management' }
      }
    ]
  },
  {
    path: '/requirements-panel',
    name: 'RequirementsPanel',
    component: () => import('@/features/requirements-panel/RequirementsPanel.vue'),
    meta: {
      title: '需求面板',
      requiresAuth: false
    }
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: {
      title: '登录',
      requiresAuth: false
    }
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('@/views/Register.vue'),
    meta: {
      title: '注册',
      requiresAuth: false
    }
  },
  {
    path: '/scanner',
    name: 'Scanner',
    component: () => import('@/views/Scanner.vue'),
    meta: {
      title: '扫码',
      requiresAuth: true
    }
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFound.vue'),
    meta: {
      title: '页面不存在',
      requiresAuth: false
    }
  }
]

/**
 * 创建路由实例
 */
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

/**
 * 全局前置守卫
 * 1. 验证 Token 有效性
 * 2. 检查路由权限
 * 3. 动态设置页面标题
 */
router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore()
  const { useFeatureFlagStore } = await import('@/stores/featureFlag')
  const featureFlagStore = useFeatureFlagStore()
  const requiresAuth = to.meta.requiresAuth !== false

  // 设置页面标题
  if (to.meta.title) {
    document.title = `${to.meta.title} - QMS 质量管理系统`
  }

  // 1. 检查是否需要登录
  if (requiresAuth && !authStore.isAuthenticated) {
    // 未登录用户重定向到登录页
    ElMessage.warning('请先登录')
    next({
      path: '/login',
      query: { redirect: to.fullPath }
    })
    return
  }

  // 2. 已登录用户访问登录/注册页时重定向到工作台
  if (!requiresAuth && authStore.isAuthenticated && (to.path === '/login' || to.path === '/register')) {
    next('/workbench')
    return
  }

  if (requiresAuth) {
    await featureFlagStore.loadFeatureFlags()
    await authStore.loadPermissionTree()
  }

  if (
    requiresAuth &&
    !matchesRouteAudience(to.meta.audience, {
      isAuthenticated: authStore.isAuthenticated,
      isInternal: authStore.isInternal,
      isSupplier: authStore.isSupplier,
      isPlatformAdmin: authStore.isPlatformAdmin,
      isFeatureEnabled: (featureKey: string) => featureFlagStore.isFeatureEnabled(featureKey),
      hasPermission: (modulePath, operation) => authStore.hasPermissionLocal(modulePath, operation),
    })
  ) {
    ElMessage.error('当前账号无法访问该页面')
    next('/workbench')
    return
  }

  if (requiresAuth && to.meta.requiresPlatformAdmin && !authStore.isPlatformAdmin) {
    ElMessage.error('仅平台管理员可访问该页面')
    next('/workbench')
    return
  }

  if (requiresAuth && to.meta.featureKey && !featureFlagStore.isFeatureEnabled(to.meta.featureKey)) {
    ElMessage.error('该功能当前未对你开放')
    next('/workbench')
    return
  }

  // 3. 检查路由权限（如果配置了 permission）
  if (requiresAuth && to.meta.permission) {
    const { modulePath, operation } = to.meta.permission

    try {
      const hasPermission = await authStore.checkPermission(modulePath, operation)

      if (!hasPermission) {
        ElMessage.error('权限不足，无法访问该页面')
        // 返回上一页或跳转到工作台
        if (from.path !== '/') {
          next(false)
        } else {
          next('/workbench')
        }
        return
      }
    } catch (error) {
      console.error('Permission check failed:', error)
      ElMessage.error('权限验证失败')
      next('/workbench')
      return
    }
  }

  // 4. 通过所有检查，允许访问
  next()
})

/**
 * 全局后置钩子
 * 用于页面加载完成后的处理
 */
router.afterEach((to) => {
  // 可以在这里添加页面访问统计等逻辑
  console.log(`Navigated to: ${to.path}`)
})

/**
 * 动态添加路由（用于根据权限动态渲染菜单）
 * @param routes 路由配置数组
 */
export function addDynamicRoutes(routes: RouteRecordRaw[]) {
  routes.forEach(route => {
    router.addRoute(route)
  })
}

/**
 * 重置路由（用于用户登出时清理动态路由）
 */
export function resetRouter() {
  const newRouter = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes
  })

    // 替换 matcher
    ; (router as any).matcher = (newRouter as any).matcher
}

export default router
