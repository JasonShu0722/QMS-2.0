import { describe, expect, it } from 'vitest'

import {
  buildProcessIssueStatistics,
  buildProcessIssueStatusOptions,
  canCloseProcessIssue,
  canRespondToProcessIssue,
  canVerifyProcessIssue,
  getProcessIssueStatusLabel,
  getProcessIssueStatusType,
  normalizeProcessIssueStatus,
} from '@/utils/processIssue'

describe('process issue helpers', () => {
  it('normalizes current and legacy status values', () => {
    expect(normalizeProcessIssueStatus('open')).toBe('open')
    expect(normalizeProcessIssueStatus('in_progress')).toBe('in_analysis')
    expect(normalizeProcessIssueStatus('verifying')).toBe('in_verification')
  })

  it('returns readable labels, tags, and filter options', () => {
    expect(getProcessIssueStatusLabel('in_analysis')).toBe('分析中')
    expect(getProcessIssueStatusLabel('verifying')).toBe('验证中')
    expect(getProcessIssueStatusType('cancelled')).toBe('danger')
    expect(buildProcessIssueStatusOptions().map((item) => item.value)).toEqual([
      'open',
      'in_analysis',
      'in_verification',
      'closed',
      'cancelled',
    ])
  })

  it('derives action availability from the normalized workflow status', () => {
    expect(canRespondToProcessIssue({ status: 'open', assigned_to: 7 }, 7)).toBe(true)
    expect(canRespondToProcessIssue({ status: 'in_analysis', assigned_to: 7 }, 7)).toBe(true)
    expect(canRespondToProcessIssue({ status: 'in_verification', assigned_to: 7 }, 7)).toBe(false)

    expect(canVerifyProcessIssue({ status: 'in_verification', verified_by: null })).toBe(true)
    expect(canVerifyProcessIssue({ status: 'in_verification', verified_by: 3 })).toBe(false)

    expect(canCloseProcessIssue({ status: 'verifying', verified_by: 3 })).toBe(true)
    expect(canCloseProcessIssue({ status: 'in_analysis', verified_by: 3 })).toBe(false)
  })

  it('builds summary counts from the current workflow statuses', () => {
    expect(
      buildProcessIssueStatistics([
        { status: 'open', is_overdue: false },
        { status: 'in_analysis', is_overdue: false },
        { status: 'verifying', is_overdue: true },
        { status: 'closed', is_overdue: false },
        { status: 'cancelled', is_overdue: false },
      ])
    ).toEqual({
      total: 5,
      open: 1,
      inAnalysis: 1,
      inVerification: 1,
      active: 2,
      closed: 1,
      cancelled: 1,
      overdue: 1,
    })
  })
})
