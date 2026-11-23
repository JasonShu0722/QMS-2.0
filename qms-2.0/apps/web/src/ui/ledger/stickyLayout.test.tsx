import { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useLedgerStickyLayout } from './stickyLayout';

function LedgerFixture({ pinned = true }: { pinned?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useLedgerStickyLayout(rootRef, true, false, true, pinned);
  return <div ref={rootRef} className="qms-ledger qms-ledger--sticky">
    <div className="ant-table-wrapper"><div className="ant-spin"><div className="ant-spin-container">
      <div className="ant-table"><div className="ant-table-container">
        <div className="ant-table-header"><table><thead><tr><th>Defect</th></tr></thead></table></div>
        <div className="ant-table-body"><table><tbody><tr><td>One defect</td></tr></tbody></table></div>
      </div></div>
    </div></div></div>
    {pinned && <input type="range" className="qms-ledger__horizontal-scroll" aria-label="Scroll table horizontally" hidden />}
  </div>;
}

it('offers a single control for an overflowing one-row ledger and follows native table scrolling', () => {
  const { container } = render(<LedgerFixture />);
  const body = container.querySelector<HTMLElement>('.ant-table-body')!;
  let tableWidth = 400;
  Object.defineProperties(body, {
    clientWidth: { get: () => 400 },
    scrollWidth: { get: () => tableWidth },
  });
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();

  tableWidth = 1100;
  act(() => window.dispatchEvent(new Event('resize')));
  const range = screen.getByRole<HTMLInputElement>('slider', { name: 'Scroll table horizontally' });
  expect(range.max).toBe('700');
  expect(range.valueAsNumber).toBe(0);

  fireEvent.input(range, { target: { value: '460' } });
  expect(body.scrollLeft).toBe(460);

  body.scrollLeft = 210;
  fireEvent.scroll(body);
  expect(range.valueAsNumber).toBe(210);

  tableWidth = 900;
  act(() => window.dispatchEvent(new Event('resize')));
  expect(range.max).toBe('500');
  expect(range.valueAsNumber).toBe(210);

  tableWidth = 400;
  act(() => window.dispatchEvent(new Event('resize')));
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
});

it('does not offer a pinned control to non-opted-in ledgers', () => {
  const { container } = render(<LedgerFixture pinned={false} />);
  const body = container.querySelector<HTMLElement>('.ant-table-body')!;
  Object.defineProperties(body, {
    clientWidth: { value: 400 },
    scrollWidth: { value: 1100 },
  });
  act(() => window.dispatchEvent(new Event('resize')));
  expect(body).toHaveAttribute('tabindex', '0');
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
});
