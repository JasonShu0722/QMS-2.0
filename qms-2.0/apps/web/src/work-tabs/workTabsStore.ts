import { create } from 'zustand';
import { subscribeSessionSignals } from '../features/auth/session-invalidation';

export type WorkTab = { id: string; title: string; path: string; titleKind?: 'business' };
const problemTabPlaceholder = '问题处理';
export const isProblemWorkTab = (tab: Pick<WorkTab, 'id'>) => tab.id.startsWith('problem:');
export const workTabLabel = (tab: WorkTab, translate: (title: string) => string) =>
  tab.titleKind === 'business' ? tab.title : translate(tab.title);

type WorkTabsState = {
  tabs: WorkTab[]; visibleTabs: WorkTab[]; overflowTabs: WorkTab[];
  activeTabId?: string; recentTabIds: string[]; shouldShowStrip: boolean; stripWidth: number;
  setStripWidth: (width: number) => void; deactivate: () => void;
  sessionScope?: string; bindSession: (scope: string) => void;
  authorizationGeneration: number; invalidateProblemTitles: () => void;
  openTab: (tab: WorkTab) => void; renameTab: (tab: WorkTab, authorizationGeneration: number) => void; closeTab: (id: string) => void; reset: () => void;
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
  authorizationGeneration: 0,
  bindSession: (scope) => set((state) => {
    if (state.sessionScope === scope) return state;
    let tabs: WorkTab[] = [];
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      const prefix = scope.startsWith('SUPPLIER:') ? '/supplier/' : '/app/';
      if (saved?.scope === scope && Array.isArray(saved.tabs)) {
        tabs = saved.tabs.filter((tab: WorkTab) => tab && typeof tab.id === 'string' && tab.id.length < 200
          && (isProblemWorkTab(tab) || (typeof tab.title === 'string' && tab.title.length < 300))
          && typeof tab.path === 'string' && tab.path.startsWith(prefix) && !/[\\\r\n]/.test(tab.path) && tab.path.length < 2048)
          .slice(0, 30).map(({ id, title, path }: WorkTab) => ({ id, title: isProblemWorkTab({ id }) ? problemTabPlaceholder : title, path }));
        tabs = [...new Map(tabs.map(tab => [tab.id, tab])).values()];
      }
    } catch { /* Invalid or unavailable storage starts a clean session. */ }
    return { ...derive({ ...initial, tabs, recentTabIds: tabs.map(tab => tab.id) }), sessionScope: scope, authorizationGeneration: state.authorizationGeneration + 1 };
  }),
  setStripWidth: (stripWidth) => set((state) => derive({ ...state, stripWidth: Math.max(0, stripWidth) })),
  deactivate: () => set((state) => derive({ ...state, activeTabId: undefined })),
  invalidateProblemTitles: () => set((state) => {
    const tabs = state.tabs.map(tab => isProblemWorkTab(tab) ? { id: tab.id, path: tab.path, title: problemTabPlaceholder } : tab);
    return { ...derive({ ...state, tabs }), authorizationGeneration: state.authorizationGeneration + 1 };
  }),
  openTab: (tab) => set((state) => {
    if (tab.path === '/app/workbench' || tab.path === '/app') return state;
    const exists = state.tabs.some((item) => item.id === tab.id);
    const tabs = exists ? state.tabs.map(item => item.id === tab.id ? tab : item) : [...state.tabs, tab];
    return derive({ tabs, activeTabId: tab.id, recentTabIds: [tab.id, ...state.recentTabIds.filter((id) => id !== tab.id)], stripWidth: state.stripWidth });
  }),
  renameTab: ({ id, path, title, titleKind }, authorizationGeneration) => set((state) => {
    if (authorizationGeneration !== state.authorizationGeneration) return state;
    if (isProblemWorkTab({ id })) {
      if (id !== state.activeTabId) return state;
      if (title !== problemTabPlaceholder) titleKind = 'business';
    }
    const existing = state.tabs.find(tab => tab.id === id && tab.path === path);
    if (!existing || (existing.title === title && existing.titleKind === titleKind)) return state;
    return derive({ ...state, tabs: state.tabs.map(tab => tab === existing ? { id, path, title, titleKind } : tab) });
  }),
  closeTab: (id) => set((state) => {
    const tabs = state.tabs.filter((tab) => tab.id !== id);
    const recentTabIds = state.recentTabIds.filter((tabId) => tabId !== id);
    return derive({ tabs, recentTabIds, activeTabId: state.activeTabId === id ? recentTabIds[0] : state.activeTabId, stripWidth: state.stripWidth });
  }),
  reset: () => {
    try { sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ }
    set(state => ({ ...initial, sessionScope: undefined, authorizationGeneration: state.authorizationGeneration + 1 }));
  },
}));

let stopSessionSignals: (() => void) | undefined;
useWorkTabsStore.subscribe((state, previous) => {
  if (state.sessionScope !== previous.sessionScope) {
    stopSessionSignals?.();
    stopSessionSignals = state.sessionScope ? subscribeSessionSignals(state.invalidateProblemTitles) : undefined;
  }
  if (!state.sessionScope) return;
  if (state.sessionScope === previous.sessionScope && state.tabs === previous.tabs && state.recentTabIds === previous.recentTabIds) return;
  const tabs = state.recentTabIds.map(id => state.tabs.find(tab => tab.id === id)).filter(tab => tab !== undefined).slice(0, 30)
    .map(tab => isProblemWorkTab(tab) ? { id: tab.id, path: tab.path } : { id: tab.id, path: tab.path, title: tab.title });
  try { sessionStorage.setItem(storageKey, JSON.stringify({ scope: state.sessionScope, tabs })); } catch { /* Navigation remains usable without persistence. */ }
});
