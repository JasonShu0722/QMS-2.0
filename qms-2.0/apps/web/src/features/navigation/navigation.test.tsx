import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { InternalLayout } from '../../layouts/InternalLayout';
import { SupplierLayout } from '../../layouts/SupplierLayout';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { internalDomains, internalNavigation } from './navigation';
import { LanguageProvider } from '../../i18n/Language';

vi.setConfig({ testTimeout: 15_000 });

describe('portal navigation', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useWorkTabsStore.getState().reset();
  });

  function LocationProbe() {
    return <output aria-label="current path">{useLocation().pathname}</output>;
  }

  it('assigns every internal entry to exactly one parent domain', () => {
    expect(internalDomains).toBeDefined();
    const childPaths = internalDomains.flatMap((domain) => domain.children.map((entry) => entry.path));
    expect([...childPaths].sort()).toEqual(internalNavigation.filter((entry) => entry.path !== '/app/documents').map((entry) => entry.path).sort());
    expect(internalDomains.find((domain) => domain.label === '供应商质量')?.children.map((entry) => entry.path).slice(0, 3)).toEqual(['/app/supplier-quality', '/app/supplier-incoming', '/app/site-scanning']);
    expect(internalDomains.find((domain) => domain.label === '制程质量')?.children.map((entry) => entry.path)).toEqual(['/app/process-quality', '/app/process-quality/problems', '/app/process-quality/shipment-reports']);
  });

  it('shows the internal workbench with full domain navigation', () => {
    render(
      <MemoryRouter initialEntries={['/app/workbench']}>
        <InternalLayout />
      </MemoryRouter>,
    );

    const navigation = within(screen.getByRole('navigation', { name: '内部领域导航' }));
    for (const label of ['问题中心', '供应商质量', '制程质量', '客户质量', '新品质量', '审核管理', '质量分析', '检测管理', '系统服务']) {
      expect(navigation.getByRole('link', { name: label })).toBeInTheDocument();
    }
    for (const label of ['问题与改进', '流程设计', '供应商 PPAP', '供应商 ASN', '审计管理', '体系文件', '知识与公告', '知识与文件', '个人账号', '风险看板']) {
      expect(navigation.queryByRole('link', { name: label })).not.toBeInTheDocument();
    }
    expect(screen.getByText('个人待办')).toBeInTheDocument();
    expect(screen.getByText('待审批')).toBeInTheDocument();
    expect(screen.getByText('即将逾期')).toBeInTheDocument();
    expect(screen.getByText('高风险')).toBeInTheDocument();
    expect(screen.getByText('关键指标')).toBeInTheDocument();
    expect(screen.getAllByText('待接入')).toHaveLength(5);
    expect(screen.queryByText('12')).not.toBeInTheDocument();
    expect(screen.queryByText('5')).not.toBeInTheDocument();
    expect(screen.queryByText('98.6%')).not.toBeInTheDocument();
  });

  it('collapses to an icon rail and exposes the active domain context menu', () => {
    render(
      <MemoryRouter initialEntries={['/app/problem-center']}>
        <InternalLayout />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText('内部领域图标导航')).toBeInTheDocument();
    const context = within(screen.getByRole('navigation', { name: '问题中心 上下文菜单' }));
    expect(context.getByRole('link', { name: '问题管理面板' })).toHaveAttribute('href', '/app/problem-center');
    expect(context.getByRole('link', { name: '我的待办' })).toHaveAttribute('href', '/app/my-tasks');
    expect(context.queryByRole('link', { name: '流程设计' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '问题管理面板' })).toBeVisible();
  });

  it('retains the hidden documents deep link and its unimplemented state', () => {
    render(<MemoryRouter initialEntries={['/app/documents']}><InternalLayout /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: '体系文件' })).toBeVisible();
    expect(screen.getByText('基础入口已就绪，业务功能将在后续阶段接入。')).toBeVisible();
    expect(screen.queryByRole('link', { name: '体系文件' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '知识与文件' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '知识与公告' })).not.toBeInTheDocument();
  });

  it('retains the barcode URL under supplier quality with matching names', () => {
    render(<MemoryRouter initialEntries={['/app/site-scanning']}><InternalLayout /></MemoryRouter>);
    const menu = within(screen.getByRole('navigation', { name: '供应商质量 上下文菜单' }));
    expect(menu.getByRole('link', { name: '关键件条码校验' })).toHaveAttribute('aria-current', 'page');
    expect(menu.getByRole('link', { name: '关键件条码校验' })).toHaveAttribute('href', '/app/site-scanning');
    expect(useWorkTabsStore.getState().tabs.find(tab => tab.id === '/app/site-scanning')).toMatchObject({ title: '关键件条码校验' });
  });

  it.each([['zh-CN', '制程质量', '不良品台账', '上下文菜单'], ['en-US', 'Process quality', 'Defect ledger', 'Context menu']])('names the process ledger consistently in %s', (locale, domain, ledger, context) => {
    localStorage.setItem('qms:locale:v1', locale);
    render(<MemoryRouter initialEntries={['/app/process-quality']}><LanguageProvider><InternalLayout /></LanguageProvider></MemoryRouter>);
    const menu = within(screen.getByRole('navigation', { name: `${domain} ${context}` }));
    expect(menu.getByRole('link', { name: ledger })).toHaveAttribute('href', '/app/process-quality');
    expect(menu.getByRole('link', { name: ledger })).toHaveAttribute('aria-current', 'page');
    expect(menu.queryByRole('link', { name: domain })).not.toBeInTheDocument();
    expect(menu.queryByRole('link', { name: '关键件条码校验' })).not.toBeInTheDocument();
    expect(document.querySelector('.qms-topbar-location')).not.toBeInTheDocument();
    expect(document.querySelector('.qms-topbar .qms-work-tab-manager')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '不良品台账' })).toBeVisible();
    expect(useWorkTabsStore.getState().tabs.find(tab => tab.id === '/app/process-quality')).toMatchObject({ title: '不良品台账' });
  });

  it('selects the supplier parent domain for a leaf deep link and exposes its sibling entries', () => {
    render(
      <MemoryRouter initialEntries={['/app/supplier-pcn']}>
        <InternalLayout />
      </MemoryRouter>,
    );

    const navigation = within(screen.getByRole('navigation', { name: '内部领域图标导航' }));
    expect(navigation.getByRole('link', { name: '供应商质量' })).toHaveAttribute('aria-current', 'page');
    expect(navigation.queryByRole('link', { name: 'PCN 变更' })).not.toBeInTheDocument();
    const context = within(screen.getByRole('navigation', { name: '供应商质量 上下文菜单' }));
    expect(context.getByRole('link', { name: 'PCN 变更' })).toHaveAttribute('aria-current', 'page');
    expect(context.getByRole('link', { name: '供应商 PPAP' })).toHaveAttribute('href', '/app/supplier-ppap');
    expect(context.getByRole('link', { name: '供应商 ASN' })).toHaveAttribute('href', '/app/supplier-asn');
    expect(useWorkTabsStore.getState().tabs.find((tab) => tab.path === '/app/supplier-pcn')).toMatchObject({ title: 'PCN 变更' });
  });

  it('opens the supplier leaf entries from the mobile domain menu', async () => {
    render(
      <MemoryRouter initialEntries={['/app/workbench']}>
        <InternalLayout />
        <Routes><Route path="*" element={<LocationProbe />} /></Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '打开导航' }));
    const drawer = within(screen.getByRole('dialog'));
    const supplier = drawer.getByText('供应商质量', { selector: 'summary span' });
    await user.click(supplier);
    expect(supplier.closest('details')).toHaveAttribute('open');
    expect(drawer.getByRole('link', { name: '供应商 PPAP' })).toHaveAttribute('href', '/app/supplier-ppap');
    expect(drawer.getByRole('link', { name: '供应商问题台账' })).toHaveAttribute('href', '/app/supplier-quality');
    expect(drawer.getByRole('link', { name: '关键件条码校验' })).toHaveAttribute('href', '/app/site-scanning');
    expect(drawer.queryByRole('link', { name: '体系文件' })).not.toBeInTheDocument();
    await user.click(drawer.getByRole('link', { name: 'PCN 变更' }));
    expect(screen.getByLabelText('current path')).toHaveTextContent('/app/supplier-pcn');
  });

  it('uses an independent supplier portal entry set', () => {
    render(
      <MemoryRouter initialEntries={['/supplier/inbox']}>
        <SupplierLayout />
      </MemoryRouter>,
    );

    for (const label of ['待办', '整改', '资料', '绩效', '账号']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole('link', { name: '问题中心' })).not.toBeInTheDocument();
  });

  it('registers internal domain navigation as an active work tab', async () => {
    render(
      <MemoryRouter initialEntries={['/app/workbench']}>
        <InternalLayout />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: '问题中心' }));
    await user.click(within(screen.getByRole('navigation', { name: '问题中心 上下文菜单' })).getByRole('link', { name: '问题管理面板' }));

    const state = useWorkTabsStore.getState();
    expect(screen.getByLabelText('current path')).toHaveTextContent('/app/problem-center');
    expect(state.activeTabId).toBe('/app/problem-center');
    expect(state.recentTabIds[0]).toBe('/app/problem-center');
    expect(state.tabs.filter((tab) => tab.id === '/app/problem-center')).toHaveLength(1);
    expect(state.tabs.find((tab) => tab.id === '/app/problem-center')).toMatchObject({
      title: '问题管理面板',
      path: '/app/problem-center',
    });
  }, 30_000);

  it('registers supplier navigation entries consistently', async () => {
    render(
      <MemoryRouter initialEntries={['/supplier/inbox']}>
        <SupplierLayout />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(within(screen.getByRole('navigation', { name: '供应商导航' })).getByRole('link', { name: '整改' }));
    await userEvent.click(within(screen.getByRole('navigation', { name: '供应商导航' })).getByRole('link', { name: '整改' }));

    const state = useWorkTabsStore.getState();
    expect(screen.getByLabelText('current path')).toHaveTextContent('/supplier/corrections');
    expect(state.activeTabId).toBe('/supplier/corrections');
    expect(state.recentTabIds[0]).toBe('/supplier/corrections');
    expect(state.tabs.filter((tab) => tab.id === '/supplier/corrections')).toHaveLength(1);
    expect(state.tabs.find((tab) => tab.id === '/supplier/corrections')).toMatchObject({
      title: '整改',
      path: '/supplier/corrections',
    });
  });
});
