import ExcelJS from 'exceljs';
import { expect, it } from 'vitest';
import { parseAuditImportRows, readAuditImportWorkbook } from './audit-management-import';

it('maps customer and second-party rows with a stable external key', () => {
  const result = parseAuditImportRows([
    ['sourceSystem', 'externalKey', 'customerKey', 'finding', 'severity', 'auditDate', 'sourceUrl'],
    ['CUSTOMER', 'cust-a-001', 'customer-a', '缺少审核记录', 'MAJOR', '2026-09-25T01:00:00Z', 'https://example.test/a'],
    ['SECOND_PARTY', 'supplier-b-002', 'supplier-b', '过程证据不足', 'MINOR', '2026-09-25T02:00:00+00:00', ''],
  ]);
  expect(result.errors).toEqual([]);
  expect(result.rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ rowNumber: 2, sourceSystem: 'CUSTOMER', externalKey: 'cust-a-001', payload: expect.objectContaining({ customerKey: 'customer-a', auditDate: '2026-09-25T01:00:00.000Z' }) }),
    expect.objectContaining({ rowNumber: 3, sourceSystem: 'SECOND_PARTY', externalKey: 'supplier-b-002' }),
  ]));
});

it('reports row errors and keeps valid rows for retry', () => {
  const result = parseAuditImportRows([
    ['sourceSystem', 'externalKey', 'finding', 'sourceUrl'],
    ['BAD', '', '', 'javascript:alert(1)'],
    ['CUSTOMER', 'valid-2', '可导入', 'https://example.test/2'],
  ]);
  expect(result.rows).toHaveLength(2);
  expect(result.errors).toEqual(expect.arrayContaining([
    expect.objectContaining({ rowNumber: 2, field: 'sourceSystem' }),
    expect.objectContaining({ rowNumber: 2, field: 'externalKey' }),
    expect.objectContaining({ rowNumber: 2, field: 'finding' }),
    expect.objectContaining({ rowNumber: 2, field: 'sourceUrl' }),
  ]));
  expect(result.rows[1]).toMatchObject({ rowNumber: 3, externalKey: 'valid-2' });
});

it('parses a genuine xlsx workbook and rejects unsupported files', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('审核问题');
  sheet.addRow(['sourceSystem', 'externalKey', 'finding']);
  sheet.addRow(['CUSTOMER', 'xlsx-001', '真实文件']);
  const bytes = await workbook.xlsx.writeBuffer();
  const file = new File([bytes], 'audit.xlsx');
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array(bytes as unknown as ArrayBuffer).buffer });
  expect((await readAuditImportWorkbook(file)).rows[0]).toMatchObject({ rowNumber: 2, externalKey: 'xlsx-001' });
  await expect(readAuditImportWorkbook(new File(['text'], 'audit.csv'))).rejects.toThrow('仅支持 .xlsx 文件');
});
