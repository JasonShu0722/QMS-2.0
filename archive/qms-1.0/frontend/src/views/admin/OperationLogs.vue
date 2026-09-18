<template>
  <div class="operation-logs-container page-stage--stack">
    <section class="page-surface page-surface--table log-surface">

      <!-- 筛选条件 -->
      <el-form :inline="true" :model="queryForm" class="filter-toolbar">
        <el-form-item label="操作人">
          <el-select
            v-model="queryForm.user_id"
            placeholder="请选择"
            clearable
            filterable
            style="width: 200px"
          >
            <el-option
              v-for="user in availableUsers"
              :key="user.id"
              :label="`${user.full_name} (${user.username})`"
              :value="user.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="操作类型">
          <el-select
            v-model="queryForm.operation_type"
            placeholder="请选择"
            clearable
            style="width: 150px"
          >
            <el-option label="创建" value="create" />
            <el-option label="更新" value="update" />
            <el-option label="删除" value="delete" />
            <el-option label="登录" value="login" />
            <el-option label="登出" value="logout" />
            <el-option label="导出" value="export" />
            <el-option label="批准" value="approve" />
            <el-option label="拒绝" value="reject" />
          </el-select>
        </el-form-item>

        <el-form-item label="目标模块">
          <el-select
            v-model="queryForm.target_type"
            placeholder="请选择"
            clearable
            style="width: 150px"
          >
            <el-option label="用户" value="user" />
            <el-option label="权限" value="permission" />
            <el-option label="配置" value="config" />
            <el-option label="通知" value="notification" />
            <el-option label="公告" value="announcement" />
          </el-select>
        </el-form-item>

        <el-form-item label="时间范围">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            style="width: 300px"
          />
        </el-form-item>

        <el-form-item>
          <el-button @click="loadLogs" :icon="Refresh" circle />
          <el-button type="primary" @click="handleSearch">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button @click="handleExport" :loading="exporting">导出</el-button>
        </el-form-item>
      </el-form>

      <!-- 日志列表 -->
      <el-table
        :data="logs"
        stripe
        v-loading="loading"
        class="w-full"
      >
        <el-table-column prop="user_name" label="操作人" width="120" />
        <el-table-column label="操作类型" width="100">
          <template #default="{ row }">
            <el-tag :type="getOperationTypeTag(row.operation_type)">
              {{ getOperationTypeLabel(row.operation_type) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="target_type" label="目标模块" width="120">
          <template #default="{ row }">
            {{ getTargetTypeLabel(row.target_type) }}
          </template>
        </el-table-column>
        <el-table-column prop="target_id" label="目标ID" width="100" />
        <el-table-column prop="description" label="操作描述" min-width="200" show-overflow-tooltip />
        <el-table-column prop="ip_address" label="IP地址" width="140" />
        <el-table-column prop="created_at" label="操作时间" width="160">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button
              type="primary"
              size="small"
              @click="showLogDetail(row)"
            >
              详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="flex justify-end mt-4">
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
    </section>

    <!-- 日志详情对话框 -->
    <el-dialog
      v-model="detailDialogVisible"
      title="操作日志详情"
      width="800px"
      destroy-on-close
    >
      <el-descriptions v-if="currentLog" :column="2" border>
        <el-descriptions-item label="操作人">
          {{ currentLog.user_name }}
        </el-descriptions-item>
        <el-descriptions-item label="操作类型">
          <el-tag :type="getOperationTypeTag(currentLog.operation_type)">
            {{ getOperationTypeLabel(currentLog.operation_type) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="目标模块">
          {{ getTargetTypeLabel(currentLog.target_type) }}
        </el-descriptions-item>
        <el-descriptions-item label="目标ID">
          {{ currentLog.target_id || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="IP地址">
          {{ currentLog.ip_address }}
        </el-descriptions-item>
        <el-descriptions-item label="操作时间">
          {{ formatDate(currentLog.created_at) }}
        </el-descriptions-item>
        <el-descriptions-item label="操作描述" :span="2">
          {{ currentLog.description || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="User Agent" :span="2">
          <div class="text-xs break-all">{{ currentLog.user_agent }}</div>
        </el-descriptions-item>
      </el-descriptions>

      <!-- 数据变更对比 -->
      <div v-if="currentLog && (currentLog.before_snapshot || currentLog.after_snapshot)" class="mt-4">
        <h3 class="text-lg font-bold mb-2">数据变更对比</h3>
        <el-row :gutter="20">
          <el-col :span="12">
            <div class="diff-panel">
              <div class="diff-header bg-red-50 text-red-700">变更前</div>
              <pre class="diff-content">{{ formatSnapshot(currentLog.before_snapshot) }}</pre>
            </div>
          </el-col>
          <el-col :span="12">
            <div class="diff-panel">
              <div class="diff-header bg-green-50 text-green-700">变更后</div>
              <pre class="diff-content">{{ formatSnapshot(currentLog.after_snapshot) }}</pre>
            </div>
          </el-col>
        </el-row>
      </div>

      <template #footer>
        <el-button @click="detailDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { adminApi } from '@/api/admin'
import type { OperationLog, OperationLogQuery } from '@/types/admin'
import type { User } from '@/types/user'

// 状态
const loading = ref(false)
const exporting = ref(false)
const logs = ref<OperationLog[]>([])
const availableUsers = ref<User[]>([])
const dateRange = ref<[string, string] | null>(null)

// 查询表单
const queryForm = reactive<OperationLogQuery>({
  user_id: undefined,
  operation_type: undefined,
  target_type: undefined,
  start_date: undefined,
  end_date: undefined,
  page: 1,
  page_size: 20
})

// 分页
const pagination = reactive({
  page: 1,
  page_size: 20,
  total: 0
})

// 详情对话框
const detailDialogVisible = ref(false)
const currentLog = ref<OperationLog | null>(null)

/**
 * 加载日志列表
 */
async function loadLogs() {
  loading.value = true
  try {
    const response = await adminApi.getOperationLogs({
      ...queryForm,
      page: pagination.page,
      page_size: pagination.page_size
    })
    logs.value = response.logs
    pagination.total = response.total
  } catch (error: any) {
    ElMessage.error(error.message || '加载操作日志失败')
  } finally {
    loading.value = false
  }
}

/**
 * 处理查询
 */
function handleSearch() {
  if (dateRange.value) {
    queryForm.start_date = dateRange.value[0]
    queryForm.end_date = dateRange.value[1]
  } else {
    queryForm.start_date = undefined
    queryForm.end_date = undefined
  }
  pagination.page = 1
  loadLogs()
}

/**
 * 处理重置
 */
function handleReset() {
  queryForm.user_id = undefined
  queryForm.operation_type = undefined
  queryForm.target_type = undefined
  queryForm.start_date = undefined
  queryForm.end_date = undefined
  dateRange.value = null
  pagination.page = 1
  loadLogs()
}

/**
 * 处理导出
 */
async function handleExport() {
  exporting.value = true
  try {
    const blob = await adminApi.exportOperationLogs({
      ...queryForm,
      start_date: dateRange.value?.[0],
      end_date: dateRange.value?.[1]
    })
    
    // 创建下载链接
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `operation_logs_${new Date().getTime()}.xlsx`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    
    ElMessage.success('导出成功')
  } catch (error: any) {
    ElMessage.error(error.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

/**
 * 处理分页大小变更
 */
function handleSizeChange(size: number) {
  pagination.page_size = size
  pagination.page = 1
  loadLogs()
}

/**
 * 处理页码变更
 */
function handlePageChange(page: number) {
  pagination.page = page
  loadLogs()
}

/**
 * 显示日志详情
 */
async function showLogDetail(log: OperationLog) {
  try {
    currentLog.value = await adminApi.getOperationLogDetail(log.id)
    detailDialogVisible.value = true
  } catch (error: any) {
    ElMessage.error(error.message || '加载日志详情失败')
  }
}

/**
 * 获取操作类型标签
 */
function getOperationTypeTag(type: string): 'success' | 'info' | 'warning' | 'danger' | '' {
  const map: Record<string, 'success' | 'info' | 'warning' | 'danger' | ''> = {
    create: 'success',
    update: 'warning',
    delete: 'danger',
    login: 'info',
    logout: 'info',
    export: '',
    approve: 'success',
    reject: 'danger'
  }
  return map[type] || ''
}

/**
 * 获取操作类型标签文本
 */
function getOperationTypeLabel(type: string): string {
  const map: Record<string, string> = {
    create: '创建',
    update: '更新',
    delete: '删除',
    login: '登录',
    logout: '登出',
    export: '导出',
    approve: '批准',
    reject: '拒绝'
  }
  return map[type] || type
}

/**
 * 获取目标模块标签
 */
function getTargetTypeLabel(type: string): string {
  const map: Record<string, string> = {
    user: '用户',
    permission: '权限',
    config: '配置',
    notification: '通知',
    announcement: '公告',
    feature_flag: '功能开关'
  }
  return map[type] || type
}

/**
 * 格式化快照数据
 */
function formatSnapshot(snapshot: string | undefined): string {
  if (!snapshot) {
    return '无数据'
  }
  try {
    const data = JSON.parse(snapshot)
    return JSON.stringify(data, null, 2)
  } catch {
    return snapshot
  }
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
    minute: '2-digit',
    second: '2-digit'
  })
}

// 初始化
onMounted(() => {
  loadLogs()
  // TODO: 加载可用用户列表用于筛选
})
</script>

<style scoped>
.operation-logs-container {
  min-height: 100%;
}

.log-surface {
  overflow: hidden;
}

.filter-toolbar {
  padding: 12px 14px;
  margin-bottom: 14px;
  border-radius: 14px;
  background: #f8fafc;
  border: 1px solid rgba(226, 232, 240, 0.82);
}

.filter-toolbar :deep(.el-form-item:last-child .el-form-item__content) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.diff-panel {
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  overflow: hidden;
}

.diff-header {
  padding: 8px 12px;
  font-weight: bold;
  border-bottom: 1px solid #dcdfe6;
}

.diff-content {
  padding: 12px;
  margin: 0;
  max-height: 400px;
  overflow-y: auto;
  font-size: 12px;
  line-height: 1.5;
  background-color: #f5f7fa;
}
</style>
