<template>
  <div class="process-issue-detail">
    <div class="mb-4">
      <el-button :icon="ArrowLeft" @click="handleBack">返回列表</el-button>
    </div>

    <el-card v-loading="loading">
      <template #header>
        <div class="flex justify-between items-center">
          <div>
            <h2 class="text-xl font-bold">{{ issueDetail?.issue_number }}</h2>
            <div class="mt-2 flex items-center gap-4">
              <el-tag :type="getProcessIssueStatusType(issueDetail?.status)">
                {{ getProcessIssueStatusLabel(issueDetail?.status) }}
              </el-tag>
              <el-tag v-if="issueDetail?.is_overdue" type="danger">逾期</el-tag>
              <span class="text-sm text-gray-500">
                创建时间: {{ formatDateTime(issueDetail?.created_at) }}
              </span>
            </div>
          </div>
        </div>
      </template>

      <el-descriptions title="问题信息" :column="2" border class="mb-6">
        <el-descriptions-item label="问题描述" :span="2">
          <div class="whitespace-pre-wrap">{{ issueDetail?.issue_description }}</div>
        </el-descriptions-item>
        <el-descriptions-item label="责任类别">
          <el-tag :type="getResponsibilityTagType(issueDetail?.responsibility_category)">
            {{ getResponsibilityLabel(issueDetail?.responsibility_category) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="当前处理人">
          {{ assignedUserLabel }}
        </el-descriptions-item>
        <el-descriptions-item label="验证期">
          {{ issueDetail?.verification_period ? `${issueDetail.verification_period} 天` : '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="验证截止日期">
          {{ issueDetail?.verification_end_date || '-' }}
        </el-descriptions-item>
      </el-descriptions>

      <el-card v-if="issueDetail?.root_cause" class="mb-4" shadow="never">
        <template #header>
          <span class="font-semibold">根本原因分析</span>
        </template>
        <div class="whitespace-pre-wrap">{{ issueDetail.root_cause }}</div>
      </el-card>

      <el-card v-if="issueDetail?.containment_action" class="mb-4" shadow="never">
        <template #header>
          <span class="font-semibold">围堵措施</span>
        </template>
        <div class="whitespace-pre-wrap">{{ issueDetail.containment_action }}</div>
      </el-card>

      <el-card v-if="issueDetail?.corrective_action" class="mb-4" shadow="never">
        <template #header>
          <span class="font-semibold">纠正措施</span>
        </template>
        <div class="whitespace-pre-wrap">{{ issueDetail.corrective_action }}</div>
      </el-card>

      <el-card v-if="evidenceFiles.length > 0" class="mb-4" shadow="never">
        <template #header>
          <span class="font-semibold">改善证据</span>
        </template>
        <div class="evidence-list">
          <div v-for="(file, index) in evidenceFiles" :key="index" class="evidence-item">
            <el-link :href="file" target="_blank" type="primary">
              <el-icon><Document /></el-icon>
              {{ getFileName(file) }}
            </el-link>
          </div>
        </div>
      </el-card>

      <div class="action-buttons mt-6 flex gap-4">
        <el-button
          v-if="canRespond"
          type="primary"
          size="large"
          @click="showResponseDialog = true"
        >
          填写分析和对策
        </el-button>

        <el-button
          v-if="canVerify"
          type="success"
          size="large"
          @click="showVerifyDialog = true"
        >
          验证对策有效性
        </el-button>

        <el-button
          v-if="canClose"
          type="warning"
          size="large"
          @click="showCloseDialog = true"
        >
          关闭问题单
        </el-button>
      </div>
    </el-card>

    <el-dialog
      v-model="showResponseDialog"
      title="填写分析和对策"
      width="90%"
      class="max-w-3xl"
      :close-on-click-modal="false"
    >
      <el-form
        ref="responseFormRef"
        :model="responseForm"
        :rules="responseRules"
        label-width="120px"
      >
        <el-form-item label="根本原因" prop="root_cause">
          <el-input
            v-model="responseForm.root_cause"
            type="textarea"
            :rows="4"
            placeholder="请详细描述根本原因分析（至少20字）"
            maxlength="2000"
            show-word-limit
          />
        </el-form-item>

        <el-form-item label="围堵措施" prop="containment_action">
          <el-input
            v-model="responseForm.containment_action"
            type="textarea"
            :rows="3"
            placeholder="请描述围堵措施（至少10字）"
            maxlength="1000"
            show-word-limit
          />
        </el-form-item>

        <el-form-item label="纠正措施" prop="corrective_action">
          <el-input
            v-model="responseForm.corrective_action"
            type="textarea"
            :rows="4"
            placeholder="请描述纠正措施（至少20字）"
            maxlength="2000"
            show-word-limit
          />
        </el-form-item>

        <el-form-item label="验证期" prop="verification_period">
          <el-input-number
            v-model="responseForm.verification_period"
            :min="1"
            :max="90"
            placeholder="请输入验证期天数"
          />
          <span class="ml-2 text-sm text-gray-500">天</span>
        </el-form-item>

        <el-form-item label="改善证据">
          <el-input
            v-model="evidenceInput"
            placeholder="请输入证据文件路径（多个路径用逗号分隔）"
          />
          <div class="text-xs text-gray-500 mt-1">
            示例: /uploads/evidence/photo1.jpg, /uploads/evidence/report.pdf
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showResponseDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmitResponse">
          提交
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showVerifyDialog"
      title="验证对策有效性"
      width="90%"
      class="max-w-xl"
      :close-on-click-modal="false"
    >
      <el-form
        ref="verifyFormRef"
        :model="verifyForm"
        :rules="verifyRules"
        label-width="120px"
      >
        <el-form-item label="验证结果" prop="verification_result">
          <el-radio-group v-model="verifyForm.verification_result">
            <el-radio :label="true">有效</el-radio>
            <el-radio :label="false">无效</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="验证意见">
          <el-input
            v-model="verifyForm.verification_comments"
            type="textarea"
            :rows="4"
            placeholder="请输入验证意见（可选）"
            maxlength="1000"
            show-word-limit
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showVerifyDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmitVerify">
          提交
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showCloseDialog"
      title="关闭问题单"
      width="90%"
      class="max-w-xl"
      :close-on-click-modal="false"
    >
      <el-form :model="closeForm" label-width="120px">
        <el-form-item label="关闭备注">
          <el-input
            v-model="closeForm.close_comments"
            type="textarea"
            :rows="4"
            placeholder="请输入关闭备注（可选）"
            maxlength="500"
            show-word-limit
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showCloseDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmitClose">
          确认关闭
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { ArrowLeft, Document } from '@element-plus/icons-vue'

import { problemManagementApi } from '@/api/problem-management'
import { closeProcessIssue, getProcessIssue, respondToProcessIssue, verifyProcessIssue } from '@/api/process-quality'
import { useAuthStore } from '@/stores/auth'
import type { InternalUserOption } from '@/types/problem-management'
import type {
  ProcessIssue,
  ProcessIssueClose,
  ProcessIssueResponse,
  ProcessIssueVerification,
  ResponsibilityCategory,
} from '@/types/process-quality'
import { buildInternalUserLabelMap } from '@/utils/internalUsers'
import {
  canCloseProcessIssue,
  canRespondToProcessIssue,
  canVerifyProcessIssue,
  getProcessIssueStatusLabel,
  getProcessIssueStatusType,
} from '@/utils/processIssue'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const loading = ref(false)
const submitting = ref(false)
const issueDetail = ref<ProcessIssue | null>(null)
const showResponseDialog = ref(false)
const showVerifyDialog = ref(false)
const showCloseDialog = ref(false)
const evidenceInput = ref('')
const internalUsers = ref<InternalUserOption[]>([])

const responseFormRef = ref<FormInstance>()
const verifyFormRef = ref<FormInstance>()
const internalUserLabelMap = computed(() => buildInternalUserLabelMap(internalUsers.value))

const responseForm = reactive<ProcessIssueResponse>({
  root_cause: '',
  containment_action: '',
  corrective_action: '',
  verification_period: 7,
  evidence_files: [],
})

const verifyForm = reactive<ProcessIssueVerification>({
  verification_result: true,
  verification_comments: '',
})

const closeForm = reactive<ProcessIssueClose>({
  close_comments: '',
})

const responseRules: FormRules = {
  root_cause: [
    { required: true, message: '请输入根本原因分析', trigger: 'blur' },
    { min: 20, max: 2000, message: '根本原因分析长度在 20 到 2000 个字符之间', trigger: 'blur' },
  ],
  containment_action: [
    { required: true, message: '请输入围堵措施', trigger: 'blur' },
    { min: 10, max: 1000, message: '围堵措施长度在 10 到 1000 个字符之间', trigger: 'blur' },
  ],
  corrective_action: [
    { required: true, message: '请输入纠正措施', trigger: 'blur' },
    { min: 20, max: 2000, message: '纠正措施长度在 20 到 2000 个字符之间', trigger: 'blur' },
  ],
  verification_period: [
    { required: true, message: '请输入验证期', trigger: 'blur' },
    { type: 'number', min: 1, max: 90, message: '验证期必须在 1 到 90 天之间', trigger: 'blur' },
  ],
}

const verifyRules: FormRules = {
  verification_result: [{ required: true, message: '请选择验证结果', trigger: 'change' }],
}

const evidenceFiles = computed(() => {
  if (!issueDetail.value?.evidence_files) {
    return []
  }

  try {
    return JSON.parse(issueDetail.value.evidence_files)
  } catch {
    return []
  }
})

const canRespond = computed(() =>
  canRespondToProcessIssue(issueDetail.value, authStore.userInfo?.id)
)

const canVerify = computed(() => canVerifyProcessIssue(issueDetail.value))

const canClose = computed(() => canCloseProcessIssue(issueDetail.value))
const assignedUserLabel = computed(() => {
  const assignedTo = issueDetail.value?.assigned_to
  if (!assignedTo) {
    return '-'
  }

  return internalUserLabelMap.value[assignedTo] || `#${assignedTo}`
})

const getResponsibilityTagType = (category?: ResponsibilityCategory): string => {
  if (!category) {
    return 'info'
  }

  const typeMap: Record<ResponsibilityCategory, string> = {
    material_defect: 'danger',
    operation_defect: 'warning',
    equipment_defect: 'info',
    process_defect: 'primary',
    design_defect: 'success',
  }

  return typeMap[category] || 'info'
}

const getResponsibilityLabel = (category?: ResponsibilityCategory): string => {
  if (!category) {
    return ''
  }

  const labelMap: Record<ResponsibilityCategory, string> = {
    material_defect: '物料不良',
    operation_defect: '作业不良',
    equipment_defect: '设备不良',
    process_defect: '工艺不良',
    design_defect: '设计不良',
  }

  return labelMap[category] || category
}

const formatDateTime = (dateTime?: string): string => {
  if (!dateTime) {
    return ''
  }

  return new Date(dateTime).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const getFileName = (path: string): string => path.split('/').pop() || path

const loadInternalUsers = async () => {
  try {
    internalUsers.value = await problemManagementApi.getInternalUsers()
  } catch (error: any) {
    ElMessage.error(error.message || '加载内部责任人列表失败')
  }
}

const resetDialogs = () => {
  showResponseDialog.value = false
  showVerifyDialog.value = false
  showCloseDialog.value = false
}

const resetForms = () => {
  Object.assign(responseForm, {
    root_cause: '',
    containment_action: '',
    corrective_action: '',
    verification_period: 7,
    evidence_files: [],
  })
  Object.assign(verifyForm, {
    verification_result: true,
    verification_comments: '',
  })
  Object.assign(closeForm, {
    close_comments: '',
  })
  evidenceInput.value = ''
}

const clearRouteAction = () => {
  if (!route.query.action) {
    return
  }

  const { action, ...restQuery } = route.query
  void router.replace({
    name: 'ProcessIssueDetail',
    params: route.params,
    query: restQuery,
  })
}

const syncRouteAction = async () => {
  await nextTick()
  if (route.query.action === 'respond' && canRespond.value) {
    showResponseDialog.value = true
    clearRouteAction()
    return
  }

  if (route.query.action === 'verify' && canVerify.value) {
    showVerifyDialog.value = true
    clearRouteAction()
    return
  }

  if (route.query.action === 'close' && canClose.value) {
    showCloseDialog.value = true
    clearRouteAction()
  }
}

const loadDetail = async () => {
  const id = Number(route.params.id)
  if (!id) {
    issueDetail.value = null
    return
  }

  loading.value = true
  resetDialogs()
  resetForms()
  try {
    issueDetail.value = await getProcessIssue(id)
    await syncRouteAction()
  } catch (error) {
    console.error('Failed to load issue detail:', error)
    ElMessage.error('加载问题单详情失败')
  } finally {
    loading.value = false
  }
}

const handleSubmitResponse = async () => {
  if (!responseFormRef.value || !issueDetail.value) {
    return
  }

  try {
    await responseFormRef.value.validate()

    const evidenceFilesValue = evidenceInput.value
      ? evidenceInput.value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : []

    submitting.value = true

    await respondToProcessIssue(issueDetail.value.id, {
      ...responseForm,
      evidence_files: evidenceFilesValue,
    })

    ElMessage.success('对策提交成功')
    showResponseDialog.value = false
    await loadDetail()
  } catch (error) {
    if (error !== false) {
      console.error('Failed to submit response:', error)
      ElMessage.error('对策提交失败')
    }
  } finally {
    submitting.value = false
  }
}

const handleSubmitVerify = async () => {
  if (!verifyFormRef.value || !issueDetail.value) {
    return
  }

  try {
    await verifyFormRef.value.validate()
    submitting.value = true

    await verifyProcessIssue(issueDetail.value.id, verifyForm)

    ElMessage.success('验证提交成功')
    showVerifyDialog.value = false
    await loadDetail()
  } catch (error) {
    if (error !== false) {
      console.error('Failed to submit verification:', error)
      ElMessage.error('验证提交失败')
    }
  } finally {
    submitting.value = false
  }
}

const handleSubmitClose = async () => {
  if (!issueDetail.value) {
    return
  }

  submitting.value = true
  try {
    await closeProcessIssue(issueDetail.value.id, closeForm)
    ElMessage.success('问题单已关闭')
    showCloseDialog.value = false
    await loadDetail()
  } catch (error) {
    console.error('Failed to close issue:', error)
    ElMessage.error('关闭问题单失败')
  } finally {
    submitting.value = false
  }
}

const handleBack = () => {
  router.push({ name: 'ProcessIssueList' })
}

watch(
  [() => route.params.id, () => route.query.action],
  () => {
    loadDetail()
  },
  { immediate: true }
)

onMounted(() => {
  void loadInternalUsers()
})
</script>

<style scoped>
.process-issue-detail {
  padding: 20px;
  min-height: 100vh;
  background-color: #f5f7fa;
}

.evidence-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.evidence-item {
  padding: 8px;
  background-color: #f5f7fa;
  border-radius: 4px;
}

.action-buttons {
  padding-top: 20px;
  border-top: 1px solid #ebeef5;
}

@media (max-width: 768px) {
  .process-issue-detail {
    padding: 12px;
  }

  .action-buttons {
    flex-direction: column;
  }

  .action-buttons .el-button {
    width: 100%;
  }
}
</style>
