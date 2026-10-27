import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { fields, inspect, parseSheet, readPreviewExcel, supplementChanges } from './model';

async function excelFile(rows: ExcelJS.CellValue[][]) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('演示');
  rows.forEach((cells, index) => { worksheet.getRow(index + 1).values = cells; });
  const bytes = await workbook.xlsx.writeBuffer();
  const file = new File([bytes], 'boundary.xlsx');
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array(bytes).buffer });
  return file;
}

describe('local preview input boundaries', () => {
  it.each(['trailing', 'interleaved'])('reads 100 real XLSX records with %s whitespace rows and preserves physical row numbers', async placement => {
    const data = Array.from({ length: 100 }, (_, index) => [`客户${index}`, '远程指导 ']);
    const sheet = placement === 'trailing' ? [...data, [' \t ', ' ']] : data.flatMap(row => [[' \t ', ' '], row]);
    const rows = await readPreviewExcel(await excelFile([['客户', '服务方式'], ...sheet]));
    expect(rows).toHaveLength(100);
    expect(rows.map(row => row.sourceRow)).toEqual(Array.from({ length: 100 }, (_, index) => String(placement === 'trailing' ? index + 2 : index * 2 + 3)));
    expect(rows[99]).toMatchObject({ customer: '客户99', service: '远程指导 ' });
    expect(inspect(rows[99])).toContainEqual({ field: '服务方式', original: '远程指导 ', reason: '未知选项，保留原文待补正' });
  });

  it('rejects 101 actual XLSX records even with whitespace rows between them', async () => {
    const data = Array.from({ length: 101 }, (_, index) => [[' '], [`客户${index}`]]).flat();
    await expect(readPreviewExcel(await excelFile([['客户'], ...data]))).rejects.toThrow('100');
  });

  it.each<[string, ExcelJS.CellValue, string]>([
    ['oversize whitespace', ' '.repeat(2001), '2000'],
    ['formula', { formula: '1+1', result: 2 }, '文本'],
  ])('validates a real XLSX %s cell beyond the first 100 data rows before dropping blanks', async (_kind, cell, message) => {
    const file = await excelFile([['客户'], ...Array.from({ length: 100 }, () => ['甲']), [cell]]);
    await expect(readPreviewExcel(file)).rejects.toThrow(String(message));
  });

  it('retains the shared physical row safety bound for a sparse real XLSX', async () => {
    const rows: ExcelJS.CellValue[][] = [['客户']];
    rows[10000] = ['超出物理行号'];
    await expect(readPreviewExcel(await excelFile(rows))).rejects.toThrow('10000');
  });

  it('preserves physical sheet row numbers when blank rows are ignored', () => {
    const rows = parseSheet([['客户'], ['甲'], [], ['乙']]);
    expect(rows.map(row => row.sourceRow)).toEqual(['2', '4']);
  });

  it.each(['\n', '\r\n'])('accepts 100 data rows with a terminal %j without trimming the final option', newline => {
    const text = ['客户\t服务方式', ...Array.from({ length: 100 }, (_, index) => `客户${index}\t远程指导 `), ''].join(newline);
    const rows = parseSheet(text.split(/\r?\n/).map(line => line.split('\t')));
    expect(rows).toHaveLength(100);
    expect(rows[99]).toMatchObject({ sourceRow: '101', service: '远程指导 ' });
    expect(inspect(rows[99])).toContainEqual({ field: '服务方式', original: '远程指导 ', reason: '未知选项，保留原文待补正' });
  });

  it('counts nonblank data rows while retaining their physical indices across many blank rows', () => {
    const sheet = [['客户'], ...Array.from({ length: 100 }, (_, index) => [[], [' \t '], [`客户${index}`]]).flat(), [], []];
    const rows = parseSheet(sheet);
    expect(rows).toHaveLength(100);
    expect(rows.map(row => row.sourceRow)).toEqual(Array.from({ length: 100 }, (_, index) => String(index * 3 + 4)));
    expect(() => parseSheet([...sheet, ['第101条']])).toThrow('100');
  });

  it('validates trailing blank-looking and unsupported cells before filtering them out', () => {
    const sheet = [['客户'], ...Array.from({ length: 100 }, () => ['甲'])];
    expect(() => parseSheet([...sheet, [' '.repeat(2001)]])).toThrow('2000');
    expect(() => parseSheet([...sheet, [{ richText: [{ text: ' ' }] }]])).toThrow('富文本');
  });

  it('accepts 100 rows and 2000 characters per cell but explicitly rejects the next cell character', () => {
    expect(parseSheet([['客户'], ...Array.from({ length: 100 }, () => ['甲'.repeat(2000)])])).toHaveLength(100);
    expect(() => parseSheet([['客户'], ['甲'.repeat(2001)]])).toThrow('2000');
  });

  it('uses one field list for manual/paste/Excel without adding count or risk fields', () => {
    expect(fields.map(([label]) => label)).toContain('数量');
    for (const forbidden of ['实收数量', '解析样本数量', '严重度', '优先级', '完成百分比']) expect(fields.map(([label]) => label)).not.toContain(forbidden);
    const rows = parseSheet([['客户', '类型', '数量', '服务方式', '拦截状态'], ['演示客户甲', '售后', '2', '现场现调', '否，索赔件']]);
    expect(rows[0]).toMatchObject({ customer: '演示客户甲', kind: '售后', quantity: '2', service: '现场现调', interception: '否，索赔件' });
    expect(inspect(rows[0])).toEqual([]);
  });

  it('rejects ambiguous headers, oversize inputs and unsupported Excel cells rather than losing content', () => {
    expect(() => parseSheet([['客户', '客户'], ['甲', '乙']])).toThrow('重复');
    expect(() => parseSheet([['优先级'], ['高']])).toThrow('不支持');
    expect(() => parseSheet([['数量'], ...Array.from({ length: 101 }, () => ['1'])])).toThrow('100');
    expect(() => parseSheet([['客户'], [{ formula: '1+1', result: 2 }]])).toThrow('文本');
    expect(() => parseSheet([['客户'], ['甲', '未命名内容']])).toThrow('列');
  });

  it('keeps invalid originals and treats empty optional values as empty, not zero or defaults', () => {
    const [row] = parseSheet([['数量', '服务方式', '拦截状态', '生产日期'], ['坏数量', '错误选项', '', '2026-02-30']]);
    expect(row.quantity).toBe('坏数量');
    expect(row.interception).toBe('');
    expect(inspect(row).map(issue => issue.field)).toEqual(expect.arrayContaining(['数量', '服务方式', '生产日期']));
    expect(inspect(parseSheet([['数量'], ['']])[0] ?? Object.fromEntries(fields.map(([, key]) => [key, ''])))).toEqual([]);
  });

  it('supplements only explicit nonempty input and never replaces the human engineer', () => {
    const [before, incoming] = parseSheet([['客户', '质量工程师', '数量', '详细故障描述'], ['演示客户甲', '人工人选', '3', '旧描述'], ['', '映射建议', '', '新描述']]);
    expect(supplementChanges(before, incoming)).toEqual([{ key: 'description', label: '详细故障描述', before: '旧描述', after: '新描述' }]);
  });

  it('reads real Excel with the same fields and reports corrupt/unsupported files without any API', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('演示').addRows([['客户', '类型', '数量', '服务方式', '拦截状态'], ['演示客户甲', '售后', '2', '现场现调', '否，索赔件']]);
    const bytes = await workbook.xlsx.writeBuffer();
    const file = new File([bytes], 'demo.xlsx');
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array(bytes).buffer });
    expect((await readPreviewExcel(file))[0]).toMatchObject({ customer: '演示客户甲', quantity: '2', service: '现场现调', interception: '否，索赔件' });
    const corrupt = new File(['broken'], 'broken.xlsx');
    Object.defineProperty(corrupt, 'arrayBuffer', { value: async () => new TextEncoder().encode('broken').buffer });
    await expect(readPreviewExcel(corrupt)).rejects.toThrow('ZIP');
    await expect(readPreviewExcel(new File(['text'], 'wrong.csv'))).rejects.toThrow('.xlsx');
  });
});
