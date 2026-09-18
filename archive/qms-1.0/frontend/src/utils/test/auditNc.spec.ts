import { describe, expect, it } from 'vitest'
import type { ProblemCategoryKey } from '@/types/problem-management'
import {
  buildAuditNCProblemCategoryOptions,
  canAssignAuditNC,
  canCloseAuditNC,
  canRespondAuditNC,
  canVerifyAuditNC,
  getAuditNCProblemCategoryLabel,
  getAuditNCStatusLabel,
  getAuditNCStatusOptions,
  getAuditNCStatusType,
  normalizeAuditNCStatus
} from '@/utils/auditNc'

describe('audit NC helpers', () => {
  it('normalizes legacy frontend statuses to the backend contract', () => {
    expect(normalizeAuditNCStatus('pending')).toBe('open')
    expect(normalizeAuditNCStatus('responded')).toBe('submitted')
    expect(normalizeAuditNCStatus('verified')).toBe('verified')
  })

  it('returns consistent labels and tag types for canonical statuses', () => {
    const statusOptions = getAuditNCStatusOptions()

    expect(getAuditNCStatusLabel('open')).toBe(statusOptions[0]?.label)
    expect(getAuditNCStatusLabel('submitted')).toBe(statusOptions[2]?.label)
    expect(getAuditNCStatusType('rejected')).toBe('danger')
  })

  it('derives action visibility from normalized statuses', () => {
    expect(canAssignAuditNC('pending')).toBe(true)
    expect(canRespondAuditNC('assigned')).toBe(true)
    expect(canVerifyAuditNC('responded')).toBe(true)
    expect(canCloseAuditNC('verified')).toBe(true)
    expect(getAuditNCStatusOptions().map((item) => item.value)).toEqual([
      'open',
      'assigned',
      'submitted',
      'verified',
      'rejected',
      'closed'
    ])
  })

  it('prefers shared problem-category labels and falls back safely', () => {
    const resolveCategory = (categoryKey: ProblemCategoryKey) => {
      if (categoryKey === 'AQ3') {
        return {
          key: 'AQ3' as const,
          category_code: 'AQ',
          subcategory_code: '3',
          module_key: 'audit_management' as const,
          label: 'customer audit issue'
        }
      }

      return null
    }

    expect(getAuditNCProblemCategoryLabel('AQ3', undefined, resolveCategory)).toBe('customer audit issue')
    expect(getAuditNCProblemCategoryLabel(undefined, 'backend label')).toBe('backend label')
    expect(getAuditNCProblemCategoryLabel()).toBe('-')
    expect(
      buildAuditNCProblemCategoryOptions([
        {
          key: 'AQ1',
          category_code: 'AQ',
          subcategory_code: '1',
          module_key: 'audit_management',
          label: 'process audit nc'
        }
      ])
    ).toEqual([{ value: 'AQ1', label: 'process audit nc' }])
  })
})
