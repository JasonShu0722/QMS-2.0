import type { components } from '@qms/contracts';
import { readXlsxFile } from '../imports/read-xlsx';

export type LedgerFields = components['schemas']['CustomerLedgerFieldsDto'];
export const ledgerFields = [
  ['customerName', '客户'], ['terminalCustomerName', '终端客户'], ['complaintType', '客诉类型'],
  ['componentCode', '组件号'], ['productModel', '产品型号'], ['quantity', '件数'],
  ['defectDescription', '详细故障描述'], ['occurredOn', '发生日期'], ['occurredAtLocation', '发生地点'], ['occurredAtRegion', '发生区域'],
  ['productionOn', '生产日期'], ['onlineOn', '上线日期'], ['vehicleDeliveryOn', '车辆交付日期'], ['vehicleOfflineOn', '车辆下线日期'],
  ['purchaseOn', '购车日期'], ['vin', 'VIN'], ['barcode', '追溯码'], ['batch', '批次'], ['mileage', '故障里程'],
  ['serviceMode', '服务方式'], ['interceptionStatus', '拦截状态'],
] as const satisfies readonly (readonly [keyof LedgerFields, string])[];

export function rawText(value: unknown): string {
  return value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function parseLedgerSheet(sheet: readonly (readonly unknown[])[]): components['schemas']['CustomerLedgerImportRowDto'][] {
  const headers = sheet[0] ?? [];
  const fields = Array.from(headers, header => ledgerFields.find(([key, label]) => header === label || header === key)?.[0]);
  if (!fields.length || fields.some(field => !field) || new Set(fields).size !== fields.length) throw new Error('列名为空、未知或重复，请使用列说明中的中文表头。');
  const rows: components['schemas']['CustomerLedgerImportRowDto'][] = [];
  for (let index = 1; index < sheet.length; index++) {
    const cells = sheet[index] ?? [];
    if (cells.every(value => value == null || typeof value === 'string' && value.trim() === '')) continue;
    if (cells.slice(headers.length).some(value => value != null && value !== '')) throw new Error(`第 ${index + 1} 行含无表头数据，不能丢弃。`);
    const raw: Partial<Record<keyof LedgerFields, string | number | boolean | null>> = {};
    for (const [column, field] of fields.entries()) {
      if (!field) continue;
      const value = cells[column] ?? null;
      if (value instanceof Date) {
        if (!Number.isFinite(value.getTime())) throw new Error(`第 ${index + 1} 行日期单元格无法读取。`);
        raw[field] = value.toISOString().slice(0, 10);
      } else if (typeof value === 'object' && value !== null) throw new Error(`第 ${index + 1} 行包含公式或富文本，请改为原始值。`);
      else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
        if ((typeof value === 'string' && (value.length > 20000 || value.includes('\0'))) || (typeof value === 'number' && !Number.isFinite(value))) throw new Error(`第 ${index + 1} 行超出原文安全边界；未截断或丢弃，请分批整理。`);
        raw[field] = value;
      } else throw new Error(`第 ${index + 1} 行存在无法读取的单元格。`);
    }
    if (new TextEncoder().encode(JSON.stringify(raw)).length > 64000) throw new Error(`第 ${index + 1} 行原文超过 64000 字节，请拆分整理。`);
    rows.push({ rowNumber: index + 1, action: 'ADD', fields: raw });
    if (rows.length > 100) throw new Error('每次需要 1–100 条非空数据行。');
  }
  if (!rows.length || rows.length > 100) throw new Error('每次需要 1–100 条非空数据行。');
  return rows;
}

export function parseLedgerTsv(text: string) {
  if (new TextEncoder().encode(text).length > 6 * 1024 * 1024) throw new Error('粘贴内容过大，请分批处理。');
  const sheet: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false; let closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === '\t' || char === '\n' || char === '\r') {
      row.push(cell); cell = ''; closed = false;
      if (char !== '\t') { sheet.push(row); row = []; if (char === '\r' && text[i + 1] === '\n') i++; }
    } else if (closed) throw new Error('粘贴内容引号结构无效，请直接复制 Excel 单元格。');
    else if (char === '"' && cell === '') quoted = true;
    else cell += char;
  }
  if (quoted) throw new Error('粘贴内容引号未闭合。');
  row.push(cell); sheet.push(row);
  return parseLedgerSheet(sheet);
}

// Count after discarding wholly blank rows; retain the reader's ZIP, byte and physical-row safety limits.
export async function readLedgerWorkbook(file: File) { return parseLedgerSheet(await readXlsxFile(file, { mode: 'master-data' })); }
