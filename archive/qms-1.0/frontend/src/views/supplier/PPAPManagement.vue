<template>
  <div class="ppap-management">
    <div class="page-header">
      <h2>PPAP 管理</h2>
    </div>

    <el-card shadow="never">
      <el-table v-loading="loading" :data="ppapList" stripe>
        <el-table-column prop="supplier_name" label="供应商" width="150" />
        <el-table-column prop="material_code" label="物料编码" width="120" />
        <el-table-column prop="ppap_level" label="PPAP等级" width="100">
          <template #default="{ row }">
            Level {{ row.ppap_level }}
          </template>
        </el-table-column>
        <el-table-column prop="submission_date" label="提交日期" width="120">
          <template #default="{ row }">
            {{ formatDate(row.submission_date) }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)" size="small">
              {{ getStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reviewer_name" label="审核员" width="100" />
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="handleView">
              查看
            </el-button>
            <el-button 
              v-if="canUpload(row)" 
              type="success" 
              size="small" 
              @click="handleUpload(row)"
            >
              上传文件
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
          @current-change="loadPPAPList"
        />
      </div>
    </el-card>

    <!-- 上传文件对话框 -->
    <el-dialog v-model="showUploadDialog" title="上传 PPAP 文件" width="600px">
      <el-upload
        class="upload-demo"
        drag
        :action="uploadUrl"
        :headers="uploadHeaders"
        :on-success="handleUploadSuccess"
        multiple
      >
        <el-icon class="el-icon--upload"><upload-filled /></el-icon>
        <div class="el-upload__text">
          拖拽文件到此处或 <em>点击上传</em>
        </div>
        <template #tip>
          <div class="el-upload__tip">
            请上传 PPAP 相关文件（PSW、全尺寸测量报告、控制计划等）
          </div>
        </template>
      </el-upload>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import { supplierApi } from '@/api/supplier'
import { useAuthStore } from '@/stores/auth'
import type { PPAP } from '@/types/supplier'

const authStore = useAuthStore()
const loading = ref(false)
const showUploadDialog = ref(false)
const ppapList = ref<PPAP[]>([])
const selectedPPAP = ref<PPAP | null>(null)

const pagination = reactive({
  page: 1,
  page_size: 20,
  total: 0
})

const uploadUrl = computed(() => `${import.meta.env.VITE_API_BASE_URL}/v1/ppap/${selectedPPAP.value?.id}/documents`)
const uploadHeaders = computed(() => ({
  Authorization: `Bearer ${localStorage.getItem('access_token')}`
}))

const canUpload = (row: PPAP) => {
  return authStore.isSupplier && row.status === 'pending'
}

const getStatusType = (status: string) => {
  switch (status) {
    case 'approved': return 'success'
    case 'rejected': return 'danger'
    case 'in_review': return 'warning'
    default: return 'info'
  }
}

const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    pending: '待提交',
    in_review: '审核中',
    approved: '已批准',
    rejected: '已驳回'
  }
  return labels[status] || status
}

const formatDate = (date: string) => {
  if (!date) return ''
  return new Date(date).toLocaleDateString('zh-CN')
}

const handleView = () => {
  ElMessage.info('查看 PPAP 详情功能开发中')
}

const handleUpload = (row: PPAP) => {
  selectedPPAP.value = row
  showUploadDialog.value = true
}

const handleUploadSuccess = () => {
  ElMessage.success('文件上传成功')
  showUploadDialog.value = false
  loadPPAPList()
}

const loadPPAPList = async () => {
  try {
    loading.value = true
    const response = await supplierApi.getPPAPList({
      page: pagination.page,
      page_size: pagination.page_size
    })
    ppapList.value = response.items
    pagination.total = response.total
  } catch (error) {
    console.error('Failed to load PPAP list:', error)
    ElMessage.error('加载 PPAP 列表失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadPPAPList()
})
</script>

<style scoped lang="scss">
.ppap-management {
  padding: 20px;

  .page-header {
    margin-bottom: 20px;

    h2 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
  }

  .pagination-container {
    margin-top: 20px;
    display: flex;
    justify-content: flex-end;
  }

  .upload-demo {
    width: 100%;
  }
}
</style>
