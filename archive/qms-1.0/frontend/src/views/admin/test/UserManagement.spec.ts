import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'

import UserManagement from '../UserApproval.vue'

const adminApiMocks = vi.hoisted(() => ({
  getPendingUsersMock: vi.fn(),
  getUsersMock: vi.fn(),
  getRoleTagsMock: vi.fn(),
  getSuppliersMock: vi.fn(),
  createUserMock: vi.fn(),
  bulkCreateUsersMock: vi.fn(),
  assignUserRolesMock: vi.fn(),
  updateUserMock: vi.fn(),
}))

const messageMocks = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  infoMock: vi.fn(),
  confirmMock: vi.fn(),
  promptMock: vi.fn(),
  alertMock: vi.fn(),
}))

vi.mock('@/api/admin', () => ({
  adminApi: {
    getPendingUsers: adminApiMocks.getPendingUsersMock,
    getUsers: adminApiMocks.getUsersMock,
    getRoleTags: adminApiMocks.getRoleTagsMock,
    getSuppliers: adminApiMocks.getSuppliersMock,
    createUser: adminApiMocks.createUserMock,
    bulkCreateUsers: adminApiMocks.bulkCreateUsersMock,
    assignUserRoles: adminApiMocks.assignUserRolesMock,
    updateUser: adminApiMocks.updateUserMock,
  },
}))

vi.mock('element-plus', async () => {
  const actual = await vi.importActual('element-plus')
  return {
    ...actual,
    ElMessage: {
      success: messageMocks.successMock,
      error: messageMocks.errorMock,
      info: messageMocks.infoMock,
    },
    ElMessageBox: {
      confirm: messageMocks.confirmMock,
      prompt: messageMocks.promptMock,
      alert: messageMocks.alertMock,
    },
  }
})

function mountUserManagement() {
  return shallowMount(UserManagement, {
    global: {
      stubs: {
        'el-card': { template: '<div><slot name="header" /><slot /></div>' },
        'el-button': { template: '<button><slot /></button>' },
        'el-icon': { template: '<span><slot /></span>' },
        'el-empty': { template: '<div><slot /></div>' },
        'el-tabs': { template: '<div><slot /></div>' },
        'el-tab-pane': { template: '<div><slot /></div>' },
        'el-table': { template: '<div><slot /></div>' },
        'el-table-column': { template: '<div />' },
        'el-tag': { template: '<span><slot /></span>' },
        'el-dialog': { template: '<div><slot /><slot name="footer" /></div>' },
        'el-form': { template: '<form><slot /></form>' },
        'el-form-item': { template: '<div><slot /></div>' },
        'el-input': { template: '<input />' },
        'el-select': { template: '<select><slot /></select>' },
        'el-option': { template: '<option><slot /></option>' },
        'el-popover': { template: '<div><slot name="reference" /><slot /></div>' },
        'el-radio-group': { template: '<div><slot /></div>' },
        'el-radio-button': { template: '<button><slot /></button>' },
        'el-dropdown': { template: '<div><slot /><slot name="dropdown" /></div>' },
        'el-dropdown-menu': { template: '<div><slot /></div>' },
        'el-dropdown-item': { template: '<button><slot /></button>' },
        'el-checkbox': { template: '<input type="checkbox" />' },
        'el-checkbox-group': { template: '<div><slot /></div>' },
      },
    },
  })
}

describe('UserApproval.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    adminApiMocks.getPendingUsersMock.mockResolvedValue([
      {
        id: 1,
        username: 'pending-user',
        full_name: '待审核用户',
        email: 'pending@example.com',
        user_type: 'internal',
        status: 'pending',
        created_at: '2026-04-12T00:00:00Z',
        updated_at: '2026-04-12T00:00:00Z',
      },
    ])

    adminApiMocks.getUsersMock.mockResolvedValue([
      {
        id: 8,
        username: 'active-user',
        full_name: '正式用户',
        email: 'active@example.com',
        user_type: 'internal',
        status: 'active',
        department: '质量管理部',
        position: '质量工程师',
        allowed_environments: 'stable',
        role_tags: [],
        created_at: '2026-04-12T00:00:00Z',
        updated_at: '2026-04-12T00:00:00Z',
      },
    ])

    adminApiMocks.getRoleTagsMock.mockResolvedValue([
      {
        id: 3,
        role_key: 'quality.process.engineer',
        role_name: '制程质量工程师',
        applicable_user_type: 'internal',
        is_active: true,
        assigned_user_count: 1,
      },
    ])

    adminApiMocks.getSuppliersMock.mockResolvedValue([
      {
        id: 12,
        code: 'SUP001',
        name: '示例供应商',
        status: 'active',
        linked_user_count: 0,
        active_user_count: 0,
        created_at: '2026-04-13T00:00:00Z',
        updated_at: '2026-04-13T00:00:00Z',
      },
    ])

    adminApiMocks.createUserMock.mockResolvedValue({
      message: 'created',
      user: {
        id: 9,
        username: 'new-user',
        full_name: '新增用户',
        email: 'new@example.com',
        user_type: 'internal',
        status: 'active',
        department: '质量管理部',
        allowed_environments: 'stable',
        role_tags: [],
        created_at: '2026-04-13T00:00:00Z',
        updated_at: '2026-04-13T00:00:00Z',
      },
      temporary_password: 'Temp123!',
      email_sent: true,
    })

    adminApiMocks.bulkCreateUsersMock.mockResolvedValue({
      message: 'created',
      total_count: 2,
      created_count: 2,
      results: [
        {
          row_number: 1,
          user: {
            id: 10,
            username: 'bulk-1',
            full_name: '批量一',
            email: 'bulk1@example.com',
            user_type: 'internal',
            status: 'active',
            department: '质量管理部',
            allowed_environments: 'stable',
            role_tags: [],
            created_at: '2026-04-13T00:00:00Z',
            updated_at: '2026-04-13T00:00:00Z',
          },
          temporary_password: 'Bulk123!',
          email_sent: true,
        },
      ],
    })

    adminApiMocks.assignUserRolesMock.mockResolvedValue(undefined)
    adminApiMocks.updateUserMock.mockResolvedValue(undefined)
  })

  it('loads pending users, directory users and role tags on mount', async () => {
    mountUserManagement()
    await flushPromises()

    expect(adminApiMocks.getPendingUsersMock).toHaveBeenCalledTimes(1)
    expect(adminApiMocks.getUsersMock).toHaveBeenCalledTimes(1)
    expect(adminApiMocks.getRoleTagsMock).toHaveBeenCalledTimes(1)
  })

  it('assigns selected role tags to the current user', async () => {
    const wrapper = mountUserManagement()
    await flushPromises()

    const user = (wrapper.vm as any).users[0]
    ;(wrapper.vm as any).openRoleDialog(user)
    ;(wrapper.vm as any).selectedRoleTagIds = [3]
    await (wrapper.vm as any).saveUserRoles()

    expect(adminApiMocks.assignUserRolesMock).toHaveBeenCalledWith(8, [3])
    expect(messageMocks.successMock).toHaveBeenCalled()
  })

  it('creates a single internal user from the create dialog state', async () => {
    const wrapper = mountUserManagement()
    await flushPromises()

    ;(wrapper.vm as any).singleCreateForm.username = 'new-user'
    ;(wrapper.vm as any).singleCreateForm.full_name = '新增用户'
    ;(wrapper.vm as any).singleCreateForm.email = 'new@example.com'
    ;(wrapper.vm as any).singleCreateForm.department = '质量管理部'
    ;(wrapper.vm as any).singleCreateForm.environments = ['stable']

    await (wrapper.vm as any).submitSingleCreate()

    expect(adminApiMocks.createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'new-user',
        user_type: 'internal',
        department: '质量管理部',
        allowed_environments: 'stable',
      }),
    )
    expect(messageMocks.successMock).toHaveBeenCalled()
  })

  it('creates users in batch from textarea content', async () => {
    const wrapper = mountUserManagement()
    await flushPromises()

    ;(wrapper.vm as any).batchCreateForm.content =
      'bulk-1,批量一,bulk1@example.com,13800000000,质量管理部,体系工程师'
    ;(wrapper.vm as any).batchCreateForm.environments = ['stable']

    await (wrapper.vm as any).submitBulkCreate()

    expect(adminApiMocks.bulkCreateUsersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_type: 'internal',
        allowed_environments: 'stable',
        items: [
          expect.objectContaining({
            username: 'bulk-1',
            department: '质量管理部',
          }),
        ],
      }),
    )
    expect(messageMocks.successMock).toHaveBeenCalled()
  })

  it('loads supplier master options for supplier account creation', async () => {
    const wrapper = mountUserManagement()
    await flushPromises()

    await (wrapper.vm as any).loadSupplierOptions('SUP001')

    expect(adminApiMocks.getSuppliersMock).toHaveBeenCalledWith({
      keyword: 'SUP001',
      status: 'active',
    })
    expect((wrapper.vm as any).supplierOptions[0].name).toBe('示例供应商')
  })
})
