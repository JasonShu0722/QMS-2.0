<template>
  <div class="audit-nc-list p-4 md:p-6">
    <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">NC 整改清单</h1>
        <p class="mt-1 text-sm text-gray-500">审核不符合项整改跟踪</p>
        <p v-if="isCustomerAuditSource" class="mt-2 text-sm text-blue-600">
          当前 NC 来自客户审核问题任务，可在处理后返回客户审核台账继续跟踪。
        </p>
      </div>
      <el-button v-if="isCustomerAuditSource" @click="goBackToCustomerAuditSource">
        返回客审任务
      </el-button>
    </div>

    <el-card class="mb-6">
      <el-form :inline="true" :model="queryForm">
        <el-form-item label="问题分类">
          <el-select v-model="queryForm.problem_category_key" placeholder="全部" clearable>
            <el-option
              v-for="option in auditProblemCategoryOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="验证状态">
          <el-select v-model="queryForm.verification_status" placeholder="全部" clearable>
            <el-option
              v-for="option in statusOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="是否超期">
          <el-select v-model="queryForm.is_overdue" placeholder="全部" clearable>
            <el-option label="是" :value="true" />
            <el-option label="否" :value="false" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadNCs">查询</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card v-loading="loading">
      <el-table :data="ncs" stripe row-key="id" :row-class-name="getRowClassName">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column label="问题分类" width="140">
          <template #default="{ row }">
            <span>{{ getProblemCategoryLabel(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="nc_item" label="条款" width="120" />
        <el-table-column prop="nc_description" label="不符合项描述" min-width="250" show-overflow-tooltip />
        <el-table-column prop="responsible_dept" label="责任部门" width="120" />

        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="getAuditNCStatusType(row.verification_status)">
              {{ getAuditNCStatusLabel(row.verification_status) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="期限" width="180">
          <template #default="{ row }">
            <div :class="row.is_overdue ? 'font-bold text-red-600' : ''">
              {{ formatDateTime(row.deadline) }}
              <el-tag v-if="row.is_overdue" type="danger" size="small" class="ml-1">超期</el-tag>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="canAssignAuditNC(row.verification_status)"
              link
              type="primary"
              @click="handleAssign(row)"
            >
              指派
            </el-button>
            <el-button
              v-if="canRespondAuditNC(row.verification_status)"
              link
              type="primary"
              @click="handleRespond(row)"
            >
              填写对策
            </el-button>
            <el-button
              v-if="canVerifyAuditNC(row.verification_status)"
              link
              type="success"
              @click="handleVerify(row)"
            >
              验证
            </el-button>
            <el-button
              v-if="canCloseAuditNC(row.verification_status)"
              link
              type="success"
              @click="handleClose(row)"
            >
              关闭
            </el-button>
            <el-button link @click="handleView(row)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="mt-4 flex justify-end">
        <el-pagination
          v-model:current-page="queryForm.page"
          v-model:page-size="queryForm.page_size"
          :total="total"
          layout="total, prev, pager, next"
          @current-change="loadNCs"
        />
      </div>
    </el-card>

    <el-dialog
      v-model="showAssignDialog"
      title="指派 NC"
      width="90%"
      class="max-w-xl"
      :close-on-click-modal="false"
    >
      <el-form :model="assignForm" label-width="100px">
        <el-form-item label="指派给">
          <el-select
            v-model="assignForm.assigned_to"
            filterable
            placeholder="请选择内部责任人"
            class="w-full"
            :loading="loadingInternalUsers"
          >
            <el-option
              v-for="user in internalUsers"
              :key="user.id"
              :label="formatUserLabel(user)"
              :value="user.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="整改期限">
          <el-date-picker
            v-model="assignForm.deadline"
            type="datetime"
            placeholder="选择期限"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DDTHH:mm:ss"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="指派说明">
          <el-input v-model="assignForm.comment" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAssignDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitAssign">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showRespondDialog"
      title="填写整改对策"
      width="90%"
      class="max-w-2xl"
      :close-on-click-modal="false"
    >
      <el-form :model="respondForm" label-width="100px">
        <el-form-item label="根本原因" required>
          <el-input
            v-model="respondForm.root_cause"
            type="textarea"
            :rows="4"
            placeholder="请详细分析根本原因"
          />
        </el-form-item>
        <el-form-item label="纠正措施" required>
          <el-input
            v-model="respondForm.corrective_action"
            type="textarea"
            :rows="4"
            placeholder="请详细说明纠正措施"
          />
        </el-form-item>
        <el-form-item label="整改证据">
          <el-input v-model="respondForm.corrective_evidence" placeholder="证据文件路径" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showRespondDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitRespond">提交</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showVerifyDialog"
      title="验证 NC 整改"
      width="90%"
      class="max-w-xl"
      :close-on-click-modal="false"
    >
      <el-form :model="verifyForm" label-width="100px">
        <el-form-item label="验证结果" required>
          <el-radio-group v-model="verifyForm.is_approved">
            <el-radio :label="true">验证通过</el-radio>
            <el-radio :label="false">验证不通过</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="验证意见" required>
          <el-input v-model="verifyForm.verification_comment" type="textarea" :rows="4" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showVerifyDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitVerify">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import {
  assignAuditNC,
  closeAuditNC,
  getAuditNC,
  getAuditNCs,
  respondAuditNC,
  verifyAuditNC,
} from '@/api/audit'
import { problemManagementApi } from '@/api/problem-management'
import { useProblemManagementStore } from '@/stores/problemManagement'
import type { AuditNC, AuditNCAssign, AuditNCQuery, AuditNCResponse, AuditNCVerify } from '@/types/audit'
import type { InternalUserOption, ProblemCategoryKey } from '@/types/problem-management'
import { formatInternalUserLabel } from '@/utils/internalUsers'
import {
  buildAuditNCProblemCategoryOptions,
  canAssignAuditNC,
  canCloseAuditNC,
  canRespondAuditNC,
  canVerifyAuditNC,
  getAuditNCProblemCategoryLabel,
  getAuditNCStatusLabel,
  getAuditNCStatusOptions,
  getAuditNCStatusType,
} from '@/utils/auditNc'

const route = useRoute()
const router = useRouter()
const problemManagementStore = useProblemManagementStore()

const loading = ref(false)
const loadingInternalUsers = ref(false)
const submitting = ref(false)
const ncs = ref<AuditNC[]>([])
const total = ref(0)
const currentNC = ref<AuditNC | null>(null)
const internalUsers = ref<InternalUserOption[]>([])

const showAssignDialog = ref(false)
const showRespondDialog = ref(false)
const showVerifyDialog = ref(false)
const statusOptions = getAuditNCStatusOptions()
const auditProblemCategoryOptions = computed(() =>
  buildAuditNCProblemCategoryOptions(problemManagementStore.categoriesByModule.audit_management ?? [])
)

const queryForm = reactive<AuditNCQuery>({
  problem_category_key: undefined,
  verification_status: '',
  is_overdue: undefined,
  page: 1,
  page_size: 20,
})

const assignForm = reactive<AuditNCAssign>({
  assigned_to: 0,
  deadline: '',
  comment: '',
})

const respondForm = reactive<AuditNCResponse>({
  root_cause: '',
  corrective_action: '',
  corrective_evidence: '',
})

const verifyForm = reactive<AuditNCVerify>({
  is_approved: true,
  verification_comment: '',
})

function formatUserLabel(user: InternalUserOption) {
  return formatInternalUserLabel(user)
}

function parseFocusId(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) {
    return null
  }

  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

const focusedNcId = computed(() => parseFocusId(route.query.focusId))
const sourceCustomerAuditId = computed(() => parseFocusId(route.query.sourceParentId))
const isCustomerAuditSource = computed(
  () => route.query.sourceCategoryKey === 'AQ3' && Boolean(sourceCustomerAuditId.value)
)

function clearRouteAction() {
  if (!route.query.action) {
    return
  }

  const { action, ...restQuery } = route.query
  void router.replace({
    name: 'AuditNCList',
    query: restQuery,
  })
}

function goBackToCustomerAuditSource() {
  if (!sourceCustomerAuditId.value) {
    return
  }

  void router.push({
    name: 'CustomerAuditList',
    query: {
      focusId: String(sourceCustomerAuditId.value),
      ...(focusedNcId.value
        ? {
            issueTaskId: String(focusedNcId.value),
            openIssueTasks: 'true',
          }
        : {}),
    },
  })
}

function resolveProblemCategory(categoryKey: ProblemCategoryKey) {
  return problemManagementStore.getCategory(categoryKey)
}

function getProblemCategoryLabel(nc: AuditNC): string {
  return getAuditNCProblemCategoryLabel(
    nc.problem_category_key,
    nc.problem_category_label,
    resolveProblemCategory
  )
}

async function loadFocusedNC() {
  if (!focusedNcId.value || ncs.value.some((item) => item.id === focusedNcId.value)) {
    return
  }

  try {
    const focusedNc = await getAuditNC(focusedNcId.value)
    ncs.value = [focusedNc, ...ncs.value]
  } catch (error) {
    console.error('Failed to load focused audit NC:', error)
  }
}

async function consumeRouteAction() {
  if (!route.query.action || !focusedNcId.value) {
    return
  }

  const focusedNc = ncs.value.find((item) => item.id === focusedNcId.value)
  if (!focusedNc) {
    return
  }

  if (route.query.action === 'respond' && canRespondAuditNC(focusedNc.verification_status)) {
    handleRespond(focusedNc)
    clearRouteAction()
    return
  }

  if (route.query.action === 'verify' && canVerifyAuditNC(focusedNc.verification_status)) {
    handleVerify(focusedNc)
    clearRouteAction()
    return
  }

  if (route.query.action === 'close' && canCloseAuditNC(focusedNc.verification_status)) {
    clearRouteAction()
    await handleClose(focusedNc)
  }
}

async function loadNCs() {
  loading.value = true

  try {
    const response = await getAuditNCs(queryForm)
    ncs.value = response.items
    total.value = response.total
    await loadFocusedNC()
    await consumeRouteAction()
  } catch (error: any) {
    ElMessage.error(error.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function loadInternalUsers() {
  loadingInternalUsers.value = true

  try {
    internalUsers.value = await problemManagementApi.getInternalUsers()
  } catch (error: any) {
    ElMessage.error(error.message || '加载内部责任人列表失败')
  } finally {
    loadingInternalUsers.value = false
  }
}

function handleAssign(nc: AuditNC) {
  currentNC.value = nc
  Object.assign(assignForm, { assigned_to: 0, deadline: '', comment: '' })
  showAssignDialog.value = true
}

async function submitAssign() {
  if (!currentNC.value) {
    return
  }

  submitting.value = true

  try {
    await assignAuditNC(currentNC.value.id, assignForm)
    ElMessage.success('指派成功')
    showAssignDialog.value = false
    await loadNCs()
  } catch (error: any) {
    ElMessage.error(error.message || '指派失败')
  } finally {
    submitting.value = false
  }
}

function handleRespond(nc: AuditNC) {
  currentNC.value = nc
  Object.assign(respondForm, { root_cause: '', corrective_action: '', corrective_evidence: '' })
  showRespondDialog.value = true
}

async function submitRespond() {
  if (!currentNC.value) {
    return
  }

  submitting.value = true

  try {
    await respondAuditNC(currentNC.value.id, respondForm)
    ElMessage.success('提交成功')
    showRespondDialog.value = false
    await loadNCs()
  } catch (error: any) {
    ElMessage.error(error.message || '提交失败')
  } finally {
    submitting.value = false
  }
}

function handleVerify(nc: AuditNC) {
  currentNC.value = nc
  Object.assign(verifyForm, { is_approved: true, verification_comment: '' })
  showVerifyDialog.value = true
}

async function submitVerify() {
  if (!currentNC.value) {
    return
  }

  submitting.value = true

  try {
    await verifyAuditNC(currentNC.value.id, verifyForm)
    ElMessage.success('验证成功')
    showVerifyDialog.value = false
    await loadNCs()
  } catch (error: any) {
    ElMessage.error(error.message || '验证失败')
  } finally {
    submitting.value = false
  }
}

async function handleClose(nc: AuditNC) {
  try {
    await closeAuditNC(nc.id)
    ElMessage.success('关闭成功')
    await loadNCs()
  } catch (error: any) {
    ElMessage.error(error.message || '关闭失败')
  }
}

function handleView(nc: AuditNC) {
  void router.push({
    name: 'AuditNCList',
    query: {
      ...route.query,
      focusId: String(nc.id),
    },
  })
}

function getRowClassName({ row }: { row: AuditNC }) {
  return focusedNcId.value === row.id ? 'focused-row' : ''
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('zh-CN')
}

onMounted(async () => {
  await problemManagementStore.loadCatalog()
  await loadInternalUsers()
  await loadNCs()
})

watch(
  () => route.query.focusId,
  async (current, previous) => {
    if (current === previous) {
      return
    }

    await loadNCs()
  }
)

watch(
  () => route.query.action,
  () => {
    void consumeRouteAction()
  }
)
</script>

<style scoped>
.audit-nc-list {
  min-height: 100vh;
  background-color: #f5f7fa;
}

:deep(.focused-row td) {
  background-color: #ecf5ff !important;
}
</style>
