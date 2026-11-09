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
  const session = `INTERNAL:${organizationId}:${actorId}`; useWorkTabsStore.getState().bindSession(session);
  scope = { organizationId, session, epoch: getLedgerSessionEpoch(), permissions: ['integration:read', 'integration:manage', 'integration:credentials:manage'], deny: vi.fn() };
});
afterEach(() => { vi.unstubAllEnvs(); localStorage.clear(); });

it('shows a newly created credential only in the current dialog and never stores it locally', async () => {
  const rendered = view(); const element = screen.getByRole('dialog', { name: 'MES质量推送凭据' });
  await waitFor(() => expect(element).toBeVisible()); const panel = within(element);
  mocks.mutate.mockResolvedValue({ ...credential, secret: 'credential-id.ONE-TIME-SECRET' });
  fireEvent.change(panel.getByLabelText('凭据名称'), { target: { value: '集成平台' } }); fireEvent.click(panel.getByRole('button', { name: '创建凭据' }));
  const secret = await panel.findByText('credential-id.ONE-TIME-SECRET'); await waitFor(() => expect(secret).toBeVisible());
  expect(Object.values(localStorage).join('')).not.toContain('ONE-TIME-SECRET');
  rendered.unmount(); expect(screen.queryByText('credential-id.ONE-TIME-SECRET')).not.toBeInTheDocument();
});

it('explains an unrecoverable one-time secret after an idempotent credential retry', async () => {
  mocks.mutate.mockResolvedValue(credential); view(); const element = screen.getByRole('dialog', { name: 'MES质量推送凭据' });
  await waitFor(() => expect(element).toBeVisible()); const panel = within(element);
  fireEvent.change(panel.getByLabelText('凭据名称'), { target: { value: '原请求' } }); fireEvent.click(panel.getByRole('button', { name: '创建凭据' }));
  const lost = await panel.findByText(/原文无法恢复/); await waitFor(() => expect(lost).toBeVisible()); expect(panel.getByText(credential.id)).toBeVisible();
});
