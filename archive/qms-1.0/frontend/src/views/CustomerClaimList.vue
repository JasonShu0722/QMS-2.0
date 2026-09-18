<template>
  <div class="customer-claim-list p-4 md:p-6">
    <!-- 页面标题 -->
    <div class="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
      <h1 class="text-2xl font-bold mb-4 md:mb-0">客户索赔管理</h1>
      <el-button type="primary" @click="showCreateDialog = true">
        <el-icon class="mr-1"><Plus /></el-icon>
        登记客户索赔
      </el-button>
    </div>

    <!-- 筛选条件 -->
    <el-card class="mb-4">
      <el-form :model="queryParams" inline class="flex flex-wrap gap-2">
        <el-form-item label="客户名称">
          <el-input v-model="queryParams.customer_name" placeholder="请输入" clearable class="w-full md:w-40" />
        </el-form-item>

        <el-form-item label="日期范围">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            class="w-full md:w-64"
          />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="handleSearch">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 数据表格 -->
    <el-card>
      <el-table
        v-loading="loading"
        :data="claimList"
        stripe
        class="w-full"
        show-summary
        :summary-method="getSummaries"
      >
        <el-table-column type="index" label="序号" width="60" />
        <el-table-column prop="customer_name" label="客户名称" width="150" />
        <el-table-column prop="claim_amount" label="索赔金额" width="120" align="right">
          <template #default="{ row }">
            <span class="text-red-600 font-semibold">
              {{ formatCurrency(row.claim_amount, row.claim_currency) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="claim_currency" label="币种" width="80" />
        <el-table-column prop="claim_date" label="索赔日期" width="120" />
        <el-table-column prop="complaint_ids" label="关联客诉单" min-width="150">
          <template #default="{ row }">
            <el-tag
              v-for="id in row.complaint_ids"
              :key="id"
              size="small"
              class="mr-1 mb-1"
            >
              {{ id }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="160" />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleView(row)">
              查看详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="flex justify-end mt-4">
        <el-pagination
          v-model:current-page="queryParams.page"
          v-model:page-size="queryParams.page_size"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSearch"
          @current-change="handleSearch"
        />
      </div>
    </el-card>

    <!-- 创建索赔对话框 -->
    <el-dialog
      v-model="showCreateDialog"
      title="登记客户索赔"
      width="90%"
      :close-on-click-modal="false"
      class="max-w-2xl"
    >
      <el-form
        ref="formRef"
        :model="formData"
        :rules="rules"
        label-width="120px"
      >
        <el-form-item label="客户名称" prop="customer_name">
          <el-input v-model="formData.customer_name" placeholder="请输入客户名称" />
        </el-form-item>

        <el-form-item label="索赔金额" prop="claim_amount">
          <el-input-number
            v-model="formData.claim_amount"
            :min="0"
            :precision="2"
            :controls="false"
            placeholder="请输入索赔金额"
            class="w-full"
          />
        </el-form-item>

        <el-form-item label="币种" prop="claim_currency">
          <el-select v-model="formData.claim_currency" placeholder="请选择币种">
            <el-option label="人民币 (CNY)" value="CNY" />
            <el-option label="美元 (USD)" value="USD" />
            <el-option label="欧元 (EUR)" value="EUR" />
          </el-select>
        </el-form-item>

        <el-form-item label="索赔日期" prop="claim_date">
          <el-date-picker
            v-model="formData.claim_date"
            type="date"
            placeholder="选择索赔日期"
            value-format="YYYY-MM-DD"
            class="w-full"
          />
        </el-form-item>

        <el-form-item label="关联客诉单" prop="complaint_ids">
          <el-select
            v-model="formData.complaint_ids"
            multiple
            filterable
            placeholder="请选择关联的客诉单"
            class="w-full"
          >
            <!-- TODO: 从API加载客诉单列表 -->
            <el-option
              v-for="item in availableComplaints"
              :key="item.id"
              :label="`${item.complaint_number} - ${item.defect_description}`"
              :value="item.id"
            />
          </el-select>
          <div class="text-xs text-gray-500 mt-1">可多选关联多个客诉单</div>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="handleSubmit" :loading="submitting">
            提交
          </el-button>
          <el-button @click="showCreateDialog = false">取消</el-button>
        </el-form-item>
      </el-form>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import { getCustomerClaims, createCustomerClaim, getCustomerComplaints } from '@/api/customer-quality';
import type {
  CustomerClaim,
  CustomerClaimCreate,
  CustomerClaimListQuery,
  CustomerComplaint
} from '@/types/customer-quality';

// 数据状态
const loading = ref(false);
const submitting = ref(false);
const claimList = ref<CustomerClaim[]>([]);
const total = ref(0);
const showCreateDialog = ref(false);
const dateRange = ref<[string, string] | null>(null);
const availableComplaints = ref<CustomerComplaint[]>([]);

// 表单引用
const formRef = ref<FormInstance>();

// 查询参数
const queryParams = reactive<CustomerClaimListQuery>({
  page: 1,
  page_size: 20,
  customer_name: undefined,
  start_date: undefined,
  end_date: undefined
});

// 表单数据
const formData = reactive<CustomerClaimCreate>({
  customer_name: '',
  claim_amount: 0,
  claim_currency: 'CNY',
  claim_date: '',
  complaint_ids: []
});

// 表单验证规则
const rules: FormRules = {
  customer_name: [{ required: true, message: '请输入客户名称', trigger: 'blur' }],
  claim_amount: [{ required: true, message: '请输入索赔金额', trigger: 'blur' }],
  claim_currency: [{ required: true, message: '请选择币种', trigger: 'change' }],
  claim_date: [{ required: true, message: '请选择索赔日期', trigger: 'change' }],
  complaint_ids: [{ required: true, message: '请选择关联客诉单', trigger: 'change' }]
};

/**
 * 格式化货币
 */
function formatCurrency(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(2)}`;
}

/**
 * 计算合计
 */
function getSummaries(param: any) {
  const { columns, data } = param;
  const sums: string[] = [];

  columns.forEach((column: any, index: number) => {
    if (index === 0) {
      sums[index] = '合计';
      return;
    }
    if (column.property === 'claim_amount') {
      const values = data.map((item: CustomerClaim) => item.claim_amount);
      const total = values.reduce((prev: number, curr: number) => prev + curr, 0);
      sums[index] = `CNY ${total.toFixed(2)}`;
    } else {
      sums[index] = '';
    }
  });

  return sums;
}

/**
 * 加载索赔列表
 */
async function loadClaims() {
  loading.value = true;
  try {
    // 处理日期范围
    if (dateRange.value) {
      queryParams.start_date = dateRange.value[0];
      queryParams.end_date = dateRange.value[1];
    } else {
      queryParams.start_date = undefined;
      queryParams.end_date = undefined;
    }

    const response = await getCustomerClaims(queryParams);
    claimList.value = response.items;
    total.value = response.total;
  } catch (error) {
    ElMessage.error('加载索赔列表失败');
    console.error('Load claims error:', error);
  } finally {
    loading.value = false;
  }
}

/**
 * 加载可用的客诉单
 */
async function loadAvailableComplaints() {
  try {
    const response = await getCustomerComplaints({ page: 1, page_size: 100 });
    availableComplaints.value = response.items;
  } catch (error) {
    console.error('Load complaints error:', error);
  }
}

/**
 * 查询
 */
function handleSearch() {
  queryParams.page = 1;
  loadClaims();
}

/**
 * 重置
 */
function handleReset() {
  queryParams.page = 1;
  queryParams.page_size = 20;
  queryParams.customer_name = undefined;
  dateRange.value = null;
  loadClaims();
}

/**
 * 查看详情
 */
function handleView(_row: CustomerClaim) {
  // TODO: 实现详情页面
  ElMessage.info('详情页面开发中');
}

/**
 * 提交表单
 */
async function handleSubmit() {
  if (!formRef.value) return;

  try {
    await formRef.value.validate();
    submitting.value = true;

    await createCustomerClaim(formData);
    ElMessage.success('客户索赔登记成功');
    showCreateDialog.value = false;
    loadClaims();
  } catch (error: any) {
    if (error !== false) {
      ElMessage.error(error.message || '登记失败');
      console.error('Create claim error:', error);
    }
  } finally {
    submitting.value = false;
  }
}

// 初始化
onMounted(() => {
  loadClaims();
  loadAvailableComplaints();
});
</script>

<style scoped>
.customer-claim-list {
  min-height: 100vh;
}

/* 移动端适配 */
@media (max-width: 768px) {
  :deep(.el-table) {
    font-size: 12px;
  }

  :deep(.el-button) {
    padding: 4px 8px;
    font-size: 12px;
  }
}
</style>
