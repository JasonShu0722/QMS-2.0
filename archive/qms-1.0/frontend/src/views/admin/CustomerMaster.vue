<template>
  <div class="customer-master-page page-stage--stack">
    <section class="page-surface page-surface--table customer-surface">
      <div class="customer-toolbar">
        <div class="filter-row">
          <el-input
            v-model="filters.keyword"
            clearable
            placeholder="客户代码或名称"
            :prefix-icon="Search"
            @keyup.enter="loadCustomers"
          />
          <el-select v-model="filters.status" clearable placeholder="全部状态">
            <el-option label="启用" value="active" />
            <el-option label="停用" value="suspended" />
          </el-select>
          <div class="filter-row__actions">
            <el-button type="primary" @click="loadCustomers">查询</el-button>
            <el-button @click="resetFilters">重置</el-button>
          </div>
        </div>

        <div class="customer-toolbar__actions">
          <el-button type="primary" :icon="Plus" @click="openCreateDialog">新增客户</el-button>
          <el-button :icon="Upload" @click="openImportDialog">批量导入</el-button>
          <el-button :icon="Refresh" circle @click="loadCustomers" />
        </div>
      </div>

      <div v-if="loading" class="panel-loading">
        <el-icon class="is-loading text-4xl"><Loading /></el-icon>
        <p>加载中...</p>
      </div>

      <el-table
        v-else
        :data="customers"
        stripe
        class="customer-table"
        empty-text="暂无客户基础信息"
      >
        <el-table-column prop="code" label="客户代码" min-width="140" />
        <el-table-column prop="name" label="客户名称" min-width="220" />
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
        <el-table-column label="最近更新" width="180">
          <template #default="{ row }">{{ formatDate(row.updated_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right" align="right">
          <template #default="{ row }">
            <div class="customer-actions">
              <el-button link type="primary" @click="openEditDialog(row)">编辑</el-button>
              <el-button
                link
                :type="row.status === 'active' ? 'warning' : 'success'"
                @click="toggleCustomerStatus(row)"
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
      :title="editingCustomerId ? '编辑客户' : '新增客户'"
      width="560px"
      destroy-on-close
      @closed="resetEditForm"
    >
      <el-form :model="editForm" label-width="100px">
        <el-form-item label="客户代码" required>
          <el-input v-model="editForm.code" />
        </el-form-item>
        <el-form-item label="客户名称" required>
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
        <el-button type="primary" :loading="submitting" @click="submitCustomer">
          {{ editingCustomerId ? '保存' : '创建' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="importDialogVisible"
      title="批量导入客户"
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
            placeholder="客户代码,客户名称[,联系人,联系邮箱,联系电话]"
          />
          <div class="import-limit-note">单次最多导入 500 条，超过请拆分后分批导入。</div>
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
import {
  CUSTOMER_MASTER_IMPORT_MAX_ITEMS,
  parseCustomerMasterImportContent,
} from '@/utils/customerMasterImport'
import type {
  CustomerListQuery,
  CustomerMaster,
  CustomerMasterBulkCreateItem,
  CustomerMasterCreateRequest,
  CustomerMasterUpdateRequest,
} from '@/types/admin'

const loading = ref(false)
const submitting = ref(false)
const customers = ref<CustomerMaster[]>([])

const filters = reactive<CustomerListQuery>({
  keyword: '',
  status: undefined,
})

const editDialogVisible = ref(false)
const importDialogVisible = ref(false)
const editingCustomerId = ref<number | null>(null)

const editForm = reactive<CustomerMasterUpdateRequest>({
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

async function loadCustomers() {
  loading.value = true
  try {
    customers.value = await adminApi.getCustomers({
      keyword: filters.keyword?.trim() || undefined,
      status: filters.status,
    })
  } catch (error: any) {
    ElMessage.error(error.message || '加载客户基础信息失败')
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  filters.keyword = ''
  filters.status = undefined
  void loadCustomers()
}

function resetEditForm() {
  editingCustomerId.value = null
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

function openEditDialog(customer: CustomerMaster) {
  editingCustomerId.value = customer.id
  editForm.code = customer.code
  editForm.name = customer.name
  editForm.contact_person = customer.contact_person || ''
  editForm.contact_email = customer.contact_email || ''
  editForm.contact_phone = customer.contact_phone || ''
  editForm.status = customer.status
  editDialogVisible.value = true
}

function openImportDialog() {
  resetImportForm()
  importDialogVisible.value = true
}

function validateCustomerForm() {
  if (!editForm.code.trim()) {
    ElMessage.error('请填写客户代码')
    return false
  }
  if (!editForm.name.trim()) {
    ElMessage.error('请填写客户名称')
    return false
  }
  return true
}

async function submitCustomer() {
  if (!validateCustomerForm()) {
    return
  }

  const payload: CustomerMasterCreateRequest | CustomerMasterUpdateRequest = {
    code: editForm.code.trim(),
    name: editForm.name.trim(),
    contact_person: editForm.contact_person?.trim() || undefined,
    contact_email: editForm.contact_email?.trim() || undefined,
    contact_phone: editForm.contact_phone?.trim() || undefined,
    status: editForm.status,
  }

  submitting.value = true
  try {
    if (editingCustomerId.value) {
      await adminApi.updateCustomer(editingCustomerId.value, payload as CustomerMasterUpdateRequest)
      ElMessage.success('客户已更新')
    } else {
      await adminApi.createCustomer(payload)
      ElMessage.success('客户已创建')
    }
    editDialogVisible.value = false
    await loadCustomers()
  } catch (error: any) {
    ElMessage.error(error.message || '保存客户失败')
  } finally {
    submitting.value = false
  }
}

function parseImportItems(): CustomerMasterBulkCreateItem[] {
  return parseCustomerMasterImportContent(importForm.content)
}

async function submitImport() {
  let items: CustomerMasterBulkCreateItem[]

  try {
    items = parseImportItems()
  } catch (error: any) {
    ElMessage.error(error.message || '导入内容格式不正确')
    return
  }

  if (!items.length) {
    ElMessage.error('请至少填写一条客户数据')
    return
  }

  if (items.length > CUSTOMER_MASTER_IMPORT_MAX_ITEMS) {
    ElMessage.error(
      `单次最多导入 ${CUSTOMER_MASTER_IMPORT_MAX_ITEMS} 条，当前 ${items.length} 条，请分批导入`
    )
    return
  }

  submitting.value = true
  try {
    const response = await adminApi.bulkCreateCustomers({
      status: importForm.status,
      items,
    })
    ElMessage.success(response.message)
    importDialogVisible.value = false
    await loadCustomers()
  } catch (error: any) {
    ElMessage.error(error.message || '批量导入客户失败')
  } finally {
    submitting.value = false
  }
}

async function toggleCustomerStatus(customer: CustomerMaster) {
  const nextStatus = customer.status === 'active' ? 'suspended' : 'active'
  const actionText = nextStatus === 'active' ? '启用' : '停用'

  try {
    await ElMessageBox.confirm(
      `确定要${actionText}客户“${customer.name}”吗？`,
      `${actionText}客户`,
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )

    await adminApi.updateCustomerStatus(customer.id, nextStatus)
    ElMessage.success(`客户已${actionText}`)
    await loadCustomers()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || `${actionText}客户失败`)
    }
  }
}

function formatDate(value?: string) {
  if (!value) {
    return '-'
  }
  return value.replace('T', ' ').slice(0, 16)
}

onMounted(() => {
  void loadCustomers()
})
</script>

<style scoped>
.customer-master-page {
  min-height: 100%;
}

.customer-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.filter-row {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 12px;
}

.filter-row :deep(.el-input),
.filter-row :deep(.el-select) {
  width: 220px;
}

.filter-row__actions {
  display: flex;
  gap: 8px;
}

.customer-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.import-limit-note {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.4;
}

.panel-loading {
  display: flex;
  min-height: 240px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--el-text-color-secondary);
}

.customer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 960px) {
  .filter-row,
  .customer-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .filter-row :deep(.el-input),
  .filter-row :deep(.el-select) {
    width: 100%;
  }
}
</style>
