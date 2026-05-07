<template>
  <div class="eight-d-form">
    <div v-if="!workspaceMode" class="page-header">
      <el-button @click="goBack" circle>
        <el-icon><ArrowLeft /></el-icon>
      </el-button>
      <h2>{{ pageTitle }}</h2>
    </div>

    <el-card class="report-shell" shadow="never">
      <template #header>
        <div class="report-heading">
          <div>
            <div class="eyebrow">供应商来料质量</div>
            <h2>{{ displayReportNumber }}</h2>
          </div>
          <div v-if="authStore.isInternal || authStore.isSupplier" class="report-actions">
            <el-button v-if="authStore.isInternal" @click="openScarEditDialog">
              <el-icon><Edit /></el-icon>
              编辑基础信息
            </el-button>
            <el-button v-if="authStore.isSupplier" @click="handleSaveDraft" :loading="saving">
              <el-icon><Document /></el-icon>
              保存草稿
            </el-button>
            <el-button v-if="authStore.isSupplier" type="primary" @click="handleSubmit" :loading="submitting">
              <el-icon><Check /></el-icon>
              提交报告
            </el-button>
          </div>
        </div>
      </template>

      <el-descriptions class="scar-summary" :column="2" border>
        <el-descriptions-item label="供应商">{{ scarData?.supplier_name || '-' }}</el-descriptions-item>
        <el-descriptions-item label="物料编码">{{ scarData?.material_code || '-' }}</el-descriptions-item>
        <el-descriptions-item label="来料分类">
          {{ getMaterialCategoryLabel(formData.material_category || scarData?.material_category) }}
        </el-descriptions-item>
        <el-descriptions-item label="缺陷描述" :span="2">
          {{ scarData?.defect_description || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="不良数量">{{ scarData?.defect_qty ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="严重度">
          <el-tag :type="getSeverityType(scarData?.severity)">
            {{ getSeverityLabel(scarData?.severity) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="截止日期">
          <span :class="{ 'text-danger': isOverdue(scarData?.deadline) }">
            {{ formatDate(scarData?.deadline) || '-' }}
          </span>
        </el-descriptions-item>
        <el-descriptions-item label="当前状态">
          {{ getScarStatusLabel(scarData?.status) }}
        </el-descriptions-item>
      </el-descriptions>

      <div v-if="authStore.isSupplier" class="reviewer-picker">
        <span class="reviewer-picker__label">提交审核人</span>
        <el-select
          v-model="formData.reviewer_id"
          filterable
          remote
          reserve-keyword
          clearable
          :loading="sqeSearchLoading"
          :remote-method="loadSQEOptions"
          placeholder="选择供应商质量工程师"
          @visible-change="handleSQESelectVisibleChange"
        >
          <el-option
            v-for="user in sqeOptions"
            :key="user.id"
            :label="formatSQEOptionLabel(user)"
            :value="user.id"
          />
        </el-select>
      </div>
    </el-card>

    <el-form
      ref="formRef"
      class="report-form"
      :model="formData"
      :rules="rules"
      label-position="top"
      :disabled="!authStore.isSupplier"
    >
      <el-card class="form-section" shadow="never">
        <template #header>
          <span class="section-title">问题描述与临时处理</span>
        </template>

        <el-form-item label="问题描述" prop="problem_description">
          <el-input
            v-model="formData.problem_description"
            type="textarea"
            :rows="4"
            placeholder="系统已根据 SCAR 单据信息生成初版描述，可按实际情况修订"
          />
        </el-form-item>

        <div class="two-column">
          <el-form-item label="围堵/应急措施" prop="containment_action">
            <el-input
              v-model="formData.containment_action"
              type="textarea"
              :rows="4"
              placeholder="描述已采取的隔离、筛选、库存锁定、客户端遏制等措施"
            />
          </el-form-item>

          <el-form-item label="临时对策" prop="interim_action">
            <el-input
              v-model="formData.interim_action"
              type="textarea"
              :rows="4"
              placeholder="描述短期处理方案、责任人、完成时间及验证方式"
            />
          </el-form-item>
        </div>
      </el-card>

      <el-card class="form-section" shadow="never">
        <template #header>
          <span class="section-title">原因分析与纠正预防</span>
        </template>

        <el-form-item label="原因分析" prop="root_cause">
          <el-input
            v-model="formData.root_cause"
            type="textarea"
            :rows="4"
            placeholder="说明直接原因、根本原因及分析依据，避免仅填写“加强管理/培训”等空泛表述"
          />
        </el-form-item>

        <div class="two-column">
          <el-form-item label="纠正措施" prop="corrective_action">
            <el-input
              v-model="formData.corrective_action"
              type="textarea"
              :rows="4"
              placeholder="针对根本原因填写具体纠正措施、责任人和完成节点"
            />
          </el-form-item>

          <el-form-item label="预防/防再发措施" prop="preventive_action">
            <el-input
              v-model="formData.preventive_action"
              type="textarea"
              :rows="4"
              placeholder="填写标准化、流程防错、横向排查、类似物料展开等防再发措施"
            />
          </el-form-item>
        </div>

        <div class="two-column">
          <el-form-item label="验证结果" prop="verification_result">
            <el-input
              v-model="formData.verification_result"
              type="textarea"
              :rows="4"
              placeholder="填写措施验证数据、复检结果、试产/批量验证结论"
            />
          </el-form-item>

          <el-form-item label="标准化输出">
            <el-input
              v-model="formData.standardization"
              type="textarea"
              :rows="4"
              placeholder="如涉及 SIP、PFMEA、控制计划、作业指导书等文件更新，在此记录"
            />
          </el-form-item>
        </div>
      </el-card>

      <el-card class="form-section attachment-section" shadow="never">
        <template #header>
          <span class="section-title">报告附件</span>
        </template>

        <el-upload
          v-model:file-list="fileList"
          class="report-upload"
          multiple
          :auto-upload="false"
          :disabled="!authStore.isSupplier"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar"
        >
          <el-button type="primary" plain>
            <el-icon><Upload /></el-icon>
            选择报告附件
          </el-button>
          <template #tip>
            <div class="upload-tip">
              用于提交详细 8D 报告、分析图片、验证数据或供应商内部报告。当前先随报告保存附件清单，正式文件存储接口接入后再自动上传。
            </div>
          </template>
        </el-upload>
      </el-card>
    </el-form>

    <div
      v-if="authStore.isInternal && eightDReport?.status === 'submitted'"
      class="review-panel"
    >
      <el-descriptions :column="2" border class="review-summary">
        <el-descriptions-item label="报告状态">
          <el-tag type="warning">{{ getEightDStatusLabel(eightDReport.status) }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="提交人">{{ eightDReport.submitter_name || '-' }}</el-descriptions-item>
        <el-descriptions-item label="提交时间">{{ formatDate(eightDReport.submitted_at) || '-' }}</el-descriptions-item>
        <el-descriptions-item label="审核人">{{ eightDReport.reviewer_name || '-' }}</el-descriptions-item>
      </el-descriptions>

      <el-form :model="reviewForm" label-position="top" class="review-form">
        <el-form-item label="审核意见" required>
          <el-input
            v-model="reviewForm.review_comments"
            type="textarea"
            :rows="3"
            placeholder="填写本次 8D 审核意见"
          />
        </el-form-item>
        <div class="review-actions">
          <el-button type="primary" :loading="reviewing" @click="handleReview(true)">
            批准 8D
          </el-button>
          <el-button type="danger" plain :loading="reviewing" @click="handleReview(false)">
            驳回 8D
          </el-button>
        </div>
      </el-form>
    </div>

    <el-card v-if="aiReviewResult" class="ai-review-card" shadow="never">
      <template #header>
        <span>AI 预审结果</span>
      </template>
      <el-alert
        :title="aiReviewResult.title"
        :type="aiReviewResult.type"
        :description="aiReviewResult.description"
        show-icon
        :closable="false"
      />
    </el-card>

    <el-dialog
      v-model="showScarEditDialog"
      title="编辑SCAR基础信息"
      width="680px"
      destroy-on-close
    >
      <el-form
        ref="scarEditFormRef"
        :model="scarEditForm"
        :rules="scarEditRules"
        label-position="top"
        class="scar-edit-form"
      >
        <div class="two-column">
          <el-form-item label="供应商" prop="supplier_id">
            <el-select
              v-model="scarEditForm.supplier_id"
              filterable
              remote
              reserve-keyword
              :loading="supplierSearchLoading"
              :remote-method="loadSupplierOptions"
              placeholder="按供应商代码/名称检索"
              @visible-change="handleSupplierSelectVisibleChange"
            >
              <el-option
                v-for="supplier in supplierOptions"
                :key="supplier.id"
                :label="formatSupplierOptionLabel(supplier)"
                :value="supplier.id"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="物料编码" prop="material_code">
            <el-input v-model="scarEditForm.material_code" placeholder="请输入物料编码" />
          </el-form-item>

          <el-form-item label="来料分类" prop="material_category">
            <el-select v-model="scarEditForm.material_category" placeholder="请选择来料分类">
              <el-option label="结构料（IQ0）" value="structure" />
              <el-option label="电子料（IQ1）" value="electronic" />
            </el-select>
          </el-form-item>

          <el-form-item label="严重度" prop="severity">
            <el-select v-model="scarEditForm.severity" placeholder="请选择严重度">
              <el-option label="低" value="low" />
              <el-option label="中" value="medium" />
              <el-option label="高" value="high" />
              <el-option label="严重" value="critical" />
            </el-select>
          </el-form-item>

          <el-form-item label="不良数量" prop="defect_qty">
            <el-input-number v-model="scarEditForm.defect_qty" :min="1" :precision="0" />
          </el-form-item>

          <el-form-item label="截止日期" prop="deadline">
            <el-date-picker
              v-model="scarEditForm.deadline"
              type="datetime"
              value-format="YYYY-MM-DD HH:mm:ss"
              placeholder="选择截止日期"
            />
          </el-form-item>
        </div>

        <el-form-item label="缺陷描述" prop="defect_description">
          <el-input
            v-model="scarEditForm.defect_description"
            type="textarea"
            :rows="3"
            placeholder="请输入缺陷描述"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showScarEditDialog = false">取消</el-button>
        <el-button type="primary" :loading="scarEditSaving" @click="handleSaveScarBaseInfo">
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Document, Check, Edit, Upload } from '@element-plus/icons-vue'
import { supplierApi } from '@/api/supplier'
import { useAuthStore } from '@/stores/auth'
import type { EightDReport, SCAR, SCARInternalUserOption, SCARSupplierOption } from '@/types/supplier'
import { isScarRouteName } from '@/utils/problemIssueSummary'

const props = withDefaults(
  defineProps<{
    recordId?: number | string
    workspaceMode?: boolean
    routeAction?: string
    sourceRouteName?: string
    sourceFocusId?: string | number
  }>(),
  {
    recordId: undefined,
    workspaceMode: false,
    routeAction: undefined,
    sourceRouteName: undefined,
    sourceFocusId: undefined,
  }
)

const emit = defineEmits<{
  (event: 'loaded-meta', payload: { title?: string }): void
}>()

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const scarId = computed(() => Number(props.recordId ?? route.params.id))
const workspaceMode = computed(() => props.workspaceMode)
const pageTitle = computed(() => (authStore.isInternal ? '供应商 8D 报告' : '8D 报告填写'))
const scarData = ref<SCAR | null>(null)
const eightDReport = ref<EightDReport | null>(null)
const saving = ref(false)
const submitting = ref(false)
const reviewing = ref(false)
const scarEditSaving = ref(false)
const showScarEditDialog = ref(false)
const supplierSearchLoading = ref(false)
const sqeSearchLoading = ref(false)
const fileList = ref<any[]>([])
const aiReviewResult = ref<any>(null)
const supplierOptions = ref<SCARSupplierOption[]>([])
const sqeOptions = ref<SCARInternalUserOption[]>([])
const reviewForm = reactive({
  review_comments: ''
})

const formData = reactive({
  reviewer_id: undefined as number | undefined,
  material_category: '',
  problem_description: '',
  containment_action: '',
  interim_action: '',
  root_cause: '',
  corrective_action: '',
  preventive_action: '',
  verification_result: '',
  standardization: '',
  horizontal_deployment: ''
})

const formRef = ref()
const scarEditFormRef = ref()

const scarEditForm = reactive({
  supplier_id: undefined as number | undefined,
  material_code: '',
  material_category: '',
  defect_description: '',
  defect_qty: 1,
  severity: 'medium' as 'low' | 'medium' | 'high' | 'critical',
  deadline: ''
})

const rules = {
  problem_description: [{ required: true, message: '请填写问题描述', trigger: 'blur' }],
  containment_action: [{ required: true, message: '请填写围堵/应急措施', trigger: 'blur' }],
  interim_action: [{ required: true, message: '请填写临时对策', trigger: 'blur' }],
  root_cause: [{ required: true, message: '请填写原因分析', trigger: 'blur' }],
  corrective_action: [{ required: true, message: '请填写纠正措施', trigger: 'blur' }],
  preventive_action: [{ required: true, message: '请填写预防/防再发措施', trigger: 'blur' }],
  verification_result: [{ required: true, message: '请填写验证结果', trigger: 'blur' }]
}

const scarEditRules = {
  supplier_id: [{ required: true, message: '请选择供应商', trigger: 'change' }],
  material_code: [{ required: true, message: '请填写物料编码', trigger: 'blur' }],
  material_category: [{ required: true, message: '请选择来料分类', trigger: 'change' }],
  defect_description: [{ required: true, message: '请填写缺陷描述', trigger: 'blur' }],
  defect_qty: [{ required: true, message: '请填写不良数量', trigger: 'change' }],
  severity: [{ required: true, message: '请选择严重度', trigger: 'change' }],
  deadline: [{ required: true, message: '请选择截止日期', trigger: 'change' }]
}

function getSingleQueryValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0]
  }

  return undefined
}

function getDefaultSourceRouteName() {
  return authStore.isInternal ? 'ScarManagement' : 'SCARList'
}

const sourceRouteName = computed(() => {
  const raw = props.sourceRouteName ?? getSingleQueryValue(route.query.sourceRouteName)
  return raw && isScarRouteName(raw) ? raw : getDefaultSourceRouteName()
})

const sourceFocusId = computed(() => {
  const raw = props.sourceFocusId ? String(props.sourceFocusId) : getSingleQueryValue(route.query.sourceFocusId)
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : scarId.value
})

function buildSourceRoute() {
  return {
    name: sourceRouteName.value,
    query: { focusId: String(sourceFocusId.value) },
  }
}

function getMaterialCategoryCode(category?: string) {
  const codeMap: Record<string, string> = {
    structure: '0',
    electronic: '1',
  }
  return codeMap[category || ''] || '?'
}

function getMaterialCategoryLabel(category?: string) {
  const labels: Record<string, string> = {
    structure: '结构料（IQ0）',
    electronic: '电子料（IQ1）',
  }
  return labels[category || ''] || '待选择'
}

function formatYearMonth(value?: string) {
  const date = value ? new Date(value) : new Date()
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date
  const year = String(validDate.getFullYear()).slice(-2)
  const month = String(validDate.getMonth() + 1).padStart(2, '0')
  return `${year}${month}`
}

function formatSequence(value?: number) {
  if (!value || value < 1) {
    return '001'
  }
  return String(((value - 1) % 999) + 1).padStart(3, '0')
}

const displayReportNumber = computed(() => {
  if (!scarData.value) {
    return `ZX8D-IQ?-${formatYearMonth()}-${formatSequence(scarId.value)}`
  }

  const subtype = getMaterialCategoryCode(scarData.value.material_category || formData.material_category)
  const yearMonth = formatYearMonth(scarData.value.created_at)
  const sequence = formatSequence(eightDReport.value?.id || scarData.value.id)
  return `ZX8D-IQ${subtype}-${yearMonth}-${sequence}`
})

const getSeverityType = (severity?: string) => {
  switch (severity) {
    case 'critical': return 'danger'
    case 'high': return 'warning'
    case 'medium': return 'primary'
    default: return 'info'
  }
}

const getSeverityLabel = (severity?: string) => {
  const labels: Record<string, string> = {
    critical: '严重',
    high: '高',
    medium: '中',
    low: '低'
  }
  return labels[severity || ''] || severity || '-'
}

const getScarStatusLabel = (status?: string) => {
  const labels: Record<string, string> = {
    open: '待处理',
    supplier_responding: '供应商应答中',
    under_review: '审核中',
    approved: '已批准',
    rejected: '已驳回',
    closed: '已关闭'
  }
  return labels[status || ''] || status || '-'
}

const getEightDStatusLabel = (status?: string) => {
  const labels: Record<string, string> = {
    draft: '草稿',
    submitted: '待审核',
    approved: '已批准',
    rejected: '已驳回'
  }
  return labels[status || ''] || status || '-'
}

const formatDate = (date?: string) => {
  if (!date) return ''
  return new Date(date).toLocaleDateString('zh-CN')
}

const isOverdue = (deadline?: string) => {
  if (!deadline) return false
  return new Date(deadline) < new Date()
}

function buildInitialProblemDescription(scar: SCAR) {
  const supplier = scar.supplier_name ? `供应商 ${scar.supplier_name}` : '供应商'
  const material = scar.material_code || '待确认物料'
  const category = getMaterialCategoryLabel(scar.material_category || formData.material_category)
  const defect = scar.defect_description || '来料质量异常'
  const qty = scar.defect_qty ? `不良数量 ${scar.defect_qty}` : '不良数量待确认'
  const severity = getSeverityLabel(scar.severity)
  const deadline = formatDate(scar.deadline) || '待确认'

  return `针对 ${supplier}，物料 ${material}（${category}）发现${defect}，${qty}，严重度 ${severity}，要求在 ${deadline} 前完成原因分析、临时围堵、纠正预防措施及验证资料提交。`
}

function buildReportPayload(status: 'draft' | 'submitted') {
  const attachmentSummary = fileList.value.map((file) => ({
    name: file.name,
    status: file.status,
    size: file.size,
    url: file.url,
  }))

  return {
    d0_d3_data: {
      material_category: formData.material_category,
      problem_description: formData.problem_description,
      containment_action: formData.containment_action,
      interim_action: formData.interim_action,
      d2_problem_description: formData.problem_description,
      d0_emergency_action: formData.containment_action,
      d3_interim_action: formData.interim_action,
    },
    d4_d7_data: {
      root_cause: formData.root_cause,
      corrective_action: formData.corrective_action,
      preventive_action: formData.preventive_action,
      verification_result: formData.verification_result,
      standardization: formData.standardization,
      report_attachments: attachmentSummary,
      d4_root_cause: formData.root_cause,
      d5_corrective_action: formData.corrective_action,
      d6_verification: formData.verification_result,
      d7_modified_files: formData.standardization,
    },
    d8_data: {
      horizontal_deployment: formData.horizontal_deployment || formData.preventive_action,
      d8_horizontal_deployment: formData.horizontal_deployment || formData.preventive_action,
    },
    reviewer_id: formData.reviewer_id,
    status
  }
}

function applyEightDReportToForm(report: EightDReport) {
  const d0d3 = report.d0_d3_data || {}
  const d4d7 = report.d4_d7_data || {}
  const d8 = report.d8_data || {}

  formData.problem_description = d0d3.problem_description || d0d3.d2_problem_description || formData.problem_description
  formData.material_category = scarData.value?.material_category || d0d3.material_category || formData.material_category || ''
  formData.containment_action = d0d3.containment_action || d0d3.d0_emergency_action || formData.containment_action
  formData.interim_action = d0d3.interim_action || d0d3.d3_interim_action || formData.interim_action
  formData.root_cause = d4d7.root_cause || d4d7.d4_root_cause || ''
  formData.corrective_action = d4d7.corrective_action || d4d7.d5_corrective_action || ''
  formData.preventive_action = d4d7.preventive_action || d4d7.standardization || ''
  formData.verification_result = d4d7.verification_result || d4d7.d6_verification || ''
  formData.standardization = d4d7.standardization || d4d7.d7_modified_files || ''
  formData.horizontal_deployment = d8.horizontal_deployment || d8.d8_horizontal_deployment || ''

  const attachments = d4d7.report_attachments || []
  fileList.value = Array.isArray(attachments)
    ? attachments.map((file: any, index: number) => ({
        name: file?.name || `附件${index + 1}`,
        status: file?.status || 'ready',
        url: file?.url,
        size: file?.size,
      }))
    : []
}

const goBack = () => {
  router.push(buildSourceRoute())
}

function formatDateTimeForPicker(value?: string) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`
}

function formatSQEOptionLabel(user: SCARInternalUserOption) {
  const meta = [user.department, user.position].filter(Boolean).join(' / ')
  return meta ? `${user.full_name}（${meta}）` : `${user.full_name}（${user.username}）`
}

function formatSupplierOptionLabel(supplier: SCARSupplierOption) {
  return supplier.code ? `${supplier.code} - ${supplier.name}` : supplier.name
}

async function loadSupplierOptions(keyword = '') {
  try {
    supplierSearchLoading.value = true
    supplierOptions.value = await supplierApi.getSCARSupplierOptions({ keyword, limit: 20 })
  } catch (error) {
    console.error('Failed to load supplier options:', error)
    ElMessage.error('加载供应商选项失败')
  } finally {
    supplierSearchLoading.value = false
  }
}

async function loadSQEOptions(keyword = '') {
  try {
    sqeSearchLoading.value = true
    sqeOptions.value = await supplierApi.getSCARSQEOptions({ keyword, limit: 20 })
  } catch (error) {
    console.error('Failed to load SQE options:', error)
    ElMessage.error('加载供应商质量工程师失败')
  } finally {
    sqeSearchLoading.value = false
  }
}

function handleSupplierSelectVisibleChange(visible: boolean) {
  if (visible && supplierOptions.value.length === 0) {
    void loadSupplierOptions()
  }
}

function handleSQESelectVisibleChange(visible: boolean) {
  if (visible && sqeOptions.value.length === 0) {
    void loadSQEOptions()
  }
}

function openScarEditDialog() {
  if (!scarData.value) {
    return
  }

  scarEditForm.supplier_id = scarData.value.supplier_id
  scarEditForm.material_code = scarData.value.material_code || ''
  scarEditForm.material_category = scarData.value.material_category || ''
  scarEditForm.defect_description = scarData.value.defect_description || ''
  scarEditForm.defect_qty = scarData.value.defect_qty || 1
  scarEditForm.severity = scarData.value.severity || 'medium'
  scarEditForm.deadline = formatDateTimeForPicker(scarData.value.deadline)
  supplierOptions.value = scarData.value.supplier_id && scarData.value.supplier_name
    ? [{
        id: scarData.value.supplier_id,
        code: '',
        name: scarData.value.supplier_name,
        status: 'active',
      }]
    : supplierOptions.value
  showScarEditDialog.value = true
}

async function handleSaveScarBaseInfo() {
  if (!scarEditFormRef.value || !scarData.value) {
    return
  }

  try {
    await scarEditFormRef.value.validate()
    scarEditSaving.value = true
    const updated = await supplierApi.updateSCAR(scarId.value, {
      supplier_id: scarEditForm.supplier_id,
      material_code: scarEditForm.material_code,
      material_category: scarEditForm.material_category,
      defect_description: scarEditForm.defect_description,
      defect_qty: scarEditForm.defect_qty,
      severity: scarEditForm.severity,
      deadline: scarEditForm.deadline,
    } as any)

    scarData.value = {
      ...scarData.value,
      ...updated,
    }
    formData.material_category = updated.material_category || ''
    if (!eightDReport.value) {
      formData.problem_description = buildInitialProblemDescription(updated)
    }
    emit('loaded-meta', { title: displayReportNumber.value })
    showScarEditDialog.value = false
    ElMessage.success('SCAR基础信息已更新')
  } catch (error) {
    console.error('Failed to update SCAR base info:', error)
    ElMessage.error('保存SCAR基础信息失败')
  } finally {
    scarEditSaving.value = false
  }
}

function ensureMaterialCategoryReady() {
  if (formData.material_category) {
    return true
  }

  ElMessage.warning(authStore.isInternal ? '请先选择来料分类' : '请先由内部人员补充来料分类')
  return false
}

function ensureReviewerReady() {
  if (!authStore.isSupplier || formData.reviewer_id) {
    return true
  }

  ElMessage.warning('提交前请选择供应商质量工程师')
  return false
}

const handleSaveDraft = async () => {
  if (!ensureMaterialCategoryReady()) {
    return
  }

  try {
    saving.value = true
    const report = await supplierApi.submit8DReport(scarId.value, buildReportPayload('draft') as any)
    eightDReport.value = report
    applyEightDReportToForm(report)
    ElMessage.success('草稿已保存')
  } catch (error) {
    console.error('Failed to save draft:', error)
    ElMessage.error('保存草稿失败')
  } finally {
    saving.value = false
  }
}

const handleSubmit = async () => {
  if (!ensureMaterialCategoryReady()) {
    return
  }

  if (!ensureReviewerReady()) {
    return
  }

  try {
    await formRef.value.validate()

    await ElMessageBox.confirm(
      '提交后将进入内部审核，请确认 8D 报告内容和附件清单已完成。',
      '确认提交',
      {
        confirmButtonText: '确认提交',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    submitting.value = true
    const report = await supplierApi.submit8DReport(scarId.value, buildReportPayload('submitted') as any)
    eightDReport.value = report
    applyEightDReportToForm(report)
    await loadSCARData()
    ElMessage.success('8D 报告已提交')
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Failed to submit 8D report:', error)
      ElMessage.error('提交失败')
    }
  } finally {
    submitting.value = false
  }
}

const loadEightDReport = async () => {
  eightDReport.value = null

  if (!scarData.value?.has_8d_report) {
    return
  }

  try {
    const report = await supplierApi.get8DReport(scarId.value)
    eightDReport.value = report
    applyEightDReportToForm(report)
  } catch (error: any) {
    if (error?.response?.status !== 404) {
      console.error('Failed to load 8D report:', error)
      ElMessage.error('加载 8D 报告失败')
    }
  }
}

const handleReview = async (approved: boolean) => {
  const reviewComments = reviewForm.review_comments.trim()
  if (!reviewComments) {
    ElMessage.warning('请先填写审核意见')
    return
  }

  try {
    reviewing.value = true
    const payload = {
      approved,
      review_comments: reviewComments
    }
    const report = approved
      ? await supplierApi.review8DReport(scarId.value, payload)
      : await supplierApi.reject8DReport(scarId.value, payload)

    eightDReport.value = report
    reviewForm.review_comments = ''
    ElMessage.success(approved ? '8D 已批准' : '8D 已驳回')
    await loadSCARData()
  } catch (error) {
    console.error('Failed to review 8D report:', error)
    ElMessage.error('8D 审核操作失败')
  } finally {
    reviewing.value = false
  }
}

const loadSCARData = async () => {
  try {
    scarData.value = await supplierApi.getSCAR(scarId.value)
    formData.material_category = scarData.value.material_category || formData.material_category || ''
    if (!formData.problem_description.trim()) {
      formData.problem_description = buildInitialProblemDescription(scarData.value)
    }
    await loadEightDReport()
    if (authStore.isSupplier && sqeOptions.value.length === 0) {
      await loadSQEOptions()
    }
    emit('loaded-meta', { title: displayReportNumber.value })
  } catch (error) {
    console.error('Failed to load SCAR data:', error)
    ElMessage.error('加载 SCAR 数据失败')
  }
}

onMounted(() => {
  loadSCARData()
})
</script>

<style scoped lang="scss">
.eight-d-form {
  padding: 18px 20px 28px;

  .page-header {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 16px;

    h2 {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      color: #122033;
    }
  }

  .report-shell,
  .form-section,
  .review-panel,
  .ai-review-card {
    width: min(1160px, 100%);
    margin: 0 auto 18px;
    border: 1px solid #dbe5f0;
    border-radius: 14px;
  }

  .report-shell {
    border: none !important;
    background: transparent;

    :deep(.el-card__header) {
      padding: 0 0 14px;
      border-bottom: 0;
    }

    :deep(.el-card__body) {
      padding: 0;
    }
  }

  .report-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;

    .eyebrow {
      margin-bottom: 4px;
      color: #5d7698;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }

    h2 {
      margin: 0;
      color: #0f1f33;
      font-size: 24px;
      font-weight: 800;
      letter-spacing: 0.01em;
    }

    .report-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
  }

  .scar-summary {
    :deep(.el-descriptions__label) {
      width: 150px;
      color: #31435c;
      font-weight: 700;
      background: #f5f8fc;
    }

    :deep(.el-descriptions__content) {
      color: #17263a;
    }

    .material-category-select {
      width: 180px;
    }
  }

  .reviewer-picker {
    display: flex;
    align-items: center;
    gap: 12px;
    width: min(520px, 100%);
    margin-top: 14px;

    .reviewer-picker__label {
      flex-shrink: 0;
      color: #22344d;
      font-weight: 700;
    }

    .el-select {
      flex: 1;
      min-width: 260px;
    }
  }

  .report-form {
    width: min(1160px, 100%);
    margin: 0 auto;
  }

  .form-section {
    :deep(.el-card__header) {
      padding: 18px 24px;
      border-bottom-color: #e5edf5;
    }

    :deep(.el-card__body) {
      padding: 22px 26px 24px;
    }

    .section-title {
      color: #13243a;
      font-size: 17px;
      font-weight: 800;
    }

    :deep(.el-form-item__label) {
      padding-bottom: 8px;
      color: #22344d;
      font-weight: 700;
      line-height: 1.2;
    }

    :deep(.el-textarea__inner) {
      line-height: 1.65;
    }
  }

  .two-column {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 18px 22px;
  }

  .attachment-section {
    .report-upload {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
    }

    .upload-tip {
      max-width: 760px;
      color: #71819a;
      font-size: 13px;
      line-height: 1.6;
    }
  }

  .review-panel {
    padding: 22px 26px;
    background: #ffffff;

    .review-summary {
      margin-bottom: 18px;
    }

    .review-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }
  }

  .scar-edit-form {
    .el-select,
    .el-date-editor {
      width: 100%;
    }
  }

  .text-danger {
    color: #d84343;
    font-weight: 700;
  }

  @media (max-width: 900px) {
    padding: 12px;

    .report-heading {
      align-items: flex-start;
      flex-direction: column;

      .report-actions {
        width: 100%;
        justify-content: flex-end;
      }
    }

    .two-column {
      grid-template-columns: 1fr;
    }
  }
}
</style>
