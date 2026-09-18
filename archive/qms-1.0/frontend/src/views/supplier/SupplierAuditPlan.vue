<template>
  <div class="supplier-audit-plan">
    <div class="page-header">
      <h2>供应商审核计划</h2>
    </div>

    <!-- 年度审核计划日历视图 -->
    <el-card shadow="never">
      <el-calendar v-model="selectedDate">
        <template #date-cell="{ data }">
          <div class="calendar-cell" @click="handleDateClick(data.day)">
            <div class="date-number">{{ data.day.split('-').slice(-1)[0] }}</div>
            <div v-if="getAuditsForDate(data.day).length > 0" class="audit-indicators">
              <el-badge 
                :value="getAuditsForDate(data.day).length" 
                class="audit-badge"
                type="primary"
              />
            </div>
          </div>
        </template>
      </el-calendar>
    </el-card>

    <!-- 审核列表 -->
    <el-card class="audit-list-card" shadow="never">
      <template #header>
        <span>审核记录</span>
      </template>

      <el-table v-loading="loading" :data="auditList" stripe>
        <el-table-column prop="audit_date" label="审核日期" width="120">
          <template #default="{ row }">
            {{ formatDate(row.audit_date) }}
          </template>
        </el-table-column>
        <el-table-column prop="audit_type" label="审核类型" width="120">
          <template #default="{ row }">
            {{ getAuditTypeLabel(row.audit_type) }}
          </template>
        </el-table-column>
        <el-table-column prop="auditor_name" label="审核员" width="100" />
        <el-table-column prop="score" label="得分" width="80" />
        <el-table-column prop="audit_result" label="结果" width="120">
          <template #default="{ row }">
            <el-tag :type="getAuditResultType(row.audit_result)" size="small">
              {{ getAuditResultLabel(row.audit_result) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="不符合项" width="100">
          <template #default="{ row }">
            <el-badge :value="row.nc_items?.length || 0" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150">
          <template #default>
            <el-button type="primary" size="small" @click="handleView">
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
          @current-change="loadAuditList"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { supplierApi } from '@/api/supplier'
import type { SupplierAudit } from '@/types/supplier'

const loading = ref(false)
const selectedDate = ref(new Date())
const auditList = ref<SupplierAudit[]>([])

const pagination = reactive({
  page: 1,
  page_size: 20,
  total: 0
})

// 获取指定日期的审核
const getAuditsForDate = (date: string) => {
  return auditList.value.filter(audit => audit.audit_date.startsWith(date))
}

// 日期点击
const handleDateClick = (date: string) => {
  const audits = getAuditsForDate(date)
  if (audits.length > 0) {
    ElMessage.info(`${date} 有 ${audits.length} 个审核计划`)
  }
}

// 获取审核类型标签
const getAuditTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    qualification: '准入审核',
    annual: '年度审核',
    special: '专项审核'
  }
  return labels[type] || type
}

// 获取审核结果类型
const getAuditResultType = (result: string) => {
  switch (result) {
    case 'pass': return 'success'
    case 'conditional_pass': return 'warning'
    case 'fail': return 'danger'
    default: return 'info'
  }
}

// 获取审核结果标签
const getAuditResultLabel = (result: string) => {
  const labels: Record<string, string> = {
    pass: '通过',
    conditional_pass: '有条件通过',
    fail: '不通过'
  }
  return labels[result] || result
}

// 格式化日期
const formatDate = (date: string) => {
  if (!date) return ''
  return new Date(date).toLocaleDateString('zh-CN')
}

// 查看详情
const handleView = () => {
  ElMessage.info('查看审核详情功能开发中')
}

// 加载审核列表
const loadAuditList = async () => {
  try {
    loading.value = true
    const response = await supplierApi.getAuditPlanList({
      page: pagination.page,
      page_size: pagination.page_size
    })
    auditList.value = response.items
    pagination.total = response.total
  } catch (error) {
    console.error('Failed to load audit list:', error)
    ElMessage.error('加载审核列表失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadAuditList()
})
</script>

<style scoped lang="scss">
.supplier-audit-plan {
  padding: 20px;

  .page-header {
    margin-bottom: 20px;

    h2 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
  }

  .calendar-cell {
    height: 100%;
    padding: 4px;
    cursor: pointer;

    &:hover {
      background: #f5f7fa;
    }

    .date-number {
      font-size: 14px;
    }

    .audit-indicators {
      margin-top: 4px;
    }
  }

  .audit-list-card {
    margin-top: 20px;

    .pagination-container {
      margin-top: 20px;
      display: flex;
      justify-content: flex-end;
    }
  }
}
</style>
