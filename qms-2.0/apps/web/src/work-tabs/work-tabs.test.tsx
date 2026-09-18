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
    function LocationProbe() {
      return <output aria-label="current path">{useLocation().pathname}</output>;
    }

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
});
