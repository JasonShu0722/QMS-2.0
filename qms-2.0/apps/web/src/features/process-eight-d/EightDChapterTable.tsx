import { useRef, useState, type ReactNode } from 'react';
import { useEightDText } from './eight-d';
import styles from './eight-d.module.css';

type Props = {
  title: string;
  columns: string[];
  className: string;
  resizable: boolean;
  minimums?: number[];
  children: ReactNode;
};

export function EightDChapterTable({ title, columns, className, resizable, minimums, children }: Props) {
  const text = useEightDText();
  const headers = useRef<HTMLTableRowElement>(null);
  const [widths, setWidths] = useState<number[]>();
  const drag = useRef<{ pointerId: number; startX: number; widths: number[] }>(undefined);
  const minimum = (index: number) => minimums?.[index] ?? 120;
  const currentWidths = () => widths ?? Array.from(headers.current?.cells ?? [], (cell, index) =>
    Math.max(minimum(index), Math.round(cell.getBoundingClientRect().width)));
  const resize = (index: number, next: number[], delta: number) => {
    setWidths(next.map((width, column) => column === index ? Math.max(minimum(index), width + delta) : width));
  };

  return <div className={className} role="region" aria-label={title} tabIndex={0}>
    <table className={`${styles.table} ${styles.entryTable}${resizable ? ` ${styles.resizableTable}` : ''}`}
      style={widths && { tableLayout: 'fixed', width: widths.reduce((total, width) => total + width, 1) }}>
      {widths && <colgroup>{widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>}
      <thead><tr ref={headers}>{columns.map((name, index) => <th key={name} scope="col">
        {name}
        {resizable && <span role="separator" tabIndex={0} aria-orientation="vertical" className={styles.columnResize}
          title={`${text('调整列宽', 'Resize column')} ${name}`} aria-valuemin={minimum(index)} aria-valuenow={widths?.[index]}
          onPointerDown={event => {
            if (event.button !== 0 || drag.current) return;
            event.currentTarget.focus();
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { pointerId: event.pointerId, startX: event.clientX, widths: currentWidths() };
          }}
          onPointerMove={event => {
            const active = drag.current;
            if (active?.pointerId === event.pointerId) resize(index, active.widths, event.clientX - active.startX);
          }}
          onPointerUp={event => {
            const active = drag.current;
            if (active?.pointerId === event.pointerId && event.clientX !== active.startX) resize(index, active.widths, event.clientX - active.startX);
          }}
          onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) drag.current = undefined; }}
          onKeyDown={event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            resize(index, currentWidths(), event.key === 'ArrowLeft' ? -10 : 10);
          }} />}
      </th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>;
}
