import type { Component } from 'vue'
import {
  DataLine,
  Document,
  HomeFilled,
  Monitor,
  Money,
  OfficeBuilding,
  Opportunity,
  Setting,
  Tools,
  UserFilled,
} from '@element-plus/icons-vue'

export interface NavigationLeaf {
  index: string
  title: string
}

export interface NavigationItem extends NavigationLeaf {
  icon: Component
}

export interface NavigationSection {
  index: string
  title: string
  icon: Component
  children: NavigationLeaf[]
}

export const PRIMARY_NAV_ITEMS: NavigationItem[] = [
  {
    index: '/workbench',
    title: '工作台',
    icon: HomeFilled,
  },
]

export const NAV_SECTIONS: NavigationSection[] = [
  {
    index: 'quality-data',
    title: '质量数据面板',
    icon: DataLine,
    children: [
      { index: '/quality/problem-center', title: '问题中心' },
      { index: '/quality/eight-d-workspace', title: '8D 报告中心' },
      { index: '/quality-dashboard', title: '数据仪表盘' },
      { index: '/quality-dashboard/analysis', title: '专项数据分析' },
    ],
  },
  {
    index: 'supplier',
    title: '供应商质量管理',
    icon: OfficeBuilding,
    children: [
      { index: '/supplier/scar', title: 'SCAR 管理' },
      { index: '/supplier/audit-plan', title: '供应商审核' },
      { index: '/supplier/targets', title: '目标管理' },
      { index: '/supplier/performance', title: '绩效评价' },
      { index: '/supplier/meetings', title: '供应商会议' },
      { index: '/supplier/ppap', title: 'PPAP 管理' },
      { index: '/supplier/inspection-specs', title: '检验规范' },
      { index: '/supplier/barcode', title: '防错扫码' },
      { index: '/supplier/claims', title: '供应商索赔' },
      { index: '/supplier/change-management', title: '供应商变更' },
    ],
  },
  {
    index: 'process-quality',
    title: '过程质量管理',
    icon: Monitor,
    children: [
      { index: '/quality/process-defects', title: '不合格品数据' },
      { index: '/quality/process-issues', title: '过程问题管理' },
    ],
  },
  {
    index: 'customer-quality',
    title: '客户质量管理',
    icon: UserFilled,
    children: [
      { index: '/quality/customer-complaints', title: '客诉管理' },
      { index: '/quality/customer-eight-d', title: '客诉8D' },
      { index: '/quality/customer-claims', title: '客户索赔' },
    ],
  },
  {
    index: 'newproduct',
    title: '新品质量管理',
    icon: Opportunity,
    children: [
      { index: '/quality/lesson-learned', title: '经验教训库' },
      { index: '/newproduct/projects', title: '项目管理' },
      { index: '/newproduct/stage-review', title: '阶段评审' },
      { index: '/newproduct/lesson-check', title: '经验教训检查' },
      { index: '/newproduct/trial', title: '试产管理' },
      { index: '/newproduct/trial-issues', title: '试产问题' },
      { index: '/newproduct/trial-summary', title: '试产总结' },
    ],
  },
  {
    index: 'audit',
    title: '审核管理',
    icon: Document,
    children: [
      { index: '/audit/plans', title: '审核计划' },
      { index: '/audit/templates', title: '审核模板' },
      { index: '/audit/execution', title: '审核执行' },
      { index: '/audit/nc-list', title: '不符合项' },
      { index: '/audit/report', title: '审核报告' },
      { index: '/audit/customer', title: '客户审核' },
    ],
  },
  {
    index: 'admin',
    title: '系统管理',
    icon: Setting,
    children: [
      { index: '/admin/users', title: '用户管理' },
      { index: '/admin/suppliers', title: '供应商基础信息' },
      { index: '/admin/customers', title: '客户基础信息' },
      { index: '/admin/permissions', title: '权限矩阵' },
      { index: '/admin/tasks', title: '任务监控' },
      { index: '/admin/operation-logs', title: '操作日志' },
      { index: '/admin/feature-flags', title: '功能开关' },
    ],
  },
]

export const RESERVED_NAV_ITEMS: NavigationItem[] = [
  {
    index: '/instruments',
    title: '仪器量具管理',
    icon: Tools,
  },
  {
    index: '/quality-costs',
    title: '质量成本管理',
    icon: Money,
  },
]
