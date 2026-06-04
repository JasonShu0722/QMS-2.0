import { ComplaintType, type CustomerComplaintCreate, type CustomerComplaintCustomerOption } from '@/types/customer-quality'

export const CUSTOMER_COMPLAINT_BATCH_IMPORT_MAX_ITEMS = 100

type ComplaintField = keyof CustomerComplaintCreate

export interface CustomerComplaintBatchParseOptions {
  complaintType: ComplaintType
  customers?: CustomerComplaintCustomerOption[]
  isReturnRequired?: boolean
  requiresPhysicalAnalysis?: boolean
}

export interface CustomerComplaintBatchImportItem {
  rowNumber: number
  payload: CustomerComplaintCreate
}

const HEADER_FIELD_MAP: Record<string, ComplaintField | 'ignore'> = {
  序号: 'ignore',
  客诉类型: 'complaint_type',
  类型: 'complaint_type',
  客户代码: 'customer_code',
  客户编码: 'customer_code',
  客户名称: 'customer_name',
  客户: 'customer_name',
  终端客户: 'end_customer_name',
  收件日期: 'received_date',
  发生日期: 'occurrence_date',
  故障日期: 'occurrence_date',
  生产日期: 'production_date',
  产品出厂日期: 'production_date',
  产品类型: 'product_type',
  产品型号: 'product_model',
  项目阶段: 'project_stage',
  批次号: 'batch_code',
  批次号条码: 'batch_code',
  条码: 'batch_code',
  产品追溯码: 'trace_code',
  追溯码: 'trace_code',
  零星退件集中退件: 'return_type',
  退件类型: 'return_type',
  退件月份: 'return_month',
  详细故障描述: 'defect_description',
  故障描述: 'defect_description',
  缺陷描述: 'defect_description',
  问题描述: 'defect_description',
  故障数: 'failure_count',
  故障分类: 'fault_category',
  服务月数: 'service_months',
  服务月分类: 'service_month_category',
  解析优先级: 'analysis_priority',
  '4s店名称': 'dealer_name',
  '4s店': 'dealer_name',
  发生区域: 'occurrence_region',
  服务方式: 'service_method',
  车辆vin码: 'vin_code',
  vin码: 'vin_code',
  vin: 'vin_code',
  里程: 'mileage',
  失效里程: 'mileage',
  里程分类: 'mileage_category',
  购车日期: 'purchase_date',
  涉及退件: 'is_return_required',
  是否退件: 'is_return_required',
  实物解析: 'requires_physical_analysis',
  是否解析: 'requires_physical_analysis',
  '8d报告编号': 'ignore',
}

function splitImportLine(line: string): string[] {
  const normalized = line.replace(/^\uFEFF/, '').trim()
  if (!normalized) {
    return []
  }

  if (normalized.includes('\t')) {
    return normalized.split('\t').map((cell) => cell.trim())
  }

  if (normalized.includes(',')) {
    return normalized.split(',').map((cell) => cell.trim())
  }

  if (normalized.includes('，')) {
    return normalized.split('，').map((cell) => cell.trim())
  }

  return normalized.split(/\s{2,}/).map((cell) => cell.trim())
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[()（）/\\]/g, '')
    .toLowerCase()
}

function resolveHeaderField(value: string): ComplaintField | 'ignore' | undefined {
  return HEADER_FIELD_MAP[normalizeHeader(value)]
}

function looksLikeHeader(cells: string[]): boolean {
  return cells.filter((cell) => resolveHeaderField(cell)).length >= 2
}

function normalizeDate(value: string): string | undefined {
  const text = value.trim()
  if (!text || text === '-' || text.toLowerCase() === 'na') {
    return undefined
  }

  const serial = Number(text)
  if (Number.isInteger(serial) && serial > 20000 && serial < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 24 * 60 * 60 * 1000)
    return date.toISOString().slice(0, 10)
  }

  const match = text.match(/^(\d{4})[./年-](\d{1,2})[./月-](\d{1,2})日?$/)
  if (!match) {
    return text
  }

  const [, year, month, day] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function normalizeNumber(value: string): number | undefined {
  const text = value.trim().replace(/,/g, '')
  if (!text || text === '-') {
    return undefined
  }

  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeBoolean(value: string): boolean | undefined {
  const text = value.trim().toLowerCase()
  if (!text) {
    return undefined
  }
  if (['是', '涉及', '需要', 'true', 'yes', 'y', '1'].includes(text)) {
    return true
  }
  if (['否', '不涉及', '无需', 'false', 'no', 'n', '0'].includes(text)) {
    return false
  }
  return undefined
}

function normalizeComplaintType(value: string): ComplaintType | undefined {
  const text = value.trim().toLowerCase()
  if (!text) {
    return undefined
  }
  if (text.includes('售后') || text.includes('after')) {
    return ComplaintType.AFTER_SALES
  }
  if (text.includes('0km') || text.includes('0公里') || text.includes('零公里')) {
    return ComplaintType.ZERO_KM
  }
  return undefined
}

function applyCell(payload: CustomerComplaintCreate, field: ComplaintField | 'ignore' | undefined, value: string) {
  if (!field || field === 'ignore' || !value.trim()) {
    return
  }

  const mutablePayload = payload as unknown as Record<string, unknown>

  if (
    field === 'received_date' ||
    field === 'occurrence_date' ||
    field === 'production_date' ||
    field === 'purchase_date'
  ) {
    mutablePayload[field] = normalizeDate(value)
    return
  }

  if (field === 'failure_count' || field === 'mileage' || field === 'service_months') {
    mutablePayload[field] = normalizeNumber(value)
    return
  }

  if (field === 'is_return_required' || field === 'requires_physical_analysis') {
    const parsed = normalizeBoolean(value)
    if (parsed !== undefined) {
      mutablePayload[field] = parsed
    }
    return
  }

  if (field === 'complaint_type') {
    const parsed = normalizeComplaintType(value)
    if (parsed) {
      payload.complaint_type = parsed
    }
    return
  }

  mutablePayload[field] = value.trim()
}

function findCustomer(
  payload: CustomerComplaintCreate,
  customers: CustomerComplaintCustomerOption[]
): CustomerComplaintCustomerOption | undefined {
  const code = payload.customer_code?.trim()
  const name = payload.customer_name?.trim()
  return customers.find((customer) => customer.code === code || customer.name === name)
}

function resolveCustomer(payload: CustomerComplaintCreate, customers: CustomerComplaintCustomerOption[]) {
  const customer = findCustomer(payload, customers)
  if (!customer) {
    return
  }

  payload.customer_id = customer.id
  payload.customer_code = customer.code
  payload.customer_name = customer.name
}

function validatePayload(payload: CustomerComplaintCreate, rowNumber: number) {
  if (!payload.customer_id && !payload.customer_code?.trim() && !payload.customer_name?.trim()) {
    throw new Error(`第 ${rowNumber} 行客户不能为空`)
  }
  if (!payload.product_type?.trim()) {
    throw new Error(`第 ${rowNumber} 行产品类型不能为空`)
  }
  if (!payload.defect_description?.trim()) {
    throw new Error(`第 ${rowNumber} 行缺陷描述不能为空`)
  }
  if (payload.defect_description.trim().length < 10) {
    throw new Error(`第 ${rowNumber} 行缺陷描述至少 10 个字`)
  }
  if (payload.complaint_type === ComplaintType.AFTER_SALES) {
    if (!payload.vin_code?.trim()) {
      throw new Error(`第 ${rowNumber} 行售后客诉 VIN 不能为空`)
    }
    if (payload.mileage === undefined) {
      throw new Error(`第 ${rowNumber} 行售后客诉里程不能为空`)
    }
  }
}

function buildDefaultPayload(options: CustomerComplaintBatchParseOptions): CustomerComplaintCreate {
  return {
    complaint_type: options.complaintType,
    product_type: '',
    defect_description: '',
    is_return_required: options.isReturnRequired ?? false,
    requires_physical_analysis: options.requiresPhysicalAnalysis ?? false,
  }
}

export function parseCustomerComplaintBatchImportContent(
  content: string,
  options: CustomerComplaintBatchParseOptions
): CustomerComplaintBatchImportItem[] {
  const rows = content
    .split(/\r?\n/)
    .map((line, index) => ({ rowNumber: index + 1, cells: splitImportLine(line) }))
    .filter((row) => row.cells.length > 0)

  if (!rows.length) {
    return []
  }

  const hasHeader = looksLikeHeader(rows[0].cells)
  const headers = hasHeader ? rows[0].cells.map(resolveHeaderField) : []
  const dataRows = hasHeader ? rows.slice(1) : rows
  const customers = options.customers ?? []

  return dataRows.map((row) => {
    const payload = buildDefaultPayload(options)

    if (hasHeader) {
      row.cells.forEach((cell, index) => applyCell(payload, headers[index], cell))
    } else if (row.cells.length >= 4) {
      applyCell(payload, 'customer_code', row.cells[0])
      applyCell(payload, 'customer_name', row.cells[1])
      applyCell(payload, 'product_type', row.cells[2])
      applyCell(payload, 'defect_description', row.cells.slice(3).join(' '))
    } else if (row.cells.length === 3) {
      applyCell(payload, 'customer_name', row.cells[0])
      applyCell(payload, 'product_type', row.cells[1])
      applyCell(payload, 'defect_description', row.cells[2])
    } else {
      throw new Error(`第 ${row.rowNumber} 行至少需要客户、产品类型、缺陷描述`)
    }

    resolveCustomer(payload, customers)
    validatePayload(payload, row.rowNumber)
    return { rowNumber: row.rowNumber, payload }
  })
}
