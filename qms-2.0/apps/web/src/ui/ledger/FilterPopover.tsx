import { Button, Popover } from 'antd';
import { Filter, X } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

type FilterAnchor = RefObject<HTMLElement | undefined>;

export function LedgerFilterPopover({ open, trigger, label, count, disabled, children, onOpen, onDismiss, onFocus }: {
  open: boolean; trigger: RefObject<HTMLButtonElement | null>; label: string; count: number; disabled?: boolean;
  children: ReactNode; onOpen: (element: HTMLElement) => void; onDismiss: (restoreFocus: boolean) => void; onFocus: () => void;
}) {
  return <Popover open={open} onOpenChange={next => {
    if (next && trigger.current) onOpen(trigger.current);
    else if (!next && open) onDismiss(false);
  }} afterOpenChange={next => { if (next) onFocus(); }} content={children} trigger="click" placement="bottomLeft" align={{ overflow: { shiftX: true } }} destroyOnHidden>
    <Button ref={trigger} aria-label={label} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} icon={<Filter size={14} />}>{label}{count ? ` ${count}` : ''}</Button>
  </Popover>;
}

export function LedgerFilterPanel({ anchor, trigger, label, title, closeLabel, children, onDismiss }: {
  anchor: FilterAnchor; trigger: RefObject<HTMLButtonElement | null>; label: string; title: string; closeLabel: string;
  children: ReactNode; onDismiss: (restoreFocus: boolean) => void;
}) {
  return <div role="dialog" className="process-quality-filter-panel" aria-label={label}
    onBlur={event => {
      const next = event.relatedTarget;
      if (next && next !== trigger.current && next !== anchor.current && !event.currentTarget.contains(next)) onDismiss(false);
    }}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onDismiss(true); } }}>
    <div className="process-quality-filter-heading"><strong>{title}</strong><Button type="text" aria-label={closeLabel} icon={<X size={14} />} onClick={() => onDismiss(true)} /></div>
    {children}
  </div>;
}

export function LedgerFilterHeader({ 'aria-label': label, triggerLabel, active, expanded, disabled, onOpen }: {
  'aria-label': string; triggerLabel: string; active: boolean; expanded: boolean; disabled?: boolean; onOpen: (element: HTMLElement) => void;
}) {
  return <span aria-label={label} className="process-quality-filter-title"><span>{label}</span><button type="button" aria-label={triggerLabel} aria-haspopup="dialog" aria-expanded={expanded} aria-pressed={active} disabled={disabled} onClick={event => { event.stopPropagation(); onOpen(event.currentTarget); }}><Filter size={13} aria-hidden="true" /></button></span>;
}
