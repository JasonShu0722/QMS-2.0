<template>
  <div class="audit-templates p-4 md:p-6">
    <!-- 页面标题 -->
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
      <div>
        <h1 class="text-2xl font-bold text-gray-800">审核模板库</h1>
        <p class="text-sm text-gray-500 mt-1">Audit Template Library - 审核检查表模板管理</p>
      </div>
      <el-button type="primary" @click="handleCreate">
        <el-icon class="mr-1"><Plus /></el-icon>
        创建自定义模板
      </el-button>
    </div>

    <!-- 筛选条件 -->
    <el-card class="mb-6">
      <el-form :inline="true" :model="queryForm" class="flex flex-wrap gap-4">
        <el-form-item label="审核类型">
          <el-select v-model="queryForm.audit_type" placeholder="全部" clearable class="w-48">
            <el-option label="体系审核" value="system_audit" />
            <el-option label="过程审核" value="process_audit" />
            <el-option label="产品审核" value="product_audit" />
            <el-option label="自定义" value="custom" />
          </el-select>
        </el-form-item>

        <el-form-item label="状态">
          <el-select v-model="queryForm.is_active" placeholder="全部" clearable class="w-32">
            <el-option label="启用" :value="true" />
            <el-option label="禁用" :value="false" />
          </el-select>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="loadTemplates">
            <el-icon class="mr-1"><Search /></el-icon>
            查询
          </el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 模板列表 -->
    <el-card v-loading="loading">
      <el-table :data="templates" stripe>
        <el-table-column prop="id" label="ID" width="80" />
        
        <el-table-column label="模板名称" min-width="200">
          <template #default="{ row }">
            <div class="flex items-center gap-2">
              <el-tag v-if="row.is_builtin" type="info" size="small">内置</el-tag>
              <span>{{ row.template_name }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="审核类型" width="150">
          <template #default="{ row }">
            {{ getAuditTypeLabel(row.audit_type) }}
          </template>
        </el-table-column>

        <el-table-column label="条款数量" width="120">
          <template #default="{ row }">
            {{ getChecklistItemCount(row.checklist_items) }}
          </template>
        </el-table-column>

        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.is_active ? 'success' : 'info'">
              {{ row.is_active ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatDateTime(row.created_at) }}
          </template>
        </el-table-column>

        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="handleView(row)">查看</el-button>
            <el-button link type="primary" @click="handleEdit(row)" :disabled="row.is_builtin">
              编辑
            </el-button>
            <el-button link type="danger" @click="handleDelete(row.id)" :disabled="row.is_builtin">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="mt-4 flex justify-end">
        <el-pagination
          v-model:current-page="queryForm.page"
          v-model:page-size="queryForm.page_size"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="loadTemplates"
          @current-change="loadTemplates"
        />
      </div>
    </el-card>

    <!-- 创建/编辑模板对话框 -->
    <el-dialog
      v-model="showFormDialog"
      :title="editingTemplate ? '编辑模板' : '创建模板'"
      width="800px"
      :close-on-click-modal="false"
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="formRules"
        label-width="120px"
      >
        <el-form-item label="模板名称" prop="template_name">
          <el-input v-model="form.template_name" placeholder="请输入模板名称" />
        </el-form-item>

        <el-form-item label="审核类型" prop="audit_type">
          <el-select v-model="form.audit_type" placeholder="请选择审核类型" class="w-full">
            <el-option label="体系审核 (IATF16949)" value="system_audit" />
            <el-option label="过程审核 (VDA6.3)" value="process_audit" />
            <el-option label="产品审核 (VDA6.5)" value="product_audit" />
            <el-option label="自定义审核" value="custom" />
          </el-select>
        </el-form-item>

        <el-form-item label="模板描述" prop="description">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            placeholder="请输入模板描述"
          />
        </el-form-item>

        <el-form-item label="检查表条款" prop="checklist_items">
          <div class="w-full">
            <el-button @click="handleAddChecklistItem" size="small" class="mb-2">
              <el-icon class="mr-1"><Plus /></el-icon>
              添加条款
            </el-button>
            
            <div v-for="(item, index) in checklistItems" :key="index" class="checklist-item mb-2">
              <el-card shadow="never">
                <div class="flex gap-2">
                  <el-input v-model="item.id" placeholder="条款ID" class="w-32" />
                  <el-input v-model="item.title" placeholder="条款标题" class="flex-1" />
                  <el-input-number v-model="item.max_score" :min="1" :max="10" placeholder="满分" class="w-24" />
                  <el-button type="danger" @click="handleRemoveChecklistItem(index)" size="small">
                    删除
                  </el-button>
                </div>
                <el-input
                  v-model="item.description"
                  type="textarea"
                  :rows="2"
                  placeholder="条款描述"
                  class="mt-2"
                />
              </el-card>
            </div>
          </div>
        </el-form-item>

        <el-form-item label="评分规则" prop="scoring_rules">
          <el-input
            v-model="scoringRulesText"
            type="textarea"
            :rows="4"
            placeholder="请输入评分规则说明"
          />
        </el-form-item>

        <el-form-item label="是否启用" prop="is_active">
          <el-switch v-model="form.is_active" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showFormDialog = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">
          {{ editingTemplate ? '更新' : '创建' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 查看模板详情对话框 -->
    <el-dialog
      v-model="showDetailDialog"
      title="模板详情"
      width="900px"
    >
      <div v-if="selectedTemplate">
        <el-descriptions :column="2" border class="mb-4">
          <el-descriptions-item label="模板名称" :span="2">
            {{ selectedTemplate.template_name }}
          </el-descriptions-item>
          <el-descriptions-item label="审核类型">
            {{ getAuditTypeLabel(selectedTemplate.audit_type) }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="selectedTemplate.is_active ? 'success' : 'info'">
              {{ selectedTemplate.is_active ? '启用' : '禁用' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="是否内置">
            <el-tag :type="selectedTemplate.is_builtin ? 'info' : 'success'">
              {{ selectedTemplate.is_builtin ? '是' : '否' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">
            {{ formatDateTime(selectedTemplate.created_at) }}
          </el-descriptions-item>
          <el-descriptions-item v-if="selectedTemplate.description" label="描述" :span="2">
            {{ selectedTemplate.description }}
          </el-descriptions-item>
        </el-descriptions>

        <h3 class="text-lg font-bold mb-2">检查表条款</h3>
        <el-table :data="getChecklistItemsArray(selectedTemplate.checklist_items)" border>
          <el-table-column prop="id" label="条款ID" width="100" />
          <el-table-column prop="title" label="条款标题" min-width="200" />
          <el-table-column prop="description" label="条款描述" min-width="300" />
          <el-table-column prop="max_score" label="满分" width="80" />
        </el-table>

        <h3 class="text-lg font-bold mt-4 mb-2">评分规则</h3>
        <el-card shadow="never">
          <pre class="whitespace-pre-wrap">{{ JSON.stringify(selectedTemplate.scoring_rules, null, 2) }}</pre>
        </el-card>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { Plus, Search } from '@element-plus/icons-vue';
import {
  getAuditTemplates,
  createAuditTemplate,
  updateAuditTemplate,
  deleteAuditTemplate
} from '@/api/audit';
import type { AuditTemplate, AuditTemplateCreate } from '@/types/audit';

// 响应式数据
const loading = ref(false);
const submitting = ref(false);
const templates = ref<AuditTemplate[]>([]);
const total = ref(0);
const showFormDialog = ref(false);
const showDetailDialog = ref(false);
const selectedTemplate = ref<AuditTemplate | null>(null);
const editingTemplate = ref<AuditTemplate | null>(null);

// 表单引用
const formRef = ref<FormInstance>();

// 查询表单
const queryForm = reactive({
  audit_type: '',
  is_active: undefined as boolean | undefined,
  page: 1,
  page_size: 20
});

// 检查表条款
interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  max_score: number;
}

const checklistItems = ref<ChecklistItem[]>([]);
const scoringRulesText = ref('');

// 表单数据
const form = reactive<AuditTemplateCreate>({
  template_name: '',
  audit_type: '',
  checklist_items: {},
  scoring_rules: {},
  description: '',
  is_active: true
});

// 表单验证规则
const formRules: FormRules = {
  template_name: [{ required: true, message: '请输入模板名称', trigger: 'blur' }],
  audit_type: [{ required: true, message: '请选择审核类型', trigger: 'change' }]
};

// 加载模板列表
const loadTemplates = async () => {
  loading.value = true;
  try {
    const response = await getAuditTemplates(queryForm);
    templates.value = response.items;
    total.value = response.total;
  } catch (error: any) {
    ElMessage.error(error.message || '加载模板列表失败');
  } finally {
    loading.value = false;
  }
};

// 重置查询
const handleReset = () => {
  queryForm.audit_type = '';
  queryForm.is_active = undefined;
  queryForm.page = 1;
  loadTemplates();
};

// 创建模板
const handleCreate = () => {
  editingTemplate.value = null;
  Object.assign(form, {
    template_name: '',
    audit_type: '',
    checklist_items: {},
    scoring_rules: {},
    description: '',
    is_active: true
  });
  checklistItems.value = [];
  scoringRulesText.value = '';
  showFormDialog.value = true;
};

// 编辑模板
const handleEdit = (template: AuditTemplate) => {
  editingTemplate.value = template;
  Object.assign(form, {
    template_name: template.template_name,
    audit_type: template.audit_type,
    checklist_items: template.checklist_items,
    scoring_rules: template.scoring_rules,
    description: template.description || '',
    is_active: template.is_active
  });
  
  // 转换检查表条款
  checklistItems.value = getChecklistItemsArray(template.checklist_items);
  scoringRulesText.value = JSON.stringify(template.scoring_rules, null, 2);
  
  showFormDialog.value = true;
};

// 查看模板
const handleView = (template: AuditTemplate) => {
  selectedTemplate.value = template;
  showDetailDialog.value = true;
};

// 删除模板
const handleDelete = async (id: number) => {
  try {
    await ElMessageBox.confirm('确定要删除这个模板吗？', '确认删除', {
      type: 'warning'
    });
    
    await deleteAuditTemplate(id);
    ElMessage.success('删除成功');
    await loadTemplates();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败');
    }
  }
};

// 添加检查表条款
const handleAddChecklistItem = () => {
  checklistItems.value.push({
    id: `item_${checklistItems.value.length + 1}`,
    title: '',
    description: '',
    max_score: 10
  });
};

// 删除检查表条款
const handleRemoveChecklistItem = (index: number) => {
  checklistItems.value.splice(index, 1);
};

// 提交表单
const handleSubmit = async () => {
  if (!formRef.value) return;
  
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    
    // 转换检查表条款为对象格式
    const checklistItemsObj: Record<string, any> = {};
    checklistItems.value.forEach(item => {
      checklistItemsObj[item.id] = {
        title: item.title,
        description: item.description,
        max_score: item.max_score
      };
    });
    
    // 解析评分规则
    let scoringRules = {};
    try {
      if (scoringRulesText.value.trim()) {
        scoringRules = JSON.parse(scoringRulesText.value);
      }
    } catch (e) {
      scoringRules = { description: scoringRulesText.value };
    }
    
    const data = {
      ...form,
      checklist_items: checklistItemsObj,
      scoring_rules: scoringRules
    };
    
    submitting.value = true;
    try {
      if (editingTemplate.value) {
        await updateAuditTemplate(editingTemplate.value.id, data);
        ElMessage.success('更新成功');
      } else {
        await createAuditTemplate(data);
        ElMessage.success('创建成功');
      }
      
      showFormDialog.value = false;
      await loadTemplates();
    } catch (error: any) {
      ElMessage.error(error.message || '操作失败');
    } finally {
      submitting.value = false;
    }
  });
};

// 辅助函数
const getAuditTypeLabel = (type: string): string => {
  const labels: Record<string, string> = {
    system_audit: '体系审核',
    process_audit: '过程审核',
    product_audit: '产品审核',
    custom: '自定义'
  };
  return labels[type] || type;
};

const getChecklistItemCount = (items: Record<string, any>): number => {
  return Object.keys(items || {}).length;
};

const getChecklistItemsArray = (items: Record<string, any>): ChecklistItem[] => {
  return Object.entries(items || {}).map(([id, data]: [string, any]) => ({
    id,
    title: data.title || '',
    description: data.description || '',
    max_score: data.max_score || 10
  }));
};

const formatDateTime = (dateStr: string): string => {
  return new Date(dateStr).toLocaleString('zh-CN');
};

// 生命周期
onMounted(() => {
  loadTemplates();
});
</script>

<style scoped>
.audit-templates {
  min-height: 100vh;
  background-color: #f5f7fa;
}

.checklist-item {
  border-left: 3px solid #409eff;
}
</style>
