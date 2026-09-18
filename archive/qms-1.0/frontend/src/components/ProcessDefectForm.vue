<template>
  <el-dialog
    v-model="dialogVisible"
    :title="isEdit ? '编辑不良品记录' : '录入不良品记录'"
    width="800px"
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <el-form
      ref="formRef"
      :model="formData"
      :rules="formRules"
      label-width="120px"
      v-loading="loading"
    >
      <el-row :gutter="20">
        <el-col :span="12">
          <el-form-item label="不良日期" prop="defect_date">
            <el-date-picker
              v-model="formData.defect_date"
              type="date"
              placeholder="选择不良日期"
              format="YYYY-MM-DD"
              value-format="YYYY-MM-DD"
              style="width: 100%"
            />
          </el-form-item>
        </el-col>

        <el-col :span="12">
          <el-form-item label="工单号" prop="work_order">
            <el-input
              v-model="formData.work_order"
              placeholder="请输入工单号"
              clearable
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="20">
        <el-col :span="12">
          <el-form-item label="工序" prop="process_id">
            <el-input
              v-model="formData.process_id"
              placeholder="请输入工序ID"
              clearable
            />
          </el-form-item>
        </el-col>

        <el-col :span="12">
          <el-form-item label="产线" prop="line_id">
            <el-input
              v-model="formData.line_id"
              placeholder="请输入产线ID"
              clearable
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="20">
        <el-col :span="12">
          <el-form-item label="不良类型" prop="defect_type">
            <el-select
              v-model="formData.defect_type"
              placeholder="请选择不良类型"
              filterable
              allow-create
              style="width: 100%"
            >
              <el-option
                v-for="type in defectTypes"
                :key="type.value"
                :label="type.label"
                :value="type.value"
              />
            </el-select>
          </el-form-item>
        </el-col>

        <el-col :span="12">
          <el-form-item label="不良数量" prop="defect_qty">
            <el-input-number
              v-model="formData.defect_qty"
              :min="1"
              :max="999999"
              style="width: 100%"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="责任类别" prop="responsibility_category">
        <el-select
          v-model="formData.responsibility_category"
          placeholder="请选择责任类别"
          style="width: 100%"
          @change="handleResponsibilityCategoryChange"
        >
          <el-option
            v-for="cat in responsibilityCategories"
            :key="cat.value"
            :label="cat.label"
            :value="cat.value"
          >
            <div class="flex justify-between items-center">
              <span>{{ cat.label }}</span>
              <span class="text-xs text-gray-400">{{ cat.description }}</span>
            </div>
          </el-option>
        </el-select>
        <div v-if="selectedCategory?.links_to_metric" class="text-xs text-blue-500 mt-1">
          关联指标: {{ selectedCategory.links_to_metric }}
        </div>
      </el-form-item>

      <!-- 物料不良时显示 -->
      <template v-if="formData.responsibility_category === 'material_defect'">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="物料编码" prop="material_code">
              <el-input
                v-model="formData.material_code"
                placeholder="请输入物料编码"
                clearable
              />
            </el-form-item>
          </el-col>

          <el-col :span="12">
            <el-form-item label="供应商" prop="supplier_id">
              <el-input
                v-model="formData.supplier_id"
                placeholder="请输入供应商ID"
                type="number"
                clearable
              />
            </el-form-item>
          </el-col>
        </el-row>
      </template>

      <el-form-item label="操作员ID">
        <el-input
          v-model="formData.operator_id"
          placeholder="请输入操作员ID（可选）"
          type="number"
          clearable
        />
      </el-form-item>

      <el-form-item label="备注">
        <el-input
          v-model="formData.remarks"
          type="textarea"
          :rows="3"
          placeholder="请输入备注信息（可选）"
          maxlength="500"
          show-word-limit
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="handleClose">取消</el-button>
      <el-button type="primary" @click="handleSubmit" :loading="submitting">
        {{ isEdit ? '保存' : '提交' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import {
  getProcessDefect,
  createProcessDefect,
  updateProcessDefect,
  getDefectTypes,
  getResponsibilityCategories
} from '@/api/process-quality';
import type {
  ProcessDefectCreate,
  DefectTypeOption,
  ResponsibilityCategoryOption,
  ResponsibilityCategory,
  ProcessDefect
} from '@/types/process-quality';

// Props
interface Props {
  visible: boolean;
  defectId?: number | null;
}

const props = withDefaults(defineProps<Props>(), {
  defectId: null
});

// Emits
const emit = defineEmits<{
  'update:visible': [value: boolean];
  'success': [];
}>();

// 状态
const loading = ref(false);
const submitting = ref(false);
const formRef = ref<FormInstance>();
const defectTypes = ref<DefectTypeOption[]>([]);
const responsibilityCategories = ref<ResponsibilityCategoryOption[]>([]);

// 表单数据
const formData = reactive<ProcessDefectCreate>({
  defect_date: new Date().toISOString().split('T')[0],
  work_order: '',
  process_id: '',
  line_id: '',
  defect_type: '',
  defect_qty: 1,
  responsibility_category: 'operation_defect' as ResponsibilityCategory,
  operator_id: undefined,
  material_code: undefined,
  supplier_id: undefined,
  remarks: undefined
});

// 计算属性
const dialogVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
});

const isEdit = computed(() => props.defectId !== null);

const selectedCategory = computed(() => {
  return responsibilityCategories.value.find(
    cat => cat.value === formData.responsibility_category
  );
});

// 表单验证规则
const formRules: FormRules = {
  defect_date: [
    { required: true, message: '请选择不良日期', trigger: 'change' }
  ],
  work_order: [
    { required: true, message: '请输入工单号', trigger: 'blur' },
    { min: 1, max: 100, message: '工单号长度在 1 到 100 个字符', trigger: 'blur' }
  ],
  process_id: [
    { required: true, message: '请输入工序ID', trigger: 'blur' },
    { min: 1, max: 50, message: '工序ID长度在 1 到 50 个字符', trigger: 'blur' }
  ],
  line_id: [
    { required: true, message: '请输入产线ID', trigger: 'blur' },
    { min: 1, max: 50, message: '产线ID长度在 1 到 50 个字符', trigger: 'blur' }
  ],
  defect_type: [
    { required: true, message: '请选择或输入不良类型', trigger: 'change' }
  ],
  defect_qty: [
    { required: true, message: '请输入不良数量', trigger: 'blur' },
    { type: 'number', min: 1, message: '不良数量必须大于0', trigger: 'blur' }
  ],
  responsibility_category: [
    { required: true, message: '请选择责任类别', trigger: 'change' }
  ],
  material_code: [
    {
      validator: (_rule, value, callback) => {
        if (formData.responsibility_category === 'material_defect' && !value) {
          callback(new Error('物料不良时必须填写物料编码'));
        } else {
          callback();
        }
      },
      trigger: 'blur'
    }
  ],
  supplier_id: [
    {
      validator: (_rule, value, callback) => {
        if (formData.responsibility_category === 'material_defect' && !value) {
          callback(new Error('物料不良时必须填写供应商ID'));
        } else {
          callback();
        }
      },
      trigger: 'blur'
    }
  ]
};

// 加载失效类型选项
const loadDefectTypes = async () => {
  try {
    const response = await getDefectTypes() as { defect_types: DefectTypeOption[] };
    defectTypes.value = response.defect_types;
  } catch (error) {
    console.error('Failed to load defect types:', error);
  }
};

// 加载责任类别选项
const loadResponsibilityCategories = async () => {
  try {
    const response = await getResponsibilityCategories() as { categories: ResponsibilityCategoryOption[] };
    responsibilityCategories.value = response.categories;
  } catch (error) {
    console.error('Failed to load responsibility categories:', error);
  }
};

// 加载详情
const loadDetail = async () => {
  if (!props.defectId) return;

  loading.value = true;
  try {
    const detail = await getProcessDefect(props.defectId) as ProcessDefect;
    Object.assign(formData, {
      defect_date: detail.defect_date,
      work_order: detail.work_order,
      process_id: detail.process_id,
      line_id: detail.line_id,
      defect_type: detail.defect_type,
      defect_qty: detail.defect_qty,
      responsibility_category: detail.responsibility_category,
      operator_id: detail.operator_id || undefined,
      material_code: detail.material_code || undefined,
      supplier_id: detail.supplier_id || undefined,
      remarks: detail.remarks || undefined
    });
  } catch (error) {
    console.error('Failed to load defect detail:', error);
    ElMessage.error('加载不良品记录失败');
  } finally {
    loading.value = false;
  }
};

// 责任类别变化
const handleResponsibilityCategoryChange = () => {
  // 如果不是物料不良，清空物料相关字段
  if (formData.responsibility_category !== 'material_defect') {
    formData.material_code = undefined;
    formData.supplier_id = undefined;
  }
};

// 提交
const handleSubmit = async () => {
  if (!formRef.value) return;

  try {
    await formRef.value.validate();

    submitting.value = true;

    if (isEdit.value && props.defectId) {
      await updateProcessDefect(props.defectId, formData);
      ElMessage.success('更新成功');
    } else {
      await createProcessDefect(formData);
      ElMessage.success('录入成功');
    }

    emit('success');
  } catch (error) {
    if (error !== false) {
      console.error('Failed to submit:', error);
      ElMessage.error(isEdit.value ? '更新失败' : '录入失败');
    }
  } finally {
    submitting.value = false;
  }
};

// 关闭
const handleClose = () => {
  formRef.value?.resetFields();
  emit('update:visible', false);
};

// 监听对话框打开
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      loadDefectTypes();
      loadResponsibilityCategories();
      if (isEdit.value) {
        loadDetail();
      } else {
        // 重置表单为默认值
        Object.assign(formData, {
          defect_date: new Date().toISOString().split('T')[0],
          work_order: '',
          process_id: '',
          line_id: '',
          defect_type: '',
          defect_qty: 1,
          responsibility_category: 'operation_defect' as ResponsibilityCategory,
          operator_id: undefined,
          material_code: undefined,
          supplier_id: undefined,
          remarks: undefined
        });
      }
    }
  }
);
</script>

<style scoped>
/* 移动端适配 */
@media (max-width: 768px) {
  :deep(.el-dialog) {
    width: 95% !important;
  }

  .el-row {
    display: block;
  }

  .el-col {
    width: 100% !important;
    margin-bottom: 12px;
  }
}
</style>
