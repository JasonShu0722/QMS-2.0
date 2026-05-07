<template>
  <div class="eight-d-workspace p-4 md:p-6">
    <div class="eight-d-workspace__content">
      <component
        :is="activeComponent"
        v-if="activeTab"
        :key="`${activeTab.key}:${activeTab.action || 'default'}`"
        :record-id="activeTab.recordId"
        :workspace-mode="true"
        :route-action="activeTab.action"
        :source-route-name="activeTab.sourceRouteName"
        :source-focus-id="activeTab.sourceFocusId"
        :source-complaint-id="activeTab.sourceComplaintId"
        @loaded-meta="handleLoadedMeta(activeTab.key, $event)"
      />

      <el-empty v-else description="未找到当前 8D 标签页，请从 SCAR 或客诉清单进入。" />
    </div>
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

function hasWorkspaceOpenQuery() {
  return Boolean(getSingleQueryValue(route.query.kind) && getSingleQueryValue(route.query.recordId))
}

const tabs = computed(() => workspaceStore.tabs)
const activeTab = computed(() => tabs.value.find((item) => item.key === workspaceStore.activeKey) || null)
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

function ensureActiveWorkspace() {
  if (tabs.value.length === 0) {
    if (!hasWorkspaceOpenQuery()) {
      void router.replace({ name: 'ProblemIssueCenter' })
    }
    return
  }

  if (!activeTab.value) {
    workspaceStore.setActiveKey(tabs.value[0].key)
  }
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
  ensureActiveWorkspace()
})

watch(
  () => route.query,
  () => {
    consumeWorkspaceOpenQuery()
    ensureActiveWorkspace()
  }
)
</script>

<style scoped>
.eight-d-workspace {
  min-height: 100vh;
  background: linear-gradient(180deg, #f5f7fb 0%, #eef3f9 100%);
}

.eight-d-workspace__content {
  min-height: calc(100vh - 110px);
}
</style>
