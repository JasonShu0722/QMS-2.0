<template>
  <el-dialog
    :model-value="modelValue"
    title="实物解析任务"
    width="90%"
    class="max-w-2xl"
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <template v-if="complaint">
      <div class="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        <div class="font-medium text-slate-900">{{ complaint.complaint_number }}</div>
        <div class="mt-1">{{ complaint.customer_name || complaint.customer_code }} / {{ complaint.product_type }}</div>
        <div class="mt-1">
          当前状态：{{ getCustomerComplaintPhysicalAnalysisStatusLabel(complaint.physical_analysis_status) }}
        </div>
      </div>

      <el-form ref="formRef" :model="formData" :rules="rules" label-width="110px">
        <el-form-item label="任务状态" prop="analysis_status">
          <el-radio-group v-model="formData.analysis_status">
            <el-radio
              v-for="option in analysisStatusOptions"
              :key="option.value"
              :label="option.value"
            >
              {{ option.label }}
            </el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="责任部门" prop="responsible_dept">
          <el-input
            v-model="formData.responsible_dept"
            placeholder="请输入失效分析室、客户质量室、工艺部等责任部门"
          />
        </el-form-item>

        <el-form-item label="责任人" prop="responsible_user_id">
          <el-select
            v-model="formData.responsible_user_id"
            filterable
            placeholder="请选择内部责任人"
            class="w-full"
            :loading="loadingUsers"
          >
            <el-option
              v-for="user in userOptions"
              :key="user.id"
              :label="formatUserLabel(user)"
              :value="user.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="失效料号">
          <el-input
            v-model="formData.failed_part_number"
            placeholder="选填，记录失效零部件料号"
          />
        </el-form-item>

        <el-form-item label="一次因分析" prop="analysis_summary">
          <el-input
            v-model="formData.analysis_summary"
            type="textarea"
            :rows="4"
            placeholder="完成实物解析后，记录一次因分析结论"
          />
        </el-form-item>

        <el-form-item label="解析备注">
          <el-input
            v-model="formData.analysis_notes"
            type="textarea"
            :rows="3"
            placeholder="补充任务安排、拆解进展或与后续问题发单有关的说明"
          />
        </el-form-item>
      </el-form>
    </template>

    <template #footer>
      <el-button @click="handleClose">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import {
  getCustomerComplaintInternalUserOptions,
  recordCustomerComplaintPhysicalAnalysis,
} from '@/api/customer-quality'
import type {
  CustomerComplaint,
  CustomerComplaintInternalUserOption,
  CustomerComplaintPhysicalAnalysisRecord,
} from '@/types/customer-quality'
import {
  buildCustomerComplaintAnalysisStatusOptions,
  getCustomerComplaintPhysicalAnalysisStatusLabel,
} from '@/utils/customerComplaint'

const props = defineProps<{
  modelValue: boolean
  complaint: CustomerComplaint | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  success: []
}>()

const formRef = ref<FormInstance>()
const submitting = ref(false)
const loadingUsers = ref(false)
const userOptions = ref<CustomerComplaintInternalUserOption[]>([])

const analysisStatusOptions = buildCustomerComplaintAnalysisStatusOptions()

const formData = reactive<CustomerComplaintPhysicalAnalysisRecord>({
  responsible_dept: '',
  responsible_user_id: 0,
  analysis_status: 'assigned',
  failed_part_number: '',
  analysis_summary: '',
  analysis_notes: '',
})

const rules: FormRules<CustomerComplaintPhysicalAnalysisRecord> = {
  analysis_status: [{ required: true, message: '请选择任务状态', trigger: 'change' }],
  responsible_dept: [
    { required: true, message: '请输入责任部门', trigger: 'blur' },
    { min: 2, message: '责任部门至少 2 个字', trigger: 'blur' },
  ],
  responsible_user_id: [{ required: true, message: '请选择责任人', trigger: 'change' }],
  analysis_summary: [
    {
      validator: (_rule, value, callback) => {
        if (formData.analysis_status === 'completed' && !String(value || '').trim()) {
          callback(new Error('完成实物解析时请填写一次因分析'))
          return
        }
        callback()
      },
      trigger: 'blur',
    },
  ],
}

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      void loadUserOptions()
    }
  },
  { immediate: true }
)

watch(
  () => [props.modelValue, props.complaint] as const,
  ([visible, complaint]) => {
    if (!visible || !complaint) {
      return
    }

    formData.responsible_dept = complaint.physical_analysis_responsible_dept ?? complaint.responsible_dept ?? ''
    formData.responsible_user_id = complaint.physical_analysis_responsible_user_id ?? 0
    formData.analysis_status =
      complaint.physical_analysis_status === 'pending' ? 'assigned' : complaint.physical_analysis_status
    formData.failed_part_number = complaint.failed_part_number ?? ''
    formData.analysis_summary = complaint.physical_analysis_summary ?? ''
    formData.analysis_notes = complaint.physical_analysis_notes ?? ''
  },
  { immediate: true }
)

function formatUserLabel(user: CustomerComplaintInternalUserOption) {
  const baseName = user.full_name || user.username
  return user.department ? `${baseName} (${user.username}) / ${user.department}` : `${baseName} (${user.username})`
}

async function loadUserOptions() {
  loadingUsers.value = true
  try {
    userOptions.value = await getCustomerComplaintInternalUserOptions()
  } catch (error: any) {
    ElMessage.error(error.message || '加载内部责任人列表失败')
  } finally {
    loadingUsers.value = false
  }
}

function handleClose() {
  emit('update:modelValue', false)
}

async function handleSubmit() {
  if (!props.complaint || !formRef.value) {
    return
  }

  try {
    await formRef.value.validate()
    submitting.value = true

    await recordCustomerComplaintPhysicalAnalysis(props.complaint.id, {
      responsible_dept: formData.responsible_dept.trim(),
      responsible_user_id: formData.responsible_user_id,
      analysis_status: formData.analysis_status,
      failed_part_number: formData.failed_part_number?.trim() || undefined,
      analysis_summary: formData.analysis_summary?.trim() || undefined,
      analysis_notes: formData.analysis_notes?.trim() || undefined,
    })

    ElMessage.success('实物解析任务已更新')
    emit('success')
    emit('update:modelValue', false)
  } catch (error: any) {
    if (error !== false) {
      ElMessage.error(error.message || '更新实物解析任务失败')
    }
  } finally {
    submitting.value = false
  }
}
</script>
