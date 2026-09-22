import { Modal } from 'antd';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode, type MouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '../i18n/Language';

type Guard = { register: (id: string, dirty: boolean) => void; requestLeave: (action: () => void, closing?: boolean) => void };
const UnsavedContext = createContext<Guard>({ register: () => {}, requestLeave: (action) => action() });
export function useUnsavedChanges(dirty: boolean) {
  const { register } = useContext(UnsavedContext);
  const id = useId();
  useEffect(() => { register(id, dirty); return () => register(id, false); }, [dirty, id, register]);
}
export function useNavigationGuard() { return useContext(UnsavedContext).requestLeave; }

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const dirty = useRef(new Set<string>());
  const [pending, setPending] = useState<{ action: () => void; closing: boolean }>();
  const register = useCallback((id: string, value: boolean) => { if (value) dirty.current.add(id); else dirty.current.delete(id); }, []);
  const requestLeave = useCallback((action: () => void, closing = false) => {
    if (dirty.current.size) setPending({ action, closing }); else action();
  }, []);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (dirty.current.size) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, []);
  function protectLink(event: MouseEvent<HTMLDivElement>) {
    if (!dirty.current.size || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest('a[href]');
    if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.hasAttribute('download')) return;
    const next = new URL(link.href, window.location.href);
    if (next.origin !== window.location.origin || `${next.pathname}${next.search}` === `${location.pathname}${location.search}`) return;
    event.preventDefault(); event.stopPropagation();
    requestLeave(() => navigate(`${next.pathname}${next.search}${next.hash}`));
  }
  return <UnsavedContext.Provider value={{ register, requestLeave }}>
    <div className="qms-guard-boundary" onClickCapture={protectLink}>{children}</div>
    <Modal title={t('当前草稿尚未保存，继续将放弃修改。')} open={!!pending} okText={t(pending?.closing ? '放弃修改并关闭' : '放弃修改')} cancelText={t('继续编辑')} okButtonProps={{ danger: true }} onCancel={() => setPending(undefined)} onOk={() => { const action = pending?.action; setPending(undefined); action?.(); }} />
  </UnsavedContext.Provider>;
}
