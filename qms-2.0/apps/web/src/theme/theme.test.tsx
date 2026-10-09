import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from './ThemeProvider';
import { AppearanceButton } from './AppearanceButton';
import { parsePreferences, preferenceKey, resolveTokens } from './tokens';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('shared appearance', () => {
  it('recovers invalid preferences and keeps readable action labels across all palettes', () => {
    expect(parsePreferences({ mode: 'invalid', accent: '__proto__' })).toEqual({ mode: 'light', accent: 'blue' });
    const luminance = (hex: string) => hex.slice(1).match(/../g)!.map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i]!, 0);
    for (const dark of [false, true]) for (const accent of ['blue', 'teal', 'purple'] as const) {
      const tokens = resolveTokens(dark, accent);
      const values = [luminance(tokens['accent-action']), luminance(tokens['on-accent'])];
      expect((Math.max(...values) + .05) / (Math.min(...values) + .05)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('changes mode and accent independently and restores saved preferences', async () => {
    localStorage.setItem(preferenceKey, JSON.stringify({ mode: 'dark', accent: 'teal' }));
    render(<ThemeProvider><AppearanceButton /></ThemeProvider>);
    expect(screen.getByRole('button', { name: '外观设置' })).toHaveTextContent('外观');
    fireEvent.click(screen.getByRole('button', { name: '外观设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '鸢尾紫' }));
    expect(document.documentElement.dataset.qmsAppearance).toBe('dark');
    expect(document.documentElement.dataset.qmsAccent).toBe('purple');
    fireEvent.click(screen.getByRole('button', { name: '浅色' }));
    expect(document.documentElement.dataset.qmsAccent).toBe('purple');
    await waitFor(() => expect(JSON.parse(localStorage.getItem(preferenceKey)!)).toEqual({ mode: 'light', accent: 'purple' }));
  });
  it('follows live system changes and remains usable when storage is blocked', async () => {
    let change: (() => void) | undefined;
    const media = { matches: false, addEventListener: (_event: string, fn: () => void) => { change = fn; }, removeEventListener: vi.fn() };
    vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<ThemeProvider><AppearanceButton /></ThemeProvider>);
    fireEvent.click(screen.getByRole('button', { name: '外观设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '跟随系统' }));
    act(() => { media.matches = true; change?.(); });
    expect(document.documentElement.dataset.qmsAppearance).toBe('dark');
    expect(document.documentElement.dataset.qmsAccent).toBe('blue');
  });
});
