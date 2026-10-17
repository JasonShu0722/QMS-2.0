import { readXlsxFile } from '../imports/read-xlsx';
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

export async function readComplaintWorkbook(file: File): Promise<ReturnType<typeof parseComplaintRows>> {
  return parseComplaintRows(await readXlsxFile(file));
}
