import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { ProcessEightDPreview } from './ProcessEightDPreview';

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const change = (name: string, value: string) => {
  // Follow the explicit label binding without rescanning every control's labels in JSDOM.
  const label = screen.getByText<HTMLLabelElement>(name, { selector: 'label', exact: true });
  if (!label.control) throw new Error(`Unbound label: ${name}`);
  fireEvent.change(label.control, { target: { value } });
};
const current = () => screen.getByRole('region', { name: '当前审核轮次' });
const duty = (name: string) => within(current()).getByRole('group', { name });

function setup() {
  render(<LanguageProvider><ThemeProvider><ProcessEightDPreview /></ThemeProvider></LanguageProvider>);
}

async function openWorkspace() {
  setup();
  fireEvent.click(screen.getByRole('checkbox', { name: '选择来源 SRC-001' }));
  click('发单预览');
  fireEvent.click(await screen.findByRole('button', { name: '创建内存8D样例' }));
  await screen.findByRole('heading', { name: '内部8D · 演示工作空间' });
}

function completeDraft() {
  change('D2 问题描述', '演示装配工序发现连接松动，待核对影响范围。');
  change('A1 明确有效结论', 'yes');
  change('A2 明确有效结论', 'yes');
}

describe('process / internal 8D isolated memory preview', () => {
  it('keeps one source per row, expands materials and preserves cross-page single/multiple selection', async () => {
    setup();
    expect(screen.getByRole('alert')).toHaveTextContent('仅内存 / 无API / 刷新重置');
    expect(screen.getAllByText('同码多线索 · 不自动合并')).toHaveLength(2);
    click('展开 SRC-001 物料');
    expect(screen.getByRole('region', { name: 'SRC-001 多物料' })).toHaveTextContent('演示物料B');
    expect(screen.getByRole('button', { name: '发单预览' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '选择来源 SRC-001' }));
    click('发单预览');
    let dialog = await screen.findByRole('dialog', { name: '发单预览（非真实发单）' });
    expect(dialog).toHaveTextContent('已选 1 条来源');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await screen.findByRole('button', { name: '下一页' });
    click('下一页');
    expect(screen.getByRole('status', { name: '来源选择摘要' })).toHaveTextContent('跨页保留');
    fireEvent.click(screen.getByRole('checkbox', { name: '选择来源 SRC-003' }));
    click('发单预览');
    dialog = await screen.findByRole('dialog', { name: '发单预览（非真实发单）' });
    expect(dialog).toHaveTextContent('已选 2 条来源');
    expect(dialog).toHaveTextContent('SRC-001');
    expect(dialog).toHaveTextContent('SRC-003');
  });

  it('saves incomplete drafts, locates missing fields and locks the submitted revision', async () => {
    await openWorkspace();
    click('保存内存草稿');
    expect(screen.getByRole('status', { name: '操作反馈' })).toHaveTextContent('已保存到内存');
    click('完整提交（演示）');
    const errors = screen.getByRole('region', { name: '提交缺项' });
    fireEvent.click(within(errors).getByRole('button', { name: '定位 D2 问题描述' }));
    expect(screen.getByLabelText('D2 问题描述')).toHaveFocus();
    expect(errors).not.toHaveTextContent('系统因');
    expect(errors).not.toHaveTextContent('OK');
    completeDraft();
    click('完整提交（演示）');
    expect(current()).toHaveTextContent('第 1 轮');
    expect(screen.getByLabelText('D2 问题描述')).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存内存草稿' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '完整提交（演示）' })).toBeDisabled();
  });

  it('runs both sides independently and invalidates the entire returned round before resubmission', async () => {
    await openWorkspace();
    const description = screen.getByText<HTMLLabelElement>('D2 问题描述', { selector: 'label', exact: true }).control;
    const descriptionField = () => {
      expect(screen.getByText<HTMLLabelElement>('D2 问题描述', { selector: 'label', exact: true }).control).toBe(description);
      expect(description).toHaveRole('textbox');
      expect(description).toHaveAccessibleName('D2 问题描述');
      expect(description).toBeVisible();
      expect(description).toBeInTheDocument();
      return description;
    };
    completeDraft();
    click('完整提交（演示）');
    expect(duty('专业审核')).toHaveTextContent('待审核');
    expect(duty('经理审核')).toHaveTextContent('待审核');
    click('经理审核通过');
    expect(duty('专业审核')).toHaveTextContent('待审核');
    expect(duty('经理审核')).toHaveTextContent('已通过');
    click('专业审核退回');
    expect(current()).toHaveTextContent('整轮失效');
    expect(descriptionField()).not.toBeDisabled();
    click('完整提交（演示）');
    expect(current()).toHaveTextContent('第 2 轮');
    expect(duty('专业审核')).toHaveTextContent('待审核');
    expect(duty('经理审核')).toHaveTextContent('待审核');
    click('专业审核通过');
    expect(duty('经理审核')).toHaveTextContent('待审核');
    click('经理审核通过');
    expect(current()).toHaveTextContent('演示汇聚完成');
    expect(descriptionField()).toBeDisabled();
    click('轨迹');
    expect(screen.getByRole('region', { name: '轮次轨迹' })).toHaveTextContent('第 1 轮');
    expect(screen.getByRole('region', { name: '轮次轨迹' })).toHaveTextContent('旧结果不计入新轮');
  });

  it('records same-manager skips but does not skip the minister for high risk', async () => {
    await openWorkspace();
    completeDraft();
    fireEvent.click(screen.getByRole('checkbox', { name: '演示负责人 = 经理' }));
    click('完整提交（演示）');
    expect(duty('经理审核')).toHaveTextContent('同人跳过（留痕）');
    expect(duty('专业审核')).toHaveTextContent('待审核');
    click('专业审核退回');
    fireEvent.click(screen.getByRole('radio', { name: '高风险' }));
    click('完整提交（演示）');
    expect(duty('部长审核')).toHaveTextContent('待审核');
    expect(within(current()).queryByRole('group', { name: '经理审核' })).not.toBeInTheDocument();
  });

  it('cancels source changes without writes, then explicitly invalidates review on confirmation', async () => {
    await openWorkspace();
    completeDraft();
    click('完整提交（演示）');
    click('专业审核通过');
    click('调整来源');
    let dialog = await screen.findByRole('dialog', { name: '调整来源（内存演示）' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '关联 SRC-002' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(screen.getByRole('region', { name: '关联来源' })).not.toHaveTextContent('SRC-002');
    expect(duty('专业审核')).toHaveTextContent('已通过');
    click('调整来源');
    dialog = await screen.findByRole('dialog', { name: '调整来源（内存演示）' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '关联 SRC-002' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认变更并取消整轮审核' }));
    expect(current()).toHaveTextContent('来源变更撤审');
    expect(screen.getByRole('region', { name: '关联来源' })).toHaveTextContent('SRC-002');
    click('完整提交（演示）');
    expect(duty('专业审核')).toHaveTextContent('待审核');
    expect(duty('经理审核')).toHaveTextContent('待审核');
  });

  it('restores creation sources when discarding changes before the first save', async () => {
    await openWorkspace();
    click('调整来源');
    const sourcesDialog = await screen.findByRole('dialog', { name: '调整来源（内存演示）' });
    fireEvent.click(within(sourcesDialog).getByRole('checkbox', { name: '关联 SRC-002' }));
    fireEvent.click(within(sourcesDialog).getByRole('button', { name: '应用来源变更' }));
    expect(screen.getByRole('region', { name: '关联来源' })).toHaveTextContent('SRC-002');
    click('返回来源台账');
    const leaveDialog = await screen.findByRole('dialog', { name: '未保存的内存修改' });
    fireEvent.click(within(leaveDialog).getByRole('button', { name: '放弃修改并返回台账' }));
    await screen.findByRole('heading', { name: '过程来源台账' });
    click('返回当前8D样例');
    const sources = screen.getByRole('region', { name: '关联来源' });
    expect(sources).toHaveTextContent('D2 来源明细 · 1 条');
    expect(sources).toHaveTextContent('SRC-001');
    expect(sources).not.toHaveTextContent('SRC-002');
    click('报告');
    expect(screen.getByText('尚无已保存快照，请先保存内存草稿')).toBeInTheDocument();
  });

  it('requires a positive safe integer batch count or nonblank duration while keeping the actual first batch mandatory', async () => {
    await openWorkspace();
    const section = screen.getByRole('heading', { name: 'D6 同一措施的实施与有效性' }).closest('section');
    if (!section) throw new Error('D6 section not found');
    const d6 = within(section);
    const followUpDuration = d6.getByLabelText('A1 后续跟进时长');
    const followUpBatches = d6.getByLabelText('A1 后续批数');
    const firstBatch = d6.getByLabelText('A1 首批导入断点');
    const secondActionBatches = d6.getByLabelText('A2 后续批数');
    const submit = screen.getByRole('button', { name: '完整提交（演示）' });
    // Follow the rendered section/label bindings instead of rescanning the entire 8D form.
    const round = document.querySelector('section[aria-label="当前审核轮次"]');
    const description = document.querySelector<HTMLTextAreaElement>('textarea#description');
    expect(round).toHaveRole('region');
    expect(round).toBeVisible();
    expect(round).toBeInTheDocument();
    expect(description).toHaveRole('textbox');
    expect(description).toBeVisible();
    expect(description).toBeInTheDocument();
    expect(screen.getByText<HTMLLabelElement>('D2 问题描述', { selector: 'label', exact: true }).control).toBe(description);
    completeDraft();
    fireEvent.change(followUpDuration, { target: { value: '   ' } });
    for (const batches of ['0.5', '0', '-1', '9007199254740992']) {
      fireEvent.change(followUpBatches, { target: { value: batches } });
      fireEvent.click(submit);
      const errors = document.querySelector('section[aria-label="提交缺项"]');
      expect(errors).toHaveRole('region');
      expect(errors).toBeVisible();
      expect(errors).toBeInTheDocument();
      expect(errors).toHaveTextContent('A1 后续批数或时长');
      expect(round).toBeVisible();
      expect(round).toBeInTheDocument();
      expect(round).toHaveTextContent('尚未完整提交');
      expect(description).toBeVisible();
      expect(description).toBeInTheDocument();
      expect(description).not.toBeDisabled();
    }
    fireEvent.change(followUpDuration, { target: { value: '两周' } });
    fireEvent.change(firstBatch, { target: { value: '' } });
    fireEvent.click(submit);
    const errors = document.querySelector('section[aria-label="提交缺项"]');
    expect(errors).toHaveRole('region');
    expect(errors).toBeVisible();
    expect(errors).toBeInTheDocument();
    expect(errors).toHaveTextContent('A1 首批导入断点');
    expect(errors).not.toHaveTextContent('A1 后续批数或时长');
    fireEvent.change(firstBatch, { target: { value: 'DEMO-FIRST-1' } });
    fireEvent.change(followUpBatches, { target: { value: '' } });
    fireEvent.change(secondActionBatches, { target: { value: '9007199254740991' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '展示可选扩展围堵' }));
    fireEvent.click(submit);
    expect(document.querySelector('section[aria-label="提交缺项"]')).not.toBeInTheDocument();
    expect(round).toBeVisible();
    expect(round).toBeInTheDocument();
    expect(round).toHaveTextContent('第 1 轮');
    expect(description).toBeVisible();
    expect(description).toBeInTheDocument();
    expect(description).toBeDisabled();
  });

  it('retains input on simulated save failure and renders only the saved report snapshot', async () => {
    await openWorkspace();
    completeDraft();
    click('保存内存草稿');
    fireEvent.click(screen.getByRole('checkbox', { name: '模拟保存失败（无请求）' }));
    change('D2 问题描述', '未保存的新描述');
    click('保存内存草稿');
    expect(screen.getByRole('status', { name: '操作反馈' })).toHaveTextContent('模拟失败，输入已保留');
    expect(screen.getByLabelText('D2 问题描述')).toHaveValue('未保存的新描述');
    click('报告');
    expect(screen.getByLabelText('报告 D2 问题描述')).toHaveValue('演示装配工序发现连接松动，待核对影响范围。');
    expect(screen.getByRole('button', { name: 'PDF导出未接入' })).toBeDisabled();
  });

  it('keeps seven standardization columns and eleven presets, supports adding rows and placeholder dialogs', async () => {
    await openWorkspace();
    const table = screen.getByRole('table', { name: 'D7 标准化清单' });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(7);
    expect(within(table).getAllByRole('row')).toHaveLength(12);
    click('新增标准化行');
    expect(within(table).getAllByRole('row')).toHaveLength(13);
    expect(screen.getByRole('checkbox', { name: '展示可选扩展围堵' })).not.toBeChecked();
    click('D4 分析附件演示占位');
    const dialog = await screen.findByRole('dialog', { name: '附件演示占位 · 非真实文件' });
    expect(dialog).toHaveTextContent('未上传、未扫描');
    expect(dialog).toHaveTextContent('不代表扫描通过');
  });

  it('containment-locations: keeps nine blank locations in both tables and edits two locations independently', async () => {
    await openWorkspace();
    const positions = [
      ['PCBA', '在制品'], ['PCBA', '智新库存'],
      ['成品', '客户端'], ['成品', '运输中'], ['成品', '智新库存'], ['成品', '在制品'], ['成品', 'VMI仓'],
      ['物料', '供应商'], ['物料', '公司内'],
    ];
    function checkInitialRows(table: HTMLElement, kind: string) {
      const rows = within(table).getAllByRole('row');
      expect(rows).toHaveLength(10);
      positions.forEach(([group, location], index) => {
        expect(within(rows[index + 1]).getByLabelText(`围堵${kind}${index + 1} 对象`)).toHaveValue(group);
        expect(within(rows[index + 1]).getByLabelText(`围堵${kind}${index + 1} 位置 / 范围`)).toHaveValue(location);
      });
      within(table).getAllByRole('spinbutton').forEach(input => expect(input).toHaveValue(null));
    }
    const main = screen.getByRole('table', { name: 'D3 库存围堵' });
    checkInitialRows(main, '库存');
    change('围堵库存1 数量（未知留空）', '3');
    change('围堵库存1 措施', '在制品逐件筛选');
    change('围堵库存2 数量（未知留空）', '7');
    change('围堵库存2 措施', '库存隔离待复核');
    fireEvent.click(screen.getByRole('checkbox', { name: '展示可选扩展围堵' }));
    const extended = screen.getByRole('table', { name: 'D3 可选扩展围堵' });
    checkInitialRows(extended, '扩展');
    change('围堵扩展1 数量（未知留空）', '11');
    change('围堵扩展1 措施', '扩展在制品检查');
    change('围堵扩展2 数量（未知留空）', '13');
    change('围堵扩展2 措施', '扩展库存确认');
    const mainRows = within(main).getAllByRole('row');
    const extendedRows = within(extended).getAllByRole('row');
    expect(within(mainRows[1]).getByLabelText('围堵库存1 数量（未知留空）')).toHaveValue(3);
    expect(within(mainRows[2]).getByLabelText('围堵库存2 数量（未知留空）')).toHaveValue(7);
    expect(within(mainRows[1]).getByLabelText('围堵库存1 措施')).toHaveValue('在制品逐件筛选');
    expect(within(mainRows[2]).getByLabelText('围堵库存2 措施')).toHaveValue('库存隔离待复核');
    expect(within(extendedRows[1]).getByLabelText('围堵扩展1 数量（未知留空）')).toHaveValue(11);
    expect(within(extendedRows[2]).getByLabelText('围堵扩展2 数量（未知留空）')).toHaveValue(13);
    expect(within(extendedRows[1]).getByLabelText('围堵扩展1 措施')).toHaveValue('扩展在制品检查');
    expect(within(extendedRows[2]).getByLabelText('围堵扩展2 措施')).toHaveValue('扩展库存确认');
  });

  it('firstBatch-guidance: requires the actual first improvement batch, with document versions only supporting it', async () => {
    await openWorkspace();
    const section = screen.getByRole('heading', { name: 'D6 同一措施的实施与有效性' }).closest('section');
    expect(section).toHaveTextContent('必须填写实际应用改善的首批批次；规范 / 程序版本仅作辅助说明，不能替代首批批次。');
    expect(section).not.toHaveTextContent('批次或规范 / 程序导入依据');
  });

  it('blocks ineffective or incomplete D6 actions without requiring optional content', async () => {
    await openWorkspace();
    completeDraft();
    change('A1 首批导入断点', '');
    change('A2 明确有效结论', 'no');
    click('完整提交（演示）');
    const errors = screen.getByRole('region', { name: '提交缺项' });
    expect(errors).toHaveTextContent('A1 首批导入断点');
    expect(errors).toHaveTextContent('A2 明确有效结论');
    expect(screen.getByLabelText('D2 问题描述')).not.toBeDisabled();
    expect(errors).not.toHaveTextContent('系统因');
  });

  it('shows empty/error/loading states and makes read-only selections inert', async () => {
    setup();
    change('演示页面状态', 'empty');
    expect(screen.getByText('暂无来源（演示空态）')).toBeInTheDocument();
    change('演示页面状态', 'error');
    expect(screen.getByText('演示读取失败，未发起网络请求')).toBeInTheDocument();
    click('恢复正常演示');
    change('演示页面状态', 'loading');
    expect(screen.getByRole('status', { name: '演示加载状态' })).toHaveTextContent('不请求服务');
    change('演示页面状态', 'readonly');
    expect(screen.getByRole('checkbox', { name: '选择来源 SRC-001' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发单预览' })).toBeDisabled();
  });

  it('supports keyboard selection and guards dirty navigation without discarding input', async () => {
    const user = userEvent.setup();
    setup();
    const selection = screen.getByRole('checkbox', { name: '选择来源 SRC-001' });
    selection.focus();
    await user.keyboard(' ');
    expect(selection).toBeChecked();
    click('发单预览');
    fireEvent.click(await screen.findByRole('button', { name: '创建内存8D样例' }));
    await screen.findByRole('heading', { name: '内部8D · 演示工作空间' });
    change('D2 问题描述', '保留的未保存草稿');
    click('返回来源台账');
    const dialog = await screen.findByRole('dialog', { name: '未保存的内存修改' });
    fireEvent.click(within(dialog).getByRole('button', { name: '继续编辑' }));
    expect(screen.getByLabelText('D2 问题描述')).toHaveValue('保留的未保存草稿');
    expect(screen.getByRole('link', { name: 'D4 原因分析' })).toHaveAttribute('href', '#work-d4');
  });
});
