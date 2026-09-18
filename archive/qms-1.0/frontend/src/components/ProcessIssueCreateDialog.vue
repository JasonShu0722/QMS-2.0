<template>
  <el-dialog
    :model-value="modelValue"
    title="发起制程问题单"
    width="90%"
    class="max-w-2xl"
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <template v-if="seedDefect">
      <div class="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        <div class="font-medium text-slate-900">来源不良记录</div>
        <div class="mt-1">工单 {{ seedDefect.work_order }} / 工序 {{ seedDefect.process_id }} / 产线 {{ seedDefect.line_id }}</div>
        <div class="mt-1">不良类型 {{ seedDefect.defect_type }} / 数量 {{ seedDefect.defect_qty }}</div>
      </div>
    </template>

    <el-form ref="formRef" :model="formData" :rules="rules" label-width="110px">
      <el-form-item label="问题描述" prop="issue_description">
        <el-input
          v-model="formData.issue_description"
          type="textarea"
          :rows="4"
          placeholder="请填写问题现象、影响范围和当前风险"
        />
      </el-form-item>

      <el-form-item label="责任类别" prop="responsibility_category">
        <el-select
          v-model="formData.responsibility_category"
          class="w-full"
          filterable
          placeholder="请选择责任类别"
          :loading="loadingCategories"
        >
          <el-option
            v-for="option in responsibilityOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="责任人" prop="assigned_to">
        <el-select
          v-model="formData.assigned_to"
          class="w-full"
          filterable
          placeholder="请选择内部责任人"
          :loading="loadingUsers"
        >
          <el-option
            v-for="user in internalUsers"
            :key="user.id"
            :label="formatUserLabel(user)"
            :value="user.id"
          />
        </el-select>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="handleClose">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">提交</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'

import { getResponsibilityCategories, createProcessIssue } from '@/api/process-quality'
import { problemManagementApi } from '@/api/problem-management'
import type { InternalUserOption } from '@/types/problem-management'
import type {
  ProcessDefect,
  ProcessIssueCreate,
  ResponsibilityCategoryOption,
} from '@/types/process-quality'

const props = defineProps<{
  modelValue: boolean
  seedDefect?: ProcessDefect | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  success: [issueId: number]
}>()

const formRef = ref<FormInstance>()
const loadingUsers = ref(false)
const loadingCategories = ref(false)
const submitting = ref(false)
const internalUsers = ref<InternalUserOption[]>([])
const responsibilityOptions = ref<ResponsibilityCategoryOption[]>([])

const formData = reactive<ProcessIssueCreate>({
  issue_description: '',
  responsibility_category: 'process_defect',
  assigned_to: 0,
  related_defect_ids: [],
})

const rules: FormRules<ProcessIssueCreate> = {
  issue_description: [
    { required: true, message: '请填写问题描述', trigger: 'blur' },
    { min: 10, message: '问题描述至少 10 个字', trigger: 'blur' },
  ],
  responsibility_category: [{ required: true, message: '请选择责任类别', trigger: 'change' }],
  assigned_to: [{ required: true, message: '请选择责任人', trigger: 'change' }],
}

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) {
      return
    }

    hydrateFormFromSeed()
    void loadInternalUsers()
    void loadResponsibilityOptions()
  },
  { immediate: true }
)

watch(
  () => props.seedDefect,
  () => {
    if (props.modelValue) {
      hydrateFormFromSeed()
    }
  }
)

function hydrateFormFromSeed() {
  const seedDefect = props.seedDefect
  formData.issue_description = seedDefect
    ? `工单 ${seedDefect.work_order} 在 ${seedDefect.process_id}/${seedDefect.line_id} 发现 ${seedDefect.defect_type}，请责任部门分析原因并制定对策。`
    : ''
  formData.responsibility_category = seedDefect?.responsibility_category ?? 'process_defect'
  formData.assigned_to = 0
  formData.related_defect_ids = seedDefect ? [seedDefect.id] : []
}

function formatUserLabel(user: InternalUserOption) {
  const baseName = user.full_name || user.username
  return user.department ? `${baseName} (${user.username}) / ${user.department}` : `${baseName} (${user.username})`
}

async function loadInternalUsers() {
  loadingUsers.value = true
  try {
    internalUsers.value = await problemManagementApi.getInternalUsers()
  } catch (error: any) {
    ElMessage.error(error.message || '加载内部责任人列表失败')
  } finally {
    loadingUsers.value = false
  }
}

async function loadResponsibilityOptions() {
  loadingCategories.value = true
  try {
    const response = await getResponsibilityCategories()
    responsibilityOptions.value = response.categories
  } catch (error: any) {
    ElMessage.error(error.message || '加载责任类别失败')
  } finally {
    loadingCategories.value = false
  }
}

function handleClose() {
  emit('update:modelValue', false)
}

async function handleSubmit() {
  if (!formRef.value) {
    return
  }

  try {
    await formRef.value.validate()
    submitting.value = true
    const result = await createProcessIssue({
      issue_description: formData.issue_description.trim(),
      responsibility_category: formData.responsibility_category,
      assigned_to: formData.assigned_to,
      related_defect_ids: formData.related_defect_ids?.length ? formData.related_defect_ids : undefined,
    })
    ElMessage.success(result.message || '制程问题单创建成功')
    emit('success', result.id)
    emit('update:modelValue', false)
  } catch (error: any) {
    if (error !== false) {
      ElMessage.error(error.message || '创建制程问题单失败')
    }
  } finally {
    submitting.value = false
  }
}
</script>
