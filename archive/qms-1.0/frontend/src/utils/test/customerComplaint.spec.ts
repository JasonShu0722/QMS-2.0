import { describe, expect, it } from 'vitest'
import {
  buildCustomerComplaintAnalysisStatusOptions,
  canBatchLaunchCustomerComplaintEightD,
  canLaunchCustomerComplaintEightDSelection,
  buildCustomerComplaintDispositionStatusOptions,
  buildCustomerComplaintStatusOptions,
  canHandleCustomerComplaintAnalysis,
  canHandleCustomerComplaintDisposition,
  canOpenCustomerComplaintEightD,
  getCustomerComplaintBatchLaunchHint,
  getCustomerComplaintEightDSelectionLaunchHint,
  getCustomerComplaintEightDActionLabel,
  getCustomerComplaintDispositionStatusLabel,
  getCustomerComplaintDispositionStatusType,
  getCustomerComplaintNextStepHint,
  getCustomerComplaintPhysicalAnalysisStatusLabel,
  getCustomerComplaintPhysicalAnalysisStatusType,
  getCustomerComplaintStatusLabel,
  getCustomerComplaintStatusType,
} from '@/utils/customerComplaint'
import { ComplaintType } from '@/types/customer-quality'

describe('customer complaint helpers', () => {
  it('maps backend statuses to readable labels and tag types', () => {
    expect(getCustomerComplaintStatusLabel('pending')).toBe('待处理')
    expect(getCustomerComplaintStatusLabel('in_response')).toBe('待回复')
    expect(getCustomerComplaintStatusType('closed')).toBe('success')
    expect(getCustomerComplaintStatusType('rejected')).toBe('danger')
  })

  it('keeps legacy customer complaint statuses compatible during transition', () => {
    expect(getCustomerComplaintStatusLabel('pending_analysis')).toBe('待一次因分析')
    expect(getCustomerComplaintStatusType('under_review')).toBe('info')
  })

  it('builds the current complaint status options in backend order', () => {
    expect(buildCustomerComplaintStatusOptions().map((item) => item.value)).toEqual([
      'pending',
      'in_analysis',
      'in_response',
      'in_review',
      'rejected',
      'closed',
    ])
  })

  it('exposes physical disposition labels and options', () => {
    expect(getCustomerComplaintDispositionStatusLabel('pending')).toBe('待备案')
    expect(getCustomerComplaintDispositionStatusType('completed')).toBe('success')
    expect(buildCustomerComplaintDispositionStatusOptions().map((item) => item.value)).toEqual([
      'in_progress',
      'completed',
    ])
  })

  it('exposes physical analysis labels and options', () => {
    expect(getCustomerComplaintPhysicalAnalysisStatusLabel('pending')).toBe('待分派')
    expect(getCustomerComplaintPhysicalAnalysisStatusType('assigned')).toBe('primary')
    expect(buildCustomerComplaintAnalysisStatusOptions().map((item) => item.value)).toEqual([
      'assigned',
      'completed',
    ])
  })

  it('derives action availability from complaint status and analysis requirement', () => {
    expect(
      canHandleCustomerComplaintAnalysis({
        status: 'pending',
        requires_physical_analysis: true,
      })
    ).toBe(true)
    expect(
      canHandleCustomerComplaintAnalysis({
        status: 'closed',
        requires_physical_analysis: true,
      })
    ).toBe(false)
    expect(
      canHandleCustomerComplaintAnalysis({
        status: 'pending',
        requires_physical_analysis: false,
      })
    ).toBe(false)

    expect(
      canHandleCustomerComplaintDisposition({
        status: 'pending',
        requires_physical_analysis: false,
      })
    ).toBe(true)
    expect(
      canHandleCustomerComplaintDisposition({
        status: 'closed',
        requires_physical_analysis: false,
      })
    ).toBe(false)

    expect(
      canOpenCustomerComplaintEightD({
        requires_physical_analysis: true,
        physical_analysis_status: 'completed',
        physical_disposition_plan: undefined,
        eight_d_report_id: undefined,
      })
    ).toBe(true)
    expect(
      canOpenCustomerComplaintEightD({
        requires_physical_analysis: false,
        physical_analysis_status: 'pending',
        physical_disposition_plan: '已完成实物处理方案备案',
        eight_d_report_id: undefined,
      })
    ).toBe(true)
    expect(
      canOpenCustomerComplaintEightD({
        requires_physical_analysis: true,
        physical_analysis_status: 'assigned',
        physical_disposition_plan: undefined,
        eight_d_report_id: undefined,
      })
    ).toBe(false)
  })

  it('exposes current 8D action labels and next-step hints', () => {
    expect(getCustomerComplaintEightDActionLabel({ eight_d_report_id: 12 })).toBe('查看8D')
    expect(getCustomerComplaintEightDActionLabel({ eight_d_report_id: undefined })).toBe('发起8D')

    expect(
      getCustomerComplaintNextStepHint({
        requires_physical_analysis: true,
        physical_analysis_status: 'pending',
        physical_disposition_plan: undefined,
        eight_d_report_id: undefined,
      })
    ).toContain('待分派实物解析责任人')

    expect(
      getCustomerComplaintNextStepHint({
        requires_physical_analysis: false,
        physical_analysis_status: 'pending',
        physical_disposition_plan: '按方案返修',
        eight_d_report_id: undefined,
      })
    ).toContain('已备案')

    expect(
      getCustomerComplaintNextStepHint({
        requires_physical_analysis: true,
        physical_analysis_status: 'completed',
        physical_disposition_plan: undefined,
        eight_d_report_id: 1,
      })
    ).toContain('已进入 8D 报告跟进')
  })
  it('validates batch 8D launch readiness and scope', () => {
    const readyComplaints = [
      {
        complaint_type: ComplaintType.ZERO_KM,
        customer_id: 1,
        customer_code: 'CUST001',
        requires_physical_analysis: false,
        physical_analysis_status: 'pending',
        physical_disposition_plan: '已完成备案',
        eight_d_report_id: undefined,
      },
      {
        complaint_type: ComplaintType.ZERO_KM,
        customer_id: 1,
        customer_code: 'CUST001',
        requires_physical_analysis: true,
        physical_analysis_status: 'completed',
        physical_disposition_plan: undefined,
        eight_d_report_id: undefined,
      },
    ] as const

    expect(canBatchLaunchCustomerComplaintEightD([...readyComplaints])).toBe(true)
    expect(getCustomerComplaintBatchLaunchHint([...readyComplaints])).toBe('')
    expect(getCustomerComplaintBatchLaunchHint([readyComplaints[0]])).toContain('至少选择两条')

    expect(
      getCustomerComplaintBatchLaunchHint([
        readyComplaints[0],
        { ...readyComplaints[1], customer_code: 'CUST002' },
      ])
    ).toContain('同一客户')

    expect(
      getCustomerComplaintBatchLaunchHint([
        readyComplaints[0],
        { ...readyComplaints[1], complaint_type: ComplaintType.AFTER_SALES },
      ])
    ).toContain('同一客诉类型')

    expect(
      getCustomerComplaintBatchLaunchHint([
        readyComplaints[0],
        { ...readyComplaints[1], physical_analysis_status: 'assigned' },
      ])
    ).toContain('实物处理备案或实物解析')

    expect(
      getCustomerComplaintBatchLaunchHint([
        readyComplaints[0],
        { ...readyComplaints[1], eight_d_report_id: 9 },
      ])
    ).toContain('已发起 8D')
  })

  it('allows selected 8D launch with a single ready complaint', () => {
    const readyComplaint = {
      complaint_type: ComplaintType.ZERO_KM,
      customer_id: 1,
      customer_code: 'CUST001',
      requires_physical_analysis: false,
      physical_analysis_status: 'pending',
      physical_disposition_plan: '已完成备案',
      eight_d_report_id: undefined,
    } as const

    expect(canLaunchCustomerComplaintEightDSelection([readyComplaint])).toBe(true)
    expect(getCustomerComplaintEightDSelectionLaunchHint([readyComplaint])).toBe('')
    expect(getCustomerComplaintEightDSelectionLaunchHint([])).toContain('至少选择一条')
    expect(
      getCustomerComplaintEightDSelectionLaunchHint([
        { ...readyComplaint, physical_disposition_plan: undefined },
      ])
    ).toContain('实物处理方案备案或实物解析')
  })
})
