import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, createAdminMutation } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { getLedgerSessionEpoch } from '../../ui/ledger/preferences';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ConsoleTheme } from '../ConsoleTheme';
import { EndpointEditor } from './EndpointEditor';
import type { Endpoint, IntegrationScope } from './integration-ui';

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), createAdminMutation: vi.fn(() => mocks.mutate) }));
const organizationId = '22222222-2222-4222-8222-222222222222';
const endpointId = '33333333-3333-4333-8333-333333333333';
let scope: IntegrationScope;
const endpoint: Endpoint = { id: endpointId, organizationId, code: 'MES_QUALITY', name: 'MES质量推送', description: '', sourceCode: 'MES', sourceName: '制造系统', status: 'DRAFT', version: 1,
  returnReceipt: true, maxBodyBytes: 1048576, ratePerMinute: 60, bodyRetentionDays: 7, capacityBytes: 268435456, usedBodyBytes: 0, allowedIps: [],
  createdAt: '2026-11-09T03:00:00.000Z', updatedAt: '2026-11-09T03:00:00.000Z', publicUrl: 'https://qms.example.test/receive' };
function view(existing?: Endpoint) {
  return render(<LanguageProvider><ConsoleTheme><MemoryRouter><UnsavedChangesProvider><EndpointEditor scope={scope} endpoint={existing} close={vi.fn()} saved={vi.fn()} /></UnsavedChangesProvider></MemoryRouter></ConsoleTheme></LanguageProvider>);
}
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development'); vi.clearAllMocks(); mocks.mutate.mockResolvedValue(endpoint);
  const session = `INTERNAL:${organizationId}:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
  useWorkTabsStore.getState().bindSession(session);
  scope = { organizationId, session, epoch: getLedgerSessionEpoch(), permissions: ['integration:read', 'integration:manage'], deny: vi.fn() };
});

it('defaults the per-interface receipt switch on and sends its chosen value with target scope', async () => {
  view(); const dialog = within(screen.getByRole('dialog', { name: '新增接收接口' }));
  const receipt = dialog.getByRole('switch', { name: '返回接收回执' }); expect(receipt).toBeChecked();
  act(() => {
    fireEvent.click(receipt);
    fireEvent.change(dialog.getByLabelText('接口编码'), { target: { value: 'ERP_QUALITY' } });
    fireEvent.change(dialog.getByLabelText('接口名称'), { target: { value: 'ERP质量推送' } });
    fireEvent.change(dialog.getByLabelText('来源系统编码'), { target: { value: 'ERP' } });
    fireEvent.change(dialog.getByLabelText('来源系统名称'), { target: { value: '资源计划系统' } });
  });
  fireEvent.click(dialog.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledWith('/api/v1/admin/integrations/endpoints', 'POST', expect.objectContaining({ organizationId, code: 'ERP_QUALITY', name: 'ERP质量推送', returnReceipt: false }), expect.any(AbortSignal)));
  expect(createAdminMutation).toHaveBeenCalled();
});

it('preserves an edited draft after a version conflict and locks its source and code', async () => {
  view(endpoint); const dialog = within(screen.getByRole('dialog', { name: '编辑接收接口' }));
  expect(dialog.getByLabelText('接口编码')).toBeDisabled(); expect(dialog.getByLabelText('来源系统编码')).toBeDisabled();
  fireEvent.change(dialog.getByLabelText('接口名称'), { target: { value: '质量接收新名称' } });
  mocks.mutate.mockRejectedValueOnce(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'conflict', traceId: 'conflict-trace' }, 409));
  fireEvent.click(dialog.getByRole('button', { name: /保\s*存/ }));
  const conflict = await dialog.findByText('配置已变化，请保留当前输入，刷新后重新编辑');
  await waitFor(() => expect(conflict).toBeVisible());
  expect(dialog.getByLabelText('接口名称')).toHaveValue('质量接收新名称');
  expect(mocks.mutate).toHaveBeenCalledWith(`/api/v1/admin/integrations/endpoints/${endpointId}`, 'PATCH', expect.objectContaining({ organizationId, expectedVersion: 1 }), expect.any(AbortSignal));
});
