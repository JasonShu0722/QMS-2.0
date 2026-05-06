<template>
  <div class="customer-complaint-detail p-4 md:p-6">
    <div class="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div class="space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-2xl font-bold">客诉详情</h1>
          <el-tag v-if="complaint" :type="getCustomerComplaintStatusType(complaint.status)">
            {{ getCustomerComplaintStatusLabel(complaint.status) }}
          </el-tag>
        </div>
        <div v-if="complaint" class="text-sm text-gray-500">
          {{ complaint.complaint_number }}
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <el-button @click="handleBack">返回</el-button>
        <el-button
          v-if="complaint && canHandleDisposition"
          @click="showDispositionDialog = true"
        >
          实物处理
        </el-button>
        <el-button
          v-if="complaint && canHandleAnalysis"
          @click="showAnalysisDialog = true"
        >
          实物解析
        </el-button>
        <el-button
          v-if="complaint && canOpenEightD"
          type="primary"
          :loading="launchingEightD"
          @click="handleOpenEightD"
        >
          {{ eightDActionLabel }}
        </el-button>
      </div>
    </div>

    <el-skeleton v-if="loading" :rows="10" animated />

    <template v-else-if="complaint">
      <el-alert :title="nextStepHint" type="info" :closable="false" class="mb-4" />

      <el-card class="mb-4">
        <template #header>
          <span class="font-semibold">基础信息</span>
        </template>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="客诉类型">
            <el-tag :type="complaint.complaint_type === ComplaintType.ZERO_KM ? 'danger' : 'warning'">
              {{ complaintTypeLabel }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="严重度">{{ complaint.severity_level || '-' }}</el-descriptions-item>
          <el-descriptions-item label="客户">{{ complaint.customer_name || complaint.customer_code }}</el-descriptions-item>
          <el-descriptions-item label="客户代码">{{ complaint.customer_code }}</el-descriptions-item>
          <el-descriptions-item label="终端客户">{{ complaint.end_customer_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="产品类型">{{ complaint.product_type }}</el-descriptions-item>
          <el-descriptions-item label="VIN">{{ complaint.vin_code || '-' }}</el-descriptions-item>
          <el-descriptions-item label="里程">{{ complaint.mileage ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="购买日期">{{ complaint.purchase_date || '-' }}</el-descriptions-item>
          <el-descriptions-item label="缺陷描述" :span="2">
            {{ complaint.defect_description }}
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card class="mb-4">
        <template #header>
          <span class="font-semibold">流转概览</span>
        </template>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="是否退件">
            <el-tag :type="complaint.is_return_required ? 'warning' : 'info'">
              {{ complaint.is_return_required ? '涉及退件' : '不涉及' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="处理路径">
            <el-tag :type="complaint.requires_physical_analysis ? 'primary' : 'success'">
              {{ complaint.requires_physical_analysis ? '实物解析' : '实物处理备案' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="实物解析状态">
            <el-tag
              v-if="complaint.requires_physical_analysis"
              :type="getCustomerComplaintPhysicalAnalysisStatusType(complaint.physical_analysis_status)"
            >
              {{ getCustomerComplaintPhysicalAnalysisStatusLabel(complaint.physical_analysis_status) }}
            </el-tag>
            <span v-else class="text-gray-400">-</span>
          </el-descriptions-item>
          <el-descriptions-item label="实物处理状态">
            <el-tag
              v-if="!complaint.requires_physical_analysis"
              :type="getCustomerComplaintDispositionStatusType(complaint.physical_disposition_status)"
            >
              {{ getCustomerComplaintDispositionStatusLabel(complaint.physical_disposition_status) }}
            </el-tag>
            <span v-else class="text-gray-400">-</span>
          </el-descriptions-item>
          <el-descriptions-item label="8D状态">
            <el-tag v-if="complaint.eight_d_report_id" type="primary">
              {{ eightDStatusLabel }}
            </el-tag>
            <span v-else class="text-gray-400">未发起</span>
          </el-descriptions-item>
          <el-descriptions-item label="8D编号">
            {{ complaint.eight_d_report_id ? `#${complaint.eight_d_report_id}` : '-' }}
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card v-if="hasRelatedComplaintScope" class="mb-4">
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <span class="font-semibold">8D 关联范围</span>
            <el-button
              v-if="complaint.eight_d_report_id"
              type="primary"
              link
              @click="handleOpenEightD"
            >
              查看 8D
            </el-button>
          </div>
        </template>
        <div class="mb-3 text-sm text-gray-500">
          {{ complaintScopeSummary }}
        </div>
        <el-table :data="relatedComplaints" size="small" border>
          <el-table-column label="客诉编号" min-width="160">
            <template #default="{ row }">
              <div class="flex flex-wrap items-center gap-2">
                <span>{{ row.complaint_number }}</span>
                <el-tag v-if="row.is_primary" size="small" type="primary">主客诉</el-tag>
                <el-tag v-if="row.complaint_id === complaint.id" size="small" type="success">当前查看</el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="120">
            <template #default="{ row }">
              {{ getEightDComplaintTypeLabel(row.complaint_type) }}
            </template>
          </el-table-column>
          <el-table-column label="客户" min-width="220">
            <template #default="{ row }">
              <div class="font-medium">{{ row.customer_name || row.customer_code }}</div>
              <div class="text-xs text-gray-500">{{ row.customer_code }}</div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="row.complaint_id !== complaint.id"
                type="primary"
                link
                @click="handleOpenRelatedComplaint(row.complaint_id)"
              >
                查看客诉
              </el-button>
              <span v-else class="text-xs text-gray-400">当前记录</span>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card class="mb-4">
        <template #header>
          <span class="font-semibold">处理记录</span>
        </template>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="实物处理方案" :span="2">
            {{ complaint.physical_disposition_plan || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="实物处理备注" :span="2">
            {{ complaint.physical_disposition_notes || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="解析责任部门">
            {{ complaint.physical_analysis_responsible_dept || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="失效零部件料号">
            {{ complaint.failed_part_number || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="一次因分析" :span="2">
            {{ complaint.physical_analysis_summary || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="解析备注" :span="2">
            {{ complaint.physical_analysis_notes || '-' }}
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card>
        <template #header>
          <span class="font-semibold">责任与时间</span>
        </template>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="CQE">{{ complaint.cqe_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="责任部门">{{ complaint.responsible_dept || '-' }}</el-descriptions-item>
          <el-descriptions-item label="责任人">{{ complaint.responsible_user_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ complaint.created_at }}</el-descriptions-item>
          <el-descriptions-item label="最近更新">{{ complaint.updated_at }}</el-descriptions-item>
          <el-descriptions-item label="解析更新时间">
            {{ complaint.physical_analysis_updated_at || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="实物处理更新时间">
            {{ complaint.physical_disposition_updated_at || '-' }}
          </el-descriptions-item>
        </el-descriptions>
      </el-card>
    </template>

    <el-empty v-else description="未找到客诉记录" />

    <CustomerComplaintDispositionDialog
      v-model="showDispositionDialog"
      :complaint="complaint"
      @success="handleRecordSuccess"
    />

    <CustomerComplaintAnalysisDialog
      v-model="showAnalysisDialog"
      :complaint="complaint"
      @success="handleRecordSuccess"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import CustomerComplaintAnalysisDialog from '@/components/CustomerComplaintAnalysisDialog.vue'
import CustomerComplaintDispositionDialog from '@/components/CustomerComplaintDispositionDialog.vue'
import {
  getCustomerComplaint,
  getEightDCustomer,
  initCustomerComplaintEightD,
} from '@/api/customer-quality'
import { useProblemManagementStore } from '@/stores/problemManagement'
import { ComplaintType, type CustomerComplaint, type EightDCustomer } from '@/types/customer-quality'
import { getCustomerComplaintTypeLabel } from '@/utils/problemManagement'
import { isCustomerComplaintRouteName } from '@/utils/problemIssueSummary'
import {
  canHandleCustomerComplaintAnalysis,
  canHandleCustomerComplaintDisposition,
  canOpenCustomerComplaintEightD,
  getCustomerComplaintDispositionStatusLabel,
  getCustomerComplaintDispositionStatusType,
  getCustomerComplaintEightDActionLabel,
  getCustomerComplaintNextStepHint,
  getCustomerComplaintPhysicalAnalysisStatusLabel,
  getCustomerComplaintPhysicalAnalysisStatusType,
  getCustomerComplaintStatusLabel,
  getCustomerComplaintStatusType,
} from '@/utils/customerComplaint'
import {
  getEightDComplaintScopeSummary,
  getEightDComplaintTypeLabel,
  getEightDStatusLabel,
} from '@/utils/customerEightD'

const route = useRoute()
const router = useRouter()
const problemManagementStore = useProblemManagementStore()

const loading = ref(false)
const launchingEightD = ref(false)
const showDispositionDialog = ref(false)
const showAnalysisDialog = ref(false)
const complaint = ref<CustomerComplaint | null>(null)
const eightDData = ref<EightDCustomer | null>(null)

const complaintTypeLabel = computed(() => {
  if (!complaint.value) {
    return '-'
  }
  return getCustomerComplaintTypeLabel(complaint.value.complaint_type, problemManagementStore.getCategory, true)
})

const canOpenEightD = computed(() => Boolean(complaint.value && canOpenCustomerComplaintEightD(complaint.value)))
const canHandleDisposition = computed(() => Boolean(complaint.value && canHandleCustomerComplaintDisposition(complaint.value)))
const canHandleAnalysis = computed(() => Boolean(complaint.value && canHandleCustomerComplaintAnalysis(complaint.value)))

const eightDActionLabel = computed(() => {
  if (!complaint.value) {
    return '发起8D'
  }
  return getCustomerComplaintEightDActionLabel(complaint.value)
})

const nextStepHint = computed(() => {
  if (!complaint.value) {
    return '正在加载客诉台账信息'
  }
  return getCustomerComplaintNextStepHint(complaint.value)
})

const eightDStatusLabel = computed(() => getEightDStatusLabel(complaint.value?.eight_d_status))
const relatedComplaints = computed(() => eightDData.value?.related_complaints ?? [])
const hasRelatedComplaintScope = computed(() => relatedComplaints.value.length > 0)
const complaintScopeSummary = computed(() => getEightDComplaintScopeSummary(relatedComplaints.value))

function getSingleQueryValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0]
  }

  return undefined
}

const sourceRouteName = computed(() => {
  const raw = getSingleQueryValue(route.query.sourceRouteName)
  return raw && isCustomerComplaintRouteName(raw) ? raw : 'CustomerComplaintList'
})

const sourceFocusId = computed(() => {
  const raw = getSingleQueryValue(route.query.sourceFocusId)
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : complaint.value?.id ?? Number(route.params.id)
})

const sourceComplaintId = computed(() => {
  const raw = getSingleQueryValue(route.query.sourceComplaintId)
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : complaint.value?.id ?? Number(route.params.id)
})

function buildSourceRoute() {
  if (sourceRouteName.value === 'ProblemIssueCenter') {
    return { name: 'ProblemIssueCenter' as const }
  }

  if (sourceRouteName.value === 'CustomerEightDList') {
    return {
      name: 'CustomerEightDList' as const,
      query: {
        focusId: String(sourceFocusId.value),
      },
    }
  }

  if (sourceRouteName.value === 'EightDCustomerForm') {
    return {
      name: 'EightDCustomerForm' as const,
      params: { id: String(sourceComplaintId.value) },
      query: {
        sourceRouteName: 'CustomerComplaintDetail',
        sourceComplaintId: String(sourceComplaintId.value),
      },
    }
  }

  if (sourceRouteName.value === 'CustomerComplaintDetail') {
    return {
      name: 'CustomerComplaintDetail' as const,
      params: { id: String(sourceComplaintId.value) },
      query: {
        sourceRouteName: 'CustomerComplaintList',
        sourceFocusId: String(sourceComplaintId.value),
      },
    }
  }

  return {
    name: 'CustomerComplaintList' as const,
    query: {
      focusId: String(sourceFocusId.value),
    },
  }
}

function clearRouteAction() {
  if (!route.query.action || !complaint.value) {
    return
  }

  const { action, ...restQuery } = route.query
  void router.replace({
    name: 'CustomerComplaintDetail',
    params: { id: complaint.value.id },
    query: restQuery,
  })
}

function consumeRouteAction() {
  if (!complaint.value) {
    return
  }

  if (route.query.action === 'analysis' && canHandleAnalysis.value) {
    showAnalysisDialog.value = true
    clearRouteAction()
    return
  }

  if (route.query.action === 'disposition' && canHandleDisposition.value) {
    showDispositionDialog.value = true
    clearRouteAction()
  }
}

async function loadComplaint() {
  const complaintId = Number(route.params.id)
  if (!Number.isFinite(complaintId) || complaintId <= 0) {
    ElMessage.warning('请从客诉台账进入详情页')
    router.replace('/quality/customer-complaints')
    return
  }

  loading.value = true
  try {
    complaint.value = await getCustomerComplaint(complaintId)
    if (complaint.value.eight_d_report_id) {
      eightDData.value = await getEightDCustomer(complaint.value.id)
    } else {
      eightDData.value = null
    }
    consumeRouteAction()
  } catch (error: any) {
    ElMessage.error(error.message || '加载客诉详情失败')
    console.error('load complaint detail error:', error)
  } finally {
    loading.value = false
  }
}

async function handleOpenEightD() {
  if (!complaint.value || !canOpenEightD.value) {
    return
  }

  const nextSourceQuery =
    sourceRouteName.value === 'CustomerEightDList'
      ? {
          sourceRouteName: 'CustomerEightDList',
          sourceFocusId: String(sourceFocusId.value),
          sourceComplaintId: String(complaint.value.id),
        }
      : {
          sourceRouteName: 'CustomerComplaintDetail',
          sourceComplaintId: String(complaint.value.id),
        }

  if (complaint.value.eight_d_report_id) {
    router.push({
      name: 'EightDCustomerForm',
      params: { id: complaint.value.id },
      query: nextSourceQuery,
    })
    return
  }

  try {
    launchingEightD.value = true
    await initCustomerComplaintEightD(complaint.value.id)
    ElMessage.success(`客诉 ${complaint.value.complaint_number} 已发起 8D`)
      await loadComplaint()
      router.push({
        name: 'EightDCustomerForm',
        params: { id: complaint.value.id },
        query: nextSourceQuery,
      })
  } catch (error: any) {
    ElMessage.error(error.message || '发起 8D 失败')
    console.error('launch 8D from complaint detail error:', error)
  } finally {
    launchingEightD.value = false
  }
}

function handleBack() {
  router.push(buildSourceRoute())
}

function handleOpenRelatedComplaint(complaintId: number) {
  router.push({
    name: 'CustomerComplaintDetail',
    params: { id: complaintId },
    query: {
      sourceRouteName: 'CustomerComplaintDetail',
      sourceComplaintId: String(complaint.value?.id ?? complaintId),
    },
  })
}

function handleRecordSuccess() {
  void loadComplaint()
}

onMounted(() => {
  void problemManagementStore.loadCatalog()
  void loadComplaint()
})

watch(
  () => route.params.id,
  () => {
    void loadComplaint()
  }
)

watch(
  () => route.query.action,
  () => {
    consumeRouteAction()
  }
)
</script>

<style scoped>
.customer-complaint-detail {
  min-height: 100vh;
}

@media (max-width: 768px) {
  :deep(.el-descriptions__label) {
    width: 110px !important;
  }
}
</style>
