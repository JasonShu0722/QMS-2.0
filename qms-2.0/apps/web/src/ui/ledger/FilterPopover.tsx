import { Button, Popover } from 'antd';
import { Filter, X } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

type FilterAnchor = RefObject<HTMLElement | undefined>;
type FilterOption = readonly [value: string, label: string];

export function LedgerFilterCondition({ index, field, fields, operator, operators, fieldRef, label = text => text, children, onFieldChange, onOperatorChange, onRemove }: {
  index: number; field: string; fields: readonly FilterOption[]; operator: string; operators: readonly FilterOption[];
  fieldRef?: RefObject<HTMLSelectElement | null>; label?: (text: string) => string; children: ReactNode;
  onFieldChange: (value: string) => void; onOperatorChange?: (value: string) => void; onRemove: () => void;
}) {
  return <div className="process-quality-filter-row">
    <select ref={fieldRef} aria-label={`${label('筛选字段')} ${index + 1}`} value={field} onChange={event => onFieldChange(event.target.value)}>
      {fields.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
    </select>
    <select aria-label={`${label('筛选运算符')} ${index + 1}`} value={operator} disabled={!onOperatorChange} onChange={event => onOperatorChange?.(event.target.value)}>
      {operators.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
    </select>
    {children}
    <Button type="text" aria-label={`${label('删除筛选条件')} ${index + 1}`} icon={<X size={13} />} onClick={onRemove} />
  </div>;
}

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
