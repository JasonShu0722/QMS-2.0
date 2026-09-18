<template>
  <div class="user-management-page page-stage--stack">
    <section class="page-surface page-surface--table management-surface">
      <div class="management-tabs-shell">
        <div class="management-tabs-shell__actions">
          <el-button
            v-if="activeTab === 'directory'"
            type="primary"
            :icon="Plus"
            @click="openCreateDialog"
          >
            创建用户
          </el-button>
          <el-button :icon="Refresh" circle @click="refreshAll" />
        </div>

        <el-tabs v-model="activeTab" class="management-tabs">
        <el-tab-pane label="用户审批" name="approval">
          <div v-if="loadingPending" class="panel-loading">
            <el-icon class="is-loading text-4xl"><Loading /></el-icon>
            <p>加载中...</p>
          </div>

          <el-empty v-else-if="pendingUsers.length === 0" description="暂无待审批用户" />

          <el-table
            v-else
            :data="pendingUsers"
            stripe
            class="w-full"
            empty-text="暂无待审批用户"
          >
            <el-table-column label="用户" min-width="240">
              <template #default="{ row }">
                <div class="user-summary">
                  <div class="user-summary__name">{{ row.full_name }}</div>
                  <div class="user-summary__meta">{{ row.username }}</div>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="user_type" label="类型" width="110">
              <template #default="{ row }">
                <el-tag :type="row.user_type === 'internal' ? 'primary' : 'success'">
                  {{ row.user_type === 'internal' ? '内部员工' : '供应商' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="email" label="邮箱" min-width="220" />
            <el-table-column prop="phone" label="电话" width="140" />
            <el-table-column label="部门/供应商" min-width="180">
              <template #default="{ row }">
                {{ row.user_type === 'internal' ? row.department || '-' : row.supplier_name || '-' }}
              </template>
            </el-table-column>
            <el-table-column prop="position" label="岗位" min-width="140" />
            <el-table-column prop="created_at" label="申请时间" width="180">
              <template #default="{ row }">
                {{ formatDate(row.created_at) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="200" fixed="right">
              <template #default="{ row }">
                <div class="inline-actions">
                  <el-button
                    type="success"
                    size="small"
                    :loading="actionLoading[row.id]"
                    @click="handleApprove(row)"
                  >
                    批准
                  </el-button>
                  <el-button
                    type="danger"
                    size="small"
                    :loading="actionLoading[row.id]"
                    @click="openRejectDialog(row)"
                  >
                    拒绝
                  </el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="用户清单" name="directory">
          <section class="directory-toolbar">
            <div class="filter-row">
              <el-input
                v-model="userFilters.keyword"
                clearable
                placeholder="姓名、账号或邮箱"
                :prefix-icon="Search"
                @keyup.enter="loadUsers"
              />
              <el-input v-model="userFilters.department" clearable placeholder="部门" />
              <el-input v-model="userFilters.position" clearable placeholder="岗位" />
              <el-select v-model="userFilters.role_tag_id" clearable placeholder="全部角色">
                <el-option
                  v-for="role in roleOptions"
                  :key="role.id"
                  :label="role.role_name"
                  :value="role.id"
                />
              </el-select>
              <el-select v-model="userFilters.status" clearable placeholder="全部状态">
                <el-option label="启用" value="active" />
                <el-option label="冻结" value="frozen" />
                <el-option label="驳回" value="rejected" />
              </el-select>
              <div class="filter-row__actions">
                <el-button type="primary" @click="loadUsers">查询</el-button>
                <el-button @click="resetFilters">重置</el-button>
              </div>
            </div>
          </section>

          <div v-if="loadingUsers" class="panel-loading">
            <el-icon class="is-loading text-4xl"><Loading /></el-icon>
            <p>加载中...</p>
          </div>

            <el-table
              v-else
              :data="users"
              stripe
              class="directory-table"
              empty-text="暂无用户数据"
            >
              <el-table-column label="用户" min-width="380" fixed="left">
                <template #default="{ row }">
                  <div class="directory-user">
                    <span class="directory-user__name">{{ row.full_name }}</span>
                    <el-tag size="small" :type="row.user_type === 'internal' ? 'primary' : 'success'" effect="plain">
                      {{ row.user_type === 'internal' ? '内部员工' : '供应商' }}
                    </el-tag>
                    <span class="directory-user__meta directory-user__meta--mono">{{ row.username }}</span>
                    <span class="directory-user__meta">
                      {{ row.user_type === 'internal' ? row.department || '-' : row.supplier_name || '-' }}
                    </span>
                    <span class="directory-user__meta">{{ row.position || '-' }}</span>
                    <div class="directory-user__badges directory-user__badges--inline">
                      <el-tag
                        v-for="environment in parseEnvironments(row.allowed_environments)"
                        :key="`${row.id}-${environment}`"
                      size="small"
                      effect="plain"
                      type="info"
                    >
                      {{ environmentLabel(environment) }}
                    </el-tag>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="角色标签" min-width="240">
              <template #default="{ row }">
                <div class="role-tag-list">
                  <el-tag
                    v-for="role in row.role_tags || []"
                    :key="role.id"
                    size="small"
                    :type="role.is_active ? 'info' : 'warning'"
                  >
                    {{ role.role_name }}
                  </el-tag>
                  <span v-if="!row.role_tags?.length" class="text-xs text-gray-400">未分配</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                <el-tag :type="statusTagType(row.status)">
                  {{ statusLabel(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="last_login_at" label="最近登录" width="180">
              <template #default="{ row }">
                {{ row.last_login_at ? formatDate(row.last_login_at) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="220" fixed="right" align="right">
              <template #default="{ row }">
                <div class="directory-actions">
                  <el-button link type="primary" @click="openEditDialog(row)">编辑</el-button>
                  <el-button link type="primary" @click="openRoleDialog(row)">分配角色</el-button>
                  <el-dropdown @command="handleActionCommand($event, row)">
                    <el-button link type="primary">
                      更多
                      <el-icon class="ml-1"><MoreFilled /></el-icon>
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="reset-password">重置密码</el-dropdown-item>
                        <el-dropdown-item :command="row.status === 'frozen' ? 'unfreeze' : 'freeze'">
                          {{ row.status === 'frozen' ? '解冻账户' : '冻结账户' }}
                        </el-dropdown-item>
                        <el-dropdown-item command="delete">删除账户</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        </el-tabs>
      </div>
    </section>

    <el-dialog v-model="rejectDialogVisible" title="拒绝用户注册" width="500px">
      <el-form :model="rejectForm" label-width="90px">
        <el-form-item label="账号">
          <span>{{ currentPendingUser?.username }}</span>
        </el-form-item>
        <el-form-item label="姓名">
          <span>{{ currentPendingUser?.full_name }}</span>
        </el-form-item>
        <el-form-item label="拒绝原因" required>
          <el-input
            v-model="rejectForm.reason"
            type="textarea"
            :rows="4"
            maxlength="500"
            show-word-limit
            placeholder="请输入拒绝原因"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rejectDialogVisible = false">取消</el-button>
        <el-button type="danger" :disabled="!rejectForm.reason.trim()" @click="confirmReject">
          确认拒绝
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editDialogVisible" title="编辑用户信息" width="560px">
      <el-form :model="editForm" label-width="100px">
        <el-form-item label="姓名">
          <el-input v-model="editForm.full_name" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="editForm.email" />
        </el-form-item>
        <el-form-item label="电话">
          <el-input v-model="editForm.phone" />
        </el-form-item>
        <el-form-item v-if="currentUser?.user_type === 'internal'" label="部门">
          <el-input v-model="editForm.department" />
        </el-form-item>
        <el-form-item label="岗位">
          <el-input v-model="editForm.position" />
        </el-form-item>
        <el-form-item label="访问环境">
          <el-checkbox-group v-model="editForm.environments">
            <el-checkbox label="stable">正式版</el-checkbox>
            <el-checkbox label="preview">预览版</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="editForm.environments.length === 0" @click="saveUserEdit">
          保存
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="roleDialogVisible" title="分配角色标签" width="520px">
      <el-form label-width="100px">
        <el-form-item label="用户">
          <span>{{ currentUser?.full_name }} / {{ currentUser?.username }}</span>
        </el-form-item>
        <el-form-item label="角色标签">
          <el-select
            v-model="selectedRoleTagIds"
            multiple
            collapse-tags
            collapse-tags-tooltip
            placeholder="请选择角色标签"
            style="width: 100%"
          >
            <el-option
              v-for="role in assignableRoles"
              :key="role.id"
              :label="role.role_name"
              :value="role.id"
            >
              <div class="role-option">
                <span>{{ role.role_name }}</span>
                <span class="role-option__key">{{ role.role_key }}</span>
              </div>
            </el-option>
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="roleDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveUserRoles">保存</el-button>
      </template>
    </el-dialog>
    <el-dialog
      v-model="createDialogVisible"
      title="创建用户"
      width="780px"
      destroy-on-close
      @closed="resetCreateDialog"
    >
      <el-tabs v-model="createMode" class="create-user-tabs">
        <el-tab-pane label="单条创建" name="single">
          <el-form :model="singleCreateForm" label-width="92px" class="create-form">
            <el-form-item label="用户类型">
              <el-radio-group
                v-model="singleCreateForm.user_type"
                @change="handleSingleUserTypeChange"
              >
                <el-radio-button label="internal">内部员工</el-radio-button>
                <el-radio-button label="supplier">供应商</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <div class="create-form-grid">
              <el-form-item label="账号" required>
                <el-input v-model="singleCreateForm.username" />
              </el-form-item>
              <el-form-item label="姓名" required>
                <el-input v-model="singleCreateForm.full_name" />
              </el-form-item>
              <el-form-item label="邮箱" required>
                <el-input v-model="singleCreateForm.email" />
              </el-form-item>
              <el-form-item label="电话">
                <el-input v-model="singleCreateForm.phone" />
              </el-form-item>
              <el-form-item v-if="singleCreateForm.user_type === 'internal'" label="部门" required>
                <el-input v-model="singleCreateForm.department" />
              </el-form-item>
              <el-form-item v-else label="供应商" required>
                <el-select
                  v-model="singleCreateForm.supplier_identifier"
                  filterable
                  remote
                  clearable
                  reserve-keyword
                  placeholder="搜索供应商"
                  :remote-method="loadSupplierOptions"
                  :loading="supplierSearchLoading"
                >
                  <el-option
                    v-for="supplier in supplierOptions"
                    :key="supplier.id"
                    :label="`${supplier.name} (${supplier.code})`"
                    :value="String(supplier.id)"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="岗位">
                <el-input v-model="singleCreateForm.position" />
              </el-form-item>
              <el-form-item label="角色标签" class="create-form-grid__full">
                <el-select
                  v-model="singleCreateForm.role_tag_ids"
                  multiple
                  clearable
                  collapse-tags
                  collapse-tags-tooltip
                  placeholder="请选择角色标签"
                >
                  <el-option
                    v-for="role in singleCreateAssignableRoles"
                    :key="role.id"
                    :label="role.role_name"
                    :value="role.id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="访问环境" class="create-form-grid__full" required>
                <el-checkbox-group v-model="singleCreateForm.environments">
                  <el-checkbox label="stable">正式版</el-checkbox>
                  <el-checkbox label="preview">预览版</el-checkbox>
                </el-checkbox-group>
              </el-form-item>
            </div>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="批量创建" name="batch">
          <el-form :model="batchCreateForm" label-width="92px" class="create-form">
            <el-form-item label="用户类型">
              <el-radio-group
                v-model="batchCreateForm.user_type"
                @change="handleBatchUserTypeChange"
              >
                <el-radio-button label="internal">内部员工</el-radio-button>
                <el-radio-button label="supplier">供应商</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="角色标签">
              <el-select
                v-model="batchCreateForm.role_tag_ids"
                multiple
                clearable
                collapse-tags
                collapse-tags-tooltip
                placeholder="请选择角色标签"
              >
                <el-option
                  v-for="role in batchCreateAssignableRoles"
                  :key="role.id"
                  :label="role.role_name"
                  :value="role.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="访问环境" required>
              <el-checkbox-group v-model="batchCreateForm.environments">
                <el-checkbox label="stable">正式版</el-checkbox>
                <el-checkbox label="preview">预览版</el-checkbox>
              </el-checkbox-group>
            </el-form-item>
            <el-form-item label="批量内容" required class="batch-content-form-item">
              <div class="batch-content-shell">
                <div class="batch-content-shell__header">
                  <el-popover
                    placement="left-start"
                    :width="420"
                    trigger="click"
                    popper-class="batch-guide-popover"
                  >
                    <template #reference>
                      <el-button
                        link
                        circle
                        class="batch-help-trigger"
                        :icon="QuestionFilled"
                      />
                    </template>
                    <div class="batch-guide">
                      <div class="batch-guide__title">{{ batchHelpTitle }}</div>
                      <div class="batch-guide__section">
                        <div class="batch-guide__section-title">账号区分</div>
                        <p>{{ batchHelpAccountTypeText }}</p>
                      </div>
                      <div class="batch-guide__section">
                        <div class="batch-guide__section-title">推荐方法</div>
                        <p>直接从 Excel 复制 6 列数据后粘贴进来，系统支持按列复制产生的 Tab 分隔内容。</p>
                      </div>
                      <div class="batch-guide__section">
                        <div class="batch-guide__section-title">字段顺序</div>
                        <p>{{ batchHelpColumnsText }}</p>
                      </div>
                      <div class="batch-guide__section">
                        <div class="batch-guide__section-title">填写说明</div>
                        <p>{{ batchHelpNotesText }}</p>
                      </div>
                      <div class="batch-guide__section">
                        <div class="batch-guide__section-title">示例</div>
                        <pre class="batch-guide__example">{{ batchHelpExample }}</pre>
                      </div>
                    </div>
                  </el-popover>
                </div>
                <el-input
                  v-model="batchCreateForm.content"
                  type="textarea"
                  :rows="10"
                  :placeholder="batchPlaceholder"
                />
              </div>
            </el-form-item>
          </el-form>
        </el-tab-pane>
      </el-tabs>

      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="createSubmitting" @click="submitCreate">
          {{ createMode === 'single' ? '创建用户' : '批量创建' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="creationResultVisible" title="创建结果" width="720px">
      <el-table :data="creationResults" stripe empty-text="暂无结果">
        <el-table-column label="行号" width="80">
          <template #default="{ row }">
            {{ row.row_number }}
          </template>
        </el-table-column>
        <el-table-column label="用户" min-width="220">
          <template #default="{ row }">
            <div class="user-summary">
              <div class="user-summary__name">{{ row.user.full_name }}</div>
              <div class="user-summary__meta">{{ row.user.username }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="临时密码" min-width="180">
          <template #default="{ row }">
            <span class="temporary-password">{{ row.temporary_password }}</span>
          </template>
        </el-table-column>
        <el-table-column label="邮件通知" width="120">
          <template #default="{ row }">
            <el-tag :type="row.email_sent ? 'success' : 'info'" effect="plain">
              {{ row.email_sent ? '已发送' : '未发送' }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button type="primary" @click="creationResultVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading, MoreFilled, Plus, QuestionFilled, Refresh, Search } from '@element-plus/icons-vue'

import { adminApi } from '@/api/admin'
import type { User, UserStatus, UserType } from '@/types/user'
import type {
  AdminBulkUserCreateItem,
  AdminBulkUserCreateItemResponse,
  AdminBulkUserCreateRequest,
  AdminUserCreateRequest,
  SupplierMaster,
  UserListQuery,
  UserUpdateRequest
} from '@/types/admin'
import type { RoleTagSummary } from '@/types/role'
import { formatDateTimeInBeijing } from '@/utils/dateTime'

type EnvironmentKey = 'stable' | 'preview'
type CreateMode = 'single' | 'batch'

const activeTab = ref<'approval' | 'directory'>('approval')
const loadingPending = ref(false)
const loadingUsers = ref(false)
const pendingUsers = ref<User[]>([])
const users = ref<User[]>([])
const roleOptions = ref<RoleTagSummary[]>([])
const actionLoading = reactive<Record<number, boolean>>({})

const userFilters = reactive<UserListQuery>({
  keyword: '',
  department: '',
  position: '',
  status: undefined,
  role_tag_id: undefined
})

const rejectDialogVisible = ref(false)
const currentPendingUser = ref<User | null>(null)
const rejectForm = reactive({
  reason: ''
})

const editDialogVisible = ref(false)
const roleDialogVisible = ref(false)
const currentUser = ref<User | null>(null)
const selectedRoleTagIds = ref<number[]>([])
const editForm = reactive<{
  full_name: string
  email: string
  phone: string
  department: string
  position: string
  environments: EnvironmentKey[]
}>({
  full_name: '',
  email: '',
  phone: '',
  department: '',
  position: '',
  environments: ['stable']
})

const createDialogVisible = ref(false)
const createMode = ref<CreateMode>('single')
const createSubmitting = ref(false)
const supplierSearchLoading = ref(false)
const supplierOptions = ref<SupplierMaster[]>([])
const creationResultVisible = ref(false)
const creationResults = ref<AdminBulkUserCreateItemResponse[]>([])

const singleCreateForm = reactive<{
  username: string
  full_name: string
  email: string
  phone: string
  user_type: UserType
  department: string
  position: string
  supplier_identifier: string
  environments: EnvironmentKey[]
  role_tag_ids: number[]
}>({
  username: '',
  full_name: '',
  email: '',
  phone: '',
  user_type: 'internal',
  department: '',
  position: '',
  supplier_identifier: '',
  environments: ['stable'],
  role_tag_ids: []
})

const batchCreateForm = reactive<{
  user_type: UserType
  environments: EnvironmentKey[]
  role_tag_ids: number[]
  content: string
}>({
  user_type: 'internal',
  environments: ['stable'],
  role_tag_ids: [],
  content: ''
})

function filterRoleOptions(userType?: UserType) {
  return roleOptions.value.filter((role) => {
    if (!role.is_active) {
      return false
    }
    return !role.applicable_user_type || role.applicable_user_type === userType
  })
}

const assignableRoles = computed(() => filterRoleOptions(currentUser.value?.user_type))
const singleCreateAssignableRoles = computed(() => filterRoleOptions(singleCreateForm.user_type))
const batchCreateAssignableRoles = computed(() => filterRoleOptions(batchCreateForm.user_type))
const batchPlaceholder = computed(() =>
  batchCreateForm.user_type === 'internal'
    ? '账号,姓名,邮箱,电话,部门,岗位'
    : '账号,姓名,邮箱,电话,供应商代码(推荐)/名称,岗位'
)
const batchHelpTitle = computed(() =>
  batchCreateForm.user_type === 'internal' ? '内部员工批量创建指引' : '供应商账号批量创建指引'
)
const batchHelpColumnsText = computed(() =>
  batchCreateForm.user_type === 'internal'
    ? '账号、姓名、邮箱、电话、部门、岗位'
    : '账号、姓名、邮箱、电话、供应商代码（推荐）/名称、岗位'
)
const batchHelpAccountTypeText = computed(() =>
  batchCreateForm.user_type === 'internal'
    ? '当前是内部员工批量创建。第 5 列必须填写部门，系统会按内部账号处理。'
    : '当前是供应商账号批量创建。供应商账号统一由管理员创建，第 5 列请优先填写已存在的供应商代码，也兼容供应商名称或 ID。'
)
const batchHelpNotesText = computed(() =>
  batchCreateForm.user_type === 'internal'
    ? '每行一位用户，可保留首行表头；电话和岗位允许留空，但要保留分隔位。'
    : '每行一位用户，可保留首行表头；供应商标识会自动关联到供应商基础信息。若同名供应商不唯一，系统会要求改用供应商代码。电话和岗位允许留空，但要保留分隔位。'
)
const batchHelpExample = computed(() =>
  batchCreateForm.user_type === 'internal'
    ? [
        'username,full_name,email,phone,department,position',
        'zhangsan,张三,zhangsan@example.com,13800000000,质量管理部,体系工程师',
        'lisi,李四,lisi@example.com,,质量管理部,检验员'
      ].join('\n')
    : [
        'username,full_name,email,phone,supplier_identifier,position',
        'supplier_01,王五,wangwu@supplier.com,13900000000,SUP001,质量接口人',
        'supplier_02,赵六,zhaoliu@supplier.com,,Northwind Components,售后工程师'
      ].join('\n')
)

async function loadRoleTags() {
  try {
    roleOptions.value = await adminApi.getRoleTags({ include_inactive: true })
  } catch (error: any) {
    ElMessage.error(error.message || '加载角色标签失败')
  }
}

async function loadPendingUsers() {
  loadingPending.value = true
  try {
    pendingUsers.value = await adminApi.getPendingUsers()
  } catch (error: any) {
    ElMessage.error(error.message || '加载待审批用户失败')
  } finally {
    loadingPending.value = false
  }
}

async function loadUsers() {
  loadingUsers.value = true
  try {
    const params: UserListQuery = {
      keyword: userFilters.keyword?.trim() || undefined,
      department: userFilters.department?.trim() || undefined,
      position: userFilters.position?.trim() || undefined,
      status: userFilters.status,
      role_tag_id: userFilters.role_tag_id
    }
    users.value = await adminApi.getUsers(params)
  } catch (error: any) {
    ElMessage.error(error.message || '加载用户清单失败')
  } finally {
    loadingUsers.value = false
  }
}

async function refreshAll() {
  await Promise.all([loadPendingUsers(), loadUsers(), loadRoleTags()])
}

function resetFilters() {
  userFilters.keyword = ''
  userFilters.department = ''
  userFilters.position = ''
  userFilters.status = undefined
  userFilters.role_tag_id = undefined
  loadUsers()
}

async function handleApprove(user: User) {
  try {
    await ElMessageBox.confirm(
      `确认批准 ${user.full_name}（${user.username}）的注册申请？`,
      '确认批准',
      { type: 'success' }
    )
    actionLoading[user.id] = true
    await adminApi.approveUser(user.id)
    ElMessage.success('用户已批准')
    await Promise.all([loadPendingUsers(), loadUsers()])
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '批准用户失败')
    }
  } finally {
    actionLoading[user.id] = false
  }
}

function openRejectDialog(user: User) {
  currentPendingUser.value = user
  rejectForm.reason = ''
  rejectDialogVisible.value = true
}

async function confirmReject() {
  if (!currentPendingUser.value || !rejectForm.reason.trim()) {
    return
  }

  try {
    await adminApi.rejectUser(currentPendingUser.value.id, rejectForm.reason.trim())
    ElMessage.success('用户已拒绝')
    rejectDialogVisible.value = false
    await Promise.all([loadPendingUsers(), loadUsers()])
  } catch (error: any) {
    ElMessage.error(error.message || '拒绝用户失败')
  }
}

function openEditDialog(user: User) {
  currentUser.value = user
  editForm.full_name = user.full_name
  editForm.email = user.email
  editForm.phone = user.phone || ''
  editForm.department = user.department || ''
  editForm.position = user.position || ''
  editForm.environments = parseEnvironments(user.allowed_environments)
  editDialogVisible.value = true
}

async function saveUserEdit() {
  if (!currentUser.value) {
    return
  }

  const payload: UserUpdateRequest = {
    full_name: editForm.full_name.trim(),
    email: editForm.email.trim(),
    phone: editForm.phone.trim() || undefined,
    department: currentUser.value.user_type === 'internal' ? editForm.department.trim() || undefined : undefined,
    position: editForm.position.trim() || undefined,
    allowed_environments: editForm.environments.join(',')
  }

  try {
    await adminApi.updateUser(currentUser.value.id, payload)
    ElMessage.success('用户信息已更新')
    editDialogVisible.value = false
    await loadUsers()
  } catch (error: any) {
    ElMessage.error(error.message || '更新用户失败')
  }
}

function openRoleDialog(user: User) {
  currentUser.value = user
  selectedRoleTagIds.value = (user.role_tags || []).map((role) => role.id)
  roleDialogVisible.value = true
}

async function saveUserRoles() {
  if (!currentUser.value) {
    return
  }

  try {
    await adminApi.assignUserRoles(currentUser.value.id, selectedRoleTagIds.value)
    ElMessage.success('角色标签已保存')
    roleDialogVisible.value = false
    await Promise.all([loadUsers(), loadRoleTags()])
  } catch (error: any) {
    ElMessage.error(error.message || '保存角色标签失败')
  }
}

function openCreateDialog() {
  resetCreateDialog()
  createDialogVisible.value = true
}

function resetCreateDialog() {
  createMode.value = 'single'
  singleCreateForm.username = ''
  singleCreateForm.full_name = ''
  singleCreateForm.email = ''
  singleCreateForm.phone = ''
  singleCreateForm.user_type = 'internal'
  singleCreateForm.department = ''
  singleCreateForm.position = ''
  singleCreateForm.supplier_identifier = ''
  singleCreateForm.environments = ['stable']
  singleCreateForm.role_tag_ids = []

  batchCreateForm.user_type = 'internal'
  batchCreateForm.environments = ['stable']
  batchCreateForm.role_tag_ids = []
  batchCreateForm.content = ''

  supplierOptions.value = []
  supplierSearchLoading.value = false
  createSubmitting.value = false
}

function handleSingleUserTypeChange(userType: string | number | boolean) {
  const normalizedUserType = userType as UserType
  singleCreateForm.user_type = normalizedUserType
  singleCreateForm.role_tag_ids = []
  if (normalizedUserType === 'internal') {
    singleCreateForm.supplier_identifier = ''
  } else {
    singleCreateForm.department = ''
  }
}

function handleBatchUserTypeChange(userType: string | number | boolean) {
  batchCreateForm.user_type = userType as UserType
  batchCreateForm.role_tag_ids = []
}

async function loadSupplierOptions(query: string) {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    supplierOptions.value = []
    return
  }

  supplierSearchLoading.value = true
  try {
    supplierOptions.value = await adminApi.getSuppliers({
      keyword: normalizedQuery,
      status: 'active'
    })
  } catch (error: any) {
    ElMessage.error(error.message || '搜索供应商失败')
  } finally {
    supplierSearchLoading.value = false
  }
}

function normalizeEnvironments(environments: EnvironmentKey[]) {
  return environments.join(',')
}

function validateSingleCreateForm() {
  if (!singleCreateForm.username.trim()) {
    ElMessage.error('请填写账号')
    return false
  }
  if (!singleCreateForm.full_name.trim()) {
    ElMessage.error('请填写姓名')
    return false
  }
  if (!singleCreateForm.email.trim()) {
    ElMessage.error('请填写邮箱')
    return false
  }
  if (singleCreateForm.user_type === 'internal' && !singleCreateForm.department.trim()) {
    ElMessage.error('请填写部门')
    return false
  }
  if (singleCreateForm.user_type === 'supplier' && !singleCreateForm.supplier_identifier.trim()) {
    ElMessage.error('请选择供应商')
    return false
  }
  if (singleCreateForm.environments.length === 0) {
    ElMessage.error('请至少选择一个访问环境')
    return false
  }
  return true
}

function buildSingleCreateResults(user: User, temporaryPassword: string, emailSent: boolean) {
  creationResults.value = [
    {
      row_number: 1,
      user,
      temporary_password: temporaryPassword,
      email_sent: emailSent
    }
  ]
}

async function submitSingleCreate() {
  if (!validateSingleCreateForm()) {
    return
  }

  const payload: AdminUserCreateRequest = {
    username: singleCreateForm.username.trim(),
    full_name: singleCreateForm.full_name.trim(),
    email: singleCreateForm.email.trim(),
    phone: singleCreateForm.phone.trim() || undefined,
    department:
      singleCreateForm.user_type === 'internal' ? singleCreateForm.department.trim() || undefined : undefined,
    position: singleCreateForm.position.trim() || undefined,
    supplier_identifier:
      singleCreateForm.user_type === 'supplier'
        ? singleCreateForm.supplier_identifier.trim() || undefined
        : undefined,
    user_type: singleCreateForm.user_type,
    allowed_environments: normalizeEnvironments(singleCreateForm.environments),
    role_tag_ids: [...singleCreateForm.role_tag_ids]
  }

  createSubmitting.value = true
  try {
    const response = await adminApi.createUser(payload)
    createDialogVisible.value = false
    buildSingleCreateResults(response.user, response.temporary_password, response.email_sent)
    creationResultVisible.value = true
    ElMessage.success('用户已创建')
    await Promise.all([loadUsers(), loadRoleTags()])
  } catch (error: any) {
    ElMessage.error(error.message || '创建用户失败')
  } finally {
    createSubmitting.value = false
  }
}

function isLikelyHeaderRow(cells: string[]) {
  const firstCell = (cells[0] || '').toLowerCase()
  return firstCell.includes('username') || firstCell.includes('账号') || firstCell.includes('用户名')
}

function parseBulkCreateRows(): { items: AdminBulkUserCreateItem[]; errors: string[] } {
  const lines = batchCreateForm.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const items: AdminBulkUserCreateItem[] = []
  const errors: string[] = []

  lines.forEach((line, index) => {
    const rowNumber = index + 1
    const delimiter = line.includes('\t') ? '\t' : ','
    const cells = line.split(delimiter).map((item) => item.trim())

    if (isLikelyHeaderRow(cells)) {
      return
    }

    if (cells.length !== 6) {
      errors.push(`第 ${rowNumber} 行字段数量不正确`)
      return
    }

    const [username, fullName, email, phone, organizationValue, position] = cells

    if (!username || !fullName || !email) {
      errors.push(`第 ${rowNumber} 行账号、姓名、邮箱不能为空`)
      return
    }

    if (!organizationValue) {
      errors.push(
        `第 ${rowNumber} 行${batchCreateForm.user_type === 'internal' ? '部门' : '供应商标识'}不能为空`
      )
      return
    }

    items.push({
      username,
      full_name: fullName,
      email,
      phone: phone || undefined,
      department: batchCreateForm.user_type === 'internal' ? organizationValue : undefined,
      position: position || undefined,
      supplier_identifier: batchCreateForm.user_type === 'supplier' ? organizationValue : undefined
    })
  })

  if (items.length === 0 && errors.length === 0) {
    errors.push('请填写批量内容')
  }

  return { items, errors }
}

async function submitBulkCreate() {
  if (batchCreateForm.environments.length === 0) {
    ElMessage.error('请至少选择一个访问环境')
    return
  }

  const { items, errors } = parseBulkCreateRows()
  if (errors.length > 0) {
    await ElMessageBox.alert(errors.join('<br/>'), '批量创建校验', {
      dangerouslyUseHTMLString: true,
      confirmButtonText: '知道了'
    })
    return
  }

  const payload: AdminBulkUserCreateRequest = {
    user_type: batchCreateForm.user_type,
    allowed_environments: normalizeEnvironments(batchCreateForm.environments),
    role_tag_ids: [...batchCreateForm.role_tag_ids],
    items
  }

  createSubmitting.value = true
  try {
    const response = await adminApi.bulkCreateUsers(payload)
    createDialogVisible.value = false
    creationResults.value = response.results
    creationResultVisible.value = true
    ElMessage.success(`已创建 ${response.created_count} 个用户`)
    await Promise.all([loadUsers(), loadRoleTags()])
  } catch (error: any) {
    ElMessage.error(error.message || '批量创建失败')
  } finally {
    createSubmitting.value = false
  }
}

async function submitCreate() {
  if (createMode.value === 'single') {
    await submitSingleCreate()
    return
  }
  await submitBulkCreate()
}

async function handleFreeze(user: User) {
  try {
    const result = (await ElMessageBox.prompt(
      `请输入冻结 ${user.full_name} 的原因`,
      '冻结账户',
      {
        inputPlaceholder: '可选，建议填写原因',
        confirmButtonText: '确认冻结',
        cancelButtonText: '取消'
      }
    )) as { value?: string }
    await adminApi.freezeUser(user.id, result.value?.trim() || undefined)
    ElMessage.success('用户已冻结')
    await loadUsers()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '冻结用户失败')
    }
  }
}

async function handleUnfreeze(user: User) {
  try {
    await ElMessageBox.confirm(`确认解冻 ${user.full_name}？`, '解冻账户', { type: 'warning' })
    await adminApi.unfreezeUser(user.id)
    ElMessage.success('用户已解冻')
    await loadUsers()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '解冻用户失败')
    }
  }
}

async function handleResetPassword(user: User) {
  try {
    await ElMessageBox.confirm(`确认重置 ${user.full_name} 的登录密码？`, '重置密码', { type: 'warning' })
    const result = await adminApi.resetUserPassword(user.id)
    await ElMessageBox.alert(`临时密码：${result.temporary_password}`, '密码已重置', {
      confirmButtonText: '知道了'
    })
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '重置密码失败')
    }
  }
}

async function handleDelete(user: User) {
  try {
    await ElMessageBox.confirm(
      `确认删除 ${user.full_name}（${user.username}）？删除后不可恢复。`,
      '删除用户',
      { type: 'error' }
    )
    await adminApi.deleteUser(user.id)
    ElMessage.success('用户已删除')
    await loadUsers()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除用户失败')
    }
  }
}

async function handleActionCommand(
  command: string | number | Record<string, unknown>,
  user: User
) {
  const action = String(command)

  if (action === 'reset-password') {
    await handleResetPassword(user)
    return
  }
  if (action === 'freeze') {
    await handleFreeze(user)
    return
  }
  if (action === 'unfreeze') {
    await handleUnfreeze(user)
    return
  }
  if (action === 'delete') {
    await handleDelete(user)
  }
}

function parseEnvironments(raw?: string): EnvironmentKey[] {
  const parsed = (raw || 'stable')
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is EnvironmentKey => item === 'stable' || item === 'preview')

  return parsed.length > 0 ? parsed : ['stable']
}

function environmentLabel(environment: EnvironmentKey) {
  return environment === 'stable' ? '正式版' : '预览版'
}

function statusLabel(status: UserStatus) {
  return {
    active: '启用',
    frozen: '冻结',
    pending: '待审批',
    rejected: '驳回'
  }[status]
}

function statusTagType(status: UserStatus) {
  return {
    active: 'success',
    frozen: 'warning',
    pending: 'info',
    rejected: 'danger'
  }[status]
}

function formatDate(dateString: string) {
  return formatDateTimeInBeijing(dateString)
}

onMounted(() => {
  refreshAll()
})
</script>

<style scoped>
.user-management-page {
  min-height: 100%;
}

.management-tabs :deep(.el-tabs__header) {
  margin-bottom: 16px;
  padding-right: 148px;
}

.management-surface {
  overflow: hidden;
}

.management-tabs-shell {
  position: relative;
}

.management-tabs-shell__actions {
  position: absolute;
  top: 4px;
  right: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 10px;
}

.directory-toolbar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0;
  margin-bottom: 16px;
}

.filter-row {
  display: grid;
  grid-template-columns: 2fr repeat(4, minmax(0, 1fr)) auto;
  gap: 12px;
  align-items: center;
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

.directory-table :deep(.el-table__cell) {
  padding-top: 12px;
  padding-bottom: 12px;
}

.panel-loading {
  padding: 48px 0;
  text-align: center;
  color: #64748b;
}

.panel-loading p {
  margin-top: 12px;
}

.user-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.directory-user {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 28px;
}

.user-summary__name,
.directory-user__name {
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
}

.user-summary__meta,
.directory-user__meta {
  font-size: 12px;
  color: #64748b;
  line-height: 1.4;
}

.directory-user__meta--mono {
  font-family: 'Segoe UI', 'PingFang SC', sans-serif;
  color: #475569;
}

.directory-user__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.directory-user__badges--inline {
  align-items: center;
}

.role-tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 28px;
  align-items: center;
}

.inline-actions,
.directory-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
}

.role-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.role-option__key {
  font-size: 12px;
  color: #94a3b8;
}

.create-user-tabs :deep(.el-tabs__header) {
  margin-bottom: 18px;
}

.create-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}

.create-form-grid__full {
  grid-column: 1 / -1;
}

.create-form :deep(.el-select),
.create-form :deep(.el-input),
.create-form :deep(.el-textarea) {
  width: 100%;
}

.batch-help-trigger {
  padding: 0;
  width: 18px;
  height: 18px;
  color: #64748b;
}

.batch-content-form-item :deep(.el-form-item__content) {
  display: block;
}

.batch-content-shell {
  display: grid;
  gap: 8px;
  width: 100%;
}

.batch-content-shell__header {
  display: flex;
  justify-content: flex-end;
}

.batch-guide {
  display: grid;
  gap: 12px;
  color: #334155;
}

.batch-guide__title {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}

.batch-guide__section {
  display: grid;
  gap: 4px;
}

.batch-guide__section-title {
  font-size: 12px;
  font-weight: 600;
  color: #475569;
}

.batch-guide__section p {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
}

.batch-guide__example {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid rgba(226, 232, 240, 0.9);
  font-size: 12px;
  line-height: 1.6;
  color: #0f172a;
  white-space: pre-wrap;
  word-break: break-word;
}

.temporary-password {
  font-family: 'Consolas', 'Segoe UI Mono', monospace;
  font-size: 13px;
  color: #0f172a;
}

@media (max-width: 1280px) {
  .filter-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .management-tabs :deep(.el-tabs__header) {
    padding-right: 44px;
  }

  .management-tabs-shell__actions {
    position: static;
    justify-content: flex-end;
    margin-bottom: 12px;
  }

  .filter-row {
    grid-template-columns: 1fr;
  }

  .directory-user {
    align-items: flex-start;
  }

  .filter-row__actions {
    justify-content: stretch;
  }

  .filter-row__actions :deep(.el-button) {
    flex: 1;
  }

  .create-form-grid {
    grid-template-columns: 1fr;
  }

  .create-form-grid__full {
    grid-column: auto;
  }
}
</style>
