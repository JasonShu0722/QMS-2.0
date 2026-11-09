import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, createAdminMutation } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ConsoleTheme } from '../ConsoleTheme';
import type { ConsoleContext } from '../console-navigation';
import { ApiIntegrationsPage } from './ApiIntegrationsPage';

const mocks = vi.hoisted(() => ({ context: {} as ConsoleContext, refresh: vi.fn(), invalidate: vi.fn(), mutate: vi.fn() }));
vi.mock('../ConsoleLayout', () => ({ useConsoleContext: () => mocks }));
vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn(), createAdminMutation: vi.fn(() => mocks.mutate) }));
const read = vi.mocked(apiRequest);
const homeId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const endpointId = '33333333-3333-4333-8333-333333333333';
const permissions = ['integration:read', 'integration:manage', 'integration:credentials:manage', 'integration:receipts:read', 'integration:payload:read'];
const home = { id: homeId, code: 'HOME', name: '会话组织', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
const target = { ...home, id: targetId, code: 'TARGET', name: '目标组织' };
function context(codes = permissions): ConsoleContext {
  return { actor: { id: actorId, accountType: 'INTERNAL', homeOrganization: home }, targetOrganization: target, organizations: [home, target], hasPlatformAdministrator: true,
    modules: [{ key: 'api-integrations', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: targetId, permissions: codes }] };
}
function endpoint(organizationId = targetId) {
  return { id: endpointId, organizationId, code: 'MES_QUALITY', name: 'MES质量推送', description: '', sourceCode: 'MES', sourceName: '制造系统', status: 'DRAFT', version: 1,
    returnReceipt: true, maxBodyBytes: 1048576, ratePerMinute: 60, bodyRetentionDays: 7, capacityBytes: 268435456, usedBodyBytes: 0, allowedIps: [],
    createdAt: '2026-11-09T03:00:00.000Z', updatedAt: '2026-11-09T03:00:00.000Z', publicUrl: `https://qms.example.test/api/v1/integrations/inbound/${endpointId}/messages` };
}
function view() {
  const tree = () => <LanguageProvider><ConsoleTheme><MemoryRouter><UnsavedChangesProvider><ApiIntegrationsPage /></UnsavedChangesProvider></MemoryRouter></ConsoleTheme></LanguageProvider>;
  const result = render(tree()); return { ...result, update: () => result.rerender(tree()) };
}
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development'); vi.clearAllMocks(); read.mockReset(); mocks.mutate.mockReset(); mocks.context = context();
  useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:${actorId}`);
  read.mockResolvedValue({ items: [endpoint()], total: 1, page: 1, limit: 20 });
  mocks.mutate.mockResolvedValue(endpoint());
});
afterEach(() => { vi.unstubAllEnvs(); localStorage.clear(); });

it('requires an explicit scoped integration capability even for a platform marker', () => {
  mocks.context = { ...context(), modules: [] }; view();
  expect(screen.getByRole('alert')).toHaveTextContent('无权访问API接口管理'); expect(read).not.toHaveBeenCalled();
});

it('provides real receiver and receipt tabs and only a reserved outbound tab', async () => {
  view(); expect(await screen.findByText('MES质量推送')).toBeVisible();
  const query = new URL(read.mock.calls[0]![0], 'http://localhost').searchParams;
  expect(query.get('organizationId')).toBe(targetId); expect(query.get('limit')).toBe('20');
  fireEvent.click(screen.getByRole('tab', { name: '发出接口' }));
  expect(await screen.findByText('后续开放')).toBeVisible();
  expect(screen.queryByRole('button', { name: /发送|投递|重放/ })).not.toBeInTheDocument();
});

it('keeps interface maintenance unavailable to receipt-only or configuration readers', async () => {
  mocks.context = context(['integration:read']); view(); await screen.findByText('MES质量推送');
  expect(screen.queryByRole('button', { name: '新增接收接口' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /编辑|凭据/ })).not.toBeInTheDocument();
});

it('refuses endpoint results attributed to another organization', async () => {
  read.mockResolvedValue({ items: [endpoint(homeId)], total: 1, page: 1, limit: 20 }); view();
  await waitFor(() => expect(mocks.invalidate).toHaveBeenCalled()); expect(screen.queryByText('MES质量推送')).not.toBeInTheDocument();
});

it('retires pending private results during an A to B to A session transition', async () => {
  let resolve!: (value: unknown) => void;
  read.mockReturnValue(new Promise(done => { resolve = done; })); view();
  act(() => { useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:other`); useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:${actorId}`); });
  await act(async () => resolve({ items: [endpoint()], total: 1, page: 1, limit: 20 }));
  expect(screen.queryByText('MES质量推送')).not.toBeInTheDocument();
});

it('provides a copyable curl example with placeholder credentials and an unchanged payload file', async () => {
  view(); await screen.findByText('MES质量推送');
  fireEvent.click(screen.getByRole('button', { name: '查看MES质量推送调用说明' }));
  const instructions = within(screen.getByRole('region', { name: '调用说明' }));
  const command = instructions.getByLabelText('调用示例');
  expect(command).toHaveTextContent('curl --request POST');
  expect(command).toHaveTextContent(endpoint().publicUrl);
  expect(command).toHaveTextContent('Authorization: Bearer <credentialId>.<secret>');
  expect(command).toHaveTextContent('Idempotency-Key: example-message-001');
  expect(command).toHaveTextContent('Content-Type: application/json');
  expect(command).toHaveTextContent('--data-binary "@payload.json"');
});
