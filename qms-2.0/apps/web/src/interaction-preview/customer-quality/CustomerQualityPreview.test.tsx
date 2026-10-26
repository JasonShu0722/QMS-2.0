import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { CustomerQualityPreview } from './CustomerQualityPreview';

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const change = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name, { exact: true }), { target: { value } });
const ledger = () => screen.getByRole('table', { name: '客户质量来源台账' });
const details = () => screen.getByRole('region', { name: '客诉详情 CQ-DEMO-001' });
function setup() {
  render(<LanguageProvider><ThemeProvider><CustomerQualityPreview /></ThemeProvider></LanguageProvider>);
}
function paste(text: string) {
  click('粘贴 Excel');
  change('Excel 制表符文本', text);
  click('预览粘贴内容');
}

describe('customer ledger isolated memory preview', () => {
  it('does not let registration maintenance replace an existing manually assigned engineer', async () => {
    setup(); click('查看 CQ-DEMO-001');
    const detail = details();
    const engineer = within(detail).getByLabelText('质量工程师');
    expect(engineer).toHaveValue('演示工程师林');
    const user = userEvent.setup();
    await user.selectOptions(within(detail).getByLabelText('演示操作身份（非认证）'), '登记维护人员');
    expect(engineer).toBeDisabled();
    fireEvent.change(engineer, { target: { value: '演示工程师周' } });
    expect(engineer).toHaveValue('演示工程师林');
    await user.selectOptions(within(detail).getByLabelText('演示操作身份（非认证）'), '对应工程师');
    expect(engineer).toBeEnabled();
    await user.selectOptions(engineer, '演示工程师周');
    expect(engineer).toHaveValue('演示工程师周');
  });
  it('lets an explicit registration maintainer fill an empty engineer without granting business actions', async () => {
    setup();
    paste('客户\t组件号\n待指定客户\tNO-MAP');
    click('继续（保留警告）');
    click('查看 CQ-DEMO-004');
    const detail = screen.getByRole('region', { name: '客诉详情 CQ-DEMO-004' });
    expect(within(detail).getByLabelText('质量工程师')).toHaveValue('');
    expect(within(detail).getByLabelText('质量工程师')).toBeDisabled();
    const user = userEvent.setup();
    await user.selectOptions(within(detail).getByLabelText('演示操作身份（非认证）'), '登记维护人员');
    expect(within(detail).getByLabelText('质量工程师')).toBeEnabled();
    expect(within(detail).getByRole('button', { name: '演示补齐映射' })).toBeEnabled();
    for (const name of ['指定 FAE 到内存', '保存 FAE 解析到内存', '保存 SQE 分析到内存', '保存收件到内存', '关闭来源（内存）']) {
      expect(within(detail).getByRole('button', { name })).toBeDisabled();
    }
    for (const label of ['直接指定 FAE', 'FAE 解析正文', 'FAE 附件选择', '指定 SQE', '供应商分析正文', '快递单号', '关闭结论或恢复原因']) {
      expect(within(detail).getByLabelText(label)).toBeDisabled();
    }
    await user.selectOptions(within(detail).getByLabelText('质量工程师'), '演示工程师周');
    expect(within(detail).getByLabelText('质量工程师')).toHaveValue('演示工程师周');
    expect(detail).toHaveTextContent('人员来源：人工指定');
    expect(within(detail).getByRole('button', { name: '指定 FAE 到内存' })).toBeDisabled();
    expect(within(detail).getByRole('button', { name: '保存收件到内存' })).toBeDisabled();
    await user.selectOptions(within(detail).getByLabelText('演示操作身份（非认证）'), '对应工程师');
    expect(within(detail).getByLabelText('直接指定 FAE')).toBeEnabled();
    expect(within(detail).getByRole('button', { name: '保存收件到内存' })).toBeEnabled();
    await user.selectOptions(within(detail).getByLabelText('演示操作身份（非认证）'), '指定 FAE');
    expect(within(detail).getByLabelText('FAE 解析正文')).toBeDisabled();
    expect(within(detail).getByLabelText('质量工程师')).toBeDisabled();
    expect(within(detail).getByRole('button', { name: '关闭来源（内存）' })).toBeDisabled();
  });

  it.each(['', '演示工程师周'])('lets registration maintenance recover mapping without overwriting engineer %j', async manualEngineer => {
    setup();
    paste(`客户\t组件号\t质量工程师\n待映射客户\tNO-MAP\t${manualEngineer}`);
    click('继续（保留警告）');
    click('查看 CQ-DEMO-004');
    const detail = screen.getByRole('region', { name: '客诉详情 CQ-DEMO-004' });
    const user = userEvent.setup();
    await user.selectOptions(within(detail).getByLabelText('演示操作身份（非认证）'), '登记维护人员');
    await user.click(within(detail).getByRole('button', { name: '演示补齐映射' }));
    expect(within(detail).queryByRole('button', { name: '演示补齐映射' })).not.toBeInTheDocument();
    expect(detail).toHaveTextContent('演示恢复项目');
    expect(within(detail).getByLabelText('质量工程师')).toHaveValue(manualEngineer || '演示项目工程师许');
    expect(detail).toHaveTextContent(`人员来源：${manualEngineer ? '人工指定' : '映射带出'}`);
    expect(within(detail).getByRole('group', { name: '已有 8D 引用' })).toHaveTextContent('无已有演示引用');
    expect(within(detail).getByRole('button', { name: '保存收件到内存' })).toBeDisabled();
    expect(within(detail).getByLabelText('直接指定 FAE')).toBeDisabled();
    expect(within(detail).getByLabelText('关闭结论或恢复原因')).toBeDisabled();
  });

  it('moves keyboard focus to the detail heading and restores the original row action on return', async () => {
    setup();
    const user = userEvent.setup();
    screen.getByRole('button', { name: '查看 CQ-DEMO-002' }).focus();
    await user.keyboard('{Enter}');
    const detail = screen.getByRole('region', { name: '客诉详情 CQ-DEMO-002' });
    const heading = within(detail).getByRole('heading', { name: 'CQ-DEMO-002', level: 1 });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveFocus();
    await user.tab();
    expect(within(detail).getByRole('button', { name: '返回台账' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: '查看 CQ-DEMO-002' })).toHaveFocus();
    expect(screen.getByRole('button', { name: '查看 CQ-DEMO-001' })).not.toHaveFocus();
  });

  it('returns keyboard focus to the ledger heading when a saved change hides the original row', async () => {
    setup();
    change('来源状态筛选', '跟进中');
    const user = userEvent.setup();
    screen.getByRole('button', { name: '查看 CQ-DEMO-001' }).focus();
    await user.keyboard('{Enter}');
    const detail = details();
    await user.type(within(detail).getByLabelText('关闭结论或恢复原因'), '演示关闭');
    within(detail).getByRole('button', { name: '关闭来源（内存）' }).focus();
    await user.keyboard('{Enter}');
    expect(detail).toHaveTextContent('已关闭');
    within(detail).getByRole('button', { name: '返回台账' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('button', { name: '查看 CQ-DEMO-001' })).not.toBeInTheDocument();
    const heading = screen.getByRole('heading', { name: '客户质量来源台账', level: 1 });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveFocus();
    expect(screen.getByLabelText('来源状态筛选')).toHaveValue('跟进中');
  });

  it('does not steal focus on initial mount or ordinary detail edits and saves', async () => {
    setup();
    expect(screen.getByRole('heading', { name: '客户质量来源台账' })).not.toHaveFocus();
    click('查看 CQ-DEMO-001');
    const user = userEvent.setup();
    const tracking = within(details()).getByLabelText('快递单号');
    await user.type(tracking, 'LOCAL-FOCUS');
    expect(tracking).toHaveFocus();
    const save = within(details()).getByRole('button', { name: '保存收件到内存' });
    await user.click(save);
    expect(details()).toHaveTextContent('已存快递：LOCAL-FOCUS');
    expect(save).toHaveFocus();
  });

  it.each(['hover', 'keyboard'] as const)('reveals retained invalid fields from a compact warning on %s', async method => {
    setup();
    paste('客户\t组件号\t数量\t发生日期\t服务方式\n演示新客户\tC-200\t坏数量\t2026-02-30\t未知方式');
    click('继续（保留警告）');
    const row = within(ledger()).getByRole('row', { name: /CQ-DEMO-004/ });
    const warning = within(row).getByRole('button', { name: 'CQ-DEMO-004 原文待补正说明' });
    expect(warning).toHaveTextContent('!');
    expect(row).not.toHaveTextContent('不是有效正整数');
    const user = userEvent.setup();
    if (method === 'hover') await user.hover(warning);
    else {
      within(row).getByRole('button', { name: 'CQ-DEMO-004 映射说明' }).focus();
      await user.tab();
      expect(warning).toHaveFocus();
    }
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('数量 · 原填写「坏数量」· 不是有效正整数，规范数量暂空');
    expect(tooltip).toHaveTextContent('发生日期 · 原填写「2026-02-30」· 日期原文无效，规范日期暂空，不参与计算');
    expect(tooltip).toHaveTextContent('服务方式 · 原填写「未知方式」· 未知选项，保留原文待补正');
  });

  it('accepts a paste batch above 2000 characters without native truncation', async () => {
    setup();
    click('粘贴 Excel');
    const input = screen.getByLabelText('Excel 制表符文本');
    expect(input).not.toHaveAttribute('maxlength');
    const text = `客户\t详细故障描述\n长批次甲\t${'甲'.repeat(1500)}\n长批次乙\t${'乙'.repeat(1500)}`;
    const user = userEvent.setup();
    fireEvent.focus(input);
    input.focus();
    await user.paste(text);
    expect(input).toHaveValue(text);
    click('预览粘贴内容');
    expect(screen.getByRole('region', { name: '第 2 行预览' })).toHaveTextContent('甲'.repeat(1500));
    expect(screen.getByRole('region', { name: '第 3 行预览' })).toHaveTextContent('乙'.repeat(1500));
    click('继续（保留警告）');
    expect(ledger()).toHaveTextContent('长批次甲');
    expect(ledger()).toHaveTextContent('长批次乙');
  });

  it.each([
    ['单元格', `客户\n${'甲'.repeat(2001)}`, '单元格超过内存预览 2000 字符上限'],
    ['整批', '甲'.repeat(200001), '粘贴内容超过内存预览 200000 字符上限'],
    ['空白整批', `客户\n${'\t\n'.repeat(100000)}`, '粘贴内容超过内存预览 200000 字符上限'],
  ])('keeps oversized %s input intact and reports an explicit limit error', (_kind, text, message) => {
    setup();
    click('粘贴 Excel');
    const input = screen.getByLabelText('Excel 制表符文本');
    expect(input).not.toHaveAttribute('maxlength');
    change('Excel 制表符文本', text);
    click('预览粘贴内容');
    expect(input).toHaveValue(text);
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(message);
    expect(within(ledger()).getAllByRole('row')).toHaveLength(4);
  });

  it.each(['\n', '\r\n'])('previews 100 pasted records with terminal %j as data rows, not physical lines', newline => {
    setup();
    const text = ['客户', ...Array.from({ length: 100 }, (_, index) => `末行客户${index}`), ''].join(newline);
    click('粘贴 Excel');
    change('Excel 制表符文本', text);
    expect(screen.getByLabelText('Excel 制表符文本')).toHaveValue(text.replace(/\r\n/g, '\n'));
    click('预览粘贴内容');
    expect(screen.getByRole('region', { name: '第 101 行预览' })).toHaveTextContent('末行客户99');
    expect(screen.queryByRole('region', { name: '第 102 行预览' })).not.toBeInTheDocument();
    expect(within(ledger()).getAllByRole('row')).toHaveLength(4);
  });

  it('rejects 101 nonempty pasted records without changing the input or ledger', () => {
    setup();
    const text = ['客户', ...Array.from({ length: 101 }, (_, index) => `超限客户${index}`), ''].join('\n');
    paste(text);
    expect(screen.getByLabelText('Excel 制表符文本')).toHaveValue(text);
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('内存预览最多 100 条数据行');
    expect(screen.queryByRole('region', { name: '第 2 行预览' })).not.toBeInTheDocument();
    expect(within(ledger()).getAllByRole('row')).toHaveLength(4);
  });

  it('rejects a final cell with 2000 characters plus a trailing space without truncation', () => {
    setup();
    const cell = `${'甲'.repeat(2000)} `;
    expect(cell).toHaveLength(2001);
    const text = `客户\n${cell}`;
    click('粘贴 Excel');
    change('Excel 制表符文本', text);
    click('预览粘贴内容');
    expect(screen.getByLabelText('Excel 制表符文本')).toHaveValue(text);
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('单元格超过内存预览 2000 字符上限');
    expect(screen.queryByRole('region', { name: '第 2 行预览' })).not.toBeInTheDocument();
    expect(within(ledger()).getAllByRole('row')).toHaveLength(4);
  });

  it('retains the final service cell trailing space as raw text and an anomaly', () => {
    setup();
    paste('客户\t服务方式\n尾格客户\t远程指导 ');
    const preview = screen.getByRole('region', { name: '第 2 行预览' });
    fireEvent.click(within(preview).getByText('核对本行原始字段'));
    expect(within(preview).getByText('服务方式', { selector: 'dt' }).nextElementSibling?.textContent).toBe('远程指导 ');
    expect(within(preview).getByRole('listitem').textContent).toBe('服务方式 · 原填写「远程指导 」· 未知选项，保留原文待补正');
    click('继续（保留警告）');
    expect(screen.getByRole('button', { name: 'CQ-DEMO-004 原文待补正说明' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '操作反馈' })).toHaveTextContent('新增 1；补充 0；待补 1；跳过 0');
    click('查看 CQ-DEMO-004');
    const detail = screen.getByRole('region', { name: '客诉详情 CQ-DEMO-004' });
    expect(within(detail).getByText('服务方式', { selector: 'dt' }).nextElementSibling?.textContent).toBe('远程指导 ');
    expect(detail).toHaveTextContent('服务方式：远程指导 · 未知选项，保留原文待补正');
  });

  it('retains source row numbers and both error-filter and manual-skip reasons after processing', () => {
    setup();
    paste('客户\t数量\t服务方式\t追溯码\n有效客户\t2\t远程指导\t\n\t\t\t\n错误客户\t坏数量\t未知方式\t\n演示客户甲\t1\t\tTRACE-DEMO-01');
    expect(screen.getByRole('region', { name: '第 4 行预览' })).toHaveTextContent('错误客户');
    change('第 5 行重复处理', 'skip');
    click('跳过错误行');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const results = screen.getByRole('region', { name: '本次登记结果' });
    fireEvent.click(within(results).getByText('逐行处理结果 · 仅内存'));
    expect(within(results).getByLabelText('第 2 行处理结果')).toHaveTextContent('新增');
    const rejected = within(results).getByLabelText('第 4 行处理结果');
    expect(rejected).toBeVisible();
    expect(rejected).toHaveTextContent('跳过');
    expect(rejected).toHaveTextContent('数量 · 原填写「坏数量」· 不是有效正整数');
    expect(rejected).toHaveTextContent('服务方式 · 原填写「未知方式」· 未知选项');
    expect(within(results).getByLabelText('第 5 行处理结果')).toHaveTextContent('人工选择跳过疑似重复');
    expect(screen.getByRole('status', { name: '操作反馈' })).toHaveTextContent('新增 1；补充 0；待补 0；跳过 2');
    expect(within(ledger()).getAllByRole('row')).toHaveLength(5);
    click('查看 CQ-DEMO-001');
    expect(details()).toHaveTextContent('登记数量：3');
  });

  it('reports actual created, supplemented, pending-correction and manually skipped rows separately', () => {
    setup();
    paste('客户\t追溯码\t数量\t详细故障描述\n待正客户\t\t坏数量\t保留原文\n演示客户甲\tTRACE-DEMO-01\t\t明确补充\n演示客户乙\tTRACE-DEMO-02\t1\t不应用');
    change('第 3 行重复处理', 'supplement');
    change('第 4 行重复处理', 'skip');
    click('继续（保留警告）');
    click('确认补充到内存');
    const results = screen.getByRole('region', { name: '本次登记结果' });
    fireEvent.click(within(results).getByText('逐行处理结果 · 仅内存'));
    expect(within(results).getByLabelText('第 4 行处理结果')).toBeVisible();
    expect(within(results).getByLabelText('第 2 行处理结果')).toHaveTextContent('新增 CQ-DEMO-004 · 待补正');
    expect(within(results).getByLabelText('第 3 行处理结果')).toHaveTextContent('补充 CQ-DEMO-001');
    expect(within(results).getByLabelText('第 4 行处理结果')).toHaveTextContent('跳过 · 人工选择跳过疑似重复');
    expect(screen.getByRole('status', { name: '操作反馈' })).toHaveTextContent('新增 1；补充 1；待补 1；跳过 1');
    click('查看 CQ-DEMO-001');
    expect(details()).toHaveTextContent('明确补充');
    expect(details()).toHaveTextContent('登记数量：3');
  });

  it('filters the same facts through three views and resets all memory on remount', () => {
    const view = render(<LanguageProvider><ThemeProvider><CustomerQualityPreview /></ThemeProvider></LanguageProvider>);
    expect(screen.getByRole('alert')).toHaveTextContent('仅内存 / 无API / 刷新重置');
    expect(within(ledger()).getAllByRole('row')).toHaveLength(4);
    click('零公里');
    expect(within(ledger()).getAllByRole('row')).toHaveLength(2);
    expect(ledger()).toHaveTextContent('CQ-DEMO-002');
    click('售后');
    expect(ledger()).toHaveTextContent('CQ-DEMO-001');
    expect(ledger()).not.toHaveTextContent('CQ-DEMO-002');
    click('查看 CQ-DEMO-001');
    change('快递单号', 'LOCAL-ONLY');
    click('保存收件到内存');
    expect(details()).toHaveTextContent('LOCAL-ONLY');
    view.unmount();
    setup();
    click('查看 CQ-DEMO-001');
    expect(screen.getByLabelText('快递单号')).toHaveValue('');
  });

  it('registers missing mappings without defaulting service/interception or fabricating calculations', () => {
    setup();
    click('单条登记');
    expect(screen.getByLabelText('服务方式')).toHaveValue('');
    expect(screen.getByLabelText('拦截状态')).toHaveValue('');
    expect(within(screen.getByLabelText('服务方式')).getAllByRole('option').map(option => option.textContent)).toEqual(['请选择（空）', '远程指导', '现场现调', '未接到通知']);
    change('客户', '演示新客户');
    change('类型', '售后');
    change('组件号', 'NO-MAP');
    change('数量', '');
    change('服务方式', '现场现调');
    change('拦截状态', '否，不索赔');
    change('详细故障描述', '待匹配也可登记');
    click('预览单条');
    expect(screen.getByRole('dialog')).toHaveTextContent('未检索到映射关系');
    click('继续（保留警告）');
    expect(ledger()).toHaveTextContent('CQ-DEMO-004');
    click('查看 CQ-DEMO-004');
    expect(screen.getByRole('region', { name: '客诉详情 CQ-DEMO-004' })).toHaveTextContent('未计算');
    expect(screen.getByRole('region', { name: '客诉详情 CQ-DEMO-004' })).toHaveTextContent('现场现调');
    expect(screen.getByRole('region', { name: '客诉详情 CQ-DEMO-004' })).toHaveTextContent('否，不索赔');
    expect(screen.getByLabelText('质量工程师')).toHaveValue('');
  });

  it('cancels real Excel preview without writes and skips only invalid pasted rows', async () => {
    setup();
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('演示').addRows([['客户', '类型', '数量', '服务方式', '拦截状态'], ['演示客户甲', '售后', '2', '现场现调', '否，索赔件']]);
    const bytes = await workbook.xlsx.writeBuffer();
    const file = new File([bytes], 'preview.xlsx');
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array(bytes).buffer });
    click('上传 Excel');
    fireEvent.change(screen.getByLabelText('选择 Excel 清单'), { target: { files: [file] } });
    const excelPreview = await screen.findByRole('dialog', { name: '登记预览 · 仅内存' });
    expect(excelPreview).toHaveTextContent('现场现调');
    expect(excelPreview).toHaveTextContent('否，索赔件');
    click('取消');
    expect(within(ledger()).getAllByRole('row')).toHaveLength(4);
    paste('客户\t类型\t数量\t服务方式\n演示客户甲\t售后\t2\t远程指导\n未知客户\t零公里\t坏数量\t未知方式');
    expect(screen.getByRole('dialog')).toHaveTextContent('坏数量');
    click('取消');
    expect(within(ledger()).getAllByRole('row')).toHaveLength(4);
    paste('客户\t类型\t数量\t服务方式\n演示客户甲\t售后\t2\t远程指导\n未知客户\t零公里\t坏数量\t未知方式');
    click('跳过错误行');
    expect(within(ledger()).getAllByRole('row')).toHaveLength(5);
    expect(screen.getByRole('status', { name: '操作反馈' })).toHaveTextContent('新增 1；补充 0；待补 0；跳过 1');
  });

  it('keeps invalid originals on continue and requires explicit duplicate supplement confirmation', () => {
    setup();
    paste('客户\t类型\t追溯码\t数量\n演示客户甲\t售后\tTRACE-DEMO-01\t1');
    expect(screen.getByRole('button', { name: '继续（保留警告）' })).toBeDisabled();
    change('第 2 行重复处理', 'skip');
    click('继续（保留警告）');
    expect(within(ledger()).getAllByRole('row')).toHaveLength(4);
    paste('客户\t类型\t追溯码\t数量\n演示客户甲\t售后\tTRACE-DEMO-01\t1');
    change('第 2 行重复处理', 'add');
    click('继续（保留警告）');
    expect(within(ledger()).getAllByRole('row')).toHaveLength(5);
    paste('客户\t类型\t追溯码\t详细故障描述\t数量\t服务方式\n演示客户甲\t售后\tTRACE-DEMO-01\t补充原文\t未知\t现场现调');
    expect(screen.getByRole('dialog')).toHaveTextContent('疑似重复');
    change('第 2 行重复处理', 'supplement');
    click('继续（保留警告）');
    const dialog = screen.getByRole('dialog', { name: '确认补充具体变更' });
    expect(dialog).toHaveTextContent('详细故障描述');
    expect(dialog).toHaveTextContent('补充原文');
    fireEvent.click(within(dialog).getByRole('button', { name: '返回核对' }));
    expect(within(ledger()).getAllByRole('row')).toHaveLength(5);
    click('继续（保留警告）');
    click('确认补充到内存');
    click('查看 CQ-DEMO-001');
    expect(details()).toHaveTextContent('未知');
    expect(details()).toHaveTextContent('补充原文');
    expect(screen.getByLabelText('质量工程师')).toHaveValue('演示工程师林');
    expect(screen.getByLabelText('FAE 解析正文')).toHaveValue('演示：检查连接端子，待复核。');
  });

  it('shows the mapping warning on both focus and hover and preserves manual engineers on recovery', async () => {
    setup();
    const user = userEvent.setup();
    const warning = screen.getByRole('button', { name: 'CQ-DEMO-003 映射说明' });
    await user.hover(warning);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('未检索到映射关系');
    await user.unhover(warning);
    warning.focus();
    fireEvent.focus(warning);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('未检索到映射关系');
    click('查看 CQ-DEMO-003');
    expect(screen.getByLabelText('质量工程师')).toHaveValue('演示工程师周');
    click('演示补齐映射');
    expect(screen.getByLabelText('质量工程师')).toHaveValue('演示工程师周');
    expect(screen.getByRole('region', { name: '客诉详情 CQ-DEMO-003' })).toHaveTextContent('保留当前跟进人');
  });

  it('keeps FAE assignment/transfer, SQE and selected attachments independent', () => {
    setup();
    click('查看 CQ-DEMO-001');
    change('直接指定 FAE', '演示FAE陈');
    click('指定 FAE 到内存');
    change('FAE 解析正文', '');
    fireEvent.change(screen.getByLabelText('FAE 附件选择'), { target: { files: [new File(['demo'], 'analysis.txt')] } });
    expect(details()).toHaveTextContent('analysis.txt · 仅已选择，未上传');
    click('返回台账');
    const leave = screen.getByRole('dialog', { name: '未保存的演示修改' });
    fireEvent.click(within(leave).getByRole('button', { name: '继续编辑' }));
    expect(details()).toHaveTextContent('analysis.txt · 仅已选择，未上传');
    click('保存 FAE 解析到内存');
    expect(screen.getByRole('group', { name: 'FAE 解析' })).toHaveTextContent('待解析');
    change('FAE 解析正文', '已检查实物端子（演示文字）');
    click('保存 FAE 解析到内存');
    expect(screen.getByRole('group', { name: 'FAE 解析' })).toHaveTextContent('已解析（演示文字）');
    change('同部门内部转派', '演示FAE吴');
    click('确认内部转派');
    expect(screen.getByRole('group', { name: 'FAE 解析' })).toHaveTextContent('演示FAE吴');
    change('指定 SQE', '演示SQE宋');
    change('供应商分析正文', '供应商批次核对中');
    click('保存 SQE 分析到内存');
    expect(screen.getByRole('group', { name: 'SQE 供应商分析' })).toHaveTextContent('供应商批次核对中');
    expect(screen.getByLabelText('FAE 解析正文')).toHaveValue('已检查实物端子（演示文字）');
    expect(details()).toHaveTextContent('跟进中');
  });

  it('requires close/reopen reasons, keeps history and never changes existing 8D or quantity', () => {
    setup();
    click('查看 CQ-DEMO-001');
    expect(screen.getByRole('button', { name: '关闭来源（内存）' })).toBeDisabled();
    change('关闭结论或恢复原因', '演示调查结论');
    change('演示操作身份（非认证）', '指定 FAE');
    expect(screen.getByRole('button', { name: '关闭来源（内存）' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存收件到内存' })).toBeDisabled();
    change('演示操作身份（非认证）', '对应工程师');
    click('关闭来源（内存）');
    expect(details()).toHaveTextContent('已关闭');
    expect(screen.getByLabelText('关闭结论或恢复原因')).toHaveValue('');
    expect(screen.getByRole('button', { name: '恢复跟进（内存）' })).toBeDisabled();
    change('关闭结论或恢复原因', '补充资料继续跟进');
    click('恢复跟进（内存）');
    expect(details()).toHaveTextContent('跟进中');
    expect(screen.getByRole('region', { name: '来源历史' })).toHaveTextContent('演示调查结论');
    expect(screen.getByRole('region', { name: '来源历史' })).toHaveTextContent('补充资料继续跟进');
    expect(screen.getByRole('group', { name: '已有 8D 引用' })).toHaveTextContent('8D-DEMO-018 · 审核中');
    expect(details()).toHaveTextContent('登记数量：3');
  });
});
