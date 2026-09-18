<template>
  <div class="inspection-specs">
    <div class="page-header">
      <h2>检验规范管理</h2>
    </div>

    <el-card shadow="never">
      <el-table v-loading="loading" :data="specsList" stripe>
        <el-table-column prop="material_code" label="物料编码" width="120" />
        <el-table-column prop="supplier_name" label="供应商" width="150" />
        <el-table-column prop="version" label="版本" width="100" />
        <el-table-column prop="status" label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)" size="small">
              {{ getStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="关键特性" width="100">
          <template #default="{ row }">
            <el-badge :value="row.key_characteristics?.length || 0" />
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="150">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="handleView">
              查看
            </el-button>
            <el-button 
              v-if="canSubmit(row)" 
              type="success" 
              size="small" 
              @click="handleSubmit(row)"
            >
              提交SIP
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
          @current-change="loadSpecsList"
        />
      </div>
    </el-card>

    <!-- 提交 SIP 对话框 -->
    <el-dialog v-model="showSubmitDialog" title="提交检验规范" width="600px">
      <el-form :model="submitForm" label-width="120px">
        <el-form-item label="关键特性">
          <el-button type="primary" @click="addCharacteristic">
            <el-icon><Plus /></el-icon>
            添加特性
          </el-button>
          <div v-for="(char, index) in submitForm.key_characteristics" :key="index" class="characteristic-item">
            <el-input v-model="char.name" placeholder="特性名称" style="width: 30%;" />
            <el-input v-model="char.specification" placeholder="规格要求" style="width: 30%;" />
            <el-input v-model="char.method" placeholder="检验方法" style="width: 30%;" />
            <el-button type="danger" circle @click="removeCharacteristic(index)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </div>
        </el-form-item>

        <el-form-item label="SIP 文件">
          <el-upload
            :action="uploadUrl"
            :headers="uploadHeaders"
            :on-success="handleUploadSuccess"
            :limit="1"
          >
            <el-button type="primary">
              <el-icon><Upload /></el-icon>
              上传 SIP 文件
            </el-button>
            <template #tip>
              <div class="el-upload__tip">
                请上传双方签字版 SIP 文件（PDF格式）
              </div>
            </template>
          </el-upload>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showSubmitDialog = false">取消</el-button>
        <el-button type="primary" @click="handleSubmitConfirm">
          提交
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Delete, Upload } from '@element-plus/icons-vue'
import { supplierApi } from '@/api/supplier'
import { useAuthStore } from '@/stores/auth'
import type { InspectionSpec } from '@/types/supplier'

const authStore = useAuthStore()
const loading = ref(false)
const showSubmitDialog = ref(false)
const specsList = ref<InspectionSpec[]>([])
const selectedSpec = ref<InspectionSpec | null>(null)

const pagination = reactive({
  page: 1,
  page_size: 20,
  total: 0
})

const submitForm = reactive({
  key_characteristics: [] as Array<{ name: string; specification: string; method: string }>
})

const uploadUrl = computed(() => `${import.meta.env.VITE_API_BASE_URL}/v1/upload`)
const uploadHeaders = computed(() => ({
  Authorization: `Bearer ${localStorage.getItem('access_token')}`
}))

const canSubmit = (row: InspectionSpec) => {
  return authStore.isSupplier && row.status === 'draft'
}

const getStatusType = (status: string) => {
  switch (status) {
    case 'active': return 'success'
    case 'approved': return 'success'
    case 'submitted': return 'warning'
    case 'archived': return 'info'
    default: return 'info'
  }
}

const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    draft: '草稿',
    submitted: '已提交',
    approved: '已批准',
    active: '生效中',
    archived: '已归档'
  }
  return labels[status] || status
}

const formatDate = (date: string) => {
  if (!date) return ''
  return new Date(date).toLocaleDateString('zh-CN')
}

const addCharacteristic = () => {
  submitForm.key_characteristics.push({ name: '', specification: '', method: '' })
}

const removeCharacteristic = (index: number) => {
  submitForm.key_characteristics.splice(index, 1)
}

const handleView = () => {
  ElMessage.info('查看检验规范详情功能开发中')
}

const handleSubmit = (row: InspectionSpec) => {
  selectedSpec.value = row
  submitForm.key_characteristics = row.key_characteristics || []
  showSubmitDialog.value = true
}

const handleUploadSuccess = () => {
  ElMessage.success('文件上传成功')
}

const handleSubmitConfirm = async () => {
  try {
    if (!selectedSpec.value) return
    const formData = new FormData()
    formData.append('key_characteristics', JSON.stringify(submitForm.key_characteristics))
    await supplierApi.submitInspectionSpec(selectedSpec.value.id, formData)
    ElMessage.success('提交成功')
    showSubmitDialog.value = false
    loadSpecsList()
  } catch (error) {
    console.error('Failed to submit inspection spec:', error)
    ElMessage.error('提交失败')
  }
}

const loadSpecsList = async () => {
  try {
    loading.value = true
    const response = await supplierApi.getInspectionSpecsList({
      page: pagination.page,
      page_size: pagination.page_size
    })
    specsList.value = response.items
    pagination.total = response.total
  } catch (error) {
    console.error('Failed to load specs list:', error)
    ElMessage.error('加载检验规范列表失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadSpecsList()
})
</script>

<style scoped lang="scss">
.inspection-specs {
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

  .characteristic-item {
    display: flex;
    gap: 10px;
    margin-top: 10px;
    align-items: center;
  }
}
</style>
