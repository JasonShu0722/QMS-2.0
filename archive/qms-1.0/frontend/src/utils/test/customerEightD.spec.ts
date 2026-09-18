import { describe, expect, it } from 'vitest'

import {
  buildEightDD4D7Payload,
  buildEightDD8Payload,
  canManageEightDComplaintScope,
  canRemoveComplaintFromEightDScope,
  canSwitchEightDPrimaryComplaint,
  createEmptyD4D7Data,
  createEmptyD8Data,
  deriveD4D7FormState,
  deriveD8FormState,
  getEightDApprovalLevelLabel,
  getEightDD0D3ComplaintSourceSummary,
  getEightDComplaintScopeSummary,
  getEightDComplaintTypeLabel,
  getEightDNextStepHint,
  getEightDSLAIndicator,
  getEightDStatusLabel,
  getPreferredEightDTab,
  normalizeEightDCustomer,
} from '@/utils/customerEightD'
import { ApprovalLevel, EightDStatus, type EightDCustomerSubmit, type EightDD8Submit } from '@/types/customer-quality'

describe('customerEightD helpers', () => {
  it('normalizes backend 8D payloads for the current page shape', () => {
    const normalized = normalizeEightDCustomer({
      id: 1,
      complaint_id: 10,
      related_complaints: [
        {
          complaint_id: 10,
          complaint_number: 'CC-001',
          complaint_type: '0km',
          customer_code: 'C001',
          customer_name: '客户A',
          is_primary: true,
        },
      ],
      status: EightDStatus.D4_D7_COMPLETED,
      approval_level: ApprovalLevel.NONE,
      d0_d3_cqe: {
        problem_description: 'Issue summary',
      },
      d4_d7_responsible: {
        d4_root_cause: {
          analysis_method: '5Why',
          root_cause: 'Root cause',
        },
        d5_corrective_actions: [{ action: 'Corrective action 1' }, { action: 'Corrective action 2' }],
        d6_verification: {
          verification_report: '/files/report.pdf',
        },
        d7_standardization: {
          document_modified: true,
          modified_files: ['PFMEA', 'CP'],
        },
      },
      d8_horizontal: {
        horizontal_deployment: [{ product: 'Product A' }, { product: 'Product B' }],
        lesson_learned: {
          should_archive: true,
          lesson_content: 'Lessons learned',
        },
      },
      created_at: '2026-04-22T08:00:00',
      updated_at: '2026-04-22T08:00:00',
    })

    expect(normalized.related_complaints).toHaveLength(1)
    expect(normalized.d4_d7_responsible?.analysis_method).toBe('5Why')
    expect(normalized.d4_d7_responsible?.corrective_actions).toContain('Corrective action 1')
    expect(normalized.d8_horizontal?.horizontal_deployment).toEqual(['Product A', 'Product B'])
    expect(normalized.d8_horizontal?.save_to_library).toBe(true)
  })

  it('builds a backend-compatible D4-D7 payload from the legacy page form', () => {
    const payload = buildEightDD4D7Payload({
      d4_d7_data: {
        root_cause: 'Detailed root cause over twenty chars',
        analysis_method: '5Why',
        corrective_actions: 'Detailed corrective action',
        verification_report_url: '/files/report.pdf',
        standardization: true,
        standardization_files: ['PFMEA'],
      },
    } satisfies EightDCustomerSubmit)

    expect(payload.d4_root_cause.analysis_method).toBe('5Why')
    expect(payload.d5_corrective_actions[0].action).toBe('Detailed corrective action')
    expect(payload.d6_verification.verification_report).toBe('/files/report.pdf')
    expect(payload.d7_standardization.document_modified).toBe(true)
  })

  it('builds a backend-compatible D8 payload from the legacy page form', () => {
    const payload = buildEightDD8Payload({
      d8_data: {
        horizontal_deployment: ['Product A'],
        lessons_learned: 'Lessons learned summary',
        save_to_library: true,
      },
    } satisfies EightDD8Submit)

    expect(payload.horizontal_deployment).toEqual([
      {
        product: 'Product A',
        action: '应用本次 8D 对策',
        status: 'pending',
      },
    ])
    expect(payload.lesson_learned.should_archive).toBe(true)
    expect(payload.lesson_learned.lesson_content).toBe('Lessons learned summary')
  })

  it('returns readable labels and next-step hints', () => {
    expect(getEightDStatusLabel(EightDStatus.D4_D7_IN_PROGRESS)).toBe('D4-D7 进行中')
    expect(getEightDStatusLabel(undefined)).toBe('已发起')
    expect(getEightDApprovalLevelLabel(ApprovalLevel.SECTION_MANAGER)).toBe('科室经理')
    expect(getEightDApprovalLevelLabel(undefined)).toBe('未设置')
    expect(getEightDComplaintTypeLabel('0km')).toBe('0KM')
    expect(getEightDComplaintTypeLabel('after_sales')).toBe('售后')
    expect(getEightDNextStepHint(EightDStatus.IN_REVIEW)).toContain('等待审批人处理')
    expect(getEightDNextStepHint(EightDStatus.REJECTED)).toContain('已被驳回')
  })

  it('summarizes complaint scope for single and batch 8D reports', () => {
    expect(getEightDComplaintScopeSummary()).toContain('暂未关联')
    expect(
      getEightDComplaintScopeSummary([
        {
          complaint_id: 1,
          complaint_number: 'CC-001',
          complaint_type: '0km',
          customer_code: 'C001',
          customer_name: '客户A',
          is_primary: true,
        },
      ])
    ).toContain('关联 1 条客诉')

    expect(
      getEightDComplaintScopeSummary([
        {
          complaint_id: 1,
          complaint_number: 'CC-001',
          complaint_type: '0km',
          customer_code: 'C001',
          customer_name: '客户A',
          is_primary: true,
        },
        {
          complaint_id: 2,
          complaint_number: 'CC-002',
          complaint_type: '0km',
          customer_code: 'C001',
          customer_name: '客户A',
          is_primary: false,
        },
      ])
    ).toContain('主客诉为 CC-001')
  })

  it('summarizes D0-D3 source complaint metadata for single and batch reports', () => {
    expect(getEightDD0D3ComplaintSourceSummary()).toBe('-')
    expect(
      getEightDD0D3ComplaintSourceSummary({
        source_complaint_number: 'CC-001',
        related_complaint_count: 1,
      })
    ).toBe('来源客诉：CC-001')
    expect(
      getEightDD0D3ComplaintSourceSummary({
        source_complaint_numbers: ['CC-001', 'CC-002'],
        related_complaint_count: 2,
      })
    ).toBe('来源客诉 2 条：CC-001、CC-002')
  })

  it('supports scope-management visibility rules on the 8D page', () => {
    expect(canManageEightDComplaintScope(EightDStatus.D4_D7_IN_PROGRESS)).toBe(true)
    expect(canManageEightDComplaintScope(EightDStatus.IN_REVIEW)).toBe(false)
    expect(
      canSwitchEightDPrimaryComplaint({ is_primary: false }, EightDStatus.D4_D7_IN_PROGRESS)
    ).toBe(true)
    expect(
      canSwitchEightDPrimaryComplaint({ is_primary: true }, EightDStatus.D4_D7_IN_PROGRESS)
    ).toBe(false)
    expect(
      canRemoveComplaintFromEightDScope({ complaint_id: 2, is_primary: false }, 1)
    ).toBe(true)
    expect(
      canRemoveComplaintFromEightDScope({ complaint_id: 1, is_primary: false }, 1)
    ).toBe(false)
    expect(
      canRemoveComplaintFromEightDScope({ complaint_id: 2, is_primary: true }, 1)
    ).toBe(false)
  })

  it('derives readable SLA indicators', () => {
    expect(
      getEightDSLAIndicator({
        eight_d_status: EightDStatus.APPROVED,
        is_submission_overdue: false,
        is_archive_overdue: false,
        remaining_days: 3,
      })
    ).toEqual({ label: '剩余 3 天', tagType: 'info' })

    expect(
      getEightDSLAIndicator({
        eight_d_status: EightDStatus.APPROVED,
        is_submission_overdue: false,
        is_archive_overdue: true,
        remaining_days: -2,
      })
    ).toEqual({ label: '已超期 2 天', tagType: 'danger' })

    expect(
      getEightDSLAIndicator({
        eight_d_status: EightDStatus.CLOSED,
        is_submission_overdue: false,
        is_archive_overdue: false,
        remaining_days: 0,
      })
    ).toEqual({ label: '已归档', tagType: 'success' })
  })

  it('creates clean empty form states for new or missing reports', () => {
    expect(createEmptyD4D7Data()).toEqual({
      root_cause: '',
      analysis_method: '',
      corrective_actions: '',
      verification_report_url: '',
      standardization: false,
      standardization_files: [],
    })
    expect(createEmptyD8Data()).toEqual({
      horizontal_deployment: [],
      lessons_learned: '',
      save_to_library: false,
    })
  })

  it('derives cloned form state from existing normalized 8D content', () => {
    const d4d7 = deriveD4D7FormState({
      root_cause: 'Root cause',
      analysis_method: '5Why',
      corrective_actions: 'Action',
      verification_report_url: '/files/report.pdf',
      standardization: true,
      standardization_files: ['PFMEA'],
    })
    const d8 = deriveD8FormState({
      horizontal_deployment: ['Product A'],
      lessons_learned: 'Lessons learned',
      save_to_library: true,
    })

    expect(d4d7.standardization_files).toEqual(['PFMEA'])
    expect(d8.horizontal_deployment).toEqual(['Product A'])

    d4d7.standardization_files?.push('CP')
    d8.horizontal_deployment.push('Product B')

    expect(deriveD4D7FormState().standardization_files).toEqual([])
    expect(deriveD8FormState().horizontal_deployment).toEqual([])
  })

  it('chooses the most useful active tab based on 8D status', () => {
    expect(getPreferredEightDTab(EightDStatus.D4_D7_IN_PROGRESS)).toBe('d4-d7')
    expect(getPreferredEightDTab(EightDStatus.D8_IN_PROGRESS)).toBe('d8')
    expect(getPreferredEightDTab(EightDStatus.IN_REVIEW)).toBe('review')
    expect(getPreferredEightDTab(EightDStatus.CLOSED)).toBe('d8')
  })
})
