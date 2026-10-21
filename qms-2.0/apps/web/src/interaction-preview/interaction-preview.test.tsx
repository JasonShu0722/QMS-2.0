import { fireEvent, render as testingRender, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { BasicExamples } from './BasicExamples';
import { ScenarioExamples } from './ScenarioExamples';
import { InteractionPreview } from './InteractionPreview';
import { LanguageProvider } from '../i18n/Language';
import { ThemeProvider } from '../theme/ThemeProvider';

const render = (children: ReactNode) => testingRender(<ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>);

describe('local interaction preview', () => {
  it('exposes eight reviewable groups and planned domain boundaries without business navigation', () => {
    localStorage.clear();
    render(<LanguageProvider><ThemeProvider><InteractionPreview /></ThemeProvider></LanguageProvider>);
    const directory = screen.getByRole('navigation', { name: '样例目录' });
    expect(within(directory).getAllByRole('link')).toHaveLength(9);
    expect(screen.getByText('D20')).toBeVisible();
    expect(screen.getByText('视觉确认候选')).toBeVisible();
    localStorage.clear();
  });

  it('keeps a pending choice separate from the applied setting', async () => {
    render(<BasicExamples english={false} />);
    const group = screen.getByRole('region', { name: 'S02 选择与切换' });
    fireEvent.click(within(group).getByRole('radio', { name: '逐项审核' }));
    expect(within(group).getByText('当前生效：统一审核')).toBeVisible();
    fireEvent.click(within(group).getByRole('button', { name: '保存设置' }));
    expect(await within(group).findByText('当前生效：逐项审核')).toBeVisible();
  });

  it('protects the changed modal form on cancellation', async () => {
    render(<BasicExamples english={false} />);
    fireEvent.click(screen.getByRole('button', { name: '打开编辑弹窗' }));
    const dialog = screen.getByRole('dialog', { name: '编辑示例记录' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '问题标题' }), { target: { value: '修改后的样例' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
    const continueEditing = await screen.findByRole('button', { name: '继续编辑' });
    expect(continueEditing).toBeInTheDocument();
    fireEvent.click(continueEditing);
    expect(within(dialog).getByRole('textbox', { name: '问题标题' })).toHaveValue('修改后的样例');
  }, 60000);

  it('shows failed sample saves and allows retry without claiming business success', async () => {
    render(<BasicExamples english={false} />);
    const group = screen.getByRole('region', { name: 'S01 按钮与动作层级' });
    fireEvent.click(within(group).getByRole('checkbox', { name: '模拟保存失败' }));
    fireEvent.click(within(group).getByRole('button', { name: '保存样例' }));
    expect(await within(group).findByText('样例保存失败，内容已保留。')).toBeVisible();
    fireEvent.click(within(group).getByRole('checkbox', { name: '模拟保存失败' }));
    fireEvent.click(within(group).getByRole('button', { name: '保存样例' }));
    expect(await within(group).findByText('样例保存完成，仅保存在当前页面。')).toBeVisible();
  });

  it('confirms local sample deletion and preserves the sample when cancelled', async () => {
    render(<BasicExamples english={false} />);
    const group = screen.getByRole('region', { name: 'S01 按钮与动作层级' });
    fireEvent.click(within(group).getByRole('button', { name: '删除样例演示' }));
    const dialog = await screen.findByRole('dialog', { name: '确认删除本地样例' });
    expect(within(group).queryByText('危险动作样例：未删除任何记录。')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
    expect(within(group).queryByText('危险动作样例：未删除任何记录。')).not.toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: '更多动作' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除样例演示' }));
    const reopened = await screen.findByRole('dialog', { name: '确认删除本地样例' });
    fireEvent.click(within(reopened).getByRole('button', { name: '确认删除样例' }));
    expect(await within(group).findByText('危险动作样例：未删除任何记录。')).toBeVisible();
  });

  it('blocks local version submission until current edits are saved', async () => {
    render(<ScenarioExamples english={false} />);
    const group = screen.getByRole('region', { name: 'S05 流程与高风险动作' });
    const input = within(group).getByRole('textbox', { name: '流程草稿说明' });
    const submit = within(group).getByRole('button', { name: '提交已保存版本' });
    expect(submit).toBeDisabled();
    fireEvent.change(input, { target: { value: '第一版说明' } });
    expect(submit).toBeDisabled();
    fireEvent.click(within(group).getByRole('button', { name: '保存流程草稿' }));
    expect(await within(group).findByText('本地草稿版本 1 已保存。')).toBeVisible();
    expect(submit).toBeEnabled();
    fireEvent.change(input, { target: { value: '第二版说明' } });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(within(group).queryByText(/本地已提交版本/)).not.toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: '保存流程草稿' }));
    expect(await within(group).findByText('本地草稿版本 2 已保存。')).toBeVisible();
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(await within(group).findByText('本地已提交版本 2：第二版说明；未发出业务请求。')).toBeVisible();
  });

  it('retains unsaved local workflow input and blocks stale submission after a failed save', async () => {
    render(<ScenarioExamples english={false} />);
    const group = screen.getByRole('region', { name: 'S05 流程与高风险动作' });
    const input = within(group).getByRole('textbox', { name: '流程草稿说明' });
    fireEvent.change(input, { target: { value: '已保存说明' } });
    fireEvent.click(within(group).getByRole('button', { name: '保存流程草稿' }));
    expect(await within(group).findByText('本地草稿版本 1 已保存。')).toBeVisible();
    fireEvent.change(input, { target: { value: '失败后仍需保留的说明' } });
    fireEvent.click(within(group).getByRole('checkbox', { name: '模拟草稿保存失败' }));
    fireEvent.click(within(group).getByRole('button', { name: '保存流程草稿' }));
    expect(await within(group).findByText('本地草稿保存失败，输入已保留。')).toBeVisible();
    expect(input).toHaveValue('失败后仍需保留的说明');
    expect(within(group).getByRole('button', { name: '提交已保存版本' })).toBeDisabled();
    fireEvent.click(within(group).getByRole('checkbox', { name: '模拟草稿保存失败' }));
    fireEvent.click(within(group).getByRole('button', { name: '保存流程草稿' }));
    expect(await within(group).findByText('本地草稿版本 2 已保存。')).toBeVisible();
    expect(input).toHaveValue('失败后仍需保留的说明');
    expect(within(group).getByRole('button', { name: '提交已保存版本' })).toBeEnabled();
  });

  it('requires a return reason and enforces sample processing eligibility', async () => {
    render(<ScenarioExamples english={false} />);
    const group = screen.getByRole('region', { name: 'S05 流程与高风险动作' });
    expect(within(group).getByRole('button', { name: '退回补充' })).toBeDisabled();
    fireEvent.change(within(group).getByRole('textbox', { name: '处理理由' }), { target: { value: '请补充检验记录' } });
    fireEvent.click(within(group).getByRole('button', { name: '退回补充' }));
    expect(await within(group).findByText('样例已退回补充。')).toBeVisible();
    expect(within(group).getByRole('button', { name: '验证通过' })).toBeDisabled();
    fireEvent.click(within(group).getByRole('button', { name: '重置流程样例' }));
    expect(within(group).getByRole('button', { name: '验证通过' })).toBeEnabled();
    fireEvent.click(within(group).getByRole('radio', { name: '只读查看者' }));
    expect(within(group).getByRole('button', { name: '验证通过' })).toBeDisabled();
  });

  it('preserves completed import rows when retrying the failed sample row', async () => {
    render(<ScenarioExamples english={false} />);
    const group = screen.getByRole('region', { name: 'S06 导入与附件状态' });
    fireEvent.click(within(group).getByRole('button', { name: '运行示例导入' }));
    expect(await within(group).findByText('样例结果：成功 2，失败 1。', {}, { timeout: 3000 })).toBeVisible();
    await waitFor(() => expect(within(group).getByRole('button', { name: '重试失败行' })).toBeEnabled());
    fireEvent.click(within(group).getByRole('button', { name: '重试失败行' }));
    expect(await within(group).findByText('样例结果：成功 3，失败 0。', {}, { timeout: 3000 })).toBeVisible();
  });

  it('restores a failed local data area through its retry action', async () => {
    render(<ScenarioExamples english={false} />);
    const group = screen.getByRole('region', { name: 'S07 数据状态与详情' });
    fireEvent.click(within(group).getByRole('radio', { name: '加载失败' }));
    fireEvent.click(within(group).getByRole('button', { name: '重试加载' }));
    expect(await within(group).findByText('示例质量记录')).toBeVisible();
  });

  it('recognizes repeated scanner input without duplicating the local record', async () => {
    render(<ScenarioExamples english={false} />);
    const group = screen.getByRole('region', { name: 'S08 分析与扫码输入' });
    const input = within(group).getByRole('textbox', { name: '条码输入' });
    fireEvent.change(input, { target: { value: 'DEMO-001' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 });
    fireEvent.keyUp(input, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(await within(group).findByText('样例已记录 DEMO-001')).toBeVisible();
    fireEvent.change(input, { target: { value: 'DEMO-001' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 });
    fireEvent.keyUp(input, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(await within(group).findByText('重复条码，未重复记录。')).toBeVisible();
  });
});
