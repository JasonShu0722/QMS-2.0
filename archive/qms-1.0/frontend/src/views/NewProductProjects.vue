<template>
  <div class="new-product-projects p-4 md:p-6">
    <div class="header mb-6">
      <h1 class="text-2xl font-bold mb-2">新品项目列表</h1>
      <p class="text-gray-600">管理新品开发项目的质量管控流程</p>
    </div>

    <!-- 搜索和筛选 -->
    <el-card class="mb-4">
      <el-form :inline="true" :model="searchForm" class="search-form">
        <el-form-item label="项目代码/名称">
          <el-input
            v-model="searchForm.keyword"
            placeholder="搜索项目代码或名称"
            clearable
            class="w-full md:w-64"
          />
        </el-form-item>
        <el-form-item label="当前阶段">
          <el-select v-model="searchForm.current_stage" placeholder="全部" clearable class="w-full md:w-48">
            <el-option label="概念阶段" value="concept" />
            <el-option label="设计阶段" value="design" />
            <el-option label="开发阶段" value="development" />
            <el-option label="验证阶段" value="validation" />
            <el-option label="试产阶段" value="trial_production" />
            <el-option label="SOP" value="sop" />
            <el-option label="已关闭" value="closed" />
          </el-select>
        </el-form-item>
        <el-form-item label="项目状态">
          <el-select v-model="searchForm.status" placeholder="全部" clearable class="w-full md:w-32">
            <el-option label="进行中" value="active" />
            <el-option label="暂停" value="on_hold" />
            <el-option label="已完成" value="completed" />
            <el-option label="已取消" value="cancelled" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">搜索</el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button type="success" @click="handleCreate">创建项目</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 项目列表 -->
    <el-card>
      <el-table :data="projectList" v-loading="loading" stripe>
        <el-table-column prop="project_code" label="项目代码" width="140" fixed="left" />
        <el-table-column prop="project_name" label="项目名称" min-width="200" show-overflow-tooltip />
        <el-table-column prop="product_type" label="产品类型" width="120" />
        <el-table-column prop="project_manager" label="项目经理" width="100" />
        <el-table-column prop="current_stage" label="当前阶段" width="120">
          <template #default="{ row }">
            <el-tag :type="getStageType(row.current_stage)">
              {{ getStageLabel(row.current_stage) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)">
              {{ getStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="planned_sop_date" label="计划SOP" width="120">
          <template #default="{ row }">
            {{ formatDate(row.planned_sop_date, 'date') }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleViewDetail(row)">详情</el-button>
            <el-button link type="primary" size="small" @click="handleLessonCheck(row)">经验点检</el-button>
            <el-button link type="primary" size="small" @click="handleStageReview(row)">阶段评审</el-button>
            <el-button link type="success" size="small" @click="handleTrialProduction(row)">试产管理</el-button>
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

    <!-- 创建/编辑项目对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="600px"
      :close-on-click-modal="false"
    >
      <el-form :model="formData" :rules="formRules" ref="formRef" label-width="120px">
        <el-form-item label="项目代码" prop="project_code">
          <el-input v-model="formData.project_code" placeholder="请输入项目代码" :disabled="!!editingId" />
        </el-form-item>
        <el-form-item label="项目名称" prop="project_name">
          <el-input v-model="formData.project_name" placeholder="请输入项目名称" />
        </el-form-item>
        <el-form-item label="产品类型" prop="product_type">
          <el-input v-model="formData.product_type" placeholder="请输入产品类型" />
        </el-form-item>
        <el-form-item label="项目经理" prop="project_manager">
          <el-input v-model="formData.project_manager" placeholder="请输入项目经理姓名" />
        </el-form-item>
        <el-form-item label="计划SOP日期" prop="planned_sop_date">
          <el-date-picker
            v-model="formData.planned_sop_date"
            type="date"
            placeholder="选择计划SOP日期"
            class="w-full"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { newProductApi } from '@/api/new-product'
import type { NewProductProject, NewProductProjectCreate } from '@/types/new-product'

const router = useRouter()

// 数据状态
const loading = ref(false)
const projectList = ref<NewProductProject[]>([])
const pagination = reactive({
  page: 1,
  page_size: 20,
  total: 0
})

// 搜索表单
const searchForm = reactive({
  keyword: '',
  current_stage: '',
  status: ''
})

// 对话框状态
const dialogVisible = ref(false)
const dialogTitle = ref('')
const submitting = ref(false)
const editingId = ref<number | null>(null)

// 表单数据
const formRef = ref<FormInstance>()
const formData = reactive<NewProductProjectCreate>({
  project_code: '',
  project_name: '',
  product_type: '',
  project_manager: '',
  planned_sop_date: ''
})

// 表单验证规则
const formRules: FormRules = {
  project_code: [
    { required: true, message: '请输入项目代码', trigger: 'blur' }
  ],
  project_name: [
    { required: true, message: '请输入项目名称', trigger: 'blur' }
  ]
}

// 加载数据
const loadData = async () => {
  loading.value = true
  try {
    const params = {
      page: pagination.page,
      page_size: pagination.page_size,
      keyword: searchForm.keyword || undefined,
      current_stage: searchForm.current_stage || undefined,
      status: searchForm.status || undefined
    }
    const response = await newProductApi.getProjectList(params)
    projectList.value = response.items
    pagination.total = response.total
  } catch (error: any) {
    ElMessage.error(error.message || '加载数据失败')
  } finally {
    loading.value = false
  }
}

// 搜索
const handleSearch = () => {
  pagination.page = 1
  loadData()
}

// 重置
const handleReset = () => {
  searchForm.keyword = ''
  searchForm.current_stage = ''
  searchForm.status = ''
  handleSearch()
}

// 创建
const handleCreate = () => {
  editingId.value = null
  dialogTitle.value = '创建新品项目'
  resetForm()
  dialogVisible.value = true
}

// 提交表单
const handleSubmit = async () => {
  if (!formRef.value) return
  
  try {
    await formRef.value.validate()
    submitting.value = true
    
    const submitData = {
      ...formData,
      planned_sop_date: formData.planned_sop_date ? new Date(formData.planned_sop_date).toISOString() : undefined
    }
    
    if (editingId.value) {
      await newProductApi.updateProject(editingId.value, submitData)
      ElMessage.success('更新成功')
    } else {
      await newProductApi.createProject(submitData)
      ElMessage.success('创建成功')
    }
    
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

// 重置表单
const resetForm = () => {
  Object.assign(formData, {
    project_code: '',
    project_name: '',
    product_type: '',
    project_manager: '',
    planned_sop_date: ''
  })
  formRef.value?.clearValidate()
}

// 查看详情
const handleViewDetail = (_row: NewProductProject) => {
  // 跳转到项目详情页（待实现）
  ElMessage.info('项目详情页面开发中')
}

// 经验教训点检
const handleLessonCheck = (row: NewProductProject) => {
  router.push({ name: 'ProjectLessonCheck', params: { projectId: row.id } })
}

// 阶段评审
const handleStageReview = (row: NewProductProject) => {
  router.push({ name: 'StageReview', params: { projectId: row.id } })
}

// 试产管理
const handleTrialProduction = (row: NewProductProject) => {
  router.push({ name: 'TrialProduction', params: { projectId: row.id } })
}

// 辅助函数
const getStageLabel = (stage: string) => {
  const labels: Record<string, string> = {
    concept: '概念',
    design: '设计',
    development: '开发',
    validation: '验证',
    trial_production: '试产',
    sop: 'SOP',
    closed: '已关闭'
  }
  return labels[stage] || stage
}

const getStageType = (stage: string) => {
  const types: Record<string, any> = {
    concept: 'info',
    design: '',
    development: 'warning',
    validation: 'warning',
    trial_production: 'success',
    sop: 'success',
    closed: 'info'
  }
  return types[stage] || ''
}

const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    active: '进行中',
    on_hold: '暂停',
    completed: '已完成',
    cancelled: '已取消'
  }
  return labels[status] || status
}

const getStatusType = (status: string) => {
  const types: Record<string, any> = {
    active: 'success',
    on_hold: 'warning',
    completed: 'info',
    cancelled: 'danger'
  }
  return types[status] || ''
}

const formatDate = (dateStr: string, type: 'date' | 'datetime' = 'datetime') => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  if (type === 'date') {
    return date.toLocaleDateString('zh-CN')
  }
  return date.toLocaleString('zh-CN')
}

// 初始化
onMounted(() => {
  loadData()
})
</script>

<style scoped>
.new-product-projects {
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
