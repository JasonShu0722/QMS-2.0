import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { getLedgerSessionEpoch } from '../../ui/ledger/preferences';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ConsoleTheme } from '../ConsoleTheme';
import { ReceiptList } from './ReceiptList';
import type { IntegrationScope } from './integration-ui';

vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn() }));
const read = vi.mocked(apiRequest);
const organizationId = '22222222-2222-4222-8222-222222222222';
const receiptId = '44444444-4444-4444-8444-444444444444';
const endpointId = '33333333-3333-4333-8333-333333333333';
const traceId = '55555555-5555-4555-8555-555555555555';
const receipt = { id: receiptId, organizationId, endpointId, credentialId: traceId, messageId: 'message-001', sourceCode: 'MES', sourceName: '制造来源', configurationVersion: 2,
  receivedAt: '2026-11-09T03:00:00.000Z', bodyExpiresAt: '2026-11-16T03:00:00.000Z', metadataExpiresAt: '2027-02-07T03:00:00.000Z', bodyAvailable: true, payloadBytes: 20 };
let scope: IntegrationScope;
function page(path: string) {
  const query = new URL(path, 'http://localhost').searchParams;
  return { items: [receipt], total: 1, page: Number(query.get('page') ?? 1), limit: Number(query.get('limit') ?? 20), from: query.get('from'), to: query.get('to') };
}
function view() {
  return render(<LanguageProvider><ConsoleTheme><MemoryRouter><UnsavedChangesProvider><ReceiptList scope={scope} /></UnsavedChangesProvider></MemoryRouter></ConsoleTheme></LanguageProvider>);
}
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development'); vi.clearAllMocks(); read.mockReset(); localStorage.clear();
  const session = `INTERNAL:${organizationId}:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`; useWorkTabsStore.getState().bindSession(session);
  scope = { organizationId, session, epoch: getLedgerSessionEpoch(), permissions: ['integration:receipts:read', 'integration:payload:read'], deny: vi.fn() };
  read.mockImplementation(async path => path.includes('/status') ? { usedBodyBytes: 20, capacityBytes: 1073741824, receiptCount: 1, receiptLimit: 100000, requestCollection: 'UNKNOWN' } : page(path));
});
afterEach(() => { vi.unstubAllEnvs(); localStorage.clear(); });

it('reads receipt metadata in the verified organization without requiring configuration access', async () => {
  scope.permissions = ['integration:receipts:read']; view();
  expect(await screen.findByText('message-001')).toBeVisible();
  const query = new URL(read.mock.calls.find(([path]) => path.includes('/receipts?'))![0], 'http://localhost').searchParams;
  expect(query.get('organizationId')).toBe(organizationId); expect(query.get('limit')).toBe('20');
  expect(read.mock.calls.some(([path]) => path.includes('/endpoints'))).toBe(false);
});

it('does not disclose a payload or provide a payload action without its separate permission', async () => {
  scope.permissions = ['integration:receipts:read']; view(); await screen.findByText('message-001');
  fireEvent.click(screen.getByRole('button', { name: '查看消息message-001' }));
  const dialog = within(await screen.findByRole('dialog', { name: '接收详情' }));
  expect(dialog.queryByRole('button', { name: '查看接收正文' })).not.toBeInTheDocument();
  expect(read.mock.calls.some(([path]) => path.includes('/payload'))).toBe(false);
});

it('renders an authorized payload as text rather than executing markup', async () => {
  const payload = '<img src=x onerror=alert(1)><script>private()</script>';
  read.mockImplementation(async path => path.includes('/payload') ? { id: receiptId, text: payload, bodyExpiresAt: receipt.bodyExpiresAt }
    : path.includes('/status') ? { usedBodyBytes: 20, capacityBytes: 1073741824, receiptCount: 1, receiptLimit: 100000, requestCollection: 'UNKNOWN' } : page(path));
  view(); await screen.findByText('message-001'); fireEvent.click(screen.getByRole('button', { name: '查看消息message-001' }));
  const dialog = within(await screen.findByRole('dialog', { name: '接收详情' }));
  fireEvent.click(dialog.getByRole('button', { name: '查看接收正文' }));
  expect(await dialog.findByText(payload)).toBeVisible();
  const body = dialog.getByLabelText('接收正文'); expect(body.tagName).toBe('PRE'); expect(body.querySelector('img,script')).toBeNull();
});

it('does not reopen a closed payload detail when its response arrives late', async () => {
  let resolve!: (value: unknown) => void;
  read.mockImplementation(async path => path.includes('/payload') ? new Promise(done => { resolve = done; })
    : path.includes('/status') ? { usedBodyBytes: 20, capacityBytes: 1073741824, receiptCount: 1, receiptLimit: 100000, requestCollection: 'UNKNOWN' } : page(path));
  view(); await screen.findByText('message-001'); fireEvent.click(screen.getByRole('button', { name: '查看消息message-001' }));
  const dialog = within(await screen.findByRole('dialog', { name: '接收详情' })); fireEvent.click(dialog.getByRole('button', { name: '查看接收正文' }));
  fireEvent.click(dialog.getByRole('button', { name: '关闭' }));
  await act(async () => resolve({ id: receiptId, text: 'OLD_PRIVATE_PAYLOAD', bodyExpiresAt: receipt.bodyExpiresAt }));
  expect(screen.queryByText('OLD_PRIVATE_PAYLOAD')).not.toBeInTheDocument();
});

it('rejects receipt metadata for another organization before displaying it', async () => {
  read.mockImplementation(async path => path.includes('/status') ? { usedBodyBytes: 20, capacityBytes: 1073741824, receiptCount: 1, receiptLimit: 100000, requestCollection: 'UNKNOWN' }
    : { ...page(path), items: [{ ...receipt, organizationId: endpointId }] });
  view(); await waitFor(() => expect(scope.deny).toHaveBeenCalled()); expect(screen.queryByText('message-001')).not.toBeInTheDocument();
});

it('queries request outcomes by their server trace ID and exposes collection gaps', async () => {
  read.mockImplementation(async path => path.includes('/attempts') ? { ...page(path), collectionStatus: 'UNAVAILABLE', items: [{ id: traceId, traceId, organizationId, endpointId, credentialId: receiptId,
    messageId: 'message-001', configurationVersion: 2, returnReceipt: false, statusCode: 409, outcome: 'REJECTED', reasonCode: 'INTEGRATION_MESSAGE_CONFLICT', durationMs: 4, observedAt: receipt.receivedAt }] }
    : path.includes('/status') ? { usedBodyBytes: 20, capacityBytes: 1073741824, receiptCount: 1, receiptLimit: 100000, requestCollection: 'UNAVAILABLE' } : page(path));
  view(); await screen.findByText('message-001');
  fireEvent.mouseDown(screen.getByLabelText('记录视图', { selector: 'input' })); fireEvent.click(await screen.findByText('请求结果', { selector: '.ant-select-item-option-content' }));
  expect(await screen.findByText('INTEGRATION_MESSAGE_CONFLICT')).toBeVisible(); expect(screen.getByText('请求明细采集不可用，部分请求可能没有记录')).toBeVisible();
  fireEvent.change(screen.getByLabelText('请求追踪号', { selector: 'input' }), { target: { value: traceId } }); fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
  await waitFor(() => expect(read.mock.calls.some(([path]) => path.includes(`traceId=${traceId}`))).toBe(true));
});

it('filters both receiving views by a trimmed source code and resets it when switching views', async () => {
  read.mockImplementation(async path => path.includes('/attempts') ? { ...page(path), items: [], total: 0, collectionStatus: 'UNKNOWN' }
    : path.includes('/status') ? { usedBodyBytes: 20, capacityBytes: 1073741824, receiptCount: 1, receiptLimit: 100000, requestCollection: 'UNKNOWN' } : page(path));
  view(); await screen.findByText('message-001');
  fireEvent.change(screen.getByLabelText('来源系统编码', { selector: 'input' }), { target: { value: ' MES ' } });
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
  await waitFor(() => expect(read.mock.calls.some(([path]) => path.includes('/receipts?') && new URL(path, 'http://localhost').searchParams.get('sourceCode') === 'MES')).toBe(true));
  fireEvent.mouseDown(screen.getByLabelText('记录视图', { selector: 'input' }));
  fireEvent.click(await screen.findByText('请求结果', { selector: '.ant-select-item-option-content' }));
  expect(screen.getByLabelText('来源系统编码', { selector: 'input' })).toHaveValue('');
  fireEvent.change(screen.getByLabelText('来源系统编码', { selector: 'input' }), { target: { value: ' ERP ' } });
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
  await waitFor(() => expect(read.mock.calls.some(([path]) => path.includes('/attempts?') && new URL(path, 'http://localhost').searchParams.get('sourceCode') === 'ERP')).toBe(true));
});

it('rejects malformed or oversized source codes without requesting records', async () => {
  view(); await screen.findByText('message-001');
  const callsBeforeInvalidInput = read.mock.calls.length;
  for (const sourceCode of ['invalid source', 'A'.repeat(65)]) {
    fireEvent.change(screen.getByLabelText('来源系统编码', { selector: 'input' }), { target: { value: sourceCode } });
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(screen.getByRole('alert')).toBeVisible();
    expect(read.mock.calls).toHaveLength(callsBeforeInvalidInput);
  }
});
