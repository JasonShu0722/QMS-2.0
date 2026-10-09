import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { FeedbackButton } from './FeedbackButton';

const storageKey = 'qms:feedback-position:v1';
const formUrl = 'https://larkcommunity.feishu.cn/share/base/form/shrcnH6p2El6MXjv9WXHeUYibue';

// jsdom lacks PointerEvent; retain mouse coordinates and the pointer identity used by browsers.
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
    this.isPrimary = init.isPrimary ?? true;
  }
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.spyOn(window, 'open').mockReturnValue(null);
  vi.stubGlobal('innerWidth', 1000);
  vi.stubGlobal('innerHeight', 800);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount() {
  render(<LanguageProvider><FeedbackButton /></LanguageProvider>);
  const button = screen.getByRole('button', { name: '需求反馈' });
  let captured: number | undefined;
  button.setPointerCapture = vi.fn(id => { captured = id; });
  button.hasPointerCapture = vi.fn(id => captured === id);
  button.releasePointerCapture = vi.fn(() => { captured = undefined; });
  return button;
}

function pointer(button: HTMLElement, type: string, x: number, y: number, pointerType = 'mouse', pointerId = 1) {
  fireEvent(button, new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerType, pointerId, button: 0 }));
}

function drag(button: HTMLElement, dx: number, dy: number, pointerType = 'mouse') {
  const x = Number.parseFloat(button.style.left) + 24;
  const y = Number.parseFloat(button.style.top) + 24;
  pointer(button, 'pointerdown', x, y, pointerType);
  pointer(button, 'pointermove', x + dx, y + dy, pointerType);
  pointer(button, 'pointerup', x + dx, y + dy, pointerType);
  fireEvent.click(button, { detail: 1 });
}

describe('shared feedback button', () => {
  it('starts at the bottom right with a discoverable accessible label', () => {
    const button = mount();
    expect(button).toHaveAttribute('title', '需求反馈');
    expect(button).toHaveAttribute('type', 'button');
    expect(button.style.left).toBe('936px');
    expect(button.style.top).toBe('736px');
  });

  it('uses the shared English label', () => {
    localStorage.setItem('qms:locale:v1', 'en-US');
    render(<LanguageProvider><FeedbackButton /></LanguageProvider>);
    expect(screen.getByRole('button', { name: 'Requirement feedback' })).toHaveAttribute('title', 'Requirement feedback');
  });

  it('opens a tap in an isolated window without changing the current page', () => {
    const button = mount();
    const currentUrl = window.location.href;
    pointer(button, 'pointerdown', 950, 750);
    pointer(button, 'pointerup', 950, 750);
    fireEvent.click(button, { detail: 1 });
    expect(window.open).toHaveBeenCalledExactlyOnceWith(formUrl, '_blank', 'noopener,noreferrer');
    expect(window.location.href).toBe(currentUrl);
  });

  it('keeps an exact five-pixel movement as a tap', () => {
    const button = mount();
    drag(button, -3, -4);
    expect(window.open).toHaveBeenCalledTimes(1);
  });

  it.each(['mouse', 'touch'])('does not open after ten consecutive %s drags', pointerType => {
    const button = mount();
    for (let i = 0; i < 10; i++) drag(button, -6, -8, pointerType);
    expect(window.open).not.toHaveBeenCalled();
    expect(button.releasePointerCapture).toHaveBeenCalledTimes(10);
    pointer(button, 'pointerdown', 950, 600, pointerType);
    pointer(button, 'pointerup', 950, 600, pointerType);
    fireEvent.click(button, { detail: 1 });
    expect(window.open).toHaveBeenCalledTimes(1);
  });

  it.each(['{Enter}', ' '])('opens with %s after a drag', async key => {
    const button = mount();
    drag(button, -20, -20);
    button.focus();
    await userEvent.keyboard(key);
    expect(window.open).toHaveBeenCalledExactlyOnceWith(formUrl, '_blank', 'noopener,noreferrer');
  });

  it('snaps to the nearest horizontal edge and remembers only bounded positioning', () => {
    const button = mount();
    drag(button, -800, -200);
    expect(button.style.left).toBe('16px');
    expect(button.style.top).toBe('536px');
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({ side: 'left', y: 536 });
    drag(button, 800, -100);
    expect(button.style.left).toBe('936px');
    expect(button.style.top).toBe('436px');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('bounds dragging vertically and corrects remembered positioning on resize', () => {
    const button = mount();
    drag(button, 0, -2000);
    expect(button.style.top).toBe('16px');
    drag(button, 0, 2000);
    expect(button.style.top).toBe('736px');
    vi.stubGlobal('innerWidth', 320);
    vi.stubGlobal('innerHeight', 480);
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(button.style.left).toBe('256px');
    expect(button.style.top).toBe('416px');
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({ side: 'right', y: 416 });
  });

  it('restores the saved edge and clamps a finite coordinate', () => {
    localStorage.setItem(storageKey, JSON.stringify({ side: 'left', y: 9000 }));
    const button = mount();
    expect(button.style.left).toBe('16px');
    expect(button.style.top).toBe('736px');
  });

  it.each(['{broken', 'null', '{"side":"left","y":"30"}', '{"side":"middle","y":30}', '{"side":"left","y":1e999}'])('recovers malformed storage: %s', saved => {
    localStorage.setItem(storageKey, saved);
    const button = mount();
    expect(button.style.left).toBe('936px');
    expect(button.style.top).toBe('736px');
  });

  it('still drags and opens when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const button = mount();
    drag(button, -800, -100);
    expect(button.style.left).toBe('16px');
    fireEvent.click(button, { detail: 0 });
    expect(window.open).toHaveBeenCalledTimes(1);
  });

  it.each(['pointercancel', 'lostpointercapture'])('ends %s without leaving future interactions blocked', eventType => {
    const button = mount();
    pointer(button, 'pointerdown', 950, 750);
    pointer(button, 'pointermove', 150, 600);
    const hasPointerCapture = button.hasPointerCapture;
    if (eventType === 'lostpointercapture') button.hasPointerCapture = vi.fn(() => false);
    pointer(button, eventType, 150, 600);
    if (eventType === 'lostpointercapture') expect(button.releasePointerCapture).not.toHaveBeenCalled();
    else expect(button.releasePointerCapture).toHaveBeenCalledWith(1);
    button.hasPointerCapture = hasPointerCapture;
    fireEvent.click(button, { detail: 1 });
    expect(window.open).not.toHaveBeenCalled();
    pointer(button, 'pointermove', 900, 700);
    expect(button.style.left).toBe('16px');
    pointer(button, 'pointerdown', 40, 624);
    pointer(button, 'pointerup', 40, 624);
    fireEvent.click(button, { detail: 1 });
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(button.releasePointerCapture).toHaveBeenCalled();
  });

  it('ignores other pointers during a captured gesture', () => {
    const button = mount();
    pointer(button, 'pointerdown', 950, 750);
    pointer(button, 'pointermove', 100, 100, 'touch', 2);
    pointer(button, 'pointerup', 100, 100, 'touch', 2);
    expect(button.style.left).toBe('936px');
    pointer(button, 'pointerup', 950, 750);
    fireEvent.click(button, { detail: 1 });
    expect(window.open).toHaveBeenCalledTimes(1);
  });
});
