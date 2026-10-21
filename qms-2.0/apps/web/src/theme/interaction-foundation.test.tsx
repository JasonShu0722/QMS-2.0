import { ConfigProvider } from 'antd';
import { useContext } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n/Language';
import { PasswordChangeDialog } from '../features/account/PasswordChangeDialog';
import { ThemeProvider } from './ThemeProvider';
import { AppearanceButton } from './AppearanceButton';

beforeEach(() => localStorage.clear());

it('applies the reviewed shared button baseline without shrinking normal controls', () => {
  function Probe() {
    const { theme } = useContext(ConfigProvider.ConfigContext);
    return <output aria-label="theme configuration">{JSON.stringify(theme)}</output>;
  }
  render(<ThemeProvider><Probe /></ThemeProvider>);
  const configured = JSON.parse(screen.getByLabelText('theme configuration').textContent!);
  expect(configured.components.Button).toMatchObject({ paddingInline: 14, fontWeight: 500, defaultShadow: 'none', primaryShadow: 'none', dangerShadow: 'none' });
  expect(configured.token.controlHeight).toBe(36);
});

it('exposes mode and accent as independent radio groups with one checked choice each', async () => {
  render(<LanguageProvider><ThemeProvider><AppearanceButton /></ThemeProvider></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: '外观设置' }));
  const modes = within(await screen.findByRole('radiogroup', { name: '显示模式' }));
  const accents = within(screen.getByRole('radiogroup', { name: '品牌主色' }));
  expect(modes.getAllByRole('radio')).toHaveLength(3);
  expect(accents.getAllByRole('radio')).toHaveLength(3);
  expect(modes.getByRole('radio', { name: '浅色' })).toBeChecked();
  fireEvent.click(accents.getByRole('radio', { name: '鸢尾紫' }));
  fireEvent.click(modes.getByRole('radio', { name: '深色' }));
  expect(accents.getByRole('radio', { name: '鸢尾紫' })).toBeChecked();
  expect(modes.getByRole('radio', { name: '深色' })).toBeChecked();
  expect(document.documentElement).toHaveAttribute('data-qms-accent', 'purple');
  expect(document.documentElement).toHaveAttribute('data-qms-appearance', 'dark');
});

it('groups password cancellation and submission in the same accessible action area', () => {
  render(<LanguageProvider><PasswordChangeDialog onClose={() => {}} afterClose={() => {}} onSuccess={() => {}} /></LanguageProvider>);
  const dialog = within(screen.getByRole('dialog', { name: '修改密码' }));
  const actions = within(dialog.getByRole('group', { name: '修改密码' }));
  const cancel = actions.getByRole('button', { name: /取\s*消/ });
  const submit = actions.getByRole('button', { name: '修改密码' });
  expect(cancel.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(dialog.getByLabelText('当前密码')).toHaveAttribute('autocomplete', 'current-password');
});
