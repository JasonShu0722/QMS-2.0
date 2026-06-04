import { describe, expect, it } from 'vitest'

import {
  buildProblemIssueModuleSummaries,
  buildProblemIssueModuleOptions,
  buildProblemIssueResponseModeOptions,
  buildProblemIssueRiskLevelOptions,
  buildUnifiedProblemStatusOptions,
  getProblemIssueCenterRoute,
  getProblemIssueModuleLabel,
  getProblemIssueQuickActionLabel,
  getProblemIssueQuickActionRoute,
  getProblemIssueResponseModeLabel,
  getProblemIssueRiskLevelLabel,
  getProblemIssueRiskLevelType,
  getProblemIssueSourceActionLabel,
  getProblemIssueSourceRoute,
  getProblemIssueTrackingNumber,
  getProblemIssueWorkbenchPreviewActionLabel,
  getUnifiedProblemStatusLabel,
  getUnifiedProblemStatusType,
  isProblemIssueQuickActionable,
  normalizeProblemIssueModuleCounts,
  parseProblemIssueCenterRouteQuery,
} from '@/utils/problemIssueSummary'

describe('problem issue summary helpers', () => {
  it('returns readable module and status labels', () => {
    expect(getProblemIssueModuleLabel('customer_quality')).toBe('客户质量')
    expect(getProblemIssueModuleLabel('incoming_quality')).toBe('供应商质量')
    expect(getProblemIssueModuleLabel('audit_management')).toBe('审核管理')
    expect(getUnifiedProblemStatusLabel('pending_review')).toBe('待审核')
    expect(getUnifiedProblemStatusLabel('approved')).toBe('已批准')
    expect(getUnifiedProblemStatusType('approved')).toBe('success')
    expect(getUnifiedProblemStatusType('rejected')).toBe('danger')
  })

  it('builds stable filter options for the first unified issue center slice', () => {
    expect(buildProblemIssueModuleOptions().map((item) => item.value)).toEqual([
      'customer_quality',
      'process_quality',
      'incoming_quality',
      'new_product_quality',
      'audit_management',
    ])
    expect(buildUnifiedProblemStatusOptions().map((item) => item.value)).toEqual([
      'open',
      'assigned',
      'responding',
      'pending_review',
      'verifying',
      'approved',
      'closed',
      'rejected',
    ])
    expect(buildProblemIssueRiskLevelOptions().map((item) => item.value)).toEqual([
      'low',
      'medium',
      'high',
      'critical',
    ])
    expect(buildProblemIssueResponseModeOptions().map((item) => item.value)).toEqual([
      'brief',
      'eight_d',
    ])
  })

  it('normalizes backend module counts and falls back to item counts', () => {
    const explicitCounts = normalizeProblemIssueModuleCounts(
      {
        process_quality: 2,
        incoming_quality: 1,
        unknown_module: 5,
      },
      [{ module_key: 'customer_quality' } as any]
    )

    expect(explicitCounts).toEqual({
      process_quality: 2,
      incoming_quality: 1,
    })
    expect(
      buildProblemIssueModuleSummaries(explicitCounts).map((item) => [item.moduleKey, item.count])
    ).toEqual([
      ['process_quality', 2],
      ['incoming_quality', 1],
    ])

    const fallbackCounts = normalizeProblemIssueModuleCounts(undefined, [
      { module_key: 'customer_quality' },
      { module_key: 'customer_quality' },
      { module_key: 'audit_management' },
      { module_key: 'unknown_module' },
    ] as any)

    expect(fallbackCounts).toEqual({
      customer_quality: 2,
      audit_management: 1,
    })
    expect(
      buildProblemIssueModuleSummaries(fallbackCounts).map((item) => [item.moduleKey, item.count])
    ).toEqual([
      ['customer_quality', 2],
      ['audit_management', 1],
    ])
  })

  it('derives response-mode labels and source routes', () => {
    expect(getProblemIssueResponseModeLabel('brief')).toBe('简报')
    expect(getProblemIssueResponseModeLabel('eight_d')).toBe('8D')
    expect(getProblemIssueResponseModeLabel(null)).toBe('-')
    expect(getProblemIssueRiskLevelLabel('critical')).toBe('严重')
    expect(getProblemIssueRiskLevelType('critical')).toBe('danger')
    expect(getProblemIssueRiskLevelLabel(null)).toBe('-')

    expect(getProblemIssueSourceActionLabel({ source_type: 'customer_complaint' })).toBe('查看问题单')
    expect(getProblemIssueSourceRoute({ source_type: 'customer_complaint', source_id: 12 })).toEqual({
      name: 'CustomerComplaintDetail',
      params: { id: 12 },
      query: { sourceRouteName: 'ProblemIssueCenter' },
    })

    expect(getProblemIssueSourceActionLabel({ source_type: 'process_issue' })).toBe('查看问题单')
    expect(getProblemIssueSourceRoute({ source_type: 'process_issue', source_id: 8 })).toEqual({
      name: 'ProcessIssueDetail',
      params: { id: 8 },
    })

    expect(getProblemIssueSourceActionLabel({ source_type: 'scar' })).toBe('查看问题单')
    expect(getProblemIssueSourceRoute({ source_type: 'scar', source_id: 21 })).toEqual({
      name: 'ScarManagement',
      query: { focusId: '21' },
    })

    expect(getProblemIssueSourceActionLabel({ source_type: 'trial_issue' })).toBe('查看问题单')
    expect(getProblemIssueSourceRoute({ source_type: 'trial_issue', source_id: 15 })).toEqual({
      name: 'TrialIssueList',
      query: { focusId: '15' },
    })

    expect(getProblemIssueSourceActionLabel({ source_type: 'audit_nc' })).toBe('查看问题单')
    expect(getProblemIssueSourceRoute({ source_type: 'audit_nc', source_id: 9 })).toEqual({
      name: 'AuditNCList',
      query: { focusId: '9' },
    })

    expect(
      getProblemIssueSourceActionLabel({
        source_type: 'audit_nc',
        problem_category_key: 'AQ3',
      } as any)
    ).toBe('查看问题单')
    expect(
      getProblemIssueSourceRoute({
        source_type: 'audit_nc',
        source_id: 19,
        source_parent_id: 7,
        problem_category_key: 'AQ3',
      } as any)
    ).toEqual({
      name: 'CustomerAuditList',
      query: {
        focusId: '7',
        issueTaskId: '19',
        openIssueTasks: 'true',
      },
    })
  })

  it('uses formal problem or 8D numbers as the problem-center tracking number', () => {
    expect(
      getProblemIssueTrackingNumber({
        eight_d_number: 'ZX8D-IQ0-2605-001',
        problem_number: 'ZXQ-IQ0-2605-001',
        reference_no: 'SCAR-20260507-0001',
      })
    ).toBe('ZX8D-IQ0-2605-001')

    expect(
      getProblemIssueTrackingNumber({
        problem_number: 'ZXQ-CQ1-2605-001',
        reference_no: 'CC-20260528-001',
      })
    ).toBe('ZXQ-CQ1-2605-001')

    expect(getProblemIssueTrackingNumber({ reference_no: 'PD-20260528-001' })).toBe(
      'PD-20260528-001'
    )
  })

  it('derives quick-action labels and routes for actionable items', () => {
    expect(
      getProblemIssueQuickActionRoute(
        {
          source_type: 'process_issue',
          source_id: 8,
          assigned_to: 99,
          action_owner_id: 7,
          unified_status: 'responding',
          verified_by: null,
        },
        7
      )
    ).toEqual({
      name: 'ProcessIssueDetail',
      params: { id: 8 },
      query: { action: 'respond' },
    })
    expect(
      getProblemIssueQuickActionLabel(
        {
          source_type: 'process_issue',
          source_id: 8,
          assigned_to: 99,
          action_owner_id: 7,
          unified_status: 'responding',
          verified_by: null,
        },
        7
      )
    ).toBe('填写对策')

    expect(
      getProblemIssueQuickActionRoute(
        {
          source_type: 'process_issue',
          source_id: 18,
          assigned_to: 7,
          action_owner_id: 7,
          unified_status: 'verifying',
          verified_by: null,
        },
        7
      )
    ).toEqual({
      name: 'ProcessIssueDetail',
      params: { id: 18 },
      query: { action: 'verify' },
    })
    expect(
      getProblemIssueQuickActionLabel(
        {
          source_type: 'process_issue',
          source_id: 19,
          assigned_to: 7,
          action_owner_id: 7,
          unified_status: 'verifying',
          verified_by: 5,
        },
        7
      )
    ).toBe('关闭问题单')

    expect(
      getProblemIssueQuickActionRoute(
        {
          source_type: 'audit_nc',
          source_id: 9,
          assigned_to: 7,
          action_owner_id: 7,
          unified_status: 'assigned',
        },
        7
      )
    ).toEqual({
      name: 'AuditNCList',
      query: { focusId: '9', action: 'respond' },
    })
    expect(
      getProblemIssueQuickActionRoute(
        {
          source_type: 'audit_nc',
          source_id: 10,
          assigned_to: 99,
          action_owner_id: 7,
          unified_status: 'pending_review',
          problem_category_key: 'AQ3',
          source_parent_id: 4,
        },
        7
      )
    ).toEqual({
      name: 'AuditNCList',
      query: {
        focusId: '10',
        action: 'verify',
        sourceParentId: '4',
        sourceCategoryKey: 'AQ3',
      },
    })
    expect(
      getProblemIssueQuickActionLabel(
        {
          source_type: 'audit_nc',
          source_id: 11,
          assigned_to: 99,
          action_owner_id: 7,
          unified_status: 'verifying',
        },
        7
      )
    ).toBe('关闭')

    expect(
      getProblemIssueQuickActionRoute(
        {
          source_type: 'scar',
          source_id: 31,
          assigned_to: 99,
          action_owner_id: 7,
          unified_status: 'pending_review',
        },
        7
      )
    ).toEqual({
      name: 'ScarEightDReview',
      params: { id: 31 },
      query: {
        action: 'review',
        focusId: '31',
        sourceRouteName: 'ScarManagement',
        sourceFocusId: '31',
      },
    })
    expect(
      getProblemIssueQuickActionLabel(
        {
          source_type: 'scar',
          source_id: 31,
          assigned_to: 99,
          action_owner_id: 7,
          unified_status: 'pending_review',
        },
        7
      )
    ).toBe('审核8D')

    expect(
      getProblemIssueQuickActionRoute(
        {
          source_type: 'trial_issue',
          source_id: 15,
          assigned_to: 7,
          action_owner_id: 7,
          unified_status: 'responding',
        },
        7
      )
    ).toEqual({
      name: 'TrialIssueList',
      query: { focusId: '15', action: 'solution' },
    })
    expect(
      getProblemIssueQuickActionRoute(
        {
          source_type: 'trial_issue',
          source_id: 16,
          assigned_to: 7,
          action_owner_id: 7,
          unified_status: 'verifying',
        },
        7
      )
    ).toEqual({
      name: 'TrialIssueList',
      query: { focusId: '16', action: 'close' },
    })

    expect(
      getProblemIssueQuickActionRoute(
        {
          source_type: 'customer_complaint',
          source_id: 12,
          assigned_to: 7,
          action_owner_id: 7,
          unified_status: 'responding',
          requires_physical_analysis: true,
        },
        7
      )
    ).toEqual({
      name: 'CustomerComplaintDetail',
      params: { id: 12 },
      query: {
        action: 'analysis',
        sourceRouteName: 'ProblemIssueCenter',
      },
    })
    expect(
      getProblemIssueQuickActionLabel(
        {
          source_type: 'customer_complaint',
          source_id: 13,
          assigned_to: 7,
          action_owner_id: 7,
          unified_status: 'open',
          requires_physical_analysis: false,
        },
        7
      )
    ).toBe('实物处理')
    expect(
      getProblemIssueQuickActionRoute(
        {
          source_type: 'customer_complaint',
          source_id: 13,
          assigned_to: 7,
          action_owner_id: 7,
          unified_status: 'open',
          requires_physical_analysis: false,
        },
        7
      )
    ).toEqual({
      name: 'CustomerComplaintDetail',
      params: { id: 13 },
      query: {
        action: 'disposition',
        sourceRouteName: 'ProblemIssueCenter',
      },
    })

    expect(
      getProblemIssueQuickActionRoute(
        {
          source_type: 'scar',
          source_id: 22,
          assigned_to: 7,
          action_owner_id: 7,
          unified_status: 'pending_review',
        },
        7
      )
    ).toEqual({
      name: 'ScarEightDReview',
      params: { id: 22 },
      query: {
        action: 'review',
        focusId: '22',
        sourceRouteName: 'ScarManagement',
        sourceFocusId: '22',
      },
    })
  })

  it('marks unsupported or non-owned items as not actionable', () => {
    expect(
      isProblemIssueQuickActionable(
        {
          source_type: 'process_issue',
          source_id: 8,
          assigned_to: 7,
          action_owner_id: 99,
          unified_status: 'responding',
          verified_by: null,
        },
        7
      )
    ).toBe(false)
    expect(
      isProblemIssueQuickActionable(
        {
          source_type: 'scar',
          source_id: 21,
          assigned_to: 7,
          action_owner_id: 7,
          unified_status: 'open',
        },
        7
      )
    ).toBe(false)
    expect(
      getProblemIssueQuickActionRoute(
        {
          source_type: 'audit_nc',
          source_id: 21,
          assigned_to: 7,
          action_owner_id: 7,
          unified_status: 'closed',
        },
        7
      )
    ).toBeNull()
  })

  it('falls back to source actions for non-actionable preview items', () => {
    const processIssue = {
      source_type: 'process_issue' as const,
      source_id: 8,
      assigned_to: 99,
      action_owner_id: 7,
      unified_status: 'responding' as const,
      verified_by: null,
    }
    const scarIssue = {
      source_type: 'scar' as const,
      source_id: 21,
      assigned_to: 7,
      action_owner_id: 7,
      unified_status: 'closed' as const,
    }

    expect(getProblemIssueWorkbenchPreviewActionLabel(processIssue, 7)).toBe(
      getProblemIssueQuickActionLabel(processIssue, 7)
    )

    expect(getProblemIssueWorkbenchPreviewActionLabel(scarIssue, 7)).toBe(
      getProblemIssueSourceActionLabel(scarIssue)
    )
  })

  it('builds and parses problem-center quick routes', () => {
    expect(getProblemIssueCenterRoute()).toEqual({ name: 'ProblemIssueCenter' })
    expect(getProblemIssueCenterRoute('actionable')).toEqual({
      name: 'ProblemIssueCenter',
      query: { only_actionable_to_me: 'true' },
    })
    expect(getProblemIssueCenterRoute('overdue')).toEqual({
      name: 'ProblemIssueCenter',
      query: { only_overdue: 'true' },
    })
    expect(getProblemIssueCenterRoute('created')).toEqual({
      name: 'ProblemIssueCenter',
      query: { only_created_by_me: 'true' },
    })
    expect(getProblemIssueCenterRoute('actionable', 'incoming_quality')).toEqual({
      name: 'ProblemIssueCenter',
      query: {
        only_actionable_to_me: 'true',
        module_key: 'incoming_quality',
      },
    })
    expect(getProblemIssueCenterRoute('created', 'customer_quality')).toEqual({
      name: 'ProblemIssueCenter',
      query: {
        only_created_by_me: 'true',
        module_key: 'customer_quality',
      },
    })

    expect(
      parseProblemIssueCenterRouteQuery({
        module_key: 'incoming_quality',
        risk_level: 'high',
        response_mode: 'eight_d',
        only_created_by_me: 'true',
        only_actionable_to_me: 'true',
        only_overdue: '1',
        page: '2',
        page_size: '50',
      })
    ).toEqual({
      module_key: 'incoming_quality',
      risk_level: 'high',
      response_mode: 'eight_d',
      only_assigned_to_me: false,
      only_actionable_to_me: true,
      only_created_by_me: true,
      only_overdue: true,
      page: 2,
      page_size: 50,
    })
  })
})
