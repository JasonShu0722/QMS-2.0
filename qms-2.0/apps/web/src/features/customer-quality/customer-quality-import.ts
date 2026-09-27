import type { components } from '@qms/contracts';

type ImportRow = components['schemas']['CustomerComplaintImportRowDto'];
type ImportBody = components['schemas']['ImportCustomerComplaintsDto'];
type Field = Exclude<keyof ImportRow, 'organizationId' | 'rowNumber'>;
export type ImportError = { rowNumber: number; field: string; message: string };

export function serializeComplaintImport(rows: ImportBody['rows']): string {
  const body = JSON.stringify({ rows } satisfies ImportBody);
  if (new TextEncoder().encode(body).byteLength > 5.5 * 1024 * 1024) throw new Error('导入数据超过 5.5 MB，请缩短长文本或分批导入');
  return body;
}

export const importFields = [
  'customerId', 'complaintType', 'defectDescription', 'severity', 'severityPolicyVersion',
  'severitySnapshot', 'externalSourceSystem', 'externalRecordKey', 'sourceObservedAt',
  'terminalCustomerName', 'productCode', 'productModel', 'vin', 'mileage', 'purchaseDate',
  'returnRequired', 'physicalAnalysisRequired',
] as const satisfies readonly Field[];

const requiredFields: readonly Field[] = [
  'customerId', 'complaintType', 'defectDescription', 'severity', 'severityPolicyVersion',
  'severitySnapshot', 'externalSourceSystem', 'externalRecordKey', 'sourceObservedAt',
];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const lengths: Partial<Record<Field, number>> = {
  defectDescription: 10000, severity: 32, severityPolicyVersion: 100, severitySnapshot: 10000,
  externalRecordKey: 200, terminalCustomerName: 200, productCode: 100, productModel: 100, vin: 100,
};

function cellText(value: unknown): string {
  return value == null ? '' : value instanceof Date ? value.toISOString() : String(value).trim();
}

function dateTime(value: unknown): string | undefined {
  if (typeof value !== 'string' && !(value instanceof Date)) return undefined;
  const source = value instanceof Date ? value.toISOString() : value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(source);
  if (!match) return undefined;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText); const month = Number(monthText); const day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]! || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59) return undefined;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return undefined;
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function booleanCell(value: unknown): boolean | undefined {
  if (value === true || value === false) return value;
  if (value === 'TRUE' || value === 'true' || value === 1) return true;
  if (value === 'FALSE' || value === 'false' || value === 0) return false;
  return undefined;
}

export function parseComplaintRows(sheet: readonly (readonly unknown[])[]): { rows: ImportRow[]; errors: ImportError[] } {
  const errors: ImportError[] = [];
  const rows: ImportRow[] = [];
  const headers = Array.from({ length: sheet[0]?.length ?? 0 }, (_, index) => cellText(sheet[0]?.[index]));
  const allowed = new Set<string>(importFields);
  const seen = new Set<string>();
  for (const [index, header] of headers.entries()) {
    if (!header) continue;
    if (!allowed.has(header) || seen.has(header)) errors.push({ rowNumber: 1, field: header || `列 ${index + 1}`, message: seen.has(header) ? '重复列名' : '不支持的列名' });
    seen.add(header);
  }
  for (const field of requiredFields) if (!seen.has(field)) errors.push({ rowNumber: 1, field, message: '缺少必填列' });
  if (errors.length) return { rows, errors };

  for (let index = 1; index < sheet.length; index += 1) {
    const cells = sheet[index] ?? [];
    if (cells.every((cell) => cellText(cell) === '')) continue;
    const rowNumber = index + 1;
    const raw = Object.fromEntries(headers.map((field, column) => [field, cells[column]]));
    const rowErrors: ImportError[] = [];
    for (let column = 0; column < cells.length; column += 1) {
      if (!headers[column] && cellText(cells[column])) rowErrors.push({ rowNumber, field: `列 ${column + 1}`, message: '列名为空，数据不能导入' });
    }
    for (const field of headers) {
      const value = raw[field];
      if (value && typeof value === 'object' && !(value instanceof Date)) rowErrors.push({ rowNumber, field, message: '不支持公式或富文本单元格' });
    }
    const requireText = (field: Field) => {
      const value = cellText(raw[field]);
      if (!value) rowErrors.push({ rowNumber, field, message: '必填' });
      else if (lengths[field] && value.length > lengths[field]!) rowErrors.push({ rowNumber, field, message: `最多 ${lengths[field]} 字` });
      return value;
    };
    const customerId = requireText('customerId');
    if (customerId && !uuidPattern.test(customerId)) rowErrors.push({ rowNumber, field: 'customerId', message: '需要有效 UUID' });
    const complaintType = requireText('complaintType');
    if (complaintType && !['ZERO_KM', 'AFTER_SALES'].includes(complaintType)) rowErrors.push({ rowNumber, field: 'complaintType', message: '仅支持 ZERO_KM 或 AFTER_SALES' });
    const defectDescription = requireText('defectDescription');
    const severity = requireText('severity');
    const severityPolicyVersion = requireText('severityPolicyVersion');
    const externalSourceSystem = requireText('externalSourceSystem');
    if (externalSourceSystem && !['ERP', 'SAP', 'IMS'].includes(externalSourceSystem)) rowErrors.push({ rowNumber, field: 'externalSourceSystem', message: '仅支持 ERP、SAP 或 IMS' });
    const externalRecordKey = requireText('externalRecordKey');
    const sourceObservedAt = dateTime(raw.sourceObservedAt);
    if (!sourceObservedAt) rowErrors.push({ rowNumber, field: 'sourceObservedAt', message: '需要带时区的 ISO 日期时间' });

    let severitySnapshot: ImportRow['severitySnapshot'] = {};
    try {
      const parsed: unknown = JSON.parse(requireText('severitySnapshot'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      severitySnapshot = parsed as ImportRow['severitySnapshot'];
      if ('level' in parsed && parsed.level !== severity) rowErrors.push({ rowNumber, field: 'severitySnapshot', message: 'level 与 severity 不一致' });
      if ('policyVersion' in parsed && parsed.policyVersion !== severityPolicyVersion) rowErrors.push({ rowNumber, field: 'severitySnapshot', message: 'policyVersion 与 severityPolicyVersion 不一致' });
      if (JSON.stringify({ ...parsed, level: severity, policyVersion: severityPolicyVersion }).length > 10000) rowErrors.push({ rowNumber, field: 'severitySnapshot', message: '补齐等级与策略后最多 10000 字' });
    } catch { rowErrors.push({ rowNumber, field: 'severitySnapshot', message: '需要 JSON 对象' }); }

    const optionalText = (field: Field) => {
      if (!seen.has(field) || cellText(raw[field]) === '') return undefined;
      const value = cellText(raw[field]);
      if (lengths[field] && value.length > lengths[field]!) rowErrors.push({ rowNumber, field, message: `最多 ${lengths[field]} 字` });
      return value;
    };
    const vin = optionalText('vin');
    const mileageText = optionalText('mileage');
    const mileage = mileageText === undefined ? undefined : Number(mileageText);
    if (mileageText !== undefined && (!Number.isSafeInteger(mileage) || mileage! < 0)) rowErrors.push({ rowNumber, field: 'mileage', message: '需要非负整数' });
    const purchaseDateText = optionalText('purchaseDate');
    const purchaseDate = purchaseDateText === undefined ? undefined : dateTime(raw.purchaseDate);
    if (purchaseDateText && !purchaseDate) rowErrors.push({ rowNumber, field: 'purchaseDate', message: '需要带时区的 ISO 日期时间' });
    if (complaintType === 'AFTER_SALES' && (!vin || mileage === undefined || !purchaseDate)) rowErrors.push({ rowNumber, field: 'complaintType', message: '售后客诉需要 vin、mileage、purchaseDate' });
    const optionalBoolean = (field: 'returnRequired' | 'physicalAnalysisRequired') => {
      if (!seen.has(field) || cellText(raw[field]) === '') return undefined;
      const value = booleanCell(raw[field]);
      if (value === undefined) rowErrors.push({ rowNumber, field, message: '需要 TRUE 或 FALSE' });
      return value;
    };
    const returnRequired = optionalBoolean('returnRequired');
    const physicalAnalysisRequired = optionalBoolean('physicalAnalysisRequired');
    errors.push(...rowErrors);
    rows.push({ rowNumber, customerId, complaintType: complaintType as ImportRow['complaintType'], defectDescription, severity, severityPolicyVersion, severitySnapshot, externalSourceSystem: externalSourceSystem as ImportRow['externalSourceSystem'], externalRecordKey, sourceObservedAt: sourceObservedAt ?? '',
      terminalCustomerName: optionalText('terminalCustomerName'), productCode: optionalText('productCode'), productModel: optionalText('productModel'), vin, mileage, purchaseDate, returnRequired, physicalAnalysisRequired });
  }
  if (rows.length < 1 || rows.length > 100) errors.push({ rowNumber: 1, field: 'rows', message: '每次需要 1–100 条非空数据行' });
  return { rows, errors };
}

async function checkZipSize(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const start = Math.max(0, bytes.length - 65557);
  let directoryEnd = -1;
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { directoryEnd = offset; break; }
  }
  if (directoryEnd < 0) throw new Error('Excel ZIP 结构无效');
  const count = view.getUint16(directoryEnd + 10, true);
  const directorySize = view.getUint32(directoryEnd + 12, true);
  let offset = view.getUint32(directoryEnd + 16, true);
  if (view.getUint16(directoryEnd + 4, true) !== 0 || view.getUint16(directoryEnd + 6, true) !== 0 || count > 100 || directorySize === 0xffffffff || offset === 0xffffffff || offset + directorySize > directoryEnd) throw new Error('Excel ZIP 结构无效');
  const end = offset + directorySize;
  let totalSize = 0;
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
    totalSize += uncompressed;
    if (uncompressed > 4 * 1024 * 1024 || totalSize > 8 * 1024 * 1024 || (uncompressed > 0 && compressed === 0) || (compressed > 0 && uncompressed / compressed > 200)) throw new Error('Excel 解压后内容过大');
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
          if (actualSize > 4 * 1024 * 1024 || totalSize - uncompressed + actualSize > 8 * 1024 * 1024) throw new Error('Excel 解压后内容过大');
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

export async function readComplaintWorkbook(file: File): Promise<ReturnType<typeof parseComplaintRows>> {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('仅支持 .xlsx 文件');
  if (file.size > 2 * 1024 * 1024) throw new Error('文件不能超过 2 MB');
  const buffer = await file.arrayBuffer();
  await checkZipSize(buffer);
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); }
  catch { throw new Error('Excel 文件无法解析，请检查文件格式'); }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('Excel 文件没有工作表');
  if (workbook.worksheets.length > 10) throw new Error('工作表不能超过 10 个');
  const sheet: unknown[][] = [];
  let dataRows = 0;
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber > 10000) throw new Error('数据行号不能超过 10000');
    if (rowNumber > 1 && ++dataRows > 100) throw new Error('每次最多 100 条数据行');
    const cells: unknown[] = [];
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      if (columnNumber > 100) throw new Error('列号不能超过 100');
      cells[columnNumber - 1] = cell.value;
    });
    sheet[rowNumber - 1] = cells;
  });
  return parseComplaintRows(sheet);
}
