<template>
  <div class="eight-d-workspace p-4 md:p-6">
    <div class="eight-d-workspace__header">
      <div>
        <h1 class="eight-d-workspace__title">8D报告</h1>
        <p class="eight-d-workspace__subtitle">
          从 SCAR、客诉、问题中心或待办中打开 8D，并在同一工作区内切换处理标签页。
        </p>
      </div>
    </div>

    <div class="eight-d-workspace__tabs" role="tablist" aria-label="8D工作区标签页">
      <button
        type="button"
        class="eight-d-workspace__tab"
        :class="{ 'is-active': activeKey === 'overview' }"
        @click="handleActivateOverview"
      >
        首页
      </button>

      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="eight-d-workspace__tab"
        :class="{ 'is-active': activeKey === tab.key }"
        @click="handleActivateTab(tab.key)"
      >
        <span class="eight-d-workspace__tab-dot" :class="`is-${tab.kind}`"></span>
        <span class="eight-d-workspace__tab-label">{{ tab.title }}</span>
        <span class="eight-d-workspace__tab-close" @click.stop="handleCloseTab(tab.key)">×</span>
      </button>
    </div>

    <el-card shadow="never" class="eight-d-workspace__content">
      <div v-if="activeKey === 'overview'" class="eight-d-workspace__overview">
        <h2>8D工作区首页</h2>
        <p>通过来源单据、待办事项或问题中心打开具体 8D 报告后，会在这里形成页内标签页。</p>
        <ul>
          <li>供应商质量：从 `SCAR 管理` 或 `审核8D` 打开。</li>
          <li>客户质量：从 `客诉管理`、客诉详情或关联问题打开。</li>
          <li>已打开标签会在当前浏览器会话中保留，方便来回切换处理。</li>
        </ul>
      </div>

      <component
        :is="activeComponent"
        v-else-if="activeTab"
        :key="`${activeTab.key}:${activeTab.action || 'default'}`"
        :record-id="activeTab.recordId"
        :workspace-mode="true"
        :route-action="activeTab.action"
        :source-route-name="activeTab.sourceRouteName"
        :source-focus-id="activeTab.sourceFocusId"
        :source-complaint-id="activeTab.sourceComplaintId"
        @loaded-meta="handleLoadedMeta(activeTab.key, $event)"
      />

      <el-empty v-else description="未找到当前 8D 标签页，请重新从来源单据进入。" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import EightDCustomerForm from '@/views/EightDCustomerForm.vue'
import SupplierEightDForm from '@/views/supplier/EightDForm.vue'
import { useEightDWorkspaceStore, type EightDWorkspaceTabKind } from '@/stores/eightDWorkspace'

const route = useRoute()
const router = useRouter()
const workspaceStore = useEightDWorkspaceStore()

function getSingleQueryValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0]
  }

  return undefined
}

function isWorkspaceTabKind(value: string | undefined): value is EightDWorkspaceTabKind {
  return value === 'supplier' || value === 'customer'
}

const tabs = computed(() => workspaceStore.tabs)
const activeKey = computed(() => workspaceStore.activeKey)
const activeTab = computed(() => tabs.value.find((item) => item.key === activeKey.value) || null)
const activeComponent = computed(() =>
  activeTab.value?.kind === 'customer' ? EightDCustomerForm : SupplierEightDForm
)

function consumeWorkspaceOpenQuery() {
  const kind = getSingleQueryValue(route.query.kind)
  const recordIdRaw = getSingleQueryValue(route.query.recordId)

  if (!isWorkspaceTabKind(kind) || !recordIdRaw) {
    return
  }

  const recordId = Number.parseInt(recordIdRaw, 10)
  if (!Number.isInteger(recordId) || recordId <= 0) {
    return
  }

  workspaceStore.openTab({
    kind,
    recordId,
    sourceRouteName: getSingleQueryValue(route.query.sourceRouteName),
    sourceFocusId: getSingleQueryValue(route.query.sourceFocusId),
    sourceComplaintId: getSingleQueryValue(route.query.sourceComplaintId),
    action: getSingleQueryValue(route.query.action),
  })

  void router.replace({ name: 'EightDWorkspace' })
}

function handleActivateOverview() {
  workspaceStore.setActiveKey('overview')
}

function handleActivateTab(key: string) {
  workspaceStore.setActiveKey(key)
}

function handleCloseTab(key: string) {
  workspaceStore.closeTab(key)
}

function handleLoadedMeta(key: string, meta: { title?: string }) {
  if (!meta.title) {
    return
  }

  workspaceStore.updateTabMeta(key, { title: meta.title })
}

onMounted(() => {
  workspaceStore.initialize()
  consumeWorkspaceOpenQuery()
})

watch(
  () => route.query,
  () => {
    consumeWorkspaceOpenQuery()
  }
)
</script>

<style scoped>
.eight-d-workspace {
  min-height: 100vh;
  background: linear-gradient(180deg, #f5f7fb 0%, #eef3f9 100%);
}

.eight-d-workspace__header {
  margin-bottom: 16px;
}

.eight-d-workspace__title {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  color: #1f2937;
}

.eight-d-workspace__subtitle {
  margin: 8px 0 0;
  color: #6b7280;
  font-size: 14px;
}

.eight-d-workspace__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
  padding: 10px;
  background: #fff;
  border: 1px solid #dbe3ef;
  border-radius: 14px;
}

.eight-d-workspace__tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid #d1d9e6;
  border-radius: 8px;
  background: #f8fafc;
  color: #334155;
  cursor: pointer;
  transition: all 0.18s ease;
}

.eight-d-workspace__tab:hover {
  border-color: #93c5fd;
  background: #eff6ff;
}

.eight-d-workspace__tab.is-active {
  border-color: #409eff;
  background: #409eff;
  color: #fff;
  box-shadow: 0 8px 20px rgba(64, 158, 255, 0.22);
}

.eight-d-workspace__tab-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #94a3b8;
}

.eight-d-workspace__tab-dot.is-supplier {
  background: #f59e0b;
}

.eight-d-workspace__tab-dot.is-customer {
  background: #10b981;
}

.eight-d-workspace__tab.is-active .eight-d-workspace__tab-dot {
  background: rgba(255, 255, 255, 0.92);
}

.eight-d-workspace__tab-label {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.eight-d-workspace__tab-close {
  font-size: 16px;
  line-height: 1;
  opacity: 0.75;
}

.eight-d-workspace__tab-close:hover {
  opacity: 1;
}

.eight-d-workspace__content {
  border-radius: 16px;
}

.eight-d-workspace__overview h2 {
  margin: 0 0 12px;
  font-size: 22px;
  color: #111827;
}

.eight-d-workspace__overview p {
  margin: 0 0 16px;
  color: #4b5563;
}

.eight-d-workspace__overview ul {
  margin: 0;
  padding-left: 18px;
  color: #4b5563;
  line-height: 1.8;
}

@media (max-width: 768px) {
  .eight-d-workspace__title {
    font-size: 24px;
  }

  .eight-d-workspace__tabs {
    padding: 8px;
  }

  .eight-d-workspace__tab {
    max-width: 100%;
  }

  .eight-d-workspace__tab-label {
    max-width: 180px;
  }
}
</style>
