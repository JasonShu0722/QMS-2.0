import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'

import PermissionMatrix from '../PermissionMatrix.vue'

const adminApiMocks = vi.hoisted(() => ({
  getPermissionMatrixMock: vi.fn(),
  initializeRoleTemplatesMock: vi.fn(),
  updateRolePermissionsMock: vi.fn(),
  createRoleTagMock: vi.fn(),
  updateRoleTagMock: vi.fn(),
  deleteRoleTagMock: vi.fn()
}))

const messageMocks = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  infoMock: vi.fn(),
  confirmMock: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminApi: {
    getPermissionMatrix: adminApiMocks.getPermissionMatrixMock,
    initializeRoleTemplates: adminApiMocks.initializeRoleTemplatesMock,
    updateRolePermissions: adminApiMocks.updateRolePermissionsMock,
    createRoleTag: adminApiMocks.createRoleTagMock,
    updateRoleTag: adminApiMocks.updateRoleTagMock,
    deleteRoleTag: adminApiMocks.deleteRoleTagMock
  }
}))

vi.mock('element-plus', async () => {
  const actual = await vi.importActual('element-plus')
  return {
    ...actual,
    ElMessage: {
      success: messageMocks.successMock,
      error: messageMocks.errorMock,
      info: messageMocks.infoMock
    },
    ElMessageBox: {
      confirm: messageMocks.confirmMock
    }
  }
})

function mountPermissionMatrix() {
  return shallowMount(PermissionMatrix, {
    global: {
      stubs: {
        'el-card': { template: '<div><slot name="header" /><slot /></div>' },
        'el-button': { template: '<button><slot /></button>' },
        'el-icon': { template: '<span><slot /></span>' },
        'el-empty': { template: '<div><slot /></div>' },
        'el-checkbox': { template: '<input type="checkbox" />' },
        'el-tag': { template: '<span><slot /></span>' },
        'el-alert': { template: '<div><slot name="title" /></div>' },
        'el-dialog': { template: '<div><slot /><slot name="footer" /></div>' },
        'el-form': { template: '<form><slot /></form>' },
        'el-form-item': { template: '<div><slot /></div>' },
        'el-input': { template: '<input />' },
        'el-radio-group': { template: '<div><slot /></div>' },
        'el-radio-button': { template: '<button><slot /></button>' },
        'el-select': { template: '<select><slot /></select>' },
        'el-option': { template: '<option><slot /></option>' },
        'el-switch': { template: '<input type="checkbox" />' }
      }
    }
  })
}

describe('PermissionMatrix.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adminApiMocks.getPermissionMatrixMock.mockResolvedValue({
      modules: [
        {
          module_path: 'system.users',
          module_name: '用户管理',
          group_key: 'system-admin',
          group_name: '系统管理',
          operations: ['read', 'update']
        }
      ],
      rows: [
        {
          role: {
            id: 3,
            role_key: 'quality.process.engineer',
            role_name: '制程质量工程师',
            applicable_user_type: 'internal',
            is_active: true,
            assigned_user_count: 5
          },
          permissions: {
            'system.users.read': true,
            'system.users.update': false
          }
        }
      ]
    })
    adminApiMocks.initializeRoleTemplatesMock.mockResolvedValue({
      success: true,
      message: '初始化完成',
      created_roles: 1,
      existing_roles: 0,
      created_permissions: 2,
      role_keys: ['sys.super_admin']
    })
    adminApiMocks.updateRolePermissionsMock.mockResolvedValue(undefined)
    adminApiMocks.createRoleTagMock.mockResolvedValue({
      id: 7,
      role_key: 'quality.process.manager',
      role_name: '制程质量室经理',
      applicable_user_type: 'internal',
      is_active: true,
      assigned_user_count: 0
    })
    adminApiMocks.updateRoleTagMock.mockResolvedValue(undefined)
    adminApiMocks.deleteRoleTagMock.mockResolvedValue(undefined)
    messageMocks.confirmMock.mockResolvedValue(undefined)
  })

  it('loads modules and role rows from the matrix contract', async () => {
    const wrapper = mountPermissionMatrix()
    await flushPromises()

    expect(adminApiMocks.getPermissionMatrixMock).toHaveBeenCalledTimes(1)
    expect((wrapper.vm as any).modules).toHaveLength(1)
    expect((wrapper.vm as any).permissionRows).toHaveLength(1)
    expect((wrapper.vm as any).permissionRows[0].role.role_key).toBe('quality.process.engineer')
    expect((wrapper.vm as any).permissionRows[0].permissions['system.users.read']).toBe(true)
  })

  it('groups permission changes by role when saving', async () => {
    const wrapper = mountPermissionMatrix()
    await flushPromises()

    ;(wrapper.vm as any).handlePermissionChange(3, 'system.users', 'read', false)
    ;(wrapper.vm as any).handlePermissionChange(3, 'system.users', 'update', true)
    await (wrapper.vm as any).saveAllChanges()

    expect(adminApiMocks.updateRolePermissionsMock).toHaveBeenCalledWith(3, [
      { module_path: 'system.users', operation_type: 'read', is_granted: false },
      { module_path: 'system.users', operation_type: 'update', is_granted: true }
    ])
    expect(messageMocks.successMock).toHaveBeenCalled()
  })

  it('initializes default role templates on demand', async () => {
    const wrapper = mountPermissionMatrix()
    await flushPromises()

    await (wrapper.vm as any).initializeRoleTemplates()

    expect(adminApiMocks.initializeRoleTemplatesMock).toHaveBeenCalledTimes(1)
    expect(messageMocks.successMock).toHaveBeenCalledWith('初始化完成')
  })

  it('creates a new role tag without duplicating permission editing in the dialog', async () => {
    const wrapper = mountPermissionMatrix()
    await flushPromises()

    ;(wrapper.vm as any).openCreateRoleDialog()
    ;(wrapper.vm as any).roleForm.role_key = 'quality.process.manager'
    ;(wrapper.vm as any).roleForm.role_name = '制程质量室经理'
    ;(wrapper.vm as any).roleForm.applicable_user_type = 'internal'

    await (wrapper.vm as any).saveRoleDialog()

    expect(adminApiMocks.createRoleTagMock).toHaveBeenCalledWith({
      role_key: 'quality.process.manager',
      role_name: '制程质量室经理',
      applicable_user_type: 'internal',
      is_active: true
    })
    expect(adminApiMocks.updateRolePermissionsMock).not.toHaveBeenCalled()
  })
})
