import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLanguage } from '../../i18n/Language';
import './session-verification.css';

export function SessionVerificationGate({ open, onUnavailable, children }: { open: boolean; onUnavailable: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const failure = useRef(onUnavailable);
  failure.current = onUnavailable;
  const { locale } = useLanguage();
  useLayoutEffect(() => {
    const node = dialog.current!;
    if (open) {
      try { if (!node.open) node.showModal(); } catch { failure.current(); }
    } else if (node.open) node.close();
    return () => { if (node.open) node.close(); };
  }, [open]);
  return <dialog ref={dialog} className="qms-session-verification" aria-label={locale === 'en-US' ? 'Session security verification' : '会话安全验证'} onCancel={event => event.preventDefault()} onClose={() => {
    if (open) { try { dialog.current?.showModal(); } catch { failure.current(); } }
  }}>{open && children}</dialog>;
}
