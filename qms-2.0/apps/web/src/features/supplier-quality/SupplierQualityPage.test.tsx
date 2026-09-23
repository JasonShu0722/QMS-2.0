import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { SupplierQualityPage } from './SupplierQualityPage';

vi.setConfig({ testTimeout: 30_000 });

vi.mock('./SupplierReferenceSelect', () => ({
  SupplierReferenceSelect: ({ id, value, onChange, disabled, placeholder }: { id?: string; value?: string; onChange?: (value: string) => void; disabled?: boolean; placeholder?: string }) => (
    <select id={id} aria-label={placeholder} value={value ?? ''} disabled={disabled} onChange={(event) => onChange?.(event.target.value)} />
  ),
}));

afterEach(() => vi.unstubAllGlobals());

it('shows an empty supplier inbox without offering internal draft creation', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0, canCreateDraft: false }), { headers: { 'content-type': 'application/json' } })));
  render(<MemoryRouter initialEntries={['/supplier/corrections']}><SupplierQualityPage portal /></MemoryRouter>);
  expect(await screen.findByText('尚未收到问题单')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '创建问题草稿' })).not.toBeInTheDocument();
});

it('reports authorization failure instead of displaying an empty successful ledger', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'FEATURE_PERMISSION_DENIED', message: 'denied' }), { status: 403, headers: { 'content-type': 'application/json' } })));
  render(<MemoryRouter initialEntries={['/app/supplier-quality']}><SupplierQualityPage /></MemoryRouter>);
  expect(await screen.findByText('无权执行此操作')).toBeInTheDocument();
  expect(screen.queryByText('暂无问题草稿')).not.toBeInTheDocument();
});

it('keeps an unsaved internal response when the separate problem form is saved', async () => {
  const record = { id: '11111111-1111-4111-8111-111111111111', version: 1, profileId: '22222222-2222-4222-8222-222222222222', supplierOrganizationId: '33333333-3333-4333-8333-333333333333', supplierName: '企业', title: '来料问题', materialCode: 'MAT', defectDescription: '氧化', defectQuantity: 2, severity: 'HIGH', responseForm: 'BRIEF', replyMode: 'INTERNAL', internalResponderId: '44444444-4444-4444-8444-444444444444', stage: 'DRAFT', updatedAt: new Date().toISOString(), canEditFacts: true, canEditResponse: true, responseDraft: {} };
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    let payload: unknown = record;
    if (path.endsWith('/csrf')) payload = { csrfToken: 'test' };
    else if (path.includes('reference-options')) payload = { items: [path.includes('responders') ? { id: record.internalResponderId, label: '回复人' } : { id: record.profileId, label: '供应商' }], total: 1 };
    else if (init?.method === 'PUT') payload = { ...record, version: 2, title: JSON.parse(String(init.body)).title };
    return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
  }));
  render(<MemoryRouter initialEntries={[`/app/supplier-quality/problems/${record.id}`]}><SupplierQualityPage /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText('根本原因'), { target: { value: '尚未保存的回复内容' } });
  fireEvent.change(screen.getByLabelText('问题标题'), { target: { value: '更新后的标题' } });
  const saveButton = screen.getByText('保存问题草稿').closest('button')!;
  expect(saveButton).not.toBeDisabled();
  fireEvent.click(saveButton);
  expect(await screen.findByText('草稿已保存')).toBeInTheDocument();
  expect(screen.getByLabelText('根本原因')).toHaveValue('尚未保存的回复内容');
});

const issuedProblem = { id: '11111111-1111-4111-8111-111111111111', version: 3, profileId: '22222222-2222-4222-8222-222222222222', supplierOrganizationId: '33333333-3333-4333-8333-333333333333', supplierName: '企业', title: '来料问题', materialCode: 'MAT', defectDescription: '氧化', defectQuantity: 2, severity: 'HIGH', responseForm: 'BRIEF', replyMode: 'SUPPLIER', stage: 'ISSUED', problemStatus: 'OPEN', updatedAt: new Date().toISOString(), canEditFacts: false, canEditResponse: true, availableActions: ['SUBMIT'], responseDraft: {} };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

it('submits a supplier reply with the generated contract and refreshes to read-only progress', async () => {
  let submitted = false;
  const requests: { path: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    requests.push({ path, init });
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init?.method === 'POST') { submitted = true; return json({ ...issuedProblem, version: 4, problemStatus: 'IN_PROGRESS', canEditResponse: false }); }
    return json(submitted ? { ...issuedProblem, version: 4, problemStatus: 'IN_PROGRESS', canEditResponse: false } : issuedProblem);
  }));
  render(<LanguageProvider><MemoryRouter initialEntries={[`/supplier/corrections/problems/${issuedProblem.id}`]}><SupplierQualityPage portal /></MemoryRouter></LanguageProvider>);
  fireEvent.change(await screen.findByLabelText('根本原因'), { target: { value: '包装破损' } });
  fireEvent.change(screen.getByLabelText('纠正措施'), { target: { value: '更换包装' } });
  fireEvent.change(screen.getByLabelText('完成时间'), { target: { value: '2026-09-23T10:30' } });
  fireEvent.click(screen.getByRole('button', { name: '正式提交回复' }));
  await waitFor(() => expect(requests.some(({ path, init }) => path === `/api/v1/supplier-portal/problems/${issuedProblem.id}/actions` && init?.method === 'POST')).toBe(true));
  const request = requests.find(({ path, init }) => path.endsWith('/actions') && init?.method === 'POST')!;
  expect(JSON.parse(String(request.init?.body))).toEqual({ expectedContentVersion: 3, content: { rootCause: '包装破损', correctiveAction: '更换包装', completionTime: new Date('2026-09-23T10:30').toISOString() }, evidenceFileIds: [], evidencePurpose: 'RESPONSE' });
  expect(new Headers(request.init?.headers).get('Idempotency-Key')).toBeTruthy();
  expect(await screen.findByText('回复已提交，当前节点不可再编辑')).toBeInTheDocument();
  expect(screen.getByText('问题进度：处理中')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '正式提交回复' })).not.toBeInTheDocument();
  await waitFor(() => expect(requests.filter(({ path }) => path.startsWith(`/api/v1/supplier-portal/problems/${issuedProblem.id}?`))).toHaveLength(2));
});

it('keeps the reply after a 409 and retries with the same key', async () => {
  let attempts = 0;
  const keys: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init?.method === 'POST') {
      keys.push(new Headers(init.headers).get('Idempotency-Key')!);
      if (++attempts === 1) return json({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409);
      return json({ ...issuedProblem, version: 4, canEditResponse: false });
    }
    return json(attempts > 1 ? { ...issuedProblem, version: 4, canEditResponse: false } : issuedProblem);
  }));
  render(<LanguageProvider><MemoryRouter initialEntries={[`/supplier/corrections/problems/${issuedProblem.id}`]}><SupplierQualityPage portal /></MemoryRouter></LanguageProvider>);
  fireEvent.change(await screen.findByLabelText('根本原因'), { target: { value: '保留的原因' } });
  fireEvent.change(screen.getByLabelText('纠正措施'), { target: { value: '保留的措施' } });
  fireEvent.change(screen.getByLabelText('完成时间'), { target: { value: '2026-09-23T10:30' } });
  fireEvent.click(screen.getByRole('button', { name: '正式提交回复' }));
  expect(await screen.findByText(/内容已被其他人修改/)).toBeInTheDocument();
  expect(screen.getByLabelText('根本原因')).toHaveValue('保留的原因');
  fireEvent.click(screen.getByRole('button', { name: '正式提交回复' }));
  expect(await screen.findByText('回复已提交，当前节点不可再编辑')).toBeInTheDocument();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});

it('references only a scanned and available supplier attachment', async () => {
  const originalCrypto = globalThis.crypto;
  vi.stubGlobal('crypto', { randomUUID: () => originalCrypto.randomUUID(), subtle: { digest: async () => new Uint8Array(32).buffer } });
  const fileId = '55555555-5555-4555-8555-555555555555';
  const pendingFile = { resourceType: 'supplier-quality', resourceId: issuedProblem.id, id: fileId, originalName: 'evidence.txt', contentType: 'text/plain', sizeBytes: 8, sha256: '0'.repeat(64), status: 'QUARANTINED', scanStatus: 'PENDING', scanReason: null, version: 2, uploadExpiresAt: new Date().toISOString(), scannedAt: null, deletedAt: null, retainUntil: new Date().toISOString() };
  let scanned = false;
  let submitted = false;
  let submittedBody: unknown;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path === '/api/v1/files/uploads') return json({ file: pendingFile, uploadUrl: 'https://upload.example.test/file', headers: {}, urlExpiresAt: new Date().toISOString() });
    if (path === 'https://upload.example.test/file') return new Response(null, { status: 200 });
    if (path.endsWith(`/files/${fileId}/complete`)) return json(pendingFile);
    if (path.endsWith(`/files/${fileId}`)) return json(scanned ? { ...pendingFile, status: 'AVAILABLE', scanStatus: 'CLEAN', version: 3 } : pendingFile);
    if (init?.method === 'POST' && path.endsWith('/actions')) { submittedBody = JSON.parse(String(init.body)); submitted = true; return json({ ...issuedProblem, version: 4, canEditResponse: false }); }
    return json(submitted ? { ...issuedProblem, version: 4, canEditResponse: false } : issuedProblem);
  }));
  render(<LanguageProvider><MemoryRouter initialEntries={[`/supplier/corrections/problems/${issuedProblem.id}`]}><SupplierQualityPage portal /></MemoryRouter></LanguageProvider>);
  const selected = new File(['evidence'], 'evidence.txt', { type: 'text/plain' });
  Object.defineProperty(selected, 'arrayBuffer', { value: async () => new TextEncoder().encode('evidence').buffer });
  fireEvent.change(await screen.findByLabelText('选择附件'), { target: { files: [selected] } });
  expect(await screen.findByText('等待安全扫描')).toBeInTheDocument();
  expect(screen.getByText(/已选 0 个可提交证据/)).toBeInTheDocument();
  scanned = true;
  fireEvent.click(screen.getByRole('button', { name: '刷新附件' }));
  expect(await screen.findByText(/已选 1 个可提交证据/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('根本原因'), { target: { value: '原因' } });
  fireEvent.change(screen.getByLabelText('纠正措施'), { target: { value: '措施' } });
  fireEvent.change(screen.getByLabelText('完成时间'), { target: { value: '2026-09-23T10:30' } });
  fireEvent.click(screen.getByRole('button', { name: '正式提交回复' }));
  await waitFor(() => expect(submittedBody).toBeTruthy());
  expect(submittedBody).toMatchObject({ evidenceFileIds: [fileId], evidencePurpose: 'RESPONSE' });
});

it('issues only a saved internal draft and retains edits after an issue conflict', async () => {
  const record = { ...issuedProblem, version: 2, stage: 'DRAFT', problemStatus: undefined, replyMode: 'INTERNAL', internalResponderId: '44444444-4444-4444-8444-444444444444', canEditFacts: true, canEditResponse: true };
  let attempts = 0;
  const requests: { path: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    requests.push({ path, init });
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.includes('reference-options')) return json({ items: [path.includes('responders') ? { id: record.internalResponderId, label: '回复人' } : { id: record.profileId, label: '供应商' }], total: 1 });
    if (path.endsWith('/issue')) {
      if (++attempts === 1) return json({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409);
      return json({ ...record, stage: 'ISSUED', canEditFacts: false, reportNumber: 'SQ-001', problemStatus: 'OPEN' });
    }
    return json(attempts > 1 ? { ...record, stage: 'ISSUED', canEditFacts: false, reportNumber: 'SQ-001', problemStatus: 'OPEN' } : record);
  }));
  render(<MemoryRouter initialEntries={[`/app/supplier-quality/problems/${record.id}`]}><SupplierQualityPage /></MemoryRouter>);
  expect(await screen.findByLabelText('问题标题')).toHaveValue(record.title);
  fireEvent.click(screen.getByRole('button', { name: '正式发单' }));
  await waitFor(() => expect(attempts).toBe(1), { timeout: 500 });
  expect(screen.getByText(/内容已被其他人修改/)).toBeInTheDocument();
  expect(screen.getByLabelText('问题标题')).toHaveValue(record.title);
  const retryButton = screen.getByRole('button', { name: '正式发单' });
  expect(retryButton).not.toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '正式发单' }));
  await waitFor(() => expect(attempts).toBe(2), { timeout: 500 });
  expect(screen.getByText('正式发单成功')).toBeInTheDocument();
  const issueRequests = requests.filter(({ path }) => path.endsWith('/issue'));
  expect(issueRequests).toHaveLength(2);
  expect(JSON.parse(String(issueRequests[0]?.init?.body))).toEqual({ expectedVersion: 2 });
  expect(new Headers(issueRequests[0]?.init?.headers).get('Idempotency-Key')).toBe(new Headers(issueRequests[1]?.init?.headers).get('Idempotency-Key'));
});

it('replaces the sparse action response with refreshed actions and revision history', async () => {
  const indexId = '66666666-6666-4666-8666-666666666666';
  const initial = { ...issuedProblem, organizationId: '77777777-7777-4777-8777-777777777777', problemIndexId: indexId, canEditResponse: false, availableActions: ['VERIFY'], responseHistory: { items: [], total: 0, page: 1, pageSize: 10 } };
  const updated = { ...initial, availableActions: ['CLOSE'], currentVerification: { status: 'ACCEPTED' }, responseHistory: { items: [{ id: 'revision-1', revision: 1, content: { rootCause: '真实修订' }, submittedAt: '2026-09-23T10:00:00Z', evidence: [] }], total: 1, page: 1, pageSize: 10 } };
  let acted = false;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init?.method === 'POST') { acted = true; return json({ ...initial, availableActions: undefined, responseHistory: undefined }); }
    return json(acted ? updated : initial);
  }));
  render(<MemoryRouter initialEntries={[`/app/supplier-quality/problems/${initial.id}`]}><SupplierQualityPage /></MemoryRouter>);
  expect(await screen.findByRole('button', { name: '验证通过' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /打开公共问题工作空间/ })).toHaveAttribute('href', `/app/problem-workspace/${indexId}?organizationId=${initial.organizationId}`);
  fireEvent.click(screen.getByRole('button', { name: '验证通过' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认执行' }));
  expect(await screen.findByText('验证通过成功')).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: '关闭问题' })).toBeInTheDocument();
  expect(screen.getByText('真实修订')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '验证通过' })).not.toBeInTheDocument();
});

it('keeps submitted revisions visible after a sparse response draft save', async () => {
  const history = { items: [{ id: 'revision-1', revision: 1, content: { rootCause: '已提交的旧修订' }, submittedAt: '2026-09-23T10:00:00Z', evidence: [] }], total: 1, page: 1, pageSize: 10 };
  const record = { ...issuedProblem, responseHistory: history };
  let saved = false;
  let detailReads = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init?.method === 'PUT') { saved = true; return json({ ...record, version: 4, responseHistory: undefined, availableActions: undefined }); }
    detailReads += 1;
    return json(saved ? { ...record, version: 4 } : record);
  }));
  render(<MemoryRouter initialEntries={[`/supplier/corrections/problems/${record.id}`]}><SupplierQualityPage portal /></MemoryRouter>);
  expect(await screen.findByText('已提交的旧修订')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('根本原因'), { target: { value: '下一版草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '保存回复草稿' }));
  expect(await screen.findByText('回复草稿已保存')).toBeInTheDocument();
  await waitFor(() => expect(detailReads).toBe(2));
  expect(screen.getByText('已提交的旧修订')).toBeInTheDocument();
  expect(screen.getByLabelText('根本原因')).toHaveValue('下一版草稿');
});
