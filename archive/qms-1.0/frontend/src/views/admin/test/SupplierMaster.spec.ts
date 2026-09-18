import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'

import SupplierMaster from '../SupplierMaster.vue'

const adminApiMocks = vi.hoisted(() => ({
  getSuppliersMock: vi.fn(),
  createSupplierMock: vi.fn(),
  bulkCreateSuppliersMock: vi.fn(),
  updateSupplierMock: vi.fn(),
  updateSupplierStatusMock: vi.fn(),
}))

const messageMocks = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  confirmMock: vi.fn(),
}))

vi.mock('@/api/admin', () => ({
  adminApi: {
    getSuppliers: adminApiMocks.getSuppliersMock,
    createSupplier: adminApiMocks.createSupplierMock,
    bulkCreateSuppliers: adminApiMocks.bulkCreateSuppliersMock,
    updateSupplier: adminApiMocks.updateSupplierMock,
    updateSupplierStatus: adminApiMocks.updateSupplierStatusMock,
  },
}))

vi.mock('element-plus', async () => {
  const actual = await vi.importActual('element-plus')
  return {
    ...actual,
    ElMessage: {
      success: messageMocks.successMock,
      error: messageMocks.errorMock,
    },
    ElMessageBox: {
      confirm: messageMocks.confirmMock,
    },
  }
})

function mountSupplierMaster() {
  return shallowMount(SupplierMaster, {
    global: {
      stubs: {
        'el-button': { template: '<button><slot /></button>' },
        'el-icon': { template: '<span><slot /></span>' },
        'el-input': { template: '<input />' },
        'el-select': { template: '<select><slot /></select>' },
        'el-option': { template: '<option><slot /></option>' },
        'el-table': { template: '<div><slot /></div>' },
        'el-table-column': { template: '<div />' },
        'el-tag': { template: '<span><slot /></span>' },
        'el-dialog': { template: '<div><slot /><slot name="footer" /></div>' },
        'el-form': { template: '<form><slot /></form>' },
        'el-form-item': { template: '<div><slot /></div>' },
        'el-radio-group': { template: '<div><slot /></div>' },
        'el-radio-button': { template: '<button><slot /></button>' },
      },
    },
  })
}

describe('SupplierMaster.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    adminApiMocks.getSuppliersMock.mockResolvedValue([
      {
        id: 1,
        code: 'SUP001',
        name: '示例供应商',
        status: 'active',
        linked_user_count: 2,
        active_user_count: 2,
        created_at: '2026-04-14T00:00:00Z',
        updated_at: '2026-04-14T00:00:00Z',
      },
    ])
    adminApiMocks.createSupplierMock.mockResolvedValue({})
    adminApiMocks.bulkCreateSuppliersMock.mockResolvedValue({
      total_count: 2,
      created_count: 2,
      suppliers: [],
    })
    adminApiMocks.updateSupplierMock.mockResolvedValue({})
    adminApiMocks.updateSupplierStatusMock.mockResolvedValue({})
    messageMocks.confirmMock.mockResolvedValue(undefined)
  })

  it('loads suppliers on mount', async () => {
    mountSupplierMaster()
    await flushPromises()

    expect(adminApiMocks.getSuppliersMock).toHaveBeenCalledTimes(1)
  })

  it('creates a supplier from the edit form', async () => {
    const wrapper = mountSupplierMaster()
    await flushPromises()

    ;(wrapper.vm as any).editForm.code = 'SUP002'
    ;(wrapper.vm as any).editForm.name = '新增供应商'
    ;(wrapper.vm as any).editForm.contact_person = '张三'

    await (wrapper.vm as any).submitSupplier()

    expect(adminApiMocks.createSupplierMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'SUP002',
        name: '新增供应商',
        contact_person: '张三',
      }),
    )
    expect(messageMocks.successMock).toHaveBeenCalled()
  })

  it('imports suppliers in batch from text content', async () => {
    const wrapper = mountSupplierMaster()
    await flushPromises()

    ;(wrapper.vm as any).importForm.content =
      'SUP001,示例供应商,张三,zhangsan@example.com,13800000000\nSUP002,备选供应商'

    await (wrapper.vm as any).submitImport()

    expect(adminApiMocks.bulkCreateSuppliersMock).toHaveBeenCalledWith({
      status: 'active',
      items: [
        expect.objectContaining({ code: 'SUP001', name: '示例供应商' }),
        expect.objectContaining({ code: 'SUP002', name: '备选供应商' }),
      ],
    })
  })

  it('toggles supplier status through the management action', async () => {
    const wrapper = mountSupplierMaster()
    await flushPromises()

    const supplier = (wrapper.vm as any).suppliers[0]
    await (wrapper.vm as any).toggleSupplierStatus(supplier)

    expect(adminApiMocks.updateSupplierStatusMock).toHaveBeenCalledWith(1, 'suspended')
  })
})
