<template>
  <div class="customer-audit-list p-4 md:p-6">
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">客户审核台账</h1>
        <p class="mt-1 text-sm text-gray-500">客户来厂审核记录与问题任务跟踪</p>
      </div>
      <el-button type="primary" @click="handleCreate">
        <el-icon><Plus /></el-icon>
        创建客户审核记录
      </el-button>
    </div>

    <el-card class="mb-6">
      <el-form :inline="true" :model="queryForm" class="flex flex-wrap gap-2">
        <el-form-item label="客户名称">
          <el-input v-model="queryForm.customer_name" placeholder="模糊搜索" clearable />
        </el-form-item>
        <el-form-item label="审核类型">
          <el-select v-model="queryForm.audit_type" placeholder="全部" clearable>
            <el-option label="体系审核" value="system" />
            <el-option label="过程审核" value="process" />
            <el-option label="产品审核" value="product" />
            <el-option label="资质审核" value="qualification" />
            <el-option label="潜在供应商审核" value="potential_supplier" />
          </el-select>
        </el-form-item>
        <el-form-item label="最终结果">
          <el-select v-model="queryForm.final_result" placeholder="全部" clearable>
            <el-option label="通过" value="passed" />
            <el-option label="有条件通过" value="conditional_passed" />
            <el-option label="未通过" value="failed" />
            <el-option label="待定" value="pending" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadAudits">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card v-loading="loading">
      <el-table :data="audits" stripe :row-class-name="getRowClassName">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="customer_name" label="客户名称" min-width="180" />
        <el-table-column label="审核类型" width="140">
          <template #default="{ row }">
            {{ getAuditTypeLabel(row.audit_type) }}
          </template>
        </el-table-column>
        <el-table-column label="审核日期" width="180">
          <template #default="{ row }">
            {{ formatDateTime(row.audit_date) }}
          </template>
        </el-table-column>
        <el-table-column label="最终结果" width="120">
          <template #default="{ row }">
            <el-tag :type="getResultType(row.final_result)">
              {{ getResultLabel(row.final_result) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="得分" width="100">
          <template #default="{ row }">
            <span v-if="row.score !== undefined && row.score !== null" class="font-bold">{{ row.score }}</span>
            <span v-else class="text-gray-400">-</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)">
              {{ getStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="320" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="handleView(row)">查看任务</el-button>
            <el-button link type="primary" @click="handleEdit(row)">编辑</el-button>
            <el-button link type="success" @click="handleCreateIssueTask(row)">创建问题任务</el-button>
            <el-button link type="danger" @click="handleDelete(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="mt-4 flex justify-end">
        <el-pagination
          v-model:current-page="queryForm.page"
          v-model:page-size="queryForm.page_size"
          :total="total"
          layout="total, prev, pager, next"
          @current-change="loadAudits"
        />
      </div>
    </el-card>

    <el-dialog
      v-model="showFormDialog"
      :title="editingAudit ? '编辑客户审核' : '创建客户审核'"
      width="90%"
      class="max-w-3xl"
      :close-on-click-modal="false"
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="120px">
        <el-form-item label="客户名称" prop="customer_name">
          <el-input v-model="form.customer_name" placeholder="请输入客户名称" />
        </el-form-item>
        <el-form-item label="审核类型" prop="audit_type">
          <el-select v-model="form.audit_type" placeholder="请选择" class="w-full">
            <el-option label="体系审核" value="system" />
            <el-option label="过程审核" value="process" />
            <el-option label="产品审核" value="product" />
            <el-option label="资质审核" value="qualification" />
            <el-option label="潜在供应商审核" value="potential_supplier" />
          </el-select>
        </el-form-item>
        <el-form-item label="审核日期" prop="audit_date">
          <el-date-picker
            v-model="form.audit_date"
            type="datetime"
            placeholder="选择日期"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DDTHH:mm:ss"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="最终结果" prop="final_result">
          <el-select v-model="form.final_result" placeholder="请选择" class="w-full">
            <el-option label="通过" value="passed" />
            <el-option label="有条件通过" value="conditional_passed" />
            <el-option label="未通过" value="failed" />
            <el-option label="待定" value="pending" />
          </el-select>
        </el-form-item>
        <el-form-item label="审核得分" prop="score">
          <el-input-number v-model="form.score" :min="0" :max="100" class="w-full" />
        </el-form-item>
        <el-form-item label="内部接待人员" prop="internal_contact">
          <el-input v-model="form.internal_contact" placeholder="请输入接待人员" />
        </el-form-item>
        <el-form-item label="问题清单路径" prop="external_issue_list_path">
          <el-input v-model="form.external_issue_list_path" placeholder="客户提供的问题清单路径" />
        </el-form-item>
        <el-form-item label="审核报告路径" prop="audit_report_path">
          <el-input v-model="form.audit_report_path" placeholder="审核报告路径" />
        </el-form-item>
        <el-form-item label="审核总结" prop="summary">
          <el-input v-model="form.summary" type="textarea" :rows="4" placeholder="请输入审核总结" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showFormDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">
          {{ editingAudit ? '更新' : '创建' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showIssueTaskDialog"
      title="创建问题任务"
      width="90%"
      class="max-w-2xl"
      :close-on-click-modal="false"
    >
      <el-form :model="issueTaskForm" label-width="120px">
        <el-form-item label="问题分类">
          <el-tag type="info">{{ issueTaskProblemCategoryKey }} / {{ issueTaskProblemCategoryLabel }}</el-tag>
        </el-form-item>
        <el-form-item label="回复形式">
          <el-radio-group v-model="issueTaskForm.response_mode">
            <el-radio-button label="brief">问题简报</el-radio-button>
            <el-radio-button label="eight_d">8D报告</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="问题描述" required>
          <el-input v-model="issueTaskForm.issue_description" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="责任部门" required>
          <el-input v-model="issueTaskForm.responsible_dept" />
        </el-form-item>
        <el-form-item label="指派给" required>
          <el-select
            v-model="issueTaskForm.assigned_to"
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
        <el-form-item label="整改期限" required>
          <el-date-picker
            v-model="issueTaskForm.deadline"
            type="datetime"
            placeholder="选择期限"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DDTHH:mm:ss"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="优先级">
          <el-select v-model="issueTaskForm.priority" class="w-full">
            <el-option label="低" value="low" />
            <el-option label="中" value="medium" />
            <el-option label="高" value="high" />
            <el-option label="紧急" value="critical" />
          </el-select>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showIssueTaskDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitIssueTask">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showIssueTaskListDialog"
      title="客户审核问题任务"
      width="90%"
      class="max-w-4xl"
      :close-on-click-modal="false"
    >
      <div v-if="currentAudit" class="mb-4 flex flex-wrap items-center gap-4 text-sm text-gray-500">
        <span>客户：{{ currentAudit.customer_name }}</span>
        <span>审核日期：{{ formatDateTime(currentAudit.audit_date) }}</span>
        <span>状态：{{ getStatusLabel(currentAudit.status) }}</span>
      </div>

      <el-table
        v-loading="loadingIssueTasks"
        :data="issueTasks"
        stripe
        :row-class-name="getIssueTaskRowClassName"
      >
        <el-table-column prop="problem_category_key" label="分类" width="90" />
        <el-table-column label="回复" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.response_mode === 'eight_d' ? 'primary' : 'info'">
              {{ row.response_mode === 'eight_d' ? '8D' : '简报' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="issue_description" label="问题描述" min-width="240" show-overflow-tooltip />
        <el-table-column prop="responsible_dept" label="责任部门" width="140" />
        <el-table-column label="责任人" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ getInternalUserLabel(row.assigned_to) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="getIssueTaskStatusType(row.status)">
              {{ getIssueTaskStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="期限" width="180">
          <template #default="{ row }">
            {{ formatDateTime(row.deadline) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openIssueTaskInNc(row)">去处理</el-button>
          </template>
        </el-table-column>
      </el-table>

      <template #footer>
        <el-button @click="showIssueTaskListDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'

import {
  createCustomerAudit,
  createCustomerAuditIssueTask,
  deleteCustomerAudit,
  getCustomerAudit,
  getCustomerAuditIssueTasks,
  getCustomerAudits,
  updateCustomerAudit,
} from '@/api/audit'
import { problemManagementApi } from '@/api/problem-management'
import { useProblemManagementStore } from '@/stores/problemManagement'
import type {
  CustomerAudit,
  CustomerAuditCreate,
  CustomerAuditIssueTaskCreate,
  CustomerAuditIssueTaskResponse,
} from '@/types/audit'
import type { InternalUserOption } from '@/types/problem-management'
import { buildInternalUserLabelMap, formatInternalUserLabel } from '@/utils/internalUsers'
import { getProblemCategoryLabel } from '@/utils/problemManagement'

const route = useRoute()
const router = useRouter()
const problemManagementStore = useProblemManagementStore()

const loading = ref(false)
const loadingInternalUsers = ref(false)
const loadingIssueTasks = ref(false)
const submitting = ref(false)
const audits = ref<CustomerAudit[]>([])
const issueTasks = ref<CustomerAuditIssueTaskResponse[]>([])
const total = ref(0)
const showFormDialog = ref(false)
const showIssueTaskDialog = ref(false)
const showIssueTaskListDialog = ref(false)
const dialogFocusedIssueTaskId = ref<number | null>(null)
const editingAudit = ref<CustomerAudit | null>(null)
const currentAudit = ref<CustomerAudit | null>(null)
const internalUsers = ref<InternalUserOption[]>([])
const internalUserLabelMap = computed(() => buildInternalUserLabelMap(internalUsers.value))

const issueTaskProblemCategoryKey = 'AQ3' as const
const issueTaskProblemCategoryLabel = computed(() =>
  getProblemCategoryLabel(
    issueTaskProblemCategoryKey,
    '客户审核问题',
    (categoryKey) => problemManagementStore.getCategory(categoryKey)
  )
)

const formRef = ref<FormInstance>()

const queryForm = reactive({
  customer_name: '',
  audit_type: '',
  final_result: '',
  page: 1,
  page_size: 20,
})

const form = reactive<CustomerAuditCreate>({
  customer_name: '',
  audit_type: '',
  audit_date: '',
  final_result: '',
  score: undefined,
  internal_contact: '',
  external_issue_list_path: '',
  audit_report_path: '',
  summary: '',
})

const issueTaskForm = reactive<CustomerAuditIssueTaskCreate>({
  customer_audit_id: 0,
  issue_description: '',
  responsible_dept: '',
  assigned_to: undefined,
  deadline: '',
  priority: 'medium',
  response_mode: 'brief',
})

const formRules: FormRules = {
  customer_name: [{ required: true, message: '请输入客户名称', trigger: 'blur' }],
  audit_type: [{ required: true, message: '请选择审核类型', trigger: 'change' }],
  audit_date: [{ required: true, message: '请选择审核日期', trigger: 'change' }],
  final_result: [{ required: true, message: '请选择最终结果', trigger: 'change' }],
}

const formatUserLabel = (user: InternalUserOption): string => formatInternalUserLabel(user)

function parseFocusId(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) {
    return null
  }

  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

const focusedAuditId = computed(() => parseFocusId(route.query.focusId))
const focusedIssueTaskId = computed(() => parseFocusId(route.query.issueTaskId))

function getInternalUserLabel(userId?: number) {
  if (!userId) {
    return '-'
  }

  return internalUserLabelMap.value[userId] || `#${userId}`
}

async function loadAudits() {
  loading.value = true
  try {
    const response = await getCustomerAudits(queryForm)
    audits.value = response.items
    total.value = response.total
    await ensureFocusedAuditLoaded()
    await consumeRouteOpenIssueTasks()
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

async function loadIssueTasks(customerAuditId: number) {
  loadingIssueTasks.value = true
  try {
    issueTasks.value = await getCustomerAuditIssueTasks(customerAuditId)
  } catch (error: any) {
    issueTasks.value = []
    ElMessage.error(error.message || '加载问题任务失败')
  } finally {
    loadingIssueTasks.value = false
  }
}

async function ensureFocusedAuditLoaded() {
  if (!focusedAuditId.value || audits.value.some((item) => item.id === focusedAuditId.value)) {
    return
  }

  try {
    const audit = await getCustomerAudit(focusedAuditId.value)
    audits.value = [audit, ...audits.value]
  } catch (error) {
    console.error('Failed to load focused customer audit:', error)
  }
}

function clearRouteIssueTaskQuery() {
  if (route.query.openIssueTasks !== 'true' && !route.query.issueTaskId) {
    return
  }

  const { openIssueTasks, issueTaskId, ...restQuery } = route.query
  void router.replace({
    name: 'CustomerAuditList',
    query: restQuery,
  })
}

async function openIssueTaskList(audit: CustomerAudit) {
  currentAudit.value = audit
  dialogFocusedIssueTaskId.value = focusedIssueTaskId.value
  showIssueTaskListDialog.value = true
  await loadIssueTasks(audit.id)
}

async function consumeRouteOpenIssueTasks() {
  const shouldOpen = route.query.openIssueTasks === 'true'
  if (!shouldOpen || !focusedAuditId.value) {
    return
  }

  const audit = audits.value.find((item) => item.id === focusedAuditId.value)
  if (!audit) {
    return
  }

  await openIssueTaskList(audit)
  clearRouteIssueTaskQuery()
}

function handleReset() {
  Object.assign(queryForm, {
    customer_name: '',
    audit_type: '',
    final_result: '',
    page: 1,
  })
  void loadAudits()
}

function handleCreate() {
  editingAudit.value = null
  Object.assign(form, {
    customer_name: '',
    audit_type: '',
    audit_date: '',
    final_result: '',
    score: undefined,
    internal_contact: '',
    external_issue_list_path: '',
    audit_report_path: '',
    summary: '',
  })
  showFormDialog.value = true
}

function handleEdit(audit: CustomerAudit) {
  editingAudit.value = audit
  Object.assign(form, {
    customer_name: audit.customer_name,
    audit_type: audit.audit_type,
    audit_date: audit.audit_date,
    final_result: audit.final_result,
    score: audit.score,
    internal_contact: audit.internal_contact || '',
    external_issue_list_path: audit.external_issue_list_path || '',
    audit_report_path: audit.audit_report_path || '',
    summary: audit.summary || '',
  })
  showFormDialog.value = true
}

async function handleSubmit() {
  if (!formRef.value) return

  await formRef.value.validate(async (valid) => {
    if (!valid) return

    submitting.value = true
    try {
      if (editingAudit.value) {
        await updateCustomerAudit(editingAudit.value.id, form)
        ElMessage.success('更新成功')
      } else {
        await createCustomerAudit(form)
        ElMessage.success('创建成功')
      }

      showFormDialog.value = false
      await loadAudits()
    } catch (error: any) {
      ElMessage.error(error.message || '操作失败')
    } finally {
      submitting.value = false
    }
  })
}

async function handleDelete(id: number) {
  try {
    await ElMessageBox.confirm('确定要删除这条记录吗？', '确认删除', {
      type: 'warning',
    })

    await deleteCustomerAudit(id)
    ElMessage.success('删除成功')
    await loadAudits()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败')
    }
  }
}

function handleCreateIssueTask(audit: CustomerAudit) {
  currentAudit.value = audit
  Object.assign(issueTaskForm, {
    customer_audit_id: audit.id,
    issue_description: '',
    responsible_dept: '',
    assigned_to: undefined,
    deadline: '',
    priority: 'medium',
    response_mode: 'brief',
  })
  showIssueTaskDialog.value = true
}

async function submitIssueTask() {
  if (!issueTaskForm.issue_description || !issueTaskForm.responsible_dept || !issueTaskForm.deadline) {
    ElMessage.warning('请先补全问题描述、责任部门和整改期限')
    return
  }

  if (!issueTaskForm.assigned_to) {
    ElMessage.warning('请选择内部责任人')
    return
  }

  submitting.value = true
  try {
    await createCustomerAuditIssueTask(issueTaskForm)
    ElMessage.success('问题任务创建成功')
    showIssueTaskDialog.value = false
    await loadAudits()
  } catch (error: any) {
    ElMessage.error(error.message || '创建失败')
  } finally {
    submitting.value = false
  }
}

function handleView(audit: CustomerAudit) {
  void router.push({
    name: 'CustomerAuditList',
    query: {
      ...route.query,
      focusId: String(audit.id),
      openIssueTasks: 'true',
    },
  })
}

function openIssueTaskInNc(task: CustomerAuditIssueTaskResponse) {
  if (!currentAudit.value) {
    return
  }

  void router.push({
    name: 'AuditNCList',
    query: {
      focusId: String(task.id),
      sourceParentId: String(currentAudit.value.id),
      sourceCategoryKey: issueTaskProblemCategoryKey,
    },
  })
}

function getAuditTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    system: '体系审核',
    process: '过程审核',
    product: '产品审核',
    qualification: '资质审核',
    potential_supplier: '潜在供应商审核',
  }
  return labels[type] || type
}

function getResultLabel(result: string): string {
  const labels: Record<string, string> = {
    passed: '通过',
    conditional_passed: '有条件通过',
    failed: '未通过',
    pending: '待定',
  }
  return labels[result] || result
}

function getResultType(result: string) {
  const types: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
    passed: 'success',
    conditional_passed: 'warning',
    failed: 'danger',
    pending: 'info',
  }
  return types[result] || 'info'
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    completed: '已完成',
    issue_open: '问题待关闭',
    issue_closed: '问题已关闭',
  }
  return labels[status] || status
}

function getStatusType(status: string) {
  const types: Record<string, 'success' | 'warning' | 'info'> = {
    completed: 'success',
    issue_open: 'warning',
    issue_closed: 'success',
  }
  return types[status] || 'info'
}

function getIssueTaskStatusLabel(status: string) {
  const labels: Record<string, string> = {
    open: '待分派',
    assigned: '已分派',
    submitted: '待审核',
    verified: '待关闭',
    rejected: '已驳回',
    closed: '已关闭',
    pending: '待处理',
    responded: '处理中',
  }
  return labels[status] || status
}

function getIssueTaskStatusType(status: string) {
  const types: Record<string, 'info' | 'warning' | 'primary' | 'success' | 'danger'> = {
    open: 'warning',
    assigned: 'primary',
    submitted: 'info',
    verified: 'warning',
    rejected: 'danger',
    closed: 'success',
    pending: 'warning',
    responded: 'primary',
  }
  return types[status] || 'info'
}

function getRowClassName({ row }: { row: CustomerAudit }) {
  return focusedAuditId.value === row.id ? 'focused-row' : ''
}

function getIssueTaskRowClassName({ row }: { row: CustomerAuditIssueTaskResponse }) {
  const focusedTaskId = dialogFocusedIssueTaskId.value || focusedIssueTaskId.value
  return focusedTaskId === row.id ? 'focused-row' : ''
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('zh-CN')
}

onMounted(async () => {
  await problemManagementStore.loadCatalog()
  await loadInternalUsers()
  await loadAudits()
})

watch(
  () => [route.query.focusId, route.query.openIssueTasks, route.query.issueTaskId],
  async (current, previous) => {
    if (JSON.stringify(current) === JSON.stringify(previous)) {
      return
    }

    await loadAudits()
  }
)

watch(showIssueTaskListDialog, (visible) => {
  if (!visible) {
    dialogFocusedIssueTaskId.value = null
  }
})
</script>

<style scoped>
.customer-audit-list {
  min-height: 100vh;
  background-color: #f5f7fa;
}

:deep(.focused-row td) {
  background-color: #ecf5ff !important;
}
</style>
