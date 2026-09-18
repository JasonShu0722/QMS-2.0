<template>
  <div class="supplier-targets">
    <div class="page-header">
      <h2>质量目标管理</h2>
    </div>

    <el-card shadow="never">
      <el-table v-loading="loading" :data="targetsList" stripe>
        <el-table-column prop="year" label="年度" width="100" />
        <el-table-column prop="supplier_name" label="供应商" width="150" />
        <el-table-column prop="target_type" label="目标类型" width="150" />
        <el-table-column prop="target_value" label="目标值" width="120" align="right" />
        <el-table-column prop="is_signed" label="签署状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.is_signed ? 'success' : 'warning'" size="small">
              {{ row.is_signed ? '已签署' : '待签署' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="signed_at" label="签署时间" width="150">
          <template #default="{ row }">
            {{ row.signed_at ? formatDate(row.signed_at) : '-' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-button 
              v-if="!row.is_signed" 
              type="primary" 
              size="small" 
              @click="handleSign(row)"
            >
              签署
            </el-button>
            <el-button v-else type="info" size="small" disabled>
              已签署
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
          @current-change="loadTargetsList"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { supplierApi } from '@/api/supplier'
import type { SupplierTarget } from '@/types/supplier'

const loading = ref(false)
const targetsList = ref<SupplierTarget[]>([])

const pagination = reactive({
  page: 1,
  page_size: 20,
  total: 0
})

const formatDate = (date: string) => {
  if (!date) return ''
  return new Date(date).toLocaleDateString('zh-CN')
}

const handleSign = async (row: SupplierTarget) => {
  try {
    await ElMessageBox.confirm(
      '签署后将无法修改，确认签署该质量目标吗？',
      '确认签署',
      {
        confirmButtonText: '确认',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    await supplierApi.signTarget(row.id)
    ElMessage.success('签署成功')
    loadTargetsList()
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Failed to sign target:', error)
      ElMessage.error('签署失败')
    }
  }
}

const loadTargetsList = async () => {
  try {
    loading.value = true
    const response = await supplierApi.getTargetsList({
      page: pagination.page,
      page_size: pagination.page_size
    })
    targetsList.value = response.items
    pagination.total = response.total
  } catch (error) {
    console.error('Failed to load targets list:', error)
    ElMessage.error('加载目标列表失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadTargetsList()
})
</script>

<style scoped lang="scss">
.supplier-targets {
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
}
</style>
