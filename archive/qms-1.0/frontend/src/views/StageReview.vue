<template>
  <div class="stage-review p-4 md:p-6">
    <div class="header mb-6">
      <el-page-header @back="handleBack" class="mb-4">
        <template #content>
          <h1 class="text-2xl font-bold">阶段评审管理</h1>
        </template>
      </el-page-header>
      <p class="text-gray-600">管理项目各阶段的评审节点和交付物</p>
    </div>

    <!-- 项目信息 -->
    <el-card class="mb-4" v-if="projectInfo">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="项目代码">{{ projectInfo.project_code }}</el-descriptions-item>
        <el-descriptions-item label="项目名称">{{ projectInfo.project_name }}</el-descriptions-item>
        <el-descriptions-item label="当前阶段">
          <el-tag :type="getStageType(projectInfo.current_stage)">
            {{ getStageLabel(projectInfo.current_stage) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="项目状态">
          <el-tag :type="getStatusType(projectInfo.status)">
            {{ getStatusLabel(projectInfo.status) }}
          </el-tag>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <!-- 操作按钮 -->
    <el-card class="mb-4">
      <el-button type="primary" @click="handleCreateReview">新增阶段评审</el-button>
    </el-card>

    <!-- 阶段评审列表 -->
    <el-card v-loading="loading">
      <el-timeline>
        <el-timeline-item
          v-for="review in stageReviews"
          :key="review.id"
          :timestamp="formatDate((review.review_date || review.planned_review_date) ?? '')"
          placement="top"
        >
          <el-card>
            <template #header>
              <div class="flex justify-between items-center">
                <span class="font-bold">{{ review.stage_name }}</span>
                <el-tag :type="getReviewResultType(review.review_result)">
                  {{ getReviewResultLabel(review.review_result) }}
                </el-tag>
              </div>
            </template>
            
            <!-- 交付物清单 -->
            <div class="mb-4" v-if="review.deliverables && review.deliverables.length">
              <h4 class="font-semibold mb-2">交付物清单:</h4>
              <el-table :data="review.deliverables" size="small" border>
                <el-table-column prop="name" label="交付物名称" />
                <el-table-column prop="required" label="是否必需" width="100">
                  <template #default="{ row }">
                    <el-tag :type="row.required ? 'danger' : 'info'" size="small">
                      {{ row.required ? '必需' : '可选' }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="status" label="状态" width="100">
                  <template #default="{ row }">
                    <el-tag :type="getDeliverableStatusType(row.status)" size="small">
                      {{ getDeliverableStatusLabel(row.status) }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="150">
                  <template #default="{ row }">
                    <el-button
                      v-if="row.status === 'missing'"
                      link
                      type="primary"
                      size="small"
                      @click="handleUploadDeliverable(review, row)"
                    >
                      上传
                    </el-button>
                    <el-button
                      v-if="row.file_path"
                      link
                      type="success"
                      size="small"
                      @click="handleDownload(row.file_path)"
                    >
                      下载
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>

            <!-- 评审意见 -->
            <div v-if="review.review_comments" class="mb-2">
              <span class="font-semibold">评审意见:</span>
              <p class="text-gray-700 mt-1">{{ review.review_comments }}</p>
            </div>

            <!-- 有条件通过的整改要求 -->
            <div v-if="review.conditional_requirements" class="mb-2">
              <span class="font-semibold text-orange-600">整改要求:</span>
              <p class="text-gray-700 mt-1">{{ review.conditional_requirements }}</p>
              <p class="text-sm text-gray-500">截止日期: {{ formatDate(review.conditional_deadline ?? '', 'date') }}</p>
            </div>

            <!-- 操作按钮 -->
            <div class="mt-4">
              <el-button
                v-if="review.review_result === 'pending'"
                type="primary"
                size="small"
                @click="handleApproveReview(review)"
              >
                批准评审
              </el-button>
              <el-button size="small" @click="handleEditReview(review)">编辑</el-button>
            </div>
          </el-card>
        </el-timeline-item>
      </el-timeline>
    </el-card>

    <!-- 创建/编辑评审对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="700px"
      :close-on-click-modal="false"
    >
      <el-form :model="formData" :rules="formRules" ref="formRef" label-width="120px">
        <el-form-item label="阶段名称" prop="stage_name">
          <el-input v-model="formData.stage_name" placeholder="如：设计评审、验证评审" />
        </el-form-item>
        <el-form-item label="计划评审日期" prop="planned_review_date">
          <el-date-picker
            v-model="formData.planned_review_date"
            type="date"
            placeholder="选择计划评审日期"
            class="w-full"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>

    <!-- 批准评审对话框 -->
    <el-dialog v-model="approvalDialogVisible" title="批准阶段评审" width="600px">
      <el-form :model="approvalForm" label-width="120px">
        <el-form-item label="评审结果" prop="review_result">
          <el-radio-group v-model="approvalForm.review_result">
            <el-radio label="passed">通过</el-radio>
            <el-radio label="conditional_pass">有条件通过</el-radio>
            <el-radio label="failed">不通过</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="评审意见" prop="review_comments">
          <el-input v-model="approvalForm.review_comments" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item
          v-if="approvalForm.review_result === 'conditional_pass'"
          label="整改要求"
          prop="conditional_requirements"
        >
          <el-input v-model="approvalForm.conditional_requirements" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item
          v-if="approvalForm.review_result === 'conditional_pass'"
          label="整改截止日期"
          prop="conditional_deadline"
        >
          <el-date-picker
            v-model="approvalForm.conditional_deadline"
            type="date"
            placeholder="选择整改截止日期"
            class="w-full"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="approvalDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmitApproval" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { newProductApi } from '@/api/new-product'
import type { NewProductProject, StageReview, StageReviewCreate, StageReviewApproval } from '@/types/new-product'

const route = useRoute()
const router = useRouter()

const projectId = ref(Number(route.params.projectId))
const loading = ref(false)
const submitting = ref(false)
const projectInfo = ref<NewProductProject | null>(null)
const stageReviews = ref<StageReview[]>([])

// 对话框状态
const dialogVisible = ref(false)
const approvalDialogVisible = ref(false)
const dialogTitle = ref('')
const editingId = ref<number | null>(null)
const currentReview = ref<StageReview | null>(null)

// 表单
const formRef = ref<FormInstance>()
const formData = reactive<StageReviewCreate>({
  stage_name: '',
  planned_review_date: ''
})
const approvalForm = reactive<StageReviewApproval>({
  review_result: 'passed',
  review_comments: '',
  conditional_requirements: '',
  conditional_deadline: ''
})

const formRules: FormRules = {
  stage_name: [{ required: true, message: '请输入阶段名称', trigger: 'blur' }]
}

// 加载数据
const loadProjectInfo = async () => {
  try {
    projectInfo.value = await newProductApi.getProject(projectId.value)
  } catch (error: any) {
    ElMessage.error(error.message || '加载项目信息失败')
  }
}

const loadStageReviews = async () => {
  loading.value = true
  try {
    stageReviews.value = await newProductApi.getStageReviews(projectId.value)
  } catch (error: any) {
    ElMessage.error(error.message || '加载评审列表失败')
  } finally {
    loading.value = false
  }
}

// 创建评审
const handleCreateReview = () => {
  editingId.value = null
  dialogTitle.value = '新增阶段评审'
  Object.assign(formData, { stage_name: '', planned_review_date: '' })
  dialogVisible.value = true
}

// 编辑评审
const handleEditReview = (review: StageReview) => {
  editingId.value = review.id
  dialogTitle.value = '编辑阶段评审'
  Object.assign(formData, {
    stage_name: review.stage_name,
    planned_review_date: review.planned_review_date
  })
  dialogVisible.value = true
}

// 提交表单
const handleSubmit = async () => {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
    submitting.value = true
    
    if (editingId.value) {
      await newProductApi.updateStageReview(projectId.value, editingId.value, formData)
      ElMessage.success('更新成功')
    } else {
      await newProductApi.createStageReview(projectId.value, formData)
      ElMessage.success('创建成功')
    }
    
    dialogVisible.value = false
    loadStageReviews()
  } catch (error: any) {
    if (error !== false) {
      ElMessage.error(error.message || '操作失败')
    }
  } finally {
    submitting.value = false
  }
}

// 批准评审
const handleApproveReview = (review: StageReview) => {
  currentReview.value = review
  Object.assign(approvalForm, {
    review_result: 'passed',
    review_comments: '',
    conditional_requirements: '',
    conditional_deadline: ''
  })
  approvalDialogVisible.value = true
}

// 提交批准
const handleSubmitApproval = async () => {
  if (!currentReview.value) return
  submitting.value = true
  try {
    await newProductApi.approveStageReview(projectId.value, currentReview.value.id, approvalForm)
    ElMessage.success('评审批准成功')
    approvalDialogVisible.value = false
    loadStageReviews()
  } catch (error: any) {
    ElMessage.error(error.message || '操作失败')
  } finally {
    submitting.value = false
  }
}

// 上传交付物
const handleUploadDeliverable = (_review: StageReview, _deliverable: any) => {
  ElMessage.info('上传交付物功能开发中')
}

// 下载文件
const handleDownload = (filePath: string) => {
  window.open(filePath, '_blank')
}

// 返回
const handleBack = () => {
  router.back()
}

// 辅助函数
const getStageLabel = (stage: string) => {
  const labels: Record<string, string> = {
    concept: '概念', design: '设计', development: '开发',
    validation: '验证', trial_production: '试产', sop: 'SOP', closed: '已关闭'
  }
  return labels[stage] || stage
}

const getStageType = (stage: string) => {
  const types: Record<string, any> = {
    concept: 'info', design: '', development: 'warning',
    validation: 'warning', trial_production: 'success', sop: 'success', closed: 'info'
  }
  return types[stage] || ''
}

const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    active: '进行中', on_hold: '暂停', completed: '已完成', cancelled: '已取消'
  }
  return labels[status] || status
}

const getStatusType = (status: string) => {
  const types: Record<string, any> = {
    active: 'success', on_hold: 'warning', completed: 'info', cancelled: 'danger'
  }
  return types[status] || ''
}

const getReviewResultLabel = (result: string) => {
  const labels: Record<string, string> = {
    passed: '通过', conditional_pass: '有条件通过', failed: '不通过', pending: '待评审'
  }
  return labels[result] || result
}

const getReviewResultType = (result: string) => {
  const types: Record<string, any> = {
    passed: 'success', conditional_pass: 'warning', failed: 'danger', pending: 'info'
  }
  return types[result] || ''
}

const getDeliverableStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    missing: '缺失', submitted: '已提交', approved: '已批准'
  }
  return labels[status] || status
}

const getDeliverableStatusType = (status: string) => {
  const types: Record<string, any> = {
    missing: 'danger', submitted: 'warning', approved: 'success'
  }
  return types[status] || ''
}

const formatDate = (dateStr: string, type: 'date' | 'datetime' = 'datetime') => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return type === 'date' ? date.toLocaleDateString('zh-CN') : date.toLocaleString('zh-CN')
}

// 初始化
onMounted(() => {
  loadProjectInfo()
  loadStageReviews()
})
</script>

<style scoped>
.stage-review {
  min-height: 100vh;
  background-color: #f5f7fa;
}
</style>
