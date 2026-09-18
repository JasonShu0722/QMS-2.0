<template>
  <div class="project-lesson-check p-4 md:p-6">
    <div class="header mb-6">
      <el-page-header @back="handleBack" class="mb-4">
        <template #content>
          <h1 class="text-2xl font-bold">经验教训点检</h1>
        </template>
      </el-page-header>
      <p class="text-gray-600">逐条勾选历史经验教训是否在本项目规避</p>
    </div>

    <!-- 项目信息 -->
    <el-card class="mb-4" v-if="projectInfo">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="项目代码">{{ projectInfo.project_code }}</el-descriptions-item>
        <el-descriptions-item label="项目名称">{{ projectInfo.project_name }}</el-descriptions-item>
        <el-descriptions-item label="产品类型">{{ projectInfo.product_type || '-' }}</el-descriptions-item>
        <el-descriptions-item label="项目经理">{{ projectInfo.project_manager || '-' }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <!-- 操作按钮 -->
    <el-card class="mb-4">
      <el-button type="primary" @click="handlePushLessons" :loading="pushing">
        推送相关经验教训
      </el-button>
      <el-button type="success" @click="handleBatchSubmit" :loading="submitting" :disabled="!hasChanges">
        保存点检结果
      </el-button>
      <span class="ml-4 text-gray-600">已点检: {{ checkedCount }} / {{ lessonChecks.length }}</span>
    </el-card>

    <!-- 经验教训点检列表 -->
    <el-card v-loading="loading">
      <el-table :data="lessonChecks" stripe>
        <el-table-column type="index" label="序号" width="60" />
        <el-table-column prop="lesson_title" label="经验教训标题" min-width="200" show-overflow-tooltip />
        <el-table-column label="是否适用" width="120">
          <template #default="{ row, $index }">
            <el-radio-group v-model="row.is_applicable" @change="handleApplicableChange(row, $index)">
              <el-radio :label="true">适用</el-radio>
              <el-radio :label="false">不适用</el-radio>
            </el-radio-group>
          </template>
        </el-table-column>
        <el-table-column label="不适用原因/规避措施" min-width="300">
          <template #default="{ row }">
            <el-input
              v-if="row.is_applicable === false"
              v-model="row.reason_if_not"
              type="textarea"
              :rows="2"
              placeholder="请填写不适用原因（至少10字）"
            />
            <el-input
              v-else-if="row.is_applicable === true"
              v-model="row.evidence_description"
              type="textarea"
              :rows="2"
              placeholder="请描述规避措施"
            />
          </template>
        </el-table-column>
        <el-table-column label="证据文件" width="150">
          <template #default="{ row }">
            <el-upload
              v-if="row.is_applicable === true && row.id"
              :action="`/api/v1/projects/${projectId}/lesson-checks/${row.id}/evidence`"
              :headers="{ Authorization: `Bearer ${token}` }"
              :on-success="() => handleUploadSuccess(row)"
              :show-file-list="false"
            >
              <el-button size="small" type="primary">上传证据</el-button>
            </el-upload>
            <span v-if="row.evidence_file_path" class="text-green-600">已上传</span>
          </template>
        </el-table-column>
        <el-table-column label="点检状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.checked_at" type="success">已点检</el-tag>
            <el-tag v-else type="info">待点检</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleViewLesson(row)">
              查看详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 经验教训详情对话框 -->
    <el-dialog v-model="detailDialogVisible" title="经验教训详情" width="700px">
      <el-descriptions :column="1" border v-if="currentLesson">
        <el-descriptions-item label="标题">{{ currentLesson.lesson_title }}</el-descriptions-item>
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
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { newProductApi } from '@/api/new-product'
import type { NewProductProject, ProjectLessonCheck, LessonLearned } from '@/types/new-product'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const projectId = ref(Number(route.params.projectId))
const loading = ref(false)
const pushing = ref(false)
const submitting = ref(false)
const projectInfo = ref<NewProductProject | null>(null)
const lessonChecks = ref<ProjectLessonCheck[]>([])
const detailDialogVisible = ref(false)
const currentLesson = ref<LessonLearned | null>(null)

const token = computed(() => authStore.token)
const hasChanges = ref(false)
const checkedCount = computed(() => lessonChecks.value.filter(c => c.checked_at).length)

// 加载项目信息
const loadProjectInfo = async () => {
  try {
    projectInfo.value = await newProductApi.getProject(projectId.value)
  } catch (error: any) {
    ElMessage.error(error.message || '加载项目信息失败')
  }
}

// 加载点检列表
const loadLessonChecks = async () => {
  loading.value = true
  try {
    lessonChecks.value = await newProductApi.getProjectLessonChecks(projectId.value)
  } catch (error: any) {
    ElMessage.error(error.message || '加载点检列表失败')
  } finally {
    loading.value = false
  }
}

// 推送经验教训
const handlePushLessons = async () => {
  pushing.value = true
  try {
    const result = await newProductApi.pushLessonsToProject(projectId.value)
    ElMessage.success(`成功推送 ${result.total_pushed} 条经验教训`)
    loadLessonChecks()
  } catch (error: any) {
    ElMessage.error(error.message || '推送失败')
  } finally {
    pushing.value = false
  }
}

// 适用性变更
const handleApplicableChange = (row: ProjectLessonCheck, _index: number) => {
  hasChanges.value = true
  if (row.is_applicable === true) {
    row.reason_if_not = ''
  } else {
    row.evidence_description = ''
  }
}

// 批量提交
const handleBatchSubmit = async () => {
  // 验证
  for (const check of lessonChecks.value) {
    if (check.is_applicable === false && (!check.reason_if_not || check.reason_if_not.length < 10)) {
      ElMessage.warning('不适用时必须填写原因说明（至少10字）')
      return
    }
  }

  submitting.value = true
  try {
    const checks = lessonChecks.value.map(c => ({
      lesson_id: c.lesson_id,
      is_applicable: c.is_applicable,
      reason_if_not: c.reason_if_not,
      evidence_description: c.evidence_description
    }))
    await newProductApi.submitLessonChecks(projectId.value, checks)
    ElMessage.success('保存成功')
    hasChanges.value = false
    loadLessonChecks()
  } catch (error: any) {
    ElMessage.error(error.message || '保存失败')
  } finally {
    submitting.value = false
  }
}

// 上传成功
const handleUploadSuccess = (_row: ProjectLessonCheck) => {
  ElMessage.success('证据上传成功')
  loadLessonChecks()
}

// 查看经验教训详情
const handleViewLesson = async (row: ProjectLessonCheck) => {
  try {
    currentLesson.value = await newProductApi.getLessonLearned(row.lesson_id)
    detailDialogVisible.value = true
  } catch (error: any) {
    ElMessage.error(error.message || '加载详情失败')
  }
}

// 返回
const handleBack = () => {
  router.back()
}

// 初始化
onMounted(() => {
  loadProjectInfo()
  loadLessonChecks()
})
</script>

<style scoped>
.project-lesson-check {
  min-height: 100vh;
  background-color: #f5f7fa;
}
</style>
