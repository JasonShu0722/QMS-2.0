<template>
  <el-dialog
    :model-value="modelValue"
    title="追加关联客诉"
    width="820px"
    destroy-on-close
    @close="handleClose"
  >
    <div v-loading="loading" class="space-y-4">
      <div class="text-sm text-gray-500">
        仅展示与当前 8D 同客户、同客诉类型、且已满足发起前置条件的客诉记录。
      </div>

      <el-empty v-if="!candidateComplaints.length && !loading" description="暂无可追加的客诉记录" />

      <el-table
        v-else
        :data="candidateComplaints"
        border
        size="small"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="48" />
        <el-table-column prop="complaint_number" label="客诉编号" min-width="160" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="getCustomerComplaintStatusType(row.status)">
              {{ getCustomerComplaintStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="product_type" label="产品类型" min-width="140" />
        <el-table-column prop="defect_description" label="问题描述" min-width="220" show-overflow-tooltip />
      </el-table>
    </div>

    <template #footer>
      <div class="flex items-center justify-between">
        <span class="text-xs text-gray-400">已选择 {{ selectedComplaintIds.length }} 条客诉</span>
        <div class="flex items-center gap-2">
          <el-button @click="handleClose">取消</el-button>
          <el-button
            type="primary"
            :loading="submitting"
            :disabled="!selectedComplaintIds.length"
            @click="handleSubmit"
          >
            追加到 8D
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

import { appendCustomerComplaintEightDScope, getCustomerComplaints } from '@/api/customer-quality'
import { canOpenCustomerComplaintEightD, getCustomerComplaintStatusLabel, getCustomerComplaintStatusType } from '@/utils/customerComplaint'
import type { CustomerComplaint } from '@/types/customer-quality'

const props = defineProps<{
  modelValue: boolean
  anchorComplaintId: number
  complaintType: string
  customerId?: number
  customerCode: string
  linkedComplaintIds: number[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  success: []
}>()

const loading = ref(false)
const submitting = ref(false)
const candidateComplaints = ref<CustomerComplaint[]>([])
const selectedComplaintIds = ref<number[]>([])

async function loadCandidates() {
  loading.value = true
  try {
    const response = await getCustomerComplaints({
      complaint_type: props.complaintType as any,
      customer_id: props.customerId,
      customer_code: props.customerId ? undefined : props.customerCode,
      page: 1,
      page_size: 100,
    })

    candidateComplaints.value = response.items.filter((item) => {
      if (props.linkedComplaintIds.includes(item.id)) {
        return false
      }
      if (item.eight_d_report_id) {
        return false
      }
      return canOpenCustomerComplaintEightD(item)
    })
  } catch (error: any) {
    ElMessage.error(error.message || '加载可追加客诉失败')
    console.error('Load customer 8D scope candidates error:', error)
  } finally {
    loading.value = false
  }
}

function handleSelectionChange(rows: CustomerComplaint[]) {
  selectedComplaintIds.value = rows.map((item) => item.id)
}

async function handleSubmit() {
  if (!selectedComplaintIds.value.length) {
    return
  }

  try {
    submitting.value = true
    await appendCustomerComplaintEightDScope(props.anchorComplaintId, {
      complaint_ids: selectedComplaintIds.value,
    })
    ElMessage.success('已追加关联客诉')
    emit('success')
    handleClose()
  } catch (error: any) {
    ElMessage.error(error.message || '追加关联客诉失败')
    console.error('Append customer 8D scope error:', error)
  } finally {
    submitting.value = false
  }
}

function resetState() {
  candidateComplaints.value = []
  selectedComplaintIds.value = []
}

function handleClose() {
  resetState()
  emit('update:modelValue', false)
}

watch(
  () => props.modelValue,
  async (visible) => {
    if (!visible) {
      resetState()
      return
    }
    await loadCandidates()
  }
)
</script>
