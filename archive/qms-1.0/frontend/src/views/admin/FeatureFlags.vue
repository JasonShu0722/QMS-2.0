<template>
  <div class="feature-flags-container page-stage--stack">
    <section class="page-surface page-surface--table feature-flag-surface">
      <div class="feature-flags-header">
        <el-select v-model="environmentFilter" class="w-36" @change="loadFeatureFlags">
          <el-option label="全部环境" value="" />
          <el-option label="正式环境" value="stable" />
          <el-option label="预览环境" value="preview" />
        </el-select>
        <el-button :icon="Refresh" circle @click="loadFeatureFlags" />
      </div>

      <div v-loading="loading">
        <el-table :data="featureFlags" stripe class="w-full">
          <el-table-column prop="feature_name" label="功能名称" min-width="180">
            <template #default="{ row }">
              <div>
                <div class="font-medium">{{ row.feature_name }}</div>
                <div class="text-xs text-gray-500">{{ row.feature_key }}</div>
              </div>
            </template>
          </el-table-column>

          <el-table-column prop="description" label="描述" min-width="240" show-overflow-tooltip />

          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">
              <el-switch v-model="row.is_enabled" :loading="!!toggleLoading[row.id]" @change="handleToggle(row)" />
            </template>
          </el-table-column>

          <el-table-column label="范围" width="120">
            <template #default="{ row }">
              <el-tag :type="row.scope === 'global' ? 'success' : 'warning'">
                {{ row.scope === 'global' ? '全局' : '白名单' }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column label="白名单" width="180">
            <template #default="{ row }">
              <div v-if="row.scope === 'whitelist'" class="text-sm">
                <div>用户 {{ row.whitelist_user_ids?.length || 0 }} 个</div>
                <div>供应商 {{ row.whitelist_supplier_ids?.length || 0 }} 个</div>
              </div>
              <span v-else class="text-gray-400">全部用户</span>
            </template>
          </el-table-column>

          <el-table-column label="环境" width="110">
            <template #default="{ row }">
              <el-tag :type="row.environment === 'stable' ? 'primary' : 'warning'" size="small">
                {{ row.environment === 'stable' ? '正式' : '预览' }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column prop="updated_at" label="更新时间" width="170">
            <template #default="{ row }">
              {{ formatDate(row.updated_at) }}
            </template>
          </el-table-column>

          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{ row }">
              <el-button type="primary" size="small" @click="showConfigDialog(row)">配置</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div v-if="featureFlags.length === 0 && !loading" class="py-8 text-center text-gray-500">
          当前没有功能开关数据。
        </div>
      </div>
    </section>

    <el-dialog
      v-model="configDialogVisible"
      :title="`配置功能开关: ${currentFlag?.feature_name || ''}`"
      width="640px"
      destroy-on-close
    >
      <el-form v-if="currentFlag" :model="configForm" label-width="120px">
        <el-form-item label="功能标识">
          <span class="text-gray-500">{{ currentFlag.feature_key }}</span>
        </el-form-item>

        <el-form-item label="所属环境">
          <el-tag :type="configForm.environment === 'stable' ? 'primary' : 'warning'">
            {{ configForm.environment === 'stable' ? '正式环境' : '预览环境' }}
          </el-tag>
        </el-form-item>

        <el-form-item label="启用状态">
          <el-switch v-model="configForm.is_enabled" />
        </el-form-item>

        <el-form-item label="作用范围">
          <el-radio-group v-model="configForm.scope">
            <el-radio value="global">全局</el-radio>
            <el-radio value="whitelist">白名单</el-radio>
          </el-radio-group>
        </el-form-item>

        <template v-if="configForm.scope === 'whitelist'">
          <el-form-item label="用户白名单">
            <el-select
              v-model="configForm.whitelist_user_ids"
              multiple
              filterable
              collapse-tags
              collapse-tags-tooltip
              placeholder="选择用户"
              style="width: 100%"
            >
              <el-option
                v-for="user in availableUsers"
                :key="user.id"
                :label="`${user.full_name} (${user.username})`"
                :value="user.id"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="供应商白名单">
            <el-select
              v-model="configForm.whitelist_supplier_ids"
              multiple
              filterable
              collapse-tags
              collapse-tags-tooltip
              placeholder="选择供应商"
              style="width: 100%"
            >
              <el-option
                v-for="supplier in availableSuppliers"
                :key="supplier.id"
                :label="supplier.name"
                :value="supplier.id"
              />
            </el-select>
          </el-form-item>
        </template>

        <el-alert
          v-if="configForm.scope === 'global'"
          type="info"
          :closable="false"
          title="全局模式下，命中当前环境的所有用户都会看到该能力。"
        />
        <el-alert
          v-else
          class="mt-3"
          type="warning"
          :closable="false"
          title="白名单模式下，需要至少配置一个用户或供应商。"
        />
      </el-form>

      <template #footer>
        <el-button @click="configDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveConfig">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { adminApi } from '@/api/admin'
import type { FeatureFlag, FeatureFlagUpdateRequest } from '@/types/admin'
import type { User } from '@/types/user'

interface SupplierOption {
  id: number
  name: string
}

const loading = ref(false)
const saving = ref(false)
const environmentFilter = ref<'stable' | 'preview' | ''>('')
const featureFlags = ref<FeatureFlag[]>([])
const toggleLoading = reactive<Record<number, boolean>>({})

const configDialogVisible = ref(false)
const currentFlag = ref<FeatureFlag | null>(null)
const configForm = reactive<FeatureFlagUpdateRequest & { environment: 'stable' | 'preview' }>({
  is_enabled: false,
  scope: 'global',
  whitelist_user_ids: [],
  whitelist_supplier_ids: [],
  environment: 'stable'
})

const availableUsers = ref<User[]>([])
const availableSuppliers = ref<SupplierOption[]>([])

const supplierMap = computed(() => {
  const map = new Map<number, SupplierOption>()
  for (const supplier of availableSuppliers.value) {
    map.set(supplier.id, supplier)
  }
  return map
})

async function loadFeatureFlags() {
  loading.value = true
  try {
    const flags = await adminApi.getFeatureFlags(environmentFilter.value || undefined)
    featureFlags.value = flags
  } catch (error: any) {
    ElMessage.error(error.message || '加载功能开关失败')
  } finally {
    loading.value = false
  }
}

async function loadWhitelistOptions() {
  try {
    const users = await adminApi.getUsers()
    hydrateWhitelistOptions(users)
  } catch (error) {
    console.error('Failed to load whitelist options:', error)
  }
}

function hydrateWhitelistOptions(userList: User[]) {
  availableUsers.value = userList
  const supplierOptions: SupplierOption[] = []

  for (const user of userList) {
    if (!user.supplier_id || !user.supplier_name) {
      continue
    }

    if (!supplierMap.value.has(user.supplier_id)) {
      supplierOptions.push({
        id: user.supplier_id,
        name: user.supplier_name
      })
    }
  }

  availableSuppliers.value = supplierOptions.sort((a, b) => a.name.localeCompare(b.name))
}

async function handleToggle(flag: FeatureFlag) {
  const nextValue = flag.is_enabled
  const previousValue = !nextValue

  try {
    await ElMessageBox.confirm(
      `确认${nextValue ? '启用' : '禁用'}功能 "${flag.feature_name}" 吗？`,
      '确认操作',
      {
        confirmButtonText: '确认',
        cancelButtonText: '取消',
        type: nextValue ? 'success' : 'warning'
      }
    )

    toggleLoading[flag.id] = true
    await adminApi.updateFeatureFlag(flag.id, {
      is_enabled: nextValue,
      scope: flag.scope,
      whitelist_user_ids: flag.whitelist_user_ids || [],
      whitelist_supplier_ids: flag.whitelist_supplier_ids || [],
      environment: flag.environment
    })
    ElMessage.success(`功能已${nextValue ? '启用' : '禁用'}`)
  } catch (error: any) {
    flag.is_enabled = previousValue
    if (error !== 'cancel') {
      ElMessage.error(error.message || '更新功能开关失败')
    }
  } finally {
    toggleLoading[flag.id] = false
  }
}

async function showConfigDialog(flag: FeatureFlag) {
  try {
    currentFlag.value = await adminApi.getFeatureFlagDetail(flag.id)
    configForm.is_enabled = currentFlag.value.is_enabled
    configForm.scope = currentFlag.value.scope
    configForm.whitelist_user_ids = [...(currentFlag.value.whitelist_user_ids || [])]
    configForm.whitelist_supplier_ids = [...(currentFlag.value.whitelist_supplier_ids || [])]
    configForm.environment = currentFlag.value.environment
    configDialogVisible.value = true
  } catch (error: any) {
    ElMessage.error(error.message || '加载功能开关详情失败')
  }
}

async function saveConfig() {
  if (!currentFlag.value) {
    return
  }

  if (
    configForm.scope === 'whitelist' &&
    configForm.is_enabled &&
    (configForm.whitelist_user_ids?.length || 0) === 0 &&
    (configForm.whitelist_supplier_ids?.length || 0) === 0
  ) {
    ElMessage.warning('白名单模式至少需要选择一个用户或供应商')
    return
  }

  saving.value = true
  try {
    await adminApi.updateFeatureFlag(currentFlag.value.id, {
      is_enabled: configForm.is_enabled,
      scope: configForm.scope,
      whitelist_user_ids: configForm.scope === 'whitelist' ? configForm.whitelist_user_ids : [],
      whitelist_supplier_ids: configForm.scope === 'whitelist' ? configForm.whitelist_supplier_ids : [],
      environment: configForm.environment
    })
    ElMessage.success('功能开关已保存')
    configDialogVisible.value = false
    await loadFeatureFlags()
  } catch (error: any) {
    ElMessage.error(error.message || '保存配置失败')
  } finally {
    saving.value = false
  }
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

onMounted(async () => {
  await Promise.all([loadFeatureFlags(), loadWhitelistOptions()])
})
</script>

<style scoped>
.feature-flags-container {
  min-height: 100%;
}

.feature-flags-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.feature-flag-surface {
  overflow: hidden;
}
</style>
