import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigProvider } from 'antd';
import { useContext } from 'react';
import { readFileSync } from 'node:fs';
import { ThemeProvider } from './ThemeProvider';
import { AppearanceButton } from './AppearanceButton';
import { parsePreferences, preferenceKey, resolveTokens } from './tokens';
const styles = (path: string) => readFileSync(`${process.cwd()}/src/${path}`, 'utf8');
const themeStyles = styles('theme/theme.css');

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('shared appearance', () => {
  it('sets compact Card and Table spacing without shrinking standard controls', () => {
    function ThemeProbe() {
      const { theme } = useContext(ConfigProvider.ConfigContext);
      return <output data-testid="density">{JSON.stringify(theme)}</output>;
    }
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);
    const configured = JSON.parse(screen.getByTestId('density').textContent!);
    expect(configured.components.Card).toMatchObject({ bodyPadding: 16, bodyPaddingSM: 16 });
    expect(configured.components.Table).toMatchObject({ cellPaddingBlock: 8, cellPaddingBlockMD: 8, cellPaddingBlockSM: 8 });
    expect(configured.token.controlHeight).toBe(36);
    expect(configured.token).not.toHaveProperty('padding');
    expect(configured.token).not.toHaveProperty('margin');
  });
  it('declares shared page, section, card and table density in the theme stylesheet', () => {
    expect(themeStyles).toMatch(/--qms-page-padding:\s*16px/);
    expect(themeStyles).toMatch(/@media\s*\(max-width:\s*1200px\)\s*\{\s*:root\s*\{\s*--qms-page-padding:\s*12px/);
    expect(themeStyles).toMatch(/--qms-section-gap:\s*12px/);
    expect(themeStyles).toMatch(/--qms-card-padding:\s*16px/);
    expect(themeStyles).toMatch(/--qms-table-cell-padding-block:\s*8px/);
  });
  it('lets the shared shell supply page padding at every business-page breakpoint', () => {
    for (const feature of ['announcements', 'audit-management', 'audit-standards', 'coordinate-inspection', 'customer-quality', 'new-product-quality', 'process-quality', 'quality-data', 'site-scanning', 'supplier-admission', 'supplier-concession', 'supplier-incoming', 'supplier-pcn', 'supplier-performance', 'supplier-quality']) {
      const css = styles(`features/${feature}/${feature}.css`);
      const rules = [...css.matchAll(new RegExp(`\\.${feature}-page\\s*\\{([^}]+)\\}`, 'g'))];
      expect(rules.length, feature).toBeGreaterThan(0);
      for (const rule of rules) expect(rule[1], feature).toMatch(/padding:\s*0\s*;/);
    }
    expect(styles('features/tasks/task-statistics.css')).not.toMatch(/padding:\s*(24|16)px/);
    expect(styles('layouts/shell.css')).toMatch(/\.qms-content\s*\{[^}]*padding:\s*var\(--qms-page-padding\)/);
  });
  it('uses themed surfaces and compact native table cells', () => {
    expect(styles('features/audit-standards/audit-standards.css')).not.toMatch(/var\(--(?:surface|border)[,)]/);
    expect(styles('features/supplier-quality/supplier-quality.css')).not.toMatch(/(?:background|border|color):[^;}]*(?:#fff|#dce3ea|#64748b)/);
    expect(styles('features/workflows/workflows.css')).toMatch(/\.workflow-list th, \.workflow-list td\s*\{[^}]*padding:\s*var\(--qms-table-cell-padding-block\)/);
  });
  it('keeps the mobile and coarse-pointer tab close target from shrinking', () => {
    const shell = styles('layouts/shell.css');
    expect(shell).not.toMatch(/\.qms-topbar \.qms-work-tab \.ant-btn\s*\{[^}]*(?:28px|30px)/);
    const workTabs = styles('work-tabs/work-tabs.css');
    expect(workTabs).toMatch(/\.qms-work-tab\s*\{[^}]*height:\s*36px/);
    expect(workTabs).toMatch(/\.qms-all-tabs\.ant-btn\s*\{[^}]*height:\s*36px/);
    expect(workTabs).toMatch(/@media\s*\(max-width:\s*760px\),\s*\(pointer:\s*coarse\)\s*\{[\s\S]*\.qms-work-tab \.ant-btn[^}]*min-width:\s*44px;[^}]*min-height:\s*44px/);
  });
  it('keeps security dialog controls at standard and touch heights', () => {
    const security = styles('features/auth/security.css');
    expect(security).not.toMatch(/min-height:\s*32px/);
    expect(security).toMatch(/@media\s*\(pointer:\s*coarse\)\s*\{[^}]*\.qms-security-section \.ant-btn[^}]*min-height:\s*44px/);
  });
  it('recovers invalid preferences and keeps readable action labels across all palettes', () => {
    expect(parsePreferences({ mode: 'invalid', accent: '__proto__' })).toEqual({ mode: 'light', accent: 'blue' });
    const luminance = (hex: string) => hex.slice(1).match(/../g)!.map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i]!, 0);
    for (const dark of [false, true]) for (const accent of ['blue', 'teal', 'purple'] as const) {
      const tokens = resolveTokens(dark, accent);
      const contrast = (foreground: string, background: string) => {
        const values = [luminance(foreground), luminance(background)];
        return (Math.max(...values) + .05) / (Math.min(...values) + .05);
      };
      expect(contrast(tokens['accent-action'], tokens['on-accent'])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens['accent-text'], tokens['accent-soft'])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens['accent-text'], tokens['surface-tint'])).toBeGreaterThanOrEqual(4.5);
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
