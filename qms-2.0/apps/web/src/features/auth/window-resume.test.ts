import { afterEach, expect, it, vi } from 'vitest';
import { publishSessionSignal, subscribeSessionSignals, subscribeWindowResume } from './session-invalidation';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('coalesces visible and focus locally without notifying safety-only subscribers', () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const resume = vi.fn(); const safety = vi.fn();
  const stopResume = subscribeWindowResume(resume); const stopSafety = subscribeSessionSignals(safety);
  try {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(resume).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(resume).toHaveBeenCalledOnce(); expect(safety).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('focus')); vi.advanceTimersByTime(50);
    expect(resume).toHaveBeenCalledTimes(2);
  } finally { stopResume(); stopSafety(); }
});

it.each(['invalidate', 'revalidate'] as const)('delivers %s synchronously and cancels a queued ordinary resume', signal => {
  vi.useFakeTimers();
  const resume = vi.fn(); const safety = vi.fn();
  const stopResume = subscribeWindowResume(resume); const stopSafety = subscribeSessionSignals(safety);
  try {
    window.dispatchEvent(new Event('focus'));
    publishSessionSignal(signal);
    expect(safety).toHaveBeenCalledExactlyOnceWith(signal);
    vi.advanceTimersByTime(50);
    expect(resume).not.toHaveBeenCalled();
  } finally { stopResume(); stopSafety(); }
});

it('ignores hidden changes and removes the last subscriber timer and listeners', () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const first = vi.fn(); const second = vi.fn();
  const stopFirst = subscribeWindowResume(first); const stopSecond = subscribeWindowResume(second);
  document.dispatchEvent(new Event('visibilitychange')); vi.advanceTimersByTime(50);
  expect(first).not.toHaveBeenCalled(); expect(second).not.toHaveBeenCalled();
  window.dispatchEvent(new Event('focus')); stopFirst(); vi.advanceTimersByTime(50);
  expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event('focus')); stopSecond(); vi.advanceTimersByTime(50);
  window.dispatchEvent(new Event('focus')); vi.advanceTimersByTime(50);
  expect(second).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
