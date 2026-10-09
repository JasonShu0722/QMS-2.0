import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../i18n/Language';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { preferenceKey } from '../../theme/tokens';
import { AuthToolbar } from './AuthToolbar';

function renderToolbar(path = '/login') {
  return render(<LanguageProvider><ThemeProvider><MemoryRouter initialEntries={[path]}><AuthToolbar /></MemoryRouter></ThemeProvider></LanguageProvider>);
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/login');
});
afterEach(() => localStorage.clear());

describe('authentication toolbar', () => {
  it.each(['/app/workbench', '/supplier/inbox'])('leaves %s appearance entries to the authenticated shell', path => {
    renderToolbar(path);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('groups exactly two accessible entries beside the unchanged login form', () => {
    render(<App />);
    const language = screen.getByRole('button', { name: 'Language / 语言' });
    const appearance = screen.getByRole('button', { name: '外观设置' });
    const group = screen.getByRole('group', { name: 'Language / 语言 · 外观设置' });
    expect(within(group).getAllByRole('button')).toEqual([language, appearance]);
    expect(appearance).not.toHaveTextContent('外观');
    expect(screen.getByLabelText('账号')).toBeInTheDocument();
    expect(screen.getByLabelText('密码')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^设置$/ })).not.toBeInTheDocument();
  });

  it('supports keyboard language selection, appearance opening and focus return', async () => {
    const user = userEvent.setup();
    renderToolbar();
    const language = screen.getByRole('button', { name: 'Language / 语言' });
    await user.tab();
    expect(language).toHaveFocus();
    await user.keyboard('{Enter}');
    const chinese = await screen.findByRole('menuitemradio', { name: '简体中文' });
    await waitFor(() => expect(chinese).toHaveFocus());
    const english = screen.getByRole('menuitemradio', { name: 'English' });
    // jsdom has no layout; Ant Design keyboard traversal requires visible menu items.
    for (const item of [chinese, english]) Object.defineProperty(item, 'offsetParent', { get: () => item.parentElement });
    fireEvent.keyDown(chinese, { key: 'ArrowDown', keyCode: 40, which: 40 });
    await waitFor(() => expect(english).toHaveFocus());
    fireEvent.keyDown(english, { key: 'Enter', keyCode: 13, which: 13 });
    await waitFor(() => expect(document.documentElement.lang).toBe('en-US'));
    expect(language).toHaveFocus();
    await user.tab();
    const appearance = screen.getByRole('button', { name: 'Appearance settings' });
    expect(appearance).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Appearance settings' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', keyCode: 27, which: 27 });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(appearance).toHaveFocus());
  });

  it('persists locale, display mode and accent through a login page reload', async () => {
    renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: 'Language / 语言' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'English' }));
    fireEvent.click(screen.getByRole('button', { name: 'Appearance settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Dark' }));
    fireEvent.click(screen.getByRole('button', { name: 'Iris purple' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(preferenceKey)!)).toEqual({ mode: 'dark', accent: 'purple' }));
    expect(localStorage.getItem('qms:locale:v1')).toBe('en-US');

    cleanup();
    renderToolbar();
    expect(document.documentElement.lang).toBe('en-US');
    expect(document.documentElement.dataset.qmsAppearance).toBe('dark');
    expect(document.documentElement.dataset.qmsAccent).toBe('purple');
    fireEvent.click(screen.getByRole('button', { name: 'Appearance settings' }));
    expect(await screen.findByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Iris purple' })).toHaveAttribute('aria-pressed', 'true');
  });
});
