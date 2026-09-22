import { create } from 'zustand';

export type WorkTab = { id: string; title: string; path: string };
type WorkTabsState = {
  tabs: WorkTab[]; visibleTabs: WorkTab[]; overflowTabs: WorkTab[];
  activeTabId?: string; recentTabIds: string[]; shouldShowStrip: boolean; stripWidth: number;
  setStripWidth: (width: number) => void; deactivate: () => void;
  sessionScope?: string; bindSession: (scope: string) => void;
  openTab: (tab: WorkTab) => void; closeTab: (id: string) => void; reset: () => void;
};
function derive(next: Pick<WorkTabsState, 'tabs' | 'activeTabId' | 'recentTabIds' | 'stripWidth'>) {
  const byRecent = [...next.tabs].sort((left, right) => {
    const leftIndex = next.recentTabIds.indexOf(left.id);
    const rightIndex = next.recentTabIds.indexOf(right.id);
    return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
  });
  // Fixed maximum tab widths keep overflow independent of title length and language.
  const capacity = Math.max(1, Math.floor((next.stripWidth - 132) / 180));
  const visible = byRecent.slice(0, capacity);
  const active = next.tabs.find((tab) => tab.id === next.activeTabId);
  if (active && !visible.some((tab) => tab.id === active.id)) { visible.pop(); visible.unshift(active); }
  const visibleIds = new Set(visible.map((tab) => tab.id));
  return { ...next, visibleTabs: visible, overflowTabs: next.tabs.filter((tab) => !visibleIds.has(tab.id)), shouldShowStrip: next.tabs.length > 1 };
}
const initial = derive({ tabs: [], activeTabId: undefined, recentTabIds: [], stripWidth: 1032 });
const storageKey = 'qms:work-pages:v1';
export const useWorkTabsStore = create<WorkTabsState>((set) => ({
  ...initial,
  bindSession: (scope) => set((state) => {
    if (state.sessionScope === scope) return state;
    let tabs: WorkTab[] = [];
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      const prefix = scope.startsWith('SUPPLIER:') ? '/supplier/' : '/app/';
      if (saved?.scope === scope && Array.isArray(saved.tabs)) {
        tabs = saved.tabs.filter((tab: WorkTab) => tab && typeof tab.id === 'string' && tab.id.length < 200 && typeof tab.title === 'string' && tab.title.length < 300 && typeof tab.path === 'string' && tab.path.startsWith(prefix) && !/[\\\r\n]/.test(tab.path) && tab.path.length < 2048).slice(0, 30).map(({ id, title, path }: WorkTab) => ({ id, title, path }));
        tabs = [...new Map(tabs.map(tab => [tab.id, tab])).values()];
      }
    } catch { /* Invalid or unavailable storage starts a clean session. */ }
    return { ...derive({ ...initial, tabs, recentTabIds: tabs.map(tab => tab.id) }), sessionScope: scope };
  }),
  setStripWidth: (stripWidth) => set((state) => derive({ ...state, stripWidth: Math.max(0, stripWidth) })),
  deactivate: () => set((state) => derive({ ...state, activeTabId: undefined })),
  openTab: (tab) => set((state) => {
    if (tab.path === '/app/workbench' || tab.path === '/app') return state;
    const exists = state.tabs.some((item) => item.id === tab.id);
    const tabs = exists ? state.tabs.map((item) => item.id === tab.id ? { ...item, title: tab.title, path: tab.path } : item) : [...state.tabs, tab];
    return derive({ tabs, activeTabId: tab.id, recentTabIds: [tab.id, ...state.recentTabIds.filter((id) => id !== tab.id)], stripWidth: state.stripWidth });
  }),
  closeTab: (id) => set((state) => {
    const tabs = state.tabs.filter((tab) => tab.id !== id);
    const recentTabIds = state.recentTabIds.filter((tabId) => tabId !== id);
    return derive({ tabs, recentTabIds, activeTabId: state.activeTabId === id ? recentTabIds[0] : state.activeTabId, stripWidth: state.stripWidth });
  }),
  reset: () => { try { sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ } set({ ...initial, sessionScope: undefined }); },
}));

useWorkTabsStore.subscribe(state => {
  if (!state.sessionScope) return;
  try { sessionStorage.setItem(storageKey, JSON.stringify({ scope: state.sessionScope, tabs: state.recentTabIds.map(id => state.tabs.find(tab => tab.id === id)).filter(Boolean).slice(0, 30) })); } catch { /* Navigation remains usable without persistence. */ }
});
