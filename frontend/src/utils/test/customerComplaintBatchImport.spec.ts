import { describe, expect, it } from 'vitest'

import { ComplaintType } from '@/types/customer-quality'
import { parseCustomerComplaintBatchImportContent } from '@/utils/customerComplaintBatchImport'

describe('parseCustomerComplaintBatchImportContent', () => {
  it('parses 0KM basic information pasted from the issue improvement sheet', () => {
    const items = parseCustomerComplaintBatchImportContent(
      [
        '序号\t发生日期\t生产日期\t客户名称\t终端客户\t产品类型\t产品型号\t项目阶段\t批次号（条码）\t8D报告编号\t详细故障描述\t故障数',
        '1\t2026/5/3\t2026/4/20\t东风汽车有限公司东风日产乘用车公司\t广州工厂\tMCU\tMCU-A\t量产\tBATCH-001\t\t控制器跑着跑着炸机了需要登记跟进\t2',
      ].join('\n'),
      {
        complaintType: ComplaintType.ZERO_KM,
        customers: [{ id: 7, code: '2000352', name: '东风汽车有限公司东风日产乘用车公司' }],
      }
    )

    expect(items).toHaveLength(1)
    expect(items[0].payload).toMatchObject({
      complaint_type: ComplaintType.ZERO_KM,
      customer_id: 7,
      customer_code: '2000352',
      occurrence_date: '2026-05-03',
      production_date: '2026-04-20',
      product_type: 'MCU',
      product_model: 'MCU-A',
      project_stage: '量产',
      batch_code: 'BATCH-001',
      defect_description: '控制器跑着跑着炸机了需要登记跟进',
      failure_count: 2,
    })
  })

  it('parses after-sales basic information without purchase date', () => {
    const items = parseCustomerComplaintBatchImportContent(
      [
        '收件日期\t零星退件/集中退件\t退件月份\t故障日期\t客户名称\t产品型号\t产品类型\t产品出厂日期\t服务月数\t服务月分类\t解析优先级\t产品追溯码\t车辆VIN码\t里程\t里程分类\t4S店名称\t发生区域\t详细故障描述\t故障分类\t服务方式',
        '2026-05-04\t零星退件\t2026-05\t2026.4.28\t郑州日产汽车有限公司\tVCU-A\tVCU\t2025-12-01\t13\t12-24月\tP2\tTRACE-002\tLGB61YEA0NS074109\t19944\t1-2万公里\t广州日产\t华南\t车辆报故障码无法解析申请更换总成并跟进分析\t过温故障\t更换总成',
      ].join('\n'),
      {
        complaintType: ComplaintType.AFTER_SALES,
        isReturnRequired: true,
        requiresPhysicalAnalysis: true,
      }
    )

    expect(items[0].payload).toMatchObject({
      complaint_type: ComplaintType.AFTER_SALES,
      customer_name: '郑州日产汽车有限公司',
      received_date: '2026-05-04',
      occurrence_date: '2026-04-28',
      production_date: '2025-12-01',
      return_type: '零星退件',
      return_month: '2026-05',
      product_model: 'VCU-A',
      trace_code: 'TRACE-002',
      service_months: 13,
      service_month_category: '12-24月',
      vin_code: 'LGB61YEA0NS074109',
      mileage: 19944,
      mileage_category: '1-2万公里',
      dealer_name: '广州日产',
      occurrence_region: '华南',
      fault_category: '过温故障',
      service_method: '更换总成',
      is_return_required: true,
      requires_physical_analysis: true,
    })
  })

  it('parses simple customer code/name rows pasted from a spreadsheet', () => {
    const items = parseCustomerComplaintBatchImportContent(
      '2000352\t东风汽车有限公司东风日产乘用车公司\tMCU\t控制器跑着跑着炸机了需要登记跟进',
      { complaintType: ComplaintType.ZERO_KM }
    )

    expect(items[0].payload.customer_code).toBe('2000352')
    expect(items[0].payload.customer_name).toBe('东风汽车有限公司东风日产乘用车公司')
  })
})
