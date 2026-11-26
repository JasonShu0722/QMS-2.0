import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { publishSessionSignal } from '../features/auth/session-invalidation';
import { WorkTabs } from './WorkTabs';
import { useWorkTabsStore } from './workTabsStore';

describe('work tabs store', () => {
  beforeEach(() => {
    useWorkTabsStore.getState().reset();
  });

  function LocationProbe() {
    return <output aria-label="current path">{useLocation().pathname}</output>;
  }

  it('activates an existing tab instead of duplicating it', () => {
    useWorkTabsStore.getState().openTab({ id: 'problem:42', title: '供应商问题 #42', path: '/app/problem-center/42' });
    useWorkTabsStore.getState().openTab({ id: 'problem:42', title: '供应商问题 #42', path: '/app/problem-center/42' });

    const state = useWorkTabsStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe('problem:42');
  });

  it.each(['问题处理', 'Problem workspace'])('restores old %s placeholders without the technical ID', title => {
    const scope = 'INTERNAL:org:user';
    const problemId = '3fe4f86d-0000-4000-8000-000000000001';
    const path = `/app/problem-workspace/${problemId}`;
    const id = `problem:${problemId}`;
    sessionStorage.setItem('qms:work-pages:v1', JSON.stringify({ scope, tabs: [{ id, title: `${title} · 3fe4f86d`, path }] }));
    useWorkTabsStore.getState().bindSession(scope);
    expect(useWorkTabsStore.getState().tabs).toEqual([{ id, title: '问题处理', path }]);
  });

  it.each(['装配工序尺寸超差', '8D-2026-001'])('keeps %s out of storage and restores the problem reference', title => {
    const scope = 'INTERNAL:org:user';
    const problemId = '3fe4f86d-0000-4000-8000-000000000001';
    const problem = { id: `problem:${problemId}`, path: `/app/problem-workspace/${problemId}?organizationId=org` };
    const account = { id: '/app/account', title: '个人账号', path: '/app/account' };
    const storageKey = 'qms:work-pages:v1';
    sessionStorage.setItem(storageKey, JSON.stringify({ scope, tabs: [account, { ...problem, title }] }));

    const store = useWorkTabsStore.getState();
    store.bindSession(scope);
    expect(useWorkTabsStore.getState().tabs).toEqual([account, { ...problem, title: '问题处理' }]);
    store.openTab({ ...problem, title: '问题处理' });
    store.renameTab({ ...problem, title }, useWorkTabsStore.getState().authorizationGeneration);
    expect(useWorkTabsStore.getState().tabs.at(-1)?.title).toBe(title);
    const saved = sessionStorage.getItem(storageKey);
    expect(JSON.parse(saved!)).toEqual({ scope, tabs: [problem, account] });

    store.reset();
    sessionStorage.setItem(storageKey, saved!);
    store.bindSession(scope);
    expect(useWorkTabsStore.getState().tabs).toEqual([{ ...problem, title: '问题处理' }, account]);
    expect(useWorkTabsStore.getState().activeTabId).toBeUndefined();
  });

  it('invalidates inactive problem names while the header is unmounted', () => {
    const problemId = '3fe4f86d-0000-4000-8000-000000000001';
    const problem = { id: `problem:${problemId}`, path: `/app/problem-workspace/${problemId}` };
    const store = useWorkTabsStore.getState();
    store.bindSession('INTERNAL:org:user');
    store.openTab({ ...problem, title: '问题处理' });
    store.renameTab({ ...problem, title: '装配工序尺寸超差' }, useWorkTabsStore.getState().authorizationGeneration);
    store.deactivate();

    publishSessionSignal('revalidate');

    expect(useWorkTabsStore.getState().tabs).toEqual([{ ...problem, title: '问题处理' }]);
    expect(useWorkTabsStore.getState().activeTabId).toBeUndefined();
  });

  it('keeps tab references small and spills older tabs into the all panel', () => {
    for (let index = 0; index < 10; index += 1) {
      useWorkTabsStore.getState().openTab({ id: `record:${index}`, title: `记录 ${index}`, path: `/app/records/${index}` });
    }

    const state = useWorkTabsStore.getState();
    expect(state.visibleTabs.map((tab) => tab.id)).toContain('record:9');
    expect(state.overflowTabs.length).toBeGreaterThan(0);
    expect(JSON.stringify(state.tabs)).not.toMatch(/children|element|data|payload/i);
  });

  it('hides the strip for a single tab and restores the previous tab when closing active', () => {
    const store = useWorkTabsStore.getState();
    store.openTab({ id: 'a', title: 'A', path: '/app/a' });
    expect(useWorkTabsStore.getState().shouldShowStrip).toBe(false);

    store.openTab({ id: 'b', title: 'B', path: '/app/b' });
    expect(useWorkTabsStore.getState().shouldShowStrip).toBe(true);

    store.closeTab('b');
    expect(useWorkTabsStore.getState().activeTabId).toBe('a');
  });

  it('navigates to the restored tab path when closing the active tab', async () => {
    const store = useWorkTabsStore.getState();
    store.openTab({ id: 'a', title: 'A', path: '/app/a' });
    store.openTab({ id: 'b', title: 'B', path: '/app/b' });

    render(
      <MemoryRouter initialEntries={['/app/b']}>
        <WorkTabs />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: '关闭 B' }));

    expect(screen.getByLabelText('current path')).toHaveTextContent('/app/a');
    expect(useWorkTabsStore.getState().activeTabId).toBe('a');
  });

  it('keeps router and store synchronized when clicking a visible tab', async () => {
    const store = useWorkTabsStore.getState();
    store.openTab({ id: 'a', title: 'A', path: '/app/a' });
    store.openTab({ id: 'b', title: 'B', path: '/app/b' });

    render(
      <MemoryRouter initialEntries={['/app/b']}>
        <WorkTabs />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('link', { name: 'A' }));
    await userEvent.click(screen.getByRole('link', { name: 'A' }));

    const state = useWorkTabsStore.getState();
    expect(screen.getByLabelText('current path')).toHaveTextContent('/app/a');
    expect(state.activeTabId).toBe('a');
    expect(state.recentTabIds.slice(0, 2)).toEqual(['a', 'b']);
    expect(state.tabs.filter((tab) => tab.id === 'a')).toHaveLength(1);
  });

  it('keeps router and store synchronized when choosing an overflow tab', async () => {
    const store = useWorkTabsStore.getState();
    for (let index = 0; index < 10; index += 1) {
      store.openTab({ id: `record:${index}`, title: `记录 ${index}`, path: `/app/records/${index}` });
    }

    render(
      <MemoryRouter initialEntries={['/app/records/9']}>
        <WorkTabs />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    const overflowTab = useWorkTabsStore.getState().overflowTabs[0];
    const allTabs = screen.getByRole('button', { name: '全部标签' });
    expect(allTabs).toHaveAttribute('aria-haspopup', 'dialog');
    expect(allTabs).toHaveAttribute('aria-expanded', 'false');
    allTabs.focus();
    await userEvent.keyboard('{Enter}');
    expect(allTabs).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(await screen.findByRole('button', { name: overflowTab.title }));

    const state = useWorkTabsStore.getState();
    expect(screen.getByLabelText('current path')).toHaveTextContent(overflowTab.path);
    expect(state.activeTabId).toBe(overflowTab.id);
    expect(state.recentTabIds[0]).toBe(overflowTab.id);
    expect(state.tabs.filter((tab) => tab.id === overflowTab.id)).toHaveLength(1);
  });
});
