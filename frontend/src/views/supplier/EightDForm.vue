<template>
  <div class="eight-d-form">
    <!-- 页面标题 -->
    <div class="page-header">
      <el-button v-if="!workspaceMode" @click="goBack" circle>
        <el-icon><ArrowLeft /></el-icon>
      </el-button>
      <h2>{{ pageTitle }}</h2>
      <div v-if="authStore.isSupplier" class="header-actions">
        <el-button @click="handleSaveDraft" :loading="saving">
          <el-icon><Document /></el-icon>
          保存草稿
        </el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">
          <el-icon><Check /></el-icon>
          提交报告
        </el-button>
      </div>
    </div>

    <!-- SCAR 基本信息 -->
    <el-card class="scar-info-card" shadow="never">
      <template #header>
        <span>SCAR 单据信息</span>
      </template>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="单据编号">{{ scarData?.scar_number }}</el-descriptions-item>
        <el-descriptions-item label="物料编码">{{ scarData?.material_code }}</el-descriptions-item>
        <el-descriptions-item label="缺陷描述" :span="2">
          {{ scarData?.defect_description }}
        </el-descriptions-item>
        <el-descriptions-item label="不良数量">{{ scarData?.defect_qty }}</el-descriptions-item>
        <el-descriptions-item label="严重度">
          <el-tag :type="getSeverityType(scarData?.severity)">
            {{ getSeverityLabel(scarData?.severity) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="截止日期">
          <span :class="{ 'text-danger': isOverdue(scarData?.deadline) }">
            {{ formatDate(scarData?.deadline) }}
          </span>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <!-- 8D 报告表单 -->
    <el-form :model="formData" :rules="rules" ref="formRef" label-width="120px" :disabled="!authStore.isSupplier">
      <!-- D0-D3: 紧急响应措施 -->
      <el-card class="form-section" shadow="never">
        <template #header>
          <span class="section-title">D0-D3: 紧急响应措施</span>
        </template>

        <el-form-item label="D0: 紧急措施" prop="d0_emergency_action">
          <el-input
            v-model="formData.d0_emergency_action"
            type="textarea"
            :rows="3"
            placeholder="描述已采取的紧急围堵措施（如：隔离在途品、库存品、客户端库存）"
          />
        </el-form-item>

        <el-form-item label="D1: 团队组建" prop="d1_team_members">
          <el-input
            v-model="formData.d1_team_members"
            type="textarea"
            :rows="2"
            placeholder="列出8D团队成员及职责"
          />
        </el-form-item>

        <el-form-item label="D2: 问题描述" prop="d2_problem_description">
          <el-input
            v-model="formData.d2_problem_description"
            type="textarea"
            :rows="3"
            placeholder="使用5W2H描述问题（What, When, Where, Who, Why, How, How Many）"
          />
        </el-form-item>

        <el-form-item label="D3: 临时对策" prop="d3_interim_action">
          <el-input
            v-model="formData.d3_interim_action"
            type="textarea"
            :rows="3"
            placeholder="描述临时对策及验证结果"
          />
        </el-form-item>
      </el-card>

      <!-- D4-D7: 根本原因与纠正措施 -->
      <el-card class="form-section" shadow="never">
        <template #header>
          <span class="section-title">D4-D7: 根本原因与纠正措施</span>
        </template>

        <el-form-item label="D4: 根本原因" prop="d4_root_cause">
          <el-input
            v-model="formData.d4_root_cause"
            type="textarea"
            :rows="4"
            placeholder="使用5Why、鱼骨图、FTA等工具分析根本原因"
          />
          <div class="form-tip">
            <el-icon><InfoFilled /></el-icon>
            提示：请避免使用"加强培训"、"加强管理"等空洞词汇，需提供具体的分析过程
          </div>
        </el-form-item>

        <el-form-item label="D5: 纠正措施" prop="d5_corrective_action">
          <el-input
            v-model="formData.d5_corrective_action"
            type="textarea"
            :rows="4"
            placeholder="描述针对根本原因的纠正措施"
          />
        </el-form-item>

        <el-form-item label="D6: 验证报告" prop="d6_verification">
          <el-input
            v-model="formData.d6_verification"
            type="textarea"
            :rows="3"
            placeholder="描述对策验证结果"
          />
          <el-upload
            class="upload-section"
            :action="uploadUrl"
            :headers="uploadHeaders"
            :on-success="handleUploadSuccess"
            :file-list="fileList"
            multiple
          >
            <el-button type="primary">
              <el-icon><Upload /></el-icon>
              上传验证报告
            </el-button>
            <template #tip>
              <div class="el-upload__tip">
                支持上传测试数据、验证报告等附件（必填）
              </div>
            </template>
          </el-upload>
        </el-form-item>

        <el-form-item label="D7: 标准化" prop="d7_standardization">
          <el-checkbox v-model="formData.d7_file_modified">涉及文件修改</el-checkbox>
          <el-input
            v-if="formData.d7_file_modified"
            v-model="formData.d7_modified_files"
            type="textarea"
            :rows="2"
            placeholder="列出修改的文件（如：PFMEA、控制计划、作业指导书等）"
            style="margin-top: 10px;"
          />
          <el-upload
            v-if="formData.d7_file_modified"
            class="upload-section"
            :action="uploadUrl"
            :headers="uploadHeaders"
            :on-success="handleUploadSuccess"
            :file-list="d7FileList"
            multiple
          >
            <el-button type="primary">
              <el-icon><Upload /></el-icon>
              上传修改后的文件
            </el-button>
          </el-upload>
        </el-form-item>
      </el-card>

      <!-- D8: 水平展开与经验教训 -->
      <el-card class="form-section" shadow="never">
        <template #header>
          <span class="section-title">D8: 水平展开与经验教训</span>
        </template>

        <el-form-item label="水平展开" prop="d8_horizontal_deployment">
          <el-input
            v-model="formData.d8_horizontal_deployment"
            type="textarea"
            :rows="3"
            placeholder="描述对策在类似产品/工艺中的推广情况"
          />
        </el-form-item>

        <el-form-item label="经验教训">
          <el-checkbox v-model="formData.d8_save_lesson">沉淀为经验教训</el-checkbox>
          <el-input
            v-if="formData.d8_save_lesson"
            v-model="formData.d8_lesson_learned"
            type="textarea"
            :rows="3"
            placeholder="总结本次问题的经验教训，用于后续项目参考"
            style="margin-top: 10px;"
          />
        </el-form-item>

        <el-form-item label="团队祝贺" prop="d8_team_congratulation">
          <el-input
            v-model="formData.d8_team_congratulation"
            type="textarea"
            :rows="2"
            placeholder="对团队的肯定与感谢"
          />
        </el-form-item>
      </el-card>
    </el-form>

    <el-card v-if="authStore.isInternal" class="review-card" shadow="never">
      <template #header>
        <span>8D 审核</span>
      </template>

      <el-alert
        v-if="!eightDReport"
        title="尚未查询到供应商提交的 8D 报告"
        type="info"
        show-icon
        :closable="false"
      />
      <template v-else>
        <el-descriptions :column="2" border class="review-summary">
          <el-descriptions-item label="报告状态">
            <el-tag :type="eightDReport.status === 'submitted' ? 'warning' : 'info'">
              {{ getEightDStatusLabel(eightDReport.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="提交人">{{ eightDReport.submitter_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="提交时间">{{ formatDate(eightDReport.submitted_at) }}</el-descriptions-item>
          <el-descriptions-item label="审核人">{{ eightDReport.reviewer_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="审核意见" :span="2">
            {{ eightDReport.review_comments || '-' }}
          </el-descriptions-item>
        </el-descriptions>

        <el-form
          v-if="eightDReport.status === 'submitted'"
          :model="reviewForm"
          label-width="120px"
          class="review-form"
        >
          <el-form-item label="审核意见" required>
            <el-input
              v-model="reviewForm.review_comments"
              type="textarea"
              :rows="3"
              placeholder="请填写本次 8D 审核意见"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="reviewing" @click="handleReview(true)">
              批准 8D
            </el-button>
            <el-button type="danger" plain :loading="reviewing" @click="handleReview(false)">
              驳回 8D
            </el-button>
          </el-form-item>
        </el-form>
      </template>
    </el-card>

    <!-- AI 预审结果（如果有） -->
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { 
  ArrowLeft, 
  Document, 
  Check, 
  Upload, 
  InfoFilled 
} from '@element-plus/icons-vue'
import { supplierApi } from '@/api/supplier'
import { useAuthStore } from '@/stores/auth'
import type { EightDReport, SCAR } from '@/types/supplier'
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
const pageTitle = computed(() => (authStore.isInternal ? 'SCAR 8D 审核' : '8D 报告填写'))
const scarData = ref<SCAR | null>(null)
const eightDReport = ref<EightDReport | null>(null)
const saving = ref(false)
const submitting = ref(false)
const reviewing = ref(false)
const fileList = ref<any[]>([])
const d7FileList = ref<any[]>([])
const aiReviewResult = ref<any>(null)
const reviewForm = reactive({
  review_comments: ''
})

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

const currentAction = computed(() => props.routeAction ?? getSingleQueryValue(route.query.action))

function buildSourceRoute() {
  return {
    name: sourceRouteName.value,
    query: { focusId: String(sourceFocusId.value) },
  }
}

// 表单数据
const formData = reactive({
  d0_emergency_action: '',
  d1_team_members: '',
  d2_problem_description: '',
  d3_interim_action: '',
  d4_root_cause: '',
  d5_corrective_action: '',
  d6_verification: '',
  d7_file_modified: false,
  d7_modified_files: '',
  d8_horizontal_deployment: '',
  d8_save_lesson: false,
  d8_lesson_learned: '',
  d8_team_congratulation: ''
})

const formRef = ref()

// 表单验证规则
const rules = {
  d0_emergency_action: [{ required: true, message: '请填写紧急措施', trigger: 'blur' }],
  d1_team_members: [{ required: true, message: '请填写团队成员', trigger: 'blur' }],
  d2_problem_description: [{ required: true, message: '请填写问题描述', trigger: 'blur' }],
  d3_interim_action: [{ required: true, message: '请填写临时对策', trigger: 'blur' }],
  d4_root_cause: [{ required: true, message: '请填写根本原因', trigger: 'blur' }],
  d5_corrective_action: [{ required: true, message: '请填写纠正措施', trigger: 'blur' }],
  d6_verification: [{ required: true, message: '请填写验证结果', trigger: 'blur' }],
  d8_horizontal_deployment: [{ required: true, message: '请填写水平展开情况', trigger: 'blur' }]
}

// 上传地址和请求头
const uploadUrl = computed(() => `${import.meta.env.VITE_API_BASE_URL}/v1/upload`)
const uploadHeaders = computed(() => ({
  Authorization: `Bearer ${localStorage.getItem('access_token')}`
}))

// 获取严重度类型
const getSeverityType = (severity?: string) => {
  switch (severity) {
    case 'critical': return 'danger'
    case 'high': return 'warning'
    case 'medium': return 'primary'
    default: return 'info'
  }
}

// 获取严重度标签
const getSeverityLabel = (severity?: string) => {
  const labels: Record<string, string> = {
    critical: '严重',
    high: '高',
    medium: '中',
    low: '低'
  }
  return labels[severity || ''] || severity
}

// 格式化日期
const formatDate = (date?: string) => {
  if (!date) return ''
  return new Date(date).toLocaleDateString('zh-CN')
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

// 判断是否逾期
const isOverdue = (deadline?: string) => {
  if (!deadline) return false
  return new Date(deadline) < new Date()
}

// 文件上传成功
const handleUploadSuccess = () => {
  ElMessage.success('文件上传成功')
}

// 返回
const goBack = () => {
  router.push(buildSourceRoute())
}

// 保存草稿
const handleSaveDraft = async () => {
  try {
    saving.value = true
    const reportData: any = {
      d0_d3_data: {
        d0_emergency_action: formData.d0_emergency_action,
        d1_team_members: formData.d1_team_members,
        d2_problem_description: formData.d2_problem_description,
        d3_interim_action: formData.d3_interim_action
      },
      d4_d7_data: {
        d4_root_cause: formData.d4_root_cause,
        d5_corrective_action: formData.d5_corrective_action,
        d6_verification: formData.d6_verification,
        d7_file_modified: formData.d7_file_modified,
        d7_modified_files: formData.d7_modified_files
      },
      d8_data: {
        d8_horizontal_deployment: formData.d8_horizontal_deployment,
        d8_save_lesson: formData.d8_save_lesson,
        d8_lesson_learned: formData.d8_lesson_learned,
        d8_team_congratulation: formData.d8_team_congratulation
      },
      status: 'draft'
    }
    await supplierApi.submit8DReport(scarId.value, reportData)
    ElMessage.success('草稿保存成功')
  } catch (error) {
    console.error('Failed to save draft:', error)
    ElMessage.error('保存草稿失败')
  } finally {
    saving.value = false
  }
}

// 提交报告
const handleSubmit = async () => {
  try {
    await formRef.value.validate()
    
    // 确认提交
    await ElMessageBox.confirm(
      '提交后将无法修改，确认提交8D报告吗？',
      '确认提交',
      {
        confirmButtonText: '确认',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    submitting.value = true
    const reportData: any = {
      d0_d3_data: {
        d0_emergency_action: formData.d0_emergency_action,
        d1_team_members: formData.d1_team_members,
        d2_problem_description: formData.d2_problem_description,
        d3_interim_action: formData.d3_interim_action
      },
      d4_d7_data: {
        d4_root_cause: formData.d4_root_cause,
        d5_corrective_action: formData.d5_corrective_action,
        d6_verification: formData.d6_verification,
        d7_file_modified: formData.d7_file_modified,
        d7_modified_files: formData.d7_modified_files
      },
      d8_data: {
        d8_horizontal_deployment: formData.d8_horizontal_deployment,
        d8_save_lesson: formData.d8_save_lesson,
        d8_lesson_learned: formData.d8_lesson_learned,
        d8_team_congratulation: formData.d8_team_congratulation
      },
      status: 'submitted'
    }
    await supplierApi.submit8DReport(scarId.value, reportData)
    ElMessage.success('8D报告提交成功')
    router.push(buildSourceRoute())
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Failed to submit 8D report:', error)
      ElMessage.error('提交失败')
    }
  } finally {
    submitting.value = false
  }
}

const applyEightDReportToForm = (report: EightDReport) => {
  if (report.d0_d3_data) {
    Object.assign(formData, report.d0_d3_data)
  }
  if (report.d4_d7_data) {
    Object.assign(formData, report.d4_d7_data)
  }
  if (report.d8_data) {
    Object.assign(formData, report.d8_data)
  }
}

const loadEightDReport = async () => {
  eightDReport.value = null

  if (!scarData.value?.has_8d_report && currentAction.value !== 'review') {
    return
  }

  try {
    const report = await supplierApi.get8DReport(scarId.value)
    eightDReport.value = report
    applyEightDReportToForm(report)
  } catch (error) {
    console.error('Failed to load 8D report:', error)
    if (currentAction.value === 'review') {
      ElMessage.warning('尚未查询到可审核的 8D 报告')
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
    ElMessage.success(approved ? '8D 审核已批准' : '8D 审核已驳回')
    await loadSCARData()
  } catch (error) {
    console.error('Failed to review 8D report:', error)
    ElMessage.error('8D 审核操作失败')
  } finally {
    reviewing.value = false
  }
}

// 加载 SCAR 数据
const loadSCARData = async () => {
  try {
    scarData.value = await supplierApi.getSCAR(scarId.value)
    emit('loaded-meta', { title: scarData.value?.scar_number || `SCAR 8D #${scarId.value}` })
    await loadEightDReport()
  } catch (error) {
    console.error('Failed to load SCAR data:', error)
    ElMessage.error('加载SCAR数据失败')
  }
}

onMounted(() => {
  loadSCARData()
})
</script>

<style scoped lang="scss">
.eight-d-form {
  padding: 20px;

  .page-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 20px;

    h2 {
      flex: 1;
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }

    .header-actions {
      display: flex;
      gap: 12px;
    }
  }

  .scar-info-card {
    margin-bottom: 20px;
  }

  .form-section {
    margin-bottom: 20px;

    .section-title {
      font-weight: 600;
      font-size: 16px;
    }

    .form-tip {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
      padding: 8px 12px;
      background: #f0f9ff;
      border-radius: 4px;
      color: #409eff;
      font-size: 14px;
    }

    .upload-section {
      margin-top: 12px;
    }
  }

  .review-card {
    margin-bottom: 20px;

    .review-summary {
      margin-bottom: 18px;
    }

    .review-form {
      margin-top: 18px;
    }
  }

  .ai-review-card {
    margin-top: 20px;
  }

  .text-danger {
    color: #f56c6c;
  }

  // 响应式布局
  @media (max-width: 768px) {
    padding: 10px;

    .page-header {
      flex-wrap: wrap;

      h2 {
        font-size: 20px;
      }

      .header-actions {
        width: 100%;
        justify-content: flex-end;
      }
    }
  }
}
</style>
