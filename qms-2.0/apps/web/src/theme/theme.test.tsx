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
    expect(configured.components.Card).toMatchObject({ bodyPadding: 8, bodyPaddingSM: 8, headerPadding: 8, headerPaddingSM: 8, headerHeight: 44, headerHeightSM: 44 });
    expect(configured.components.Table).toMatchObject({ cellPaddingBlock: 4, cellPaddingBlockMD: 4, cellPaddingBlockSM: 4 });
    const palette = resolveTokens(false, 'blue');
    expect(configured.components.Table).toMatchObject({ cellFontSize: 13, cellFontSizeMD: 13, cellFontSizeSM: 13, headerColor: palette.text, borderColor: palette.border, headerSplitColor: palette.border, rowHoverBg: palette['surface-tint'], rowSelectedBg: palette['accent-soft'], rowSelectedHoverBg: palette['accent-soft'] });
    expect(configured.token.controlHeight).toBe(36);
    expect(configured.token).not.toHaveProperty('padding');
    expect(configured.token).not.toHaveProperty('margin');
  });
  it('declares shared page, section, card and table density in the theme stylesheet', () => {
    expect(themeStyles).toMatch(/--qms-page-padding:\s*8px/);
    expect(themeStyles).toMatch(/@media\s*\(max-width:\s*1200px\)\s*\{\s*:root\s*\{\s*--qms-page-padding:\s*6px/);
    expect(themeStyles).toMatch(/--qms-section-gap:\s*6px/);
    expect(themeStyles).toMatch(/--qms-card-padding:\s*8px/);
    expect(themeStyles).toMatch(/--qms-table-cell-padding-block:\s*4px/);
  });
  it('shares compact form spacing across business pages and editing overlays', () => {
    expect(themeStyles).toMatch(/:where\(\.qms-content,\s*\.ant-modal,\s*\.ant-drawer\)\s+\.ant-form-item\s*\{[^}]*margin-bottom:\s*var\(--qms-section-gap\)/);
    expect(styles('features/supplier-quality/supplier-quality.css')).toMatch(/\.supplier-form-grid\s*\{[^}]*column-gap:\s*var\(--qms-section-gap\)/);
    expect(styles('features/coordinate-inspection/coordinate-inspection.css')).toMatch(/\.coordinate-inspection-form-grid\s*\{[^}]*gap:\s*0\s+var\(--qms-section-gap\)/);
    expect(styles('workbench/workbench.css')).toMatch(/\.qms-workbench h2\s*\{[^}]*margin:\s*0 0 var\(--qms-section-gap\)/);
  });
  it('adapts field groups to their own available width and keeps wide fields across columns', () => {
    expect(themeStyles).toMatch(/--qms-form-column-min:\s*240px/);
    for (const [file, selector] of [
      ['customer-quality', 'customer-ledger-form'], ['process-quality', 'process-quality-form-grid'],
      ['supplier-incoming', 'supplier-incoming-form-grid'], ['coordinate-inspection', 'coordinate-inspection-form-grid'],
    ]) {
      const css = styles(`features/${file}/${file}.css`);
      const block = css.match(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`))?.[1];
      expect(block, selector).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*var\(--qms-form-column-min\)\),\s*1fr\)\)/);
      expect(css, selector).not.toMatch(new RegExp(`@media[^}]*\\.${selector}\\s*\\{[^}]*grid-template-columns`));
    }
    expect(styles('features/customer-quality/customer-quality.css')).toMatch(/\.customer-ledger-form\s*\{[^}]*margin:\s*var\(--qms-section-gap\) 0/);
    expect(styles('features/customer-quality/customer-quality.css')).toMatch(/\.customer-ledger-form-wide\s*\{[^}]*grid-column:\s*1 \/ -1/);
  });
  it('keeps labels, validation and action focus readable without clipping or moving actions', () => {
    expect(themeStyles).toMatch(/\.ant-form-item-label > label\s*\{[^}]*height:\s*auto;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere/);
    expect(themeStyles).toMatch(/\.ant-form-item-explain\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(themeStyles).toMatch(/\.qms-dialog-actions\s*\{[^}]*gap:\s*var\(--qms-section-gap\);[^}]*flex-wrap:\s*wrap/);
    expect(themeStyles).toMatch(/\.qms-dialog-actions > \.ant-btn:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--qms-accent-action\)/);
    expect(themeStyles).not.toMatch(/\.ant-form-item-explain[^}]*overflow:\s*hidden/);
  });
  it('maps professional 8D spacing to the shared density while retaining local table scrolling', () => {
    const css = styles('features/process-eight-d/eight-d.module.css');
    expect(css).toMatch(/\.section\s*\{[^}]*padding:\s*var\(--qms-card-padding\)/);
    expect(css).toMatch(/\.fields\s*\{[^}]*gap:\s*var\(--qms-section-gap\)/);
    expect(css).toMatch(/\.table th, \.table td\s*\{[^}]*padding:\s*var\(--qms-table-cell-padding-block\) var\(--qms-card-padding\)/);
    expect(css).toMatch(/\.scroll\s*\{[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/\.table\s*\{[^}]*min-width:\s*1000px/);
    expect(css).toMatch(/\.field input, \.field select[^}]*min-height:\s*36px/);
    expect(css).toMatch(/@media\s*\(pointer:\s*coarse\)\s*\{[^}]*min-height:\s*44px/);
  });
  it('keeps admin, permission, governance and legacy account spacing compact at every breakpoint', () => {
    const globalStyles = styles('styles/global.css');
    for (const [selector, property, expected] of [
      ['.admin-heading', 'gap', 'var(--qms-section-gap)'],
      ['.admin-heading label', 'gap', 'var(--qms-section-gap)'],
      ['.admin-toolbar', 'gap', 'var(--qms-section-gap)'],
      ['.admin-page', 'padding', 'var(--qms-card-padding)'],
      ['.admin-page .ant-alert', 'margin-bottom', 'var(--qms-section-gap)'],
      ['.permission-directory summary', 'margin-bottom', 'var(--qms-section-gap)'],
      ['.permission-module', 'margin', 'var(--qms-section-gap) 0'],
      ['.permission-module header', 'gap', 'var(--qms-section-gap)'],
      ['.governance-panel', 'padding-block', 'var(--qms-section-gap)'],
      ['.governance-toolbar', 'gap', 'var(--qms-section-gap)'],
      ['.governance-toolbar', 'padding', 'var(--qms-card-padding)'],
      ['.governance-panel .ant-form-inline', 'gap', 'var(--qms-section-gap)'],
      ['.account-grid', 'gap', 'var(--qms-section-gap)'],
      ['.account-grid', 'margin', 'var(--qms-section-gap) 0'],
      ['.account-form', 'margin-top', 'var(--qms-section-gap)'],
      ['.account-sessions', 'margin-top', 'var(--qms-section-gap)'],
      ['.account-summary', 'margin-bottom', 'var(--qms-section-gap)'],
      ['.account-center .ant-alert', 'margin-bottom', 'var(--qms-section-gap)'],
    ]) {
      const escaped = selector!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rules = [...globalStyles.matchAll(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'g'))];
      const values = rules.flatMap(rule => [...rule[1]!.matchAll(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+);`, 'g'))].map(match => match[1]!.trim()));
      expect(values.length, `${selector} ${property}`).toBeGreaterThan(0);
      for (const value of values) expect(value, `${selector} ${property}`).toBe(expected);
    }
  });
  it('uses six-pixel gaps for explicit business block Spaces and Rows', () => {
    for (const file of [
      'tasks/MyTasksPage', 'attachments/AttachmentPanel', 'audit-standards/AuditStandardsPage',
      'site-scanning/SiteScanningPage', 'announcements/AnnouncementsPage',
      'process-quality/ProcessShipmentReportPanel', 'supplier-pcn/SupplierPcnPage',
    ]) {
      const spaces = styles(`features/${file}.tsx`).match(/<Space\b[^>]*orientation="vertical"[^>]*>/g) ?? [];
      expect(spaces.length, file).toBeGreaterThan(0);
      expect(spaces.join('\n'), file).not.toMatch(/size="(?:middle|large)"|size=\{(?:16|24)\}/);
      expect(spaces.some(space => space.includes('size={6}')), file).toBe(true);
    }
    const rows = styles('features/tasks/TaskStatisticsPage.tsx').match(/<Row\b[^>]*>/g);
    expect(rows).toHaveLength(2);
    for (const row of rows!) expect(row).toContain('gutter={[6, 6]}');
  });
  it('scopes compact heading and pagination overrides above AntD specificity', () => {
    expect(themeStyles).toMatch(/\.qms-content \.ant-typography \+ h1\.ant-typography\s*\{[^}]*margin:\s*0 0 var\(--qms-section-gap\)/);
    expect(themeStyles).toMatch(/:is\(\.qms-content,\s*\.ant-modal,\s*\.ant-drawer\) \.ant-table-wrapper \.ant-table-pagination\.ant-pagination\s*\{[^}]*margin:\s*var\(--qms-section-gap\) 0/);
  });
  it('covers scoped coarse controls and overlay close targets without enlarging checkboxes or textareas', () => {
    const coarse = themeStyles.match(/@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\n\}/)?.[1];
    expect(coarse).toContain(':is(.qms-content, .ant-modal, .ant-drawer)');
    expect(coarse).toMatch(/input:where\(:not\(\[type\]\),[^}]*\[type="text"\][^}]*\[type="date"\][^}]*min-height:\s*44px/);
    expect(coarse).toMatch(/\.ant-btn-icon-only,\s*\.ant-modal-close,\s*\.ant-drawer-close\)\s*\{[^}]*min-width:\s*44px/);
    expect(coarse).not.toMatch(/\[type="(?:checkbox|radio)"\]|textarea/);
  });
  it('preserves navigation, native controls and workflow canvas geometry', () => {
    expect(styles('layouts/shell.css')).toMatch(/\.qms-nav-item\s*\{[^}]*min-height:\s*44px/);
    expect(styles('layouts/shell.css')).toMatch(/@media\s*\(pointer:\s*coarse\)\s*\{[^}]*\.qms-context-link[^}]*min-height:\s*44px/);
    expect(styles('features/tasks/tasks.css')).toMatch(/\.task-inbox select\s*\{[^}]*min-height:\s*36px/);
    const workflows = styles('features/workflows/workflows.css');
    expect(workflows).toMatch(/\.workflow-editor input[^}]*min-height:\s*36px/);
    expect(workflows).toMatch(/\.workflow-editor input:not\(\[type="checkbox"\], \[type="radio"\]\)[^}]*height:\s*36px;\s*padding-block:\s*6px/);
    expect(workflows).toMatch(/\.workflow-canvas\s*\{[^}]*height:\s*440px/);
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
    const topbars = [...shell.matchAll(/\.qms-topbar\s*\{([^}]+)\}/g)];
    expect(topbars).toHaveLength(2);
    for (const topbar of topbars) expect(topbar[1]).toMatch(/min-height:\s*54px/);
    expect(topbars[1]![1]).toMatch(/padding:\s*4px 0/);
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
    fireEvent.click(await screen.findByRole('radio', { name: '鸢尾紫' }));
    expect(document.documentElement.dataset.qmsAppearance).toBe('dark');
    expect(document.documentElement.dataset.qmsAccent).toBe('purple');
    fireEvent.click(screen.getByRole('radio', { name: '浅色' }));
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
    fireEvent.click(await screen.findByRole('radio', { name: '跟随系统' }));
    act(() => { media.matches = true; change?.(); });
    expect(document.documentElement.dataset.qmsAppearance).toBe('dark');
    expect(document.documentElement.dataset.qmsAccent).toBe('blue');
  });
});
