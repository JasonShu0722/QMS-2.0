import type { components } from '@qms/contracts';
import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { CustomerAnalysisPanel } from './customer-analysis-panel';

vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
const record: components['schemas']['CustomerAnalysisDto'] = { id: 'stable-analysis', organizationId: 'org', complaintId: 'complaint', section: 'FAE', version: 1, assigneeUserId: 'fae', assigneeAssignmentId: 'appointment', departmentId: 'department', text: null, progress: null, result: null, completedOn: null, failedPart: null, failedMaterialCode: null, supplierAnalysisRequired: null, fileIds: [], faeStatus: 'NOT_ANALYSED', updatedByUserId: 'qe', updatedAt: '2026-10-26T10:00:00Z' };
const resource = { resourceType: 'customer-complaint-analysis', resourceId: record.id };
const file: components['schemas']['FileDto'] = { ...resource, id: 'file', originalName: 'analysis.txt', contentType: 'text/plain', sizeBytes: 6, sha256: 'a'.repeat(64), version: 2, status: 'QUARANTINED', scanStatus: 'PENDING', scanReason: null, uploadExpiresAt: '2026-10-27T12:00:00Z', scannedAt: null, deletedAt: null, retainUntil: '2026-11-27T12:00:00Z' };
let clean: boolean;
let failInitialization: boolean;
beforeEach(() => {
  useWorkTabsStore.getState().reset(); clean = false; failInitialization = false;
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null)));
  vi.mocked(getSession).mockReset().mockResolvedValue({ userId: 'fae', organizationId: 'org', accountType: 'INTERNAL', landingPath: '/app/workbench' });
  vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockReset().mockImplementation(async (path, init) => {
    if (path.startsWith('/api/v1/system/my-permissions')) return { organizationId: 'org', permissions: ['customer-quality:complaints:read', 'customer-quality:complaints:write', 'customer-quality:analyses:fae'] } as never;
    if (path.startsWith('/api/v1/customer-quality/ledger/')) return { id: 'complaint', organizationId: 'org', status: 'FOLLOWING', qualityEngineerId: 'qe', qualityEngineerAssignmentId: 'qe-appointment' } as never;
    if (path.endsWith('/complaints/complaint')) return { complaintId: 'complaint', fae: record, supplier: null } as never;
    if (path === '/api/v1/files/uploads') {
      if (failInitialization) throw new TypeError('initialization response lost');
      return { file: { ...file, version: 1, scanStatus: 'WAITING_UPLOAD' }, uploadUrl: 'https://objects.example.test/upload', headers: {} } as never;
    }
    if (path.endsWith('/complete')) return file as never;
    if (path === '/api/v1/files/file') return (clean ? { ...file, version: 3, status: 'AVAILABLE', scanStatus: 'CLEAN' } : file) as never;
    if (path.endsWith('/fae') && init?.method === 'PUT') return { ...record, ...JSON.parse(String(init.body)), version: 2, faeStatus: clean ? 'ANALYSED' : 'NOT_ANALYSED' } as never;
    throw new ApiError({ code: 'UNEXPECTED_TEST_REQUEST', message: path }, 400);
  });
});
afterEach(() => vi.unstubAllGlobals());
function mount() { return render(<MemoryRouter><CustomerAnalysisPanel complaintId="complaint" /></MemoryRouter>); }
function sample() {
  const selected = new File(['sample'], 'analysis.txt', { type: 'text/plain' });
  Object.defineProperty(selected, 'arrayBuffer', { value: async () => new TextEncoder().encode('sample').buffer });
  return selected;
}

it('runs the real shared upload/complete/CLEAN lifecycle against the stable analysis resource before saving evidence', async () => {
  mount(); fireEvent.change(await screen.findByLabelText('选择附件'), { target: { files: [sample()] } });
  await screen.findByText('等待安全扫描');
  expect(screen.getByRole('button', { name: '保存 FAE 解析' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '同部门转派 FAE' })).toBeDisabled();
  expect(screen.getByText('未解析')).toBeVisible();
  const initialize = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/api/v1/files/uploads')!;
  expect(JSON.parse(String(initialize[1]?.body))).toMatchObject(resource);
  clean = true; fireEvent.click(screen.getByRole('button', { name: '刷新附件' }));
  await screen.findByText('扫描通过，可作为证据');
  await waitFor(() => expect(screen.getByRole('button', { name: '保存 FAE 解析' })).toBeEnabled());
  expect(screen.getByText('未解析')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '保存 FAE 解析' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/analysis/stable-analysis/fae', expect.objectContaining({ body: expect.stringContaining('"fileIds":["file"]') }), { replayAfterReauthentication: false }));
  await screen.findByText('已解析');
  expect(fetch).toHaveBeenCalledWith('https://objects.example.test/upload', expect.objectContaining({ method: 'PUT', credentials: 'omit', signal: expect.any(AbortSignal) }));
});

it('does not treat a selected file or an unknown reservation response as a successful upload', async () => {
  failInitialization = true;
  mount(); fireEvent.change(await screen.findByLabelText('选择附件'), { target: { files: [sample()] } });
  await screen.findByRole('button', { name: '重试上传' });
  expect(screen.getByRole('button', { name: '保存 FAE 解析' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '刷新解析' })).toBeDisabled();
  expect(screen.getByText('未解析')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '放弃未关联附件' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存 FAE 解析' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: '重试上传' })).not.toBeInTheDocument();
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.endsWith('/complete'))).toBe(false);
});

it.each(['save', 'transfer', 'assign'] as const)('rechecks real attachment pending state after deferred CSRF before %s dispatch', async action => {
  let releaseCsrf!: (token: string) => void;
  let finishDownload!: () => void;
  clean = true;
  if (action === 'assign') vi.mocked(getSession).mockResolvedValue({ userId: 'qe', organizationId: 'org', accountType: 'INTERNAL', landingPath: '/app/workbench' });
  const original = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init, options) => {
    if (path.endsWith('/complaints/complaint')) return { complaintId: 'complaint', fae: { ...record, fileIds: ['file'] }, supplier: null } as never;
    if (path.includes('/candidates/')) return [{ userId: 'target', username: 'Target engineer', assignmentId: 'target-appointment', departmentId: 'department' }] as never;
    if (path === '/api/v1/files/file/download') return new Promise((_, reject) => {
      finishDownload = () => reject(new ApiError({ code: 'FILE_DOWNLOAD_UNAVAILABLE', message: '' }, 422));
    });
    if (path.endsWith('/transfer')) return { ...record, assigneeUserId: 'target', assigneeAssignmentId: 'target-appointment', version: 2 } as never;
    if (path.endsWith('/assign/SUPPLIER')) return { ...record, id: 'supplier-analysis', section: 'SUPPLIER', assigneeUserId: 'target', assigneeAssignmentId: 'target-appointment', faeStatus: null, version: 1 } as never;
    return original(path, init, options);
  });
  mount();
  await screen.findByText('扫描通过，可作为证据');
  const expectedPath = action === 'save' ? '/api/v1/customer-quality/analysis/stable-analysis/fae'
    : action === 'transfer' ? '/api/v1/customer-quality/analysis/stable-analysis/transfer'
      : '/api/v1/customer-quality/analysis/complaints/complaint/assign/SUPPLIER';
  let submit: HTMLElement;
  if (action === 'save') {
    fireEvent.change(screen.getByLabelText('FAE 解析文字'), { target: { value: 'Preserved local draft' } });
    submit = screen.getByRole('button', { name: '保存 FAE 解析' });
  } else {
    const title = action === 'transfer' ? '同部门转派 FAE' : '指定 SQE';
    const open = screen.getByRole('button', { name: title });
    await waitFor(() => expect(open).toBeEnabled());
    fireEvent.click(open);
    const dialog = await screen.findByRole('dialog', { name: title });
    fireEvent.mouseDown(await within(dialog).findByRole('combobox'));
    fireEvent.click(await screen.findByText('Target engineer · 任职 target-appointment'));
    submit = within(dialog).getByRole('button', { name: action === 'transfer' ? '确认转派' : '确认指定' });
  }
  vi.mocked(csrfToken).mockImplementationOnce(() => new Promise(resolve => { releaseCsrf = resolve; }));
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.click(submit);
  await waitFor(() => expect(csrfToken).toHaveBeenCalledTimes(1));
  // Read-only hides uploads, but downloading saved evidence still reports real pending state.
  expect(screen.queryByLabelText('选择附件')).not.toBeInTheDocument();
  const download = screen.getByRole('button', { name: '下载附件' });
  expect(download).toBeEnabled();
  fireEvent.click(download);
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/files/file/download', expect.objectContaining({ method: 'POST' })));
  expect(screen.getByLabelText('正在处理附件')).toBeInTheDocument();
  await act(async () => releaseCsrf('late-csrf'));
  const analysisWrites = () => vi.mocked(apiRequest).mock.calls.filter(([path, init]) => path.startsWith('/api/v1/customer-quality/analysis/') && !!init?.method);
  expect(analysisWrites()).toHaveLength(0);
  expect(screen.queryByText('操作结果尚未确认，当前输入已锁定。重试只发送原请求。')).not.toBeInTheDocument();
  if (action === 'save') expect(screen.getByLabelText('FAE 解析文字')).toHaveValue('Preserved local draft');
  await act(async () => finishDownload());
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.click(submit);
  await waitFor(() => expect(analysisWrites()).toHaveLength(1));
  expect(analysisWrites()[0][0]).toBe(expectedPath);
});
