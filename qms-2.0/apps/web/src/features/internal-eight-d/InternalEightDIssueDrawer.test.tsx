import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { InternalEightDIssueDrawer, type EightDIssueSource, type InternalEightDDomain } from './InternalEightDIssueDrawer';

vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
const org = '22222222-2222-4222-8222-222222222222';
const source = { id: '11111111-1111-4111-8111-111111111111', version: 3, organizationId: org, description: '已选来源' };
const preview = [{ sourceId: source.id, relatedProblems: [{ problemId: 'old', reportNumber: 'OLD-8D', title: '旧单', status: 'CLOSED', primary: true }], hasHiddenRelations: true, relatedSetToken: 'opaque-token' }];
beforeEach(() => {
  vi.resetAllMocks(); useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession(`INTERNAL:${org}:issuer`);
  vi.mocked(getSession).mockResolvedValue({ userId: 'issuer', organizationId: org, accountType: 'INTERNAL', landingPath: '/app/workbench' });
  vi.mocked(csrfToken).mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockImplementation(async path => path.endsWith('/sources/preview') ? preview : path.includes('/assignment-options') ? {
    departments: [{ id: 'section', name: '制造科' }], departmentTotal: 1, users: path.includes('sectionDepartmentId') ? [{ id: 'owner', username: '负责人' }] : [], userTotal: 1,
  } : { problem: { id: 'new', reportNumber: 'NEW-8D' }, replayed: false });
});
function mount(domain: InternalEightDDomain = 'customer-quality', onDenied = vi.fn(), sources: EightDIssueSource[] = [source]) {
  const onIssued = vi.fn();
  const element = (records: EightDIssueSource[]) => <MemoryRouter><LanguageProvider><UnsavedChangesProvider><InternalEightDIssueDrawer domain={domain} organizationId={org} sources={records} onClose={vi.fn()} onIssued={onIssued} onDenied={onDenied} /></UnsavedChangesProvider></LanguageProvider></MemoryRouter>;
  const view = render(element(sources));
  return { onIssued, onDenied, changeSources: (records: EightDIssueSource[]) => view.rerender(element(records)), ...view };
}
async function select(label: string, value: string) {
  fireEvent.mouseDown(screen.getByLabelText(label));
  fireEvent.click(await screen.findByText(value, { selector: '.ant-select-item-option-content' }));
}
async function fill() {
  await screen.findByText('OLD-8D');
  fireEvent.click(screen.getByRole('radio', { name: /^复发$/ }));
  await select('风险等级', '高'); await select('责任科室', '制造科'); await select('负责人', '负责人');
}
it.each(['customer-quality', 'new-product-quality'] as const)('posts %s selection identities, exact recurrence token and actual-issuer semantics', async domain => {
  const { onIssued } = mount(domain); await fill();
  fireEvent.click(screen.getByText('确认发起8D'));
  await waitFor(() => expect(onIssued).toHaveBeenCalled());
  const call = vi.mocked(apiRequest).mock.calls.find(([path, init]) => path === `/api/v1/${domain}/eight-d` && init?.method === 'POST');
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ sources: [{ sourceId: source.id, expectedVersion: 3 }], severity: 'HIGH', responsibleSectionDepartmentId: 'section', ownerUserId: 'owner', sourceConfirmations: [{ sourceId: source.id, relatedSetToken: 'opaque-token', recurrence: 'RECURRENCE', relatedProblemIds: ['old'] }] });
  expect(String(call?.[1]?.body)).not.toMatch(/defectId|professionalUserId|workflowBinding/);
  expect(call?.[2]).toEqual({ replayAfterReauthentication: false });
});
it.each(['customer-quality', 'new-product-quality'] as const)('issues an unlinked %s source without inventing a required recurrence decision', async domain => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => path.endsWith('/sources/preview') ? [{ ...preview[0], relatedProblems: [], hasHiddenRelations: false }] : read(path, init));
  const { onIssued } = mount(domain);
  await screen.findByText(/未发现其他关联/);
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  await select('风险等级', '高'); await select('责任科室', '制造科'); await select('负责人', '负责人');
  fireEvent.click(screen.getByText('确认发起8D'));
  await waitFor(() => expect(onIssued).toHaveBeenCalled());
  const call = vi.mocked(apiRequest).mock.calls.find(([path, init]) => path === `/api/v1/${domain}/eight-d` && init?.method === 'POST');
  expect(JSON.parse(String(call?.[1]?.body)).sourceConfirmations).toEqual([]);
  expect(String(call?.[1]?.body)).not.toMatch(/NOT_RECURRENCE|RECURRENCE/);
});
it('invalidates recurrence confirmation if relationships change before dispatch', async () => {
  const { onIssued } = mount(); await fill();
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => path.endsWith('/sources/preview') ? [{ ...preview[0], relatedSetToken: 'changed' }] : read(path, init));
  fireEvent.click(screen.getByText('确认发起8D'));
  expect(await screen.findByText(/关联集合已变化/)).toBeVisible();
  expect(screen.getByRole('radio', { name: /^复发$/ })).not.toBeChecked(); expect(onIssued).not.toHaveBeenCalled();
  expect(vi.mocked(apiRequest).mock.calls.some(([path, init]) => path.endsWith('/eight-d') && init?.method === 'POST')).toBe(false);
});
it('freezes the private unknown request and reuses its exact body and key', async () => {
  mount(); await fill(); const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => { if (path.endsWith('/eight-d')) throw new TypeError('network'); return read(path, init); });
  fireEvent.click(screen.getByText('确认发起8D'));
  await screen.findByText(/发单结果未知/);
  expect(screen.getByLabelText('风险等级')).toBeDisabled();
  expect(screen.getByText('重新读取来源版本').closest('button')).toBeDisabled();
  const beforeRetry = vi.mocked(apiRequest).mock.calls.length;
  fireEvent.click(screen.getByText('重新读取来源版本'));
  expect(vi.mocked(apiRequest).mock.calls).toHaveLength(beforeRetry);
  fireEvent.click(screen.getByText('同请求重试发起8D'));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.filter(([path, init]) => path.endsWith('/eight-d') && init?.method === 'POST')).toHaveLength(2));
  const writes = vi.mocked(apiRequest).mock.calls.filter(([path, init]) => path.endsWith('/eight-d') && init?.method === 'POST');
  expect(writes[1][1]?.body).toBe(writes[0][1]?.body); expect(writes[1][1]?.headers).toEqual(writes[0][1]?.headers);
  expect(vi.mocked(apiRequest).mock.calls.slice(beforeRetry).filter(([path]) => !path.endsWith('/eight-d'))).toHaveLength(0);
});
it.each([401, 403])('propagates %s and never dispatches after lost preview access', async status => {
  vi.mocked(apiRequest).mockRejectedValue(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, status));
  const { onDenied } = mount(); await waitFor(() => expect(onDenied).toHaveBeenCalled());
  expect(vi.mocked(apiRequest).mock.calls.some(([path, init]) => path.endsWith('/eight-d') && init?.method === 'POST')).toBe(false);
});

const ledgerPath = (id = source.id) => `/api/v1/customer-quality/ledger/${id}?organizationId=${org}`;
const writes = () => vi.mocked(apiRequest).mock.calls.filter(([path, init]) => path.endsWith('/eight-d') && init?.method === 'POST');
const previews = () => vi.mocked(apiRequest).mock.calls.filter(([path]) => path.endsWith('/sources/preview'));
function latestLedger(version = 5) {
  return { id: source.id, organizationId: org, version, complaintNumber: 'CQ-1', normalized: { defectDescription: '更新后的描述' } };
}
function draftDates() {
  fireEvent.change(screen.getByLabelText('分析/对策期限'), { target: { value: '2026-11-02' } });
  fireEvent.change(screen.getByLabelText('关闭计划'), { target: { value: '2026-11-06' } });
}
function expectDraft() {
  expect(screen.getByLabelText('风险等级').closest('.ant-select')).toHaveTextContent('高');
  expect(screen.getByLabelText('负责人', { selector: 'input' }).closest('.ant-select')).toHaveTextContent('负责人');
  expect(screen.getByLabelText('分析/对策期限')).toHaveValue('2026-11-02');
  expect(screen.getByLabelText('关闭计划')).toHaveValue('2026-11-06');
}
it('recovers a preview 409 only after explicit source-version comparison and adoption, preserving the form on cancel', async () => {
  mount(); await fill(); draftDates();
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  let conflict = true;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path === ledgerPath()) return latestLedger();
    if (path.endsWith('/sources/preview')) {
      if (conflict) throw new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409);
      return [{ ...preview[0], relatedSetToken: 'fresh-token' }];
    }
    return read(path, init);
  });
  fireEvent.click(screen.getByText('确认发起8D'));
  await waitFor(() => expect(screen.getByText('确认发起8D').closest('button')).toBeDisabled());
  const count = previews().length;
  fireEvent.click(screen.getByText('重新读取来源版本'));
  expect(await screen.findByText('版本：v3 → v5')).toBeVisible();
  expect(screen.getByText('原描述：已选来源')).toBeVisible();
  expect(screen.getByText('最新描述：CQ-1 · 更新后的描述')).toBeVisible();
  expect(previews()).toHaveLength(count); expect(writes()).toHaveLength(0);
  fireEvent.click(screen.getByText('取消恢复'));
  expectDraft();
  expect(screen.queryByText('版本：v3 → v5')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('重新读取来源版本'));
  await screen.findByText('版本：v3 → v5');
  conflict = false;
  fireEvent.click(screen.getByText('确认采用并预览'));
  await waitFor(() => expect(previews()).toHaveLength(count + 1));
  await waitFor(() => expect(screen.getByLabelText('风险等级')).not.toBeDisabled());
  expect(JSON.parse(String(previews().at(-1)?.[1]?.body)).sources).toEqual([{ sourceId: source.id, expectedVersion: 5 }]);
  expectDraft(); expect(screen.getByRole('radio', { name: /^复发$/ })).not.toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: /^复发$/ }));
  fireEvent.click(screen.getByText('确认发起8D'));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(JSON.parse(String(writes()[0][1]?.body))).toMatchObject({ severity: 'HIGH', ownerUserId: 'owner', sources: [{ sourceId: source.id, expectedVersion: 5 }], sourceConfirmations: [{ relatedSetToken: 'fresh-token' }] });
});
it('discards only a confirmed failed write attempt on explicit adoption and issues the new baseline with a new key', async () => {
  mount(); await fill(); draftDates();
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path === ledgerPath()) return latestLedger();
    if (path.endsWith('/eight-d')) throw new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409);
    return read(path, init);
  });
  fireEvent.click(screen.getByText('确认发起8D'));
  await waitFor(() => expect(writes()).toHaveLength(1));
  await waitFor(() => expect(screen.getByText('重新读取来源版本').closest('button')).not.toBeDisabled());
  fireEvent.click(screen.getByText('重新读取来源版本'));
  await screen.findByText('版本：v3 → v5');
  fireEvent.click(screen.getByText('确认采用并预览'));
  await waitFor(() => expect(screen.getByLabelText('风险等级')).not.toBeDisabled());
  expectDraft();
  fireEvent.click(screen.getByRole('radio', { name: /^复发$/ }));
  fireEvent.click(screen.getByText('确认发起8D'));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(JSON.parse(String(writes()[1][1]?.body)).sources[0].expectedVersion).toBe(5);
  expect(writes()[1][1]?.headers).not.toEqual(writes()[0][1]?.headers);
});
it('rereads new-product selection identity in its explicit project and keeps the immutable selection source_version', async () => {
  const selected = { ...source, projectId: 'project-1' };
  mount('new-product-quality', vi.fn(), [selected]); await fill();
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  const path = `/api/v1/new-product-quality/projects/project-1/defect-selections?organizationId=${org}`;
  vi.mocked(apiRequest).mockImplementation(async (url, init) => url === path ? [{ id: source.id, project_id: 'project-1', organization_id: org, defect_id: 'not-the-selection', source_version: 3, source_snapshot: { description: '新品选择快照', version: 99 } }] : read(url, init));
  const count = previews().length;
  fireEvent.click(screen.getByText('重新读取来源版本'));
  expect(await screen.findByText('版本：v3 → v3')).toBeVisible();
  expect(screen.getByText('最新描述：新品选择快照')).toBeVisible(); expect(previews()).toHaveLength(count);
  fireEvent.click(screen.getByText('确认采用并预览'));
  await waitFor(() => expect(previews()).toHaveLength(count + 1));
  expect(JSON.parse(String(previews().at(-1)?.[1]?.body)).sources).toEqual([{ sourceId: source.id, expectedVersion: 3 }]);
  expect(vi.mocked(apiRequest).mock.calls.some(([url]) => url.includes('not-the-selection') || url.includes('/process-quality/'))).toBe(false);
});
it('does not invent a project URL when a new-product selection lacks projectId', async () => {
  mount('new-product-quality'); await fill();
  const count = vi.mocked(apiRequest).mock.calls.length;
  fireEvent.click(screen.getByText('重新读取来源版本'));
  expect(await screen.findByText(/缺少新品项目标识/)).toBeVisible();
  expect(vi.mocked(apiRequest).mock.calls).toHaveLength(count);
  expect(screen.queryByText('确认采用并预览')).not.toBeInTheDocument();
});
it.each([401, 403, 404])('never adopts an unreadable customer source (%s), propagating access loss but not treating 404 as empty success', async status => {
  const { onDenied } = mount(); await fill(); draftDates();
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => { if (path === ledgerPath()) throw new ApiError({ code: status === 404 ? 'NOT_FOUND' : 'FEATURE_PERMISSION_DENIED', message: '' }, status); return read(path, init); });
  const count = previews().length;
  fireEvent.click(screen.getByText('重新读取来源版本'));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path === ledgerPath())).toBe(true));
  await waitFor(() => expect(screen.getByText('重新读取来源版本').closest('button')).not.toBeDisabled());
  expect(screen.queryByText('确认采用并预览')).not.toBeInTheDocument();
  expect(previews()).toHaveLength(count); expect(writes()).toHaveLength(0); expectDraft();
  if (status !== 404) expect(onDenied).toHaveBeenCalled(); else expect(onDenied).not.toHaveBeenCalled();
});
it('requires every selected source to be readable and never offers partial adoption', async () => {
  const second = { ...source, id: '33333333-3333-4333-8333-333333333333' };
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.endsWith('/sources/preview')) return [preview[0], { ...preview[0], sourceId: second.id }];
    if (path === ledgerPath()) return latestLedger();
    if (path === ledgerPath(second.id)) throw new ApiError({ code: 'NOT_FOUND', message: '' }, 404);
    return read(path, init);
  });
  mount('customer-quality', vi.fn(), [source, second]);
  await screen.findAllByText('OLD-8D');
  fireEvent.click(screen.getByText('重新读取来源版本'));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path === ledgerPath(second.id))).toBe(true));
  await waitFor(() => expect(screen.getByText('重新读取来源版本').closest('button')).not.toBeDisabled());
  expect(screen.queryByText('确认采用并预览')).not.toBeInTheDocument();
  expect(previews()).toHaveLength(1);
});
it('blocks dispatch and repeated refresh while a source read is pending and ignores its late result after unmount', async () => {
  const { unmount } = mount(); await fill();
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  let resolve!: (value: ReturnType<typeof latestLedger>) => void;
  vi.mocked(apiRequest).mockImplementation((path, init) => path === ledgerPath() ? new Promise(done => { resolve = done; }) : read(path, init));
  fireEvent.click(screen.getByText('重新读取来源版本'));
  await waitFor(() => expect(resolve).toBeDefined());
  expect(screen.getByText('重新读取来源版本').closest('button')).toBeDisabled(); expect(screen.getByText('确认发起8D').closest('button')).toBeDisabled();
  fireEvent.click(screen.getByText('确认发起8D')); expect(writes()).toHaveLength(0);
  const signal = vi.mocked(apiRequest).mock.calls.find(([path]) => path === ledgerPath())?.[1]?.signal;
  unmount(); expect(signal?.aborted).toBe(true); resolve(latestLedger());
  expect(writes()).toHaveLength(0);
});
it.each([
  ['sources', 200], ['sources', 401], ['sources', 403],
  ['scope', 200], ['scope', 401], ['scope', 403],
] as const)('ignores a late source read (%s changed, status %s) without clearing the new parent scope', async (boundary, status) => {
  const { changeSources, onDenied, onIssued } = mount(); await fill(); draftDates();
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  let settle!: () => void;
  vi.mocked(apiRequest).mockImplementation((path, init) => path === ledgerPath() ? new Promise((resolve, reject) => {
    settle = () => status === 200 ? resolve(latestLedger()) : reject(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, status));
  }) : read(path, init));
  fireEvent.click(screen.getByText('重新读取来源版本'));
  await waitFor(() => expect(settle).toBeDefined());
  if (boundary === 'sources') changeSources([{ ...source, id: '33333333-3333-4333-8333-333333333333', description: '新的来源' }]);
  else act(() => { useWorkTabsStore.getState().bindSession(`INTERNAL:${org}:other-user`); });
  await act(async () => { settle(); });
  expect(screen.getByText('来源选择或会话已变化，请重新打开抽屉。')).toBeVisible();
  expect(screen.queryByText('确认采用并预览')).not.toBeInTheDocument();
  expect(screen.queryByText('OLD-8D')).not.toBeInTheDocument();
  expect(screen.getByLabelText('分析/对策期限')).toHaveValue('');
  expect(screen.getByLabelText('风险等级')).toBeDisabled();
  expect(screen.getByText('重新读取来源版本').closest('button')).toBeDisabled();
  expect(screen.getByText('确认发起8D').closest('button')).toBeDisabled();
  expect(onDenied).not.toHaveBeenCalled(); expect(onIssued).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0);
});
it('rejects a missing source identity without inventing one or issuing a preview or detail read', async () => {
  mount('customer-quality', vi.fn(), [{ ...source, id: '' }]);
  expect(await screen.findByText('来源标识或版本不完整，请重新选择真实来源。')).toBeVisible();
  fireEvent.click(screen.getByText('重新读取来源版本'));
  await waitFor(() => expect(screen.getByText('重新读取来源版本').closest('button')).not.toBeDisabled());
  expect(previews()).toHaveLength(0); expect(writes()).toHaveLength(0);
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('/ledger/'))).toBe(false);
  expect(screen.queryByText('确认采用并预览')).not.toBeInTheDocument();
});

function deferredRead() {
  let resolve!: (value: unknown) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<unknown>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
it.each([
  ['customer-quality', 404, 403],
  ['new-product-quality', 'network', 401],
] as const)('propagates late %s read denial after %s without waiting for every source', async (domain, firstFailure, status) => {
  const records = [source, { ...source, id: '33333333-3333-4333-8333-333333333333' }, { ...source, id: '44444444-4444-4444-8444-444444444444' }]
    .map((record, index) => ({ ...record, projectId: `project-${index}` }));
  const reads = records.map(() => deferredRead());
  const paths = records.map(record => domain === 'customer-quality' ? ledgerPath(record.id) : `/api/v1/new-product-quality/projects/${record.projectId}/defect-selections?organizationId=${org}`);
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation((path, init) => {
    const index = paths.indexOf(path);
    if (index !== -1) return reads[index].promise;
    if (path.endsWith('/sources/preview')) return Promise.resolve(records.map(record => ({ ...preview[0], sourceId: record.id })));
    return read(path, init);
  });
  const { onDenied, onIssued, unmount } = mount(domain, vi.fn(), records);
  await screen.findAllByText('OLD-8D');
  const previewCount = previews().length;
  fireEvent.click(screen.getByText('重新读取来源版本'));
  await waitFor(() => expect(paths.every(path => vi.mocked(apiRequest).mock.calls.some(([url]) => url === path))).toBe(true));
  try {
    await act(async () => { reads[0].reject(firstFailure === 'network' ? new TypeError('network') : new ApiError({ code: 'NOT_FOUND', message: '' }, firstFailure)); });
    expect(onDenied).not.toHaveBeenCalled();
    expect(screen.queryByText('确认采用并预览')).not.toBeInTheDocument();
    const denial = new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, status);
    await act(async () => { reads[1].reject(denial); });
    await waitFor(() => expect(onDenied).toHaveBeenCalledTimes(1));
    expect(onDenied).toHaveBeenLastCalledWith(denial);
    expect(screen.queryByText('确认采用并预览')).not.toBeInTheDocument();
    expect(previews()).toHaveLength(previewCount); expect(writes()).toHaveLength(0); expect(onIssued).not.toHaveBeenCalled();
  } finally {
    unmount();
    await act(async () => { reads[2].resolve(domain === 'customer-quality' ? { ...latestLedger(), id: records[2].id } : [{ id: records[2].id, project_id: records[2].projectId, organization_id: org, source_version: 5, source_snapshot: { description: 'late source' } }]); });
  }
  expect(onDenied).toHaveBeenCalledTimes(1); expect(onIssued).not.toHaveBeenCalled();
  expect(screen.queryByText('确认采用并预览')).not.toBeInTheDocument();
});
it('ignores mixed source failures from an old scope after its first 404', async () => {
  const second = { ...source, id: '33333333-3333-4333-8333-333333333333' };
  const firstRead = deferredRead(); const secondRead = deferredRead();
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation((path, init) => {
    if (path === ledgerPath()) return firstRead.promise;
    if (path === ledgerPath(second.id)) return secondRead.promise;
    if (path.endsWith('/sources/preview')) return Promise.resolve([preview[0], { ...preview[0], sourceId: second.id }]);
    return read(path, init);
  });
  const { onDenied, onIssued } = mount('customer-quality', vi.fn(), [source, second]);
  await screen.findAllByText('OLD-8D');
  fireEvent.click(screen.getByText('重新读取来源版本'));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path === ledgerPath(second.id))).toBe(true));
  await act(async () => { firstRead.reject(new ApiError({ code: 'NOT_FOUND', message: '' }, 404)); });
  expect(onDenied).not.toHaveBeenCalled();
  const nextScope = `INTERNAL:${org}:other-user`;
  act(() => { useWorkTabsStore.getState().bindSession(nextScope); });
  await act(async () => { secondRead.reject(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, 403)); });
  expect(useWorkTabsStore.getState().sessionScope).toBe(nextScope);
  expect(onDenied).not.toHaveBeenCalled(); expect(onIssued).not.toHaveBeenCalled();
  expect(screen.getByText('来源选择或会话已变化，请重新打开抽屉。')).toBeVisible();
  expect(screen.queryByText('OLD-8D')).not.toBeInTheDocument();
  expect(screen.queryByText('确认采用并预览')).not.toBeInTheDocument(); expect(writes()).toHaveLength(0);
});
it('propagates a late owner denial after a concurrent department 404', async () => {
  const { onDenied, onIssued } = mount();
  await screen.findByText('OLD-8D');
  const departmentRead = deferredRead(); const ownerRead = deferredRead();
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation((path, init) => path.includes('/assignment-options') ? path.includes('sectionDepartmentId') ? ownerRead.promise : departmentRead.promise : read(path, init));
  await select('责任科室', '制造科');
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('sectionDepartmentId=section'))).toBe(true));
  await act(async () => { departmentRead.reject(new ApiError({ code: 'NOT_FOUND', message: '' }, 404)); });
  expect(await screen.findByText('重试责任候选')).toBeVisible();
  expect(onDenied).not.toHaveBeenCalled();
  const denial = new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, 403);
  await act(async () => { ownerRead.reject(denial); });
  await waitFor(() => expect(onDenied).toHaveBeenCalledTimes(1));
  expect(onDenied).toHaveBeenLastCalledWith(denial);
  expect(screen.getByText('确认发起8D').closest('button')).toBeDisabled();
  expect(writes()).toHaveLength(0); expect(onIssued).not.toHaveBeenCalled();
});
