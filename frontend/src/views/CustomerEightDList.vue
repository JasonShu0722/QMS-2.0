<template>
  <div class="customer-follow-up-list p-4 md:p-6">
    <div class="page-header">
      <h1 class="page-title">客诉问题跟进</h1>
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form :model="queryParams" class="filter-shell">
        <div class="filter-row">
          <el-form-item class="filter-item filter-item--report" style="width: 230px">
            <div class="filter-field">
              <span class="filter-field__label">跟进编号</span>
              <el-input
                v-model="queryParams.report_number"
                placeholder="ZXQ / ZX8D"
                clearable
                class="filter-control"
              />
            </div>
          </el-form-item>

          <el-form-item class="filter-item filter-item--compact" style="width: 190px">
            <div class="filter-field">
              <span class="filter-field__label">客诉类型</span>
              <el-select v-model="queryParams.complaint_type" placeholder="全部" clearable class="filter-control">
                <el-option
                  v-for="option in complaintTypeOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </div>
          </el-form-item>

          <el-form-item class="filter-item filter-item--compact" style="width: 190px">
            <div class="filter-field">
              <span class="filter-field__label">回复形式</span>
              <el-select v-model="queryParams.response_mode" placeholder="全部" clearable class="filter-control">
                <el-option
                  v-for="option in responseModeOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </div>
          </el-form-item>

          <el-form-item class="filter-item filter-item--customer" style="width: 320px">
            <div class="filter-field">
              <span class="filter-field__label">客户</span>
              <el-select
                v-model="queryParams.customer_id"
                filterable
                clearable
                placeholder="全部"
                class="filter-control"
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

          <el-form-item class="filter-item filter-item--compact" style="width: 190px">
            <div class="filter-field">
              <span class="filter-field__label">状态</span>
              <el-select v-model="queryParams.status" placeholder="全部" clearable class="filter-control">
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
              <el-input v-model="queryParams.product_type" placeholder="输入" clearable class="filter-control" />
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
        :data="reportList"
        :row-key="getRowKey"
        stripe
        class="report-table"
        :row-class-name="getRowClassName"
      >
        <el-table-column label="跟进编号" min-width="190" fixed>
          <template #default="{ row }">
            <el-button link type="primary" class="report-link" @click="openFollowUp(row)">
              {{ row.report_number }}
            </el-button>
            <div v-if="row.response_mode === 'eight_d' && row.problem_number" class="sub-number">
              {{ row.problem_number }}
            </div>
          </template>
        </el-table-column>

        <el-table-column label="来源客诉" min-width="150">
          <template #default="{ row }">
            <el-button link type="primary" class="report-link" @click="openComplaint(row)">
              {{ row.primary_complaint_number || '-' }}
            </el-button>
          </template>
        </el-table-column>

        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-tag :type="row.complaint_type === ComplaintType.ZERO_KM ? 'danger' : 'warning'">
              {{ getEightDComplaintTypeLabel(row.complaint_type) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="客户" min-width="220">
          <template #default="{ row }">
            <div class="font-medium">{{ row.customer_name || row.customer_code || '-' }}</div>
            <div class="text-xs text-gray-500">{{ row.customer_code || '-' }}</div>
          </template>
        </el-table-column>

        <el-table-column prop="end_customer_name" label="终端客户" min-width="160">
          <template #default="{ row }">{{ row.end_customer_name || '-' }}</template>
        </el-table-column>

        <el-table-column prop="product_type" label="产品类型" width="140">
          <template #default="{ row }">{{ row.product_type || '-' }}</template>
        </el-table-column>

        <el-table-column label="关联客诉" width="100" align="center">
          <template #default="{ row }">
            <el-tag type="info">{{ row.related_complaint_count }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="回复形式" width="100">
          <template #default="{ row }">
            <el-tag :type="row.response_mode === 'eight_d' ? 'primary' : 'info'">
              {{ getResponseModeLabel(row.response_mode) }}
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

        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <el-tag :type="getStatusTagType(row)">
              {{ getFollowUpStatusLabel(row) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="更新时间" width="170">
          <template #default="{ row }">
            {{ formatDateTime(row.updated_at) }}
          </template>
        </el-table-column>

        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openFollowUp(row)">
              {{ row.response_mode === 'eight_d' ? '进入8D' : '查看问题单' }}
            </el-button>
            <el-button link type="primary" size="small" @click="openComplaint(row)">查看客诉</el-button>
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
          @size-change="loadReports"
          @current-change="loadReports"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import { getCustomerComplaintCustomerOptions, getCustomerEightDReports } from '@/api/customer-quality'
import {
  ComplaintType,
  type CustomerComplaintCustomerOption,
  type CustomerEightDListItem,
  type CustomerEightDListQuery,
  type EightDStatus,
} from '@/types/customer-quality'
import {
  buildProblemIssueResponseModeOptions,
  getProblemIssueResponseModeLabel,
  getProblemIssueRiskLevelLabel,
  getProblemIssueRiskLevelType,
  getUnifiedProblemStatusLabel,
  getUnifiedProblemStatusType,
} from '@/utils/problemIssueSummary'
import { buildCustomerComplaintTypeOptions } from '@/utils/problemManagement'
import { getEightDComplaintTypeLabel, getEightDStatusLabel } from '@/utils/customerEightD'
import { useProblemManagementStore } from '@/stores/problemManagement'

const route = useRoute()
const router = useRouter()
const problemManagementStore = useProblemManagementStore()

const loading = ref(false)
const reportList = ref<CustomerEightDListItem[]>([])
const customerOptions = ref<CustomerComplaintCustomerOption[]>([])
const total = ref(0)
const dateRange = ref<[string, string] | null>(null)
const showAdvancedFilters = ref(false)

const queryParams = reactive<CustomerEightDListQuery>({
  page: 1,
  page_size: 20,
  report_number: undefined,
  complaint_type: undefined,
  customer_id: undefined,
  product_type: undefined,
  status: undefined,
  response_mode: undefined,
  start_date: undefined,
  end_date: undefined,
})

const complaintTypeOptions = computed(() =>
  buildCustomerComplaintTypeOptions(problemManagementStore.getCategory)
)
const responseModeOptions = buildProblemIssueResponseModeOptions()

const statusOptions = [
  { value: 'open', label: '待处理' },
  { value: 'assigned', label: '已分派' },
  { value: 'responding', label: '处理中' },
  { value: 'pending_review', label: '待审核' },
  { value: 'verifying', label: '待验证' },
  { value: 'd4_d7_in_progress', label: 'D4-D7进行中' },
  { value: 'd4_d7_completed', label: 'D4-D7完成' },
  { value: 'd8_in_progress', label: 'D8进行中' },
  { value: 'in_review', label: '8D审核中' },
  { value: 'approved', label: '已批准' },
  { value: 'rejected', label: '已驳回' },
  { value: 'closed', label: '已关闭' },
]

const focusedReportId = computed(() => {
  const raw = Array.isArray(route.query.focusId) ? route.query.focusId[0] : route.query.focusId
  const parsed = raw ? Number(raw) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
})

const eightDStatusValues = new Set([
  'draft',
  'd0_d3_completed',
  'd4_d7_in_progress',
  'd4_d7_completed',
  'd8_in_progress',
  'in_review',
  'approved',
  'rejected',
  'closed',
])

function isEightDRow(row: CustomerEightDListItem) {
  return row.response_mode === 'eight_d'
}

function getRowKey(row: CustomerEightDListItem) {
  return `${row.response_mode}-${row.id}-${row.problem_report_id || row.eight_d_report_id || row.report_number}`
}

function getResponseModeLabel(responseMode?: string) {
  return getProblemIssueResponseModeLabel(responseMode as any)
}

function getRouteQueryText(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
}

function applyRouteQueryFilters() {
  const reportNumber = getRouteQueryText(route.query.report_number)
  if (reportNumber) {
    queryParams.report_number = reportNumber
    queryParams.page = 1
  }

  const responseMode = getRouteQueryText(route.query.response_mode)
  if (responseMode === 'brief' || responseMode === 'eight_d') {
    queryParams.response_mode = responseMode
    queryParams.page = 1
  }
}

function getFollowUpStatusLabel(row: CustomerEightDListItem) {
  if (isEightDRow(row) && eightDStatusValues.has(row.status)) {
    return getEightDStatusLabel(row.status as EightDStatus)
  }
  return getUnifiedProblemStatusLabel(row.status as any)
}

function getStatusTagType(row: CustomerEightDListItem) {
  if (isEightDRow(row)) {
    switch (row.status) {
      case 'closed':
      case 'approved':
        return 'success'
      case 'rejected':
        return 'danger'
      case 'in_review':
      case 'd4_d7_completed':
        return 'warning'
      default:
        return 'primary'
    }
  }
  return getUnifiedProblemStatusType(row.status as any)
}

function formatDateTime(value?: string) {
  if (!value) {
    return '-'
  }
  return value.replace('T', ' ').slice(0, 19)
}

async function loadCustomerOptions() {
  try {
    customerOptions.value = await getCustomerComplaintCustomerOptions()
  } catch (error: any) {
    ElMessage.error(error.message || '加载客户清单失败')
  }
}

async function loadReports() {
  loading.value = true
  try {
    if (dateRange.value) {
      queryParams.start_date = dateRange.value[0]
      queryParams.end_date = dateRange.value[1]
    } else {
      queryParams.start_date = undefined
      queryParams.end_date = undefined
    }

    const response = await getCustomerEightDReports(queryParams)
    reportList.value = response.items
    total.value = response.total
  } catch (error: any) {
    ElMessage.error(error.message || '加载客诉问题跟进清单失败')
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  queryParams.page = 1
  void loadReports()
}

function handleReset() {
  queryParams.page = 1
  queryParams.page_size = 20
  queryParams.report_number = undefined
  queryParams.complaint_type = undefined
  queryParams.customer_id = undefined
  queryParams.product_type = undefined
  queryParams.status = undefined
  queryParams.response_mode = undefined
  dateRange.value = null
  void loadReports()
}

function openFollowUp(row: CustomerEightDListItem) {
  if (isEightDRow(row)) {
    router.push({
      name: 'EightDWorkspace',
      query: {
        kind: 'customer',
        recordId: String(row.complaint_id),
        sourceRouteName: 'CustomerEightDList',
        sourceFocusId: String(row.id),
        sourceComplaintId: String(row.complaint_id),
      },
    })
    return
  }

  router.push({
    name: 'ProblemIssueCenter',
    query: {
      module_key: 'customer_quality',
      keyword: row.report_number,
    },
  })
}

function openComplaint(row: CustomerEightDListItem) {
  router.push({
    name: 'CustomerComplaintDetail',
    params: { id: String(row.complaint_id) },
    query: {
      sourceRouteName: 'CustomerEightDList',
      sourceFocusId: String(row.id),
    },
  })
}

function getRowClassName({ row }: { row: CustomerEightDListItem }) {
  return focusedReportId.value === row.id ? 'focused-row' : ''
}

onMounted(() => {
  applyRouteQueryFilters()
  void problemManagementStore.loadCatalog()
  void loadCustomerOptions()
  void loadReports()
})

watch(
  () => [route.query.focusId, route.query.report_number, route.query.response_mode],
  () => {
    applyRouteQueryFilters()
    void loadReports()
  }
)
</script>

<style scoped>
.customer-follow-up-list {
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

.filter-item :deep(.el-range-input),
.filter-item :deep(.el-select__selected-item),
.filter-item :deep(.el-input__inner) {
  font-size: 12px;
}

.report-link {
  padding: 0;
}

.sub-number {
  margin-top: 2px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.3;
}

.report-table :deep(.el-table__header th) {
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

  .filter-item--report,
  .filter-item--compact,
  .filter-item--customer,
  .filter-item--product,
  .filter-item--range {
    width: auto;
  }

  .filter-actions {
    justify-content: stretch;
    margin-left: 0;
  }

  .filter-actions :deep(.el-button) {
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
