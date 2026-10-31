import { createContext, useContext, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { normalizePageSize, preferenceKey, type Scope } from './model';

const ScopeContext = createContext<Pick<Scope, 'organizationId' | 'portal'>>({});
export function LedgerScopeProvider({ children, ...scope }: { organizationId?: string; portal?: Scope['portal']; children: ReactNode }) {
  return <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>;
}
export function useLedgerScope(organizationId?: string): Scope {
  const inherited = useContext(ScopeContext);
  const sessionScope = useWorkTabsStore(state => state.sessionScope);
  const portal = inherited.portal ?? (typeof window !== 'undefined' && /^\/console(?:\/|$)/.test(window.location.pathname) ? 'console' : typeof window !== 'undefined' && /^\/supplier(?:\/|$)/.test(window.location.pathname) || sessionScope?.startsWith('SUPPLIER:') ? 'supplier' : 'business');
  return { sessionScope, organizationId: organizationId ?? inherited.organizationId, portal };
}
const memory = new Map<string, string>();
let sessionGeneration = 0;
useWorkTabsStore.subscribe((next, previous) => {
  if (next.sessionScope !== previous.sessionScope) sessionGeneration += 1;
});
export const getLedgerSessionEpoch = () => sessionGeneration;
export function useLedgerSessionEpoch() {
  return useSyncExternalStore(useWorkTabsStore.subscribe, getLedgerSessionEpoch, getLedgerSessionEpoch);
}
function readPreference(key?: string): unknown {
  if (!key) return undefined;
  let serialized: string | undefined | null;
  try { serialized = memory.get(key) ?? localStorage.getItem(key); } catch { serialized = memory.get(key); }
  if (!serialized || serialized.length > 64000) return undefined;
  try { const value = JSON.parse(serialized); return value?.schema === 1 ? value.value : undefined; } catch { return undefined; }
}
function writePreference(key: string, value: unknown) {
  const serialized = JSON.stringify({ schema: 1, value });
  if (serialized.length > 64000) return;
  try { localStorage.setItem(key, serialized); memory.delete(key); } catch {
    memory.delete(key); memory.set(key, serialized);
    if (memory.size > 64) memory.delete(memory.keys().next().value!);
  }
}
export function usePreference<Value>(key: string | undefined, sessionScope: string | undefined, normalize: (input: unknown) => Value, stateKey = key): readonly [Value, (value: Value) => void] {
  const sessionEpoch = useLedgerSessionEpoch();
  const active = useRef({ stateKey, sessionScope, generation: 0 });
  if (active.current.stateKey !== stateKey || active.current.sessionScope !== sessionScope) active.current = { stateKey, sessionScope, generation: active.current.generation + 1 };
  const generation = active.current.generation;
  const [stored, setStored] = useState(() => ({ key: stateKey, value: normalize(readPreference(key)) }));
  let current = stored;
  if (stored.key !== stateKey) {
    current = { key: stateKey, value: normalize(readPreference(key)) };
    setStored(current);
  }
  const setValue = (value: Value) => {
    if (sessionEpoch !== sessionGeneration || active.current.generation !== generation || useWorkTabsStore.getState().sessionScope !== sessionScope) return;
    const normalized = normalize(value);
    setStored({ key: stateKey, value: normalized });
    if (key) writePreference(key, normalized);
  };
  return [normalize(current.value), setValue];
}
export function useLedgerPageSize(ledgerId: string, organizationId?: string, maxPageSize = 100): readonly [number, (size: number) => void] {
  const scope = useLedgerScope(organizationId);
  const key = preferenceKey(scope, ledgerId, 'pageSize');
  return usePreference(key, scope.sessionScope, value => normalizePageSize(value, maxPageSize), key ?? JSON.stringify([scope, ledgerId, 'pageSize']));
}
