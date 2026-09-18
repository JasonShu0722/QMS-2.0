import { describe, expect, it } from 'vitest'

import { formatDateTimeInBeijing } from '@/utils/dateTime'

describe('formatDateTimeInBeijing', () => {
  it('treats backend naive timestamps as UTC and renders Beijing time', () => {
    expect(formatDateTimeInBeijing('2026-04-20T00:14:00')).toBe('2026/04/20 08:14')
  })

  it('returns fallback symbol for empty values', () => {
    expect(formatDateTimeInBeijing()).toBe('-')
    expect(formatDateTimeInBeijing(null)).toBe('-')
  })
})
