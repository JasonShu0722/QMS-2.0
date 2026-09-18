<template>
  <div class="task-monitor-container p-4 md:p-6">
    <!-- 统计卡片 -->
    <el-row :gutter="20" class="mb-6">
      <el-col :xs="12" :sm="6">
        <el-card shadow="hover">
          <div class="stat-card">
            <div class="stat-value text-blue-600">{{ statistics.total_tasks }}</div>
            <div class="stat-label">总待办任务</div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card shadow="hover">
          <div class="stat-card">
            <div class="stat-value text-red-600">{{ statistics.overdue_tasks }}</div>
            <div class="stat-label">已逾期</div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card shadow="hover">
          <div class="stat-card">
            <div class="stat-value text-yellow-600">{{ statistics.urgent_tasks }}</div>
            <div class="stat-label">即将逾期</div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card shadow="hover">
          <div class="stat-card">
            <div class="stat-value text-green-600">{{ statistics.normal_tasks }}</div>
            <div class="stat-label">正常</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 待办分布图 -->
    <el-row :gutter="20" class="mb-6">
      <el-col :xs="24" :md="12">
        <el-card>
          <template #header>
            <span class="section-caption">按部门统计</span>
          </template>
          <div ref="departmentChartRef" style="height: 300px"></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="12">
        <el-card>
          <template #header>
            <span class="section-caption">按人员统计（Top 10）</span>
          </template>
          <div ref="userChartRef" style="height: 300px"></div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 任务列表 -->
    <el-card>
      <template #header>
        <div class="flex justify-between items-center flex-wrap gap-2">
          <span class="section-caption section-caption--strong">任务清单</span>
          <div class="flex gap-2 flex-wrap">
            <el-select
              v-model="filters.urgency"
              placeholder="紧急程度"
              clearable
              style="width: 120px"
              @change="loadTasks"
            >
              <el-option label="已逾期" value="overdue" />
              <el-option label="即将逾期" value="urgent" />
              <el-option label="正常" value="normal" />
            </el-select>
            <el-button
              type="primary"
              @click="showReassignDialog"
              :disabled="selectedTasks.length === 0"
            >
              批量转派 ({{ selectedTasks.length }})
            </el-button>
            <el-button @click="loadData" :icon="Refresh" circle />
          </div>
        </div>
      </template>

      <!-- 任务表格 -->
      <el-table
        :data="tasks"
        stripe
        @selection-change="handleSelectionChange"
        v-loading="loading"
      >
        <el-table-column type="selection" width="55" />
        <el-table-column prop="task_type" label="任务类型" width="150" />
        <el-table-column prop="task_id" label="单据编号" width="120" />
        <el-table-column prop="handler_name" label="当前处理人" width="120" />
        <el-table-column label="紧急程度" width="120">
          <template #default="{ row }">
            <el-tag :type="getUrgencyType(row.urgency)">
              {{ getUrgencyLabel(row.urgency) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="剩余时间" width="150">
          <template #default="{ row }">
            <span :class="getTimeClass(row.urgency)">
              {{ formatRemainingTime(row.remaining_hours) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="deadline" label="截止时间" width="160">
          <template #default="{ row }">
            {{ formatDate(row.deadline) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="goToTask(row.link)">
              查看
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 批量转派对话框 -->
    <el-dialog v-model="reassignDialogVisible" title="批量转派任务" width="500px">
      <el-form :model="reassignForm" label-width="100px">
        <el-form-item label="任务数量">
          <span>{{ selectedTasks.length }} 个任务</span>
        </el-form-item>
        <el-form-item label="转派给" required>
          <el-select
            v-model="reassignForm.to_user_id"
            placeholder="请选择目标用户"
            filterable
            style="width: 100%"
          >
            <el-option
              v-for="user in availableUsers"
              :key="user.id"
              :label="`${user.full_name} (${user.username})`"
              :value="user.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reassignDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          @click="confirmReassign"
          :loading="reassigning"
          :disabled="!reassignForm.to_user_id"
        >
          确认转派
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import * as echarts from 'echarts'
import { adminApi } from '@/api/admin'
import type { TodoTask, TaskStatistics } from '@/types/admin'
import type { User } from '@/types/user'

const router = useRouter()

// 状态
const loading = ref(false)
const reassigning = ref(false)
const statistics = ref<TaskStatistics>({
  total_tasks: 0,
  overdue_tasks: 0,
  urgent_tasks: 0,
  normal_tasks: 0,
  by_department: {},
  by_user: {}
})
const tasks = ref<TodoTask[]>([])
const selectedTasks = ref<TodoTask[]>([])
const filters = reactive({
  urgency: ''
})

// 转派相关
const reassignDialogVisible = ref(false)
const reassignForm = reactive({
  to_user_id: null as number | null
})
const availableUsers = ref<User[]>([])

// 图表引用
const departmentChartRef = ref<HTMLElement>()
const userChartRef = ref<HTMLElement>()
let departmentChart: echarts.ECharts | null = null
let userChart: echarts.ECharts | null = null

/**
 * 加载所有数据
 */
async function loadData() {
  await Promise.all([loadStatistics(), loadTasks()])
}

/**
 * 加载统计数据
 */
async function loadStatistics() {
  try {
    statistics.value = await adminApi.getTaskStatistics()
    await nextTick()
    renderCharts()
  } catch (error: any) {
    ElMessage.error(error.message || '加载统计数据失败')
  }
}

/**
 * 加载任务列表
 */
async function loadTasks() {
  loading.value = true
  try {
    const filterParams: any = {}
    if (filters.urgency) {
      filterParams.urgency = filters.urgency
    }
    tasks.value = await adminApi.getAllTasks(filterParams)
  } catch (error: any) {
    ElMessage.error(error.message || '加载任务列表失败')
  } finally {
    loading.value = false
  }
}

/**
 * 渲染图表
 */
function renderCharts() {
  if (departmentChartRef.value) {
    if (!departmentChart) {
      departmentChart = echarts.init(departmentChartRef.value)
    }
    departmentChart.setOption({
      tooltip: { trigger: 'item' },
      series: [
        {
          type: 'pie',
          radius: '60%',
          data: Object.entries(statistics.value.by_department).map(([name, value]) => ({
            name,
            value
          })),
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: 'rgba(0, 0, 0, 0.5)'
            }
          }
        }
      ]
    })
  }

  if (userChartRef.value) {
    if (!userChart) {
      userChart = echarts.init(userChartRef.value)
    }
    const userData = Object.entries(statistics.value.by_user)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
    
    userChart.setOption({
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'category', data: userData.map(([name]) => name) },
      yAxis: { type: 'value' },
      series: [
        {
          type: 'bar',
          data: userData.map(([, value]) => value),
          itemStyle: { color: '#409EFF' }
        }
      ]
    })
  }
}

/**
 * 处理选择变更
 */
function handleSelectionChange(selection: TodoTask[]) {
  selectedTasks.value = selection
}

/**
 * 显示转派对话框
 */
function showReassignDialog() {
  if (selectedTasks.value.length === 0) {
    ElMessage.warning('请先选择要转派的任务')
    return
  }
  reassignForm.to_user_id = null
  reassignDialogVisible.value = true
  // TODO: 加载可用用户列表
}

/**
 * 确认转派
 */
async function confirmReassign() {
  if (!reassignForm.to_user_id) {
    ElMessage.warning('请选择目标用户')
    return
  }

  reassigning.value = true
  try {
    await adminApi.reassignTasks({
      from_user_id: selectedTasks.value[0].handler_id,
      to_user_id: reassignForm.to_user_id,
      task_ids: selectedTasks.value.map(t => t.id)
    })
    ElMessage.success('任务转派成功')
    reassignDialogVisible.value = false
    selectedTasks.value = []
    await loadData()
  } catch (error: any) {
    ElMessage.error(error.message || '任务转派失败')
  } finally {
    reassigning.value = false
  }
}

/**
 * 跳转到任务详情
 */
function goToTask(link: string) {
  router.push(link)
}

/**
 * 获取紧急程度类型
 */
function getUrgencyType(urgency: string): 'danger' | 'warning' | 'success' {
  const map: Record<string, 'danger' | 'warning' | 'success'> = {
    overdue: 'danger',
    urgent: 'warning',
    normal: 'success'
  }
  return map[urgency] || 'success'
}

/**
 * 获取紧急程度标签
 */
function getUrgencyLabel(urgency: string): string {
  const map: Record<string, string> = {
    overdue: '已逾期',
    urgent: '即将逾期',
    normal: '正常'
  }
  return map[urgency] || '未知'
}

/**
 * 获取时间样式类
 */
function getTimeClass(urgency: string): string {
  const map: Record<string, string> = {
    overdue: 'text-red-600 font-bold',
    urgent: 'text-yellow-600 font-medium',
    normal: 'text-green-600'
  }
  return map[urgency] || ''
}

/**
 * 格式化剩余时间
 */
function formatRemainingTime(hours: number): string {
  if (hours < 0) {
    return `已逾期 ${Math.abs(Math.floor(hours))} 小时`
  }
  if (hours < 24) {
    return `剩余 ${Math.floor(hours)} 小时`
  }
  const days = Math.floor(hours / 24)
  return `剩余 ${days} 天`
}

/**
 * 格式化日期
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 初始化
onMounted(() => {
  loadData()
})
</script>

<style scoped>
.task-monitor-container {
  min-height: 100vh;
  background-color: #f5f7fa;
}

.stat-card {
  text-align: center;
}

.stat-value {
  font-size: 32px;
  font-weight: bold;
  margin-bottom: 8px;
}

.stat-label {
  font-size: 14px;
  color: #909399;
}

.section-caption {
  color: #1f2a37;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
}

.section-caption--strong {
  font-size: 15px;
}
</style>
