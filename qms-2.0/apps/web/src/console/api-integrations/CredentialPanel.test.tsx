import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { getLedgerSessionEpoch } from '../../ui/ledger/preferences';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ConsoleTheme } from '../ConsoleTheme';
import { CredentialPanel } from './CredentialPanel';
import type { Credential, Endpoint, IntegrationScope } from './integration-ui';

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn(), createAdminMutation: vi.fn(() => mocks.mutate) }));
const read = vi.mocked(apiRequest);
const clipboard = vi.fn(async (_value: string) => {});
const organizationId = '22222222-2222-4222-8222-222222222222';
const endpointId = '33333333-3333-4333-8333-333333333333';
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const endpoint: Endpoint = { id: endpointId, organizationId, code: 'MES_QUALITY', name: 'MES质量推送', description: '', sourceCode: 'MES', sourceName: '制造系统', status: 'DRAFT', version: 1,
  returnReceipt: true, maxBodyBytes: 1048576, ratePerMinute: 60, bodyRetentionDays: 7, capacityBytes: 268435456, usedBodyBytes: 0, allowedIps: [],
  createdAt: '2026-11-09T03:00:00.000Z', updatedAt: '2026-11-09T03:00:00.000Z', publicUrl: 'https://qms.example.test/receive' };
const credential: Credential = { id: '44444444-4444-4444-8444-444444444444', organizationId, endpointId, name: '集成平台', createdById: actorId,
  createdAt: '2026-11-09T03:00:00.000Z', expiresAt: '2027-02-07T03:00:00.000Z', revokedAt: null };
let scope: IntegrationScope;
function view() {
  const result = render(<LanguageProvider><ConsoleTheme><MemoryRouter><UnsavedChangesProvider><CredentialPanel scope={scope} endpoint={endpoint} close={vi.fn()} changed={vi.fn()} /></UnsavedChangesProvider></MemoryRouter></ConsoleTheme></LanguageProvider>);
  return result;
}
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development'); vi.clearAllMocks(); read.mockReset(); mocks.mutate.mockReset(); localStorage.clear();
  read.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
  const session = `INTERNAL:${organizationId}:${actorId}`; useWorkTabsStore.getState().bindSession(session);
  scope = { organizationId, session, epoch: getLedgerSessionEpoch(), permissions: ['integration:read', 'integration:manage', 'integration:credentials:manage'], deny: vi.fn() };
});
afterEach(() => { vi.unstubAllEnvs(); localStorage.clear(); });

it('defaults new credentials to permanent validity with an editable useful name', async () => {
  view(); const element = screen.getByRole('dialog', { name: 'MES质量推送凭据' });
  await waitFor(() => expect(element).toBeVisible()); const panel = within(element);
  expect(panel.getByLabelText('凭据名称')).toHaveValue('制造系统对接凭据');
  expect(panel.getByRole('radio', { name: '永久有效' })).toBeChecked();
  mocks.mutate.mockResolvedValue({ ...credential, expiresAt: null });
  fireEvent.change(panel.getByLabelText('凭据名称'), { target: { value: '集成平台' } });
  fireEvent.click(panel.getByRole('button', { name: '创建凭据' }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledWith(`/api/v1/admin/integrations/endpoints/${endpointId}/credentials`, 'POST', { organizationId, name: '集成平台', validityDays: null }, expect.any(AbortSignal)));
});

it('allows finite validity and offers connection copying after a metadata-only credential retry', async () => {
  mocks.mutate.mockResolvedValue(credential); view(); const element = screen.getByRole('dialog', { name: 'MES质量推送凭据' });
  await waitFor(() => expect(element).toBeVisible()); const panel = within(element);
  fireEvent.click(panel.getByRole('radio', { name: '指定天数' }));
  fireEvent.change(await panel.findByLabelText('有效天数'), { target: { value: '30' } });
  fireEvent.change(panel.getByLabelText('凭据名称'), { target: { value: '原请求' } }); fireEvent.click(panel.getByRole('button', { name: '创建凭据' }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledWith(`/api/v1/admin/integrations/endpoints/${endpointId}/credentials`, 'POST', { organizationId, name: '原请求', validityDays: 30 }, expect.any(AbortSignal)));
  const copy = await panel.findByRole('button', { name: '复制对接配置' });
  await waitFor(() => expect(copy).toBeVisible());
  expect(panel.queryByText(/原文无法恢复|仅本次显示/)).not.toBeInTheDocument();
});

it('copies a selected permanent credential again after reopening without storing the secret', async () => {
  const result = { endpoint, credentialId: credential.id, credentialName: credential.name, authorization: 'Bearer fixture-id.REPEATABLE-SECRET', expiresAt: null };
  read.mockImplementation(async path => String(path).includes('/connection?') ? result : { items: [{ ...credential, expiresAt: null }], total: 1, page: 1, limit: 20 });
  for (let opening = 0; opening < 2; opening++) {
    const rendered = view();
    const element = await screen.findByLabelText('MES质量推送凭据', { selector: '[role="dialog"]' });
    await waitFor(() => expect(element).toBeVisible()); const panel = within(element);
    const copy = await panel.findByLabelText('复制集成平台对接配置', { selector: 'button' });
    fireEvent.click(copy);
    await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(opening + 1));
    expect(await panel.findByText('已复制对接配置')).toBeVisible();
    const query = new URL(read.mock.calls.filter(([path]) => String(path).includes('/connection?')).at(-1)![0], 'http://localhost').searchParams;
    expect(query.get('organizationId')).toBe(organizationId); expect(query.get('credentialId')).toBe(credential.id);
    expect(clipboard.mock.calls.at(-1)![0]).toContain(result.authorization);
    expect(clipboard.mock.calls.at(-1)![0]).toContain('永久有效');
    expect(Object.values(localStorage).join('') + Object.values(sessionStorage).join('')).not.toContain('REPEATABLE-SECRET');
    rendered.unmount();
  }
});
