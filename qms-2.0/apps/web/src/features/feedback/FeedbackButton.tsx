import { MessageSquarePlus } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useLanguage } from '../../i18n/Language';
import { FEEDBACK_FORM_URL } from './feedback-config';
import './FeedbackButton.css';

const size = 48;
const safeMargin = 16;
const storageKey = 'qms:feedback-position:v1';
type Point = { x: number; y: number };
type Side = 'left' | 'right';

function bounds(dimension: number) {
  const margin = Math.min(safeMargin, Math.max(0, (dimension - size) / 2));
  return { min: margin, max: Math.max(margin, dimension - size - margin) };
}

function boundedY(y: number) {
  const { min, max } = bounds(window.innerHeight);
  return Math.min(max, Math.max(min, y));
}

function edgePosition(side: Side, y: number): Point {
  const { min, max } = bounds(window.innerWidth);
  return { x: side === 'left' ? min : max, y: boundedY(y) };
}

function readPosition(): { side: Side; point: Point } {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (saved && typeof saved === 'object' && 'side' in saved && 'y' in saved &&
      (saved.side === 'left' || saved.side === 'right') && typeof saved.y === 'number' && Number.isFinite(saved.y)) {
      return { side: saved.side, point: edgePosition(saved.side, saved.y) };
    }
  } catch {}
  return { side: 'right', point: edgePosition('right', window.innerHeight) };
}

export function FeedbackButton() {
  const { t } = useLanguage();
  const [initial] = useState(readPosition);
  const [position, setPosition] = useState(initial.point);
  const point = useRef(position);
  const side = useRef(initial.side);
  const gesture = useRef<{ pointerId: number; startX: number; startY: number; origin: Point; dragged: boolean } | null>(null);
  const suppressPointerClick = useRef(false);

  function updatePosition(next: Point) {
    point.current = next;
    setPosition(next);
  }

  function settle(nextSide: Side) {
    side.current = nextSide;
    const next = edgePosition(nextSide, point.current.y);
    updatePosition(next);
    try { localStorage.setItem(storageKey, JSON.stringify({ side: nextSide, y: next.y })); } catch {}
  }

  useEffect(() => {
    const resize = () => {
      const next = edgePosition(side.current, point.current.y);
      point.current = next;
      setPosition(next);
      try { localStorage.setItem(storageKey, JSON.stringify({ side: side.current, y: next.y })); } catch {}
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  function move(event: PointerEvent<HTMLButtonElement>) {
    const active = gesture.current;
    if (!active || event.pointerId !== active.pointerId) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (Math.hypot(dx, dy) > 5) active.dragged = true;
    if (!active.dragged) return;
    const { min, max } = bounds(window.innerWidth);
    updatePosition({ x: Math.min(max, Math.max(min, active.origin.x + dx)), y: boundedY(active.origin.y + dy) });
  }

  function finish(event: PointerEvent<HTMLButtonElement>) {
    const active = gesture.current;
    if (!active || event.pointerId !== active.pointerId) return;
    if (event.type === 'pointerup') move(event);
    suppressPointerClick.current = active.dragged || event.type !== 'pointerup';
    gesture.current = null;
    settle(point.current.x + size / 2 < window.innerWidth / 2 ? 'left' : 'right');
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <button
    type="button"
    className="qms-feedback-button"
    title={t('需求反馈')}
    aria-label={t('需求反馈')}
    style={{ left: position.x, top: position.y }}
    onPointerDown={event => {
      if (gesture.current || !event.isPrimary || event.button !== 0) return;
      suppressPointerClick.current = false;
      gesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: point.current, dragged: false };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }}
    onPointerMove={move}
    onPointerUp={finish}
    onPointerCancel={finish}
    onLostPointerCapture={finish}
    onClick={event => {
      if (event.detail !== 0 && suppressPointerClick.current) return;
      window.open(FEEDBACK_FORM_URL, '_blank', 'noopener,noreferrer');
    }}
  ><MessageSquarePlus size={22} aria-hidden="true" /></button>;
}
