import ExcelJS from 'exceljs';
import { expect, it } from 'vitest';
import { readXlsxFile, readXlsxPreview } from './read-xlsx';
import { parseSupplierMasterRows } from '../supplier-quality/SupplierMasterImport';
import { parseCustomerMasterRows } from '../customer-quality/CustomerMasterImport';
import { parseMaterialMasterRows } from '../material-master/MaterialMasterImport';

async function workbookFile(book: ExcelJS.Workbook, name = 'master.xlsx') {
  const bytes = await book.xlsx.writeBuffer();
  const file = new File([bytes], name);
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array(bytes).buffer });
  return file;
}

it.each([101, 250, 1000])('reads a real %i-row master workbook while retaining the default consumer gate', async (count) => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('master');
  sheet.addRow(['客户编码', '客户名称']);
  for (let i = 0; i < count; i++) sheet.addRow([`00${i}`, `客户${i}`]);
  const file = await workbookFile(book);
  await expect(readXlsxFile(file)).rejects.toThrow('100');
  const rows = await readXlsxFile(file, { mode: 'master-data' });
  expect(parseCustomerMasterRows(rows)).toHaveLength(count);
  expect(parseCustomerMasterRows(rows).at(-1)?.rowNumber).toBe(count + 1);
});

it('removes only master parser total limits and preserves sparse original row numbers', () => {
  for (const [parse, headers] of [
    [parseSupplierMasterRows, ['供应商编码', '供应商名称', '联系人', '联系邮箱']],
    [parseCustomerMasterRows, ['客户编码', '客户名称']],
    [parseMaterialMasterRows, ['物料编码', '物料名称']],
  ] as const) {
    const sheet = [headers, [], ...Array.from({ length: 250 }, (_, i) => [`00${i}`, '名称'])];
    expect(parse(sheet)).toHaveLength(250);
    expect(parse(sheet)[0]?.rowNumber).toBe(3);
    expect(() => parse([headers, ['code', { formula: '1+1' }]])).toThrow();
  }
});

it('retains extension, file size and sparse row/column safety in master mode', async () => {
  await expect(readXlsxFile(new File(['x'], 'x.csv'), { mode: 'master-data' })).rejects.toThrow('.xlsx');
  await expect(readXlsxFile(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'x.xlsx'), { mode: 'master-data' })).rejects.toThrow('2 MB');
  for (const [row, col, message] of [[10001, 1, '10000'], [2, 101, '100']] as const) {
    const book = new ExcelJS.Workbook();
    book.addWorksheet('sparse').getCell(row, col).value = 'unsafe';
    await expect(readXlsxFile(await workbookFile(book), { mode: 'master-data' })).rejects.toThrow(message);
  }
});

it('rejects incorrect ZIP size declarations based on actual decompressed bytes in import and preview', async () => {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('master').addRow(['x'.repeat(4 * 1024 * 1024 + 1)]);
  const original = await workbookFile(book);
  const buffer = await original.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const end = bytes.length - 22;
  let offset = view.getUint32(end + 16, true);
  const count = view.getUint16(end + 10, true);
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset + 24, true) > 4 * 1024 * 1024) view.setUint32(offset + 24, 1000, true);
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  const forged = new File([bytes], 'forged.xlsx');
  Object.defineProperty(forged, 'arrayBuffer', { value: async () => buffer });
  await expect(readXlsxFile(forged, { mode: 'master-data' })).rejects.toThrow('Excel 解压后内容过大');
  await expect(readXlsxPreview(buffer)).rejects.toThrow('Excel 解压后内容过大');
});

it('previews a real workbook above the import size and sheet-count limits', async () => {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('first').addRow(['first sheet']);
  const extra = book.addWorksheet('extra');
  for (let index = 0; index < 100; index++) extra.addRow([`${index}-${'x'.repeat(30_000)}`]);
  for (let index = 0; index < 9; index++) book.addWorksheet(`other-${index}`);
  const buffer = new Uint8Array(await book.xlsx.writeBuffer({ zip: { compression: 'STORE' } })).buffer;
  expect(buffer.byteLength).toBeGreaterThan(2 * 1024 * 1024);
  await expect(readXlsxFile(new File([buffer], 'large.xlsx'), { mode: 'master-data' })).rejects.toThrow('2 MB');
  await expect(readXlsxPreview(buffer)).resolves.toEqual({ rows: [['first sheet']], truncated: false });
});

it('caps first-sheet coordinates and text while preserving displayed row positions and cached values', async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('first');
  sheet.getCell('A2').value = { richText: [{ text: 'rich ' }, { text: 'text' }] };
  sheet.getCell('B2').value = { formula: '1+1', result: 2 };
  sheet.getCell('A3').value = 'x'.repeat(1_001);
  sheet.getCell('AD200').value = false;
  sheet.getCell('XFD200').value = 'outside column cap';
  sheet.getCell('A10001').value = 'outside row cap';
  const { rows, truncated } = await readXlsxPreview(await (await workbookFile(book)).arrayBuffer());
  expect(rows).toHaveLength(200);
  expect(rows[0]).toEqual([]);
  expect(rows[1]).toEqual(['rich text', '2']);
  expect(rows[2]).toEqual(['x'.repeat(1_000)]);
  expect(rows[199]).toHaveLength(30);
  expect(rows[199]?.[29]).toBe('false');
  expect(truncated).toBe(true);
});

it('rejects an oversized expanded XLSX part even when the workbook compresses below the attachment limit', async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('first');
  for (let index = 0; index < 300; index++) sheet.addRow([`${index}-${'x'.repeat(30_000)}`]);
  const buffer = await (await workbookFile(book)).arrayBuffer();
  expect(buffer.byteLength).toBeLessThan(2 * 1024 * 1024);
  await expect(readXlsxPreview(buffer)).rejects.toThrow('Excel 解压后内容过大');
});
