<template>
  <div class="problem-issue-center p-4 md:p-6">
    <div class="mb-6">
      <h1 class="text-2xl font-bold">问题中心</h1>
    </div>

    <el-card class="mb-6">
      <el-form :inline="true" :model="queryForm" class="flex flex-wrap gap-2">
        <el-form-item label="模块">
          <el-select v-model="queryForm.module_key" clearable placeholder="全部" class="w-full md:w-44">
            <el-option
              v-for="option in moduleOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="统一状态">
          <el-select v-model="queryForm.unified_status" clearable placeholder="全部" class="w-full md:w-40">
            <el-option
              v-for="option in statusOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="风险">
          <el-select v-model="queryForm.risk_level" clearable placeholder="全部" class="w-full md:w-32">
            <el-option
              v-for="option in riskLevelOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="回复形式">
          <el-select v-model="queryForm.response_mode" clearable placeholder="全部" class="w-full md:w-36">
            <el-option
              v-for="option in responseModeOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="关键词">
          <el-input
            v-model="queryForm.keyword"
            clearable
            placeholder="编号、标题、客户、供应商、责任部门"
            class="w-full md:w-60"
            @keyup.enter="handleSearch"
          />
        </el-form-item>

        <el-form-item>
          <el-checkbox v-model="queryForm.only_assigned_to_me">只看分派给我</el-checkbox>
        </el-form-item>

        <el-form-item>
          <el-checkbox v-model="queryForm.only_actionable_to_me">只看我可处理</el-checkbox>
        </el-form-item>

        <el-form-item>
          <el-checkbox v-model="queryForm.only_created_by_me">只看我发起的</el-checkbox>
        </el-form-item>

        <el-form-item>
          <el-checkbox v-model="queryForm.only_overdue">只看超期</el-checkbox>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="handleSearch">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card v-loading="loading">
      <el-table :data="items" stripe class="w-full">
        <el-table-column label="跟进编号" min-width="190">
          <template #default="{ row }">
            <div class="font-medium">{{ getProblemIssueTrackingNumber(row) }}</div>
          </template>
        </el-table-column>

        <el-table-column label="模块" width="120">
          <template #default="{ row }">
            <span>{{ getProblemIssueModuleLabel(row.module_key) }}</span>
          </template>
        </el-table-column>

        <el-table-column prop="title" label="问题标题" min-width="260" show-overflow-tooltip />

        <el-table-column label="客户/供应商/对象" min-width="180">
          <template #default="{ row }">
            <span>{{ row.customer_name || '-' }}</span>
          </template>
        </el-table-column>

        <el-table-column prop="responsible_dept" label="责任部门" width="140">
          <template #default="{ row }">
            <span>{{ row.responsible_dept || '-' }}</span>
          </template>
        </el-table-column>

        <el-table-column label="当前责任人" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ getAssignedUserLabel(row.assigned_to) }}</span>
          </template>
        </el-table-column>

        <el-table-column label="回复形式" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.response_mode === 'eight_d' ? 'primary' : 'info'">
              {{ getProblemIssueResponseModeLabel(row.response_mode) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="风险" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="getProblemIssueRiskLevelType(row.risk_level)">
              {{ getProblemIssueRiskLevelLabel(row.risk_level) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="统一状态" width="120">
          <template #default="{ row }">
            <el-tag :type="getUnifiedProblemStatusType(row.unified_status)">
              {{ getUnifiedProblemStatusLabel(row.unified_status) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="时限" width="180">
          <template #default="{ row }">
            <div :class="row.is_overdue ? 'font-bold text-red-600' : ''">
              {{ formatDateTimeInBeijing(row.due_at) }}
              <el-tag v-if="row.is_overdue" type="danger" size="small" class="ml-1">超期</el-tag>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="更新时间" width="180">
          <template #default="{ row }">
            {{ formatDateTimeInBeijing(row.updated_at) }}
          </template>
        </el-table-column>

        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <div class="flex items-center gap-2">
              <el-button
                v-if="getProblemIssueQuickActionRoute(row, currentUserId)"
                link
                type="success"
                @click="handleQuickAction(row)"
              >
                {{ getProblemIssueQuickActionLabel(row, currentUserId) }}
              </el-button>
              <el-button
                v-if="getProblemIssueSourceRoute(row)"
                link
                type="primary"
                @click="handleOpenSource(row)"
              >
                {{ getProblemIssueSourceActionLabel(row) }}
              </el-button>
              <span
                v-if="!getProblemIssueQuickActionRoute(row, currentUserId) && !getProblemIssueSourceRoute(row)"
                class="text-gray-400"
              >
                -
              </span>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div class="mt-4 flex justify-end">
        <el-pagination
          v-model:current-page="queryForm.page"
          v-model:page-size="queryForm.page_size"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="loadIssueSummaries"
          @current-change="loadIssueSummaries"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import { problemManagementApi } from '@/api/problem-management'
import { useAuthStore } from '@/stores/auth'
import type {
  InternalUserOption,
  ProblemIssueSummaryItem,
  ProblemIssueSummaryQuery,
  ProblemModuleKey,
} from '@/types/problem-management'
import { formatDateTimeInBeijing } from '@/utils/dateTime'
import { buildInternalUserLabelMap } from '@/utils/internalUsers'
import {
  buildProblemIssueModuleOptions,
  buildProblemIssueResponseModeOptions,
  buildProblemIssueRiskLevelOptions,
  buildUnifiedProblemStatusOptions,
  getProblemIssueModuleLabel,
  getProblemIssueQuickActionLabel,
  getProblemIssueQuickActionRoute,
  getProblemIssueResponseModeLabel,
  getProblemIssueRiskLevelLabel,
  getProblemIssueRiskLevelType,
  getProblemIssueTrackingNumber,
  parseProblemIssueCenterRouteQuery,
  getProblemIssueSourceActionLabel,
  getProblemIssueSourceRoute,
  getUnifiedProblemStatusLabel,
  getUnifiedProblemStatusType,
} from '@/utils/problemIssueSummary'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const SUPPORTED_MODULE_KEYS: ProblemModuleKey[] = [
  'customer_quality',
  'process_quality',
  'incoming_quality',
  'new_product_quality',
  'audit_management',
]

const loading = ref(false)
const items = ref<ProblemIssueSummaryItem[]>([])
const total = ref(0)
const internalUsers = ref<InternalUserOption[]>([])

const currentUserId = computed(() => authStore.userInfo?.id ?? null)
const internalUserLabelMap = computed(() => buildInternalUserLabelMap(internalUsers.value))

const queryForm = reactive<ProblemIssueSummaryQuery>({
  module_key: undefined,
  risk_level: undefined,
  response_mode: undefined,
  unified_status: undefined,
  keyword: undefined,
  only_assigned_to_me: false,
  only_actionable_to_me: false,
  only_created_by_me: false,
  only_overdue: false,
  page: 1,
  page_size: 20,
})

const moduleOptions = buildProblemIssueModuleOptions().filter((option) =>
  SUPPORTED_MODULE_KEYS.includes(option.value)
)
const statusOptions = buildUnifiedProblemStatusOptions()
const riskLevelOptions = buildProblemIssueRiskLevelOptions()
const responseModeOptions = buildProblemIssueResponseModeOptions()

watch(
  () => route.query,
  async () => {
    applyRouteQueryToForm()
    await loadIssueSummaries()
  }
)

async function loadIssueSummaries() {
  loading.value = true

  try {
    const response = await problemManagementApi.getIssueSummaries(queryForm)
    items.value = response.items
    total.value = response.total
  } catch (error: any) {
    ElMessage.error(error.message || '加载问题中心失败')
  } finally {
    loading.value = false
  }
}

async function loadInternalUsers() {
  try {
    internalUsers.value = await problemManagementApi.getInternalUsers()
  } catch (error: any) {
    ElMessage.error(error.message || '加载内部责任人列表失败')
  }
}

function getAssignedUserLabel(assignedTo?: number | null) {
  if (!assignedTo) {
    return '-'
  }

  return internalUserLabelMap.value[assignedTo] || `#${assignedTo}`
}

function applyRouteQueryToForm() {
  const parsedQuery = parseProblemIssueCenterRouteQuery(route.query)

  queryForm.module_key = parsedQuery.module_key
  queryForm.risk_level = parsedQuery.risk_level
  queryForm.response_mode = parsedQuery.response_mode
  queryForm.unified_status = parsedQuery.unified_status
  queryForm.keyword = parsedQuery.keyword
  queryForm.only_assigned_to_me = parsedQuery.only_assigned_to_me ?? false
  queryForm.only_actionable_to_me = parsedQuery.only_actionable_to_me ?? false
  queryForm.only_created_by_me = parsedQuery.only_created_by_me ?? false
  queryForm.only_overdue = parsedQuery.only_overdue ?? false
  queryForm.page = parsedQuery.page ?? 1
  queryForm.page_size = parsedQuery.page_size ?? 20
}

async function handleSearch() {
  queryForm.page = 1
  await loadIssueSummaries()
}

async function handleReset() {
  queryForm.module_key = undefined
  queryForm.risk_level = undefined
  queryForm.response_mode = undefined
  queryForm.unified_status = undefined
  queryForm.keyword = undefined
  queryForm.only_assigned_to_me = false
  queryForm.only_actionable_to_me = false
  queryForm.only_created_by_me = false
  queryForm.only_overdue = false
  queryForm.page = 1
  queryForm.page_size = 20
  await loadIssueSummaries()
}

function handleQuickAction(item: ProblemIssueSummaryItem) {
  const target = getProblemIssueQuickActionRoute(item, currentUserId.value)
  if (!target) {
    return
  }

  router.push(target)
}

function handleOpenSource(item: ProblemIssueSummaryItem) {
  const target = getProblemIssueSourceRoute(item)
  if (!target) {
    ElMessage.info('当前来源暂不支持直接跳转')
    return
  }

  router.push(target)
}

onMounted(async () => {
  await loadInternalUsers()
  applyRouteQueryToForm()
  await loadIssueSummaries()
})
</script>

<style scoped>
.problem-issue-center {
  min-height: 100vh;
  background-color: #f5f7fa;
}
</style>
