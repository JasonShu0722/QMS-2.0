import { describe, expect, it } from 'vitest'

import { formatApiErrorMessage } from '@/utils/request'

describe('formatApiErrorMessage', () => {
  it('formats FastAPI validation details instead of showing [object Object]', () => {
    const message = formatApiErrorMessage([
      {
        loc: ['body', 'items', 0, 'contact_email'],
        msg: 'value is not a valid email address',
        type: 'value_error',
      },
    ])

    expect(message).toContain('items.0.contact_email')
    expect(message).toContain('value is not a valid email address')
    expect(message).not.toContain('[object Object]')
  })
})
