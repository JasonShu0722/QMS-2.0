import { Modal } from 'antd';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode, type MouseEvent } from 'react';
import { UNSAFE_DataRouterContext, useBlocker, useLocation, useNavigate, type BlockerFunction } from 'react-router-dom';
import { useLanguage } from '../i18n/Language';

type Guard = { register: (id: string, dirty: boolean) => void; registerBusy: (id: string, busy: boolean) => void; requestLeave: (action: () => void, closing?: boolean) => void; completeSessionNavigation: (action: () => void) => void };
type Pending = { action: () => void; cancel?: () => void; closing: boolean; route: boolean; scopeChanged?: boolean };
const UnsavedContext = createContext<Guard>({ register: () => {}, registerBusy: () => {}, requestLeave: (action) => action(), completeSessionNavigation: (action) => action() });
export function useUnsavedChanges(dirty: boolean) {
  const { register } = useContext(UnsavedContext);
  const id = useId();
  useEffect(() => { register(id, dirty); return () => register(id, false); }, [dirty, id, register]);
}
export function useNavigationGuard() { return useContext(UnsavedContext).requestLeave; }
export function useCompletedSessionNavigation() { return useContext(UnsavedContext).completeSessionNavigation; }
export function useNavigationBusy(busy: boolean) {
  const { registerBusy } = useContext(UnsavedContext);
  const id = useId();
  useEffect(() => { registerBusy(id, busy); return () => registerBusy(id, false); }, [busy, id, registerBusy]);
}

function NavigationBlocker({ shouldBlock, onBlocked }: { shouldBlock: BlockerFunction; onBlocked: (pending: Pending) => void }) {
  const blocker = useBlocker(shouldBlock);
  const location = useLocation();
  useEffect(() => {
    if (blocker.state === 'blocked') onBlocked({ action: blocker.proceed, cancel: blocker.reset, closing: false, route: true, scopeChanged: blocker.location.pathname !== location.pathname || blocker.location.search !== location.search });
  }, [blocker, location.pathname, location.search, onBlocked]);
  return null;
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  const dirty = useRef(new Set<string>());
  const busy = useRef(new Set<string>());
  const [busyVersion, setBusyVersion] = useState(0);
  const [pending, setPending] = useState<Pending>();
  const pendingRef = useRef<Pending>(undefined);
  const navigationPermit = useRef(false);
  const updatePending = useCallback((next?: Pending) => { pendingRef.current = next; setPending(next); }, []);
  const register = useCallback((id: string, value: boolean) => { if (value) dirty.current.add(id); else dirty.current.delete(id); }, []);
  const registerBusy = useCallback((id: string, value: boolean) => {
    const previous = busy.current.size;
    if (value) busy.current.add(id); else busy.current.delete(id);
    if (previous !== busy.current.size) setBusyVersion(version => version + 1);
  }, []);
  const runConfirmed = useCallback((next: Pending) => {
    updatePending();
    // A confirmed local callback may navigate once, only within its synchronous execution.
    navigationPermit.current = !next.route;
    try { next.action(); } finally { navigationPermit.current = false; }
  }, [updatePending]);
  const requestLeave = useCallback((action: () => void, closing = false) => {
    if (pendingRef.current) return;
    if (dirty.current.size || busy.current.size) updatePending({ action, closing, route: false }); else action();
  }, [updatePending]);
  const completeSessionNavigation = useCallback((action: () => void) => {
    const current = pendingRef.current;
    updatePending();
    current?.cancel?.();
    runConfirmed({ action, closing: false, route: false });
  }, [runConfirmed, updatePending]);
  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    // Any intervening navigation resets React Router's blocked transition.
    if (pendingRef.current) return true;
    if (currentLocation.pathname === nextLocation.pathname && currentLocation.search === nextLocation.search) return false;
    if (busy.current.size) return true;
    if (navigationPermit.current) { navigationPermit.current = false; return false; }
    return dirty.current.size > 0;
  }, []);
  const onBlocked = useCallback((next: Pending) => {
    const current = pendingRef.current;
    if (current && !current.route) { next.cancel?.(); return; }
    if (!current || (busy.current.size && next.scopeChanged)) updatePending(next);
  }, [updatePending]);
  useEffect(() => {
    if (pending && !busy.current.size && !dirty.current.size) runConfirmed(pending);
  }, [pending, busyVersion, runConfirmed]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (dirty.current.size || busy.current.size) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, []);
  function protectLink(event: MouseEvent<HTMLDivElement>) {
    if (dataRouter || !dirty.current.size || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest('a[href]');
    if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.hasAttribute('download')) return;
    const next = new URL(link.href, window.location.href);
    if (next.origin !== window.location.origin || `${next.pathname}${next.search}` === `${location.pathname}${location.search}`) return;
    event.preventDefault(); event.stopPropagation();
    requestLeave(() => navigate(`${next.pathname}${next.search}${next.hash}`));
  }
  return <UnsavedContext.Provider value={{ register, registerBusy, requestLeave, completeSessionNavigation }}>
    {dataRouter && <NavigationBlocker shouldBlock={shouldBlock} onBlocked={onBlocked} />}
    <div className="qms-guard-boundary" onClickCapture={protectLink}>{children}</div>
    <Modal title={t('当前草稿尚未保存，继续将放弃修改。')} open={!!pending && !busy.current.size} okText={t(pending?.closing ? '放弃修改并关闭' : '放弃修改')} cancelText={t('继续编辑')} okButtonProps={{ danger: true }} onCancel={() => { const next = pendingRef.current; updatePending(); next?.cancel?.(); }} onOk={() => { if (pendingRef.current && !busy.current.size) runConfirmed(pendingRef.current); }} />
  </UnsavedContext.Provider>;
}
