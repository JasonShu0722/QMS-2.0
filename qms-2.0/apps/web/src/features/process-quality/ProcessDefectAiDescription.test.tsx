import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken, getSession } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ProcessDefectLedgerPage } from './ProcessDefectLedgerPage';

vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
const defect = { id: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222', description: '人工保留的描述', descriptionDirect: '现象：松脱\n位置：0', descriptionAi: '<b>AI建议</b>', descriptionSource: 'MANUAL', descriptionAiStatus: 'SUGGESTED', descriptionTaskId: 'task-1', descriptionInput: [{ path: 'fault', label: '现象', value: '松脱' }], defectQuantity: 1, sourceKind: 'IMS', version: 4, evidence: [], materials: [] };
const task = { id: 'task-1', defectId: defect.id, status: 'SUGGESTED', result: '<b>AI建议</b>', version: 2, ruleVersion: 3, attempts: 1, connectionVersion: 2, errorCode: null, updatedAt: '2026-11-16T00:00:00Z' };
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development'); localStorage.clear();
  useWorkTabsStore.getState().bindSession(`INTERNAL:${defect.organizationId}:actor`);
  vi.mocked(csrfToken).mockResolvedValue('csrf');
  vi.mocked(getSession).mockResolvedValue({ userId: 'actor', organizationId: defect.organizationId, accountType: 'INTERNAL', landingPath: '/app/workbench' });
  vi.mocked(apiRequest).mockReset().mockImplementation(async path => {
    if (path.includes('/my-permissions')) return { permissions: ['process-quality:defects:read', 'process-quality:defects:write', 'ingestion:read', 'ingestion:run'] } as never;
    if (path.includes('/ai-tasks?')) return { items: [task], total: 1 } as never;
    if (path.endsWith('/issues')) return [] as never;
    if (path.endsWith(`/${defect.id}`)) return defect as never;
    return { items: [defect], total: 1, page: 1, pageSize: 20 } as never;
  });
});
afterEach(() => vi.unstubAllEnvs());
function mount() { return render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><ProcessDefectLedgerPage /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>); }
it('AI description keeps manual text as the ledger body and exposes late AI only for explicit adoption', async () => {
  mount();
  expect(await screen.findByText('人工保留的描述')).toBeVisible();
  fireEvent.click(screen.getByLabelText('查看详情', { selector: 'button' }));
  const sources = within(await screen.findByLabelText('描述来源'));
  expect(sources.getByText('现象：松脱 位置：0')).toBeVisible();
  expect(sources.getByText('<b>AI建议</b>')).toBeVisible();
  expect(await sources.findByRole('button', { name: '采用AI建议' })).toBeEnabled();
  expect(screen.getAllByText('人工保留的描述').length).toBeGreaterThan(0);
  expect(document.querySelector('.process-ai-description b')).not.toBeInTheDocument();
  expect(vi.mocked(apiRequest).mock.calls.some(([path, init]) => path.includes('/adopt') && init?.method === 'POST')).toBe(false);
});
it('AI description source inspection has no retry or adoption for an unauthorized reader', async () => {
  const original = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, ...args) => path.includes('/my-permissions') ? { permissions: ['process-quality:defects:read', 'ingestion:read'] } as never : original(path, ...args));
  mount(); await screen.findByText('人工保留的描述');
  fireEvent.click(screen.getByLabelText('查看详情', { selector: 'button' }));
  const sources = within(await screen.findByLabelText('描述来源'));
  expect(sources.queryByRole('button', { name: '采用AI建议' })).not.toBeInTheDocument();
  expect(sources.queryByRole('button', { name: '重试AI整理' })).not.toBeInTheDocument();
  expect(sources.queryByRole('button', { name: '重新生成AI描述' })).not.toBeInTheDocument();
});
it('regenerates an existing result and tracks the replacement task without changing manual text', async () => {
  const original = vi.mocked(apiRequest).getMockImplementation()!;
  const replacement = { ...task, id: 'task-2', status: 'PENDING', result: null, version: 1 };
  let regenerated = false;
  vi.mocked(apiRequest).mockImplementation(async (path, init, ...args) => {
    if (path.endsWith('/task-1/regenerate') && init?.method === 'POST') {
      regenerated = true;
      return replacement as never;
    }
    if (regenerated && path.includes('/ai-tasks?')) return { items: [replacement, task] } as never;
    if (regenerated && path.includes(`/defects/${defect.id}?`)) {
      return { ...defect, descriptionTaskId: replacement.id, descriptionAiStatus: 'PENDING', descriptionAi: null } as never;
    }
    return original(path, init, ...args);
  });
  mount(); await screen.findByText('人工保留的描述');
  fireEvent.click(screen.getByLabelText('查看详情', { selector: 'button' }));
  const sources = within(await screen.findByLabelText('描述来源'));
  fireEvent.click(await sources.findByRole('button', { name: '重新生成AI描述' }));
  expect(await sources.findByText('等待整理')).toBeVisible();
  expect(sources.getByRole('button', { name: '重新生成AI描述' })).toBeDisabled();
  expect(screen.getAllByText('人工保留的描述').length).toBeGreaterThan(0);
  const request = vi.mocked(apiRequest).mock.calls.find(([path]) => path.endsWith('/task-1/regenerate'));
  expect(JSON.parse(String(request?.[1]?.body))).toEqual({ organizationId: defect.organizationId, expectedVersion: task.version });
});
it('AI description retries a failed task with the same body and idempotency key after an unknown result', async () => {
  const original = vi.mocked(apiRequest).getMockImplementation()!; let attempts = 0;
  vi.mocked(apiRequest).mockImplementation(async (path, init, ...args) => {
    if (path.includes('/ai-tasks?')) return { items: [{ ...task, status: 'FAILED', errorCode: 'AI_CONNECTION_TIMEOUT', result: null }] } as never;
    if (path.endsWith('/task-1/retry') && init?.method === 'POST') { attempts += 1; if (attempts === 1) throw new TypeError('network'); return { ...task, status: 'PENDING', version: 3 } as never; }
    return original(path, init, ...args);
  });
  mount(); await screen.findByText('人工保留的描述');
  fireEvent.click(screen.getByLabelText('查看详情', { selector: 'button' }));
  const sources = within(await screen.findByLabelText('描述来源'));
  expect(await sources.findByText('AI 服务请求超时')).toBeVisible();
  expect(sources.getByText(task.id)).toBeVisible();
  fireEvent.click(await sources.findByRole('button', { name: '重试AI整理' }));
  const retry = await sources.findByRole('button', { name: '重试原请求' });
  expect(retry).toBeEnabled(); fireEvent.click(retry);
  await waitFor(() => expect(attempts).toBe(2));
  const writes = vi.mocked(apiRequest).mock.calls.filter(([path, init]) => path.endsWith('/task-1/retry') && init?.method === 'POST');
  expect(writes[1][1]?.body).toBe(writes[0][1]?.body);
  expect(writes[1][1]?.headers).toEqual(writes[0][1]?.headers);
  expect(JSON.parse(String(writes[0][1]?.body))).toEqual({ organizationId: defect.organizationId, expectedVersion: 2 });
});
it('AI description adoption requires explicit confirmation before writing over manual text', async () => {
  const original = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init, ...args) => path.endsWith('/task-1/adopt') && init?.method === 'POST' ? { ...task, status: 'APPLIED', version: 3 } as never : original(path, init, ...args));
  mount(); await screen.findByText('人工保留的描述');
  fireEvent.click(screen.getByLabelText('查看详情', { selector: 'button' }));
  const sources = within(await screen.findByLabelText('描述来源'));
  fireEvent.click(await sources.findByRole('button', { name: '采用AI建议' }));
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.endsWith('/adopt'))).toBe(false);
  const confirmation = (await screen.findByText('采用AI建议', { selector: '.ant-modal-title' })).closest('[role="dialog"]') as HTMLElement;
  fireEvent.click(within(confirmation).getByRole('button', { name: '确认采用' }));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path, init]) => path.endsWith('/task-1/adopt') && init?.method === 'POST')).toBe(true));
});
it('AI description refresh reads the worker result into the existing ledger description', async () => {
  const user = userEvent.setup();
  let completed = false; const original = vi.mocked(apiRequest).getMockImplementation()!;
  const updated = { ...defect, description: 'AI整理后的正文', descriptionAi: 'AI整理后的正文', descriptionSource: 'AI', descriptionAiStatus: 'APPLIED', version: 5 };
  vi.mocked(apiRequest).mockImplementation(async (path, init, ...args) => {
    if (completed && path.includes('/ai-tasks?')) return { items: [{ ...task, status: 'APPLIED', result: updated.description, version: 3 }] } as never;
    if (completed && path.includes('/process-quality/defects') && !path.endsWith('/issues')) return path.includes(`/defects/${defect.id}`) ? updated as never : { items: [updated], total: 1, page: 1, pageSize: 20 } as never;
    return original(path, init, ...args);
  });
  mount(); await screen.findByText('人工保留的描述');
  fireEvent.click(screen.getByLabelText('查看详情', { selector: 'button' }));
  const sources = within(await screen.findByLabelText('描述来源'));
  await sources.findByRole('button', { name: '采用AI建议' });
  const refresh = sources.getByRole('button', { name: '刷新整理状态' });
  await waitFor(() => expect(refresh).not.toHaveClass('ant-btn-loading')); completed = true; await user.click(refresh);
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`/api/v1/process-quality/defects/${defect.id}?organizationId=${defect.organizationId}`, { signal: expect.any(AbortSignal) }));
  const drawer = within(screen.getByText('不良品详情', { selector: '.ant-drawer-title' }).closest('.ant-drawer-header') as HTMLElement);
  await user.click(drawer.getByRole('button', { name: /关闭|close/i }));
  await waitFor(() => { const button = document.querySelector('main button.process-quality-detail-link'); expect(button).toHaveAccessibleName('AI整理后的正文'); expect(button).toBeVisible(); });
  expect(vi.mocked(apiRequest).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
it('AI description ignores an earlier task when the current source has returned to direct composition', async () => {
  const direct = { ...defect, description: '当前直接组合', descriptionDirect: '当前直接组合', descriptionAi: null, descriptionAiStatus: 'DISABLED', descriptionSource: 'DIRECT' };
  const original = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init, ...args) => {
    if (path.includes('/process-quality/defects') && !path.endsWith('/issues')) return path.includes(`/defects/${defect.id}`) ? direct as never : { items: [direct], total: 1, page: 1, pageSize: 20 } as never;
    return original(path, init, ...args);
  });
  mount(); await screen.findByText('当前直接组合');
  fireEvent.click(screen.getByLabelText('查看详情', { selector: 'button' }));
  const sources = within(await screen.findByLabelText('描述来源'));
  expect(sources.queryByRole('button', { name: '刷新整理状态' })).not.toBeInTheDocument();
  expect(sources.queryByText('AI结果')).not.toBeInTheDocument();
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('/ai-tasks?'))).toBe(false);
});
