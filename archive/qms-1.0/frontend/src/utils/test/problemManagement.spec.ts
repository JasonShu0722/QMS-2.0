import { describe, expect, it } from 'vitest'
import { ComplaintType } from '@/types/customer-quality'
import type { ProblemCategoryItem, ProblemCategoryKey } from '@/types/problem-management'
import {
  buildCustomerComplaintTypeOptions,
  getCustomerComplaintCategoryKey,
  getCustomerComplaintTypeLabel,
  getProblemCategoryLabel
} from '@/utils/problemManagement'

describe('problem management utility helpers', () => {
  it('maps customer complaint types to the confirmed unified category keys', () => {
    expect(getCustomerComplaintCategoryKey(ComplaintType.ZERO_KM)).toBe('CQ0')
    expect(getCustomerComplaintCategoryKey(ComplaintType.AFTER_SALES)).toBe('CQ1')
  })

  it('uses shared problem-category labels when available', () => {
    const resolveCategory = (categoryKey: ProblemCategoryKey): ProblemCategoryItem | null => {
      if (categoryKey === 'CQ0') {
        return {
          key: 'CQ0',
          category_code: 'CQ',
          subcategory_code: '0',
          module_key: 'customer_quality' as const,
          label: '0km'
        }
      }

      if (categoryKey === 'CQ1') {
        return {
          key: 'CQ1',
          category_code: 'CQ',
          subcategory_code: '1',
          module_key: 'customer_quality' as const,
          label: '售后'
        }
      }

      return null
    }

    expect(getCustomerComplaintTypeLabel(ComplaintType.ZERO_KM, resolveCategory)).toBe('0KM')
    expect(getCustomerComplaintTypeLabel(ComplaintType.AFTER_SALES, resolveCategory, true)).toBe('售后客诉')
  })

  it('falls back to local labels when the shared catalog is not ready', () => {
    expect(getCustomerComplaintTypeLabel(ComplaintType.ZERO_KM)).toBe('0KM')
    expect(buildCustomerComplaintTypeOptions()).toEqual([
      { value: ComplaintType.ZERO_KM, label: '0KM客诉' },
      { value: ComplaintType.AFTER_SALES, label: '售后客诉' }
    ])
  })
  it('resolves customer-audit issue tasks to the shared AQ3 label', () => {
    const resolveCategory = (categoryKey: ProblemCategoryKey): ProblemCategoryItem | null =>
      categoryKey === 'AQ3'
        ? {
            key: 'AQ3',
            category_code: 'AQ',
            subcategory_code: '3',
            module_key: 'audit_management' as const,
            label: '瀹㈡埛瀹℃牳闂'
          }
        : null

    expect(getProblemCategoryLabel('AQ3', '瀹㈡埛瀹℃牳闂', resolveCategory)).toBe('瀹㈡埛瀹℃牳闂')
    expect(getProblemCategoryLabel('AQ3', '瀹㈡埛瀹℃牳闂')).toBe('瀹㈡埛瀹℃牳闂')
  })
})
