import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { LanguageProvider } from '../../i18n/Language';
import { ConsolePreview } from './ConsolePreview';

const consoleCss = readFileSync('src/interaction-preview/console/console.css', 'utf8');

function setup() { return render(<LanguageProvider><ConsolePreview /></LanguageProvider>); }
function users() { fireEvent.click(screen.getByRole('button', { name: '组织与用户' })); }
function state(value: string) { fireEvent.change(screen.getByLabelText('样例状态'), { target: { value } }); }

beforeEach(() => { localStorage.clear(); });
afterEach(async () => {
  cleanup();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  vi.restoreAllMocks();
});

describe('isolated management console preview', () => {
  it('provides scoped 44px touch targets on narrow screens or coarse pointers without changing desktop density', () => {
    expect(consoleCss).toContain('.qmc-preview');
    const style = document.createElement('style');
    style.textContent = consoleCss;
    document.head.append(style);
    try {
      const touchRules = [...style.sheet!.cssRules].filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.conditionText === '(max-width: 700px), (pointer: coarse)');
      expect(touchRules).toHaveLength(1);
      const root = document.createElement('div');
      root.className = 'qmc-preview';
      root.innerHTML = '<header class="qmc-topbar"><button class="ant-btn qmc-mobile-toggle"></button><button class="ant-btn"></button></header><nav><button></button></nav><select></select><div class="ant-input-affix-wrapper"></div><div class="qmc-editor"><input id="qmc-display-name" class="ant-input"></div><table><tbody><tr><td><button class="ant-btn ant-btn-sm"></button></td></tr></tbody></table><div class="ant-modal-footer"><button class="ant-btn"></button></div><button class="ant-modal-close"></button><button class="ant-drawer-close"></button><button class="react-flow__controls-button"></button><li class="ant-dropdown-menu-item"></li>';
      const controls = root.querySelectorAll('button, select, input, .ant-input-affix-wrapper, .ant-dropdown-menu-item');
      expect(root.querySelector('#qmc-display-name')).toBeInstanceOf(HTMLInputElement);
      expect(controls.length).toBeGreaterThan(8);
      for (const control of controls) {
        const rule = [...touchRules[0]!.cssRules].find((candidate): candidate is CSSStyleRule => candidate instanceof CSSStyleRule && control.matches(candidate.selectorText));
        expect(rule?.style.getPropertyValue('min-height')).toBe('44px');
        expect(rule?.style.getPropertyValue('min-width')).toBe('44px');
      }
      const desktopSelect = [...style.sheet!.cssRules].find((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === '.qmc-preview select');
      expect(desktopSelect?.style.getPropertyValue('min-height')).toBe('36px');
    } finally { style.remove(); }
  });

  it('keeps natural input focus and filtering after an outside pointer click dismisses appearance', async () => {
    const user = userEvent.setup();
    setup(); users();
    const search = screen.getByRole('textbox', { name: '搜索本地用户' });
    await user.click(screen.getByRole('button', { name: '管理外观' }));
    expect(await screen.findByRole('menuitemradio', { name: '深色' })).toBeVisible();
    await user.click(search);
    expect(search).toHaveFocus();
    await user.type(search, '林');
    expect(search).toHaveFocus();
    expect(search).toHaveValue('林');
    expect(screen.getByText('林晓')).toBeVisible();
    expect(screen.queryByText('陈宁')).not.toBeInTheDocument();
  });

  it('returns focus to appearance after keyboard Escape', async () => {
    const user = userEvent.setup();
    setup();
    const trigger = screen.getByRole('button', { name: '管理外观' });
    await user.click(trigger);
    const option = await screen.findByRole('menuitemradio', { name: '深色' });
    await waitFor(() => expect(option.closest('[role="menu"]')).toContainElement(document.activeElement as HTMLElement));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('returns focus to appearance after selecting a theme', async () => {
    const user = userEvent.setup();
    const { container } = setup();
    const trigger = screen.getByRole('button', { name: '管理外观' });
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitemradio', { name: '深色' }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('[data-console-theme="dark"]')).toBeInTheDocument();
  });

  it('labels every page as local-only without making API calls or offering approvals', () => {
    const request = vi.spyOn(globalThis, 'fetch');
    setup();
    expect(screen.getByText('本地演示 · 不连接真实 API')).toBeVisible();
    expect(screen.getByRole('heading', { name: '管理首页' })).toBeVisible();
    users();
    expect(screen.getByRole('heading', { name: '组织与用户' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '流程设计' }));
    expect(screen.getByRole('heading', { name: '流程设计' })).toBeVisible();
    expect(screen.getByText('定义与配置，不办理业务审批')).toBeVisible();
    expect(screen.queryByRole('button', { name: /批准|跳步|代审批/ })).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps console theme separate from the business preference and supports system mode', async () => {
    const business = JSON.stringify({ mode: 'light', accent: 'blue' });
    localStorage.setItem('qms:appearance:v1', business);
    const { container } = setup();
    fireEvent.click(screen.getByRole('button', { name: '管理外观' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '深色' }));
    expect(container.querySelector('[data-console-theme="dark"]')).toBeInTheDocument();
    expect(localStorage.getItem('qms:console-preview:appearance:v1')).toBe('dark');
    expect(localStorage.getItem('qms:appearance:v1')).toBe(business);
    fireEvent.click(screen.getByRole('button', { name: '管理外观' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '跟随系统' }));
    expect(localStorage.getItem('qms:console-preview:appearance:v1')).toBe('system');
    expect(localStorage.getItem('qms:appearance:v1')).toBe(business);
  });

  it('distinguishes direct organization positions from departments and read-only historical sources', async () => {
    setup(); users();
    expect(screen.getByText('组织直属岗位')).toBeVisible();
    expect(screen.getAllByText('质量保证室 / 供应商质量科')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '查看林晓的授权来源' }));
    const detail = await screen.findByRole('dialog', { name: '用户与授权来源' });
    expect(detail).toHaveTextContent('平台管理标记不等于业务审批资格');
    expect(detail).toHaveTextContent('历史直接授权（只读）');
    expect(within(detail).queryByRole('button', { name: /清理|撤销/ })).not.toBeInTheDocument();
    fireEvent.click(within(detail).getByRole('button', { name: '返回列表' }));
  });

  it('protects unsaved local edits, retains input after declined discard, and saves only in memory', async () => {
    const request = vi.spyOn(globalThis, 'fetch');
    setup(); users();
    fireEvent.click(screen.getByRole('button', { name: '查看林晓的授权来源' }));
    const detail = await screen.findByRole('dialog', { name: '用户与授权来源' });
    fireEvent.click(within(detail).getByRole('button', { name: '编辑本地显示名' }));
    fireEvent.change(within(detail).getByLabelText('显示名'), { target: { value: '林晓（本地改名）' } });
    expect(within(detail).getByLabelText('显示名')).toHaveValue('林晓（本地改名）');
    fireEvent.click(within(detail).getByRole('button', { name: '返回列表' }));
    // rc-dialog uses the same generated title ID for stacked dialogs in test mode.
    await waitFor(() => expect(screen.getByText('放弃未保存的修改？')).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(within(detail).getByLabelText('显示名')).toHaveValue('林晓（本地改名）');
    fireEvent.click(within(detail).getByRole('button', { name: '保存本地样例' }));
    expect(await screen.findByRole('status')).toHaveTextContent('仅本页内存已更新');
    expect(screen.getByText('林晓（本地改名）')).toBeVisible();
    expect(request).not.toHaveBeenCalled();
    expect(localStorage.getItem('qms:console-preview:users')).toBeNull();
  });

  it('shows loading, empty, recoverable error and no-access without leaking user records', () => {
    setup(); users();
    state('loading');
    expect(screen.getByRole('status')).toHaveTextContent('正在展示加载样例');
    expect(screen.queryByText('林晓')).not.toBeInTheDocument();
    state('empty');
    expect(screen.getByText('当前范围暂无记录')).toBeVisible();
    state('error');
    expect(screen.getByRole('alert')).toHaveTextContent('模拟加载失败');
    fireEvent.click(screen.getByRole('button', { name: '恢复本地样例' }));
    expect(screen.getByText('林晓')).toBeVisible();
    state('denied');
    expect(screen.getByRole('alert')).toHaveTextContent('无权查看当前管理范围');
    expect(screen.queryByText('林晓')).not.toBeInTheDocument();
    expect(screen.queryByText('演示平台管理员')).not.toBeInTheDocument();
  });

  it('allows details but prevents editing in the simulated read-only state and filters locally', async () => {
    setup(); users(); state('readonly');
    fireEvent.change(screen.getByRole('textbox', { name: '搜索本地用户' }), { target: { value: '林晓' } });
    expect(screen.queryByText('陈宁')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看林晓的授权来源' }));
    const detail = await screen.findByRole('dialog', { name: '用户与授权来源' });
    expect(within(detail).getByRole('button', { name: '编辑本地显示名' })).toBeDisabled();
  });

  it('opens a controlled definition preview without publishing or executing a workflow', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '流程设计' }));
    fireEvent.click(screen.getByRole('button', { name: '查看供应商问题处理的配置' }));
    const detail = await screen.findByRole('dialog', { name: '流程定义预览' });
    expect(detail).toHaveTextContent('角色代码、版本校验与发布仍由现有受控流程管理');
    await waitFor(() => expect(within(detail).getByRole('region', { name: '只读定义画布' })).toBeVisible());
    fireEvent.click(within(detail).getByRole('button', { name: '检查关闭节点' }));
    expect(within(detail).getByText('节点类型：CLOSE')).toBeVisible();
    expect(within(detail).queryByRole('button', { name: /发布|审批|提交/ })).not.toBeInTheDocument();
  });

  it('reuses language context and exposes accessible collapsed navigation', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '折叠导航' }));
    expect(screen.getByRole('button', { name: '展开导航' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: '组织与用户' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to English' }));
    expect(screen.getByRole('heading', { name: 'Management home' })).toBeVisible();
    expect(document.documentElement.lang).toBe('en-US');
  });
});
