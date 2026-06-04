import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'

import CustomerMaster from '../CustomerMaster.vue'

const adminApiMocks = vi.hoisted(() => ({
  getCustomersMock: vi.fn(),
  createCustomerMock: vi.fn(),
  bulkCreateCustomersMock: vi.fn(),
  updateCustomerMock: vi.fn(),
  updateCustomerStatusMock: vi.fn(),
}))

const messageMocks = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  confirmMock: vi.fn(),
}))

vi.mock('@/api/admin', () => ({
  adminApi: {
    getCustomers: adminApiMocks.getCustomersMock,
    createCustomer: adminApiMocks.createCustomerMock,
    bulkCreateCustomers: adminApiMocks.bulkCreateCustomersMock,
    updateCustomer: adminApiMocks.updateCustomerMock,
    updateCustomerStatus: adminApiMocks.updateCustomerStatusMock,
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

function mountCustomerMaster() {
  return shallowMount(CustomerMaster, {
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

describe('CustomerMaster.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    adminApiMocks.getCustomersMock.mockResolvedValue([])
    adminApiMocks.createCustomerMock.mockResolvedValue({})
    adminApiMocks.bulkCreateCustomersMock.mockResolvedValue({
      message: '导入完成',
      total_count: 1,
      created_count: 1,
      customers: [],
    })
    adminApiMocks.updateCustomerMock.mockResolvedValue({})
    adminApiMocks.updateCustomerStatusMock.mockResolvedValue({})
    messageMocks.confirmMock.mockResolvedValue(undefined)
  })

  it('shows the import limit note', async () => {
    const wrapper = mountCustomerMaster()
    await flushPromises()

    expect(wrapper.text()).toContain('单次最多导入 500 条')
  })

  it('blocks batch import when pasted rows exceed the single-import limit', async () => {
    const wrapper = mountCustomerMaster()
    await flushPromises()

    ;(wrapper.vm as any).importForm.content = Array.from(
      { length: 501 },
      (_, index) => `C${String(index).padStart(4, '0')}\t客户${index}`
    ).join('\n')

    await (wrapper.vm as any).submitImport()

    expect(adminApiMocks.bulkCreateCustomersMock).not.toHaveBeenCalled()
    expect(messageMocks.errorMock).toHaveBeenCalledWith(
      '单次最多导入 500 条，当前 501 条，请分批导入'
    )
  })
})
