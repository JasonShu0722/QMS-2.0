import { describe, expect, it } from 'vitest'

import { buildInternalUserLabelMap, formatInternalUserLabel } from '@/utils/internalUsers'

describe('internalUsers utils', () => {
  it('formats user labels with department when present', () => {
    expect(
      formatInternalUserLabel({
        id: 12,
        username: 'zhangsan',
        full_name: '张三',
        department: '供应商质量',
        position: '工程师',
      })
    ).toBe('张三 (zhangsan) / 供应商质量')
  })

  it('builds lookup map for label display', () => {
    expect(
      buildInternalUserLabelMap([
        {
          id: 7,
          username: 'lisi',
          full_name: '李四',
          department: null,
          position: null,
        },
      ])
    ).toEqual({
      7: '李四 (lisi)',
    })
  })
})
