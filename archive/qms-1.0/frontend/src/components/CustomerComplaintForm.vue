<template>
  <div class="customer-complaint-form">
    <el-radio-group v-model="entryMode" class="entry-mode">
      <el-radio-button label="single">单条录入</el-radio-button>
      <el-radio-button label="batch">批量添加</el-radio-button>
    </el-radio-group>

    <el-form
      v-if="entryMode === 'single'"
      ref="formRef"
      :model="formData"
      :rules="rules"
      label-width="108px"
      class="complaint-form"
    >
      <div class="form-grid">
        <el-form-item label="客诉类型" prop="complaint_type">
          <el-radio-group v-model="formData.complaint_type">
            <el-radio v-for="option in complaintTypeOptions" :key="option.value" :label="option.value">
              {{ option.label }}
            </el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="客户名称" prop="customer_id">
          <el-select
            v-model="formData.customer_id"
            filterable
            clearable
            placeholder="请选择客户"
            class="w-full"
            :loading="customerLoading"
          >
            <el-option
              v-for="item in customerOptions"
              :key="item.id"
              :label="`${item.name} (${item.code})`"
              :value="item.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="客户代码">
          <el-input :model-value="selectedCustomerCode" disabled />
        </el-form-item>

        <el-form-item v-if="formData.complaint_type === ComplaintType.ZERO_KM" label="终端客户">
          <el-input v-model="formData.end_customer_name" />
        </el-form-item>

        <el-form-item v-if="formData.complaint_type === ComplaintType.AFTER_SALES" label="收件日期">
          <el-date-picker v-model="formData.received_date" type="date" value-format="YYYY-MM-DD" class="w-full" />
        </el-form-item>

        <el-form-item :label="formData.complaint_type === ComplaintType.AFTER_SALES ? '故障日期' : '发生日期'">
          <el-date-picker v-model="formData.occurrence_date" type="date" value-format="YYYY-MM-DD" class="w-full" />
        </el-form-item>

        <el-form-item :label="formData.complaint_type === ComplaintType.AFTER_SALES ? '产品出厂日期' : '生产日期'">
          <el-date-picker v-model="formData.production_date" type="date" value-format="YYYY-MM-DD" class="w-full" />
        </el-form-item>

        <el-form-item label="产品类型" prop="product_type">
          <el-input v-model="formData.product_type" />
        </el-form-item>

        <el-form-item label="产品型号">
          <el-input v-model="formData.product_model" />
        </el-form-item>

        <el-form-item v-if="formData.complaint_type === ComplaintType.ZERO_KM" label="项目阶段">
          <el-input v-model="formData.project_stage" />
        </el-form-item>

        <el-form-item v-if="formData.complaint_type === ComplaintType.ZERO_KM" label="批次/条码">
          <el-input v-model="formData.batch_code" />
        </el-form-item>

        <el-form-item v-if="formData.complaint_type === ComplaintType.AFTER_SALES" label="产品追溯码">
          <el-input v-model="formData.trace_code" />
        </el-form-item>

        <template v-if="formData.complaint_type === ComplaintType.AFTER_SALES">
          <el-form-item label="退件类型">
            <el-input v-model="formData.return_type" />
          </el-form-item>

          <el-form-item label="退件月份">
            <el-input v-model="formData.return_month" placeholder="例如 2026-05" />
          </el-form-item>

          <el-form-item label="服务月数">
            <el-input-number v-model="formData.service_months" :min="0" :controls="false" class="w-full" />
          </el-form-item>

          <el-form-item label="服务月分类">
            <el-input v-model="formData.service_month_category" />
          </el-form-item>

          <el-form-item label="车辆VIN" prop="vin_code">
            <el-input v-model="formData.vin_code" />
          </el-form-item>

          <el-form-item label="里程(km)" prop="mileage">
            <el-input-number v-model="formData.mileage" :min="0" :controls="false" class="w-full" />
          </el-form-item>

          <el-form-item label="里程分类">
            <el-input v-model="formData.mileage_category" />
          </el-form-item>

          <el-form-item label="4S店">
            <el-input v-model="formData.dealer_name" />
          </el-form-item>

          <el-form-item label="发生区域">
            <el-input v-model="formData.occurrence_region" />
          </el-form-item>

          <el-form-item label="服务方式">
            <el-input v-model="formData.service_method" />
          </el-form-item>

          <el-form-item label="解析优先级">
            <el-input v-model="formData.analysis_priority" />
          </el-form-item>
        </template>

        <el-form-item v-if="formData.complaint_type === ComplaintType.AFTER_SALES" label="故障分类">
          <el-input v-model="formData.fault_category" />
        </el-form-item>

        <el-form-item v-if="formData.complaint_type === ComplaintType.ZERO_KM" label="故障数">
          <el-input-number v-model="formData.failure_count" :min="1" :controls="false" class="w-full" />
        </el-form-item>

        <el-form-item label="涉及退件">
          <el-switch v-model="formData.is_return_required" />
        </el-form-item>

        <el-form-item label="实物解析">
          <el-switch v-model="formData.requires_physical_analysis" />
        </el-form-item>

        <el-form-item label="缺陷描述" prop="defect_description" class="form-grid__full">
          <el-input v-model="formData.defect_description" type="textarea" :rows="4" />
        </el-form-item>
      </div>

      <div class="form-actions">
        <el-button type="primary" :loading="submitting" @click="handleSubmit">提交</el-button>
        <el-button @click="handleCancel">取消</el-button>
      </div>
    </el-form>

    <el-form v-else :model="batchForm" label-width="108px" class="complaint-form">
      <div class="form-grid">
        <el-form-item label="客诉类型">
          <el-radio-group v-model="batchForm.complaint_type">
            <el-radio v-for="option in complaintTypeOptions" :key="option.value" :label="option.value">
              {{ option.label }}
            </el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="涉及退件">
          <el-switch v-model="batchForm.is_return_required" />
        </el-form-item>

        <el-form-item label="实物解析">
          <el-switch v-model="batchForm.requires_physical_analysis" />
        </el-form-item>

        <el-form-item label="批量内容" required class="form-grid__full">
          <el-input
            v-model="batchForm.content"
            type="textarea"
            :rows="10"
            placeholder="可直接粘贴附件表格行，支持含表头导入"
          />
          <div class="import-limit-note">
            {{ batchImportColumnHint }}；单次最多导入 {{ CUSTOMER_COMPLAINT_BATCH_IMPORT_MAX_ITEMS }} 条
          </div>
        </el-form-item>
      </div>

      <el-alert v-if="batchParseResult.error" :title="batchParseResult.error" type="warning" show-icon :closable="false" />

      <el-table
        v-else-if="batchParseResult.items.length"
        :data="batchParseResult.items"
        size="small"
        max-height="220"
        class="batch-preview"
      >
        <el-table-column prop="rowNumber" label="行" width="64" />
        <el-table-column label="客户" min-width="180">
          <template #default="{ row }">
            {{ row.payload.customer_name || row.payload.customer_code || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="产品" min-width="120">
          <template #default="{ row }">{{ row.payload.product_type }}</template>
        </el-table-column>
        <el-table-column label="描述" min-width="260" show-overflow-tooltip>
          <template #default="{ row }">{{ row.payload.defect_description }}</template>
        </el-table-column>
      </el-table>

      <div class="form-actions">
        <el-button type="primary" :loading="submitting" @click="handleBatchSubmit">
          导入
        </el-button>
        <el-button @click="handleCancel">取消</el-button>
      </div>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import {
  batchCreateCustomerComplaints,
  createCustomerComplaint,
  getCustomerComplaintCustomerOptions,
} from '@/api/customer-quality'
import { useProblemManagementStore } from '@/stores/problemManagement'
import type { CustomerComplaintCreate, CustomerComplaintCustomerOption } from '@/types/customer-quality'
import { ComplaintType } from '@/types/customer-quality'
import {
  CUSTOMER_COMPLAINT_BATCH_IMPORT_MAX_ITEMS,
  parseCustomerComplaintBatchImportContent,
} from '@/utils/customerComplaintBatchImport'
import { buildCustomerComplaintTypeOptions } from '@/utils/problemManagement'

const emit = defineEmits<{
  success: []
  cancel: []
}>()

const entryMode = ref<'single' | 'batch'>('single')
const formRef = ref<FormInstance>()
const submitting = ref(false)
const customerLoading = ref(false)
const customerOptions = ref<CustomerComplaintCustomerOption[]>([])
const problemManagementStore = useProblemManagementStore()

const formData = reactive<CustomerComplaintCreate>({
  complaint_type: ComplaintType.ZERO_KM,
  customer_id: undefined,
  customer_code: undefined,
  customer_name: undefined,
  end_customer_name: '',
  received_date: undefined,
  occurrence_date: undefined,
  production_date: undefined,
  product_type: '',
  product_model: '',
  project_stage: '',
  batch_code: '',
  trace_code: '',
  return_type: '',
  return_month: '',
  service_months: undefined,
  service_month_category: '',
  dealer_name: '',
  occurrence_region: '',
  fault_category: '',
  service_method: '',
  analysis_priority: '',
  failure_count: undefined,
  defect_description: '',
  is_return_required: false,
  requires_physical_analysis: false,
  vin_code: undefined,
  mileage: undefined,
  mileage_category: '',
  purchase_date: undefined,
})

const batchForm = reactive({
  complaint_type: ComplaintType.ZERO_KM,
  is_return_required: false,
  requires_physical_analysis: false,
  content: '',
})

const complaintTypeOptions = computed(() =>
  buildCustomerComplaintTypeOptions(problemManagementStore.getCategory)
)

const batchImportColumnHint = computed(() => {
  if (batchForm.complaint_type === ComplaintType.AFTER_SALES) {
    return '售后列：收件日期、退件类型、退件月份、故障日期、客户、产品型号、产品类型、产品出厂日期、服务月数、VIN、里程、4S店、发生区域、故障描述'
  }

  return '0KM列：发生日期、生产日期、客户、终端客户、产品类型、产品型号、项目阶段、批次号、故障描述、故障数'
})

const selectedCustomerCode = computed(() => {
  const selectedCustomer = customerOptions.value.find((item) => item.id === formData.customer_id)
  return selectedCustomer?.code ?? ''
})

const batchParseResult = computed(() => {
  try {
    return {
      error: '',
      items: parseCustomerComplaintBatchImportContent(batchForm.content, {
        complaintType: batchForm.complaint_type,
        customers: customerOptions.value,
        isReturnRequired: batchForm.is_return_required,
        requiresPhysicalAnalysis: batchForm.requires_physical_analysis,
      }),
    }
  } catch (error: any) {
    return {
      error: error.message || '批量内容格式不正确',
      items: [],
    }
  }
})

const rules: FormRules = {
  complaint_type: [{ required: true, message: '请选择客诉类型', trigger: 'change' }],
  customer_id: [{ required: true, message: '请选择客户', trigger: 'change' }],
  product_type: [{ required: true, message: '请输入产品类型', trigger: 'blur' }],
  defect_description: [
    { required: true, message: '请输入缺陷描述', trigger: 'blur' },
    { min: 10, message: '缺陷描述至少 10 个字', trigger: 'blur' },
  ],
  vin_code: [
    {
      validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
        if (formData.complaint_type === ComplaintType.AFTER_SALES && !value) {
          callback(new Error('请输入 VIN 码'))
          return
        }
        callback()
      },
      trigger: 'blur',
    },
  ],
  mileage: [
    {
      validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
        if (formData.complaint_type === ComplaintType.AFTER_SALES && value == null) {
          callback(new Error('请输入里程'))
          return
        }
        callback()
      },
      trigger: 'blur',
    },
  ],
}

function trimOptional(value?: string) {
  return value?.trim() || undefined
}

function normalizeSubmitPayload(payload: CustomerComplaintCreate): CustomerComplaintCreate {
  return {
    ...payload,
    customer_code: trimOptional(payload.customer_code),
    customer_name: trimOptional(payload.customer_name),
    end_customer_name: trimOptional(payload.end_customer_name),
    product_type: payload.product_type.trim(),
    product_model: trimOptional(payload.product_model),
    project_stage: trimOptional(payload.project_stage),
    batch_code: trimOptional(payload.batch_code),
    trace_code: trimOptional(payload.trace_code),
    return_type: trimOptional(payload.return_type),
    return_month: trimOptional(payload.return_month),
    service_month_category: trimOptional(payload.service_month_category),
    dealer_name: trimOptional(payload.dealer_name),
    occurrence_region: trimOptional(payload.occurrence_region),
    fault_category: trimOptional(payload.fault_category),
    service_method: trimOptional(payload.service_method),
    analysis_priority: trimOptional(payload.analysis_priority),
    defect_description: payload.defect_description.trim(),
    vin_code: trimOptional(payload.vin_code),
    mileage_category: trimOptional(payload.mileage_category),
    purchase_date: trimOptional(payload.purchase_date),
  }
}

async function loadCustomerOptions() {
  customerLoading.value = true

  try {
    customerOptions.value = await getCustomerComplaintCustomerOptions()
  } catch (error: any) {
    ElMessage.error(error.message || '加载客户清单失败')
  } finally {
    customerLoading.value = false
  }
}

async function handleSubmit() {
  if (!formRef.value) {
    return
  }

  try {
    await formRef.value.validate()
    submitting.value = true

    await createCustomerComplaint(normalizeSubmitPayload(formData))
    ElMessage.success('客诉单创建成功')
    emit('success')
  } catch (error: any) {
    if (error !== false) {
      ElMessage.error(error.message || '创建客诉单失败')
      console.error('Create complaint error:', error)
    }
  } finally {
    submitting.value = false
  }
}

async function handleBatchSubmit() {
  const { error, items } = batchParseResult.value
  if (error) {
    ElMessage.error(error)
    return
  }

  if (!items.length) {
    ElMessage.error('请填写批量内容')
    return
  }

  if (items.length > CUSTOMER_COMPLAINT_BATCH_IMPORT_MAX_ITEMS) {
    ElMessage.error(`单次最多导入 ${CUSTOMER_COMPLAINT_BATCH_IMPORT_MAX_ITEMS} 条`)
    return
  }

  submitting.value = true
  try {
    await batchCreateCustomerComplaints({
      items: items.map((item) => normalizeSubmitPayload(item.payload)),
    })
    ElMessage.success(`已导入 ${items.length} 条客诉单`)
    emit('success')
  } catch (error: any) {
    ElMessage.error(error.message || '批量导入客诉单失败')
    console.error('Batch create complaints error:', error)
  } finally {
    submitting.value = false
  }
}

function handleCancel() {
  emit('cancel')
}

onMounted(() => {
  void problemManagementStore.loadCatalog()
  void loadCustomerOptions()
})
</script>

<style scoped>
.customer-complaint-form {
  padding: 4px 0 0;
}

.entry-mode {
  margin-bottom: 16px;
}

.complaint-form {
  max-height: 68vh;
  overflow-y: auto;
  padding-right: 6px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 16px;
}

.form-grid__full {
  grid-column: 1 / -1;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
}

.import-limit-note {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.4;
}

.batch-preview {
  margin-top: 12px;
}

.w-full {
  width: 100%;
}

@media (max-width: 768px) {
  .form-grid {
    grid-template-columns: 1fr;
  }

  .form-grid__full {
    grid-column: auto;
  }
}
</style>
