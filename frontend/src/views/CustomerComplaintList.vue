<template>
  <div class="customer-complaint-list p-4 md:p-6">
    <div class="page-header">
      <h1 class="page-title">客户投诉</h1>
    </div>

    <div class="page-toolbar">
      <el-button type="primary" @click="showCreateDialog = true">
        <el-icon><Plus /></el-icon>
        <span>创建客诉单</span>
      </el-button>

      <div class="page-toolbar__group">
        <div v-if="selectedCount > 0" class="selection-summary">
          已选择 {{ selectedCount }} 条
        </div>

        <el-tooltip :disabled="batchLaunchTooltipDisabled" :content="batchLaunchHint" placement="top">
          <div class="table-toolbar__action">
            <el-button
              type="primary"
              plain
              :disabled="!canBatchLaunchEightD"
              :loading="batchLaunchingEightD"
              @click="handleBatch8D"
            >
              批量发起8D
            </el-button>
          </div>
        </el-tooltip>
      </div>
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form :model="queryParams" class="filter-shell">
        <div class="filter-row">
          <el-form-item class="filter-item filter-item--compact" style="width: 214px">
            <div class="filter-field">
              <span class="filter-field__label">客诉类型</span>
              <el-select
                v-model="queryParams.complaint_type"
                placeholder="全部"
                clearable
                class="filter-control filter-control--select-sm"
              >
                <el-option
                  v-for="option in complaintTypeOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </div>
          </el-form-item>

          <el-form-item class="filter-item filter-item--customer" style="width: 330px">
            <div class="filter-field">
              <span class="filter-field__label">客户</span>
              <el-select
                v-model="queryParams.customer_id"
                filterable
                clearable
                placeholder="全部"
                class="filter-control filter-control--select-lg"
              >
                <el-option
                  v-for="item in customerOptions"
                  :key="item.id"
                  :label="`${item.name} (${item.code})`"
                  :value="item.id"
                />
              </el-select>
            </div>
          </el-form-item>

          <el-form-item class="filter-item filter-item--compact" style="width: 200px">
            <div class="filter-field">
              <span class="filter-field__label">状态</span>
              <el-select
                v-model="queryParams.status"
                placeholder="全部"
                clearable
                class="filter-control filter-control--select-md"
              >
                <el-option
                  v-for="option in statusOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </div>
          </el-form-item>

          <div class="filter-actions">
            <el-button type="primary" @click="handleSearch">查询</el-button>
            <el-button @click="handleReset">重置</el-button>
            <el-button link type="primary" class="filter-expand" @click="showAdvancedFilters = !showAdvancedFilters">
              {{ showAdvancedFilters ? '收起' : '展开' }}
            </el-button>
          </div>
        </div>

        <div v-if="showAdvancedFilters" class="filter-row filter-row--advanced">
          <el-form-item class="filter-item filter-item--product" style="width: 280px">
            <div class="filter-field">
              <span class="filter-field__label">产品类型</span>
              <el-input
                v-model="queryParams.product_type"
                placeholder="输入"
                clearable
                class="filter-control filter-control--input-md"
              />
            </div>
          </el-form-item>

          <el-form-item class="filter-item filter-item--range" style="width: 480px">
            <div class="filter-field">
              <span class="filter-field__label">日期范围</span>
              <el-date-picker
                v-model="dateRange"
                type="daterange"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                value-format="YYYY-MM-DD"
                class="filter-control filter-control--range"
              />
            </div>
          </el-form-item>
        </div>
      </el-form>
    </el-card>

    <el-card shadow="never" class="table-card">
      <el-table
        v-loading="loading"
        :data="complaintList"
        stripe
        class="complaint-table"
        row-key="id"
        :row-class-name="getRowClassName"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="48" fixed="left" />
        <el-table-column prop="complaint_number" label="客诉编号" width="160" fixed />
        <el-table-column prop="complaint_type" label="类型" width="120">
          <template #default="{ row }">
            <el-tag :type="row.complaint_type === ComplaintType.ZERO_KM ? 'danger' : 'warning'">
              {{ getComplaintTypeLabel(row.complaint_type) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="客户" min-width="220">
          <template #default="{ row }">
            <div class="font-medium">{{ row.customer_name || row.customer_code }}</div>
            <div class="text-xs text-gray-500">{{ row.customer_code }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="end_customer_name" label="终端客户" min-width="160">
          <template #default="{ row }">{{ row.end_customer_name || '-' }}</template>
        </el-table-column>
        <el-table-column prop="product_type" label="产品类型" width="140" />
        <el-table-column prop="defect_description" label="缺陷描述" min-width="220" show-overflow-tooltip />
        <el-table-column label="退件" width="90">
          <template #default="{ row }">
            <el-tag :type="row.is_return_required ? 'warning' : 'info'">
              {{ row.is_return_required ? '涉及' : '否' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="实物解析" width="120">
          <template #default="{ row }">
            <el-tag
              v-if="row.requires_physical_analysis"
              :type="getCustomerComplaintPhysicalAnalysisStatusType(row.physical_analysis_status)"
            >
              {{ getCustomerComplaintPhysicalAnalysisStatusLabel(row.physical_analysis_status) }}
            </el-tag>
            <el-tag v-else type="success">免解析</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="实物处理" width="110">
          <template #default="{ row }">
            <span v-if="row.requires_physical_analysis" class="text-gray-400">-</span>
            <el-tag v-else :type="getCustomerComplaintDispositionStatusType(row.physical_disposition_status)">
              {{ getCustomerComplaintDispositionStatusLabel(row.physical_disposition_status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="8D状态" width="140">
          <template #default="{ row }">
            <el-tag v-if="row.eight_d_report_id" type="primary">
              {{ getEightDDisplayStatus(row) }}
            </el-tag>
            <span v-else class="text-gray-400">未发起</span>
          </template>
        </el-table-column>
        <el-table-column prop="severity_level" label="严重度" width="100" />
        <el-table-column prop="status" label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="getCustomerComplaintStatusType(row.status)">
              {{ getCustomerComplaintStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="170" />
        <el-table-column label="操作" width="320" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleView(row)">查看</el-button>
            <el-button
              v-if="canHandleCustomerComplaintDisposition(row)"
              link
              type="primary"
              size="small"
              @click="handleDisposition(row)"
            >
              实物处理
            </el-button>
            <el-button
              v-if="canHandleCustomerComplaintAnalysis(row)"
              link
              type="primary"
              size="small"
              @click="handleAnalysis(row)"
            >
              实物解析
            </el-button>
            <el-button
              v-if="canOpenCustomerComplaintEightD(row)"
              link
              type="primary"
              size="small"
              :loading="launchingEightDId === row.id"
              @click="handle8D(row)"
            >
              {{ getEightDActionLabel(row) }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="table-pagination">
        <el-pagination
          v-model:current-page="queryParams.page"
          v-model:page-size="queryParams.page_size"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="loadComplaints"
          @current-change="loadComplaints"
        />
      </div>
    </el-card>

    <el-dialog
      v-model="showCreateDialog"
      title="创建客诉单"
      width="90%"
      :close-on-click-modal="false"
      class="max-w-2xl"
    >
      <CustomerComplaintForm @success="handleCreateSuccess" @cancel="showCreateDialog = false" />
    </el-dialog>

    <CustomerComplaintDispositionDialog
      v-model="showDispositionDialog"
      :complaint="selectedComplaint"
      @success="handleDispositionSuccess"
    />

    <CustomerComplaintAnalysisDialog
      v-model="showAnalysisDialog"
      :complaint="selectedComplaint"
      @success="handleAnalysisSuccess"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import {
  getCustomerComplaint,
  getCustomerComplaintCustomerOptions,
  getCustomerComplaints,
  initBatchCustomerComplaintEightD,
  initCustomerComplaintEightD,
} from '@/api/customer-quality'
import CustomerComplaintAnalysisDialog from '@/components/CustomerComplaintAnalysisDialog.vue'
import CustomerComplaintDispositionDialog from '@/components/CustomerComplaintDispositionDialog.vue'
import CustomerComplaintForm from '@/components/CustomerComplaintForm.vue'
import { useProblemManagementStore } from '@/stores/problemManagement'
import type {
  CustomerComplaint,
  CustomerComplaintCustomerOption,
  CustomerComplaintListQuery,
} from '@/types/customer-quality'
import { ComplaintType } from '@/types/customer-quality'
import {
  buildCustomerComplaintTypeOptions,
  getCustomerComplaintTypeLabel as resolveCustomerComplaintTypeLabel,
} from '@/utils/problemManagement'
import {
  buildCustomerComplaintStatusOptions,
  canBatchLaunchCustomerComplaintEightD,
  canHandleCustomerComplaintAnalysis,
  canHandleCustomerComplaintDisposition,
  canOpenCustomerComplaintEightD,
  getCustomerComplaintBatchLaunchHint,
  getCustomerComplaintEightDActionLabel,
  getCustomerComplaintDispositionStatusLabel,
  getCustomerComplaintDispositionStatusType,
  getCustomerComplaintPhysicalAnalysisStatusLabel,
  getCustomerComplaintPhysicalAnalysisStatusType,
  getCustomerComplaintStatusLabel,
  getCustomerComplaintStatusType,
} from '@/utils/customerComplaint'
import { getEightDStatusLabel } from '@/utils/customerEightD'

const route = useRoute()
const router = useRouter()
const problemManagementStore = useProblemManagementStore()

const loading = ref(false)
const complaintList = ref<CustomerComplaint[]>([])
const customerOptions = ref<CustomerComplaintCustomerOption[]>([])
const total = ref(0)
const showCreateDialog = ref(false)
const showDispositionDialog = ref(false)
const showAnalysisDialog = ref(false)
const selectedComplaint = ref<CustomerComplaint | null>(null)
const selectedComplaints = ref<CustomerComplaint[]>([])
const dateRange = ref<[string, string] | null>(null)
const showAdvancedFilters = ref(false)
const launchingEightDId = ref<number | null>(null)
const batchLaunchingEightD = ref(false)

const queryParams = reactive<CustomerComplaintListQuery>({
  page: 1,
  page_size: 20,
  complaint_type: undefined,
  customer_id: undefined,
  product_type: undefined,
  status: undefined,
  start_date: undefined,
  end_date: undefined,
})

const complaintTypeOptions = computed(() =>
  buildCustomerComplaintTypeOptions(problemManagementStore.getCategory)
)
const canBatchLaunchEightD = computed(() =>
  canBatchLaunchCustomerComplaintEightD(selectedComplaints.value)
)
const selectedCount = computed(() => selectedComplaints.value.length)
const focusedComplaintId = computed(() => parseFocusId(route.query.focusId))
const batchLaunchHint = computed(() =>
  getCustomerComplaintBatchLaunchHint(selectedComplaints.value)
)
const batchLaunchTooltipDisabled = computed(() =>
  selectedCount.value === 0 || canBatchLaunchEightD.value || !batchLaunchHint.value
)

const statusOptions = buildCustomerComplaintStatusOptions()

function getComplaintTypeLabel(complaintType: ComplaintType): string {
  return resolveCustomerComplaintTypeLabel(complaintType, problemManagementStore.getCategory)
}

function getEightDActionLabel(row: CustomerComplaint): string {
  return getCustomerComplaintEightDActionLabel(row)
}

function getEightDDisplayStatus(row: CustomerComplaint): string {
  return getEightDStatusLabel(row.eight_d_status)
}

function parseFocusId(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) {
    return null
  }

  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

async function loadCustomerOptions() {
  try {
    customerOptions.value = await getCustomerComplaintCustomerOptions()
  } catch (error: any) {
    ElMessage.error(error.message || '加载客户清单失败')
  }
}

async function loadComplaints() {
  loading.value = true

  try {
    if (dateRange.value) {
      queryParams.start_date = dateRange.value[0]
      queryParams.end_date = dateRange.value[1]
    } else {
      queryParams.start_date = undefined
      queryParams.end_date = undefined
    }

    const response = await getCustomerComplaints(queryParams)
    complaintList.value = response.items
    selectedComplaints.value = []
    total.value = response.total
    await loadFocusedComplaint()
  } catch (error: any) {
    ElMessage.error(error.message || '加载客诉列表失败')
    console.error('load complaints error:', error)
  } finally {
    loading.value = false
  }
}

async function loadFocusedComplaint() {
  if (
    !focusedComplaintId.value ||
    complaintList.value.some((item) => item.id === focusedComplaintId.value)
  ) {
    return
  }

  try {
    const focusedComplaint = await getCustomerComplaint(focusedComplaintId.value)
    complaintList.value = [focusedComplaint, ...complaintList.value]
  } catch (error) {
    console.error('Failed to load focused complaint:', error)
  }
}

function handleSearch() {
  queryParams.page = 1
  void loadComplaints()
}

function handleReset() {
  queryParams.page = 1
  queryParams.page_size = 20
  queryParams.complaint_type = undefined
  queryParams.customer_id = undefined
  queryParams.product_type = undefined
  queryParams.status = undefined
  dateRange.value = null
  void loadComplaints()
}

function handleView(row: CustomerComplaint) {
  router.push({
    name: 'CustomerComplaintDetail',
    params: { id: row.id },
    query: {
      sourceRouteName: 'CustomerComplaintList',
      sourceFocusId: String(row.id),
    },
  })
}

function handleDisposition(row: CustomerComplaint) {
  selectedComplaint.value = row
  showDispositionDialog.value = true
}

function handleAnalysis(row: CustomerComplaint) {
  selectedComplaint.value = row
  showAnalysisDialog.value = true
}

function handleSelectionChange(selection: CustomerComplaint[]) {
  selectedComplaints.value = selection
}

async function handle8D(row: CustomerComplaint) {
  if (row.eight_d_report_id) {
    router.push({
      name: 'EightDCustomerForm',
      params: { id: row.id },
      query: {
        sourceRouteName: 'CustomerComplaintList',
        sourceFocusId: String(row.id),
      },
    })
    return
  }

  try {
    launchingEightDId.value = row.id
    await initCustomerComplaintEightD(row.id)
    ElMessage.success(`客诉 ${row.complaint_number} 已发起8D`)
    await loadComplaints()
    router.push({
      name: 'EightDCustomerForm',
      params: { id: row.id },
      query: {
        sourceRouteName: 'CustomerComplaintList',
        sourceFocusId: String(row.id),
      },
    })
  } catch (error: any) {
    ElMessage.error(error.message || '发起 8D 失败')
  } finally {
    launchingEightDId.value = null
  }
}

async function handleBatch8D() {
  const complaints = selectedComplaints.value
  const launchHint = getCustomerComplaintBatchLaunchHint(complaints)
  if (launchHint) {
    ElMessage.warning(launchHint)
    return
  }

  const primaryComplaint = complaints[0]
  if (!primaryComplaint) {
    ElMessage.warning('请先选择客诉记录')
    return
  }

  try {
    batchLaunchingEightD.value = true
    const report = await initBatchCustomerComplaintEightD({
      complaint_ids: complaints.map((item) => item.id),
      primary_complaint_id: primaryComplaint.id,
    })
    ElMessage.success(`已按 ${complaints.length} 条客诉发起同一张8D`)
    await loadComplaints()
    router.push({
      name: 'EightDCustomerForm',
      params: { id: report.complaint_id || primaryComplaint.id },
      query: {
        sourceRouteName: 'CustomerComplaintList',
        sourceFocusId: String(report.complaint_id || primaryComplaint.id),
      },
    })
  } catch (error: any) {
    ElMessage.error(error.message || '批量发起 8D 失败')
  } finally {
    batchLaunchingEightD.value = false
  }
}

function handleCreateSuccess() {
  showCreateDialog.value = false
  ElMessage.success('客诉单创建成功')
  void loadComplaints()
}

function handleDispositionSuccess() {
  selectedComplaint.value = null
  void loadComplaints()
}

function handleAnalysisSuccess() {
  selectedComplaint.value = null
  void loadComplaints()
}

function getRowClassName({ row }: { row: CustomerComplaint }) {
  return focusedComplaintId.value === row.id ? 'focused-row' : ''
}

onMounted(() => {
  void problemManagementStore.loadCatalog()
  void loadCustomerOptions()
  void loadComplaints()
})

watch(
  () => route.query.focusId,
  async (current, previous) => {
    if (current === previous) {
      return
    }

    await loadComplaints()
  }
)
</script>

<style scoped>
.customer-complaint-list {
  min-height: 100vh;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  margin-bottom: 12px;
}

.page-title {
  margin: 0;
  color: #0f172a;
  font-size: 30px;
  font-weight: 700;
  line-height: 1.1;
}

.page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.page-toolbar__group {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.filter-card,
.table-card {
  border: 1px solid #e2e8f0;
  border-radius: 16px;
}

.filter-card {
  margin-bottom: 16px;
}

.filter-card :deep(.el-card__body) {
  overflow-x: hidden;
}

.filter-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.filter-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  overflow-x: hidden;
}

.filter-row--advanced {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid #e2e8f0;
  overflow-x: hidden;
}

.filter-item {
  margin-bottom: 0;
  min-width: 0;
  flex: 0 0 auto;
}

.filter-item--compact {
  width: 214px;
}

.filter-item--customer {
  width: 330px;
}

.filter-item--product {
  width: 260px;
}

.filter-item--range {
  width: 456px;
}

.filter-field {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 32px;
}

.filter-field__label {
  flex: 0 0 auto;
  color: #334155;
  font-size: 12px;
  font-weight: 600;
  line-height: 32px;
  white-space: nowrap;
}

.filter-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  white-space: nowrap;
  min-height: 32px;
  margin-left: auto;
  flex: 0 0 auto;
}

.filter-expand {
  font-size: 12px;
  padding-inline: 4px;
}

.filter-item :deep(.el-form-item__content) {
  width: 100%;
  margin-left: 0 !important;
}

.filter-item :deep(.el-input__wrapper),
.filter-item :deep(.el-select__wrapper) {
  min-height: 32px;
  padding-inline: 8px;
  font-size: 12px;
}

.filter-control,
.filter-control--select-sm,
.filter-control--select-md,
.filter-control--select-lg,
.filter-control--input-md,
.filter-control--range {
  width: 100%;
  min-width: 0;
}

.filter-item :deep(.el-select),
.filter-item :deep(.el-input),
.filter-item :deep(.el-date-editor) {
  width: 100% !important;
  min-width: 0;
}

.filter-item :deep(.el-range-editor.el-input__wrapper) {
  padding-inline: 10px;
}

.filter-item :deep(.el-range-input) {
  font-size: 12px;
}

.filter-item :deep(.el-select__selected-item),
.filter-item :deep(.el-input__inner) {
  font-size: 12px;
}

.selection-summary {
  color: #475569;
  font-size: 14px;
  font-weight: 500;
}

.complaint-table :deep(.el-table__header th) {
  color: #334155;
  font-weight: 700;
  background: #f8fafc;
}

.table-pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

:deep(.focused-row td) {
  background-color: #ecf5ff !important;
}

@media (max-width: 768px) {
  .page-header,
  .page-toolbar,
  .table-pagination {
    flex-direction: column;
    align-items: stretch;
  }

  .page-title {
    font-size: 24px;
  }

  .filter-row,
  .filter-row--advanced {
    display: grid;
    grid-template-columns: 1fr;
  }

  .filter-field {
    display: grid;
    grid-template-columns: 1fr;
    row-gap: 8px;
  }

  .filter-field__label {
    line-height: 1.3;
  }

  .filter-item--compact,
  .filter-item--customer,
  .filter-item--product,
  .filter-item--range {
    width: auto;
  }

  .filter-control--select-sm,
  .filter-control--select-md,
  .filter-control--select-lg,
  .filter-control--input-md,
  .filter-control--range {
    width: 100%;
  }

  .filter-actions {
    justify-content: stretch;
    margin-left: 0;
  }

  .page-toolbar__group {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
  }

  .table-toolbar__action :deep(.el-button),
  .filter-actions :deep(.el-button),
  .page-toolbar :deep(.el-button) {
    width: 100%;
  }

  :deep(.el-table) {
    font-size: 12px;
  }
}

@media (max-width: 1120px) {
  .filter-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .filter-row--advanced {
    display: grid;
    grid-template-columns: 1fr;
  }

  .filter-actions {
    grid-column: span 2;
    justify-content: flex-end;
    margin-left: 0;
  }
}
</style>
