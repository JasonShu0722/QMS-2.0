import { describe, expect, it, vi } from 'vitest';
import { parseLedgerSheet, parseLedgerTsv, readLedgerWorkbook } from './customer-ledger-import';
import { readXlsxFile } from '../imports/read-xlsx';

vi.mock('../imports/read-xlsx', () => ({ readXlsxFile: vi.fn() }));

describe('formal customer ledger input', () => {
  it('preserves unknown customers, empty quantity and abnormal long raw values without guessing or trimming', () => {
    const description = `  ${'异'.repeat(2000)}  `;
    expect(parseLedgerTsv(`客户\t客诉类型\t件数\t故障里程\t生产日期\t详细故障描述\n未知客户\t售后\t\t不是数字\t2026-02-30\t${description}`)).toEqual([
      { rowNumber: 2, action: 'ADD', fields: { customerName: '未知客户', complaintType: '售后', quantity: '', mileage: '不是数字', productionOn: '2026-02-30', defectDescription: description } },
    ]);
  });
  it('shares field semantics across Excel and paste, including multiline quoted Excel text', async () => {
    const rows = [['客户', '服务方式', '拦截状态', '详细故障描述'], ['未建档客户', '现场现调', '否，索赔件', '第一行\n第二行\t原文']];
    vi.mocked(readXlsxFile).mockResolvedValue(rows);
    expect(await readLedgerWorkbook(new File([], '客户.xlsx'))).toEqual(parseLedgerTsv('客户\t服务方式\t拦截状态\t详细故障描述\n未建档客户\t现场现调\t否，索赔件\t"第一行\n第二行\t原文"'));
    expect(readXlsxFile).toHaveBeenCalledWith(expect.any(File), { mode: 'master-data' });
  });
  it('keeps numbers and blank cells without deriving MIS, dates or mileage bands', () => {
    expect(parseLedgerSheet([['件数', '故障里程', '上线日期'], [12, 0, null]])[0]?.fields).toEqual({ quantity: 12, mileage: 0, onlineOn: null });
  });
  it('does not accept the protected investigation field as a registration or supplement import column', () => {
    expect(() => parseLedgerTsv('客户\t调查情况\n客户原文\t不应导入的调查')).toThrow();
    expect(() => parseLedgerSheet([['customerName', 'investigation'], ['客户原文', '不应导入的调查']])).toThrow();
  });
  it('preserves Chinese type spelling and trailing whitespace for server-only normalization', () => {
    expect(parseLedgerTsv('客诉类型\t客户\n零公里\t  原文客户  \n售后  \t甲\n')[1]?.fields).toEqual({ complaintType: '售后  ', customerName: '甲' });
  });
  it.each([
    [['客户', '客户'], ['甲', '乙']],
    [['客户', '未知列'], ['甲', '不能丢失']],
    [['客户'], ['甲', '无表头数据']],
    [['客户'], [{ formula: '1+1', result: 2 }]],
    [['客户'], ['甲'.repeat(20001)]],
    [['客户', , '件数'], ['甲', '无表头但有原文', '2']],
  ].map(sheet => ({ sheet })))('rejects ambiguous or structurally unsafe input instead of silently dropping it: %j', ({ sheet }) => {
    expect(() => parseLedgerSheet(sheet)).toThrow();
  });
  it('rejects broken quoting and more than 100 data rows', () => {
    expect(() => parseLedgerTsv('客户\n"未结束')).toThrow();
    expect(() => parseLedgerSheet([['客户'], ...Array.from({ length: 101 }, () => ['甲'])])).toThrow();
  });
  it('counts 100 actual rows after terminal LF and entirely whitespace-only Excel rows, preserving nonempty raw spaces', async () => {
    const sheet = [['客户', '件数'], ...Array.from({ length: 100 }, () => ['  客户原文  ', '1']), [' \t ', '  ']];
    vi.mocked(readXlsxFile).mockResolvedValue(sheet);
    const imported = await readLedgerWorkbook(new File([], '客户.xlsx'));
    expect(imported).toHaveLength(100);
    expect(imported[0]?.fields.customerName).toBe('  客户原文  ');
    expect(parseLedgerTsv(`客户\t件数\n${Array.from({ length: 100 }, () => '  客户原文  \t1').join('\n')}\n\n \t \n`)).toEqual(imported);
  });
});
