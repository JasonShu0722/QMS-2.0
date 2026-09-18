<template>
  <el-dialog
    :model-value="modelValue"
    title="实物处理备案"
    width="90%"
    class="max-w-2xl"
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <template v-if="complaint">
      <div class="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        <div class="font-medium text-slate-900">{{ complaint.complaint_number }}</div>
        <div class="mt-1">{{ complaint.customer_name || complaint.customer_code }} / {{ complaint.product_type }}</div>
        <div class="mt-1">{{ complaint.is_return_required ? '涉及退件' : '不涉及退件' }}</div>
      </div>

      <el-form ref="formRef" :model="formData" :rules="rules" label-width="110px">
        <el-form-item label="处理状态" prop="disposition_status">
          <el-radio-group v-model="formData.disposition_status">
            <el-radio
              v-for="option in dispositionStatusOptions"
              :key="option.value"
              :label="option.value"
            >
              {{ option.label }}
            </el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="处理方案" prop="disposition_plan">
          <el-input
            v-model="formData.disposition_plan"
            type="textarea"
            :rows="4"
            placeholder="录入退件、账务、返修、客户备案等后续处理方案"
          />
        </el-form-item>

        <el-form-item label="处理备注">
          <el-input
            v-model="formData.disposition_notes"
            type="textarea"
            :rows="3"
            placeholder="补充当前进展、客户沟通或返修安排"
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
import { recordCustomerComplaintPhysicalDisposition } from '@/api/customer-quality'
import type {
  CustomerComplaint,
  CustomerComplaintPhysicalDispositionRecord,
} from '@/types/customer-quality'
import { buildCustomerComplaintDispositionStatusOptions } from '@/utils/customerComplaint'

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

const dispositionStatusOptions = buildCustomerComplaintDispositionStatusOptions()

const formData = reactive<CustomerComplaintPhysicalDispositionRecord>({
  disposition_plan: '',
  disposition_status: 'in_progress',
  disposition_notes: '',
})

const rules: FormRules = {
  disposition_status: [{ required: true, message: '请选择处理状态', trigger: 'change' }],
  disposition_plan: [
    { required: true, message: '请输入处理方案', trigger: 'blur' },
    { min: 5, message: '处理方案至少 5 个字', trigger: 'blur' },
  ],
}

watch(
  () => [props.modelValue, props.complaint] as const,
  ([visible, complaint]) => {
    if (!visible || !complaint) {
      return
    }

    formData.disposition_status =
      complaint.physical_disposition_status === 'pending'
        ? 'in_progress'
        : complaint.physical_disposition_status
    formData.disposition_plan = complaint.physical_disposition_plan ?? ''
    formData.disposition_notes = complaint.physical_disposition_notes ?? ''
  },
  { immediate: true }
)

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

    await recordCustomerComplaintPhysicalDisposition(props.complaint.id, {
      disposition_status: formData.disposition_status,
      disposition_plan: formData.disposition_plan.trim(),
      disposition_notes: formData.disposition_notes?.trim() || undefined,
    })

    ElMessage.success('实物处理备案已更新')
    emit('success')
    emit('update:modelValue', false)
  } catch (error: any) {
    if (error !== false) {
      ElMessage.error(error.message || '更新实物处理备案失败')
    }
  } finally {
    submitting.value = false
  }
}
</script>
