import type { components } from '@qms/contracts';

type ImportBody = components['schemas']['ImportAuditRowDto'];
export type AuditImportSource = ImportBody['sourceSystem'];
export type AuditImportError = { rowNumber: number; field: string; message: string };
export type AuditImportInput = Omit<ImportBody, 'organizationId'> & { rowNumber: number };

export const auditImportFields = [
  'sourceSystem', 'externalKey', 'customerKey', 'auditDate', 'auditType', 'finding',
  'severity', 'responsibleScope', 'responseForm', 'sourceUrl',
] as const;
type AuditImportField = typeof auditImportFields[number];

const requiredFields: readonly AuditImportField[] = ['sourceSystem', 'externalKey', 'finding'];
const maxLength: Partial<Record<AuditImportField, number>> = {
  externalKey: 200, customerKey: 200, auditType: 100, finding: 10000, severity: 32,
  responsibleScope: 100, sourceUrl: 2000,
};

function text(value: unknown): string {
  return value == null ? '' : value instanceof Date ? value.toISOString() : String(value).trim();
}

function parseDate(value: unknown): string | undefined {
  const valueText = text(value);
  if (!valueText) return undefined;
  const parsed = new Date(valueText);
  return Number.isNaN(parsed.getTime()) || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(valueText) ? undefined : parsed.toISOString();
}

export function parseAuditImportRows(sheet: readonly (readonly unknown[])[]): { rows: AuditImportInput[]; errors: AuditImportError[] } {
  const errors: AuditImportError[] = [];
  const rows: AuditImportInput[] = [];
  const headers = Array.from({ length: sheet[0]?.length ?? 0 }, (_, index) => text(sheet[0]?.[index]));
  const allowed = new Set<string>(auditImportFields);
  const seen = new Set<string>();
  headers.forEach((header, index) => {
    if (!header || !allowed.has(header) || seen.has(header)) {
      errors.push({ rowNumber: 1, field: header || `列 ${index + 1}`, message: seen.has(header) ? '重复列名' : header ? '不支持的列名' : '列名不能为空' });
    }
    seen.add(header);
  });
  for (const field of requiredFields) if (!seen.has(field)) errors.push({ rowNumber: 1, field, message: '缺少必填列' });
  if (errors.length) return { rows, errors };

  for (let index = 1; index < sheet.length; index += 1) {
    const cells = sheet[index] ?? [];
    if (cells.every((value) => text(value) === '')) continue;
    const rowNumber = index + 1;
    const raw = Object.fromEntries(headers.map((field, column) => [field, cells[column]])) as Record<string, unknown>;
    const rowErrors: AuditImportError[] = [];
    for (let column = 0; column < cells.length; column += 1) {
      if (!headers[column] && text(cells[column])) rowErrors.push({ rowNumber, field: `列 ${column + 1}`, message: '列名为空，数据不能导入' });
    }
    for (const field of headers) {
      if (raw[field] && typeof raw[field] === 'object' && !(raw[field] instanceof Date)) rowErrors.push({ rowNumber, field, message: '不支持公式或富文本单元格' });
    }
    const values: Record<string, unknown> = {};
    for (const field of headers) {
      const value = text(raw[field]);
      if (requiredFields.includes(field as AuditImportField) && !value) rowErrors.push({ rowNumber, field, message: '必填' });
      const limit = maxLength[field as AuditImportField];
      if (limit && value.length > limit) rowErrors.push({ rowNumber, field, message: `最多 ${limit} 字` });
      if (value) values[field] = value;
    }
    const sourceSystem = values.sourceSystem;
    if (sourceSystem && !['CUSTOMER', 'SECOND_PARTY'].includes(String(sourceSystem))) rowErrors.push({ rowNumber, field: 'sourceSystem', message: '仅支持 CUSTOMER 或 SECOND_PARTY' });
    if (values.auditDate && !parseDate(values.auditDate)) rowErrors.push({ rowNumber, field: 'auditDate', message: '需要带时区的日期时间' });
    if (values.responseForm && !['BRIEF', 'EIGHT_D'].includes(String(values.responseForm))) rowErrors.push({ rowNumber, field: 'responseForm', message: '仅支持 BRIEF 或 EIGHT_D' });
    if (values.sourceUrl) {
      try { if (!['http:', 'https:'].includes(new URL(String(values.sourceUrl)).protocol)) throw new Error(); }
      catch { rowErrors.push({ rowNumber, field: 'sourceUrl', message: '需要 HTTP 或 HTTPS 链接' }); }
    }
    const payload: Record<string, unknown> = { ...values };
    if (values.auditDate) payload.auditDate = parseDate(values.auditDate) ?? values.auditDate;
    delete payload.sourceSystem;
    delete payload.externalKey;
    errors.push(...rowErrors);
    rows.push({ rowNumber, sourceSystem: sourceSystem as AuditImportSource, externalKey: String(values.externalKey ?? ''), payload: payload as ImportBody['payload'] });
  }
  if (rows.length < 1 || rows.length > 100) errors.push({ rowNumber: 1, field: 'rows', message: '每次需要 1–100 条非空数据行' });
  return { rows, errors };
}

async function checkZipSize(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 22 || bytes.length > 2 * 1024 * 1024) throw new Error('Excel 文件不能超过 2 MB');
  const view = new DataView(buffer);
  const start = Math.max(0, bytes.length - 65557);
  let endRecord = -1;
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { endRecord = offset; break; }
  }
  if (endRecord < 0) throw new Error('Excel ZIP 结构无效');
  const count = view.getUint16(endRecord + 10, true);
  const directorySize = view.getUint32(endRecord + 12, true);
  let offset = view.getUint32(endRecord + 16, true);
  if (view.getUint16(endRecord + 4, true) !== 0 || view.getUint16(endRecord + 6, true) !== 0 || !count || count > 100 || directorySize === 0xffffffff || offset === 0xffffffff || offset + directorySize > endRecord) throw new Error('Excel ZIP 结构无效');
  const end = offset + directorySize;
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Excel ZIP 结构无效');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const localOffset = view.getUint32(offset + 42, true);
    const length = 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (flags & 1 || ![0, 8].includes(method) || compressed === 0xffffffff || uncompressed === 0xffffffff || localOffset === 0xffffffff || offset + length > end || localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('Excel ZIP 结构无效');
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (view.getUint16(localOffset + 8, true) !== method || dataStart + compressed > end) throw new Error('Excel ZIP 结构无效');
    total += uncompressed;
    if (uncompressed > 4 * 1024 * 1024 || total > 8 * 1024 * 1024 || (uncompressed > 0 && compressed === 0) || (compressed > 0 && uncompressed / compressed > 200)) throw new Error('Excel 解压后内容过大');
    let actualSize = compressed;
    if (method === 8) {
      actualSize = 0;
      const data = bytes.subarray(dataStart, dataStart + compressed);
      let position = 0;
      const source = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (position === data.length) { controller.close(); return; }
          const next = Math.min(position + 64 * 1024, data.length);
          controller.enqueue(data.subarray(position, next));
          position = next;
        },
      });
      const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          actualSize += value.byteLength;
          if (actualSize > 4 * 1024 * 1024 || total - uncompressed + actualSize > 8 * 1024 * 1024) throw new Error('Excel 解压后内容过大');
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'Excel 解压后内容过大') throw error;
        throw new Error('Excel ZIP 结构无效');
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    }
    if (actualSize !== uncompressed) throw new Error('Excel ZIP 结构无效');
    offset += length;
  }
  if (offset !== end) throw new Error('Excel ZIP 结构无效');
}

export async function readAuditImportWorkbook(file: File) {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('仅支持 .xlsx 文件');
  if (file.size > 2 * 1024 * 1024) throw new Error('Excel 文件不能超过 2 MB');
  const buffer = await file.arrayBuffer();
  await checkZipSize(buffer);
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); } catch { throw new Error('Excel 文件无法解析，请检查文件格式'); }
  if (!workbook.worksheets[0]) throw new Error('Excel 文件没有工作表');
  if (workbook.worksheets.length > 10) throw new Error('工作表不能超过 10 个');
  const sheet: unknown[][] = [];
  let dataRows = 0;
  workbook.worksheets[0].eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber > 10000 || rowNumber > 1 && ++dataRows > 100) throw new Error('每次最多 100 条数据行');
    const cells: unknown[] = [];
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      if (columnNumber > 100) throw new Error('列号不能超过 100');
      cells[columnNumber - 1] = cell.value;
    });
    sheet[rowNumber - 1] = cells;
  });
  return parseAuditImportRows(sheet);
}
