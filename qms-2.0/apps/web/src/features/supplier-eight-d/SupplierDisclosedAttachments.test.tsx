import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { SupplierEightDWorkspace } from './SupplierEightDWorkspace';

type Report = components['schemas']['SupplierEightDReportDto'];
type FileDto = components['schemas']['FileDto'];
const base = '/api/v1/supplier-portal/eight-d/supplier-1';
const file: FileDto = {
  id: 'published-file', resourceType: 'supplier-eight-d-disclosure', resourceId: 'supplier-1', originalName: 'supplier-public.txt',
  contentType: 'text/plain', sizeBytes: 6, sha256: 'a'.repeat(64), status: 'AVAILABLE', scanStatus: 'CLEAN', scanReason: null,
  version: 3, uploadExpiresAt: '2026-10-28T00:00:00Z', scannedAt: '2026-10-28T00:00:00Z', deletedAt: null, retainUntil: '2099-01-01T00:00:00Z',
};
const report: Report = {
  supplierProblemId: 'supplier-1', problemId: 'problem-1', organizationId: 'org-1', instanceId: 'instance-1', workflowVersionId: 'flow-1',
  title: 'Released supplier problem', reportNumber: 'SQ-001', severity: 'HIGH', status: 'PROCESSING', rowVersion: 4, contentVersion: 6, instanceVersion: 2,
  sqeUserId: 'sqe-1', sqeAssignmentId: 'assignment-1', responsibleSectionDepartmentId: 'section-1',
  submittedRevisionId: null, approvedRevisionId: null, analysisDueAt: null, analysisCompletedAt: null, submissionDueAt: null, submittedAt: null,
  closureDueAt: null, closedAt: null, releasedToSupplierAt: '2026-10-28T00:00:00Z', closure: null, allowedActions: ['read', 'save', 'submit'],
  document: { description: 'Supplier response stays independent', okFileIds: [], ngFileIds: [], temporaryMeasures: [], containment: [], optionalAffectedContainment: [], analysisProcess: '', analysisFileIds: [], occurrenceCause: '', escapeCause: '', systemCause: '', correctiveActions: [], horizontalDeployment: [], standardization: [], closureSummary: '' },
};
let fetcher: ReturnType<typeof vi.fn>;
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }
function view(id = 'supplier-1', denied = vi.fn()) {
  return <LanguageProvider><MemoryRouter><UnsavedChangesProvider><SupplierEightDWorkspace supplierProblemId={id} portal onDenied={denied} /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>;
}
function section() { return screen.getByRole('region', { name: '已披露附件' }); }
beforeEach(() => {
  vi.unstubAllGlobals(); localStorage.clear(); useWorkTabsStore.getState().reset();
  useWorkTabsStore.getState().bindSession('SUPPLIER:vendor-1:vendor-user');
  fetcher = vi.fn(async (path: string, init: RequestInit = {}) => {
    if (path === '/api/v1/auth/csrf') return json({ csrfToken: 'csrf' });
    if (path === '/api/v1/auth/session') return json({ user: { accountType: 'SUPPLIER', organizationId: 'vendor-1', id: 'vendor-user' }, securityState: 'AUTHENTICATED', landingPath: '/supplier/inbox' });
    if (path === `${base}/disclosure-attachments`) return json([file]);
    if (path === '/api/v1/files/published-file') return json(file);
    if (path === base && init.method === 'PUT') return json(report);
    if (path === base) return json(report);
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetcher);
});

it('reads the allowlist with a signal, mounts explicit IDs read-only and never writes them to response evidence', async () => {
  render(view());
  const region = within(await screen.findByRole('region', { name: '已披露附件' }));
  await region.findByText(file.originalName);
  expect(region.getByRole('button', { name: '下载附件' })).toBeEnabled();
  expect(region.queryByLabelText('选择附件')).not.toBeInTheDocument();
  expect(region.queryByRole('button', { name: '删除附件' })).not.toBeInTheDocument();
  expect(region.queryByRole('button', { name: '重试安全扫描' })).not.toBeInTheDocument();
  const request = fetcher.mock.calls.find(([path]) => path === `${base}/disclosure-attachments`)!;
  expect(request[1].signal).toBeInstanceOf(AbortSignal);
  expect(request[1].signal.aborted).toBe(false);
  expect(fetcher.mock.calls.filter(([path]) => String(path).startsWith('/api/v1/files/')).map(([path]) => path)).toEqual(['/api/v1/files/published-file']);
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(fetcher.mock.calls.some(([path, init]) => path === base && init.method === 'PUT')).toBe(true));
  const write = fetcher.mock.calls.find(([path, init]) => path === base && init.method === 'PUT')!;
  expect(JSON.parse(write[1].body).document).toEqual(report.document);
});

it('shows loading, then an empty panel only after an actual released empty selection response', async () => {
  let release!: (response: Response) => void;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path: string, init: RequestInit = {}) => path === `${base}/disclosure-attachments` ? new Promise<Response>(resolve => { release = resolve; }) : original(path, init));
  render(view());
  await waitFor(() => expect(release).toBeTypeOf('function'));
  expect(within(section()).getByLabelText('正在加载已披露附件')).toBeVisible();
  expect(within(section()).queryByText('暂无附件')).not.toBeInTheDocument();
  await act(async () => release(json([])));
  await within(section()).findByText('暂无附件');
  expect(fetcher.mock.calls.some(([path]) => String(path).startsWith('/api/v1/files/'))).toBe(false);
});

it.each([404, 500])('does not disguise listing %s as empty and explicitly retries', async status => {
  let failed = true;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path: string, init: RequestInit = {}) => path === `${base}/disclosure-attachments` && failed ? Promise.resolve(json({ code: 'READ_FAILED', message: 'refused' }, status)) : original(path, init));
  render(view());
  await screen.findByText('已披露附件读取失败，请重试。');
  expect(within(section()).queryByText('暂无附件')).not.toBeInTheDocument();
  expect(screen.getByDisplayValue(report.document.description)).toBeVisible();
  failed = false; fireEvent.click(within(section()).getByRole('button', { name: '重试已披露附件' }));
  await within(section()).findByText(file.originalName);
});

it.each([401, 403])('revokes the whole sensitive workspace on current listing %s', async status => {
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path: string, init: RequestInit = {}) => path === `${base}/disclosure-attachments` ? Promise.resolve(json({ code: 'ACCESS_DENIED', message: 'denied' }, status)) : original(path, init));
  const denied = vi.fn(); render(view('supplier-1', denied));
  await screen.findByText(/敏感内容已清除/);
  expect(screen.queryByDisplayValue(report.document.description)).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '已披露附件' })).not.toBeInTheDocument();
  expect(denied).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls.find(([path]) => path === `${base}/disclosure-attachments`)![1].signal.aborted).toBe(true);
});

it.each([401, 403])('propagates file metadata %s through evidence scope to clear the whole page', async status => {
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path: string, init: RequestInit = {}) => path === '/api/v1/files/published-file' ? Promise.resolve(json({ code: 'FILE_RESOURCE_DENIED', message: 'denied' }, status)) : original(path, init));
  const denied = vi.fn(); render(view('supplier-1', denied));
  await screen.findByText(/敏感内容已清除/);
  expect(screen.queryByDisplayValue(report.document.description)).not.toBeInTheDocument();
  expect(denied).toHaveBeenCalledTimes(1);
});

it('shares download pending with workspace and propagates download 403 without retaining content', async () => {
  let release!: (response: Response) => void;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path: string, init: RequestInit = {}) => path === '/api/v1/files/published-file/download' ? new Promise<Response>(resolve => { release = resolve; }) : original(path, init));
  const denied = vi.fn(); render(view('supplier-1', denied));
  await screen.findByText(file.originalName);
  fireEvent.click(within(section()).getByRole('button', { name: '下载附件' }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '完整提交' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '刷新工作区' })).toBeDisabled();
  await act(async () => release(json({ code: 'FILE_RESOURCE_DENIED', message: 'denied' }, 403)));
  await screen.findByText(/敏感内容已清除/);
  expect(screen.queryByText(file.originalName)).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue(report.document.description)).not.toBeInTheDocument();
  expect(denied).toHaveBeenCalledTimes(1);
});

it.each([['id', 'success'], ['id', 'denial'], ['session', 'success'], ['session', 'denial']] as const)('aborts old listing on %s change and ignores late %s without clearing new scope', async (change, outcome) => {
  let release!: (response: Response) => void;
  let changed = false;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path: string, init: RequestInit = {}) => {
    if (path === `${base}/disclosure-attachments`) return changed ? Promise.resolve(json([])) : new Promise<Response>(resolve => { release = resolve; });
    if (changed && (path === base || path === '/api/v1/supplier-portal/eight-d/supplier-2')) return Promise.resolve(json({ ...report, supplierProblemId: change === 'id' ? 'supplier-2' : 'supplier-1', reportNumber: 'SQ-NEW', document: { ...report.document, description: 'New scope response' } }));
    if (path === '/api/v1/supplier-portal/eight-d/supplier-2/disclosure-attachments') return Promise.resolve(json([]));
    return original(path, init);
  });
  const denied = vi.fn(); const mounted = render(view('supplier-1', denied));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  const signal = fetcher.mock.calls.find(([path]) => path === `${base}/disclosure-attachments`)![1].signal as AbortSignal;
  changed = true;
  if (change === 'session') act(() => useWorkTabsStore.getState().bindSession('SUPPLIER:vendor-2:replacement'));
  else mounted.rerender(view('supplier-2', denied));
  await screen.findByDisplayValue('New scope response');
  await within(section()).findByText('暂无附件');
  expect(signal.aborted).toBe(true);
  await act(async () => release(outcome === 'success' ? json([file]) : json({ code: 'ACCESS_DENIED', message: 'old denial' }, 403)));
  expect(screen.getByDisplayValue('New scope response')).toBeVisible();
  expect(screen.queryByText(file.originalName)).not.toBeInTheDocument();
  expect(denied).not.toHaveBeenCalled();
});

it('aborts the listing on unmount instead of publishing a late response', async () => {
  let release!: (response: Response) => void;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path: string, init: RequestInit = {}) => path === `${base}/disclosure-attachments` ? new Promise<Response>(resolve => { release = resolve; }) : original(path, init));
  const denied = vi.fn(); const mounted = render(view('supplier-1', denied));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  const signal = fetcher.mock.calls.find(([path]) => path === `${base}/disclosure-attachments`)![1].signal as AbortSignal;
  mounted.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => release(json({ code: 'ACCESS_DENIED', message: 'old denial' }, 403)));
  expect(denied).not.toHaveBeenCalled();
});
