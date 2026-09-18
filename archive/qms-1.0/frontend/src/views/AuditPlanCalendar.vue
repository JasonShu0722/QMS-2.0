<template>
  <div class="audit-plan-calendar p-4 md:p-6">
    <!-- 页面标题 -->
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
      <div>
        <h1 class="text-2xl font-bold text-gray-800">审核计划日历</h1>
        <p class="text-sm text-gray-500 mt-1">Audit Plan Calendar - 年度审核计划管理</p>
      </div>
      <el-button type="primary" @click="showCreateDialog = true">
        <el-icon class="mr-1"><Plus /></el-icon>
        创建审核计划
      </el-button>
    </div>

    <!-- 年份选择和统计 -->
    <el-card class="mb-6">
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div class="flex items-center gap-4">
          <el-date-picker
            v-model="selectedYear"
            type="year"
            placeholder="选择年份"
            format="YYYY"
            value-format="YYYY"
            @change="loadYearView"
          />
          <el-button @click="loadYearView" :loading="loading">
            <el-icon class="mr-1"><Refresh /></el-icon>
            刷新
          </el-button>
        </div>
        
        <!-- 统计信息 -->
        <div v-if="yearView" class="flex flex-wrap gap-4">
          <div class="stat-item">
            <span class="text-gray-500">总计划数:</span>
            <span class="font-bold text-blue-600 ml-2">{{ yearView.total_plans }}</span>
          </div>
          <div class="stat-item">
            <span class="text-gray-500">体系审核:</span>
            <span class="font-bold ml-2">{{ yearView.by_type.system_audit || 0 }}</span>
          </div>
          <div class="stat-item">
            <span class="text-gray-500">过程审核:</span>
            <span class="font-bold ml-2">{{ yearView.by_type.process_audit || 0 }}</span>
          </div>
          <div class="stat-item">
            <span class="text-gray-500">产品审核:</span>
            <span class="font-bold ml-2">{{ yearView.by_type.product_audit || 0 }}</span>
          </div>
        </div>
      </div>
    </el-card>

    <!-- 日历视图 -->
    <el-card v-loading="loading">
      <el-calendar v-model="calendarDate">
        <template #date-cell="{ data }">
          <div class="calendar-cell">
            <div class="date-number">{{ data.day.split('-').slice(2).join('-') }}</div>
            <div v-if="getPlansForDate(data.day).length > 0" class="plans-container">
              <div
                v-for="plan in getPlansForDate(data.day)"
                :key="plan.id"
                class="plan-item"
                :class="`plan-${plan.audit_type} status-${plan.status}`"
                @click="handlePlanClick(plan)"
              >
                <el-tooltip :content="plan.audit_name" placement="top">
                  <div class="plan-content">
                    <el-tag :type="getStatusType(plan.status)" size="small">
                      {{ getStatusLabel(plan.status) }}
                    </el-tag>
                    <span class="plan-name">{{ plan.audit_name }}</span>
                  </div>
                </el-tooltip>
              </div>
            </div>
          </div>
        </template>
      </el-calendar>
    </el-card>

    <!-- 创建/编辑审核计划对话框 -->
    <el-dialog
      v-model="showCreateDialog"
      :title="editingPlan ? '编辑审核计划' : '创建审核计划'"
      width="600px"
    >
      <el-form
        ref="planFormRef"
        :model="planForm"
        :rules="planFormRules"
        label-width="120px"
      >
        <el-form-item label="审核类型" prop="audit_type">
          <el-select v-model="planForm.audit_type" placeholder="请选择审核类型" class="w-full">
            <el-option label="体系审核 (IATF16949)" value="system_audit" />
            <el-option label="过程审核 (VDA6.3)" value="process_audit" />
            <el-option label="产品审核 (VDA6.5)" value="product_audit" />
            <el-option label="客户审核" value="customer_audit" />
          </el-select>
        </el-form-item>

        <el-form-item label="审核名称" prop="audit_name">
          <el-input v-model="planForm.audit_name" placeholder="请输入审核名称" />
        </el-form-item>

        <el-form-item label="计划日期" prop="planned_date">
          <el-date-picker
            v-model="planForm.planned_date"
            type="datetime"
            placeholder="选择计划审核日期"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DDTHH:mm:ss"
            class="w-full"
          />
        </el-form-item>

        <el-form-item label="主审核员" prop="auditor_id">
          <el-input-number v-model="planForm.auditor_id" :min="1" placeholder="审核员ID" class="w-full" />
        </el-form-item>

        <el-form-item label="被审核部门" prop="auditee_dept">
          <el-input v-model="planForm.auditee_dept" placeholder="请输入被审核部门" />
        </el-form-item>

        <el-form-item label="备注" prop="notes">
          <el-input
            v-model="planForm.notes"
            type="textarea"
            :rows="3"
            placeholder="请输入备注信息"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="handleSubmitPlan" :loading="submitting">
          {{ editingPlan ? '更新' : '创建' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 审核计划详情对话框 -->
    <el-dialog
      v-model="showDetailDialog"
      title="审核计划详情"
      width="700px"
    >
      <div v-if="selectedPlan" class="plan-detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="审核类型">
            {{ getAuditTypeLabel(selectedPlan.audit_type) }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="getStatusType(selectedPlan.status)">
              {{ getStatusLabel(selectedPlan.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="审核名称" :span="2">
            {{ selectedPlan.audit_name }}
          </el-descriptions-item>
          <el-descriptions-item label="计划日期">
            {{ formatDateTime(selectedPlan.planned_date) }}
          </el-descriptions-item>
          <el-descriptions-item label="被审核部门">
            {{ selectedPlan.auditee_dept }}
          </el-descriptions-item>
          <el-descriptions-item label="主审核员ID">
            {{ selectedPlan.auditor_id }}
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">
            {{ formatDateTime(selectedPlan.created_at) }}
          </el-descriptions-item>
          <el-descriptions-item v-if="selectedPlan.notes" label="备注" :span="2">
            {{ selectedPlan.notes }}
          </el-descriptions-item>
          <el-descriptions-item v-if="selectedPlan.postpone_reason" label="延期原因" :span="2">
            {{ selectedPlan.postpone_reason }}
          </el-descriptions-item>
        </el-descriptions>

        <div class="mt-4 flex gap-2">
          <el-button type="primary" @click="handleEdit(selectedPlan)">编辑</el-button>
          <el-button @click="showPostponeDialog = true">申请延期</el-button>
          <el-button type="danger" @click="handleDelete(selectedPlan.id)">删除</el-button>
        </div>
      </div>
    </el-dialog>

    <!-- 延期申请对话框 -->
    <el-dialog
      v-model="showPostponeDialog"
      title="申请延期"
      width="500px"
    >
      <el-form
        ref="postponeFormRef"
        :model="postponeForm"
        :rules="postponeFormRules"
        label-width="120px"
      >
        <el-form-item label="新计划日期" prop="new_planned_date">
          <el-date-picker
            v-model="postponeForm.new_planned_date"
            type="datetime"
            placeholder="选择新的计划日期"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DDTHH:mm:ss"
            class="w-full"
          />
        </el-form-item>

        <el-form-item label="延期原因" prop="postpone_reason">
          <el-input
            v-model="postponeForm.postpone_reason"
            type="textarea"
            :rows="4"
            placeholder="请输入延期原因"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showPostponeDialog = false">取消</el-button>
        <el-button type="primary" @click="handlePostpone" :loading="submitting">
          提交申请
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { Plus, Refresh } from '@element-plus/icons-vue';
import {
  getAuditPlanYearView,
  createAuditPlan,
  updateAuditPlan,
  deleteAuditPlan,
  postponeAuditPlan
} from '@/api/audit';
import type {
  AuditPlan,
  AuditPlanCreate,
  AuditPlanYearViewResponse,
  AuditPlanPostponeRequest
} from '@/types/audit';

// 响应式数据
const loading = ref(false);
const submitting = ref(false);
const selectedYear = ref(new Date().getFullYear().toString());
const calendarDate = ref(new Date());
const yearView = ref<AuditPlanYearViewResponse | null>(null);
const showCreateDialog = ref(false);
const showDetailDialog = ref(false);
const showPostponeDialog = ref(false);
const selectedPlan = ref<AuditPlan | null>(null);
const editingPlan = ref<AuditPlan | null>(null);

// 表单引用
const planFormRef = ref<FormInstance>();
const postponeFormRef = ref<FormInstance>();

// 表单数据
const planForm = reactive<AuditPlanCreate>({
  audit_type: '',
  audit_name: '',
  planned_date: '',
  auditor_id: 0,
  auditee_dept: '',
  notes: ''
});

const postponeForm = reactive<AuditPlanPostponeRequest>({
  new_planned_date: '',
  postpone_reason: ''
});

// 表单验证规则
const planFormRules: FormRules = {
  audit_type: [{ required: true, message: '请选择审核类型', trigger: 'change' }],
  audit_name: [{ required: true, message: '请输入审核名称', trigger: 'blur' }],
  planned_date: [{ required: true, message: '请选择计划日期', trigger: 'change' }],
  auditor_id: [{ required: true, message: '请输入审核员ID', trigger: 'blur' }],
  auditee_dept: [{ required: true, message: '请输入被审核部门', trigger: 'blur' }]
};

const postponeFormRules: FormRules = {
  new_planned_date: [{ required: true, message: '请选择新的计划日期', trigger: 'change' }],
  postpone_reason: [{ required: true, message: '请输入延期原因', trigger: 'blur' }]
};

// 加载年度视图
const loadYearView = async () => {
  loading.value = true;
  try {
    yearView.value = await getAuditPlanYearView(parseInt(selectedYear.value));
  } catch (error: any) {
    ElMessage.error(error.message || '加载年度视图失败');
  } finally {
    loading.value = false;
  }
};

// 获取指定日期的审核计划
const getPlansForDate = (date: string): AuditPlan[] => {
  if (!yearView.value) return [];
  
  const dateObj = new Date(date);
  const monthKey = `${dateObj.getMonth() + 1}`;
  const monthPlans = yearView.value.by_month[monthKey] || [];
  
  return monthPlans.filter(plan => {
    const planDate = new Date(plan.planned_date);
    return planDate.toDateString() === dateObj.toDateString();
  });
};

// 处理计划点击
const handlePlanClick = (plan: AuditPlan) => {
  selectedPlan.value = plan;
  showDetailDialog.value = true;
};

// 处理编辑
const handleEdit = (plan: AuditPlan) => {
  editingPlan.value = plan;
  Object.assign(planForm, {
    audit_type: plan.audit_type,
    audit_name: plan.audit_name,
    planned_date: plan.planned_date,
    auditor_id: plan.auditor_id,
    auditee_dept: plan.auditee_dept,
    notes: plan.notes || ''
  });
  showDetailDialog.value = false;
  showCreateDialog.value = true;
};

// 提交表单
const handleSubmitPlan = async () => {
  if (!planFormRef.value) return;
  
  await planFormRef.value.validate(async (valid) => {
    if (!valid) return;
    
    submitting.value = true;
    try {
      if (editingPlan.value) {
        await updateAuditPlan(editingPlan.value.id, planForm);
        ElMessage.success('更新成功');
      } else {
        await createAuditPlan(planForm);
        ElMessage.success('创建成功');
      }
      
      showCreateDialog.value = false;
      editingPlan.value = null;
      planFormRef.value?.resetFields();
      await loadYearView();
    } catch (error: any) {
      ElMessage.error(error.message || '操作失败');
    } finally {
      submitting.value = false;
    }
  });
};

// 处理删除
const handleDelete = async (id: number) => {
  try {
    await ElMessageBox.confirm('确定要删除这个审核计划吗？', '确认删除', {
      type: 'warning'
    });
    
    await deleteAuditPlan(id);
    ElMessage.success('删除成功');
    showDetailDialog.value = false;
    await loadYearView();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败');
    }
  }
};

// 处理延期申请
const handlePostpone = async () => {
  if (!postponeFormRef.value || !selectedPlan.value) return;
  
  await postponeFormRef.value.validate(async (valid) => {
    if (!valid) return;
    
    submitting.value = true;
    try {
      await postponeAuditPlan(selectedPlan.value!.id, postponeForm);
      ElMessage.success('延期申请已提交');
      showPostponeDialog.value = false;
      postponeFormRef.value?.resetFields();
      await loadYearView();
    } catch (error: any) {
      ElMessage.error(error.message || '提交失败');
    } finally {
      submitting.value = false;
    }
  });
};

// 辅助函数
const getAuditTypeLabel = (type: string): string => {
  const labels: Record<string, string> = {
    system_audit: '体系审核 (IATF16949)',
    process_audit: '过程审核 (VDA6.3)',
    product_audit: '产品审核 (VDA6.5)',
    customer_audit: '客户审核'
  };
  return labels[type] || type;
};

const getStatusLabel = (status: string): string => {
  const labels: Record<string, string> = {
    planned: '已计划',
    in_progress: '进行中',
    completed: '已完成',
    postponed: '已延期',
    cancelled: '已取消'
  };
  return labels[status] || status;
};

const getStatusType = (status: string): 'success' | 'info' | 'warning' | 'danger' => {
  const types: Record<string, 'success' | 'info' | 'warning' | 'danger'> = {
    planned: 'info',
    in_progress: 'warning',
    completed: 'success',
    postponed: 'warning',
    cancelled: 'danger'
  };
  return types[status] || 'info';
};

const formatDateTime = (dateStr: string): string => {
  return new Date(dateStr).toLocaleString('zh-CN');
};

// 生命周期
onMounted(() => {
  loadYearView();
});
</script>

<style scoped>
.audit-plan-calendar {
  min-height: 100vh;
  background-color: #f5f7fa;
}

.stat-item {
  padding: 8px 16px;
  background-color: #f0f2f5;
  border-radius: 4px;
}

.calendar-cell {
  height: 100%;
  padding: 4px;
}

.date-number {
  font-size: 14px;
  font-weight: bold;
  color: #606266;
  margin-bottom: 4px;
}

.plans-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.plan-item {
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s;
  border-left: 3px solid;
}

.plan-item.plan-system_audit {
  background-color: #e6f7ff;
  border-left-color: #1890ff;
}

.plan-item.plan-process_audit {
  background-color: #f6ffed;
  border-left-color: #52c41a;
}

.plan-item.plan-product_audit {
  background-color: #fff7e6;
  border-left-color: #fa8c16;
}

.plan-item.plan-customer_audit {
  background-color: #fff0f6;
  border-left-color: #eb2f96;
}

.plan-item:hover {
  opacity: 0.8;
  transform: translateY(-2px);
}

.plan-content {
  display: flex;
  align-items: center;
  gap: 4px;
}

.plan-name {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.plan-detail {
  padding: 16px 0;
}
</style>
