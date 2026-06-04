<template>
  <div class="new-product-defect-list p-4 md:p-6">
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold">新品不良登记</h1>
      <el-button type="primary" @click="handleCreate">登记不良</el-button>
    </div>

    <el-card shadow="never" class="mb-4">
      <el-form :model="queryForm" inline>
        <el-form-item label="来源">
          <el-select v-model="queryForm.source_type" clearable placeholder="全部" class="w-40">
            <el-option label="试产不良" value="trial_defect" />
            <el-option label="新品客诉" value="customer_complaint" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="queryForm.status" clearable placeholder="全部" class="w-40">
            <el-option label="已登记" value="registered" />
            <el-option label="已发起" value="promoted" />
            <el-option label="已关闭" value="closed" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词">
          <el-input v-model="queryForm.keyword" clearable placeholder="编号/客户/物料" class="w-56" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadDefects">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <el-table v-loading="loading" :data="defects" stripe>
        <el-table-column prop="defect_number" label="不良编号" width="150" />
        <el-table-column label="来源" width="110">
          <template #default="{ row }">
            <el-tag :type="row.source_type === 'customer_complaint' ? 'warning' : 'primary'">
              {{ getSourceTypeLabel(row.source_type) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="defect_date" label="日期" width="120" />
        <el-table-column prop="customer_name" label="客户" min-width="140">
          <template #default="{ row }">{{ row.customer_name || '-' }}</template>
        </el-table-column>
        <el-table-column prop="product_code" label="产品编码" width="130">
          <template #default="{ row }">{{ row.product_code || '-' }}</template>
        </el-table-column>
        <el-table-column prop="defect_type" label="不良类型" width="140" show-overflow-tooltip />
        <el-table-column prop="defect_description" label="不良描述" min-width="220" show-overflow-tooltip />
        <el-table-column label="问题单据" width="170">
          <template #default="{ row }">
            <el-button v-if="row.problem_number" link type="primary" @click="openProblemCenter(row)">
              {{ row.problem_number }}
            </el-button>
            <span v-else class="text-gray-400">-</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.status === 'promoted' ? 'success' : 'info'">
              {{ getStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="handleEdit(row)">编辑</el-button>
            <el-button link type="success" :disabled="Boolean(row.problem_report_id)" @click="handleLaunch(row)">
              发起跟进
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="mt-4 flex justify-end">
        <el-pagination
          v-model:current-page="queryForm.page"
          v-model:page-size="queryForm.page_size"
          :total="total"
          layout="total, prev, pager, next"
          @current-change="loadDefects"
        />
      </div>
    </el-card>

    <el-dialog
      v-model="showFormDialog"
      :title="editingDefect ? '编辑新品不良' : '登记新品不良'"
      width="90%"
      class="max-w-3xl"
      :close-on-click-modal="false"
    >
      <el-form :model="form" label-width="120px">
        <el-form-item label="来源" required>
          <el-radio-group v-model="form.source_type">
            <el-radio-button label="trial_defect">试产不良</el-radio-button>
            <el-radio-button label="customer_complaint">新品客诉</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="发生日期" required>
          <el-date-picker v-model="form.defect_date" type="date" value-format="YYYY-MM-DD" class="w-full" />
        </el-form-item>
        <el-form-item label="客诉编号" v-if="form.source_type === 'customer_complaint'">
          <el-input v-model="form.customer_complaint_number" />
        </el-form-item>
        <el-form-item label="客户">
          <el-input v-model="form.customer_name" />
        </el-form-item>
        <el-form-item label="产品编码">
          <el-input v-model="form.product_code" />
        </el-form-item>
        <el-form-item label="产品名称">
          <el-input v-model="form.product_name" />
        </el-form-item>
        <el-form-item label="不良类型" required>
          <el-input v-model="form.defect_type" />
        </el-form-item>
        <el-form-item label="不良数量">
          <el-input-number v-model="form.defect_qty" :min="1" class="w-full" />
        </el-form-item>
        <el-form-item label="责任部门">
          <el-input v-model="form.responsible_dept" />
        </el-form-item>
        <el-form-item label="不良描述" required>
          <el-input v-model="form.defect_description" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remarks" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showFormDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitDefect">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showLaunchDialog" title="发起问题跟进" width="90%" class="max-w-2xl">
      <el-form :model="launchForm" label-width="120px">
        <el-form-item label="问题分类">
          <el-radio-group v-model="launchForm.problem_category_key">
            <el-radio-button label="DQ0">试产不良</el-radio-button>
            <el-radio-button label="DQ1">新品客诉</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="回复形式">
          <el-radio-group v-model="launchForm.response_mode">
            <el-radio-button label="brief">问题简报</el-radio-button>
            <el-radio-button label="eight_d">8D报告</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="风险等级">
          <el-select v-model="launchForm.risk_level" class="w-full">
            <el-option label="低" value="low" />
            <el-option label="中" value="medium" />
            <el-option label="高" value="high" />
            <el-option label="严重" value="critical" />
          </el-select>
        </el-form-item>
        <el-form-item label="责任人">
          <el-select v-model="launchForm.assigned_to" clearable filterable class="w-full" :loading="loadingUsers">
            <el-option
              v-for="user in internalUsers"
              :key="user.id"
              :label="formatInternalUser(user)"
              :value="user.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="完成时限">
          <el-date-picker v-model="launchForm.due_at" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" class="w-full" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showLaunchDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitLaunch">发起</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import { newProductApi } from '@/api/new-product'
import { problemManagementApi } from '@/api/problem-management'
import type {
  NewProductDefect,
  NewProductDefectCreate,
  NewProductDefectSourceType,
  NewProductDefectStatus,
} from '@/types/new-product'
import type { InternalUserOption } from '@/types/problem-management'

const router = useRouter()

const loading = ref(false)
const submitting = ref(false)
const loadingUsers = ref(false)
const defects = ref<NewProductDefect[]>([])
const total = ref(0)
const showFormDialog = ref(false)
const showLaunchDialog = ref(false)
const editingDefect = ref<NewProductDefect | null>(null)
const launchingDefect = ref<NewProductDefect | null>(null)
const internalUsers = ref<InternalUserOption[]>([])

const queryForm = reactive({
  source_type: undefined as NewProductDefectSourceType | undefined,
  status: undefined as NewProductDefectStatus | undefined,
  keyword: '',
  page: 1,
  page_size: 20,
})

const form = reactive<NewProductDefectCreate>({
  source_type: 'trial_defect',
  defect_date: new Date().toISOString().slice(0, 10),
  customer_name: '',
  customer_complaint_number: '',
  product_code: '',
  product_name: '',
  defect_type: '',
  defect_description: '',
  defect_qty: undefined,
  responsible_dept: '',
  remarks: '',
})

const launchForm = reactive({
  problem_category_key: 'DQ0' as 'DQ0' | 'DQ1',
  response_mode: 'brief' as 'brief' | 'eight_d',
  risk_level: 'medium' as 'low' | 'medium' | 'high' | 'critical',
  assigned_to: undefined as number | undefined,
  due_at: undefined as string | undefined,
})

function getSourceTypeLabel(value: NewProductDefectSourceType) {
  return value === 'customer_complaint' ? '新品客诉' : '试产不良'
}

function getStatusLabel(value: NewProductDefectStatus) {
  const labels: Record<NewProductDefectStatus, string> = {
    registered: '已登记',
    promoted: '已发起',
    closed: '已关闭',
  }
  return labels[value] || value
}

function formatInternalUser(user: InternalUserOption) {
  const name = user.full_name || user.username
  return user.department ? `${name} / ${user.department}` : name
}

async function loadUsers() {
  if (internalUsers.value.length) return
  loadingUsers.value = true
  try {
    internalUsers.value = await problemManagementApi.getInternalUsers()
  } finally {
    loadingUsers.value = false
  }
}

async function loadDefects() {
  loading.value = true
  try {
    const response = await newProductApi.getNewProductDefects(queryForm)
    defects.value = response.items
    total.value = response.total
  } catch (error: any) {
    ElMessage.error(error.message || '加载新品不良失败')
  } finally {
    loading.value = false
  }
}

function handleReset() {
  queryForm.source_type = undefined
  queryForm.status = undefined
  queryForm.keyword = ''
  queryForm.page = 1
  void loadDefects()
}

function resetForm() {
  Object.assign(form, {
    source_type: 'trial_defect',
    defect_date: new Date().toISOString().slice(0, 10),
    customer_name: '',
    customer_complaint_number: '',
    product_code: '',
    product_name: '',
    defect_type: '',
    defect_description: '',
    defect_qty: undefined,
    responsible_dept: '',
    remarks: '',
  })
}

function handleCreate() {
  editingDefect.value = null
  resetForm()
  showFormDialog.value = true
}

function handleEdit(row: NewProductDefect) {
  editingDefect.value = row
  Object.assign(form, {
    source_type: row.source_type,
    defect_date: row.defect_date,
    customer_name: row.customer_name || '',
    customer_complaint_number: row.customer_complaint_number || '',
    product_code: row.product_code || '',
    product_name: row.product_name || '',
    defect_type: row.defect_type,
    defect_description: row.defect_description,
    defect_qty: row.defect_qty || undefined,
    responsible_dept: row.responsible_dept || '',
    remarks: row.remarks || '',
  })
  showFormDialog.value = true
}

async function submitDefect() {
  if (!form.defect_type || !form.defect_description) {
    ElMessage.warning('请补全不良类型和描述')
    return
  }
  submitting.value = true
  try {
    if (editingDefect.value) {
      await newProductApi.updateNewProductDefect(editingDefect.value.id, form)
    } else {
      await newProductApi.createNewProductDefect(form)
    }
    ElMessage.success('保存成功')
    showFormDialog.value = false
    await loadDefects()
  } catch (error: any) {
    ElMessage.error(error.message || '保存失败')
  } finally {
    submitting.value = false
  }
}

function handleLaunch(row: NewProductDefect) {
  launchingDefect.value = row
  launchForm.problem_category_key = row.source_type === 'customer_complaint' ? 'DQ1' : 'DQ0'
  launchForm.response_mode = 'brief'
  launchForm.risk_level = 'medium'
  launchForm.assigned_to = undefined
  launchForm.due_at = undefined
  showLaunchDialog.value = true
  void loadUsers()
}

async function submitLaunch() {
  if (!launchingDefect.value) return
  submitting.value = true
  try {
    await newProductApi.createNewProductDefectProblemReport(launchingDefect.value.id, launchForm)
    ElMessage.success('已发起问题跟进')
    showLaunchDialog.value = false
    await loadDefects()
  } catch (error: any) {
    ElMessage.error(error.message || '发起失败')
  } finally {
    submitting.value = false
  }
}

function openProblemCenter(row: NewProductDefect) {
  router.push({
    name: 'ProblemIssueCenter',
    query: {
      module_key: 'new_product_quality',
      keyword: row.problem_number || row.defect_number,
    },
  })
}

onMounted(() => {
  void loadDefects()
})
</script>
