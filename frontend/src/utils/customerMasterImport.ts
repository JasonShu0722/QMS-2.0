import type { CustomerMasterBulkCreateItem } from '@/types/admin'

export const CUSTOMER_MASTER_IMPORT_MAX_ITEMS = 500

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

  const wideSpaceCells = normalized.split(/\s{2,}/).map((cell) => cell.trim())
  if (wideSpaceCells.length >= 2) {
    return wideSpaceCells
  }

  const firstWhitespace = normalized.match(/^(\S+)\s+(.+)$/)
  if (firstWhitespace) {
    return [firstWhitespace[1].trim(), firstWhitespace[2].trim()]
  }

  return [normalized]
}

export function parseCustomerMasterImportContent(content: string): CustomerMasterBulkCreateItem[] {
  return content
    .split(/\r?\n/)
    .map((line) => splitImportLine(line))
    .filter((cells) => cells.length > 0)
    .map((cells, index) => {
      if (cells.length < 2 || cells.length > 5) {
        throw new Error(`第 ${index + 1} 行需要填写 2 到 5 列数据`)
      }

      const [code, name, contactPerson, contactEmail, contactPhone] = cells
      if (!code || !name) {
        throw new Error(`第 ${index + 1} 行客户代码和客户名称不能为空`)
      }

      return {
        code,
        name,
        contact_person: contactPerson || undefined,
        contact_email: contactEmail || undefined,
        contact_phone: contactPhone || undefined,
      }
    })
}
