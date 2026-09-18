import { create } from 'zustand';

export type WorkTab = {
  id: string;
  title: string;
  path: string;
};

type WorkTabsState = {
  tabs: WorkTab[];
  visibleTabs: WorkTab[];
  overflowTabs: WorkTab[];
  activeTabId?: string;
  recentTabIds: string[];
  shouldShowStrip: boolean;
  openTab: (tab: WorkTab) => void;
  closeTab: (id: string) => void;
  reset: () => void;
};

const MAX_VISIBLE_TABS = 7;

function derive(next: Pick<WorkTabsState, 'tabs' | 'activeTabId' | 'recentTabIds'>) {
  const byRecent = [...next.tabs].sort((left, right) => {
    const leftIndex = next.recentTabIds.indexOf(left.id);
    const rightIndex = next.recentTabIds.indexOf(right.id);
    return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
  });
  const active = next.tabs.find((tab) => tab.id === next.activeTabId);
  const visible = [...byRecent.slice(0, MAX_VISIBLE_TABS)];
  if (active && !visible.some((tab) => tab.id === active.id)) {
    visible.pop();
    visible.unshift(active);
  }
  const visibleIds = new Set(visible.map((tab) => tab.id));
  return {
    ...next,
    visibleTabs: visible,
    overflowTabs: next.tabs.filter((tab) => !visibleIds.has(tab.id)),
    shouldShowStrip: next.tabs.length > 1,
  };
}

const initial = derive({ tabs: [], activeTabId: undefined, recentTabIds: [] });

export const useWorkTabsStore = create<WorkTabsState>((set) => ({
  ...initial,
  openTab: (tab) =>
    set((state) => {
      const exists = state.tabs.some((item) => item.id === tab.id);
      const tabs = exists ? state.tabs.map((item) => (item.id === tab.id ? { ...item, title: tab.title, path: tab.path } : item)) : [...state.tabs, tab];
      const recentTabIds = [tab.id, ...state.recentTabIds.filter((id) => id !== tab.id)];
      return derive({ tabs, activeTabId: tab.id, recentTabIds });
    }),
  closeTab: (id) =>
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      const recentTabIds = state.recentTabIds.filter((tabId) => tabId !== id);
      const activeTabId = state.activeTabId === id ? recentTabIds[0] : state.activeTabId;
      return derive({ tabs, activeTabId, recentTabIds });
    }),
  reset: () => set(initial),
}));

