<template>
  <div class="process-defect-list">
    <!-- 页面标题 -->
    <div class="page-header mb-6">
      <h1 class="text-2xl font-bold">不合格品数据清单</h1>
      <p class="text-gray-500 mt-2">制程不良品记录管理与查询</p>
    </div>

    <!-- 筛选条件 -->
    <el-card class="filter-card mb-4">
      <el-form :model="filterForm" inline>
        <el-form-item label="不良日期">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
            class="w-64"
          />
        </el-form-item>

        <el-form-item label="工单号">
          <el-input
            v-model="filterForm.work_order"
            placeholder="请输入工单号"
            clearable
            class="w-48"
          />
        </el-form-item>

        <el-form-item label="工序">
          <el-input
            v-model="filterForm.process_id"
            placeholder="请输入工序ID"
            clearable
            class="w-40"
          />
        </el-form-item>

        <el-form-item label="产线">
          <el-input
            v-model="filterForm.line_id"
            placeholder="请输入产线ID"
            clearable
            class="w-40"
          />
        </el-form-item>

        <el-form-item label="责任类别">
          <el-select
            v-model="filterForm.responsibility_category"
            placeholder="请选择责任类别"
            clearable
            class="w-48"
          >
            <el-option
              v-for="cat in responsibilityCategories"
              :key="cat.value"
              :label="cat.label"
              :value="cat.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="物料编码">
          <el-input
            v-model="filterForm.material_code"
            placeholder="请输入物料编码"
            clearable
            class="w-48"
          />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :icon="Search" @click="handleSearch">查询</el-button>
          <el-button :icon="Refresh" @click="handleReset">重置</el-button>
          <el-button type="success" :icon="Plus" @click="handleCreate">录入不良品</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 数据表格 -->
    <el-card>
      <el-table
        v-loading="loading"
        :data="tableData"
        stripe
        border
        style="width: 100%"
      >
        <el-table-column prop="defect_date" label="不良日期" width="120" />
        <el-table-column prop="work_order" label="工单号" width="150" />
        <el-table-column prop="process_id" label="工序" width="100" />
        <el-table-column prop="line_id" label="产线" width="100" />
        <el-table-column prop="defect_type" label="不良类型" min-width="150" show-overflow-tooltip />
        <el-table-column prop="defect_qty" label="不良数量" width="100" align="right" />
        
        <el-table-column label="责任类别" width="120">
          <template #default="{ row }">
            <el-tag :type="getResponsibilityTagType(row.responsibility_category)">
              {{ getResponsibilityLabel(row.responsibility_category) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="material_code" label="物料编码" width="120" show-overflow-tooltip />
        <el-table-column prop="supplier_name" label="供应商" width="150" show-overflow-tooltip />
        <el-table-column prop="operator_name" label="操作员" width="100" />
        <el-table-column prop="recorded_by_name" label="录入人" width="100" />

        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" link @click="handleView(row)">
              查看
            </el-button>
            <el-button type="warning" size="small" link @click="handleEdit(row)">
              编辑
            </el-button>
            <el-button type="danger" size="small" link @click="handleDelete(row)">
              删除
            </el-button>
            <el-button type="success" size="small" link @click="handleCreateIssue(row)">
              发起问题单
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination-container mt-4 flex justify-end">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.page_size"
          :page-sizes="[10, 20, 50, 100]"
          :total="pagination.total"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSizeChange"
          @current-change="handlePageChange"
        />
      </div>
    </el-card>

    <!-- 录入/编辑对话框 -->
    <ProcessDefectForm
      v-model:visible="formDialogVisible"
      :defect-id="currentDefectId"
      @success="handleFormSuccess"
    />

    <ProcessIssueCreateDialog
      v-model="issueDialogVisible"
      :seed-defect="issueSeedDefect"
      @success="handleIssueCreateSuccess"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Search, Refresh, Plus } from '@element-plus/icons-vue';
import {
  getProcessDefects,
  deleteProcessDefect,
  getResponsibilityCategories
} from '@/api/process-quality';
import type {
  ProcessDefect,
  ProcessDefectListQuery,
  ResponsibilityCategory,
  ResponsibilityCategoryOption
} from '@/types/process-quality';
import ProcessDefectForm from '@/components/ProcessDefectForm.vue';
import ProcessIssueCreateDialog from '@/components/ProcessIssueCreateDialog.vue';
import { useRouter } from 'vue-router';

const router = useRouter();

// 状态
const loading = ref(false);
const tableData = ref<ProcessDefect[]>([]);
const responsibilityCategories = ref<ResponsibilityCategoryOption[]>([]);
const formDialogVisible = ref(false);
const currentDefectId = ref<number | null>(null);
const issueDialogVisible = ref(false);
const issueSeedDefect = ref<ProcessDefect | null>(null);

// 日期范围
const dateRange = ref<[string, string]>([
  new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  new Date().toISOString().split('T')[0]
]);

// 筛选表单
const filterForm = reactive<ProcessDefectListQuery>({
  work_order: '',
  process_id: '',
  line_id: '',
  responsibility_category: undefined,
  material_code: '',
  page: 1,
  page_size: 20
});

// 分页
const pagination = reactive({
  page: 1,
  page_size: 20,
  total: 0
});

// 获取责任类别标签类型
const getResponsibilityTagType = (category: ResponsibilityCategory): string => {
  const typeMap: Record<ResponsibilityCategory, string> = {
    material_defect: 'danger',
    operation_defect: 'warning',
    equipment_defect: 'info',
    process_defect: 'primary',
    design_defect: 'success'
  };
  return typeMap[category] || 'info';
};

// 获取责任类别标签文本
const getResponsibilityLabel = (category: ResponsibilityCategory): string => {
  const cat = responsibilityCategories.value.find(c => c.value === category);
  return cat?.label || category;
};

// 加载责任类别选项
const loadResponsibilityCategories = async () => {
  try {
    const response = await getResponsibilityCategories();
    responsibilityCategories.value = response.categories;
  } catch (error) {
    console.error('Failed to load responsibility categories:', error);
  }
};

// 加载数据
const loadData = async () => {
  loading.value = true;
  try {
    const params: ProcessDefectListQuery = {
      ...filterForm,
      defect_date_start: dateRange.value[0],
      defect_date_end: dateRange.value[1],
      page: pagination.page,
      page_size: pagination.page_size
    };

    const response = await getProcessDefects(params);
    tableData.value = response.items;
    pagination.total = response.total;
  } catch (error) {
    console.error('Failed to load process defects:', error);
    ElMessage.error('加载不良品数据失败');
  } finally {
    loading.value = false;
  }
};

// 查询
const handleSearch = () => {
  pagination.page = 1;
  loadData();
};

// 重置
const handleReset = () => {
  Object.assign(filterForm, {
    work_order: '',
    process_id: '',
    line_id: '',
    responsibility_category: undefined,
    material_code: '',
    page: 1,
    page_size: 20
  });
  dateRange.value = [
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    new Date().toISOString().split('T')[0]
  ];
  handleSearch();
};

// 创建
const handleCreate = () => {
  currentDefectId.value = null;
  formDialogVisible.value = true;
};

// 查看
const handleView = (row: ProcessDefect) => {
  currentDefectId.value = row.id;
  formDialogVisible.value = true;
};

// 编辑
const handleEdit = (row: ProcessDefect) => {
  currentDefectId.value = row.id;
  formDialogVisible.value = true;
};

// 删除
const handleDelete = async (row: ProcessDefect) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除工单 ${row.work_order} 的不良品记录吗？`,
      '删除确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    );

    await deleteProcessDefect(row.id);
    ElMessage.success('删除成功');
    loadData();
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Failed to delete process defect:', error);
      ElMessage.error('删除失败');
    }
  }
};

// 发起问题单
const handleCreateIssue = (row: ProcessDefect) => {
  issueSeedDefect.value = row;
  issueDialogVisible.value = true;
};

const handleIssueCreateSuccess = (issueId: number) => {
  issueDialogVisible.value = false;
  issueSeedDefect.value = null;
  router.push({
    name: 'ProcessIssueDetail',
    params: { id: issueId }
  });
};

// 表单提交成功
const handleFormSuccess = () => {
  formDialogVisible.value = false;
  loadData();
};

// 分页变化
const handleSizeChange = (size: number) => {
  pagination.page_size = size;
  pagination.page = 1;
  loadData();
};

const handlePageChange = (page: number) => {
  pagination.page = page;
  loadData();
};

// 生命周期
onMounted(() => {
  loadResponsibilityCategories();
  loadData();
});
</script>

<style scoped>
.process-defect-list {
  padding: 20px;
  min-height: 100vh;
  background-color: #f5f7fa;
}

.page-header {
  margin-bottom: 24px;
}

.filter-card {
  margin-bottom: 16px;
}

.pagination-container {
  margin-top: 16px;
}

/* 移动端适配 */
@media (max-width: 768px) {
  .process-defect-list {
    padding: 12px;
  }

  .el-form--inline .el-form-item {
    display: block;
    margin-right: 0;
    margin-bottom: 12px;
  }

  .el-form--inline .el-form-item .el-input,
  .el-form--inline .el-form-item .el-select,
  .el-form--inline .el-form-item .el-date-picker {
    width: 100% !important;
  }
}
</style>
