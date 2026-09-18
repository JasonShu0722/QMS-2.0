<template>
  <div class="supplier-master-page page-stage--stack">
    <section class="page-surface page-surface--table supplier-surface">
      <div class="supplier-toolbar">
        <div class="filter-row">
          <el-input
            v-model="filters.keyword"
            clearable
            placeholder="供应商代码或名称"
            :prefix-icon="Search"
            @keyup.enter="loadSuppliers"
          />
          <el-select v-model="filters.status" clearable placeholder="全部状态">
            <el-option label="启用" value="active" />
            <el-option label="停用" value="suspended" />
          </el-select>
          <div class="filter-row__actions">
            <el-button type="primary" @click="loadSuppliers">查询</el-button>
            <el-button @click="resetFilters">重置</el-button>
          </div>
        </div>

        <div class="supplier-toolbar__actions">
          <el-button type="primary" :icon="Plus" @click="openCreateDialog">新增供应商</el-button>
          <el-button :icon="Upload" @click="openImportDialog">批量导入</el-button>
          <el-button :icon="Refresh" circle @click="loadSuppliers" />
        </div>
      </div>

      <div v-if="loading" class="panel-loading">
        <el-icon class="is-loading text-4xl"><Loading /></el-icon>
        <p>加载中...</p>
      </div>

      <el-table
        v-else
        :data="suppliers"
        stripe
        class="supplier-table"
        empty-text="暂无供应商基础信息"
      >
        <el-table-column prop="code" label="供应商代码" min-width="140" />
        <el-table-column prop="name" label="供应商名称" min-width="220" />
        <el-table-column prop="contact_person" label="联系人" min-width="120">
          <template #default="{ row }">{{ row.contact_person || '-' }}</template>
        </el-table-column>
        <el-table-column prop="contact_email" label="联系邮箱" min-width="200">
          <template #default="{ row }">{{ row.contact_email || '-' }}</template>
        </el-table-column>
        <el-table-column prop="contact_phone" label="联系电话" min-width="140">
          <template #default="{ row }">{{ row.contact_phone || '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'warning'">
              {{ row.status === 'active' ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="关联账号" width="100" align="center">
          <template #default="{ row }">{{ row.linked_user_count }}</template>
        </el-table-column>
        <el-table-column label="启用账号" width="100" align="center">
          <template #default="{ row }">{{ row.active_user_count }}</template>
        </el-table-column>
        <el-table-column label="最近更新" width="180">
          <template #default="{ row }">{{ formatDate(row.updated_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right" align="right">
          <template #default="{ row }">
            <div class="supplier-actions">
              <el-button link type="primary" @click="openEditDialog(row)">编辑</el-button>
              <el-button
                link
                :type="row.status === 'active' ? 'warning' : 'success'"
                @click="toggleSupplierStatus(row)"
              >
                {{ row.status === 'active' ? '停用' : '启用' }}
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <el-dialog
      v-model="editDialogVisible"
      :title="editingSupplierId ? '编辑供应商' : '新增供应商'"
      width="560px"
      destroy-on-close
      @closed="resetEditForm"
    >
      <el-form :model="editForm" label-width="100px">
        <el-form-item label="供应商代码" required>
          <el-input v-model="editForm.code" />
        </el-form-item>
        <el-form-item label="供应商名称" required>
          <el-input v-model="editForm.name" />
        </el-form-item>
        <el-form-item label="联系人">
          <el-input v-model="editForm.contact_person" />
        </el-form-item>
        <el-form-item label="联系邮箱">
          <el-input v-model="editForm.contact_email" />
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="editForm.contact_phone" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="editForm.status">
            <el-radio-button label="active">启用</el-radio-button>
            <el-radio-button label="suspended">停用</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitSupplier">
          {{ editingSupplierId ? '保存' : '创建' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="importDialogVisible"
      title="批量导入供应商"
      width="720px"
      destroy-on-close
      @closed="resetImportForm"
    >
      <el-form :model="importForm" label-width="92px">
        <el-form-item label="导入状态">
          <el-radio-group v-model="importForm.status">
            <el-radio-button label="active">启用</el-radio-button>
            <el-radio-button label="suspended">停用</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="批量内容" required>
          <el-input
            v-model="importForm.content"
            type="textarea"
            :rows="12"
            placeholder="供应商代码,供应商名称[,联系人,联系邮箱,联系电话]"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitImport">导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading, Plus, Refresh, Search, Upload } from '@element-plus/icons-vue'

import { adminApi } from '@/api/admin'
import type {
  SupplierListQuery,
  SupplierMaster,
  SupplierMasterBulkCreateItem,
  SupplierMasterCreateRequest,
  SupplierMasterUpdateRequest,
} from '@/types/admin'

const loading = ref(false)
const submitting = ref(false)
const suppliers = ref<SupplierMaster[]>([])

const filters = reactive<SupplierListQuery>({
  keyword: '',
  status: undefined,
})

const editDialogVisible = ref(false)
const importDialogVisible = ref(false)
const editingSupplierId = ref<number | null>(null)

const editForm = reactive<SupplierMasterUpdateRequest>({
  code: '',
  name: '',
  contact_person: '',
  contact_email: '',
  contact_phone: '',
  status: 'active',
})

const importForm = reactive({
  status: 'active' as 'active' | 'suspended',
  content: '',
})

async function loadSuppliers() {
  loading.value = true
  try {
    suppliers.value = await adminApi.getSuppliers({
      keyword: filters.keyword?.trim() || undefined,
      status: filters.status,
    })
  } catch (error: any) {
    ElMessage.error(error.message || '加载供应商基础信息失败')
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  filters.keyword = ''
  filters.status = undefined
  loadSuppliers()
}

function resetEditForm() {
  editingSupplierId.value = null
  editForm.code = ''
  editForm.name = ''
  editForm.contact_person = ''
  editForm.contact_email = ''
  editForm.contact_phone = ''
  editForm.status = 'active'
  submitting.value = false
}

function resetImportForm() {
  importForm.status = 'active'
  importForm.content = ''
  submitting.value = false
}

function openCreateDialog() {
  resetEditForm()
  editDialogVisible.value = true
}

function openEditDialog(supplier: SupplierMaster) {
  editingSupplierId.value = supplier.id
  editForm.code = supplier.code
  editForm.name = supplier.name
  editForm.contact_person = supplier.contact_person || ''
  editForm.contact_email = supplier.contact_email || ''
  editForm.contact_phone = supplier.contact_phone || ''
  editForm.status = supplier.status
  editDialogVisible.value = true
}

function openImportDialog() {
  resetImportForm()
  importDialogVisible.value = true
}

function validateSupplierForm() {
  if (!editForm.code.trim()) {
    ElMessage.error('请填写供应商代码')
    return false
  }
  if (!editForm.name.trim()) {
    ElMessage.error('请填写供应商名称')
    return false
  }
  return true
}

async function submitSupplier() {
  if (!validateSupplierForm()) {
    return
  }

  const payload: SupplierMasterCreateRequest | SupplierMasterUpdateRequest = {
    code: editForm.code.trim(),
    name: editForm.name.trim(),
    contact_person: editForm.contact_person?.trim() || undefined,
    contact_email: editForm.contact_email?.trim() || undefined,
    contact_phone: editForm.contact_phone?.trim() || undefined,
    status: editForm.status,
  }

  submitting.value = true
  try {
    if (editingSupplierId.value) {
      await adminApi.updateSupplier(editingSupplierId.value, payload as SupplierMasterUpdateRequest)
      ElMessage.success('供应商已更新')
    } else {
      await adminApi.createSupplier(payload)
      ElMessage.success('供应商已创建')
    }
    editDialogVisible.value = false
    await loadSuppliers()
  } catch (error: any) {
    ElMessage.error(error.message || '保存供应商失败')
  } finally {
    submitting.value = false
  }
}

function parseImportItems(): SupplierMasterBulkCreateItem[] {
  return importForm.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const delimiter = line.includes('\t') ? '\t' : ','
      const cells = line.split(delimiter).map((item) => item.trim())
      if (cells.length < 2 || cells.length > 5) {
        throw new Error('每行需填写 2 到 5 列数据')
      }
      const [code, name, contactPerson, contactEmail, contactPhone] = cells
      if (!code || !name) {
        throw new Error('供应商代码和供应商名称不能为空')
      }
      return {
        code,
        name,
        contact_person: contactPerson || undefined,
        contact_email: contactEmail || undefined,
        contact_phone: contactPhone || undefined,
      }
    })
}

async function submitImport() {
  if (!importForm.content.trim()) {
    ElMessage.error('请填写批量内容')
    return
  }

  let items: SupplierMasterBulkCreateItem[] = []
  try {
    items = parseImportItems()
  } catch (error: any) {
    ElMessage.error(error.message || '批量内容格式不正确')
    return
  }

  submitting.value = true
  try {
    const result = await adminApi.bulkCreateSuppliers({
      status: importForm.status,
      items,
    })
    importDialogVisible.value = false
    ElMessage.success(`已导入 ${result.created_count} 家供应商`)
    await loadSuppliers()
  } catch (error: any) {
    ElMessage.error(error.message || '批量导入失败')
  } finally {
    submitting.value = false
  }
}

async function toggleSupplierStatus(supplier: SupplierMaster) {
  const nextStatus = supplier.status === 'active' ? 'suspended' : 'active'
  const actionLabel = nextStatus === 'active' ? '启用' : '停用'

  try {
    await ElMessageBox.confirm(
      `确认${actionLabel} ${supplier.name}（${supplier.code}）？`,
      `${actionLabel}供应商`,
      { type: nextStatus === 'active' ? 'success' : 'warning' }
    )
    await adminApi.updateSupplierStatus(supplier.id, nextStatus)
    ElMessage.success(`供应商已${actionLabel}`)
    await loadSuppliers()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || `${actionLabel}供应商失败`)
    }
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

onMounted(() => {
  loadSuppliers()
})
</script>

<style scoped>
.supplier-surface {
  overflow: hidden;
}

.supplier-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.supplier-toolbar__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.filter-row {
  display: grid;
  grid-template-columns: minmax(260px, 2fr) minmax(140px, 180px) auto;
  gap: 12px;
  align-items: center;
  flex: 1;
  padding: 12px 14px;
  border-radius: 14px;
  background: #f8fafc;
  border: 1px solid rgba(226, 232, 240, 0.82);
}

.filter-row__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.supplier-table :deep(.el-table__cell) {
  padding-top: 12px;
  padding-bottom: 12px;
}

.supplier-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}

.panel-loading {
  padding: 48px 0;
  text-align: center;
  color: #64748b;
}

.panel-loading p {
  margin-top: 12px;
}

@media (max-width: 1200px) {
  .supplier-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .supplier-toolbar__actions {
    justify-content: flex-end;
  }
}

@media (max-width: 768px) {
  .filter-row {
    grid-template-columns: 1fr;
  }

  .filter-row__actions,
  .supplier-toolbar__actions {
    justify-content: stretch;
  }

  .filter-row__actions :deep(.el-button),
  .supplier-toolbar__actions :deep(.el-button:not(.is-circle)) {
    flex: 1;
  }
}
</style>
