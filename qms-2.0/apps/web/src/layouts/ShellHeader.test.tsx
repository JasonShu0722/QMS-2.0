import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../api/client';
import { LanguageProvider } from '../i18n/Language';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { ShellHeader } from './ShellHeader';
import { UnsavedChangesProvider, useUnsavedChanges } from './UnsavedChanges';

vi.mock('../api/client', async () => ({ ...await vi.importActual<typeof import('../api/client')>('../api/client'), apiRequest: vi.fn() }));

function CurrentPage({ dirty }: { dirty: boolean }) {
  useUnsavedChanges(dirty);
  return <output aria-label="current path">{useLocation().pathname}</output>;
}

function mount(supplier = false, dirty = false, initialPath?: string) {
  const path = initialPath ?? useWorkTabsStore.getState().tabs.at(-1)?.path ?? (supplier ? '/supplier/inbox' : '/app/workbench');
  return render(<MemoryRouter initialEntries={[path]}><LanguageProvider><UnsavedChangesProvider>
    <ShellHeader supplier={supplier} onOpenNavigation={() => {}} /><CurrentPage dirty={dirty} />
  </UnsavedChangesProvider></LanguageProvider></MemoryRouter>);
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); useWorkTabsStore.getState().reset();
  vi.mocked(apiRequest).mockReset().mockResolvedValue({ unreadMustReadCount: 2 });
});

describe('internal current page identity', () => {
  it('shows a single active page title and translates it with the header language', async () => {
    useWorkTabsStore.getState().openTab({ id: 'account', title: '个人账号', path: '/app/account' });
    mount();
    const header = within(screen.getByRole('banner'));
    const work = within(screen.getByRole('banner').querySelector('.qms-topbar-work') as HTMLElement);
    expect(work.getByText('个人账号')).toBeVisible();
    expect(work.queryByRole('link', { name: '个人账号' })).not.toBeInTheDocument();
    expect(work.queryByRole('button', { name: '个人账号' })).not.toBeInTheDocument();
    header.getByRole('radio', { name: 'CN' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(work.getByText('My account')).toBeVisible();
    expect(work.queryByText('个人账号')).not.toBeInTheDocument();
  });

  it('does not repeat the active title when the working strip is shown', () => {
    const store = useWorkTabsStore.getState();
    store.openTab({ id: 'a', title: '记录 A', path: '/app/a' });
    store.openTab({ id: 'b', title: '记录 B', path: '/app/b' });
    mount();
    const header = within(screen.getByRole('banner'));
    expect(header.getAllByText('记录 B')).toHaveLength(1);
    expect(within(header.getByRole('navigation', { name: '工作标签' })).getByRole('link', { name: '记录 B' })).toBeVisible();
  });

  it.each(['/app', '/app/workbench'])('shows the workbench identity at %s with retained inactive tabs', (path) => {
    const store = useWorkTabsStore.getState();
    store.openTab({ id: 'a', title: '记录 A', path: '/app/a' });
    store.deactivate();
    mount(false, false, path);
    const header = within(screen.getByRole('banner'));
    expect(header.getByText('综合工作台')).toBeVisible();
    expect(header.getAllByText('综合工作台')).toHaveLength(1);
    expect(header.getByText('综合工作台')).toHaveClass('qms-home-label');
    expect(header.queryByText('记录 A')).not.toBeInTheDocument();
    expect(header.getByRole('button', { name: '全部标签' })).toBeVisible();
    expect(screen.getByLabelText('current path')).toHaveTextContent(path);
    expect(useWorkTabsStore.getState().activeTabId).toBeUndefined();
    expect(useWorkTabsStore.getState().tabs).toHaveLength(1);
  });

  it('does not label another business route as the workbench while its tab is inactive', () => {
    useWorkTabsStore.getState().openTab({ id: 'a', title: '记录 A', path: '/app/a' });
    mount();
    const header = within(screen.getByRole('banner'));
    expect(header.getByText('记录 A')).toBeVisible();
    act(() => useWorkTabsStore.getState().deactivate());
    expect(useWorkTabsStore.getState().activeTabId).toBeUndefined();
    expect(useWorkTabsStore.getState().tabs).toHaveLength(1);
    expect(header.queryByText('记录 A')).not.toBeInTheDocument();
    expect(header.queryByText('综合工作台')).not.toBeInTheDocument();
    expect(header.getByRole('button', { name: '全部标签' })).toBeVisible();
  });

  it.each(['/supplier/inbox', '/app', '/app/workbench'])('does not add a workbench identity to the supplier header at %s with inactive tabs', (path) => {
    const store = useWorkTabsStore.getState();
    store.openTab({ id: 'a', title: '记录 A', path: '/supplier/a' });
    store.deactivate();
    mount(true, false, path);
    const header = within(screen.getByRole('banner'));
    expect(header.queryByText('综合工作台')).not.toBeInTheDocument();
    expect(header.queryByText('供应商门户')).not.toBeInTheDocument();
    expect(header.getByRole('button', { name: '全部标签' })).toBeVisible();
  });

  it('does not add a single page title to the supplier header', () => {
    useWorkTabsStore.getState().openTab({ id: 'a', title: '记录 A', path: '/supplier/a' });
    mount(true);
    const header = within(screen.getByRole('banner'));
    expect(header.queryByText('记录 A')).not.toBeInTheDocument();
    expect(header.getByRole('button', { name: '全部标签' })).toBeVisible();
  });
});

describe.each([false, true])('shared compact header supplier=%s', (supplier) => {
  const home = supplier ? '/supplier/inbox' : '/app/workbench';
  const prefix = supplier ? '/supplier' : '/app';
  const portal = supplier ? '供应商门户' : '综合工作台';

  it('shows only the portal identity when no work page is open', async () => {
    mount(supplier);
    const header = within(screen.getByRole('banner'));
    expect(header.getByRole('link', { name: portal })).toHaveAttribute('href', home);
    expect(header.queryByRole('navigation', { name: /工作标签|工作页/ })).not.toBeInTheDocument();
    expect(header.queryByRole('button', { name: '全部标签' })).not.toBeInTheDocument();
    expect(header.getAllByRole('button', { name: '外观设置' })).toHaveLength(1);
    const languages = header.getByRole('radiogroup', { name: 'Language / 语言' });
    expect(within(languages).getByRole('radio', { name: 'CN' })).toBeChecked();
    const appearance = header.getByRole('button', { name: '外观设置' });
    const avatar = header.getByRole('button', { name: /个人菜单/ });
    expect(languages.compareDocumentPosition(appearance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(appearance.compareDocumentPosition(avatar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    if (supplier) expect(header.queryByRole('link', { name: /必读公告/ })).not.toBeInTheDocument();
    else expect(await header.findByRole('link', { name: '2 条必读公告未读' })).toBeVisible();
  });

  it('keeps a single page searchable and closable without the old portal path line', async () => {
    useWorkTabsStore.getState().openTab({ id: 'a', title: '记录 A', path: `${prefix}/a` });
    mount(supplier);
    const header = within(screen.getByRole('banner'));
    expect(header.queryByRole('link', { name: portal })).not.toBeInTheDocument();
    expect(header.getAllByRole('button', { name: '全部标签' })).toHaveLength(1);
    header.getByRole('button', { name: '全部标签' }).focus();
    await userEvent.keyboard('{Enter}');
    const drawer = within(await screen.findByRole('dialog'));
    expect(drawer.getByRole('button', { name: '记录 A' })).toBeVisible();
    await userEvent.click(drawer.getByRole('button', { name: '关闭 记录 A' }));
    expect(screen.getByLabelText('current path')).toHaveTextContent(home);
    expect(header.queryByRole('button', { name: '全部标签' })).not.toBeInTheDocument();
    expect(header.getByRole('link', { name: portal })).toBeVisible();
  });

  it('hosts one working strip with search, activation and guarded close', async () => {
    const store = useWorkTabsStore.getState();
    store.openTab({ id: 'a', title: '记录 A', path: `${prefix}/a` });
    store.openTab({ id: 'b', title: '记录 B', path: `${prefix}/b` });
    mount(supplier, true);
    const header = within(screen.getByRole('banner'));
    const strip = within(header.getByRole('navigation', { name: '工作标签' }));
    expect(screen.getAllByRole('navigation', { name: '工作标签' })).toHaveLength(1);
    expect(header.queryByRole('link', { name: portal })).not.toBeInTheDocument();
    expect(header.getAllByRole('button', { name: '外观设置' })).toHaveLength(1);
    await userEvent.click(strip.getByRole('link', { name: '记录 A' }));
    await userEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByLabelText('current path')).toHaveTextContent(`${prefix}/b`);
    await userEvent.click(strip.getByRole('button', { name: '关闭 记录 B' }));
    await userEvent.click(screen.getByRole('button', { name: '放弃修改并关闭' }));
    expect(screen.getByLabelText('current path')).toHaveTextContent(`${prefix}/a`);
    await userEvent.click(header.getByRole('button', { name: '全部标签' }));
    const drawer = within(screen.getByRole('textbox', { name: '查找已打开工作页' }).closest('[role="dialog"]') as HTMLElement);
    await userEvent.type(drawer.getByRole('textbox', { name: '查找已打开工作页' }), '记录 A');
    expect(drawer.getByRole('button', { name: '记录 A' })).toBeVisible();
    expect(drawer.getByRole('link', { name: '另开 记录 A' })).toHaveAttribute('target', '_blank');
  });
});
