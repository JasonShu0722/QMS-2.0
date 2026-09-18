<template>
  <div class="supplier-performance">
    <div class="page-header">
      <h2>供应商绩效评价</h2>
    </div>

    <!-- 筛选条件 -->
    <el-card class="filter-card" shadow="never">
      <el-form :model="filterForm" inline>
        <el-form-item label="月份">
          <el-date-picker
            v-model="filterForm.month"
            type="month"
            placeholder="选择月份"
            value-format="YYYY-MM"
          />
        </el-form-item>
        <el-form-item label="等级">
          <el-select v-model="filterForm.grade" placeholder="全部" clearable>
            <el-option label="A级" value="A" />
            <el-option label="B级" value="B" />
            <el-option label="C级" value="C" />
            <el-option label="D级" value="D" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">
            <el-icon><Search /></el-icon>
            查询
          </el-button>
          <el-button @click="handleReset">
            <el-icon><Refresh /></el-icon>
            重置
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 绩效列表 -->
    <el-card class="table-card" shadow="never">
      <el-table v-loading="loading" :data="performanceList" stripe>
        <el-table-column prop="month" label="月份" width="120" />
        <el-table-column prop="supplier_name" label="供应商" width="150" />
        <el-table-column prop="incoming_quality_score" label="来料质量得分" width="120" align="right" />
        <el-table-column prop="process_quality_score" label="制程质量得分" width="120" align="right" />
        <el-table-column prop="cooperation_score" label="配合度得分" width="120" align="right" />
        <el-table-column prop="final_score" label="最终得分" width="100" align="right">
          <template #default="{ row }">
            <span class="final-score">{{ row.final_score }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="grade" label="等级" width="100">
          <template #default="{ row }">
            <el-tag :type="getGradeType(row.grade)" size="large">
              {{ row.grade }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="handleViewDetail(row)">
              查看详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-container">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.page_size"
          :total="pagination.total"
          layout="total, prev, pager, next"
          @current-change="loadPerformanceList"
        />
      </div>
    </el-card>

    <!-- 绩效详情对话框 -->
    <el-dialog
      v-model="showDetailDialog"
      title="绩效详情"
      width="800px"
    >
      <el-descriptions v-if="selectedPerformance" :column="2" border>
        <el-descriptions-item label="月份">{{ selectedPerformance.month }}</el-descriptions-item>
        <el-descriptions-item label="供应商">{{ selectedPerformance.supplier_name }}</el-descriptions-item>
        <el-descriptions-item label="来料质量得分">{{ selectedPerformance.incoming_quality_score }}</el-descriptions-item>
        <el-descriptions-item label="制程质量得分">{{ selectedPerformance.process_quality_score }}</el-descriptions-item>
        <el-descriptions-item label="配合度得分">{{ selectedPerformance.cooperation_score }}</el-descriptions-item>
        <el-descriptions-item label="最终得分">
          <span class="final-score">{{ selectedPerformance.final_score }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="等级">
          <el-tag :type="getGradeType(selectedPerformance.grade)" size="large">
            {{ selectedPerformance.grade }}
          </el-tag>
        </el-descriptions-item>
      </el-descriptions>

      <div v-if="selectedPerformance?.deduction_details" class="deduction-details">
        <h4>扣分明细</h4>
        <pre>{{ JSON.stringify(selectedPerformance.deduction_details, null, 2) }}</pre>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Refresh } from '@element-plus/icons-vue'
import { supplierApi } from '@/api/supplier'
import type { SupplierPerformance } from '@/types/supplier'

const loading = ref(false)
const showDetailDialog = ref(false)
const performanceList = ref<SupplierPerformance[]>([])
const selectedPerformance = ref<SupplierPerformance | null>(null)

const filterForm = reactive({
  month: '',
  grade: ''
})

const pagination = reactive({
  page: 1,
  page_size: 20,
  total: 0
})

// 获取等级类型
const getGradeType = (grade: string) => {
  switch (grade) {
    case 'A': return 'success'
    case 'B': return 'primary'
    case 'C': return 'warning'
    case 'D': return 'danger'
    default: return 'info'
  }
}

// 查询
const handleSearch = () => {
  pagination.page = 1
  loadPerformanceList()
}

// 重置
const handleReset = () => {
  filterForm.month = ''
  filterForm.grade = ''
  handleSearch()
}

// 查看详情
const handleViewDetail = (row: SupplierPerformance) => {
  selectedPerformance.value = row
  showDetailDialog.value = true
}

// 加载绩效列表
const loadPerformanceList = async () => {
  try {
    loading.value = true
    const response = await supplierApi.getPerformanceList({
      page: pagination.page,
      page_size: pagination.page_size,
      ...filterForm
    })
    performanceList.value = response.items
    pagination.total = response.total
  } catch (error) {
    console.error('Failed to load performance list:', error)
    ElMessage.error('加载绩效列表失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadPerformanceList()
})
</script>

<style scoped lang="scss">
.supplier-performance {
  padding: 20px;

  .page-header {
    margin-bottom: 20px;

    h2 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
  }

  .filter-card {
    margin-bottom: 20px;
  }

  .table-card {
    .final-score {
      font-size: 18px;
      font-weight: bold;
      color: #409eff;
    }

    .pagination-container {
      margin-top: 20px;
      display: flex;
      justify-content: flex-end;
    }
  }

  .deduction-details {
    margin-top: 20px;

    h4 {
      margin-bottom: 10px;
    }

    pre {
      background: #f5f7fa;
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
    }
  }
}
</style>
