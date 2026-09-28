import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AuditAdministration } from './AuditAdministration';
import { ConfigurationAdministration } from './ConfigurationAdministration';
import { OutboxAdministration } from './OutboxAdministration';
import { SecurityPage } from '../auth/SecurityPage';
import { ReauthenticationProvider } from '../auth/ReauthenticationProvider';
import { LanguageProvider, LanguageSwitcher } from '../../i18n/Language';
import { apiRequest } from '../../api/client';
import type { AdminOrganization } from '../admin/admin';

vi.setConfig({ testTimeout: 30000 });
const organization: AdminOrganization = { id: 'org-test', code: 'TEST', name: 'Test organization', type: 'INTERNAL', permissions: ['audit:read', 'configuration:read'] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

it('distinguishes audit permission failures from an empty result and hides unauthorized export', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ code: 'FEATURE_PERMISSION_DENIED', traceId: 'trace-governance' }, 403)));
  render(<AuditAdministration organization={organization} />);
  expect(await screen.findByText('无权执行此操作')).toBeInTheDocument();
  expect(screen.getByText('trace-governance')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '导出筛选结果' })).not.toBeInTheDocument();
  expect(screen.queryByText('暂无数据')).not.toBeInTheDocument();
});

it('uses generated configuration data for a read-only organization', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => json(path.includes('/settings') ? { organizationId: organization.id, notificationLocale: 'zh-CN', exportRetentionMinutes: 60, version: 1 } : [])));
  render(<ConfigurationAdministration organization={organization} />);
  await waitFor(() => expect(screen.getByLabelText('导出保留时间（分钟）')).toHaveValue('60'));
  expect(screen.getByLabelText('导出保留时间（分钟）')).toBeDisabled();
});

it('retries the exact write once after server-requested reauthentication', async () => {
  let attempts = 0;
  const fetchMock = vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/reauthenticate')) return json({ reauthenticationExpiresAt: new Date().toISOString() });
    attempts += 1;
    return attempts === 1 ? json({ code: 'AUTH_REAUTHENTICATION_REQUIRED' }, 403) : json({ saved: true });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<ReauthenticationProvider><span>Application</span></ReauthenticationProvider>);
  const result = apiRequest('/api/v1/admin/example', { method: 'PATCH', headers: { 'Idempotency-Key': 'fixed-key' }, body: '{"value":1}' });
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('当前密码'), 'only-in-memory-password');
  await userEvent.type(within(dialog).getByLabelText('验证码或恢复码'), '123456');
  await userEvent.click(within(dialog).getByRole('button', { name: /验\s*证/ }));
  await expect(result).resolves.toEqual({ saved: true });
  const writes = fetchMock.mock.calls.filter(([path]) => path.endsWith('/example'));
  expect(writes).toHaveLength(2);
  expect(writes[1]?.[1]).toMatchObject({ body: '{"value":1}', headers: { 'Idempotency-Key': 'fixed-key', 'x-csrf-token': 'csrf' } });
  expect(localStorage.length).toBe(0);
});

it('shows MFA challenge without exposing business navigation or persisting a code', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ mfaEnabled: true, mfaRequired: true, securityState: 'MFA_REQUIRED', recoveryCodesRemaining: 9, reauthenticationExpiresAt: null })));
  render(<MemoryRouter><SecurityPage /></MemoryRouter>);
  expect(await screen.findByLabelText('验证码或恢复码')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '重新生成恢复码' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '系统管理' })).not.toBeInTheDocument();
  expect(localStorage.length).toBe(0);
});

it('switches core governance labels and document language using only a locale preference', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ total: 0, items: [], nextCursor: null })));
  render(<LanguageProvider><LanguageSwitcher /><AuditAdministration organization={organization} /></LanguageProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Language / 语言' }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'English' }));
  expect(await screen.findByRole('button', { name: 'Search' })).toBeInTheDocument();
  expect(document.documentElement.lang).toBe('en-US');
  expect(localStorage.getItem('qms:locale:v1')).toBe('en-US');
});

it('keeps safe English retry errors and trace readable inside the Outbox modal', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.includes('/retry?')) return json({ code: 'FEATURE_PERMISSION_DENIED', message: 'raw worker credentials', traceId: 'trace-outbox-retry' }, 403);
    return json({ total: 1, items: [{ id: 'event-id', eventType: 'WORKFLOW_TASK_ASSIGNED', aggregateId: 'resource-id', attempts: 5, createdAt: '2026-09-19T12:00:00.000Z', reasonCode: 'DELIVERY_FAILED' }] });
  }));
  render(<LanguageProvider><OutboxAdministration organization={{ ...organization, permissions: ['outbox:read', 'outbox:retry'] }} /></LanguageProvider>);
  await userEvent.click(await screen.findByRole('button', { name: 'Retry event' }));
  const dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
  expect(await within(dialog).findByText('You do not have permission for this action.')).toBeInTheDocument();
  expect(within(dialog).getByText('trace-outbox-retry')).toBeInTheDocument();
  expect(screen.queryByText('raw worker credentials')).not.toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Retry' })).toBeEnabled();
});

it('shows durable notification attempt receipts without exposing handler details', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.includes('/attempts?')) return json({ items: [{ id: 'attempt-1', attemptNumber: 5, outcome: 'FAILED', reasonCode: 'OUTBOX_HANDLER_ERROR', occurredAt: '2026-09-19T12:00:00.000Z' }] });
    return json({ total: 1, items: [{ id: 'event-id', eventType: 'WORKFLOW_TASK_ASSIGNED', aggregateId: 'resource-id', attempts: 5, createdAt: '2026-09-19T12:00:00.000Z', reasonCode: 'OUTBOX_DELIVERY_FAILED', failureReasonCode: 'OUTBOX_HANDLER_ERROR' }] });
  }));
  render(<LanguageProvider><OutboxAdministration organization={{ ...organization, permissions: ['outbox:read'] }} /></LanguageProvider>);
  await userEvent.click(await screen.findByRole('button', { name: '查看尝试' }));
  expect((await screen.findAllByText('OUTBOX_HANDLER_ERROR')).length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText('FAILED')).toBeInTheDocument();
});
