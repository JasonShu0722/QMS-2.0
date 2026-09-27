import ExcelJS from 'exceljs';
import { expect, it } from 'vitest';
import { parseComplaintRows, readComplaintWorkbook, serializeComplaintImport } from './customer-quality-import';

const uuid = '11111111-1111-4111-8111-111111111111';

it('maps the header row and preserves spreadsheet row numbers', () => {
  const result = parseComplaintRows([
    ['customerId', 'complaintType', 'defectDescription', 'severity', 'severityPolicyVersion', 'severitySnapshot', 'externalSourceSystem', 'externalRecordKey', 'sourceObservedAt'],
    [uuid, 'ZERO_KM', '门板异响', 'HIGH', 'policy-1', '{"level":"HIGH"}', 'IMS', 'IMS-001', '2026-09-24T02:00:00Z'],
  ]);

  expect(result.rows).toEqual([expect.objectContaining({
    rowNumber: 2,
    customerId: uuid,
    complaintType: 'ZERO_KM',
    defectDescription: '门板异响',
    severitySnapshot: { level: 'HIGH' },
    sourceObservedAt: '2026-09-24T02:00:00.000Z',
  })]);
  expect(result.errors).toEqual([]);
});

it('reports field errors per spreadsheet row without dropping valid rows', () => {
  const result = parseComplaintRows([
    ['customerId', 'complaintType', 'defectDescription', 'severity', 'severityPolicyVersion', 'severitySnapshot', 'externalSourceSystem', 'externalRecordKey', 'sourceObservedAt'],
    ['bad-id', 'ZERO_KM', '', 'HIGH', 'policy-1', '{}', 'IMS', '', 'bad-date'],
    [uuid, 'AFTER_SALES', '刹车异响', 'MEDIUM', 'policy-1', '{"level":"MEDIUM"}', 'IMS', 'IMS-002', '2026-09-24T03:00:00Z'],
  ]);

  expect(result.rows).toHaveLength(2);
  expect(result.errors).toEqual(expect.arrayContaining([
    expect.objectContaining({ rowNumber: 2, field: 'customerId' }),
    expect.objectContaining({ rowNumber: 2, field: 'defectDescription' }),
    expect.objectContaining({ rowNumber: 2, field: 'externalRecordKey' }),
    expect.objectContaining({ rowNumber: 2, field: 'sourceObservedAt' }),
  ]));
  expect(result.rows[1]).toEqual(expect.objectContaining({ rowNumber: 3, externalRecordKey: 'IMS-002' }));
});

it('reads a real xlsx workbook and rejects unsupported files', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('客诉');
  sheet.addRow(['customerId', 'complaintType', 'defectDescription', 'severity', 'severityPolicyVersion', 'severitySnapshot', 'externalSourceSystem', 'externalRecordKey', 'sourceObservedAt']);
  sheet.addRow([uuid, 'ZERO_KM', '实际文件', 'HIGH', 'policy-1', '{}', 'IMS', 'IMS-003', '2026-09-24T02:00:00Z']);
  const bytes = await workbook.xlsx.writeBuffer();
  const file = new File([bytes], 'complaints.xlsx');
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array(bytes as unknown as ArrayBuffer).buffer });

  expect((await readComplaintWorkbook(file)).rows[0]).toMatchObject({ rowNumber: 2, defectDescription: '实际文件' });
  await expect(readComplaintWorkbook(new File(['not an xlsx'], 'complaints.txt'))).rejects.toThrow('仅支持 .xlsx 文件');
});

it('rejects batches over 100 rows before submission', () => {
  const header = ['customerId', 'complaintType', 'defectDescription', 'severity', 'severityPolicyVersion', 'severitySnapshot', 'externalSourceSystem', 'externalRecordKey', 'sourceObservedAt'];
  const row = [uuid, 'ZERO_KM', '超限', 'LOW', 'policy-1', '{}', 'IMS', 'IMS-005', '2026-09-24T02:00:00Z'];
  const result = parseComplaintRows([header, ...Array.from({ length: 101 }, (_, index) => [...row.slice(0, 7), `IMS-${index}`, row[8]])]);
  expect(result.rows).toHaveLength(101);
  expect(result.errors).toContainEqual({ rowNumber: 1, field: 'rows', message: '每次需要 1–100 条非空数据行' });
});

it('rejects formula cells instead of importing object text', () => {
  const result = parseComplaintRows([
    ['customerId', 'complaintType', 'defectDescription', 'severity', 'severityPolicyVersion', 'severitySnapshot', 'externalSourceSystem', 'externalRecordKey', 'sourceObservedAt'],
    [uuid, 'ZERO_KM', { formula: 'A1' }, 'LOW', 'policy-1', '{}', 'IMS', 'IMS-006', '2026-09-24T02:00:00Z'],
  ]);
  expect(result.errors).toContainEqual({ rowNumber: 2, field: 'defectDescription', message: '不支持公式或富文本单元格' });
});

it('rejects values beneath unnamed header columns', () => {
  const result = parseComplaintRows([
    ['customerId', 'complaintType', 'defectDescription', 'severity', 'severityPolicyVersion', 'severitySnapshot', 'externalSourceSystem', 'externalRecordKey', 'sourceObservedAt', ''],
    [uuid, 'ZERO_KM', '客诉', 'LOW', 'policy-1', '{}', 'IMS', 'IMS-007', '2026-09-24T02:00:00Z', '不可静默忽略'],
  ]);
  expect(result.errors).toContainEqual({ rowNumber: 2, field: '列 10', message: '列名为空，数据不能导入' });
});

it('rejects invalid calendar dates despite JavaScript normalization', () => {
  const result = parseComplaintRows([
    ['customerId', 'complaintType', 'defectDescription', 'severity', 'severityPolicyVersion', 'severitySnapshot', 'externalSourceSystem', 'externalRecordKey', 'sourceObservedAt', 'purchaseDate'],
    [uuid, 'ZERO_KM', '客诉', 'LOW', 'policy-1', '{}', 'IMS', 'IMS-008', '2026-02-30T02:00:00+08:00', '2026-02-30T02:00:00Z'],
  ]);
  expect(result.errors).toEqual(expect.arrayContaining([
    expect.objectContaining({ rowNumber: 2, field: 'sourceObservedAt' }),
    expect.objectContaining({ rowNumber: 2, field: 'purchaseDate' }),
  ]));
});

it('rejects an oversized decompressed ZIP entry before ExcelJS loads it', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('客诉').addRow(['customerId']);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  const view = new DataView(bytes.buffer);
  const centralHeader = bytes.findIndex((_, index) => view.getUint32(index, true) === 0x02014b50);
  view.setUint32(centralHeader + 24, 16 * 1024 * 1024, true);
  const file = new File([bytes], 'oversized.xlsx');
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
  await expect(readComplaintWorkbook(file)).rejects.toThrow('Excel 解压后内容过大');
});

it('rejects a compressed ZIP entry whose real output exceeds its forged directory size', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('客诉').addRow(['a'.repeat(5 * 1024 * 1024)]);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  const view = new DataView(bytes.buffer);
  let altered = false;
  for (let offset = 0; offset < bytes.length - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name === 'xl/sharedStrings.xml') {
      view.setUint32(offset + 24, 1024, true);
      altered = true;
      break;
    }
  }
  expect(altered).toBe(true);
  const file = new File([bytes], 'forged-size.xlsx');
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
  await expect(readComplaintWorkbook(file)).rejects.toThrow('Excel 解压后内容过大');
});

it('rejects workbooks with too many sheets or sparse columns', async () => {
  const workbook = new ExcelJS.Workbook();
  for (let index = 0; index < 11; index += 1) workbook.addWorksheet(`Sheet ${index + 1}`).addRow(['customerId']);
  const bytes = await workbook.xlsx.writeBuffer();
  const file = new File([bytes], 'many-sheets.xlsx');
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array(bytes as unknown as ArrayBuffer).buffer });
  await expect(readComplaintWorkbook(file)).rejects.toThrow('工作表不能超过 10 个');

  const sparse = new ExcelJS.Workbook();
  sparse.addWorksheet('客诉').getCell('CW1').value = 'customerId';
  const sparseBytes = await sparse.xlsx.writeBuffer();
  const sparseFile = new File([sparseBytes], 'sparse-columns.xlsx');
  Object.defineProperty(sparseFile, 'arrayBuffer', { value: async () => new Uint8Array(sparseBytes as unknown as ArrayBuffer).buffer });
  await expect(readComplaintWorkbook(sparseFile)).rejects.toThrow('列号不能超过 100');
});

it('stops collecting workbook rows once the batch exceeds 100', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('客诉');
  sheet.addRow(['customerId']);
  for (let index = 0; index < 101; index += 1) sheet.addRow([uuid]);
  const bytes = await workbook.xlsx.writeBuffer();
  const file = new File([bytes], 'too-many.xlsx');
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array(bytes as unknown as ArrayBuffer).buffer });
  await expect(readComplaintWorkbook(file)).rejects.toThrow('每次最多 100 条数据行');
});

it('checks the UTF-8 JSON payload size before sending the import', () => {
  const row = parseComplaintRows([
    ['customerId', 'complaintType', 'defectDescription', 'severity', 'severityPolicyVersion', 'severitySnapshot', 'externalSourceSystem', 'externalRecordKey', 'sourceObservedAt'],
    [uuid, 'ZERO_KM', '客诉', 'LOW', 'policy-1', '{}', 'IMS', 'IMS-009', '2026-09-24T02:00:00Z'],
  ]).rows[0];
  expect(serializeComplaintImport([row])).toContain('"rowNumber":2');
  expect(() => serializeComplaintImport([{ ...row, severitySnapshot: { note: '中'.repeat(2_000_000) } as unknown as typeof row.severitySnapshot }])).toThrow('导入数据超过 5.5 MB');
});

it('rejects severity snapshot JSON beyond 10000 characters', () => {
  const result = parseComplaintRows([
    ['customerId', 'complaintType', 'defectDescription', 'severity', 'severityPolicyVersion', 'severitySnapshot', 'externalSourceSystem', 'externalRecordKey', 'sourceObservedAt'],
    [uuid, 'ZERO_KM', '客诉', 'LOW', 'policy-1', JSON.stringify({ note: 'a'.repeat(10000) }), 'IMS', 'IMS-010', '2026-09-24T02:00:00Z'],
  ]);
  expect(result.errors).toContainEqual({ rowNumber: 2, field: 'severitySnapshot', message: '最多 10000 字' });
});

it('checks snapshot length after adding severity policy fields', () => {
  const snapshot = JSON.stringify({ note: 'a'.repeat(9980) });
  expect(snapshot.length).toBeLessThanOrEqual(10000);
  const result = parseComplaintRows([
    ['customerId', 'complaintType', 'defectDescription', 'severity', 'severityPolicyVersion', 'severitySnapshot', 'externalSourceSystem', 'externalRecordKey', 'sourceObservedAt'],
    [uuid, 'ZERO_KM', '客诉', 'LOW', 'policy-1', snapshot, 'IMS', 'IMS-011', '2026-09-24T02:00:00Z'],
  ]);
  expect(result.errors).toContainEqual({ rowNumber: 2, field: 'severitySnapshot', message: '补齐等级与策略后最多 10000 字' });
});
