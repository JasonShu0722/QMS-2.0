<template>
  <div class="trial-production p-4 md:p-6">
    <div class="header mb-6">
      <h1 class="text-2xl font-bold mb-2">试产管理</h1>
      <p class="text-gray-600">管理试产记录、目标设定和实绩跟踪</p>
    </div>

    <!-- 搜索和筛选 -->
    <el-card class="mb-4">
      <el-form :inline="true" :model="searchForm" class="search-form">
        <el-form-item label="工单号">
          <el-input v-model="searchForm.work_order" placeholder="搜索工单号" clearable class="w-full md:w-48" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="searchForm.status" placeholder="全部" clearable class="w-full md:w-32">
            <el-option label="计划中" value="planned" />
            <el-option label="进行中" value="in_progress" />
            <el-option label="已完成" value="completed" />
            <el-option label="已取消" value="cancelled" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">搜索</el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button type="success" @click="handleCreate">创建试产记录</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 试产记录列表 -->
    <el-card>
      <el-table :data="trialList" v-loading="loading" stripe>
        <el-table-column prop="work_order" label="工单号" width="140" />
        <el-table-column prop="trial_batch" label="批次号" width="120" />
        <el-table-column prop="trial_date" label="试产日期" width="120">
          <template #default="{ row }">
            {{ formatDate(row.trial_date, 'date') }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)">
              {{ getStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="ims_sync_status" label="IMS同步" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.ims_sync_status" :type="getSyncStatusType(row.ims_sync_status)" size="small">
              {{ getSyncStatusLabel(row.ims_sync_status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="达成情况" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.actual_metrics" :type="getAchievementType(row)">
              {{ getAchievementLabel(row) }}
            </el-tag>
            <span v-else class="text-gray-400">-</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="350" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleViewSummary(row)">总结报告</el-button>
            <el-button link type="primary" size="small" @click="handleSyncIMS(row)">同步IMS</el-button>
            <el-button link type="success" size="small" @click="handleInputMetrics(row)">补录实绩</el-button>
            <el-button link type="warning" size="small" @click="handleViewIssues(row)">问题清单</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination mt-4 flex justify-end">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.page_size"
          :page-sizes="[10, 20, 50, 100]"
          :total="pagination.total"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSearch"
          @current-change="handleSearch"
        />
      </div>
    </el-card>

    <!-- 创建试产记录对话框 -->
    <el-dialog v-model="dialogVisible" title="创建试产记录" width="600px" :close-on-click-modal="false">
      <el-form :model="formData" :rules="formRules" ref="formRef" label-width="120px">
        <el-form-item label="项目" prop="project_id">
          <el-select v-model="formData.project_id" placeholder="选择项目" class="w-full" filterable>
            <el-option
              v-for="project in projectOptions"
              :key="project.id"
              :label="`${project.project_code} - ${project.project_name}`"
              :value="project.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="IMS工单号" prop="work_order">
          <el-input v-model="formData.work_order" placeholder="请输入IMS工单号" />
        </el-form-item>
        <el-form-item label="试产批次号" prop="trial_batch">
          <el-input v-model="formData.trial_batch" placeholder="请输入试产批次号" />
        </el-form-item>
        <el-form-item label="试产日期" prop="trial_date">
          <el-date-picker v-model="formData.trial_date" type="date" placeholder="选择试产日期" class="w-full" />
        </el-form-item>
        <el-form-item label="目标直通率(%)" prop="target_pass_rate">
          <el-input-number v-model="formData.target_pass_rate" :min="0" :max="100" :precision="1" class="w-full" />
        </el-form-item>
        <el-form-item label="目标CPK" prop="target_cpk">
          <el-input-number v-model="formData.target_cpk" :min="0" :max="5" :precision="2" :step="0.1" class="w-full" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>

    <!-- 手动补录实绩对话框 -->
    <el-dialog v-model="metricsDialogVisible" title="手动补录实绩数据" width="600px">
      <el-form :model="metricsForm" ref="metricsFormRef" label-width="140px">
        <el-form-item label="CPK测算值">
          <el-input-number v-model="metricsForm.cpk" :min="0" :max="5" :precision="2" :step="0.1" class="w-full" />
        </el-form-item>
        <el-form-item label="破坏性实验结果">
          <el-input v-model="metricsForm.destructive_test_result" placeholder="如：合格" />
        </el-form-item>
        <el-form-item label="外观评审得分">
          <el-input-number v-model="metricsForm.appearance_score" :min="0" :max="100" :precision="1" class="w-full" />
        </el-form-item>
        <el-form-item label="尺寸合格率(%)">
          <el-input-number v-model="metricsForm.dimension_pass_rate" :min="0" :max="100" :precision="1" class="w-full" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="metricsDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmitMetrics" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { newProductApi } from '@/api/new-product'
import type { TrialProduction, TrialProductionCreate, ManualMetricsInput, NewProductProject } from '@/types/new-product'

const router = useRouter()

// 数据状态
const loading = ref(false)
const submitting = ref(false)
const trialList = ref<TrialProduction[]>([])
const projectOptions = ref<NewProductProject[]>([])
const pagination = reactive({ page: 1, page_size: 20, total: 0 })

// 搜索表单
const searchForm = reactive({ work_order: '', status: '' })

// 对话框状态
const dialogVisible = ref(false)
const metricsDialogVisible = ref(false)
const currentTrial = ref<TrialProduction | null>(null)

// 表单
const formRef = ref<FormInstance>()
const formData = reactive<TrialProductionCreate & { target_pass_rate?: number; target_cpk?: number }>({
  project_id: 0,
  work_order: '',
  trial_batch: '',
  trial_date: '',
  target_pass_rate: 95,
  target_cpk: 1.33
})
const metricsForm = reactive<ManualMetricsInput>({
  cpk: undefined,
  destructive_test_result: '',
  appearance_score: undefined,
  dimension_pass_rate: undefined
})

const formRules: FormRules = {
  project_id: [{ required: true, message: '请选择项目', trigger: 'change' }],
  work_order: [{ required: true, message: '请输入工单号', trigger: 'blur' }]
}

// 加载数据
const loadData = async () => {
  loading.value = true
  try {
    const params = {
      page: pagination.page,
      page_size: pagination.page_size,
      work_order: searchForm.work_order || undefined,
      status: searchForm.status || undefined
    }
    const response = await newProductApi.getTrialProductionList(params)
    trialList.value = response.items
    pagination.total = response.total
  } catch (error: any) {
    ElMessage.error(error.message || '加载数据失败')
  } finally {
    loading.value = false
  }
}

// 加载项目选项
const loadProjects = async () => {
  try {
    const response = await newProductApi.getProjectList({ page: 1, page_size: 100 })
    projectOptions.value = response.items
  } catch (error: any) {
    ElMessage.error(error.message || '加载项目列表失败')
  }
}

// 搜索
const handleSearch = () => {
  pagination.page = 1
  loadData()
}

// 重置
const handleReset = () => {
  searchForm.work_order = ''
  searchForm.status = ''
  handleSearch()
}

// 创建
const handleCreate = () => {
  Object.assign(formData, {
    project_id: 0,
    work_order: '',
    trial_batch: '',
    trial_date: '',
    target_pass_rate: 95,
    target_cpk: 1.33
  })
  dialogVisible.value = true
}

// 提交表单
const handleSubmit = async () => {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
    submitting.value = true
    
    const submitData: TrialProductionCreate = {
      project_id: formData.project_id,
      work_order: formData.work_order,
      trial_batch: formData.trial_batch,
      trial_date: formData.trial_date ? new Date(formData.trial_date).toISOString().split('T')[0] : undefined,
      target_metrics: {
        pass_rate: { target: formData.target_pass_rate, unit: '%' },
        cpk: { target: formData.target_cpk, unit: '' }
      }
    }
    
    await newProductApi.createTrialProduction(submitData)
    ElMessage.success('创建成功')
    dialogVisible.value = false
    loadData()
  } catch (error: any) {
    if (error !== false) {
      ElMessage.error(error.message || '操作失败')
    }
  } finally {
    submitting.value = false
  }
}

// 同步IMS数据
const handleSyncIMS = async (row: TrialProduction) => {
  try {
    const result = await newProductApi.syncIMSData(row.id, false)
    if (result.success) {
      ElMessage.success(result.message)
      loadData()
    } else {
      ElMessage.error(result.message)
    }
  } catch (error: any) {
    ElMessage.error(error.message || '同步失败')
  }
}

// 补录实绩
const handleInputMetrics = (row: TrialProduction) => {
  currentTrial.value = row
  Object.assign(metricsForm, {
    cpk: undefined,
    destructive_test_result: '',
    appearance_score: undefined,
    dimension_pass_rate: undefined
  })
  metricsDialogVisible.value = true
}

// 提交补录
const handleSubmitMetrics = async () => {
  if (!currentTrial.value) return
  submitting.value = true
  try {
    await newProductApi.inputManualMetrics(currentTrial.value.id, metricsForm)
    ElMessage.success('补录成功')
    metricsDialogVisible.value = false
    loadData()
  } catch (error: any) {
    ElMessage.error(error.message || '操作失败')
  } finally {
    submitting.value = false
  }
}

// 查看总结报告
const handleViewSummary = (row: TrialProduction) => {
  router.push({ name: 'TrialProductionSummary', params: { trialId: row.id } })
}

// 查看问题清单
const handleViewIssues = (row: TrialProduction) => {
  router.push({ name: 'TrialIssueList', query: { trial_id: row.id } })
}

// 辅助函数
const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    planned: '计划中', in_progress: '进行中', completed: '已完成', cancelled: '已取消'
  }
  return labels[status] || status
}

const getStatusType = (status: string) => {
  const types: Record<string, any> = {
    planned: 'info', in_progress: 'warning', completed: 'success', cancelled: 'danger'
  }
  return types[status] || ''
}

const getSyncStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    pending: '待同步', synced: '已同步', failed: '失败'
  }
  return labels[status] || status
}

const getSyncStatusType = (status: string) => {
  const types: Record<string, any> = {
    pending: 'info', synced: 'success', failed: 'danger'
  }
  return types[status] || ''
}

const getAchievementLabel = (row: TrialProduction) => {
  if (!row.actual_metrics) return '-'
  // 简单判断：如果有actual_metrics就认为有达成情况
  return '查看详情'
}

const getAchievementType = (_row: TrialProduction) => {
  return 'primary'
}

const formatDate = (dateStr: string, type: 'date' | 'datetime' = 'datetime') => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return type === 'date' ? date.toLocaleDateString('zh-CN') : date.toLocaleString('zh-CN')
}

// 初始化
onMounted(() => {
  loadData()
  loadProjects()
})
</script>

<style scoped>
.trial-production {
  min-height: 100vh;
  background-color: #f5f7fa;
}

.search-form :deep(.el-form-item) {
  margin-bottom: 0;
}

@media (max-width: 768px) {
  .search-form {
    display: block;
  }
  
  .search-form :deep(.el-form-item) {
    display: block;
    margin-bottom: 12px;
  }
}
</style>
