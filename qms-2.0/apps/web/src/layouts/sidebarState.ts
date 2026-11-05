import { useMemo, useSyncExternalStore } from 'react';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';

type Portal = 'business' | 'console';
type SidebarState = { scrollTop: number; collapsed: boolean; expandedDomains: string[] };
const empty = (): SidebarState => ({ scrollTop: 0, collapsed: false, expandedDomains: [] });
let epoch = Symbol('sidebar-session');
let saved: Partial<Record<Portal, SidebarState>> = {};
const listeners = new Set<() => void>();

useWorkTabsStore.subscribe((next, previous) => {
  if (next.sessionScope === previous.sessionScope) return;
  epoch = Symbol('sidebar-session'); saved = {};
  listeners.forEach(listener => listener());
});

export function readSidebarState(portal: Portal) {
  const owner = epoch;
  const value = useWorkTabsStore.getState().sessionScope ? saved[portal] ??= empty() : empty();
  return { value, update(patch: Partial<SidebarState>) {
    if (owner === epoch) Object.assign(value, patch);
  } };
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => epoch;
export function useSidebarState(portal: Portal) {
  const session = useSyncExternalStore(subscribe, snapshot);
  return useMemo(() => readSidebarState(portal), [portal, session]);
}
