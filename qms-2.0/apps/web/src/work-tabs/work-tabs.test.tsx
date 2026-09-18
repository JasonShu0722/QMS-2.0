import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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
    await userEvent.click(screen.getByRole('button', { name: '全部标签' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: overflowTab.title }));

    const state = useWorkTabsStore.getState();
    expect(screen.getByLabelText('current path')).toHaveTextContent(overflowTab.path);
    expect(state.activeTabId).toBe(overflowTab.id);
    expect(state.recentTabIds[0]).toBe(overflowTab.id);
    expect(state.tabs.filter((tab) => tab.id === overflowTab.id)).toHaveLength(1);
  });
});
