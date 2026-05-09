<template>
  <div class="supplier-dashboard">
    <!-- 加载状态 -->
    <div v-if="loading" class="loading-container">
      <el-skeleton :rows="5" animated />
    </div>

    <!-- 供应商仪表盘内容 -->
    <div v-else class="dashboard-content">
      <!-- 绩效红绿灯卡片 -->
      <el-card class="performance-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <span>当前绩效状态</span>
            <el-tag :type="performanceTagType" size="large">
              {{ dashboardData?.performance_status?.grade || 'N/A' }} 级
            </el-tag>
          </div>
        </template>
        
        <div class="performance-status">
          <div class="grade-badge" :class="`grade-${dashboardData?.performance_status?.grade?.toLowerCase()}`">
            <div class="grade-letter">{{ dashboardData?.performance_status?.grade || 'N/A' }}</div>
            <div class="grade-label">绩效等级</div>
          </div>
          
          <div class="score-info">
            <div class="score-item">
              <span class="label">当前得分</span>
              <span class="value">{{ dashboardData?.performance_status?.score || 0 }}</span>
            </div>
            <div class="score-item deduction">
              <span class="label">本月扣分</span>
              <span class="value danger">{{ dashboardData?.performance_status?.deduction_this_month || 0 }}</span>
            </div>
          </div>
        </div>
      </el-card>

      <!-- 待处理任务 -->
      <el-card class="action-required-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <span>待处理任务</span>
            <el-badge :value="dashboardData?.action_required_tasks?.length || 0" class="badge" />
          </div>
        </template>

        <div v-if="dashboardData?.action_required_tasks && dashboardData.action_required_tasks.length > 0" class="task-list">
          <div 
            v-for="task in dashboardData.action_required_tasks" 
            :key="task.id" 
            class="task-item"
            :class="`task-item--${task.urgency}`"
          >
            <el-alert 
              :title="task.title" 
              :type="getAlertType(task.urgency)" 
              :closable="false"
              show-icon
            >
              <template #default>
                <p class="task-description">{{ task.description }}</p>
                <div class="task-footer">
                  <span v-if="task.deadline" class="deadline">
                    <el-icon><Clock /></el-icon>
                    截止时间: {{ formatDate(task.deadline) }}
                  </span>
                  <el-button 
                    type="primary" 
                    size="small" 
                    @click="handleTaskClick(task)"
                  >
                    立即处理
                  </el-button>
                </div>
              </template>
            </el-alert>
          </div>
        </div>

        <el-empty 
          v-else
          description="暂无待处理任务"
          :image-size="100"
        />
      </el-card>

      <!-- 最近的 SCAR 单据 -->
      <el-card class="recent-scars-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <span>最近的 SCAR 单据</span>
            <el-button type="primary" size="small" @click="goToSCARList">
              查看全部
            </el-button>
          </div>
        </template>

        <el-table 
          v-if="dashboardData?.recent_scars && dashboardData.recent_scars.length > 0"
          :data="dashboardData.recent_scars" 
          stripe
        >
          <el-table-column prop="scar_number" label="单据编号" width="150" />
          <el-table-column prop="material_code" label="物料编码" width="120" />
          <el-table-column prop="defect_description" label="缺陷描述" show-overflow-tooltip />
          <el-table-column prop="severity" label="严重度" width="100">
            <template #default="{ row }">
              <el-tag :type="getSeverityType(row.severity)" size="small">
                {{ getSeverityLabel(row.severity) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="getStatusType(row.status)" size="small">
                {{ getStatusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100">
            <template #default="{ row }">
              <el-button type="primary" size="small" @click="goToSCARDetail(row.id)">
                查看
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-empty 
          v-else
          description="暂无 SCAR 单据"
          :image-size="100"
        />
      </el-card>

      <!-- 最近的审核记录 -->
      <el-card class="recent-audits-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <span>最近的审核记录</span>
            <el-button type="primary" size="small" @click="goToAuditList">
              查看全部
            </el-button>
          </div>
        </template>

        <el-table 
          v-if="dashboardData?.recent_audits && dashboardData.recent_audits.length > 0"
          :data="dashboardData.recent_audits" 
          stripe
        >
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
        </el-table>

        <el-empty 
          v-else
          description="暂无审核记录"
          :image-size="100"
        />
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Clock } from '@element-plus/icons-vue'
import { supplierApi } from '@/api/supplier'
import type { SupplierDashboardData } from '@/types/supplier'

const router = useRouter()
const loading = ref(true)
const dashboardData = ref<SupplierDashboardData | null>(null)

// 绩效等级对应的标签类型
const performanceTagType = computed(() => {
  const grade = dashboardData.value?.performance_status?.grade
  switch (grade) {
    case 'A': return 'success'
    case 'B': return 'primary'
    case 'C': return 'warning'
    case 'D': return 'danger'
    default: return 'info'
  }
})

// 获取告警类型
const getAlertType = (urgency: string) => {
  switch (urgency) {
    case 'danger': return 'error'
    case 'warning': return 'warning'
    default: return 'info'
  }
}

// 获取严重度类型
const getSeverityType = (severity: string) => {
  switch (severity) {
    case 'critical': return 'danger'
    case 'high': return 'warning'
    case 'medium': return 'primary'
    default: return 'info'
  }
}

// 获取严重度标签
const getSeverityLabel = (severity: string) => {
  const labels: Record<string, string> = {
    critical: '重大',
    high: '高',
    medium: '中',
    low: '低'
  }
  return labels[severity] || severity
}

// 获取状态类型
const getStatusType = (status: string) => {
  switch (status) {
    case 'closed': return 'success'
    case 'approved': return 'success'
    case 'rejected': return 'danger'
    case 'in_progress': return 'warning'
    default: return 'info'
  }
}

// 获取状态标签
const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    pending: '待处理',
    in_progress: '进行中',
    submitted: '已提交',
    approved: '已批准',
    rejected: '已驳回',
    closed: '已关闭'
  }
  return labels[status] || status
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

// 处理任务点击
const handleTaskClick = (task: any) => {
  if (task.link) {
    router.push(task.link)
  }
}

// 跳转到 SCAR 列表
const goToSCARList = () => {
  router.push('/supplier/scar')
}

// 跳转到 SCAR 详情
const goToSCARDetail = (id: number) => {
  router.push(`/supplier/scar/${id}`)
}

// 跳转到审核列表
const goToAuditList = () => {
  router.push('/supplier/audits')
}

// 加载仪表盘数据
const loadDashboardData = async () => {
  try {
    loading.value = true
    dashboardData.value = await supplierApi.getDashboardData()
  } catch (error) {
    console.error('Failed to load dashboard data:', error)
    ElMessage.error('加载仪表盘数据失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadDashboardData()
})
</script>

<style scoped lang="scss">
.supplier-dashboard {
  padding: 20px;

  .loading-container {
    padding: 40px;
  }

  .dashboard-content {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  // 绩效卡片样式
  .performance-card {
    .performance-status {
      display: flex;
      align-items: center;
      gap: 40px;
      padding: 20px 0;

      .grade-badge {
        width: 120px;
        height: 120px;
        border-radius: 50%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);

        .grade-letter {
          font-size: 48px;
          line-height: 1;
        }

        .grade-label {
          font-size: 14px;
          margin-top: 8px;
          opacity: 0.8;
        }

        &.grade-a {
          background: linear-gradient(135deg, #67c23a 0%, #85ce61 100%);
          color: white;
        }

        &.grade-b {
          background: linear-gradient(135deg, #409eff 0%, #66b1ff 100%);
          color: white;
        }

        &.grade-c {
          background: linear-gradient(135deg, #e6a23c 0%, #ebb563 100%);
          color: white;
        }

        &.grade-d {
          background: linear-gradient(135deg, #f56c6c 0%, #f78989 100%);
          color: white;
        }
      }

      .score-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 20px;

        .score-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 15px 20px;
          background: #f5f7fa;
          border-radius: 8px;

          .label {
            font-size: 16px;
            color: #606266;
          }

          .value {
            font-size: 32px;
            font-weight: bold;
            color: #303133;

            &.danger {
              color: #f56c6c;
            }
          }

          &.deduction {
            background: #fef0f0;
          }
        }
      }
    }
  }

  // 任务列表样式
  .action-required-card {
    .task-list {
      display: flex;
      flex-direction: column;
      gap: 16px;

      .task-item {
        .task-description {
          margin: 8px 0;
          color: #606266;
        }

        .task-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 12px;

          .deadline {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 14px;
            color: #909399;
          }
        }
      }
    }
  }

  // 响应式布局
  @media (max-width: 768px) {
    padding: 10px;

    .performance-card {
      .performance-status {
        flex-direction: column;
        gap: 20px;

        .grade-badge {
          width: 100px;
          height: 100px;

          .grade-letter {
            font-size: 40px;
          }
        }
      }
    }
  }
}
</style>
