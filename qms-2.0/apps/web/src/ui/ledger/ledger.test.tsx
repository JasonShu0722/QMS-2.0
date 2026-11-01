import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { LedgerScopeProvider, LedgerTable, useLedgerPageSize } from './index';
import { preferenceKey } from './model';
import { readFileSync } from 'node:fs';
import { Pagination } from 'antd';
import { LanguageProvider } from '../../i18n/Language';

const ledgerCss = readFileSync('src/ui/ledger/ledger.css', 'utf8');

const columns = [{ key: 'a', title: '编号', dataIndex: 'a', width: 180 }, { key: 'b', title: '名称', dataIndex: 'b', width: 200 }, { key: 'action', title: '操作', render: () => <button>编辑</button> }];
const data = [{ key: 'one', a: 'A', b: 'B' }];
beforeEach(() => {
  localStorage.clear(); useWorkTabsStore.getState().bindSession('INTERNAL:home:user');
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, options: PointerEventInit = {}) { super(type, options); this.pointerId = options.pointerId ?? 0; }
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const settings = () => fireEvent.click(screen.getByRole('button', { name: '列设置' }));

describe('ledger page size', () => {
  it('defaults to twenty, persists legal sizes and isolates target organization on the first render', () => {
    const { result, rerender } = renderHook(({ organizationId }) => useLedgerPageSize('sizes', organizationId), { initialProps: { organizationId: 'a' } });
    expect(result.current[0]).toBe(20);
    act(() => result.current[1](50));
    expect(result.current[0]).toBe(50);
    rerender({ organizationId: 'b' });
    expect(result.current[0]).toBe(20);
    act(() => result.current[1](100));
    rerender({ organizationId: 'a' });
    expect(result.current[0]).toBe(50);
  });
  it('provider target and portal isolate preferences and explicit target takes priority', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => <LedgerScopeProvider organizationId="target" portal="console">{children}</LedgerScopeProvider>;
    const first = renderHook(() => useLedgerPageSize('provider'), { wrapper });
    act(() => first.result.current[1](100));
    const same = renderHook(() => useLedgerPageSize('provider', 'target'), { wrapper });
    expect(same.result.current[0]).toBe(100);
    const different = renderHook(() => useLedgerPageSize('provider', 'other'), { wrapper });
    expect(different.result.current[0]).toBe(20);
    const business = renderHook(() => useLedgerPageSize('provider', 'target'));
    expect(business.result.current[0]).toBe(20);
  });
  it('does not write without a trusted session and degrades to memory on unavailable storage', () => {
    act(() => useWorkTabsStore.getState().reset());
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const anonymous = renderHook(() => useLedgerPageSize('anonymous'));
    act(() => anonymous.result.current[1](50));
    expect(anonymous.result.current[0]).toBe(50);
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
    act(() => useWorkTabsStore.getState().bindSession('INTERNAL:home:user'));
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('disabled'); });
    const failWrite = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    const memory = renderHook(() => useLedgerPageSize('storage-disabled'));
    act(() => memory.result.current[1](50));
    expect(memory.result.current[0]).toBe(50);
    getItem.mockRestore(); failWrite.mockRestore();
  });
  it('old setters cannot write another identity and corrupt storage resets safely', () => {
    const hook = renderHook(() => useLedgerPageSize('stale'));
    const stale = hook.result.current[1];
    act(() => useWorkTabsStore.getState().bindSession('INTERNAL:home:other'));
    act(() => stale(100));
    expect(hook.result.current[0]).toBe(20);
    const key = Object.keys(localStorage).find(key => key.includes('qms:ledger:'));
    expect(key).toBeUndefined();
  });
  it('ignores corrupted or oversized cached configurations', () => {
    const key = preferenceKey({ sessionScope: 'INTERNAL:home:user', portal: 'business' }, 'corrupt', 'pageSize')!;
    localStorage.setItem(key, '{broken');
    const first = renderHook(() => useLedgerPageSize('corrupt'));
    expect(first.result.current[0]).toBe(20);
    first.unmount();
    localStorage.setItem(key, ' '.repeat(65000));
    const second = renderHook(() => useLedgerPageSize('corrupt'));
    expect(second.result.current[0]).toBe(20);
  });
  it('isolates anonymous ledger state in memory without storage writes', () => {
    act(() => useWorkTabsStore.getState().reset());
    const hook = renderHook(({ id }) => useLedgerPageSize(id), { initialProps: { id: 'anonymous-a' } });
    act(() => hook.result.current[1](50));
    hook.rerender({ id: 'anonymous-b' });
    expect(hook.result.current[0]).toBe(20);
  });
  it('retains the newest memory value after a quota failure over an older disk value', () => {
    const first = renderHook(() => useLedgerPageSize('quota-remount'));
    act(() => first.result.current[1](50));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    act(() => first.result.current[1](100));
    first.unmount();
    const second = renderHook(() => useLedgerPageSize('quota-remount'));
    expect(second.result.current[0]).toBe(100);
  });
  it('invalidates an old setter across batched A to B to A and enables the current session setter', () => {
    const hook = renderHook(() => useLedgerPageSize('batched-aba'));
    const previousSetter = hook.result.current[1];
    const write = vi.spyOn(Storage.prototype, 'setItem');
    act(() => {
      useWorkTabsStore.getState().bindSession('INTERNAL:home:other');
      useWorkTabsStore.getState().bindSession('INTERNAL:home:user');
      previousSetter(100);
    });
    expect(hook.result.current[0]).toBe(20);
    expect(write.mock.calls.filter(([key]) => key.startsWith('qms:ledger:'))).toEqual([]);
    expect(hook.result.current[1]).not.toBe(previousSetter);
    act(() => hook.result.current[1](50));
    expect(hook.result.current[0]).toBe(50);
    expect(write.mock.calls.filter(([key]) => key.startsWith('qms:ledger:'))).toHaveLength(1);
    act(() => previousSetter(100));
    expect(hook.result.current[0]).toBe(50);
    expect(write.mock.calls.filter(([key]) => key.startsWith('qms:ledger:'))).toHaveLength(1);
  });
});

describe('LedgerTable', () => {
  it('anchors resize handles directly to real grouped, sortable, ellipsis and fixed header cells', () => {
    const click = vi.fn();
    render(<LedgerTable ledgerId="header-boundary" columns={[{ title: 'Group', children: [{ ...columns[0], sorter: true, ellipsis: true, fixed: 'left', onHeaderCell: () => ({ className: 'caller-edge', style: { paddingInline: 24 }, onClick: click, 'aria-label': 'Caller edge' }) }, columns[1]] }, columns[2]]} dataSource={data} pagination={false} />);
    for (const handle of screen.getAllByRole('separator')) {
      expect(handle.parentElement?.tagName).toBe('TH');
      expect(handle.parentElement).toHaveClass('qms-ledger__header-cell');
      expect(handle.closest('.qms-ledger__heading')).toBeNull();
      expect(handle.closest('.ant-table-column-title')).toBeNull();
    }
    const header = screen.getByRole('columnheader', { name: 'Caller edge' });
    expect(header).toHaveClass('caller-edge', 'ant-table-cell-fix-start');
    expect(header).toHaveStyle({ paddingInline: '24px' });
    fireEvent.click(screen.getByRole('separator', { name: '调整列宽 编号' }));
    expect(click).not.toHaveBeenCalled();
    fireEvent.click(header);
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('columnheader', { name: 'Group' }).querySelector(':scope > .qms-ledger__resize')).toBeNull();
  });
  it('uses the full cell edge as the sole resize line and suppresses duplicate native header dividers', () => {
    render(<LedgerTable ledgerId="edge-css" columns={[{ ...columns[0], ellipsis: true, sorter: true }]} dataSource={data} pagination={false} />);
    const style = document.createElement('style');
    style.textContent = ledgerCss;
    document.head.append(style);
    try {
      const rules = Array.from(style.sheet!.cssRules).filter((rule): rule is CSSStyleRule => 'selectorText' in rule);
      const header = screen.getByRole('columnheader', { name: '编号' });
      const handle = screen.getByRole('separator');
      expect(rules.some(rule => header.matches(rule.selectorText) && rule.style.getPropertyValue('overflow') === 'visible')).toBe(true);
      const edge = rules.find(rule => handle.matches(rule.selectorText) && rule.style.getPropertyValue('position') === 'absolute')!;
      expect(edge.style.getPropertyValue('inset-block')).toBe('0');
      expect(edge.style.getPropertyValue('inset-inline-end')).toBe('-5px');
      expect(Number.parseInt(edge.style.getPropertyValue('width'))).toBeGreaterThanOrEqual(10);
      expect(rules.some(rule => rule.selectorText.includes('th:has(> .qms-ledger__resize:hover)') && rule.style.getPropertyValue('border-inline-end-color') === 'var(--qms-accent)')).toBe(true);
      expect(rules.some(rule => rule.selectorText.endsWith('th::before') && header.matches(rule.selectorText.replace('::before', '')) && rule.style.getPropertyValue('display') === 'none')).toBe(true);
      expect(rules.filter(rule => rule.selectorText.includes('.qms-ledger__resize::after'))).toHaveLength(0);
      expect(screen.getByRole('button', { name: '移动列 编号' })).not.toBe(handle);
    } finally { style.remove(); }
  });
  it('does not override native sticky positioning on fixed header cells', () => {
    render(<LedgerTable ledgerId="fixed-edge-css" columns={[{ ...columns[0], fixed: 'left' }, columns[1], { ...columns[2], fixed: 'right' }]} dataSource={data} pagination={false} />);
    const style = document.createElement('style');
    style.textContent = ledgerCss;
    document.head.append(style);
    try {
      const rules = Array.from(style.sheet!.cssRules).filter((rule): rule is CSSStyleRule => 'selectorText' in rule);
      for (const name of ['编号', '操作']) {
        const header = screen.getByRole('columnheader', { name });
        expect(header.className).toMatch(/ant-table-cell-fix-(start|end)/);
        expect(rules.filter(rule => header.matches(rule.selectorText) && rule.style.getPropertyValue('position') === 'relative')).toHaveLength(0);
      }
    } finally { style.remove(); }
  });
  it.each(['empty', 'none', 'missing'] as const)('does not allocate a detail column when expandable rows are %s', mode => {
    const { container } = render(<LedgerTable ledgerId={`no-detail-${mode}`} columns={columns} dataSource={mode === 'none' ? data : mode === 'empty' ? [] : undefined} pagination={false} rowSelection={{}} expandable={{ rowExpandable: mode === 'none' ? () => false : undefined, expandedRowRender: () => <p>Detail content</p> }} />);
    expect(container.querySelector('.ant-table-row-expand-icon-cell')).toBeNull();
    expect(screen.getAllByRole('columnheader')).toHaveLength(4);
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
  });
  it.each(['mixed', 'all', 'no-predicate'] as const)('keeps native detail controls and a named bounded column for %s rows', mode => {
    const rows = [...data, { key: 'two', a: 'Second', b: 'Name' }];
    const onExpand = vi.fn();
    const { container } = render(<LedgerTable ledgerId={`details-${mode}`} columns={columns} dataSource={rows} pagination={false} expandable={{ rowExpandable: mode === 'no-predicate' ? undefined : row => mode === 'all' || row.key === 'one', expandedRowRender: row => <p>Detail {row.key}</p>, onExpand }} />);
    const header = screen.getByRole('columnheader', { name: '明细' });
    expect(header).toHaveClass('ant-table-row-expand-icon-cell');
    const width = container.querySelector('colgroup col') as HTMLElement;
    expect(Number.parseFloat(width.style.width)).toBeGreaterThanOrEqual(40);
    expect(Number.parseFloat(width.style.width)).toBeLessThanOrEqual(80);
    const buttons = container.querySelectorAll<HTMLButtonElement>('button.ant-table-row-expand-icon:not(.ant-table-row-expand-icon-spaced)');
    expect(buttons).toHaveLength(mode === 'mixed' ? 1 : 2);
    fireEvent.click(buttons[0]);
    expect(screen.getByText('Detail one')).toBeInTheDocument();
    expect(onExpand).toHaveBeenCalledWith(true, rows[0]);
  });
  it('respects caller expand-column visibility, title, width and controlled expanded keys', () => {
    const props = { ledgerId: 'explicit-details', columns, dataSource: data, pagination: false as const };
    const { container, rerender } = render(<LedgerTable {...props} expandable={{ rowExpandable: () => false, expandedRowRender: () => 'Detail', showExpandColumn: true, columnTitle: 'Caller details', columnWidth: 72 }} />);
    expect(screen.getByRole('columnheader', { name: 'Caller details' })).toBeInTheDocument();
    expect((container.querySelector('colgroup col') as HTMLElement).style.width).toBe('72px');
    rerender(<LedgerTable {...props} expandable={{ expandedRowRender: () => 'Controlled detail', expandedRowKeys: ['one'], showExpandColumn: false }} />);
    expect(container.querySelector('.ant-table-row-expand-icon-cell')).toBeNull();
    expect(screen.getByText('Controlled detail')).toBeInTheDocument();
    rerender(<LedgerTable {...props} dataSource={[]} expandable={{ expandedRowRender: () => 'Detail', showExpandColumn: true, columnTitle: null, columnWidth: 60 }} />);
    expect(container.querySelector('th.ant-table-row-expand-icon-cell')).toBeEmptyDOMElement();
    expect((container.querySelector('colgroup col') as HTMLElement).style.width).toBe('60px');
  });
  it('does not add a detail column to children-based tree tables', () => {
    const { container } = render(<LedgerTable ledgerId="tree-details" columns={columns} dataSource={[{ ...data[0], children: [{ key: 'child', a: 'Child', b: 'Name' }] }]} pagination={false} />);
    expect(container.querySelector('.ant-table-row-expand-icon-cell')).toBeNull();
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    fireEvent.click(container.querySelector('button.ant-table-row-expand-icon')!);
    expect(screen.getByText('Child')).toBeInTheDocument();
  });
  it('preserves custom caller header cells and labels the default detail column in English', () => {
    localStorage.setItem('qms:locale:v1', 'en-US');
    function CallerHeader({ children, ...props }: React.ComponentProps<'th'>) { return <th {...props} data-caller-header="true">{children}</th>; }
    render(<LanguageProvider><LedgerTable ledgerId="custom-header" columns={columns} dataSource={data} pagination={false} components={{ header: { cell: CallerHeader } }} expandable={{ expandedRowRender: () => 'Details content' }} /></LanguageProvider>);
    const details = screen.getByRole('columnheader', { name: 'Details' });
    expect(details).toHaveAttribute('data-caller-header', 'true');
    for (const handle of screen.getAllByRole('separator')) expect(handle.parentElement).toHaveAttribute('data-caller-header', 'true');
  });
  it('reserves popup padding and the scrollbar gutter within narrow viewports without shrinking desktop settings', () => {
    render(<LedgerTable ledgerId="popup-viewport" columns={columns} dataSource={data} pagination={false} />);
    settings();
    const popup = screen.getByRole('spinbutton', { name: '列宽 编号' }).closest('.qms-ledger__settings')!;
    const style = document.createElement('style');
    style.textContent = ledgerCss;
    document.head.append(style);
    try {
      const rule = Array.from(style.sheet!.cssRules).find((candidate): candidate is CSSStyleRule => 'selectorText' in candidate && popup.matches((candidate as CSSStyleRule).selectorText) && Boolean((candidate as CSSStyleRule).style.getPropertyValue('max-width')))!;
      expect(rule.style.getPropertyValue('max-width')).toBe('min(580px, calc(100vw - 64px))');
      for (const viewport of [320, 390]) expect(Math.min(580, viewport - 64) + 24 + 15 + 16).toBeLessThanOrEqual(viewport);
      for (const viewport of [1024, 1440]) expect(Math.min(580, viewport - 64)).toBe(580);
    } finally {
      style.remove();
    }
  });
  it.each(['qms-content', 'qms-console-content'])('keeps table and standalone page-size controls reachable on narrow %s hosts only', host => {
    const { container } = render(<>
      <main className={host}>
        <LedgerTable ledgerId="mobile-pagination" columns={columns} dataSource={data} pagination={{ total: 120, pageSize: 20, showSizeChanger: true }} />
        <Pagination total={120} pageSize={20} showSizeChanger />
      </main>
      <Pagination total={120} pageSize={20} showSizeChanger />
    </>);
    const style = document.createElement('style');
    style.textContent = ledgerCss;
    document.head.append(style);
    try {
      const rules = Array.from(style.sheet!.cssRules);
      const narrow = rules.find(rule => rule.cssText.startsWith('@media (max-width: 576px)')) as CSSMediaRule;
      expect(narrow).toBeDefined();
      const narrowRules = Array.from(narrow.cssRules).filter((rule): rule is CSSStyleRule => 'selectorText' in rule);
      const paginations = Array.from(container.querySelectorAll('main .ant-pagination'));
      expect(paginations).toHaveLength(2);
      for (const pagination of paginations) {
        expect(narrowRules.some(rule => pagination.matches(rule.selectorText) && rule.style.getPropertyValue('flex-wrap') === 'wrap' && rule.style.getPropertyValue('row-gap') === '8px' && rule.style.getPropertyValue('max-width') === '100%')).toBe(true);
        const options = pagination.querySelector('.ant-pagination-options')!;
        expect(options).not.toBeNull();
        expect(narrowRules.some(rule => options.matches(rule.selectorText) && rule.style.getPropertyValue('display') === 'inline-flex' && rule.style.getPropertyValue('margin-inline-start') === '0')).toBe(true);
      }
      const unhosted = container.querySelector(':scope > .ant-pagination')!;
      expect(narrowRules.some(rule => unhosted.matches(rule.selectorText) || unhosted.querySelector('.ant-pagination-options')!.matches(rule.selectorText))).toBe(false);
      expect(rules.filter((rule): rule is CSSStyleRule => 'selectorText' in rule).some(rule => paginations.some(pagination => pagination.matches(rule.selectorText) || pagination.querySelector('.ant-pagination-options')!.matches(rule.selectorText)))).toBe(false);
    } finally {
      style.remove();
    }
  });
  it('keeps plain column titles as exact header names and preserves caller header props', () => {
    const click = vi.fn();
    const caller = vi.fn(() => ({ 'aria-label': '调用方列名', onClick: click, className: 'caller-header', 'data-owner': 'caller' }));
    render(<LedgerTable ledgerId="header-semantics" columns={[columns[0], { ...columns[1], onHeaderCell: caller }, { ...columns[2], onHeaderCell: () => ({ title: '操作说明', 'data-preserved': 'yes' }) }]} dataSource={data} pagination={false} />);
    expect(screen.getByRole('columnheader', { name: '编号' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '操作' })).toHaveAttribute('data-preserved', 'yes');
    const header = screen.getByRole('columnheader', { name: '调用方列名' });
    expect(header).toHaveClass('caller-header');
    expect(header).toHaveAttribute('data-owner', 'caller');
    fireEvent.click(header);
    expect(click).toHaveBeenCalledTimes(1);
    expect(caller).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '移动列 编号' })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: '调整列宽 编号' })).toBeInTheDocument();
  });
  it('locally covers body-mounted column settings with coarse pointer targets without changing fine density', () => {
    const { container } = render(<LedgerTable ledgerId="coarse-settings" columns={columns} dataSource={data} pagination={false} />);
    settings();
    const popup = screen.getByRole('spinbutton', { name: '列宽 编号' }).closest('.qms-ledger__settings')!;
    expect(container).not.toContainElement(popup as HTMLElement);
    expect(popup.closest('.qms-content')).toBeNull();
    const coarse = ledgerCss.match(/@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*)\}\s*$/)?.[1];
    expect(coarse).toBeDefined();
    expect(coarse).toMatch(/\.qms-ledger__tools \.ant-btn[\s\S]*min-height:\s*44px/);
    expect(coarse).toMatch(/\.qms-ledger__settings :is\(\.ant-btn, input\[type='number'\], select, \.ant-checkbox-wrapper\)[\s\S]*min-height:\s*44px/);
    expect(coarse).toMatch(/\.qms-ledger__settings :is\(\.ant-btn, input\[type='number'\], select\)[\s\S]*min-width:\s*44px/);
    expect(coarse).toMatch(/\.qms-ledger__setting\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(popup.querySelectorAll('.ant-btn, input[type="number"], select, .ant-checkbox-wrapper').length).toBeGreaterThan(10);
    expect(ledgerCss.split('@media (pointer: coarse)')[0]).toMatch(/min-height:\s*24px/);
  });
  it('keeps size overrides off the transparent checkbox input and expands its coarse pointer label instead', () => {
    render(<LedgerTable ledgerId="checkbox-target" columns={columns} dataSource={data} pagination={false} />);
    settings();
    const checkbox = screen.getByRole('checkbox', { name: '显示 编号' });
    const label = checkbox.closest('.ant-checkbox-wrapper')!;
    const style = document.createElement('style');
    style.textContent = ledgerCss;
    document.head.append(style);
    try {
      const rules = Array.from(style.sheet!.cssRules);
      const coarse = rules.find(rule => rule.cssText.startsWith('@media (pointer: coarse)')) as CSSMediaRule;
      expect(coarse).toBeDefined();
      const sizeRules = [...rules, ...Array.from(coarse.cssRules)].filter((rule): rule is CSSStyleRule => 'selectorText' in rule)
        .filter(rule => ['width', 'height', 'min-width', 'min-height'].some(property => rule.style.getPropertyValue(property)));
      expect(sizeRules.filter(rule => checkbox.matches(rule.selectorText)).map(rule => rule.selectorText)).toEqual([]);
      expect(sizeRules.some(rule => label.matches(rule.selectorText) && rule.style.getPropertyValue('min-height') === '44px')).toBe(true);
    } finally {
      style.remove();
    }
  });
  it('settings hide permitted columns, keep required actions and preserve business selection', () => {
    const onChange = vi.fn();
    render(<LedgerTable ledgerId="basic" columns={columns} dataSource={data} requiredColumnKeys={['action']} pagination={false} rowSelection={{ selectedRowKeys: ['one'], onChange }} />);
    settings();
    fireEvent.click(screen.getByRole('checkbox', { name: '显示 名称' }));
    expect(screen.queryByRole('columnheader', { name: /名称/ })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '显示 操作' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(within(screen.getByRole('table')).getAllByRole('checkbox').at(-1)).toBeChecked();
  });
  it('supports numeric width, pinning, moving, single and all resets without touching page size', () => {
    render(<LedgerTable ledgerId="controls" columns={columns} dataSource={data} pagination={false} />);
    settings();
    fireEvent.change(screen.getByRole('spinbutton', { name: '列宽 编号' }), { target: { value: '300' } });
    fireEvent.blur(screen.getByRole('spinbutton', { name: '列宽 编号' }));
    expect(screen.getByRole('separator', { name: '调整列宽 编号' })).toHaveAttribute('aria-valuenow', '300');
    fireEvent.change(screen.getByRole('combobox', { name: '固定 编号' }), { target: { value: 'left' } });
    expect(screen.getByRole('columnheader', { name: /编号/ })).toHaveClass('ant-table-cell-fix-start');
    fireEvent.click(screen.getByRole('button', { name: '恢复 编号' }));
    expect(screen.getByRole('separator', { name: '调整列宽 编号' })).toHaveAttribute('aria-valuenow', '180');
    fireEvent.click(screen.getByRole('button', { name: '下移 编号' }));
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('名称');
    fireEvent.click(screen.getByRole('button', { name: '恢复全部列' }));
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('编号');
  });
  it('keyboard resizing and double click reset do not sort; pointer cancel restores and only completion saves', () => {
    const sort = vi.fn();
    render(<LedgerTable ledgerId="resize" columns={[{ ...columns[0], sorter: true }]} dataSource={data} pagination={false} onChange={sort} />);
    const separator = screen.getByRole('separator', { name: '调整列宽 编号' });
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '190');
    fireEvent.doubleClick(separator);
    expect(separator).toHaveAttribute('aria-valuenow', '180');
    const write = vi.spyOn(Storage.prototype, 'setItem');
    fireEvent.pointerDown(separator, { clientX: 10, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 60, pointerId: 1 });
    expect(separator).toHaveAttribute('aria-valuenow', '230');
    expect(write).not.toHaveBeenCalled();
    fireEvent.pointerCancel(separator, { pointerId: 1 });
    expect(separator).toHaveAttribute('aria-valuenow', '180');
    fireEvent.pointerDown(separator, { clientX: 10, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 60, pointerId: 1 });
    fireEvent.pointerUp(separator, { clientX: 60, pointerId: 1 });
    expect(separator).toHaveAttribute('aria-valuenow', '230');
    expect(write).toHaveBeenCalled();
    expect(sort).not.toHaveBeenCalled();
    write.mockRestore();
  });
  it('allows typing the complete width before blur or Enter commits', async () => {
    const user = userEvent.setup();
    render(<LedgerTable ledgerId="typed-width" columns={columns} dataSource={data} pagination={false} />);
    settings();
    const input = screen.getByRole('spinbutton', { name: '列宽 编号' });
    const write = vi.spyOn(Storage.prototype, 'setItem');
    await user.clear(input); await user.type(input, '320');
    expect(input).toHaveValue(320);
    expect(screen.getByRole('separator', { name: '调整列宽 编号' })).toHaveAttribute('aria-valuenow', '180');
    expect(write).not.toHaveBeenCalled();
    await user.tab();
    expect(screen.getByRole('separator', { name: '调整列宽 编号' })).toHaveAttribute('aria-valuenow', '320');
    await user.clear(input); await user.type(input, '250{Enter}');
    expect(screen.getByRole('separator', { name: '调整列宽 编号' })).toHaveAttribute('aria-valuenow', '250');
  });
  it('lost pointer capture cancels pending width without saving', () => {
    render(<LedgerTable ledgerId="capture-loss" columns={columns} dataSource={data} pagination={false} />);
    const separator = screen.getByRole('separator', { name: '调整列宽 编号' });
    const write = vi.spyOn(Storage.prototype, 'setItem');
    fireEvent.pointerDown(separator, { clientX: 10, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 60, pointerId: 1 });
    expect(separator).toHaveAttribute('aria-valuenow', '230');
    fireEvent.lostPointerCapture(separator, { pointerId: 1 });
    expect(separator).toHaveAttribute('aria-valuenow', '180');
    fireEvent.pointerUp(separator, { clientX: 60, pointerId: 1 });
    expect(write).not.toHaveBeenCalled();
  });
  it('applies each column minimum to cached widths, keyboard, typed and pointer changes', () => {
    const key = preferenceKey({ sessionScope: 'INTERNAL:home:user', portal: 'business' }, 'minimum', 'columns')!;
    localStorage.setItem(key, JSON.stringify({ schema: 1, value: { order: ['a'], visible: ['a'], widths: { a: 80 }, fixed: {} } }));
    render(<LedgerTable ledgerId="minimum" columns={[{ ...columns[0], minWidth: 260 }]} dataSource={data} pagination={false} />);
    const separator = screen.getByRole('separator', { name: '调整列宽 编号' });
    expect(separator).toHaveAttribute('aria-valuenow', '260');
    expect(separator).toHaveAttribute('aria-valuemin', '260');
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator).toHaveAttribute('aria-valuenow', '260');
    settings();
    const input = screen.getByRole('spinbutton', { name: '列宽 编号' });
    fireEvent.change(input, { target: { value: '100' } }); fireEvent.blur(input);
    expect(separator).toHaveAttribute('aria-valuenow', '260');
    fireEvent.pointerDown(separator, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 0, pointerId: 1 });
    fireEvent.pointerUp(separator, { clientX: 0, pointerId: 1 });
    expect(separator).toHaveAttribute('aria-valuenow', '260');
    fireEvent.doubleClick(separator);
    expect(separator).toHaveAttribute('aria-valuenow', '260');
  });
  it('header drag has an independent handle and commits order only on pointer completion', () => {
    render(<LedgerTable ledgerId="header-drag" columns={columns} dataSource={data} pagination={false} />);
    const grip = screen.getByRole('button', { name: '移动列 编号' });
    const target = screen.getByRole('columnheader', { name: /名称/ }).querySelector('[data-ledger-column]')!;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
    fireEvent.pointerDown(grip, { clientX: 10, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientX: 250, pointerId: 1 });
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('编号');
    expect(target).toHaveClass('qms-ledger__heading--drop');
    fireEvent.pointerCancel(grip, { pointerId: 1 });
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('编号');
    fireEvent.pointerDown(grip, { clientX: 10, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientX: 250, pointerId: 1 });
    fireEvent.pointerUp(grip, { clientX: 250, pointerId: 1 });
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('名称');
    Reflect.deleteProperty(document, 'elementFromPoint');
  });
  it('scope changes during a width drag cannot write old preferences into the new target', () => {
    const props = { ledgerId: 'drag-scope', columns, dataSource: data, pagination: false as const };
    const { rerender } = render(<LedgerTable {...props} organizationId="target-a" />);
    const separator = screen.getByRole('separator', { name: '调整列宽 编号' });
    fireEvent.pointerDown(separator, { clientX: 10, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 60, pointerId: 1 });
    rerender(<LedgerTable {...props} organizationId="target-b" />);
    expect(screen.getByRole('separator', { name: '调整列宽 编号' })).toHaveAttribute('aria-valuenow', '180');
    fireEvent.pointerUp(separator, { clientX: 60, pointerId: 1 });
    expect(Object.keys(localStorage).filter(key => key.startsWith('qms:ledger:'))).toEqual([]);
  });
  it('batched session ABA cancels old width dragging and permits a new epoch drag', () => {
    render(<LedgerTable ledgerId="width-drag-aba" columns={columns} dataSource={data} pagination={false} />);
    const separator = screen.getByRole('separator', { name: '调整列宽 编号' });
    const write = vi.spyOn(Storage.prototype, 'setItem');
    fireEvent.pointerDown(separator, { clientX: 10, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 60, pointerId: 1 });
    expect(separator).toHaveAttribute('aria-valuenow', '230');
    act(() => {
      useWorkTabsStore.getState().bindSession('INTERNAL:home:other');
      useWorkTabsStore.getState().bindSession('INTERNAL:home:user');
    });
    expect(separator).toHaveAttribute('aria-valuenow', '180');
    fireEvent.pointerUp(separator, { clientX: 60, pointerId: 1 });
    expect(separator).toHaveAttribute('aria-valuenow', '180');
    expect(write.mock.calls.filter(([key]) => key.startsWith('qms:ledger:'))).toHaveLength(0);
    fireEvent.pointerDown(separator, { clientX: 10, pointerId: 2 });
    fireEvent.pointerMove(separator, { clientX: 80, pointerId: 2 });
    fireEvent.pointerUp(separator, { clientX: 80, pointerId: 2 });
    expect(separator).toHaveAttribute('aria-valuenow', '250');
    expect(write.mock.calls.filter(([key]) => key.startsWith('qms:ledger:'))).toHaveLength(1);
  });
  it('batched session ABA cancels old controlled column dragging and permits a new epoch drag', () => {
    const onColumnOrderChange = vi.fn();
    render(<LedgerTable ledgerId="order-drag-aba" columns={columns} columnOrder={['a', 'b', 'action']} onColumnOrderChange={onColumnOrderChange} dataSource={data} pagination={false} />);
    const grip = screen.getByRole('button', { name: '移动列 编号' });
    const target = screen.getByRole('columnheader', { name: /名称/ }).querySelector('[data-ledger-column]')!;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
    try {
      fireEvent.pointerDown(grip, { clientX: 10, pointerId: 1 });
      fireEvent.pointerMove(grip, { clientX: 250, pointerId: 1 });
      expect(target).toHaveClass('qms-ledger__heading--drop');
      act(() => {
        useWorkTabsStore.getState().bindSession('INTERNAL:home:other');
        useWorkTabsStore.getState().bindSession('INTERNAL:home:user');
      });
      expect(target).not.toHaveClass('qms-ledger__heading--drop');
      fireEvent.pointerUp(grip, { clientX: 250, pointerId: 1 });
      expect(onColumnOrderChange).not.toHaveBeenCalled();
      expect(Object.keys(localStorage).filter(key => key.startsWith('qms:ledger:'))).toHaveLength(0);
      fireEvent.pointerDown(grip, { clientX: 10, pointerId: 2 });
      fireEvent.pointerMove(grip, { clientX: 250, pointerId: 2 });
      fireEvent.pointerUp(grip, { clientX: 250, pointerId: 2 });
      expect(onColumnOrderChange).toHaveBeenCalledExactlyOnceWith(['b', 'a', 'action']);
    } finally { Reflect.deleteProperty(document, 'elementFromPoint'); }
  });
  it('does not allow pinning a later column across the required first column', () => {
    render(<LedgerTable ledgerId="pin-lock" columns={columns} requiredColumnKeys={['a']} dataSource={data} pagination={false} />);
    settings();
    const pin = screen.getByRole('combobox', { name: '固定 名称' });
    expect(within(pin).getByRole('option', { name: '左侧' })).toBeDisabled();
    fireEvent.change(pin, { target: { value: 'left' } });
    expect(pin).toHaveValue('');
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('编号');
    expect(screen.getByRole('columnheader', { name: /名称/ })).not.toHaveClass('ant-table-cell-fix-start');
  });
  it('ignores cached pinning that moves required columns or crosses their default positions', () => {
    const key = preferenceKey({ sessionScope: 'INTERNAL:home:user', portal: 'business' }, 'cached-pin-lock', 'columns')!;
    localStorage.setItem(key, JSON.stringify({ schema: 1, value: { order: ['a', 'b', 'action'], visible: ['a', 'b', 'action'], widths: {}, fixed: { a: 'right', b: 'left' } } }));
    render(<LedgerTable ledgerId="cached-pin-lock" columns={columns} requiredColumnKeys={['a']} dataSource={data} pagination={false} />);
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('编号');
    expect(screen.getByRole('columnheader', { name: /编号/ })).not.toHaveClass('ant-table-cell-fix-end');
    expect(screen.getByRole('columnheader', { name: /名称/ })).not.toHaveClass('ant-table-cell-fix-start');
    settings();
    expect(screen.getByRole('combobox', { name: '固定 编号' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: '固定 名称' })).toHaveValue('');
  });
  it('controlled view visibility and order always beat cached values, and permission loss cannot revive columns', () => {
    const props = { ledgerId: 'controlled', columns, dataSource: data, pagination: false as const };
    const { rerender } = render(<LedgerTable {...props} />);
    settings();
    fireEvent.click(screen.getByRole('checkbox', { name: '显示 名称' }));
    const onVisibleColumnKeysChange = vi.fn();
    rerender(<LedgerTable {...props} visibleColumnKeys={['b', 'a']} columnOrder={['b', 'a']} onVisibleColumnKeysChange={onVisibleColumnKeysChange} />);
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('名称');
    fireEvent.click(screen.getByRole('checkbox', { name: '显示 名称' }));
    expect(onVisibleColumnKeysChange).toHaveBeenCalledWith(['a']);
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('名称');
    rerender(<LedgerTable {...props} columns={[columns[0]]} visibleColumnKeys={['b', 'a']} />);
    expect(screen.queryByRole('columnheader', { name: /名称/ })).not.toBeInTheDocument();
  });
  it('separates views and safely handles groups, missing or duplicate keys and empty columns', () => {
    const { rerender } = render(<LedgerTable ledgerId="views" viewId="a" columns={columns} dataSource={data} pagination={false} />);
    settings(); fireEvent.change(screen.getByRole('spinbutton', { name: '列宽 编号' }), { target: { value: '350' } }); fireEvent.blur(screen.getByRole('spinbutton', { name: '列宽 编号' }));
    rerender(<LedgerTable ledgerId="views" viewId="b" columns={columns} dataSource={data} pagination={false} />);
    expect(screen.getByRole('separator', { name: '调整列宽 编号' })).toHaveAttribute('aria-valuenow', '180');
    rerender(<LedgerTable ledgerId="views" columns={[{ title: '分组', children: [columns[0], columns[1]] }, { title: '无标识', render: () => 'plain' }]} dataSource={data} pagination={false} />);
    expect(screen.getByRole('columnheader', { name: '无标识' })).toBeInTheDocument();
    expect(screen.queryByRole('separator', { name: '调整列宽 无标识' })).not.toBeInTheDocument();
    rerender(<LedgerTable ledgerId="empty" columns={[]} dataSource={[]} pagination={false} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '列设置' })).toBeDisabled();
  });
});
