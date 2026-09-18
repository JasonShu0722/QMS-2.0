<template>
  <div class="permission-management-page page-stage--stack">
    <section class="page-surface page-surface--padded permission-surface">
      <div class="surface-toolbar surface-toolbar--wrap panel-actions">
        <el-button :loading="initializing" @click="initializeRoleTemplates">初始化角色模板</el-button>
        <el-button @click="openCreateRoleDialog">新建角色标签</el-button>
        <el-button type="primary" :loading="saving" :disabled="!hasChanges" @click="saveAllChanges">
          保存变更
        </el-button>
        <el-button :icon="Refresh" circle @click="loadPermissionMatrix" />
      </div>

      <el-alert v-if="hasChanges" type="warning" :closable="false" class="permission-alert">
        <template #title>还有 {{ changedCount }} 项权限变更未保存</template>
      </el-alert>

      <div v-if="loading" class="panel-loading">
        <el-icon class="is-loading text-4xl"><Loading /></el-icon>
        <p>加载中...</p>
      </div>

      <div v-else-if="permissionRows.length === 0" class="permission-empty">
        <el-empty description="尚未初始化角色标签">
          <div class="empty-actions">
            <el-button type="primary" :loading="initializing" @click="initializeRoleTemplates">
              初始化预设角色
            </el-button>
            <el-button @click="openCreateRoleDialog">新建自定义角色</el-button>
          </div>
        </el-empty>
      </div>

      <div v-else :class="['permission-layout', hasChanges ? 'permission-layout--with-alert' : '']">
        <aside class="role-sidebar">
          <div class="role-sidebar__filters">
            <el-input
              v-model="roleKeyword"
              clearable
              placeholder="搜索角色名称或标识"
              :prefix-icon="Search"
            />
            <el-radio-group v-model="roleTypeFilter" size="small">
              <el-radio-button label="all">全部</el-radio-button>
              <el-radio-button label="internal">内部</el-radio-button>
              <el-radio-button label="supplier">供应商</el-radio-button>
            </el-radio-group>
          </div>

          <div class="role-sidebar__list">
            <button
              v-for="row in filteredPermissionRows"
              :key="row.role.id"
              type="button"
              :class="['role-card', row.role.id === selectedRoleId ? 'role-card--active' : '']"
              @click="selectedRoleId = row.role.id"
            >
              <div class="role-card__head">
                <strong>{{ row.role.role_name }}</strong>
                <span v-if="roleHasPendingChanges(row.role.id)" class="role-card__dot"></span>
              </div>
              <div class="role-card__key">{{ row.role.role_key }}</div>
              <div class="role-card__meta">
                <el-tag size="small" type="info">{{ roleTypeLabel(row.role.applicable_user_type) }}</el-tag>
                <el-tag size="small" :type="row.role.is_active ? 'success' : 'warning'">
                  {{ row.role.is_active ? '启用' : '停用' }}
                </el-tag>
              </div>
              <div class="role-card__tail">已分配 {{ row.role.assigned_user_count }} 人</div>
            </button>
          </div>
        </aside>

        <section v-if="selectedRoleRow" class="permission-editor">
          <header class="editor-header">
            <div>
              <h3>{{ selectedRoleRow.role.role_name }}</h3>
              <div class="editor-meta">
                <span>{{ selectedRoleRow.role.role_key }}</span>
                <span>{{ roleTypeLabel(selectedRoleRow.role.applicable_user_type) }}</span>
                <span>已分配 {{ selectedRoleRow.role.assigned_user_count }} 人</span>
              </div>
            </div>
            <div class="editor-actions">
              <el-button @click="openEditRoleDialog(selectedRoleRow.role)">编辑角色</el-button>
              <el-button type="danger" @click="handleDeleteRole(selectedRoleRow.role)">删除角色</el-button>
            </div>
          </header>

          <div class="permission-groups">
            <section
              v-for="group in groupedModules"
              :key="group.group_key"
              class="permission-group"
            >
              <header class="permission-group__header">
                <h4>{{ group.group_name }}</h4>
                <span>{{ group.modules.length }} 个模块</span>
              </header>

              <div class="permission-module-grid">
                <article
                  v-for="module in group.modules"
                  :key="module.module_path"
                  class="permission-module"
                >
                  <div class="permission-module__title">{{ module.module_name }}</div>
                  <div class="permission-operations">
                    <label
                      v-for="operation in module.operations"
                      :key="`${selectedRoleRow.role.id}-${module.module_path}.${operation}`"
                      class="permission-check"
                    >
                      <el-checkbox
                        :model-value="selectedRoleRow.permissions[`${module.module_path}.${operation}`]"
                        @change="
                          handlePermissionChange(
                            selectedRoleRow.role.id,
                            module.module_path,
                            operation,
                            $event
                          )
                        "
                      />
                      <span>{{ operationLabels[operation] }}</span>
                    </label>
                  </div>
                </article>
              </div>
            </section>
          </div>
        </section>
      </div>
    </section>

    <el-dialog v-model="roleDialogVisible" :title="roleDialogTitle" width="560px">
      <div class="role-dialog">
        <section class="role-dialog__basic">
          <el-form :model="roleForm" label-width="100px">
            <el-form-item label="角色唯一键">
              <el-input
                v-model="roleForm.role_key"
                :disabled="roleDialogMode === 'edit'"
                placeholder="例如 quality.process.engineer"
              />
            </el-form-item>
            <el-form-item label="角色名称">
              <el-input v-model="roleForm.role_name" />
            </el-form-item>
            <el-form-item label="适用类型">
              <el-select v-model="roleForm.applicable_user_type" style="width: 100%">
                <el-option label="全部账号" value="" />
                <el-option label="内部员工" value="internal" />
                <el-option label="供应商" value="supplier" />
              </el-select>
            </el-form-item>
            <el-form-item label="启用状态">
              <el-switch v-model="roleForm.is_active" />
            </el-form-item>
          </el-form>
        </section>
      </div>

      <template #footer>
        <el-button @click="roleDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveRoleDialog">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading, Refresh, Search } from '@element-plus/icons-vue'

import { adminApi } from '@/api/admin'
import type { OperationType, PermissionMatrixColumn, PermissionMatrixRow } from '@/types/admin'
import type { RolePermissionChange, RoleTagSummary } from '@/types/role'

const operationLabels: Record<OperationType, string> = {
  create: '录入',
  read: '查看',
  update: '修改',
  delete: '删除',
  export: '导出'
}

const loading = ref(false)
const saving = ref(false)
const initializing = ref(false)
const modules = ref<PermissionMatrixColumn[]>([])
const permissionRows = ref<PermissionMatrixRow[]>([])
const baselinePermissions = ref<Record<number, Record<string, boolean>>>({})
const roleKeyword = ref('')
const roleTypeFilter = ref<'all' | 'internal' | 'supplier'>('all')
const selectedRoleId = ref<number | null>(null)
const bootstrapTried = ref(false)

interface PendingChange extends RolePermissionChange {
  role_id: number
}

const pendingChanges = ref<PendingChange[]>([])
const hasChanges = computed(() => pendingChanges.value.length > 0)
const changedCount = computed(() => pendingChanges.value.length)

const filteredPermissionRows = computed(() => {
  const keyword = roleKeyword.value.trim().toLowerCase()
  return permissionRows.value.filter((row) => {
    const matchesType =
      roleTypeFilter.value === 'all' || row.role.applicable_user_type === roleTypeFilter.value
    const matchesKeyword =
      !keyword ||
      row.role.role_name.toLowerCase().includes(keyword) ||
      row.role.role_key.toLowerCase().includes(keyword)
    return matchesType && matchesKeyword
  })
})

const selectedRoleRow = computed(() =>
  filteredPermissionRows.value.find((row) => row.role.id === selectedRoleId.value) || filteredPermissionRows.value[0]
)

const groupedModules = computed(() => {
  const groups = new Map<
    string,
    { group_key: string; group_name: string; modules: PermissionMatrixColumn[] }
  >()

  for (const module of modules.value) {
    const groupKey = module.group_key || 'ungrouped'
    const groupName = module.group_name || '其他'
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        group_key: groupKey,
        group_name: groupName,
        modules: []
      })
    }
    groups.get(groupKey)?.modules.push(module)
  }

  return Array.from(groups.values())
})

const roleDialogVisible = ref(false)
const roleDialogMode = ref<'create' | 'edit'>('create')
const currentRole = ref<RoleTagSummary | null>(null)
const roleForm = reactive({
  role_key: '',
  role_name: '',
  applicable_user_type: '' as '' | 'internal' | 'supplier',
  is_active: true
})

const roleDialogTitle = computed(() => (roleDialogMode.value === 'create' ? '新建角色标签' : '编辑角色标签'))

watch(filteredPermissionRows, (rows) => {
  if (rows.length === 0) {
    selectedRoleId.value = null
    return
  }

  if (!rows.some((row) => row.role.id === selectedRoleId.value)) {
    selectedRoleId.value = rows[0].role.id
  }
})

async function loadPermissionMatrix() {
  loading.value = true
  try {
    const response = await adminApi.getPermissionMatrix()
    if (response.rows.length === 0 && !bootstrapTried.value) {
      bootstrapTried.value = true
      await initializeRoleTemplates({ silentWhenCreated: false })
      return
    }

    applyPermissionMatrix(response)
  } catch (error: any) {
    ElMessage.error(error.message || '加载权限数据失败')
  } finally {
    loading.value = false
  }
}

function applyPermissionMatrix(response: {
  modules: PermissionMatrixColumn[]
  rows: PermissionMatrixRow[]
}) {
  modules.value = response.modules
  permissionRows.value = response.rows
  baselinePermissions.value = Object.fromEntries(
    response.rows.map((row) => [row.role.id, { ...row.permissions }])
  )
  pendingChanges.value = []

  if (!selectedRoleId.value && response.rows.length > 0) {
    selectedRoleId.value = response.rows[0].role.id
  }
}

async function initializeRoleTemplates(options?: { silentWhenCreated?: boolean }) {
  initializing.value = true
  try {
    const result = await adminApi.initializeRoleTemplates()
    if (!options?.silentWhenCreated) {
      ElMessage.success(result.message)
    }
    const refreshed = await adminApi.getPermissionMatrix()
    applyPermissionMatrix(refreshed)
  } catch (error: any) {
    ElMessage.error(error.message || '初始化角色模板失败')
  } finally {
    initializing.value = false
  }
}

function handlePermissionChange(
  roleId: number,
  modulePath: string,
  operation: OperationType,
  isGranted: boolean | string | number
) {
  const granted = Boolean(isGranted)
  const changeKey = `${roleId}-${modulePath}-${operation}`
  const permissionKey = `${modulePath}.${operation}`
  const baselineGranted = baselinePermissions.value[roleId]?.[permissionKey] ?? false

  const roleRow = permissionRows.value.find((row) => row.role.id === roleId)
  if (roleRow) {
    roleRow.permissions[permissionKey] = granted
  }

  pendingChanges.value = pendingChanges.value.filter(
    (change) => `${change.role_id}-${change.module_path}-${change.operation_type}` !== changeKey
  )

  if (granted !== baselineGranted) {
    pendingChanges.value.push({
      role_id: roleId,
      module_path: modulePath,
      operation_type: operation,
      is_granted: granted
    })
  }
}

function groupByRole(changes: PendingChange[]) {
  return changes.reduce<Record<number, RolePermissionChange[]>>((acc, change) => {
    if (!acc[change.role_id]) {
      acc[change.role_id] = []
    }
    acc[change.role_id].push({
      module_path: change.module_path,
      operation_type: change.operation_type,
      is_granted: change.is_granted
    })
    return acc
  }, {})
}

function roleHasPendingChanges(roleId: number) {
  return pendingChanges.value.some((change) => change.role_id === roleId)
}

async function saveAllChanges() {
  if (!hasChanges.value) {
    ElMessage.info('没有需要保存的变更')
    return
  }

  saving.value = true
  try {
    for (const [roleId, permissions] of Object.entries(groupByRole(pendingChanges.value))) {
      await adminApi.updateRolePermissions(Number(roleId), permissions)
    }
    ElMessage.success(`已保存 ${changedCount.value} 项权限变更`)
    await loadPermissionMatrix()
  } catch (error: any) {
    ElMessage.error(error.message || '保存权限变更失败')
  } finally {
    saving.value = false
  }
}

function resetRoleForm() {
  roleForm.role_key = ''
  roleForm.role_name = ''
  roleForm.applicable_user_type = ''
  roleForm.is_active = true
}

function openCreateRoleDialog() {
  roleDialogMode.value = 'create'
  currentRole.value = null
  resetRoleForm()
  roleDialogVisible.value = true
}

function openEditRoleDialog(role: RoleTagSummary) {
  roleDialogMode.value = 'edit'
  currentRole.value = role
  roleForm.role_key = role.role_key
  roleForm.role_name = role.role_name
  roleForm.applicable_user_type = (role.applicable_user_type || '') as '' | 'internal' | 'supplier'
  roleForm.is_active = role.is_active
  roleDialogVisible.value = true
}

async function saveRoleDialog() {
  try {
    if (roleDialogMode.value === 'create') {
      const created = await adminApi.createRoleTag({
        role_key: roleForm.role_key.trim(),
        role_name: roleForm.role_name.trim(),
        applicable_user_type: roleForm.applicable_user_type || null,
        is_active: roleForm.is_active
      })
      selectedRoleId.value = created.id
      ElMessage.success('角色标签已创建')
    } else if (currentRole.value) {
      await adminApi.updateRoleTag(currentRole.value.id, {
        role_name: roleForm.role_name.trim(),
        description: currentRole.value.description || undefined,
        applicable_user_type: roleForm.applicable_user_type || null,
        is_active: roleForm.is_active
      })
      ElMessage.success('角色标签已更新')
    } else {
      return
    }

    roleDialogVisible.value = false
    await loadPermissionMatrix()
  } catch (error: any) {
    ElMessage.error(error.message || '保存角色标签失败')
  }
}

async function handleDeleteRole(role: RoleTagSummary) {
  try {
    await ElMessageBox.confirm(
      `确认删除角色标签 ${role.role_name}？已分配给用户的角色不能直接删除。`,
      '删除角色标签',
      { type: 'error' }
    )
    await adminApi.deleteRoleTag(role.id)
    ElMessage.success('角色标签已删除')
    await loadPermissionMatrix()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除角色标签失败')
    }
  }
}

function roleTypeLabel(type?: string | null) {
  if (type === 'internal') {
    return '内部员工'
  }
  if (type === 'supplier') {
    return '供应商'
  }
  return '全部账号'
}

onMounted(() => {
  loadPermissionMatrix()
})
</script>

<style scoped>
.permission-management-page {
  min-height: 100%;
}

.panel-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.permission-surface {
  position: relative;
  overflow: hidden;
}

.panel-loading,
.permission-empty {
  padding: 48px 0;
}

.panel-loading {
  text-align: center;
  color: #64748b;
}

.panel-loading p {
  margin-top: 12px;
}

.empty-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}

.permission-layout {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}

.role-sidebar {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-right: 6px;
}

.role-sidebar__filters {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.role-sidebar__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: calc(100vh - 280px);
  overflow-y: auto;
  padding-right: 6px;
}

.role-card {
  text-align: left;
  padding: 16px 18px;
  border-radius: 18px;
  background: #f8fafc;
  border: 1px solid rgba(226, 232, 240, 0.92);
  transition: all 0.2s ease;
}

.role-card:hover,
.role-card--active {
  border-color: rgba(59, 130, 246, 0.55);
  background: #fff;
}

.role-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #0f172a;
}

.role-card__key {
  margin-top: 6px;
  font-size: 12px;
  color: #64748b;
}

.role-card__meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.role-card__tail {
  margin-top: 10px;
  font-size: 12px;
  color: #94a3b8;
}

.role-card__dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: #f59e0b;
  box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.12);
}

.permission-editor {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-top: 52px;
}

.permission-layout--with-alert .permission-editor {
  padding-top: 106px;
}

.permission-surface > .surface-toolbar {
  position: absolute;
  top: 14px;
  right: 16px;
  z-index: 3;
  margin: 0;
}

.permission-surface > .permission-alert {
  position: absolute;
  top: 64px;
  right: 16px;
  z-index: 2;
  width: min(720px, calc(100% - 372px));
  margin: 0;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  padding: 16px 18px;
  border-radius: 18px;
  background: #f8fafc;
  border: 1px solid rgba(226, 232, 240, 0.82);
}

.editor-header h3 {
  margin: 0;
  font-size: 24px;
  color: #0f172a;
}

.editor-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 10px;
  font-size: 12px;
  color: #64748b;
}

.editor-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.permission-groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.permission-group {
  padding: 0;
  border: none;
  background: transparent;
}

.permission-group + .permission-group {
  padding-top: 16px;
  border-top: 1px solid rgba(226, 232, 240, 0.78);
}

.permission-group__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.permission-group__header h4 {
  margin: 0;
  font-size: 16px;
  color: #162033;
}

.permission-group__header span {
  font-size: 12px;
  color: #64748b;
}

.permission-module-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.permission-module {
  padding: 14px 16px;
  border-radius: 18px;
  background: #f8fafc;
  border: 1px solid rgba(226, 232, 240, 0.82);
}

.permission-module__title {
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}

.permission-operations {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
}

.permission-check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 88px;
  font-size: 13px;
  color: #334155;
}

.role-dialog {
  border-radius: 20px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  background: #fff;
  padding: 18px 18px 8px;
}

.permission-alert {
  margin-bottom: 12px;
}

@media (max-width: 1280px) {
  .permission-layout {
    grid-template-columns: 1fr;
  }

  .permission-editor,
  .permission-layout--with-alert .permission-editor {
    padding-top: 0;
  }

  .permission-surface > .surface-toolbar,
  .permission-surface > .permission-alert {
    position: static;
    width: auto;
    margin-bottom: 12px;
  }

  .permission-module-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .panel-actions {
    width: 100%;
  }

  .panel-actions :deep(.el-button) {
    flex: 1;
  }
}
</style>
