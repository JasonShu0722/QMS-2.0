import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it } from 'vitest';
import { LanguageProvider, LanguageSwitcher } from './Language';
import { TopbarLanguageSwitcher } from './TopbarLanguageSwitcher';

beforeEach(() => localStorage.clear());

it('shares locale with the login dropdown and supports radio arrow keys', async () => {
  render(<LanguageProvider><TopbarLanguageSwitcher /><LanguageSwitcher /></LanguageProvider>);
  const cn = screen.getByRole('radio', { name: 'CN' });
  const en = screen.getByRole('radio', { name: 'EN' });
  expect(cn).toBeChecked();
  cn.focus();
  await userEvent.keyboard('{ArrowLeft}');
  expect(en).toBeChecked();
  expect(en).toHaveFocus();
  expect(document.documentElement.lang).toBe('en-US');
  expect(localStorage.getItem('qms:locale:v1')).toBe('en-US');
  await userEvent.click(screen.getByRole('button', { name: 'Language / 语言' }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: '简体中文' }));
  expect(cn).toBeChecked();
});
