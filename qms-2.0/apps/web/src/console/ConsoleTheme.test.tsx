import { act, fireEvent, render, screen } from '@testing-library/react';
import { Button, ConfigProvider, Modal, Select } from 'antd';
import { useContext } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ConsoleTheme, consolePreferenceKey, useConsoleAppearance } from './ConsoleTheme';

beforeEach(() => localStorage.clear());
it.each(['light', 'dark'] as const)('uses compact table presentation within the independent neutral %s theme', (mode) => {
  localStorage.setItem(consolePreferenceKey, mode);
  function Probe() {
    const { theme } = useContext(ConfigProvider.ConfigContext);
    return <output aria-label="console configuration">{JSON.stringify(theme)}</output>;
  }
  const { container } = render(<ConsoleTheme><Probe /></ConsoleTheme>);
  const configured = JSON.parse(screen.getByLabelText('console configuration').textContent!);
  const scope = container.querySelector('.qms-console-theme') as HTMLElement;
  expect(configured.components.Table).toMatchObject({ cellPaddingBlock: 4, cellPaddingBlockMD: 4, cellPaddingBlockSM: 4, cellFontSize: 13, cellFontSizeMD: 13, cellFontSizeSM: 13, borderColor: scope.style.getPropertyValue('--qms-border'), rowSelectedBg: scope.style.getPropertyValue('--qms-accent-soft'), rowHoverBg: scope.style.getPropertyValue('--qms-surface-tint') });
  expect(configured.token.controlHeight).toBe(36);
  expect(configured.token.colorPrimary).toBe(mode === 'dark' ? '#e2e8f0' : '#172033');
});
function Content() {
  const { mode, setMode } = useConsoleAppearance();
  return <><output>{mode}</output><button onClick={() => setMode('dark')}>dark</button><button onClick={() => setMode('system')}>system</button><Select aria-label="选择" options={[{ value: 'one', label: 'Option One' }]} /><Modal open title="局部弹窗" footer={<Button>完成</Button>}>内容</Modal></>;
}
it('owns an independent preference and contains popup, modal and inherited QMS tokens', async () => {
  localStorage.setItem('qms:appearance:v1', JSON.stringify({ mode: 'light', accent: 'blue' }));
  document.documentElement.style.setProperty('--qms-surface', 'business-surface');
  const { container } = render(<ConsoleTheme><Content /></ConsoleTheme>);
  fireEvent.click(screen.getByRole('button', { name: 'dark' }));
  const scope = container.querySelector('[data-console-theme="dark"]');
  expect(scope).not.toBeNull();
  expect(scope).toContainElement(await screen.findByRole('dialog'));
  fireEvent.mouseDown(screen.getByRole('combobox'));
  expect(scope).toContainElement(await screen.findByText('Option One'));
  expect((scope as HTMLElement).style.getPropertyValue('--qms-surface')).not.toBe('');
  expect(document.documentElement.style.getPropertyValue('--qms-surface')).toBe('business-surface');
  expect(localStorage.getItem(consolePreferenceKey)).toBe('dark');
  expect(localStorage.getItem('qms:appearance:v1')).toContain('blue');
});
it('responds to system changes without touching the document theme and removes its listener', () => {
  let listener = () => {};
  const media = { matches: false, addEventListener: vi.fn((_event, callback) => { listener = callback; }), removeEventListener: vi.fn() };
  const original = window.matchMedia;
  window.matchMedia = vi.fn(() => media as unknown as MediaQueryList);
  try {
    const { container, unmount } = render(<ConsoleTheme><Content /></ConsoleTheme>);
    fireEvent.click(screen.getByRole('button', { name: 'system' }));
    act(() => { media.matches = true; listener(); });
    expect(container.querySelector('[data-console-theme="dark"]')).not.toBeNull();
    unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith('change', listener);
  } finally { window.matchMedia = original; }
});
it('does not prevent active theme changes when preference storage is unavailable', () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
  try {
    const { container } = render(<ConsoleTheme><Content /></ConsoleTheme>);
    expect(container.querySelector('[data-console-theme="light"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'dark' }));
    expect(container.querySelector('[data-console-theme="dark"]')).not.toBeNull();
  } finally { read.mockRestore(); write.mockRestore(); }
});
