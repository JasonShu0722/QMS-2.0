import { beforeEach, expect, it } from 'vitest';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { readSidebarState } from './sidebarState';

beforeEach(() => useWorkTabsStore.getState().reset());

it('retains only portal-specific navigation UI within the bound session, without adding storage', () => {
  useWorkTabsStore.getState().bindSession('INTERNAL:organization:actor');
  const savedStorage = sessionStorage.getItem('qms:work-pages:v1');
  readSidebarState('business').update({ scrollTop: 240, collapsed: true, expandedDomains: ['/app/supplier-quality'] });
  expect(readSidebarState('business').value).toEqual({ scrollTop: 240, collapsed: true, expandedDomains: ['/app/supplier-quality'] });
  expect(readSidebarState('console').value).toEqual({ scrollTop: 0, collapsed: false, expandedDomains: [] });
  expect(sessionStorage.getItem('qms:work-pages:v1')).toBe(savedStorage);
});

it('rejects stale writes after a synchronous session A to B to A transition', () => {
  useWorkTabsStore.getState().bindSession('INTERNAL:organization:actor');
  const old = readSidebarState('business');
  old.update({ scrollTop: 240, collapsed: true });
  useWorkTabsStore.getState().bindSession('INTERNAL:organization:other');
  useWorkTabsStore.getState().bindSession('INTERNAL:organization:actor');
  old.update({ scrollTop: 900, collapsed: true });
  expect(readSidebarState('business').value).toEqual({ scrollTop: 0, collapsed: false, expandedDomains: [] });
});

it('clears both portals on reset and does not share unbound layout memory', () => {
  useWorkTabsStore.getState().bindSession('INTERNAL:organization:actor');
  const old = readSidebarState('console');
  old.update({ collapsed: true, scrollTop: 350 });
  useWorkTabsStore.getState().reset();
  old.update({ collapsed: true, scrollTop: 950 });
  const unbound = readSidebarState('console');
  unbound.update({ collapsed: true, scrollTop: 700 });
  expect(readSidebarState('console').value).toEqual({ scrollTop: 0, collapsed: false, expandedDomains: [] });
  useWorkTabsStore.getState().bindSession('INTERNAL:organization:actor');
  expect(readSidebarState('console').value).toEqual({ scrollTop: 0, collapsed: false, expandedDomains: [] });
});
