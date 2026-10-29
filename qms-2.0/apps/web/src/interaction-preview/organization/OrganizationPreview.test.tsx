import { ConfigProvider } from 'antd';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { OrganizationPreview } from './OrganizationPreview';

function setup() {
  localStorage.clear();
  return render(<LanguageProvider><ThemeProvider><ConfigProvider theme={{ token: { motion: false } }}><OrganizationPreview /></ConfigProvider></ThemeProvider></LanguageProvider>);
}

async function cleanupOrganizationPreview() {
  cleanup();
  // AntD Form's useDebounce schedules 0/10ms updates without unmount cleanup.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
}

afterEach(cleanupOrganizationPreview);

describe('organization workspace local preview', { timeout: 30000 }, () => {
  it('settles the real form delayed updates after unmount before teardown', async () => {
    const schedule = globalThis.setTimeout;
    const updates: ReturnType<typeof vi.fn>[] = [];
    const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
      if (new Error().stack?.includes('useDelayState.js')) {
        const update = vi.fn(callback);
        updates.push(update);
        return schedule(update, delay, ...args);
      }
      return schedule(callback, delay, ...args);
    });
    try {
      setup();
      fireEvent.click(screen.getByRole('button', { name: '编辑基本信息' }));
      expect(updates.length).toBeGreaterThan(0);
      expect(updates.every(update => update.mock.calls.length === 0)).toBe(true);
      await cleanupOrganizationPreview();
      expect(screen.queryByRole('dialog', { name: '编辑基本信息' })).not.toBeInTheDocument();
      for (const update of updates) expect(update).toHaveBeenCalledOnce();
    } finally {
      timer.mockRestore();
      cleanup();
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    }
  });

  it('preserves an unsaved node edit when cancellation is declined', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '编辑基本信息' }));
    const dialog = screen.getByRole('dialog', { name: '编辑基本信息' });
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: '保留的输入' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
    fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
    expect(within(dialog).getByLabelText('名称')).toHaveValue('保留的输入');
  });

  it('keeps failed save input and applies a correction to the same local object on retry', async () => {
    setup();
    fireEvent.click(screen.getByRole('checkbox', { name: '模拟保存失败' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑基本信息' }));
    const dialog = screen.getByRole('dialog', { name: '编辑基本信息' });
    fireEvent.change(within(dialog).getByLabelText('编码'), { target: { value: 'PROCESS-NEW' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存到本地样例' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('模拟保存失败');
    expect(within(dialog).getByLabelText('编码')).toHaveValue('PROCESS-NEW');
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭失败模拟' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '保存到本地样例' }));
    expect(await screen.findByText('PROCESS-NEW')).toBeVisible();
    expect(screen.queryByRole('dialog', { name: '编辑基本信息' })).not.toBeInTheDocument();
  });

  it('shows precise blockers without disabling or deleting the selected node', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '检查停用影响' }));
    const dialog = screen.getByRole('dialog', { name: '停用影响检查' });
    expect(within(dialog).getByRole('button', { name: '确认停用' })).toBeDisabled();
    await waitFor(() => expect(within(dialog).getByRole('alert')).toBeVisible());
    expect(within(dialog).getByRole('alert')).toHaveTextContent('存在部长分管关系');
  });

  it('creates an empty department locally and requires confirmation before deleting it', async () => {
    setup();
    fireEvent.click(within(screen.getByRole('tree')).getByText('演示公司'));
    fireEvent.click(screen.getByRole('button', { name: '新增部门' }));
    const dialog = screen.getByRole('dialog', { name: '新增部门' });
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: '新建演示部门' } });
    fireEvent.change(within(dialog).getByLabelText('编码'), { target: { value: 'TEMP-DEPT' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存到本地样例' }));
    await screen.findByText('TEMP-DEPT');
    fireEvent.click(screen.getByRole('button', { name: '检查删除影响' }));
    const confirmation = screen.getByRole('dialog', { name: '删除影响检查' });
    expect(within(confirmation).getByRole('button', { name: '确认删除' })).toBeEnabled();
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认删除' }));
    expect(await screen.findByRole('status')).toHaveTextContent('本地样例已删除');
    expect(within(screen.getByRole('tree')).queryByText('新建演示部门')).not.toBeInTheDocument();
  });

  it('disables mutation controls in the simulated read-only state while preserving the workspace', async () => {
    setup();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '查看交互状态' }));
    fireEvent.click(await screen.findByText('只读查看'));
    expect(screen.getByRole('button', { name: '编辑基本信息' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '检查删除影响' })).toBeDisabled();
    expect(screen.getByRole('tree')).toBeInTheDocument();
  });

  it('keeps the tree, heading and management scope consistent after renaming the organization', async () => {
    setup();
    fireEvent.click(within(screen.getByRole('tree')).getByText('演示公司'));
    fireEvent.click(screen.getByRole('button', { name: '编辑基本信息' }));
    const dialog = screen.getByRole('dialog', { name: '编辑基本信息' });
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: '新总部' } });
    fireEvent.change(within(dialog).getByLabelText('编码'), { target: { value: 'HQ-NEW' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存到本地样例' }));
    expect(within(screen.getByRole('tree')).getByText('新总部')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /新总部/ })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '组织架构' })).toHaveTextContent('新总部 · HQ-NEW');
  });

  it('distinguishes a child organization from a department and switches to its own empty scope', async () => {
    setup();
    fireEvent.click(within(screen.getByRole('tree')).getByText('演示公司'));
    fireEvent.click(screen.getByRole('button', { name: '新增子组织' }));
    const dialog = screen.getByRole('dialog', { name: '新增子组织' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('不继承');
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: '新工厂' } });
    fireEvent.change(within(dialog).getByLabelText('编码'), { target: { value: 'NEW-FACTORY' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存到本地样例' }));
    expect(screen.getByRole('complementary', { name: '组织架构' })).toHaveTextContent('新工厂 · NEW-FACTORY');
    fireEvent.click(screen.getByRole('tab', { name: '岗位与权限' }));
    expect(screen.queryByRole('cell', { name: '组织管理员' })).not.toBeInTheDocument();
  });
});
