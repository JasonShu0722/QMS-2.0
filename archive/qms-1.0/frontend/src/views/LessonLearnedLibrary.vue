<template>
  <div class="lesson-learned-library p-4 md:p-6">
    <div class="header mb-6">
      <h1 class="text-2xl font-bold mb-2">经验教训库</h1>
      <p class="text-gray-600">管理和查阅历史质量问题的经验教训，用于新品项目点检</p>
    </div>

    <!-- 搜索和筛选 -->
    <el-card class="mb-4">
      <el-form :inline="true" :model="searchForm" class="search-form">
        <el-form-item label="关键词">
          <el-input
            v-model="searchForm.keyword"
            placeholder="搜索标题或内容"
            clearable
            class="w-full md:w-64"
          />
        </el-form-item>
        <el-form-item label="来源模块">
          <el-select v-model="searchForm.source_module" placeholder="全部" clearable class="w-full md:w-48">
            <el-option label="供应商质量" value="supplier_quality" />
            <el-option label="过程质量" value="process_quality" />
            <el-option label="客户质量" value="customer_quality" />
            <el-option label="手工录入" value="manual" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="searchForm.is_active" placeholder="全部" clearable class="w-full md:w-32">
            <el-option label="启用" :value="true" />
            <el-option label="停用" :value="false" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">搜索</el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button type="success" @click="handleCreate">新增经验教训</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 经验教训列表 -->
    <el-card>
      <el-table :data="lessonList" v-loading="loading" stripe>
        <el-table-column prop="lesson_title" label="标题" min-width="200" show-overflow-tooltip />
        <el-table-column prop="source_module" label="来源模块" width="120">
          <template #default="{ row }">
            <el-tag :type="getSourceModuleType(row.source_module)">
              {{ getSourceModuleLabel(row.source_module) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="root_cause" label="根本原因" min-width="180" show-overflow-tooltip />
        <el-table-column prop="preventive_action" label="预防措施" min-width="180" show-overflow-tooltip />
        <el-table-column prop="is_active" label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.is_active ? 'success' : 'info'">
              {{ row.is_active ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="160">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleView(row)">查看</el-button>
            <el-button link type="primary" size="small" @click="handleEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
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

    <!-- 创建/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="800px"
      :close-on-click-modal="false"
    >
      <el-form :model="formData" :rules="formRules" ref="formRef" label-width="120px">
        <el-form-item label="标题" prop="lesson_title">
          <el-input v-model="formData.lesson_title" placeholder="请输入经验教训标题" />
        </el-form-item>
        <el-form-item label="来源模块" prop="source_module">
          <el-select v-model="formData.source_module" placeholder="请选择来源模块" class="w-full">
            <el-option label="供应商质量" value="supplier_quality" />
            <el-option label="过程质量" value="process_quality" />
            <el-option label="客户质量" value="customer_quality" />
            <el-option label="手工录入" value="manual" />
          </el-select>
        </el-form-item>
        <el-form-item label="详细内容" prop="lesson_content">
          <el-input
            v-model="formData.lesson_content"
            type="textarea"
            :rows="4"
            placeholder="请详细描述问题背景和发生过程"
          />
        </el-form-item>
        <el-form-item label="根本原因" prop="root_cause">
          <el-input
            v-model="formData.root_cause"
            type="textarea"
            :rows="3"
            placeholder="请描述问题的根本原因"
          />
        </el-form-item>
        <el-form-item label="预防措施" prop="preventive_action">
          <el-input
            v-model="formData.preventive_action"
            type="textarea"
            :rows="3"
            placeholder="请描述预防措施和改进建议"
          />
        </el-form-item>
        <el-form-item label="适用场景" prop="applicable_scenarios">
          <el-input
            v-model="formData.applicable_scenarios"
            type="textarea"
            :rows="2"
            placeholder="请描述该经验教训适用的场景（可选）"
          />
        </el-form-item>
        <el-form-item label="状态" prop="is_active">
          <el-switch v-model="formData.is_active" active-text="启用" inactive-text="停用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>

    <!-- 查看详情对话框 -->
    <el-dialog v-model="viewDialogVisible" title="经验教训详情" width="800px">
      <el-descriptions :column="1" border v-if="currentLesson">
        <el-descriptions-item label="标题">{{ currentLesson.lesson_title }}</el-descriptions-item>
        <el-descriptions-item label="来源模块">
          <el-tag :type="getSourceModuleType(currentLesson.source_module)">
            {{ getSourceModuleLabel(currentLesson.source_module) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="详细内容">
          <div class="whitespace-pre-wrap">{{ currentLesson.lesson_content }}</div>
        </el-descriptions-item>
        <el-descriptions-item label="根本原因">
          <div class="whitespace-pre-wrap">{{ currentLesson.root_cause }}</div>
        </el-descriptions-item>
        <el-descriptions-item label="预防措施">
          <div class="whitespace-pre-wrap">{{ currentLesson.preventive_action }}</div>
        </el-descriptions-item>
        <el-descriptions-item label="适用场景" v-if="currentLesson.applicable_scenarios">
          <div class="whitespace-pre-wrap">{{ currentLesson.applicable_scenarios }}</div>
        </el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="currentLesson.is_active ? 'success' : 'info'">
            {{ currentLesson.is_active ? '启用' : '停用' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatDate(currentLesson.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="更新时间">{{ formatDate(currentLesson.updated_at) }}</el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { newProductApi } from '@/api/new-product'
import type { LessonLearned, LessonLearnedCreate, SourceModuleType } from '@/types/new-product'

// 数据状态
const loading = ref(false)
const lessonList = ref<LessonLearned[]>([])
const pagination = reactive({
  page: 1,
  page_size: 20,
  total: 0
})

// 搜索表单
const searchForm = reactive({
  keyword: '',
  source_module: '',
  is_active: undefined as boolean | undefined
})

// 对话框状态
const dialogVisible = ref(false)
const viewDialogVisible = ref(false)
const dialogTitle = ref('')
const submitting = ref(false)
const currentLesson = ref<LessonLearned | null>(null)
const editingId = ref<number | null>(null)

// 表单数据
const formRef = ref<FormInstance>()
const formData = reactive<LessonLearnedCreate>({
  lesson_title: '',
  lesson_content: '',
  source_module: 'manual' as SourceModuleType,
  root_cause: '',
  preventive_action: '',
  applicable_scenarios: '',
  is_active: true
})

// 表单验证规则
const formRules: FormRules = {
  lesson_title: [
    { required: true, message: '请输入标题', trigger: 'blur' },
    { min: 5, max: 200, message: '标题长度在5-200字符之间', trigger: 'blur' }
  ],
  source_module: [
    { required: true, message: '请选择来源模块', trigger: 'change' }
  ],
  lesson_content: [
    { required: true, message: '请输入详细内容', trigger: 'blur' },
    { min: 10, message: '详细内容至少10字符', trigger: 'blur' }
  ],
  root_cause: [
    { required: true, message: '请输入根本原因', trigger: 'blur' },
    { min: 10, message: '根本原因至少10字符', trigger: 'blur' }
  ],
  preventive_action: [
    { required: true, message: '请输入预防措施', trigger: 'blur' },
    { min: 10, message: '预防措施至少10字符', trigger: 'blur' }
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
      source_module: searchForm.source_module || undefined,
      is_active: searchForm.is_active
    }
    const response = await newProductApi.getLessonLearnedList(params)
    lessonList.value = response.items
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
  searchForm.source_module = ''
  searchForm.is_active = undefined
  handleSearch()
}

// 创建
const handleCreate = () => {
  editingId.value = null
  dialogTitle.value = '新增经验教训'
  resetForm()
  dialogVisible.value = true
}

// 编辑
const handleEdit = (row: LessonLearned) => {
  editingId.value = row.id
  dialogTitle.value = '编辑经验教训'
  Object.assign(formData, {
    lesson_title: row.lesson_title,
    lesson_content: row.lesson_content,
    source_module: row.source_module,
    root_cause: row.root_cause,
    preventive_action: row.preventive_action,
    applicable_scenarios: row.applicable_scenarios,
    is_active: row.is_active
  })
  dialogVisible.value = true
}

// 查看
const handleView = (row: LessonLearned) => {
  currentLesson.value = row
  viewDialogVisible.value = true
}

// 删除
const handleDelete = async (row: LessonLearned) => {
  try {
    await ElMessageBox.confirm('确定要删除这条经验教训吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await newProductApi.deleteLessonLearned(row.id)
    ElMessage.success('删除成功')
    loadData()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败')
    }
  }
}

// 提交表单
const handleSubmit = async () => {
  if (!formRef.value) return
  
  try {
    await formRef.value.validate()
    submitting.value = true
    
    if (editingId.value) {
      await newProductApi.updateLessonLearned(editingId.value, formData)
      ElMessage.success('更新成功')
    } else {
      await newProductApi.createLessonLearned(formData)
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
    lesson_title: '',
    lesson_content: '',
    source_module: 'manual' as SourceModuleType,
    root_cause: '',
    preventive_action: '',
    applicable_scenarios: '',
    is_active: true
  })
  formRef.value?.clearValidate()
}

// 辅助函数
const getSourceModuleLabel = (module: string) => {
  const labels: Record<string, string> = {
    supplier_quality: '供应商质量',
    process_quality: '过程质量',
    customer_quality: '客户质量',
    manual: '手工录入'
  }
  return labels[module] || module
}

const getSourceModuleType = (module: string) => {
  const types: Record<string, any> = {
    supplier_quality: 'warning',
    process_quality: 'danger',
    customer_quality: 'success',
    manual: 'info'
  }
  return types[module] || 'info'
}

const formatDate = (dateStr: string) => {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}

// 初始化
onMounted(() => {
  loadData()
})
</script>

<style scoped>
.lesson-learned-library {
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
