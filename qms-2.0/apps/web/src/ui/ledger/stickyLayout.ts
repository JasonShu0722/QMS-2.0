import { useLayoutEffect, type RefObject } from 'react';

const minimumBodyHeight = 120;

export function useLedgerStickyLayout(rootRef: RefObject<HTMLDivElement | null>, enabled: boolean, hasActionBar: boolean, showHeader: boolean) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;
    const actionBar = root.querySelector<HTMLElement>(':scope > .qms-ledger__action-bar');
    const tools = root.querySelector<HTMLElement>(':scope > .qms-ledger__tools');
    const spin = root.querySelector(':scope > .ant-table-wrapper > .ant-spin > .ant-spin-container');
    const container = spin?.querySelector(':scope > .ant-table > .ant-table-container');
    const header = container?.querySelector(':scope > .ant-table-header');
    const body = container?.querySelector<HTMLElement>(':scope > .ant-table-body');
    const headerTable = header?.querySelector(':scope > table');
    const bodyTable = body?.querySelector(':scope > table');
    const semanticNodes = new Map<Element, string | null>();
    function setRole(element: Element, role: string) {
      if (!semanticNodes.has(element)) semanticNodes.set(element, element.getAttribute('role'));
      element.setAttribute('role', role);
    }
    function associateTable() {
      if (!container || !headerTable || !bodyTable) return;
      for (const element of semanticNodes.keys()) if (!container.contains(element)) semanticNodes.delete(element);
      setRole(container, 'table');
      for (const table of [headerTable, bodyTable]) {
        setRole(table, 'presentation');
        for (const group of table.querySelectorAll(':scope > thead, :scope > tbody')) {
          setRole(group, 'rowgroup');
          for (const row of group.querySelectorAll(':scope > tr:not([aria-hidden="true"])')) {
            setRole(row, 'row');
            for (const cell of row.querySelectorAll(':scope > th, :scope > td')) {
              setRole(cell, group.tagName === 'THEAD' ? 'columnheader' : cell.tagName === 'TH' ? 'rowheader' : 'cell');
            }
          }
        }
      }
    }
    const semanticsObserver = new MutationObserver(records => {
      if (records.some(({ target }) => target === headerTable || target === bodyTable || target.parentNode === headerTable || target.parentNode === bodyTable || target.parentNode?.parentNode === headerTable || target.parentNode?.parentNode === bodyTable)) associateTable();
    });
    if (headerTable && bodyTable) {
      associateTable();
      semanticsObserver.observe(headerTable, { childList: true, subtree: true });
      semanticsObserver.observe(bodyTable, { childList: true, subtree: true });
    }
    const document = root.ownerDocument;
    const window = document.defaultView;
    const viewport = window?.visualViewport;
    let pager: Element | null = null;
    const height = (element: Element | null | undefined) => element?.getBoundingClientRect().height ?? 0;

    function measure() {
      if (!root) return;
      const nextPager = spin?.querySelector(':scope > .ant-table-pagination:first-child + .ant-table')?.previousElementSibling ?? null;
      if (pager !== nextPager) {
        if (pager) observer?.unobserve(pager);
        if (nextPager) observer?.observe(nextPager);
        pager = nextPager;
      }
      const actionHeight = height(actionBar);
      const toolsHeight = height(tools);
      const pagerHeight = height(nextPager);
      const gridTools = tools && getComputedStyle(tools);
      const sharedGrid = nextPager && gridTools?.gridColumnStart === '2';
      const pagerFirst = sharedGrid && gridTools.gridRowStart !== getComputedStyle(nextPager).gridRowStart;
      const headerTop = actionHeight + (sharedGrid && !pagerFirst ? Math.max(toolsHeight, pagerHeight) : toolsHeight + pagerHeight);
      const stackHeight = headerTop + height(header);
      root.style.setProperty('--qms-ledger-tools-top', `${actionHeight + (pagerFirst ? pagerHeight : 0)}px`);
      root.style.setProperty('--qms-ledger-pagination-top', `${actionHeight + (sharedGrid ? 0 : toolsHeight)}px`);
      root.style.setProperty('--qms-ledger-header-top', `${headerTop}px`);
      root.style.setProperty('--qms-ledger-stack-height', `${stackHeight}px`);
      root.toggleAttribute('data-ledger-sticky-flow', stackHeight + minimumBodyHeight > (viewport?.height ?? document.documentElement.clientHeight));
      if (body && body.scrollWidth > body.clientWidth) body.tabIndex = 0;
      else body?.removeAttribute('tabindex');
    }

    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    for (const element of [root, actionBar, tools, header, body, body?.firstElementChild]) {
      if (element) observer?.observe(element);
    }
    const paginationObserver = new MutationObserver(measure);
    if (spin) paginationObserver.observe(spin, { childList: true });
    function revealFocus(event: FocusEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !header || root?.hasAttribute('data-ledger-sticky-flow')) return;
      const heading = header.getBoundingClientRect();
      const focused = target.getBoundingClientRect();
      if (heading.top >= 0 && focused.top < heading.bottom && focused.bottom > 0 && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      }
    }
    body?.addEventListener('focusin', revealFocus);
    const resizeTarget = viewport ?? window;
    resizeTarget?.addEventListener('resize', measure);
    measure();
    return () => {
      observer?.disconnect();
      paginationObserver.disconnect();
      body?.removeEventListener('focusin', revealFocus);
      resizeTarget?.removeEventListener('resize', measure);
      body?.removeAttribute('tabindex');
      semanticsObserver.disconnect();
      for (const [element, role] of semanticNodes) {
        if (role == null) element.removeAttribute('role');
        else element.setAttribute('role', role);
      }
      root.removeAttribute('data-ledger-sticky-flow');
      root.style.removeProperty('--qms-ledger-tools-top');
      root.style.removeProperty('--qms-ledger-pagination-top');
      root.style.removeProperty('--qms-ledger-header-top');
      root.style.removeProperty('--qms-ledger-stack-height');
    };
  }, [rootRef, enabled, hasActionBar, showHeader]);
}
