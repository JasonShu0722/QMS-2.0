import { Button, Checkbox, Popover, Table, type TableProps } from 'antd';
import { ArrowDown, ArrowUp, GripVertical, RotateCcw, Settings2 } from 'lucide-react';
import { createContext, isValidElement, useContext, useLayoutEffect, useRef, useState, type ComponentProps, type ElementType, type ReactNode } from 'react';
import { useLanguage } from '../../i18n/Language';
import { boundedWidth, columnKey, DEFAULT_WIDTH, MAX_WIDTH, MIN_SELECTION_WIDTH, MIN_WIDTH, moveColumn, normalizePreferences, preferenceKey, SELECTION_WIDTH_KEY, type Fixed, type Preferences } from './model';
import { getLedgerSessionEpoch, useLedgerScope, useLedgerSessionEpoch, usePreference } from './preferences';
import './ledger.css';
export { LedgerScopeProvider, useLedgerPageSize } from './preferences';
export type LedgerTableProps<RecordType extends object> = TableProps<RecordType> & {
  ledgerId: string; organizationId?: string; viewId?: string; requiredColumnKeys?: string[];
  resizableSelection?: boolean;
  compactHeaders?: boolean;
  compactLayout?: boolean;
  toolbarContent?: ReactNode;
  columnOrder?: string[]; visibleColumnKeys?: string[];
  defaultVisibleColumnKeys?: string[];
  insertNewColumnBefore?: readonly [column: string, anchor: string];
  resetColumnsLabel?: string;
  onColumnOrderChange?: (keys: string[]) => void; onVisibleColumnKeysChange?: (keys: string[]) => void;
};
type Column<RecordType extends object> = NonNullable<TableProps<RecordType>['columns']>[number];
type Drag = { kind: 'width' | 'order'; key: string; origin: number; width: number; target?: string; scope?: string; epoch: number; pointerId: number; awaitingMotion?: boolean };
const headerControls = 'button, a, input, select, textarea, label, [contenteditable], [role="button"], [role="checkbox"], [role="combobox"], [role="separator"], [tabindex]';
const HeaderCellComponent = createContext<{ Cell: ElementType; selectionResize?: ReactNode }>({ Cell: 'th' });
function LedgerHeaderCell({ ledgerResize, ledgerAriaLabel, children, ...props }: ComponentProps<'th'> & { ledgerResize?: ReactNode; ledgerAriaLabel?: string }) {
  const { Cell, selectionResize } = useContext(HeaderCellComponent);
  return <Cell {...props} aria-label={ledgerAriaLabel ?? props['aria-label']}>{children}{ledgerResize ?? (selectionResize && props.className?.split(/\s+/).includes('ant-table-selection-column') ? selectionResize : null)}</Cell>;
}
function WidthInput({ value, minimum, label, onCommit }: { value: number; minimum: number; label: string; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<string>();
  function submit() {
    if (draft !== undefined && draft.trim() && Number.isFinite(Number(draft))) onCommit(Number(draft));
    setDraft(undefined);
  }
  return <input aria-label={label} type="number" min={minimum} max={MAX_WIDTH} step={10} value={draft ?? value} onChange={event => setDraft(event.target.value)} onBlur={submit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } else if (event.key === 'Escape') { event.preventDefault(); setDraft(undefined); } }} />;
}
export function LedgerTable<RecordType extends object>({ ledgerId, organizationId, viewId, requiredColumnKeys = [], columnOrder, visibleColumnKeys, defaultVisibleColumnKeys, insertNewColumnBefore, resetColumnsLabel, onColumnOrderChange, onVisibleColumnKeysChange, columns = [], scroll, className, components, expandable, rowSelection, resizableSelection = false, compactHeaders = false, compactLayout = false, toolbarContent, ...tableProps }: LedgerTableProps<RecordType>) {
  const { locale } = useLanguage();
  const text = (chinese: string, english: string) => locale === 'en-US' ? english : chinese;
  const scope = useLedgerScope(organizationId);
  const sessionEpoch = useLedgerSessionEpoch();
  const storageKey = preferenceKey(scope, ledgerId, 'columns', viewId);
  const stateKey = storageKey ?? JSON.stringify([scope, ledgerId, viewId]);
  const leaves: Column<RecordType>[] = [];
  function collect(input: Column<RecordType>[]) { input.forEach(column => { if ('children' in column) collect(column.children); else leaves.push(column); }); }
  collect(columns);
  const counts = new Map<string, number>();
  leaves.forEach(column => { const key = columnKey(column); if (key) counts.set(key, (counts.get(key) ?? 0) + 1); });
  const configurable = leaves.filter(column => { const key = columnKey(column); return key && counts.get(key) === 1 && !column.hidden; }).slice(0, 200);
  const keys = configurable.map(column => columnKey(column)!);
  const normalize = (input: unknown) => normalizePreferences(input === undefined && defaultVisibleColumnKeys !== undefined ? { order: keys, visible: defaultVisibleColumnKeys } : input, keys, resizableSelection, insertNewColumnBefore);
  const [saved, save] = usePreference(storageKey, scope.sessionScope, normalize, stateKey);
  const defaultFixed = Object.fromEntries(configurable.map(column => [columnKey(column)!, column.fixed === true ? 'left' : column.fixed || false])) as Record<string, Fixed>;
  const order = columnOrder === undefined ? saved.order : normalizePreferences({ order: columnOrder }, keys).order;
  const visible = visibleColumnKeys === undefined ? saved.visible : keys.filter(key => visibleColumnKeys.includes(key));
  const required = requiredColumnKeys.filter(key => keys.includes(key));
  function resolveFixed(requested: Record<string, Fixed>, activeOrder = order): Record<string, Fixed> {
    const region = (value: Fixed) => value === 'left' ? 0 : value === 'right' ? 2 : 1;
    return Object.fromEntries(keys.map(key => {
      if (required.includes(key)) return [key, defaultFixed[key]];
      const index = activeOrder.indexOf(key);
      const allowed = (value: Fixed) => required.every(locked => activeOrder.indexOf(locked) < index ? region(value) >= region(defaultFixed[locked]) : region(value) <= region(defaultFixed[locked]));
      const requestedValue = requested[key] ?? defaultFixed[key];
      return [key, allowed(requestedValue) ? requestedValue : allowed(defaultFixed[key]) ? defaultFixed[key] : false];
    }));
  }
  const fixed = resolveFixed(saved.fixed);
  const tableRoot = useRef<HTMLDivElement>(null);
  const [headerMinimum, setHeaderMinimum] = useState<Record<string, number>>({});
  const measuredColumns = JSON.stringify(keys.filter(key => visible.includes(key) || required.includes(key)));
  useLayoutEffect(() => {
    if (!compactHeaders) return;
    const titles = Array.from(tableRoot.current?.querySelectorAll<HTMLElement>(':scope > .ant-table-wrapper th[data-compact-ledger-column] .qms-ledger__title') ?? []);
    function measure() {
      const widths: Record<string, number> = {};
      for (const title of titles) {
        const cell = title.closest<HTMLElement>('th[data-compact-ledger-column]');
        if (!cell?.dataset.compactLedgerColumn || title.offsetWidth === 0) continue;
        const style = getComputedStyle(cell);
        const spacing = [style.paddingInlineStart || style.paddingLeft, style.paddingInlineEnd || style.paddingRight, style.borderInlineStartWidth || style.borderLeftWidth, style.borderInlineEndWidth || style.borderRightWidth].reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
        widths[cell.dataset.compactLedgerColumn] = Math.min(MAX_WIDTH, Math.ceil(title.offsetWidth + spacing + 5));
      }
      setHeaderMinimum(previous => Object.keys(widths).some(key => previous[key] !== widths[key]) ? { ...previous, ...widths } : previous);
    }
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    titles.forEach(title => observer?.observe(title));
    return () => observer?.disconnect();
  }, [compactHeaders, measuredColumns, stateKey]);
  const drag = useRef<Drag | undefined>(undefined);
  const suppressHeaderClick = useRef<string | undefined>(undefined);
  const activeScope = useRef(stateKey);
  activeScope.current = stateKey;
  const [preview, setPreview] = useState<{ scope?: string; epoch: number; key: string; width: number }>();
  const [dropTarget, setDropTarget] = useState<{ scope?: string; epoch: number; key: string }>();
  const label = (column: Column<RecordType>) => typeof column.title === 'string' || typeof column.title === 'number' ? String(column.title) : isValidElement<{ 'aria-label'?: string }>(column.title) && column.title.props['aria-label'] ? column.title.props['aria-label'] : columnKey(column)!;
  const getColumn = (key: string) => configurable.find(column => columnKey(column) === key)!;
  const isSelectionColumn = (key: string) => key === SELECTION_WIDTH_KEY || key === 'select';
  const minimumFor = (key: string) => isSelectionColumn(key) ? MIN_SELECTION_WIDTH : boundedWidth(getColumn(key)?.minWidth, MIN_WIDTH, compactHeaders ? Math.max(MIN_WIDTH, headerMinimum[key] ?? 0) : MIN_WIDTH);
  const clampWidth = (key: string, value: unknown, fallback = DEFAULT_WIDTH) => boundedWidth(value, fallback, minimumFor(key));
  const widthFor = (key: string) => preview && preview.epoch === sessionEpoch && preview.scope === stateKey && preview.key === key ? preview.width : clampWidth(key, isSelectionColumn(key) && saved.widths[key] === 64 ? undefined : saved.widths[key], key === SELECTION_WIDTH_KEY ? clampWidth(key, rowSelection?.columnWidth, 44) : boundedWidth(getColumn(key)?.width, isSelectionColumn(key) ? 40 : DEFAULT_WIDTH, isSelectionColumn(key) ? MIN_SELECTION_WIDTH : MIN_WIDTH));
  const businessWidth = keys.filter(key => visible.includes(key) || required.includes(key)).reduce((total, key) => total + widthFor(key), 0);
  const fitSelection = Boolean(!compactLayout && rowSelection && resizableSelection && businessWidth);
  const selectionWidth = widthFor(SELECTION_WIDTH_KEY);
  const columnWidth = (key: string) => fitSelection && key !== SELECTION_WIDTH_KEY ? `${widthFor(key) / businessWidth * 100}%` : widthFor(key);
  function commit(next: Preferences) { save(normalize({ ...next, fixed: resolveFixed(next.fixed, columnOrder ?? next.order) })); }
  function setWidth(key: string, width: number) { commit({ ...saved, widths: { ...saved.widths, [key]: clampWidth(key, width) } }); }
  function setOrder(next: string[]) {
    if (next.join('\u0000') === order.join('\u0000')) return;
    if (columnOrder !== undefined) onColumnOrderChange?.(next);
    else { commit({ ...saved, order: next }); onColumnOrderChange?.(next); }
  }
  function move(source: string, target: string) { setOrder(moveColumn(order, source, target, fixed, required)); }
  function setVisible(next: string[]) {
    const safe = keys.filter(key => next.includes(key) || required.includes(key));
    if (visibleColumnKeys !== undefined) onVisibleColumnKeysChange?.(safe);
    else { commit({ ...saved, visible: safe }); onVisibleColumnKeysChange?.(safe); }
  }
  function resetColumn(key: string) {
    const widths = { ...saved.widths }; const nextFixed = { ...saved.fixed };
    delete widths[key]; delete nextFixed[key];
    commit({ ...saved, widths, fixed: nextFixed });
  }
  function resetAll() {
    commit(normalize(undefined));
    if (columnOrder !== undefined) onColumnOrderChange?.(keys);
    if (visibleColumnKeys !== undefined) onVisibleColumnKeysChange?.(normalize(undefined).visible);
  }
  function begin(event: React.PointerEvent<HTMLElement>, key: string, kind: Drag['kind']) {
    event.stopPropagation();
    if (event.button !== 0 && event.button !== undefined) return;
    // Compact headers let outside-click handlers receive the native mousedown.
    if (!compactHeaders) event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { key, kind, origin: event.clientX, width: widthFor(key), scope: stateKey, epoch: getLedgerSessionEpoch(), pointerId: event.pointerId, awaitingMotion: compactHeaders && kind === 'order' };
  }
  function update(event: React.PointerEvent<HTMLElement>) {
    event.stopPropagation();
    const current = drag.current;
    if (!current || current.epoch !== getLedgerSessionEpoch() || current.pointerId !== event.pointerId || current.scope !== activeScope.current) return;
    if (current.kind === 'width') setPreview({ scope: stateKey, epoch: current.epoch, key: current.key, width: clampWidth(current.key, current.width + event.clientX - current.origin, current.width) });
    else {
      if (current.awaitingMotion && Math.abs(event.clientX - current.origin) < 5) return;
      current.awaitingMotion = false;
      const target = document.elementFromPoint?.(event.clientX, event.clientY)?.closest<HTMLElement>(compactHeaders ? '[data-compact-ledger-column]' : '[data-ledger-column]');
      const targetKey = compactHeaders ? target?.dataset.compactLedgerColumn : target?.dataset.ledgerColumn;
      if (targetKey && target && event.currentTarget.closest('.qms-ledger')?.contains(target) && (!compactHeaders || moveColumn(order, current.key, targetKey, fixed, required) !== order)) {
        current.target = targetKey;
        setDropTarget({ scope: stateKey, epoch: current.epoch, key: targetKey });
      } else if (compactHeaders) {
        current.target = undefined;
        setDropTarget(undefined);
      }
    }
  }
  function end(event: React.PointerEvent<HTMLElement>, cancelled: boolean) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    drag.current = undefined; setPreview(undefined); setDropTarget(undefined);
    if (cancelled || current.epoch !== getLedgerSessionEpoch() || current.scope !== activeScope.current) return;
    if (current.kind === 'width') setWidth(current.key, clampWidth(current.key, current.width + event.clientX - current.origin, current.width));
    else if (!current.awaitingMotion) {
      if (compactHeaders) suppressHeaderClick.current = current.key;
      if (current.target) move(current.key, current.target);
    }
  }
  function moveByKey(event: React.KeyboardEvent<HTMLElement>, key: string) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.stopPropagation(); event.preventDefault();
    const target = order[order.indexOf(key) + (event.key === 'ArrowLeft' ? -1 : 1)];
    if (target) move(key, target);
  }
  function resizeHandle(key: string, name: string) {
    return <span role="separator" tabIndex={0} aria-label={`${text('调整列宽', 'Resize column')} ${name}`} aria-orientation="vertical" aria-valuemin={minimumFor(key)} aria-valuemax={MAX_WIDTH} aria-valuenow={widthFor(key)} className="qms-ledger__resize" onClick={event => event.stopPropagation()} onDoubleClick={event => { event.stopPropagation(); const widths = { ...saved.widths }; delete widths[key]; commit({ ...saved, widths }); }} onPointerDown={event => begin(event, key, 'width')} onPointerMove={update} onPointerUp={event => end(event, false)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)} onKeyDown={event => { event.stopPropagation(); if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setWidth(key, widthFor(key) + (event.key === 'ArrowLeft' ? -10 : 10)); } }} />;
  }
  function decorate(input: Column<RecordType>[]): Column<RecordType>[] {
    const next = input.map(column => {
      if ('children' in column) return { ...column, children: decorate(column.children) };
      const key = columnKey(column);
      if (!key || !keys.includes(key)) return column;
      const title = column.title;
      const name = label(column);
      const movable = !required.includes(key);
      const onHeaderCell: typeof column.onHeaderCell = (headerColumn, index) => {
        const original = column.onHeaderCell?.(headerColumn, index) ?? {};
        const ariaLabel = original['aria-label'] ?? (typeof title === 'string' && original['aria-labelledby'] == null ? title : undefined);
        return { ...original, 'aria-label': ariaLabel, ledgerAriaLabel: ariaLabel, className: [original.className, 'qms-ledger__header-cell', compactHeaders && movable && 'qms-ledger__header-cell--movable'].filter(Boolean).join(' '), ledgerResize: resizeHandle(key, name),
          ...(compactHeaders ? { 'data-compact-ledger-column': key } : {}),
          ...(compactHeaders && movable ? {
            tabIndex: original.tabIndex ?? 0,
            'aria-keyshortcuts': 'ArrowLeft ArrowRight',
            onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
              suppressHeaderClick.current = undefined;
              original.onPointerDown?.(event);
              if (event.defaultPrevented || event.pointerType === 'touch') return;
              const control = (event.target as Element).closest(headerControls);
              if (!control || control === event.currentTarget || !event.currentTarget.contains(control)) begin(event, key, 'order');
            },
            onPointerMove: (event: React.PointerEvent<HTMLElement>) => { original.onPointerMove?.(event); if (drag.current?.kind === 'order') update(event); },
            onPointerUp: (event: React.PointerEvent<HTMLElement>) => { original.onPointerUp?.(event); if (drag.current?.kind === 'order') end(event, false); },
            onPointerCancel: (event: React.PointerEvent<HTMLElement>) => { original.onPointerCancel?.(event); if (drag.current?.kind === 'order') end(event, true); },
            onLostPointerCapture: (event: React.PointerEvent<HTMLElement>) => { original.onLostPointerCapture?.(event); if (drag.current?.kind === 'order') end(event, true); },
            onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
              if (event.detail > 0 && suppressHeaderClick.current === key) { suppressHeaderClick.current = undefined; event.preventDefault(); event.stopPropagation(); return; }
              original.onClickCapture?.(event);
            },
            onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
              original.onKeyDown?.(event);
              if (!event.defaultPrevented && event.target === event.currentTarget) moveByKey(event, key);
            },
          } : {}),
        };
      };
      return { ...column, key: column.key ?? key, onHeaderCell, hidden: !visible.includes(key) && !required.includes(key), width: columnWidth(key), fixed: fixed[key], title: (titleProps: Parameters<Exclude<typeof title, ReactNode>>[0]) => <div className={`qms-ledger__heading${dropTarget && dropTarget.epoch === sessionEpoch && dropTarget.scope === stateKey && dropTarget.key === key ? ' qms-ledger__heading--drop' : ''}`} data-ledger-column={key}>
        {movable && !compactHeaders ? <button type="button" className="qms-ledger__grip" aria-label={`${text('移动列', 'Move column')} ${name}`} onClick={event => event.stopPropagation()} onPointerDown={event => begin(event, key, 'order')} onPointerMove={update} onPointerUp={event => end(event, false)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)} onKeyDown={event => { event.stopPropagation(); moveByKey(event, key); }}><GripVertical size={12} aria-hidden="true" /></button> : null}
        <span className="qms-ledger__title">{typeof title === 'function' ? title(titleProps) : title}</span>
      </div> };
    });
    const sortable = next.filter(column => !('children' in column) && keys.includes(columnKey(column) ?? ''));
    sortable.sort((left, right) => {
      const leftKey = columnKey(left)!; const rightKey = columnKey(right)!;
      const region = (key: string) => fixed[key] === 'left' ? 0 : fixed[key] === 'right' ? 2 : 1;
      return region(leftKey) - region(rightKey) || order.indexOf(leftKey) - order.indexOf(rightKey);
    });
    let cursor = 0;
    return next.map(column => !('children' in column) && keys.includes(columnKey(column) ?? '') ? sortable[cursor++] : column);
  }
  const selectionName = text('选择', 'Selection');
  const selection = rowSelection && resizableSelection ? { ...rowSelection, columnWidth: widthFor(SELECTION_WIDTH_KEY) } : undefined;
  function widthSetting(key: string, name: string) {
    return <label className="qms-ledger__width-label"><span>{text('列宽', 'Width')}</span><WidthInput key={`${stateKey}:${key}`} label={`${text('列宽', 'Column width')} ${name}`} minimum={minimumFor(key)} value={widthFor(key)} onCommit={width => setWidth(key, width)} /></label>;
  }
  const settings = <div className="qms-ledger__settings">
    {selection && <div className="qms-ledger__setting">
      <span>{selectionName}</span>{widthSetting(SELECTION_WIDTH_KEY, selectionName)}
      <Button size="small" aria-label={`${text('恢复', 'Reset')} ${selectionName}`} icon={<RotateCcw size={12} />} onClick={() => resetColumn(SELECTION_WIDTH_KEY)} />
    </div>}
    {order.map((key, index) => {
      const column = getColumn(key); const name = label(column);
      const canMove = (direction: -1 | 1) => order[index + direction] && moveColumn(order, key, order[index + direction], fixed, required) !== order;
      const canPin = (value: Fixed) => resolveFixed({ ...saved.fixed, [key]: value })[key] === value;
      return <div key={key} className="qms-ledger__setting">
        <Checkbox aria-label={`${text('显示', 'Show')} ${name}`} checked={visible.includes(key) || required.includes(key)} disabled={required.includes(key)} onChange={event => setVisible(event.target.checked ? [...visible, key] : visible.filter(value => value !== key))}>{name}</Checkbox>
        {widthSetting(key, name)}
        <select aria-label={`${text('固定', 'Pin')} ${name}`} value={fixed[key] || ''} disabled={required.includes(key)} onChange={event => commit({ ...saved, fixed: { ...saved.fixed, [key]: event.target.value === 'left' ? 'left' : event.target.value === 'right' ? 'right' : false } })}><option value="" disabled={!canPin(false)}>{text('不固定', 'Unpinned')}</option><option value="left" disabled={!canPin('left')}>{text('左侧', 'Left')}</option><option value="right" disabled={!canPin('right')}>{text('右侧', 'Right')}</option></select>
        <Button size="small" aria-label={`${text('上移', 'Move up')} ${name}`} disabled={!canMove(-1)} icon={<ArrowUp size={12} />} onClick={() => move(key, order[index - 1])} />
        <Button size="small" aria-label={`${text('下移', 'Move down')} ${name}`} disabled={!canMove(1)} icon={<ArrowDown size={12} />} onClick={() => move(key, order[index + 1])} />
        <Button size="small" aria-label={`${text('恢复', 'Reset')} ${name}`} icon={<RotateCcw size={12} />} onClick={() => resetColumn(key)} />
      </div>;
    })}
    <Button size="small" onClick={resetAll}>{resetColumnsLabel ?? text('恢复全部列', 'Reset all columns')}</Button>
  </div>;
  const expansion = expandable?.expandedRowRender ? { ...expandable, columnTitle: expandable.columnTitle === undefined ? text('明细', 'Details') : expandable.columnTitle, columnWidth: expandable.columnWidth ?? 64, showExpandColumn: expandable.showExpandColumn ?? (tableProps.dataSource?.some(record => !expandable.rowExpandable || expandable.rowExpandable(record)) ?? false) } : expandable;
  const nativeSelectionWidth = selection?.columnWidth ?? rowSelection?.columnWidth ?? 32;
  const compactWidth = businessWidth + (rowSelection ? Number(nativeSelectionWidth) || 32 : 0) + (expansion?.showExpandColumn ? Number(expansion.columnWidth) || 64 : 0);
  const tableScroll = { x: 'max-content', ...scroll };
  if (compactLayout && businessWidth) tableScroll.x = compactWidth;
  else if (fitSelection) tableScroll.x = `max(100%, ${businessWidth + selectionWidth}px)`;
  return <div ref={tableRoot} className={`qms-ledger${compactHeaders ? ' qms-ledger--compact-headers' : ''}${compactLayout ? ' qms-ledger--compact-layout' : ''}${toolbarContent == null && tableProps.pagination !== false ? ' qms-ledger--native-pagination' : ''}`}>
    <div className="qms-ledger__tools">{toolbarContent}<Popover content={settings} trigger="click" placement="bottomRight"><Button size="small" icon={<Settings2 size={13} />} disabled={!keys.length && !selection}>{text('列设置', 'Columns')}</Button></Popover></div>
    <HeaderCellComponent value={{ Cell: (components?.header?.cell ?? 'th') as ElementType, selectionResize: selection ? resizeHandle(SELECTION_WIDTH_KEY, selectionName) : undefined }}><Table<RecordType> {...tableProps} pagination={tableProps.pagination === false ? false : { placement: tableProps.pagination?.position ? undefined : ['topStart'], size: 'small', showTotal: total => text(`共 ${total} 条`, `${total} records`), showQuickJumper: true, ...tableProps.pagination }} tableLayout={compactLayout || fitSelection ? 'fixed' : tableProps.tableLayout} className={className} columns={decorate(columns)} rowSelection={selection ?? rowSelection} scroll={tableScroll} expandable={expansion} components={{ ...components, header: { ...components?.header, cell: LedgerHeaderCell } }} /></HeaderCellComponent>
  </div>;
}
