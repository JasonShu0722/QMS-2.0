import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n/Language';
import { AppearanceButton } from './AppearanceButton';
import { ThemeProvider } from './ThemeProvider';
import { preferenceKey } from './tokens';

function renderAppearance(compact = false) {
  return render(<LanguageProvider><ThemeProvider><AppearanceButton compact={compact} /></ThemeProvider></LanguageProvider>);
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('appearance choices', () => {
  it('uses arrow keys within each group without resetting the other preference', async () => {
    const user = userEvent.setup();
    localStorage.setItem(preferenceKey, JSON.stringify({ mode: 'dark', accent: 'purple' }));
    renderAppearance();
    await user.click(screen.getByRole('button', { name: '外观设置' }));
    const modes = within(await screen.findByRole('radiogroup', { name: '显示模式' }));
    const accents = within(screen.getByRole('radiogroup', { name: '品牌主色' }));
    expect(modes.getAllByRole('radio')).toHaveLength(3);
    expect(accents.getAllByRole('radio')).toHaveLength(3);
    const dark = modes.getByRole('radio', { name: '深色' });
    const purple = accents.getByRole('radio', { name: '鸢尾紫' });
    expect(dark).toBeChecked();
    expect(purple).toBeChecked();

    dark.focus();
    await user.keyboard('{ArrowRight}');
    const system = modes.getByRole('radio', { name: '跟随系统' });
    expect(system).toBeChecked();
    expect(system).toHaveFocus();
    expect(purple).toBeChecked();
    expect(document.documentElement.dataset.qmsAppearance).toBe('light');
    expect(document.documentElement.dataset.qmsAccent).toBe('purple');

    purple.focus();
    await user.keyboard('{ArrowLeft}');
    const teal = accents.getByRole('radio', { name: '湖水青' });
    expect(teal).toBeChecked();
    expect(teal).toHaveFocus();
    expect(system).toBeChecked();
    expect(document.documentElement.dataset.qmsAccent).toBe('teal');
    expect(modes.getAllByRole('radio', { checked: true })).toHaveLength(1);
    expect(accents.getAllByRole('radio', { checked: true })).toHaveLength(1);
    await waitFor(() => expect(JSON.parse(localStorage.getItem(preferenceKey)!)).toEqual({ mode: 'system', accent: 'teal' }));
  });

  it.each([false, true])('exposes drawer state and restores trigger focus (compact=%s)', async compact => {
    const user = userEvent.setup();
    renderAppearance(compact);
    const trigger = screen.getByRole('button', { name: '外观设置' });
    expect(screen.getAllByRole('button', { name: '外观设置' })).toHaveLength(1);
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    if (compact) expect(trigger).not.toHaveTextContent('外观');
    else expect(trigger).toHaveTextContent('外观');
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: '外观设置' })).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', keyCode: 27, which: 27 });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
