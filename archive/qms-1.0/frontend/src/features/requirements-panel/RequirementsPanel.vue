<template>
  <div class="page">
    <div class="shell">
      <section v-if="!isAuthenticated" class="card login-layout">
        <div class="intro">
          <span class="eyebrow">需求面板</span>
          <h1>{{ catalog.metadata.title }}</h1>
          <p>统一查看 QMS 功能需求、开发状态与验证进度，管理员可直接在线维护状态。</p>
          <div class="meta-row">
            <span class="pill">访问路径 /requirements-panel</span>
            <span class="pill">独立账号体系</span>
            <span class="pill">状态实时同步</span>
          </div>
        </div>

        <form class="card login-card" @submit.prevent="handleLogin">
          <h2>登录需求面板</h2>
          <label class="field">
            <span>账号</span>
            <input v-model.trim="loginForm.username" type="text" autocomplete="username" />
          </label>
          <label class="field">
            <span>密码</span>
            <input v-model="loginForm.password" type="password" autocomplete="current-password" />
          </label>
          <div class="actions">
            <button class="primary" type="submit" :disabled="loginLoading">
              {{ loginLoading ? '登录中...' : '进入面板' }}
            </button>
            <button class="ghost" type="button" @click="goToQmsLogin">返回 QMS</button>
          </div>
        </form>
      </section>

      <template v-else>
        <section class="card hero">
          <div class="hero-head">
            <div class="hero-copy">
              <span class="eyebrow">需求总览</span>
              <h1>{{ catalog.metadata.title }}</h1>
              <p>统一查看模块进度、优先级与验证状态，支持管理员在线更新需求条目。</p>
            </div>

            <div class="hero-actions">
              <button class="ghost" type="button" @click="refreshStatuses" :disabled="loading">
                {{ loading ? '同步中...' : '刷新状态' }}
              </button>
              <button class="ghost" type="button" @click="exportSnapshot">导出快照</button>
              <button class="ghost" type="button" @click="goToQmsLogin">返回 QMS</button>
              <button class="ghost danger" type="button" @click="logoutFromPanel">退出账号</button>
            </div>
          </div>

          <div class="hero-foot">
            <div class="meta-row">
              <span class="pill">当前账号 {{ panelUser?.full_name }}</span>
              <span class="pill">{{ canUpdate ? '管理员' : '查阅账号' }}</span>
              <span class="pill">版本 {{ catalog.metadata.version }}</span>
            </div>

            <div class="overview-strip">
              <article v-for="metric in headlineMetrics" :key="metric.label" class="metric-card">
                <span>{{ metric.label }}</span>
                <strong>{{ metric.value }}</strong>
                <small>{{ metric.note }}</small>
              </article>
            </div>
          </div>
        </section>

        <section class="card workspace-card">
          <div class="workspace-top">
            <div>
              <h2>需求工作区</h2>
              <p>按条件筛选后，可在总览和明细之间快速切换。</p>
            </div>

            <div class="workspace-tools">
              <span class="count-badge">{{ filteredItems.length }} / {{ allItems.length }} 条需求</span>
              <div class="view-switch" role="tablist" aria-label="需求面板视图切换">
                <button
                  class="view-tab"
                  :class="{ active: activeView === 'overview' }"
                  type="button"
                  @click="activeView = 'overview'"
                >
                  总览
                </button>
                <button
                  class="view-tab"
                  :class="{ active: activeView === 'roadmap' }"
                  type="button"
                  @click="activeView = 'roadmap'"
                >
                  开发顺序
                </button>
                <button
                  class="view-tab"
                  :class="{ active: activeView === 'details' }"
                  type="button"
                  @click="activeView = 'details'"
                >
                  明细
                </button>
              </div>
            </div>
          </div>

          <div class="filters">
            <label class="field field-search">
              <span>关键词</span>
              <input v-model.trim="filters.keyword" type="search" placeholder="搜索模块、功能、验收标准" />
            </label>
            <label class="field">
              <span>优先级</span>
              <select v-model="filters.priority">
                <option value="">全部</option>
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低 / 预留</option>
              </select>
            </label>
            <label class="field">
              <span>需求范围</span>
              <select v-model="filters.scope">
                <option value="">全部</option>
                <option value="核心需求">核心需求</option>
                <option value="期望增强">期望增强</option>
                <option value="预留功能">预留功能</option>
              </select>
            </label>
            <label class="field">
              <span>开发状态</span>
              <select v-model="filters.status">
                <option value="">全部</option>
                <option v-for="legend in catalog.metadata.statusLegend" :key="legend.key" :value="legend.key">
                  {{ legend.label }}
                </option>
              </select>
            </label>
            <label class="field">
              <span>功能模块</span>
              <select v-model="filters.moduleId">
                <option value="">全部</option>
                <option v-for="module in catalog.modules" :key="module.id" :value="module.id">
                  {{ module.name }}
                </option>
              </select>
            </label>
          </div>

          <div class="toolbar">
            <div class="toolbar-group">
              <button class="ghost" type="button" @click="resetFilters">重置筛选</button>
              <span v-if="hasActiveFilters" class="pill subtle-pill">{{ activeFiltersCount }} 个筛选条件</span>
            </div>

            <div class="toolbar-group legend-group">
              <span v-for="legend in catalog.metadata.statusLegend" :key="legend.key" class="legend-pill">
                <span class="legend-dot" :class="`status-${legend.key}`"></span>
                {{ legend.label }}
              </span>
            </div>
          </div>

          <template v-if="activeView === 'overview'">
            <div class="workspace-grid">
              <section class="content-card">
                <div class="board-head">
                  <div>
                    <h3>模块进度</h3>
                    <p>按模块查看当前完成率与待推进事项。</p>
                  </div>
                  <span class="pill">{{ moduleSummaries.length }} 个模块</span>
                </div>

                <div v-if="moduleSummaries.length > 0" class="module-list">
                  <article v-for="module in moduleSummaries" :key="module.id" class="module-row">
                    <div class="module-header">
                      <div class="stack">
                        <div class="title-row">
                          <h3>{{ module.name }}</h3>
                          <span class="priority" :class="`priority-${module.overallPriority}`">
                            {{ priorityText[module.overallPriority] }}
                          </span>
                        </div>
                        <p>{{ module.summary }}</p>
                      </div>

                      <div class="module-progress">
                        <strong>{{ module.stats.progress }}%</strong>
                        <span>{{ module.stats.verified }}/{{ module.items.length }} 已验证</span>
                      </div>
                    </div>

                    <div class="track">
                      <div class="bar" :style="{ width: `${module.stats.progress}%` }"></div>
                    </div>

                    <div class="module-bottom">
                      <div class="mini-stats">
                        <span>开发中 {{ module.stats.doing }}</span>
                        <span>待验证 {{ module.stats.devDone }}</span>
                        <span>待开发 {{ module.stats.todo }}</span>
                      </div>

                      <div v-if="module.focusItems.length > 0" class="focus-badges">
                        <div v-for="item in module.focusItems" :key="item.id" class="focus-chip">
                          <strong>{{ item.title }}</strong>
                          <span>{{ statusText[item.status] }}</span>
                        </div>
                      </div>
                    </div>
                  </article>
                </div>

                <p v-else class="empty-copy board-empty">当前筛选条件下没有匹配的模块。</p>
              </section>

              <aside class="sidebar">
                <article class="content-card">
                  <div class="board-head">
                    <div>
                      <h3>优先级分布</h3>
                      <p>按优先级查看需求规模与未完成数量。</p>
                    </div>
                  </div>

                  <div class="priority-summary">
                    <div v-for="lane in prioritySummary" :key="lane.key" class="priority-block">
                      <div class="priority-line">
                        <span class="priority" :class="`priority-${lane.key}`">{{ lane.title }}</span>
                        <strong>{{ lane.items.length }}</strong>
                      </div>
                      <small>未完成 {{ lane.pendingCount }} 项</small>
                    </div>
                  </div>
                </article>

                <article class="content-card">
                  <div class="board-head">
                    <div>
                      <h3>状态统计</h3>
                      <p>查看当前筛选结果的状态分布。</p>
                    </div>
                  </div>

                  <div class="status-summary">
                    <div v-for="status in statusSummary" :key="status.key" class="status-count">
                      <span class="legend-dot" :class="`status-${status.key}`"></span>
                      <div class="stack">
                        <strong>{{ status.count }}</strong>
                        <span>{{ status.label }}</span>
                      </div>
                    </div>
                  </div>
                </article>

                <article class="content-card">
                  <div class="board-head">
                    <div>
                      <h3>重点跟进</h3>
                      <p>优先展示仍需推进的需求条目。</p>
                    </div>
                  </div>

                  <div v-if="attentionItems.length > 0" class="panel-list">
                    <article v-for="item in attentionItems" :key="item.id" class="panel-item">
                      <div class="stack">
                        <strong>{{ item.title }}</strong>
                        <span>{{ item.moduleName }} · {{ item.phase }}</span>
                      </div>
                      <span class="priority" :class="`priority-${item.priority}`">{{ priorityText[item.priority] }}</span>
                    </article>
                  </div>
                  <p v-else class="empty-copy">当前没有需要额外跟进的条目。</p>
                </article>
              </aside>
            </div>
          </template>

          <section v-else-if="activeView === 'roadmap'" class="roadmap-board">
            <div v-if="currentPlanStage" class="roadmap-highlight">
              <div class="stack">
                <span class="eyebrow roadmap-eyebrow">当前建议批次</span>
                <h3>{{ currentPlanStage.order }}. {{ currentPlanStage.title }}</h3>
                <p>{{ currentPlanStage.description }}</p>
              </div>
              <div class="roadmap-highlight-meta">
                <span class="pill">{{ currentPlanStage.stats.pendingCount }} 项待推进</span>
                <span class="pill subtle-pill">{{ currentPlanStage.stats.verified }} 项已验证</span>
              </div>
            </div>

            <div class="roadmap-list">
              <article v-for="stage in deliveryPlanSections" :key="stage.key" class="content-card roadmap-stage">
                <div class="roadmap-stage-top">
                  <div class="roadmap-stage-order">{{ stage.order }}</div>
                  <div class="stack">
                    <h3>{{ stage.title }}</h3>
                    <p>{{ stage.description }}</p>
                  </div>
                  <div class="roadmap-stage-meta">
                    <span class="pill">{{ stage.items.length }} 项</span>
                    <span class="pill subtle-pill">{{ stage.stats.pendingCount }} 项待推进</span>
                  </div>
                </div>

                <div class="roadmap-track">
                  <div class="roadmap-bar" :style="{ width: `${stage.stats.progress}%` }"></div>
                </div>

                <div class="roadmap-stage-foot">
                  <div class="toolbar-group">
                    <span v-for="moduleName in stage.moduleNames" :key="moduleName" class="module-tag">{{ moduleName }}</span>
                  </div>
                  <div class="mini-stats">
                    <span>待开发 {{ stage.stats.todo }}</span>
                    <span>开发中 {{ stage.stats.doing }}</span>
                    <span>待验证 {{ stage.stats.devDone }}</span>
                    <span>已验证 {{ stage.stats.verified }}</span>
                  </div>
                </div>

                <div v-if="stage.items.length > 0" class="roadmap-item-list">
                  <article v-for="item in stage.items" :key="item.id" class="roadmap-item">
                    <div class="roadmap-item-main">
                      <div class="stack">
                        <strong>{{ item.title }}</strong>
                        <span>{{ item.moduleName }} · {{ item.phase }} · {{ item.scope }}</span>
                      </div>
                      <div class="toolbar-group">
                        <span class="priority" :class="`priority-${item.priority}`">{{ priorityText[item.priority] }}</span>
                      </div>
                    </div>

                    <div class="roadmap-item-side">
                      <select
                        v-if="canUpdate"
                        :value="item.status"
                        :disabled="savingItemId === item.id"
                        @change="handleStatusChange(item.id, ($event.target as HTMLSelectElement).value)"
                      >
                        <option v-for="legend in catalog.metadata.statusLegend" :key="legend.key" :value="legend.key">
                          {{ legend.label }}
                        </option>
                      </select>
                      <span v-else class="status-pill" :class="`status-pill-${item.status}`">{{ statusText[item.status] }}</span>
                      <small v-if="item.updatedByName" class="updated-by">最近更新 {{ item.updatedByName }}</small>
                    </div>
                  </article>
                </div>

                <p v-else class="empty-copy board-empty">当前筛选条件下此批次暂无需求项。</p>
              </article>
            </div>
          </section>

          <section v-else class="detail-board">
            <div class="detail-toolbar">
              <span class="pill">共 {{ filteredItems.length }} 条需求</span>
              <span class="pill subtle-pill">开发状态请在“开发顺序”视图统一维护</span>
            </div>

            <div class="table-shell">
              <table class="table">
                <thead>
                  <tr>
                    <th>功能模块</th>
                    <th>功能条目</th>
                    <th>优先级</th>
                    <th>范围</th>
                    <th>阶段</th>
                    <th>开发状态</th>
                    <th>验收标准</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="filteredItems.length === 0">
                    <td colspan="7" class="table-empty-cell">
                      <p class="empty-copy">当前筛选条件下没有匹配的需求项。</p>
                    </td>
                  </tr>
                  <tr v-for="item in filteredItems" :key="item.id">
                    <td>
                      <div class="stack">
                        <strong>{{ item.moduleName }}</strong>
                        <span>{{ item.moduleSummary }}</span>
                      </div>
                    </td>
                    <td>
                      <div class="stack">
                        <strong>{{ item.title }}</strong>
                        <span>ID: {{ item.id }}</span>
                      </div>
                    </td>
                    <td>
                      <span class="priority" :class="`priority-${item.priority}`">{{ priorityText[item.priority] }}</span>
                    </td>
                    <td>{{ item.scope }}</td>
                    <td>{{ item.phase }}</td>
                    <td class="status-cell">
                      <span class="status-pill" :class="`status-pill-${item.status}`">{{ statusText[item.status] }}</span>
                      <small v-if="item.updatedByName" class="updated-by">最近更新 {{ item.updatedByName }}</small>
                    </td>
                    <td>{{ item.acceptance }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import { requirementsPanelApi } from './api'
import { requirementsPanelCatalog as catalog } from './catalog'
import type {
  RequirementCatalogItem,
  RequirementPanelUser,
  RequirementPriority,
  RequirementStatus,
  RequirementStatusOverride
} from './types'
import {
  REQUIREMENTS_PANEL_AUTH_EXPIRED_EVENT,
  REQUIREMENTS_PANEL_TOKEN_KEY,
  clearRequirementsPanelSession,
  getStoredRequirementsPanelUser,
  saveRequirementsPanelSession
} from './request'

interface DisplayRequirementItem extends RequirementCatalogItem {
  moduleId: string
  moduleName: string
  moduleSummary: string
  updatedByName?: string | null
  updatedAt?: string | null
}

type WorkspaceView = 'overview' | 'roadmap' | 'details'

interface DeliveryPlanStage {
  key: string
  order: string
  title: string
  description: string
  moduleIds?: string[]
  onlyCore?: boolean
  includeNonCore?: boolean
}

const priorityRank: Record<RequirementPriority, number> = {
  high: 0,
  medium: 1,
  low: 2
}

const deliveryPlanBlueprint: DeliveryPlanStage[] = [
  {
    key: 'platform-foundation',
    order: '01',
    title: '平台底座与统一入口',
    description: '先打通账号、权限、工作台和基础留痕，确保后续各业务模块有统一入口和权限边界。',
    moduleIds: ['foundation'],
    onlyCore: true
  },
  {
    key: 'supplier-collaboration',
    order: '02',
    title: '来料与供应商协同主线',
    description: '优先落地来料检验、供应商闭环和绩效链路，先把外部协同主线跑通。',
    moduleIds: ['incoming-quality'],
    onlyCore: true
  },
  {
    key: 'execution-loop',
    order: '03',
    title: '制程与客户闭环',
    description: '在供应协同稳定后推进制程问题闭环和客户质量主线，形成端到端异常闭环。',
    moduleIds: ['process-quality', 'customer-quality'],
    onlyCore: true
  },
  {
    key: 'governance-rollout',
    order: '04',
    title: '经营分析与治理扩展',
    description: '补齐管理看板、新品质量和审核治理，支撑管理汇报和跨阶段管控。',
    moduleIds: ['dashboard', 'npd-quality', 'audit'],
    onlyCore: true
  },
  {
    key: 'enhancement-backlog',
    order: '05',
    title: '增强项与预留规划',
    description: '将移动端、AI、增强能力和预留模块放在基础主线稳定后逐步推进。',
    includeNonCore: true
  }
]

const statusRank: Record<RequirementStatus, number> = {
  doing: 0,
  'dev-done': 1,
  todo: 2,
  reserved: 3,
  verified: 4
}

const router = useRouter()

const panelUser = ref<RequirementPanelUser | null>(null)
const activeView = ref<WorkspaceView>('overview')
const loginLoading = ref(false)
const loading = ref(false)
const savingItemId = ref<string | null>(null)
const canUpdate = ref(false)
const overrides = ref<Record<string, RequirementStatusOverride>>({})

const loginForm = reactive({
  username: '',
  password: ''
})

const filters = reactive({
  keyword: '',
  priority: '',
  scope: '',
  status: '',
  moduleId: ''
})

const isAuthenticated = computed(() => !!panelUser.value)

const statusText: Record<RequirementStatus, string> = {
  todo: '待开发',
  doing: '开发中',
  'dev-done': '已开发待验证',
  verified: '已验证完成',
  reserved: '预留'
}

const priorityText: Record<RequirementPriority, string> = {
  high: '高',
  medium: '中',
  low: '低 / 预留'
}

function compareItems(a: DisplayRequirementItem, b: DisplayRequirementItem) {
  const priorityDelta = priorityRank[a.priority] - priorityRank[b.priority]
  if (priorityDelta !== 0) return priorityDelta

  const statusDelta = statusRank[a.status] - statusRank[b.status]
  if (statusDelta !== 0) return statusDelta

  const moduleDelta = a.moduleName.localeCompare(b.moduleName, 'zh-Hans-CN')
  if (moduleDelta !== 0) return moduleDelta

  return a.title.localeCompare(b.title, 'zh-Hans-CN')
}

const mergedModules = computed(() =>
  catalog.modules.map((module) => ({
    ...module,
    items: module.items.map((item) => {
      const override = overrides.value[item.id]
      return {
        ...item,
        status: override?.status ?? item.status,
        updatedByName: override?.updated_by_name ?? null,
        updatedAt: override?.updated_at ?? null
      }
    })
  }))
)

const allItems = computed<DisplayRequirementItem[]>(() =>
  mergedModules.value.flatMap((module) =>
    module.items.map((item) => ({
      ...item,
      moduleId: module.id,
      moduleName: module.name,
      moduleSummary: module.summary
    }))
  )
)

const filteredItems = computed(() => {
  const keyword = filters.keyword.trim().toLowerCase()

  return allItems.value.filter((item) => {
    const matchesKeyword =
      !keyword ||
      item.moduleName.toLowerCase().includes(keyword) ||
      item.title.toLowerCase().includes(keyword) ||
      item.acceptance.toLowerCase().includes(keyword)

    const matchesPriority = !filters.priority || item.priority === filters.priority
    const matchesScope = !filters.scope || item.scope === filters.scope
    const matchesStatus = !filters.status || item.status === filters.status
    const matchesModule = !filters.moduleId || item.moduleId === filters.moduleId

    return matchesKeyword && matchesPriority && matchesScope && matchesStatus && matchesModule
  })
})

const filteredModules = computed(() =>
  mergedModules.value
    .map((module) => {
      const items = filteredItems.value
        .filter((item) => item.moduleId === module.id)
        .sort(compareItems)
      const verified = items.filter((item) => item.status === 'verified').length
      const doing = items.filter((item) => item.status === 'doing').length
      const devDone = items.filter((item) => item.status === 'dev-done').length
      const todo = items.filter((item) => item.status === 'todo').length

      return {
        ...module,
        items,
        stats: {
          verified,
          doing,
          devDone,
          todo,
          progress: items.length === 0 ? 0 : Math.round((verified / items.length) * 100)
        }
      }
    })
    .filter((module) => module.items.length > 0)
)

const moduleSummaries = computed(() =>
  [...filteredModules.value]
    .map((module) => ({
      ...module,
      focusItems: module.items
        .filter((item) => item.status !== 'verified' && item.status !== 'reserved')
        .slice(0, 3)
    }))
    .sort((a, b) => {
      const priorityDelta = priorityRank[a.overallPriority] - priorityRank[b.overallPriority]
      if (priorityDelta !== 0) return priorityDelta
      return a.stats.progress - b.stats.progress
    })
)

const priorityLanes = computed(() => [
  {
    key: 'high',
    title: '高优先级',
    description: '直接决定项目主线交付节奏和汇报关注点。',
    items: filteredItems.value.filter((item) => item.priority === 'high')
  },
  {
    key: 'medium',
    title: '中优先级',
    description: '支撑主线闭环和分析能力的关键补位。',
    items: filteredItems.value.filter((item) => item.priority === 'medium')
  },
  {
    key: 'low',
    title: '低优先级 / 预留',
    description: '面向后续迭代、扩展治理和长期建设。',
    items: filteredItems.value.filter((item) => item.priority === 'low')
  }
])

const prioritySummary = computed(() =>
  priorityLanes.value.map((lane) => ({
    ...lane,
    pendingCount: lane.items.filter((item) => item.status !== 'verified' && item.status !== 'reserved').length
  }))
)

const verifiedCount = computed(() => allItems.value.filter((item) => item.status === 'verified').length)
const inProgressCount = computed(() =>
  allItems.value.filter((item) => item.status === 'doing' || item.status === 'dev-done').length
)
const highPriorityCount = computed(() => allItems.value.filter((item) => item.priority === 'high').length)

const headlineMetrics = computed(() => [
  {
    label: '功能模块',
    value: catalog.modules.length,
    note: '已纳入统计'
  },
  {
    label: '需求条目',
    value: allItems.value.length,
    note: '当前目录总数'
  },
  {
    label: '已验证完成',
    value: verifiedCount.value,
    note: '已完成验证'
  },
  {
    label: '推进中',
    value: inProgressCount.value,
    note: `高优先级 ${highPriorityCount.value} 条`
  }
])

const statusSummary = computed(() =>
  catalog.metadata.statusLegend.map((legend) => ({
    ...legend,
    count: filteredItems.value.filter((item) => item.status === legend.key).length
  }))
)

const attentionItems = computed(() =>
  [...filteredItems.value]
    .filter((item) => item.status !== 'verified' && item.status !== 'reserved')
    .sort(compareItems)
    .slice(0, 6)
)

const activeFiltersCount = computed(
  () => [filters.keyword, filters.priority, filters.scope, filters.status, filters.moduleId].filter(Boolean).length
)

const hasActiveFilters = computed(() => activeFiltersCount.value > 0)

const deliveryPlanSections = computed(() =>
  deliveryPlanBlueprint.map((stage) => {
    const items = filteredItems.value
      .filter((item) => {
        if (stage.includeNonCore) {
          return item.scope !== '核心需求' || item.moduleId === 'reserved'
        }

        const moduleMatch = stage.moduleIds?.includes(item.moduleId) ?? false
        if (!moduleMatch) return false
        if (stage.onlyCore) return item.scope === '核心需求'
        return true
      })
      .sort(compareItems)

    const todo = items.filter((item) => item.status === 'todo').length
    const doing = items.filter((item) => item.status === 'doing').length
    const devDone = items.filter((item) => item.status === 'dev-done').length
    const verified = items.filter((item) => item.status === 'verified').length
    const pendingCount = items.filter((item) => item.status !== 'verified' && item.status !== 'reserved').length
    const moduleNames = [...new Set(items.map((item) => item.moduleName))]

    return {
      ...stage,
      items,
      moduleNames,
      stats: {
        todo,
        doing,
        devDone,
        verified,
        pendingCount,
        progress: items.length === 0 ? 0 : Math.round((verified / items.length) * 100)
      }
    }
  })
)

const currentPlanStage = computed(() => deliveryPlanSections.value.find((stage) => stage.stats.pendingCount > 0) ?? null)

async function refreshStatuses() {
  if (!panelUser.value) return

  loading.value = true
  try {
    const response = await requirementsPanelApi.getStatuses()
    canUpdate.value = response.can_update
    overrides.value = response.items.reduce<Record<string, RequirementStatusOverride>>((acc, item) => {
      acc[item.item_id] = item
      return acc
    }, {})
  } finally {
    loading.value = false
  }
}

async function restoreSession() {
  const storedUser = getStoredRequirementsPanelUser()
  if (storedUser) {
    panelUser.value = storedUser
    canUpdate.value = storedUser.role === 'admin'
  }

  const token = localStorage.getItem(REQUIREMENTS_PANEL_TOKEN_KEY)
  if (!token) return

  try {
    const user = await requirementsPanelApi.getCurrentUser()
    panelUser.value = user
    canUpdate.value = user.role === 'admin'
    saveRequirementsPanelSession(token, user)
    await refreshStatuses()
  } catch {
    handleLogout(false)
  }
}

async function handleLogin() {
  if (!loginForm.username || !loginForm.password) {
    ElMessage.warning('请先输入账号和密码')
    return
  }

  loginLoading.value = true
  try {
    const response = await requirementsPanelApi.login({
      username: loginForm.username,
      password: loginForm.password
    })
    saveRequirementsPanelSession(response.access_token, response.user)
    panelUser.value = response.user
    canUpdate.value = response.user.role === 'admin'
    loginForm.password = ''
    await refreshStatuses()
    ElMessage.success('需求面板登录成功')
  } finally {
    loginLoading.value = false
  }
}

async function handleStatusChange(itemId: string, nextStatus: string) {
  const status = nextStatus as RequirementStatus
  const current = overrides.value[itemId]?.status ?? allItems.value.find((item) => item.id === itemId)?.status
  if (!status || current === status) return

  savingItemId.value = itemId
  try {
    const updated = await requirementsPanelApi.updateStatus(itemId, { status })
    overrides.value = {
      ...overrides.value,
      [itemId]: updated
    }
    ElMessage.success('需求状态已更新')
  } finally {
    savingItemId.value = null
  }
}

function resetFilters() {
  filters.keyword = ''
  filters.priority = ''
  filters.scope = ''
  filters.status = ''
  filters.moduleId = ''
}

function exportSnapshot() {
  const snapshot = {
    exported_at: new Date().toISOString(),
    current_user: panelUser.value,
    items: allItems.value.map((item) => ({
      id: item.id,
      module: item.moduleName,
      title: item.title,
      priority: item.priority,
      scope: item.scope,
      phase: item.phase,
      status: item.status,
      updated_by_name: item.updatedByName ?? null,
      updated_at: item.updatedAt ?? null
    }))
  }

  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `qms-requirements-snapshot-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  window.URL.revokeObjectURL(url)
}

function goToQmsLogin() {
  router.push('/login')
}

function handleLogout(showMessage = true) {
  clearRequirementsPanelSession()
  panelUser.value = null
  canUpdate.value = false
  overrides.value = {}
  activeView.value = 'overview'
  loginForm.password = ''
  if (showMessage) {
    ElMessage.success('已退出需求面板账号')
  }
}

function logoutFromPanel() {
  handleLogout(true)
}

function handleAuthExpired() {
  handleLogout(false)
}

onMounted(() => {
  restoreSession()
  window.addEventListener(REQUIREMENTS_PANEL_AUTH_EXPIRED_EVENT, handleAuthExpired)
})

onBeforeUnmount(() => {
  window.removeEventListener(REQUIREMENTS_PANEL_AUTH_EXPIRED_EVENT, handleAuthExpired)
})
</script>

<style scoped>
.page {
  --bg: #f3f6fb;
  --bg-soft: #eef3f9;
  --surface: rgba(255, 255, 255, 0.96);
  --surface-alt: #f8fbff;
  --line: #d9e1ec;
  --line-strong: #cbd6e4;
  --text: #172033;
  --muted: #60708b;
  --accent: #2257d7;
  --accent-soft: rgba(34, 87, 215, 0.08);
  min-height: 100vh;
  padding: 24px 16px 48px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.65), rgba(255, 255, 255, 0)) 0 0 / 100% 220px no-repeat,
    linear-gradient(180deg, var(--bg) 0%, var(--bg-soft) 100%);
  font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
}

.shell {
  width: min(1360px, 100%);
  margin: 0 auto;
}

.card,
.content-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 24px;
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.06);
}

.login-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.75fr);
  gap: 24px;
  padding: 28px;
}

.intro {
  max-width: 760px;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  padding: 7px 12px;
  border-radius: 999px;
  background: #edf3ff;
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

h1,
h2,
h3,
p {
  margin: 0;
}

h1 {
  margin-top: 16px;
  font-size: clamp(30px, 4vw, 42px);
  line-height: 1.1;
  color: var(--text);
}

h2 {
  font-size: 24px;
  line-height: 1.2;
  color: var(--text);
}

h3 {
  font-size: 22px;
  line-height: 1.3;
  color: var(--text);
}

p {
  color: var(--muted);
  line-height: 1.75;
}

.meta-row,
.hero-actions,
.toolbar,
.toolbar-group,
.workspace-tools,
.detail-toolbar,
.mini-stats,
.focus-badges,
.panel-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.meta-row {
  margin-top: 18px;
}

.pill,
.count-badge,
.legend-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 13px;
  line-height: 1;
}

.pill,
.count-badge {
  border: 1px solid var(--line);
  background: #fff;
  color: var(--muted);
}

.subtle-pill {
  background: #f0f4fb;
}

.legend-pill {
  border: 1px solid var(--line);
  background: var(--surface-alt);
  color: var(--muted);
}

.login-card {
  width: min(400px, 100%);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field span {
  font-size: 13px;
  font-weight: 700;
  color: #51627f;
}

input,
select,
.ghost,
.primary,
.view-tab {
  border-radius: 14px;
  font-size: 14px;
}

input,
select {
  width: 100%;
  box-sizing: border-box;
  padding: 12px 14px;
  border: 1px solid var(--line-strong);
  background: #fff;
  color: var(--text);
}

input::placeholder {
  color: #8b98ad;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.primary,
.ghost,
.view-tab {
  padding: 12px 16px;
  font-weight: 700;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.primary {
  border: 1px solid transparent;
  background: linear-gradient(135deg, #2257d7, #1947b8);
  color: #fff;
}

.ghost,
.view-tab {
  border: 1px solid var(--line);
  background: #fff;
  color: var(--text);
}

.primary:hover,
.ghost:hover,
.view-tab:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.08);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.7;
  transform: none;
  box-shadow: none;
}

.danger {
  color: #be123c;
}

.hero {
  padding: 28px;
}

.hero-head {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: flex-start;
}

.hero-copy {
  max-width: 780px;
}

.hero-copy p {
  margin-top: 14px;
  max-width: 620px;
}

.hero-actions {
  justify-content: flex-end;
  width: min(440px, 100%);
}

.hero-foot {
  margin-top: 24px;
  padding-top: 22px;
  border-top: 1px solid var(--line);
}

.overview-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-top: 20px;
}

.metric-card {
  padding: 18px;
  border-radius: 20px;
  background: var(--surface-alt);
  border: 1px solid rgba(201, 213, 230, 0.72);
}

.metric-card span,
.metric-card small {
  color: var(--muted);
}

.metric-card strong {
  display: block;
  margin: 8px 0 6px;
  font-size: 30px;
  color: var(--text);
}

.workspace-card {
  margin-top: 20px;
  padding: 24px;
}

.workspace-top,
.module-header,
.module-bottom,
.priority-line,
.panel-item,
.board-head,
.title-row {
  display: flex;
  justify-content: space-between;
  gap: 14px;
}

.workspace-top {
  align-items: flex-start;
}

.workspace-top p {
  margin-top: 8px;
}

.workspace-tools {
  justify-content: flex-end;
  align-items: center;
}

.view-switch {
  display: inline-flex;
  padding: 5px;
  border-radius: 16px;
  background: #edf2fa;
}

.view-tab {
  min-width: 88px;
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}

.view-tab.active {
  background: #fff;
  color: var(--accent);
  border-color: rgba(34, 87, 215, 0.12);
}

.filters {
  display: grid;
  grid-template-columns: 1.55fr repeat(4, minmax(140px, 1fr));
  gap: 14px;
  margin-top: 22px;
}

.field-search {
  min-width: 0;
}

.toolbar {
  margin-top: 18px;
  justify-content: space-between;
  align-items: center;
}

.legend-group {
  justify-content: flex-end;
}

.workspace-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(300px, 0.9fr);
  gap: 20px;
  margin-top: 22px;
}

.content-card,
.detail-board,
.roadmap-board {
  padding: 22px;
}

.board-head {
  align-items: flex-start;
}

.board-head p {
  margin-top: 8px;
}

.module-list,
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.module-list {
  margin-top: 18px;
}

.module-row {
  padding: 18px 18px 16px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: linear-gradient(180deg, #fbfdff 0%, #f5f8fc 100%);
}

.title-row {
  justify-content: flex-start;
  align-items: center;
  flex-wrap: wrap;
}

.module-progress {
  min-width: 110px;
  text-align: right;
}

.module-progress strong {
  display: block;
  font-size: 32px;
  line-height: 1;
  color: var(--text);
}

.module-progress span {
  display: block;
  margin-top: 8px;
  color: var(--muted);
  font-size: 13px;
}

.track {
  width: 100%;
  height: 10px;
  margin-top: 16px;
  border-radius: 999px;
  background: #e4ebf5;
  overflow: hidden;
}

.bar {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #2257d7 0%, #2f8f6a 100%);
}

.module-bottom {
  align-items: flex-start;
  margin-top: 14px;
}

.mini-stats {
  color: var(--muted);
  font-size: 13px;
}

.focus-chip,
.priority-block,
.status-count,
.panel-item {
  border: 1px solid var(--line);
  background: #fff;
}

.focus-chip {
  min-width: 132px;
  padding: 10px 12px;
  border-radius: 16px;
}

.focus-chip strong,
.stack strong {
  color: var(--text);
}

.focus-chip span,
.stack span,
.empty-copy,
.updated-by {
  color: var(--muted);
}

.priority-summary,
.status-summary {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.priority-block {
  padding: 14px;
  border-radius: 18px;
}

.priority-line strong {
  font-size: 26px;
  color: var(--text);
}

.priority-block small {
  margin-top: 10px;
  display: block;
  color: var(--muted);
}

.status-count {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border-radius: 18px;
}

.panel-list {
  flex-direction: column;
  margin-top: 16px;
}

.panel-item {
  align-items: center;
  padding: 13px 14px;
  border-radius: 18px;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.roadmap-board {
  margin-top: 22px;
  padding: 0;
  background: transparent;
  border: none;
  box-shadow: none;
}

.roadmap-highlight {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  padding: 22px;
  border: 1px solid #d6e1ef;
  border-radius: 22px;
  background: linear-gradient(135deg, #f8fbff 0%, #eef4ff 100%);
}

.roadmap-eyebrow {
  margin-bottom: 10px;
}

.roadmap-highlight-meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.roadmap-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 18px;
}

.roadmap-stage {
  padding: 20px;
}

.roadmap-stage-top {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) auto;
  gap: 16px;
  align-items: flex-start;
}

.roadmap-stage-order {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 18px;
  background: #edf3ff;
  color: var(--accent);
  font-size: 20px;
  font-weight: 800;
}

.roadmap-stage-meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.roadmap-track {
  width: 100%;
  height: 10px;
  margin-top: 18px;
  border-radius: 999px;
  background: #e4ebf5;
  overflow: hidden;
}

.roadmap-bar {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #2257d7 0%, #2f8f6a 100%);
}

.roadmap-stage-foot {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
  margin-top: 14px;
}

.module-tag {
  display: inline-flex;
  align-items: center;
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: #f8fbff;
  color: #51627f;
  font-size: 13px;
}

.roadmap-item-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 18px;
}

.roadmap-item {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: #fff;
}

.roadmap-item-main,
.roadmap-item-side {
  display: flex;
  align-items: center;
  gap: 14px;
}

.roadmap-item-main {
  justify-content: space-between;
  flex: 1 1 auto;
}

.roadmap-item-side {
  flex: 0 0 auto;
}

.priority,
.status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.priority-high {
  background: #ffe2e8;
  color: #e11d48;
}

.priority-medium {
  background: #ffeedf;
  color: #ea580c;
}

.priority-low {
  background: #dbeafe;
  color: #2563eb;
}

.status-todo,
.status-pill-todo {
  background: #f1f5f9;
  color: #475569;
}

.status-doing,
.status-pill-doing {
  background: #dbeafe;
  color: #1d4ed8;
}

.status-dev-done,
.status-pill-dev-done {
  background: #ede9fe;
  color: #6d28d9;
}

.status-verified,
.status-pill-verified {
  background: #dcfce7;
  color: #15803d;
}

.status-reserved,
.status-pill-reserved {
  background: #e2e8f0;
  color: #475569;
}

.detail-toolbar {
  margin-bottom: 16px;
}

.table-shell {
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 20px;
}

.table {
  width: 100%;
  min-width: 1180px;
  border-collapse: collapse;
  background: #fff;
}

.table th,
.table td {
  padding: 16px 18px;
  border-bottom: 1px solid #e2e8f1;
  text-align: left;
  vertical-align: top;
}

.table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #f5f8fd;
  color: #334155;
  font-size: 13px;
}

.table-empty-cell {
  padding: 36px 18px;
  text-align: center;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.status-cell {
  min-width: 180px;
}

.updated-by {
  display: block;
  margin-top: 8px;
  font-size: 12px;
}

.board-empty {
  padding: 28px 0 6px;
}

@media (max-width: 1180px) {
  .overview-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .workspace-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 1024px) {
  .login-layout {
    grid-template-columns: 1fr;
  }

  .hero-head,
  .workspace-top,
  .roadmap-highlight,
  .roadmap-stage-foot,
  .roadmap-item {
    flex-direction: column;
  }

  .login-card {
    width: 100%;
  }

  .hero-actions,
  .workspace-tools {
    width: 100%;
    justify-content: flex-start;
  }

  .roadmap-stage-top {
    grid-template-columns: 56px minmax(0, 1fr);
  }

  .roadmap-stage-meta,
  .roadmap-item-main,
  .roadmap-item-side {
    justify-content: flex-start;
  }

  .filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .field-search {
    grid-column: 1 / -1;
  }

  .module-bottom {
    flex-direction: column;
  }
}

@media (max-width: 768px) {
  .page {
    padding: 14px 12px 32px;
  }

  .login-layout,
  .hero,
  .workspace-card,
  .content-card,
  .detail-board,
  .login-card {
    padding: 18px;
    border-radius: 20px;
  }

  .overview-strip,
  .filters {
    grid-template-columns: 1fr;
  }

  .toolbar,
  .module-header,
  .module-bottom,
  .panel-item,
  .roadmap-item-main,
  .roadmap-item-side {
    flex-direction: column;
    align-items: flex-start;
  }

  .roadmap-stage-top {
    grid-template-columns: 1fr;
  }

  .view-switch {
    width: 100%;
  }

  .view-tab {
    flex: 1 1 0;
  }

  .module-progress {
    min-width: 0;
    text-align: left;
  }
}
</style>
