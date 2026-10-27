import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { webcrypto } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ProcessEightDWorkspace } from './ProcessEightDWorkspace';

const document: components['schemas']['ProcessEightDDocumentDto'] = {
  description: 'Saved internal problem', okFileIds: [], ngFileIds: [], temporaryMeasures: [], containment: [], optionalAffectedContainment: [],
  analysisProcess: '', analysisFileIds: [], occurrenceCause: '', escapeCause: '', systemCause: '', correctiveActions: [], horizontalDeployment: [], standardization: [], closureSummary: '',
};
const initial = {
  problemId: 'p1', reportNumber: '8D-001', organizationId: 'org1', instanceId: 'i1', workflowVersionId: 'w1', instanceVersion: 3, problemVersion: 2,
  version: 7, contentVersion: 4, status: 'PROCESSING', severity: 'MEDIUM', ownerUserId: 'owner', professionalUserId: 'reviewer', responsibleSectionDepartmentId: 'section',
  collaboratorUserIds: [], document, analysisCompletedAt: null, analysisDueAt: null, submissionDueAt: null, closureDueAt: null, submittedAt: null, closedRevisionId: null,
  allowedActions: ['read', 'save', 'sources', 'reassign', 'request-extension', 'risk', 'submit'],
  sources: [{ sourceId: 'source1', primary: true, snapshot: { description: 'Source fact' } as components['schemas']['CustomerEightDReportDto']['sources'][number]['snapshot'], sourceVersion: 2 }], revisions: [],
};
const cases = [
  ['customer', 'customer-quality', 'customer-eight-d', '正式客户 8D 工作区'],
  ['new-product', 'new-product-quality', 'new-product-eight-d', '正式新品 8D 工作区'],
] as const;
let current: typeof initial;
let fetcher: ReturnType<typeof vi.fn>;
let writes: { path: string; body: string; key: string | null }[];
let failure: number | 'network' | undefined;
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
function mount(domain: 'customer' | 'new-product', renderSourcePicker?: Parameters<typeof ProcessEightDWorkspace>[0]['renderSourcePicker']) {
  const content = (value: typeof domain) => <LanguageProvider><MemoryRouter><UnsavedChangesProvider><ProcessEightDWorkspace problemId="p1" domain={value} renderSourcePicker={renderSourcePicker} /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>;
  const view = render(content(domain));
  return { ...view, changeDomain: (value: typeof domain) => view.rerender(content(value)) };
}
beforeEach(() => {
  localStorage.clear(); useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession('INTERNAL:owner:org1');
  current = structuredClone(initial); writes = []; failure = undefined;
  fetcher = vi.fn(async (path: string, init: RequestInit = {}) => {
    if (path === '/api/v1/auth/csrf') return response({ csrfToken: 'csrf' });
    if (init.body) {
      writes.push({ path, body: String(init.body), key: new Headers(init.headers).get('Idempotency-Key') });
      if (failure === 'network') throw new TypeError('Network unavailable');
      if (failure) return response({ code: 'REFUSED', message: 'Refused', fields: {} }, failure);
      const body = JSON.parse(String(init.body)); current = { ...current, version: current.version + 1, ...(body.document ? { document: body.document } : {}) };
      return response(current);
    }
    if (path.includes('/rounds')) return response([]);
    if (path.includes('/assignment-options')) return response({ departments: [], users: [], departmentTotal: 0, userTotal: 0 });
    if (path.includes('/tasks?')) return response({ items: [], total: 0 });
    if (path.includes('/files?')) return response([]);
    if (path.includes('/defects?')) return response({ items: [], total: 0 });
    if (path.includes('/report?')) return response({ problemId: 'p1', reportNumber: '8D-001', view: 'CURRENT', label: 'Saved report', attachments: [], snapshot: { document, sources: [] } });
    return response(current);
  });
  vi.stubGlobal('fetch', fetcher);
});

it.each(cases)('%s reads and saves only its fixed endpoint', async (domain, api, _resource, label) => {
  mount(domain); await screen.findByDisplayValue(document.description);
  expect(screen.getByRole('region', { name: label })).toBeVisible();
  expect(fetcher).toHaveBeenCalledWith(`/api/v1/${api}/eight-d/p1?`, expect.anything());
  fireEvent.change(screen.getByLabelText('D2 问题描述'), { target: { value: 'Edited' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].path).toBe(`/api/v1/${api}/eight-d/p1`);
  expect(JSON.parse(writes[0].body)).toEqual({ organizationId: 'org1', expectedVersion: 7, document: { ...document, description: 'Edited' } });
  expect(fetcher.mock.calls.some(([path]) => String(path).includes('/process-quality/'))).toBe(false);
});

it('shows the saved customer source facts in the editing workspace without a live source request', async () => {
  current.sources = [{ sourceId: 'complaint-1', primary: true, sourceVersion: 3,
    snapshot: { complaintNumber: 'CQ-1', normalized: { defectDescription: 'Saved complaint', componentCode: 'COMP-1' } } }];
  mount('customer');
  const facts = await screen.findByRole('region', { name: '来源基础信息' });
  expect(facts).toHaveTextContent('Saved complaint');
  expect(facts).toHaveTextContent('COMP-1');
  expect(fetcher.mock.calls.some(([path]) => String(path).startsWith('/api/v1/customer-quality/ledger/'))).toBe(false);
});

it('keeps current source cards out of the approved report tab', async () => {
  current.sources = [{ sourceId: 'complaint-current', primary: true, sourceVersion: 8,
    snapshot: { complaintNumber: 'CURRENT-1', customerName: 'Current workspace customer', normalized: { defectDescription: 'Current workspace fact' } } }];
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path: string, init?: RequestInit) => {
    if (!path.includes('/report?')) return original(path, init);
    const value: components['schemas']['ProcessEightDControlledReportDto'] = {
      problemId: 'p1', reportNumber: '8D-001', view: 'APPROVED', status: 'APPROVED', label: '批准版', revisionId: 'fixed-revision',
      contentVersion: 2, rowVersion: 4, generatedAt: '2026-10-27T00:00:00Z', attachments: [],
      snapshot: { document, sources: [{ sourceId: 'complaint-approved', sourceDomain: 'customer-quality', sourceType: 'customer-complaint', sourceVersion: 2,
        sourceSnapshot: { complaintNumber: 'APPROVED-1', customerName: 'Approved customer', normalized: { defectDescription: 'Approved fact' } } }],
      problem: {}, instance: {}, deadlines: {}, contentVersion: 2, rowVersion: 4, ownerUserId: 'owner', professionalUserId: 'reviewer',
      responsibleSectionDepartmentId: 'section', collaboratorUserIds: [], analysisCompletedAt: null, submittedAt: null },
    };
    return response(value);
  });
  mount('customer'); await screen.findByText('Current workspace customer');
  fireEvent.click(screen.getByRole('tab', { name: '报告' }));
  fireEvent.change(await screen.findByLabelText('报告版本'), { target: { value: 'APPROVED' } });
  await screen.findByText('Approved customer');
  expect(screen.queryByText('Current workspace customer')).not.toBeInTheDocument();
  expect(screen.getAllByRole('region', { name: '来源基础信息' })).toHaveLength(1);
});

it.each(cases)('%s keeps unknown writes frozen with the original body and key', async (domain, api) => {
  mount(domain); await screen.findByDisplayValue(document.description); failure = 'network';
  fireEvent.change(screen.getByLabelText('D2 问题描述'), { target: { value: 'Frozen draft' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  fireEvent.click(await screen.findByRole('button', { name: '重试原请求' }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).toEqual(writes[0]); expect(writes[0].key).toBeTruthy();
  expect(writes[0].path).toBe(`/api/v1/${api}/eight-d/p1`);
  expect(screen.getByLabelText('D2 问题描述')).toBeDisabled();
});

it.each(cases)('%s loads its assignment and extension eligibility, not process candidates', async (domain, api) => {
  mount(domain); await screen.findByDisplayValue(document.description);
  fireEvent.click(screen.getByRole('button', { name: '专业重派 / 科室内转派' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(`/api/v1/${api}/eight-d/assignment-options?`), expect.anything()));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '申请延期' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(`/api/v1/${api}/eight-d/tasks?`), expect.anything()));
});

it.each(cases)('%s fails closed without a domain source picker', async domain => {
  mount(domain); await screen.findByDisplayValue(document.description);
  fireEvent.click(screen.getByRole('button', { name: '调整来源' }));
  const dialog = within(await screen.findByRole('dialog'));
  await waitFor(() => expect(dialog.getByText('当前领域来源选择器尚未接入，不能调整来源。')).toBeVisible());
  expect(dialog.getByRole('button', { name: '确认提交' })).toBeDisabled();
  expect(fetcher.mock.calls.some(([path]) => String(path).includes('/defects?'))).toBe(false);
});

it.each(cases)('%s sends sourceId from an explicit picker without translating source facts', async (domain, api) => {
  const picker = vi.fn(({ onChange, disabled, report, domain: pickerDomain }) => <button disabled={disabled} onClick={() => {
    expect(pickerDomain).toBe(domain); expect(report.sources[0].sourceId).toBe('source1');
    onChange({ add: [{ sourceId: 'source2', expectedVersion: 3 }], removeSourceIds: [], primarySourceId: 'source1', sourceConfirmations: [] });
  }}>Select real domain source</button>);
  mount(domain, picker); await screen.findByDisplayValue(document.description);
  fireEvent.click(screen.getByRole('button', { name: '调整来源' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Select real domain source' }));
  fireEvent.change(screen.getByLabelText('变更 / 申请理由'), { target: { value: 'Confirmed source supplement' } });
  fireEvent.click(screen.getByRole('button', { name: '确认提交' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].path).toBe(`/api/v1/${api}/eight-d/p1/sources`);
  expect(JSON.parse(writes[0].body)).toEqual({ organizationId: 'org1', expectedVersion: 7, add: [{ sourceId: 'source2', expectedVersion: 3 }], removeSourceIds: [], primarySourceId: 'source1', sourceConfirmations: [], reason: 'Confirmed source supplement', confirmCancelApproval: false });
  expect(writes[0].body).not.toContain('defectId');
});

it.each(cases)('%s uses its own PDF endpoint', async (domain, api) => {
  mount(domain); await screen.findByDisplayValue(document.description);
  fireEvent.click(screen.getByRole('tab', { name: '报告' }));
  await screen.findByText('Saved report');
  expect(fetcher).toHaveBeenCalledWith(`/api/v1/${api}/eight-d/p1/report?organizationId=org1&view=CURRENT`, expect.anything());
  fireEvent.click(screen.getByRole('button', { name: '授权下载 PDF' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith(`/api/v1/${api}/eight-d/p1/report/pdf?organizationId=org1&view=CURRENT`, expect.anything()));
});

it.each(cases)('%s uploads to its own resource and accepts only a real CLEAN receipt', async (domain, _api, resource) => {
  vi.stubGlobal('crypto', webcrypto);
  let file = { id: 'file1', resourceType: resource, resourceId: 'p1', originalName: 'evidence.txt', contentType: 'text/plain', sizeBytes: 6, sha256: 'a'.repeat(64), status: 'QUARANTINED', scanStatus: 'WAITING_UPLOAD', version: 1 };
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path: string, init: RequestInit = {}) => {
    if (path === '/api/v1/files/uploads') return response({ file, uploadUrl: 'https://objects.example.test/upload', headers: {} }, 201);
    if (path === 'https://objects.example.test/upload') return new Response(null);
    if (path === '/api/v1/files/file1/complete') { file = { ...file, version: 2, scanStatus: 'PENDING' }; return response(file, 202); }
    if (path === '/api/v1/files/file1') return response(file);
    return original(path, init);
  });
  mount(domain); await screen.findByDisplayValue(document.description);
  const summary = screen.getByText('OK 附件（可选） (0)'); fireEvent.click(summary);
  const panel = within(summary.closest('details')!);
  const selected = new File(['sample'], 'evidence.txt', { type: 'text/plain' });
  Object.defineProperty(selected, 'arrayBuffer', { value: async () => new TextEncoder().encode('sample').buffer });
  fireEvent.change(await panel.findByLabelText('选择附件'), { target: { files: [selected] } });
  await panel.findByText('等待安全扫描');
  const upload = fetcher.mock.calls.find(([path]) => path === '/api/v1/files/uploads')!;
  expect(JSON.parse(upload[1].body)).toMatchObject({ resourceType: resource, resourceId: 'p1' });
  expect(screen.getByRole('button', { name: '完整提交' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(JSON.parse(writes[0].body).document.okFileIds).toEqual([]);
  await waitFor(() => expect(panel.getByRole('button', { name: '刷新附件' })).toBeEnabled());
  file = { ...file, status: 'AVAILABLE', scanStatus: 'CLEAN', version: 3 };
  fireEvent.click(panel.getByRole('button', { name: '刷新附件' }));
  await screen.findByText('OK 附件（可选） (1)');
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(JSON.parse(writes[1].body).document.okFileIds).toEqual(['file1']);
});

it.each(cases)('%s keeps 409 drafts and clears sensitive content after 403', async domain => {
  mount(domain); await screen.findByDisplayValue(document.description); failure = 409;
  fireEvent.change(screen.getByLabelText('D2 问题描述'), { target: { value: 'Keep on conflict' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await screen.findByRole('button', { name: '刷新基线并保留草稿' });
  expect(screen.getByDisplayValue('Keep on conflict')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '刷新基线并保留草稿' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled());
  failure = 403; fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await screen.findByText(/敏感内容已清除/);
  expect(screen.queryByDisplayValue('Keep on conflict')).not.toBeInTheDocument();
});

it('remounts the same problem on domain change and rejects late previous-domain data', async () => {
  let release!: (response: Response) => void;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path: string, init: RequestInit = {}) => path.includes('/customer-quality/eight-d/p1?') ? new Promise<Response>(resolve => { release = resolve; }) : original(path, init));
  const view = mount('customer'); await waitFor(() => expect(release).toBeTypeOf('function'));
  view.changeDomain('new-product'); await screen.findByDisplayValue(document.description);
  await act(async () => release(response({ ...current, document: { ...document, description: 'Late customer data' } })));
  expect(screen.queryByDisplayValue('Late customer data')).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: '正式新品 8D 工作区' })).toBeVisible();
});
