import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { InternalLayout } from '../../layouts/InternalLayout';
import { SupplierLayout } from '../../layouts/SupplierLayout';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

describe('portal navigation', () => {
  beforeEach(() => {
    useWorkTabsStore.getState().reset();
  });

  function LocationProbe() {
    return <output aria-label="current path">{useLocation().pathname}</output>;
  }

  it('shows the internal workbench with full domain navigation', () => {
    render(
      <MemoryRouter initialEntries={['/app/workbench']}>
        <InternalLayout />
      </MemoryRouter>,
    );

    for (const label of ['问题中心', '流程设计', '供应商质量', '审计管理', '体系文件', '风险看板']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
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
    expect(screen.getByText('问题中心上下文')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CAPA' })).toBeInTheDocument();
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

    await userEvent.click(screen.getByRole('link', { name: '问题中心' }));
    await userEvent.click(screen.getByRole('link', { name: '问题中心' }));

    const state = useWorkTabsStore.getState();
    expect(screen.getByLabelText('current path')).toHaveTextContent('/app/problem-center');
    expect(state.activeTabId).toBe('/app/problem-center');
    expect(state.recentTabIds[0]).toBe('/app/problem-center');
    expect(state.tabs.filter((tab) => tab.id === '/app/problem-center')).toHaveLength(1);
    expect(state.tabs.find((tab) => tab.id === '/app/problem-center')).toMatchObject({
      title: '问题中心',
      path: '/app/problem-center',
    });
  });

  it('registers supplier navigation entries consistently', async () => {
    render(
      <MemoryRouter initialEntries={['/supplier/inbox']}>
        <SupplierLayout />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('link', { name: '整改' }));
    await userEvent.click(screen.getByRole('link', { name: '整改' }));

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
