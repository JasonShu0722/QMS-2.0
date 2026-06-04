import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())

vi.mock('@/utils/request', () => ({
  default: requestMock,
}))

import { getCustomerComplaints } from '@/api/customer-quality'
import { getProcessDefects, getResponsibilityCategories } from '@/api/process-quality'

describe('quality API paths', () => {
  beforeEach(() => {
    requestMock.mockReset()
    requestMock.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 })
  })

  it('uses the shared /api base URL only once for customer complaints', async () => {
    await getCustomerComplaints({ page: 1, page_size: 20 })

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/v1/customer-complaints',
      }),
    )
  })

  it('uses the shared /api base URL only once for process defects', async () => {
    await getProcessDefects({ page: 1, page_size: 20 })

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/v1/process-defects',
      }),
    )
  })

  it('uses the backend option route for process responsibility categories', async () => {
    await getResponsibilityCategories()

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/v1/process-defects/options/responsibility-categories',
      }),
    )
  })
})
