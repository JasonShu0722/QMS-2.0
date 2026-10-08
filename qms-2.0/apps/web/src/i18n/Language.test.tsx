import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { LanguageProvider, LanguageSwitcher } from './Language';

afterEach(() => localStorage.clear());

it('opens a language menu and persists the selected locale', async () => {
  render(<LanguageProvider><LanguageSwitcher /></LanguageProvider>);
  const trigger = screen.getByRole('button', { name: 'Language / 语言' });
  expect(trigger).toHaveTextContent('中文');
  expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

  await userEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(await screen.findByRole('menuitemradio', { name: '简体中文' })).toHaveAttribute('aria-checked', 'true');
  const english = screen.getByRole('menuitemradio', { name: 'English' });
  expect(english).toHaveAttribute('aria-checked', 'false');
  await userEvent.click(english);

  expect(trigger).toHaveTextContent('EN');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(document.documentElement.lang).toBe('en-US');
  expect(localStorage.getItem('qms:locale:v1')).toBe('en-US');
  await userEvent.click(trigger);
  expect(await screen.findByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
  await userEvent.click(screen.getByRole('menuitemradio', { name: '简体中文' }));
  expect(trigger).toHaveTextContent('中文');
  expect(document.documentElement.lang).toBe('zh-CN');
  expect(localStorage.getItem('qms:locale:v1')).toBe('zh-CN');
});

it('supports opening, choosing and dismissing the language menu with the keyboard', async () => {
  render(<LanguageProvider><LanguageSwitcher /></LanguageProvider>);
  const trigger = screen.getByRole('button', { name: 'Language / 语言' });
  await userEvent.tab();
  expect(trigger).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  const chinese = await screen.findByRole('menuitemradio', { name: '简体中文' });
  await waitFor(() => expect(chinese).toHaveFocus());
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
  expect(trigger).toHaveFocus();
});
