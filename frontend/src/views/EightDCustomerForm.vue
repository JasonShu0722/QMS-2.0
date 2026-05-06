<template>
  <div class="eight-d-customer-form p-4 md:p-6">
    <!-- 页面标题 -->
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center gap-3">
        <h1 class="text-2xl font-bold">客诉 8D 报告</h1>
        <el-tag v-if="eightDData" type="primary">{{ eightDStatusLabel }}</el-tag>
      </div>
      <div class="flex items-center gap-2">
        <el-button
          v-if="canArchiveEightD"
          type="success"
          :loading="submitting"
          @click="handleArchiveEightD"
        >
          归档关闭
        </el-button>
        <el-button v-if="!workspaceMode" @click="handleBack">返回</el-button>
      </div>
    </div>

    <!-- 客诉单基本信息 -->
    <el-card class="mb-4" v-if="complaint">
      <template #header>
        <span class="font-semibold">客诉单信息</span>
      </template>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="客诉编号">{{ complaint.complaint_number }}</el-descriptions-item>
        <el-descriptions-item label="客诉类型">
          <el-tag :type="complaint.complaint_type === '0km' ? 'danger' : 'warning'">
            {{ complaint.complaint_type === '0km' ? '0KM' : '售后' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="客户代码">{{ complaint.customer_code }}</el-descriptions-item>
        <el-descriptions-item label="产品类型">{{ complaint.product_type }}</el-descriptions-item>
        <el-descriptions-item label="缺陷描述" :span="2">{{ complaint.defect_description }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <!-- 8D 报告内容 -->
    <el-card v-loading="loading">
      <el-empty v-if="!eightDData" :description="eightDEmptyDescription">
        <el-button
          v-if="canInitEightD"
          type="primary"
          :loading="submitting"
          @click="handleInitEightD"
        >
          发起 8D
        </el-button>
      </el-empty>

      <div v-else class="space-y-4">
        <el-alert :title="eightDNextStepHint" type="info" :closable="false" />

        <el-card shadow="never">
          <template #header>
            <span class="font-semibold">8D 概览</span>
          </template>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="当前状态">{{ eightDStatusLabel }}</el-descriptions-item>
            <el-descriptions-item label="审批级别">{{ eightDApprovalLevelLabel }}</el-descriptions-item>
            <el-descriptions-item label="发起时间">{{ formatDateTime(eightDData.created_at) }}</el-descriptions-item>
            <el-descriptions-item label="提交时间">{{ formatDateTime(eightDData.submitted_at) }}</el-descriptions-item>
            <el-descriptions-item label="审核时间">{{ formatDateTime(eightDData.reviewed_at) }}</el-descriptions-item>
            <el-descriptions-item label="最近更新">{{ formatDateTime(eightDData.updated_at) }}</el-descriptions-item>
            <el-descriptions-item label="SLA">
              <el-tag :type="eightDSLAIndicator.tagType">{{ eightDSLAIndicator.label }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="创建至今天数">
              {{ eightDSLAStatus?.days_since_creation ?? '-' }}
            </el-descriptions-item>
            <el-descriptions-item label="审核意见" :span="2">
              {{ eightDData.review_comments || '-' }}
            </el-descriptions-item>
            <el-descriptions-item v-if="d0d3ComplaintSourceSummary !== '-'" label="来源客诉范围" :span="2">
              {{ d0d3ComplaintSourceSummary }}
            </el-descriptions-item>
          </el-descriptions>
        </el-card>

        <el-card v-if="hasRelatedComplaintScope" shadow="never">
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">关联客诉范围</span>
              <el-button
                v-if="canManageComplaintScope"
                type="primary"
                link
                @click="scopeDialogVisible = true"
              >
                追加范围
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
                  <el-button
                    class="px-0"
                    type="primary"
                    link
                    :disabled="row.complaint_id === complaint?.id"
                    @click="handleOpenComplaint(row.complaint_id)"
                  >
                    查看客诉
                  </el-button>
                  <el-tag v-if="row.is_primary" size="small" type="primary">主客诉</el-tag>
                  <el-tag v-if="row.complaint_id === complaint?.id" size="small" type="success">当前查看</el-tag>
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
            <el-table-column v-if="canManageComplaintScope" label="操作" width="120" fixed="right">
              <template #default="{ row }">
                <el-popconfirm
                  v-if="canSwitchPrimaryComplaint(row)"
                  title="确认将该客诉设为当前 8D 的主客诉？"
                  @confirm="handleSwitchPrimaryComplaint(row.complaint_id)"
                >
                  <template #reference>
                    <el-button type="primary" link :disabled="submitting">设为主客诉</el-button>
                  </template>
                </el-popconfirm>
                <el-popconfirm
                  v-if="canRemoveComplaintFromScope(row)"
                  title="确认将该客诉移出当前 8D 范围？"
                  @confirm="handleRemoveRelatedComplaint(row.complaint_id)"
                >
                  <template #reference>
                    <el-button type="danger" link :disabled="submitting">移出</el-button>
                  </template>
                </el-popconfirm>
                <span v-else class="text-xs text-gray-400">当前不可移出</span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-tabs v-model="activeTab" type="border-card">
        <!-- D0-D3 (CQE完成) -->
        <el-tab-pane label="D0-D3 (CQE)" name="d0-d3">
          <div v-if="eightDData?.d0_d3_cqe" class="space-y-4">
            <el-descriptions :column="1" border>
              <el-descriptions-item label="问题描述 (5W2H)">
                {{ eightDData.d0_d3_cqe.problem_description }}
              </el-descriptions-item>
              <el-descriptions-item label="围堵措施">
                {{ eightDData.d0_d3_cqe.containment_actions }}
              </el-descriptions-item>
              <el-descriptions-item label="围堵范围">
                <el-tag v-if="eightDData.d0_d3_cqe.containment_in_transit" type="success" class="mr-2">在途品</el-tag>
                <el-tag v-if="eightDData.d0_d3_cqe.containment_inventory" type="success" class="mr-2">库存品</el-tag>
                <el-tag v-if="eightDData.d0_d3_cqe.containment_customer" type="success">客户端库存</el-tag>
              </el-descriptions-item>
            </el-descriptions>
          </div>
          <el-empty v-else description="CQE 尚未完成 D0-D3 阶段" />
        </el-tab-pane>

        <!-- D4-D7 (责任板块) -->
        <el-tab-pane label="D4-D7 (责任板块)" name="d4-d7">
          <el-form
            v-if="canEditD4D7"
            ref="d4d7FormRef"
            :model="d4d7Form"
            :rules="d4d7Rules"
            label-width="140px"
          >
            <el-form-item label="根本原因" prop="root_cause">
              <el-input
                v-model="d4d7Form.root_cause"
                type="textarea"
                :rows="4"
                placeholder="请详细描述根本原因"
              />
            </el-form-item>

            <el-form-item label="分析方法" prop="analysis_method">
              <el-select v-model="d4d7Form.analysis_method" placeholder="请选择分析方法">
                <el-option label="5Why分析" value="5Why" />
                <el-option label="鱼骨图" value="鱼骨图" />
                <el-option label="FTA故障树" value="FTA" />
                <el-option label="流程分析" value="流程分析" />
              </el-select>
            </el-form-item>

            <el-form-item label="纠正措施" prop="corrective_actions">
              <el-input
                v-model="d4d7Form.corrective_actions"
                type="textarea"
                :rows="4"
                placeholder="请详细描述纠正措施"
              />
            </el-form-item>

            <el-form-item label="D6验证报告" prop="verification_report_url">
              <el-input v-model="d4d7Form.verification_report_url" placeholder="请上传验证报告附件URL">
                <template #append>
                  <el-button>上传</el-button>
                </template>
              </el-input>
              <div class="text-xs text-gray-500 mt-1">必须上传验证报告或测试数据</div>
            </el-form-item>

            <el-form-item label="是否涉及文件修改" prop="standardization">
              <el-switch v-model="d4d7Form.standardization" />
            </el-form-item>

            <el-form-item v-if="d4d7Form.standardization" label="标准化文件" prop="standardization_files">
              <el-input
                v-model="standardizationFilesInput"
                placeholder="请上传修改后的文件（多个文件用逗号分隔）"
              >
                <template #append>
                  <el-button>上传</el-button>
                </template>
              </el-input>
            </el-form-item>

            <el-form-item>
              <el-button type="primary" @click="handleSubmitD4D7" :loading="submitting">
                提交 D4-D7
              </el-button>
            </el-form-item>
          </el-form>

          <!-- 查看模式 -->
          <div v-else-if="eightDData?.d4_d7_responsible" class="space-y-4">
            <el-descriptions :column="1" border>
              <el-descriptions-item label="根本原因">
                {{ eightDData.d4_d7_responsible.root_cause }}
              </el-descriptions-item>
              <el-descriptions-item label="分析方法">
                {{ eightDData.d4_d7_responsible.analysis_method }}
              </el-descriptions-item>
              <el-descriptions-item label="纠正措施">
                {{ eightDData.d4_d7_responsible.corrective_actions }}
              </el-descriptions-item>
              <el-descriptions-item label="验证报告">
                <a v-if="eightDData.d4_d7_responsible.verification_report_url" 
                   :href="eightDData.d4_d7_responsible.verification_report_url" 
                   target="_blank"
                   class="text-blue-500 hover:underline">
                  查看附件
                </a>
                <span v-else class="text-gray-400">未上传</span>
              </el-descriptions-item>
              <el-descriptions-item label="标准化">
                <el-tag :type="eightDData.d4_d7_responsible.standardization ? 'success' : 'info'">
                  {{ eightDData.d4_d7_responsible.standardization ? '已修改文件' : '无需修改' }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="标准化文件">
                <template v-if="eightDData.d4_d7_responsible.standardization_files?.length">
                  <el-tag
                    v-for="item in eightDData.d4_d7_responsible.standardization_files"
                    :key="item"
                    class="mr-2"
                  >
                    {{ item }}
                  </el-tag>
                </template>
                <span v-else class="text-gray-400">-</span>
              </el-descriptions-item>
            </el-descriptions>
          </div>

          <el-empty v-else description="责任板块尚未填写 D4-D7" />
        </el-tab-pane>

        <!-- D8 (水平展开) -->
        <el-tab-pane label="D8 (水平展开)" name="d8">
          <el-form
            v-if="canEditD8"
            ref="d8FormRef"
            :model="d8Form"
            :rules="d8Rules"
            label-width="140px"
          >
            <el-form-item label="水平展开项目" prop="horizontal_deployment">
              <el-select
                v-model="d8Form.horizontal_deployment"
                multiple
                filterable
                allow-create
                placeholder="搜索或输入类似产品/工艺"
                class="w-full"
              >
                <el-option label="类似产品A" value="类似产品A" />
                <el-option label="类似产品B" value="类似产品B" />
                <el-option label="类似工艺C" value="类似工艺C" />
              </el-select>
              <div class="text-xs text-gray-500 mt-1">将对策推送到相关项目组</div>
            </el-form-item>

            <el-form-item label="经验教训" prop="lessons_learned">
              <el-input
                v-model="d8Form.lessons_learned"
                type="textarea"
                :rows="4"
                placeholder="请总结经验教训"
              />
            </el-form-item>

            <el-form-item label="沉淀到经验库" prop="save_to_library">
              <el-switch v-model="d8Form.save_to_library" />
              <div class="text-xs text-gray-500 mt-1">勾选后将自动保存到经验教训库</div>
            </el-form-item>

            <el-form-item>
              <el-button type="primary" @click="handleSubmitD8" :loading="submitting">
                提交 D8
              </el-button>
            </el-form-item>
          </el-form>

          <!-- 查看模式 -->
          <div v-else-if="eightDData?.d8_horizontal" class="space-y-4">
            <el-descriptions :column="1" border>
              <el-descriptions-item label="水平展开项目">
                <el-tag
                  v-for="item in eightDData.d8_horizontal.horizontal_deployment"
                  :key="item"
                  class="mr-2"
                >
                  {{ item }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="经验教训">
                {{ eightDData.d8_horizontal.lessons_learned }}
              </el-descriptions-item>
              <el-descriptions-item label="经验库">
                <el-tag :type="eightDData.d8_horizontal.save_to_library ? 'success' : 'info'">
                  {{ eightDData.d8_horizontal.save_to_library ? '已沉淀' : '未沉淀' }}
                </el-tag>
              </el-descriptions-item>
            </el-descriptions>
          </div>

          <el-empty v-else description="尚未完成 D8 阶段" />
        </el-tab-pane>

        <!-- 审核 -->
        <el-tab-pane label="审核" name="review" v-if="canReview">
          <el-form
            ref="reviewFormRef"
            :model="reviewForm"
            :rules="reviewRules"
            label-width="140px"
          >
            <el-form-item label="审核结果" prop="approved">
              <el-radio-group v-model="reviewForm.approved">
                <el-radio :label="true">批准</el-radio>
                <el-radio :label="false">驳回</el-radio>
              </el-radio-group>
            </el-form-item>

            <el-form-item label="审核意见" prop="review_comments">
              <el-input
                v-model="reviewForm.review_comments"
                type="textarea"
                :rows="4"
                placeholder="请填写审核意见"
              />
            </el-form-item>

            <el-form-item>
              <el-button type="primary" @click="handleReview" :loading="submitting">
                提交审核
              </el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
        </el-tabs>
      </div>
    </el-card>

    <CustomerEightDScopeDialog
      v-model="scopeDialogVisible"
      :anchor-complaint-id="Number(route.params.id)"
      :complaint-type="complaint?.complaint_type ?? '0km'"
      :customer-id="complaint?.customer_id"
      :customer-code="complaint?.customer_code ?? ''"
      :linked-complaint-ids="relatedComplaints.map((item) => item.complaint_id)"
      @success="handleScopeUpdated"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import CustomerEightDScopeDialog from '@/components/CustomerEightDScopeDialog.vue'
import {
  archiveEightDCustomer,
  getCustomerComplaint,
  getEightDCustomer,
  getEightDSLAStatus,
  initCustomerComplaintEightD,
  removeCustomerComplaintEightDScopeComplaint,
  switchCustomerComplaintEightDPrimaryComplaint,
  submitEightDCustomer,
  submitEightDD8,
  reviewEightDCustomer,
} from '@/api/customer-quality'
import { canOpenCustomerComplaintEightD } from '@/utils/customerComplaint'
import { isCustomerComplaintRouteName } from '@/utils/problemIssueSummary'
import {
  canManageEightDComplaintScope,
  canRemoveComplaintFromEightDScope,
  canSwitchEightDPrimaryComplaint,
  createEmptyD4D7Data,
  createEmptyD8Data,
  deriveD4D7FormState,
  deriveD8FormState,
  getEightDApprovalLevelLabel,
  getEightDD0D3ComplaintSourceSummary,
  getEightDComplaintScopeSummary,
  getEightDComplaintTypeLabel,
  getEightDNextStepHint,
  getEightDSLAIndicator,
  getEightDStatusLabel,
  getPreferredEightDTab,
} from '@/utils/customerEightD'
import type {
  CustomerComplaint,
  D4D7Data,
  D8Data,
  EightDCustomer,
  EightDReview,
  EightDSLAStatus,
} from '@/types/customer-quality'

const props = withDefaults(
  defineProps<{
    recordId?: number | string
    workspaceMode?: boolean
    sourceRouteName?: string
    sourceFocusId?: string | number
    sourceComplaintId?: string | number
  }>(),
  {
    recordId: undefined,
    workspaceMode: false,
    sourceRouteName: undefined,
    sourceFocusId: undefined,
    sourceComplaintId: undefined,
  }
)

const emit = defineEmits<{
  (event: 'loaded-meta', payload: { title?: string }): void
}>()

const route = useRoute()
const router = useRouter()
const workspaceMode = computed(() => props.workspaceMode)

// 数据状态
const loading = ref(false)
const submitting = ref(false)
const complaint = ref<CustomerComplaint | null>(null)
const eightDData = ref<EightDCustomer | null>(null)
const eightDSLAStatus = ref<EightDSLAStatus | null>(null)
const activeTab = ref('d0-d3')
const scopeDialogVisible = ref(false)

// 表单引用
const d4d7FormRef = ref<FormInstance>()
const d8FormRef = ref<FormInstance>()
const reviewFormRef = ref<FormInstance>()

// D4-D7 表单
const d4d7Form = reactive<D4D7Data>(createEmptyD4D7Data())

const standardizationFilesInput = ref('')

// D8 表单
const d8Form = reactive<D8Data>(createEmptyD8Data())

// 审核表单
const reviewForm = reactive<EightDReview>({
  approved: true,
  review_comments: '',
})

// 表单验证规则
const d4d7Rules: FormRules = {
  root_cause: [{ required: true, message: '请输入根本原因', trigger: 'blur' }],
  analysis_method: [{ required: true, message: '请选择分析方法', trigger: 'change' }],
  corrective_actions: [{ required: true, message: '请输入纠正措施', trigger: 'blur' }],
  verification_report_url: [{ required: true, message: '请上传验证报告', trigger: 'blur' }],
}

const d8Rules: FormRules = {
  horizontal_deployment: [{ required: true, message: '请选择水平展开项目', trigger: 'change' }],
  lessons_learned: [{ required: true, message: '请输入经验教训', trigger: 'blur' }],
}

const reviewRules: FormRules = {
  review_comments: [{ required: true, message: '请填写审核意见', trigger: 'blur' }],
}

const canInitEightD = computed(() => {
  if (!complaint.value) {
    return false
  }
  if (complaint.value.eight_d_report_id) {
    return false
  }
  return canOpenCustomerComplaintEightD(complaint.value)
})

const eightDStatusLabel = computed(() => getEightDStatusLabel(eightDData.value?.status))
const eightDApprovalLevelLabel = computed(() => getEightDApprovalLevelLabel(eightDData.value?.approval_level))
const eightDNextStepHint = computed(() => getEightDNextStepHint(eightDData.value?.status))
const eightDSLAIndicator = computed(() => getEightDSLAIndicator(eightDSLAStatus.value ?? undefined))
const d0d3ComplaintSourceSummary = computed(() =>
  getEightDD0D3ComplaintSourceSummary(eightDData.value?.d0_d3_cqe)
)
const relatedComplaints = computed(() => eightDData.value?.related_complaints ?? [])
const complaintScopeSummary = computed(() => getEightDComplaintScopeSummary(relatedComplaints.value))
const hasRelatedComplaintScope = computed(() => relatedComplaints.value.length > 0)
const canManageComplaintScope = computed(() => canManageEightDComplaintScope(eightDData.value?.status))

const eightDEmptyDescription = computed(() => {
  if (!complaint.value) {
    return '正在加载客诉单信息'
  }

  if (canInitEightD.value) {
    return '当前客诉尚未发起 8D 报告'
  }

  if (complaint.value.eight_d_report_id) {
    return '当前 8D 报告数据暂未加载成功，请返回客诉台账后重试'
  }

  if (complaint.value.requires_physical_analysis) {
    return '需先完成实物解析，再发起 8D 报告'
  }

  return '需先完成实物处理方案备案，再发起 8D 报告'
})

// 权限判断
const canEditD4D7 = computed(() => {
  // TODO: 根据用户角色和8D状态判断是否可编辑
  return eightDData.value?.status === 'd4_d7_in_progress'
})

const canEditD8 = computed(() => {
  return ['d4_d7_completed', 'd8_in_progress'].includes(eightDData.value?.status ?? '')
})

const canReview = computed(() => {
  // TODO: 根据用户角色判断是否可审核
  return eightDData.value?.status === 'in_review'
})

const canArchiveEightD = computed(() => eightDData.value?.status === 'approved')

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
  const raw = props.sourceRouteName ?? getSingleQueryValue(route.query.sourceRouteName)
  return raw && isCustomerComplaintRouteName(raw) ? raw : 'CustomerComplaintList'
})

const sourceFocusId = computed(() => {
  const raw = props.sourceFocusId ? String(props.sourceFocusId) : getSingleQueryValue(route.query.sourceFocusId)
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : complaint.value?.id ?? Number(props.recordId ?? route.params.id)
})

const sourceComplaintId = computed(() => {
  const raw = props.sourceComplaintId ? String(props.sourceComplaintId) : getSingleQueryValue(route.query.sourceComplaintId)
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : complaint.value?.id ?? Number(props.recordId ?? route.params.id)
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

  return {
    name: 'CustomerComplaintList' as const,
    query: {
      focusId: String(sourceFocusId.value),
    },
  }
}

function canRemoveComplaintFromScope(row: { complaint_id: number; is_primary: boolean }) {
  return canRemoveComplaintFromEightDScope(row, complaint.value?.id)
}

function canSwitchPrimaryComplaint(row: { is_primary: boolean }) {
  return canSwitchEightDPrimaryComplaint(row, eightDData.value?.status)
}

function syncFormsWithEightD(data?: EightDCustomer | null) {
  Object.assign(d4d7Form, deriveD4D7FormState(data?.d4_d7_responsible))
  Object.assign(d8Form, deriveD8FormState(data?.d8_horizontal))
  standardizationFilesInput.value = (data?.d4_d7_responsible?.standardization_files ?? []).join(', ')
  reviewForm.approved = true
  reviewForm.review_comments = ''
  activeTab.value = data ? getPreferredEightDTab(data.status) : 'd0-d3'
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return '-'
  }

  return value.replace('T', ' ').slice(0, 19)
}

/**
 * 加载数据
 */
async function loadData() {
  const complaintId = Number(props.recordId ?? route.params.id)
  if (!Number.isFinite(complaintId) || complaintId <= 0) {
    ElMessage.warning('请从客诉台账进入 8D 报告')
    router.replace('/quality/customer-complaints')
    return
  }
  loading.value = true

  try {
    // 加载客诉单信息
    complaint.value = await getCustomerComplaint(complaintId)
    emit('loaded-meta', {
      title: eightDData.value?.report_number || complaint.value?.complaint_number || `客诉 8D #${complaintId}`,
    })

    // 加载8D报告
    try {
      eightDData.value = await getEightDCustomer(complaintId)
      eightDSLAStatus.value = await getEightDSLAStatus(complaintId)
      syncFormsWithEightD(eightDData.value)
      emit('loaded-meta', {
        title: eightDData.value.report_number || complaint.value?.complaint_number || `客诉 8D #${complaintId}`,
      })
    } catch (error: any) {
      if (error.response?.status !== 404) {
        throw error
      }
      // 8D报告不存在，这是正常情况
      eightDData.value = null
      eightDSLAStatus.value = null
      syncFormsWithEightD(null)
    }
  } catch (error) {
    ElMessage.error('加载数据失败')
    console.error('Load data error:', error)
  } finally {
    loading.value = false
  }
}

async function handleInitEightD() {
  const complaintId = Number(route.params.id)
  if (!canInitEightD.value || !Number.isFinite(complaintId) || complaintId <= 0) {
    return
  }

  try {
    submitting.value = true
    eightDData.value = await initCustomerComplaintEightD(complaintId)
    eightDSLAStatus.value = await getEightDSLAStatus(complaintId)
    syncFormsWithEightD(eightDData.value)
    ElMessage.success('8D 报告已发起')
  } catch (error: any) {
    ElMessage.error(error.message || '发起 8D 失败')
    console.error('Init 8D error:', error)
  } finally {
    submitting.value = false
  }
}

async function handleArchiveEightD() {
  const complaintId = Number(route.params.id)
  if (!canArchiveEightD.value || !Number.isFinite(complaintId) || complaintId <= 0) {
    return
  }

  try {
    submitting.value = true
    eightDData.value = await archiveEightDCustomer(complaintId)
    await loadData()
    ElMessage.success('8D 报告已归档关闭')
  } catch (error: any) {
    ElMessage.error(error.message || '归档 8D 失败')
    console.error('Archive 8D error:', error)
  } finally {
    submitting.value = false
  }
}

/**
 * 提交 D4-D7
 */
async function handleRemoveRelatedComplaint(linkedComplaintId: number) {
  const complaintId = Number(route.params.id)
  if (!canManageComplaintScope.value || !Number.isFinite(complaintId) || complaintId <= 0) {
    return
  }

  try {
    submitting.value = true
    await removeCustomerComplaintEightDScopeComplaint(complaintId, linkedComplaintId)
    await loadData()
    ElMessage.success('已移出关联客诉')
  } catch (error: any) {
    ElMessage.error(error.message || '移出关联客诉失败')
    console.error('Remove customer 8D scope complaint error:', error)
  } finally {
    submitting.value = false
  }
}

async function handleScopeUpdated() {
  await loadData()
}

function handleOpenComplaint(complaintId: number) {
  if (!Number.isFinite(complaintId) || complaintId <= 0 || complaintId === complaint.value?.id) {
    return
  }

  router.push({
    name: 'CustomerComplaintDetail',
    params: { id: String(complaintId) },
    query: {
      sourceRouteName: 'EightDCustomerForm',
      sourceComplaintId: String(complaint.value?.id ?? complaintId),
    },
  })
}

async function handleSwitchPrimaryComplaint(primaryComplaintId: number) {
  const complaintId = Number(route.params.id)
  if (
    !Number.isFinite(complaintId) ||
    complaintId <= 0 ||
    !Number.isFinite(primaryComplaintId) ||
    primaryComplaintId <= 0
  ) {
    return
  }

  try {
    submitting.value = true
    eightDData.value = await switchCustomerComplaintEightDPrimaryComplaint(complaintId, {
      primary_complaint_id: primaryComplaintId,
    })
    ElMessage.success('已切换主客诉')
    await loadData()
  } catch (error: any) {
    ElMessage.error(error.message || '切换主客诉失败')
    console.error('Switch primary customer complaint error:', error)
  } finally {
    submitting.value = false
  }
}

async function handleSubmitD4D7() {
  if (!d4d7FormRef.value) return

  try {
    await d4d7FormRef.value.validate()
    submitting.value = true

    // 处理标准化文件
    if (d4d7Form.standardization && standardizationFilesInput.value) {
      d4d7Form.standardization_files = standardizationFilesInput.value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    }

    const complaintId = Number(route.params.id)
    await submitEightDCustomer(complaintId, { d4_d7_data: d4d7Form })

    ElMessage.success('D4-D7 提交成功')
    await loadData()
  } catch (error: any) {
    if (error !== false) {
      ElMessage.error(error.message || 'D4-D7 提交失败')
      console.error('Submit D4-D7 error:', error)
    }
  } finally {
    submitting.value = false
  }
}

/**
 * 提交 D8
 */
async function handleSubmitD8() {
  if (!d8FormRef.value) return

  try {
    await d8FormRef.value.validate()
    submitting.value = true

    const complaintId = Number(route.params.id)
    await submitEightDD8(complaintId, { d8_data: d8Form })

    ElMessage.success('D8 提交成功')
    await loadData()
  } catch (error: any) {
    if (error !== false) {
      ElMessage.error(error.message || 'D8 提交失败')
      console.error('Submit D8 error:', error)
    }
  } finally {
    submitting.value = false
  }
}

/**
 * 提交审核
 */
async function handleReview() {
  if (!reviewFormRef.value) return

  try {
    await reviewFormRef.value.validate()
    submitting.value = true

    const complaintId = Number(route.params.id)
    await reviewEightDCustomer(complaintId, reviewForm)

    ElMessage.success('审核提交成功')
    await loadData()
  } catch (error: any) {
    if (error !== false) {
      ElMessage.error(error.message || '审核提交失败')
      console.error('Review error:', error)
    }
  } finally {
    submitting.value = false
  }
}

/**
 * 返回
 */
function handleBack() {
  router.push(buildSourceRoute())
}

// 初始化
onMounted(() => {
  loadData()
})
</script>

<style scoped>
.eight-d-customer-form {
  min-height: 100vh;
}

/* 移动端适配 */
@media (max-width: 768px) {
  :deep(.el-form-item__label) {
    width: 100px !important;
  }

  :deep(.el-descriptions) {
    font-size: 12px;
  }
}
</style>
