import { transferableAbortController } from 'node:util';
import { StrictMode, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { UnsavedChangesProvider, useUnsavedChanges } from './layouts/UnsavedChanges';

vi.mock('./features/auth/LoginPage', () => ({ LoginPage: () => <div>login route</div> }));
vi.mock('./features/auth/SecurityPage', () => ({ SecurityPage: () => <div>mfa route</div> }));
vi.mock('./features/auth/RequiredPasswordChangePage', () => ({ RequiredPasswordChangePage: () => <div>change-password route</div> }));
vi.mock('./features/auth/PasswordRecoveryPage', () => ({ PasswordRecoveryPage: () => <div>password-recovery route</div> }));
vi.mock('./features/auth/ResetPasswordPage', () => ({ ResetPasswordPage: () => <div>reset-password route</div> }));
vi.mock('./features/auth/AuthenticatedRoute', () => ({ AuthenticatedRoute: ({ accountType, children }: { accountType: string; children: ReactNode }) => <div data-testid="auth-boundary" data-account-type={accountType}>{children}</div> }));
vi.mock('./layouts/InternalLayout', () => ({ InternalLayout: () => <UnsavedChangesProvider><PortalEditor /></UnsavedChangesProvider> }));
vi.mock('./layouts/SupplierLayout', () => ({ SupplierLayout: () => <UnsavedChangesProvider><PortalEditor /></UnsavedChangesProvider> }));

let navigate: ReturnType<typeof useNavigate>;
function PortalEditor() {
  navigate = useNavigate();
  const location = useLocation();
  useUnsavedChanges(true);
  return <output aria-label="portal path">{location.pathname}{location.search}</output>;
}
beforeEach(() => {
  localStorage.clear();
  // Native data-router requests must use Node AbortSignals in jsdom.
  vi.stubGlobal('AbortController', function () { return transferableAbortController(); });
});
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

it.each(['/login', '/mfa', '/change-password', '/password-recovery', '/reset-password'])('preserves the public %s route', path => {
  window.history.replaceState({}, '', path);
  render(<App />);
  expect(screen.getByText(`${path.slice(1)} route`)).toBeVisible();
});

it.each([['/app/workbench', 'INTERNAL'], ['/supplier/inbox', 'SUPPLIER']] as const)('provides native blocking inside %s with its existing account boundary under StrictMode', async (path, accountType) => {
  window.history.replaceState({}, '', path);
  render(<StrictMode><App /></StrictMode>);
  expect(screen.getByTestId('auth-boundary')).toHaveAttribute('data-account-type', accountType);
  const next = `${path}?scope=another`;
  await act(async () => { await navigate(next); });
  expect(await screen.findByRole('dialog')).toHaveTextContent('当前草稿尚未保存');
  expect(screen.getByLabelText('portal path')).toHaveTextContent(path);
  expect(window.location.search).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await act(async () => { await navigate(next); });
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(window.location.search).toBe('?scope=another'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('preserves the unknown-route redirect to login', async () => {
  window.history.replaceState({}, '', '/unknown');
  render(<App />);
  expect(await screen.findByText('login route')).toBeVisible();
  expect(window.location.pathname).toBe('/login');
});
