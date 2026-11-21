import { useEffect, useRef, type ReactNode } from 'react';
import './list-toolbar.css';

export function ListToolbar({ children }: { children: ReactNode }) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const toolbar = toolbarRef.current;
    const list = toolbar?.parentElement;
    const view = toolbar?.ownerDocument.defaultView;
    if (!toolbar || !list || !view) return;

    function revealFocus(event: FocusEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !toolbar || !view || toolbar.contains(target)
        || view.getComputedStyle(toolbar).position !== 'sticky'
        || !(toolbar.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING)) return;
      const bar = toolbar.getBoundingClientRect();
      const focused = target.getBoundingClientRect();
      if (focused.top < bar.bottom && focused.bottom > bar.top && focused.left < bar.right && focused.right > bar.left) {
        view.scrollBy({ top: focused.top - bar.bottom - 4, behavior: 'instant' });
      }
    }

    list.addEventListener('focusin', revealFocus);
    return () => list.removeEventListener('focusin', revealFocus);
  }, []);

  return <div ref={toolbarRef} className="qms-list-toolbar">{children}</div>;
}
