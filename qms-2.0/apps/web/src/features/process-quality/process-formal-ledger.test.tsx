import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ProcessDefectLedgerPage } from './ProcessDefectLedgerPage';
import { ProcessEightDIssueDrawer } from './ProcessEightDIssueDrawer';
import { ProcessDefectEditor } from './ProcessDefectEditor';
import type { components } from '@qms/contracts';
import type { ReactNode } from 'react';

const compactTable = vi.hoisted(() => ({ enabled: false }));
vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  return { ...actual, Checkbox: (props: { checked?: boolean; disabled?: boolean; 'aria-label'?: string; onChange?: (event: { target: { checked: boolean } }) => void }) => compactTable.enabled
    ? <button type="button" role="checkbox" aria-label={props['aria-label']} aria-checked={props.checked} disabled={props.disabled} onClick={() => props.onChange?.({ target: { checked: !props.checked } })} />
    : <actual.Checkbox {...props} />, Table: (props: import('antd').TableProps<components['schemas']['ProcessDefectDto']>) => {
    if (!compactTable.enabled) return <actual.Table {...props} />;
    // Batch boundary-test selection intent; the normal cross-page test keeps real AntD controls.
    const columns = props.columns?.filter(column => column.key === 'select' || ('dataIndex' in column && column.dataIndex === 'description')) ?? [];
    const pagination = props.pagination;
    return <div>{props.dataSource?.map((record, index) => <div key={record.id}>{columns.map((column, columnIndex) => <span key={columnIndex}>{'render' in column ? column.render?.(record.description, record, index) as ReactNode : null}</span>)}</div>)}
      {pagination && Array.from({ length: Math.ceil((pagination.total ?? 0) / 20) }, (_, index) => <button key={index} title={String(index + 1)} onClick={() => pagination.onChange?.(index + 1, 20)}>{index + 1}</button>)}
    </div>;
  } };
});
vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
vi.mock('../attachments/AttachmentPanel', () => ({ AttachmentPanel: ({ resource }: { resource: { resourceId: string } }) => <div>真实附件入口 {resource.resourceId}</div> }));
vi.mock('./ProcessShipmentReportPanel', () => ({ ProcessShipmentReportPanel: () => null }));

const organizationId = '22222222-2222-4222-8222-222222222222';
const defect: components['schemas']['ProcessDefectDto'] = { id: '11111111-1111-4111-8111-111111111111', organizationId, description: '表面划伤', defectTypeCode: null, defectQuantity: null, occurredAt: null, responsibilityCategory: null, traceCode: 'TRACE-1', ledgerStatus: 'FOLLOWING', version: 2, materials: [], issues: [], duplicateCount: 0, componentProject: null, evidence: [], analysisProgress: null, closedAt: null, closedById: null, sourceKind: 'MANUAL', materialVerificationHistory: [], ledgerHistory: [], classificationHistory: [] };
const section = { id: '33333333-3333-4333-8333-333333333333', code: 'SEC', name: '制造科' };
const owner = { id: '44444444-4444-4444-8444-444444444444', username: 'owner', fullName: '真实负责人' };
const preview = [{ defectId: defect.id, relatedProblems: [{ problemId: 'old', reportNumber: 'PQ-OLD', title: '已有问题', status: 'CLOSED', primary: true }], hasHiddenRelations: true, relatedSetToken: 'opaque-exact-1' }];
const permissions = ['process-quality:defects:read', 'process-quality:defects:write', 'process-quality:defects:close', 'process-quality:materials:review', 'process-quality:issues:issue', 'process-quality:issues:read'];
const list = { items: [defect], total: 1, page: 1, pageSize: 20 };

it('opens supplier copy from selected process facts without enabling internal issue for copy-only access', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path.includes('/my-permissions')) return { permissions: ['process-quality:defects:read', 'supplier-quality:issues:copy'] };
    if (path.includes('/reference-options')) return { items: [{ id: section.id, label: '复制目标档案' }], total: 1 };
    if (path.endsWith('/source-copies/preview')) return { token: owner.id, expiresAt: '2099-01-01T00:00:00Z', facts: [] };
    return baseResponse(path);
  });
  mount();
  const toolbar = within((await screen.findByLabelText('搜索制程不良')).closest('.process-quality-toolbar')!);
  const copy = await toolbar.findByRole('button', { name: '复制为供应商草稿' });
  expect(copy).toBeDisabled();
  fireEvent.click(await screen.findByLabelText(`选择制程不良 ${defect.description}`));
  await waitFor(() => expect(copy).toBeEnabled());
  fireEvent.click(copy);
  await waitFor(() => expect(screen.getByText('受控复制为供应商草稿').closest('[role="dialog"]')).toBeVisible());
  const dialog = within(screen.getByText('受控复制为供应商草稿').closest('[role="dialog"]') as HTMLElement);
  expect(screen.queryByRole('button', { name: '发起内部8D' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '发起问题' })).not.toBeInTheDocument();
  await selectOption('目标供应商档案', '复制目标档案');
  fireEvent.click(dialog.getByRole('button', { name: '读取受控预览' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/supplier-quality/source-copies/preview', expect.objectContaining({ body: JSON.stringify({ organizationId, supplierProfileId: section.id, sources: [{ kind: 'PROCESS_LEDGER', sourceId: defect.id, sourceVersion: defect.version }] }) }), { replayAfterReauthentication: false }));
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.endsWith('/source-copies/drafts'))).toBe(false);
});

it('hides supplier copy without its real copy permission', async () => {
  mount(); await screen.findByLabelText(`选择制程不良 ${defect.description}`);
  expect(screen.queryByRole('button', { name: '复制为供应商草稿' })).not.toBeInTheDocument();
});

function baseResponse(path: string) {
  if (path.includes('/my-permissions')) return { permissions };
  if (path.includes('/defects?')) return list;
  if (path.endsWith('/defects')) return { ...defect, version: 1 };
  if (path.endsWith('/issues')) return [];
  if (path.endsWith(`/defects/${defect.id}`)) return defect;
  if (path.endsWith('/sources/preview')) return preview;
  if (path.includes('/assignment-options')) return { departments: [section], users: path.includes('sectionDepartmentId=') ? [owner] : [], departmentTotal: 1, userTotal: 1, page: 1, pageSize: 100 };
  if (path.endsWith('/eight-d')) return { problem: { id: 'new-problem', reportNumber: 'PQ-NEW' }, replayed: false };
  return { items: [], total: 0, page: 1, pageSize: 100 };
}
beforeEach(() => {
  compactTable.enabled = false;
  useWorkTabsStore.getState().reset();
  vi.mocked(getSession).mockResolvedValue({ userId: owner.id, organizationId, accountType: 'INTERNAL', landingPath: '/app/workbench' });
  vi.mocked(csrfToken).mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockReset().mockImplementation(async path => baseResponse(path));
});
afterEach(() => vi.unstubAllEnvs());
function mount(route = '/app/process-quality', navigation?: ReactNode) { return render(<LanguageProvider><MemoryRouter initialEntries={[route]}><UnsavedChangesProvider>{navigation}<Routes><Route path="/app/process-quality" element={<ProcessDefectLedgerPage />} /><Route path="/login" element={<div>会话已退出，请登录</div>} /></Routes></UnsavedChangesProvider></MemoryRouter></LanguageProvider>); }

const sourceLink = (id = defect.id, org = organizationId) => `/app/process-quality?organizationId=${org}&defectId=${id}`;
const sourceDetailCalls = () => vi.mocked(apiRequest).mock.calls.filter(([path]) => new URL(path, 'https://qms.invalid').pathname === `/api/v1/process-quality/defects/${defect.id}`);
function sourceReadResponse(path: string) {
  const url = new URL(path, 'https://qms.invalid');
  if (url.pathname === '/api/v1/process-quality/defects') return { ...list, items: [] };
  return baseResponse(url.pathname);
}

it('opens a source deep-link only after scoped READ authorization, without selecting or issuing and without reopening on refresh', async () => {
  let authorize!: (value: { permissions: string[] }) => void;
  let permissionReads = 0;
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path.includes('/my-permissions') && permissionReads++ === 0) return new Promise(done => { authorize = done; });
    return sourceReadResponse(path);
  });
  mount(sourceLink());
  await waitFor(() => expect(authorize).toBeTypeOf('function'));
  expect(sourceDetailCalls()).toHaveLength(0);
  await act(async () => authorize({ permissions }));
  await waitFor(() => expect(screen.getByText('来源详情').closest('[role="dialog"]')).toBeVisible(), { timeout: 5000 });
  await screen.findByText('表面划伤');
  expect(sourceDetailCalls()).toHaveLength(1);
  const [path, init] = sourceDetailCalls()[0];
  expect(new URL(path, 'https://qms.invalid').searchParams.get('organizationId')).toBe(organizationId);
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  expect(screen.getByText('已选择 0 条来源')).toBeVisible();
  expect(vi.mocked(apiRequest).mock.calls.some(([, options]) => options?.method)).toBe(false);
  const drawer = screen.getByText('来源详情').closest('[role="dialog"]') as HTMLElement;
  fireEvent.click(within(drawer).getByRole('button', { name: /^(close|关闭)$/i }));
  await waitFor(() => expect(screen.queryByText('来源详情')).not.toBeInTheDocument(), { timeout: 5000 });
  fireEvent.click(screen.getByRole('button', { name: /^刷\s*新$/ }));
  await waitFor(() => expect(permissionReads).toBeGreaterThan(1));
  expect(sourceDetailCalls()).toHaveLength(1);
  expect(screen.queryByText('来源详情')).not.toBeInTheDocument();
});

it.each(['missing', '403'] as const)('does not read a source deep-link before actual READ access is granted: %s', async mode => {
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path.includes('/my-permissions')) {
      if (mode === '403') throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, 403);
      return { permissions: ['supplier-quality:issues:copy'] };
    }
    return sourceReadResponse(path);
  });
  mount(sourceLink());
  await screen.findByText('暂无制程不良访问权限');
  expect(sourceDetailCalls()).toHaveLength(0);
  expect(screen.queryByText('来源详情')).not.toBeInTheDocument();
});

it('clears private source content and aborts both detail reads when a deep-link target returns 403', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (new URL(path, 'https://qms.invalid').pathname === `/api/v1/process-quality/defects/${defect.id}`) throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'private' }, 403);
    return sourceReadResponse(path);
  });
  mount(sourceLink());
  await screen.findByText('暂无制程不良访问权限');
  const reads = vi.mocked(apiRequest).mock.calls.filter(([path]) => new URL(path, 'https://qms.invalid').pathname.startsWith(`/api/v1/process-quality/defects/${defect.id}`));
  expect(reads).toHaveLength(2);
  expect(reads.every(([, options]) => options?.signal?.aborted)).toBe(true);
  expect(screen.queryByText('表面划伤')).not.toBeInTheDocument();
  expect(screen.queryByText('来源详情')).not.toBeInTheDocument();
  expect(vi.mocked(apiRequest).mock.calls.some(([, options]) => options?.method)).toBe(false);
});

it.each([`?defectId=not-a-uuid`, `?organizationId=bad&defectId=${defect.id}`])('rejects an invalid source deep-link before any API call: %s', async query => {
  mount(`/app/process-quality${query}`);
  expect(await screen.findByText('制程来源链接参数无效')).toBeVisible();
  expect(apiRequest).not.toHaveBeenCalled();
});

it('aborts a replaced source deep-link and identity, ignores late data, and preserves existing selection without auto-issue', async () => {
  const nextId = '77777777-7777-4777-8777-777777777777';
  let resolveOld!: (value: typeof defect) => void;
  let identityChanged = false;
  vi.mocked(apiRequest).mockImplementation(async path => {
    const url = new URL(path, 'https://qms.invalid');
    if (identityChanged && path.includes('/my-permissions')) return new Promise(() => {});
    if (url.pathname === `/api/v1/process-quality/defects/${defect.id}`) return new Promise(done => { resolveOld = done; });
    if (url.pathname === `/api/v1/process-quality/defects/${nextId}`) return { ...defect, id: nextId, description: '当前链接目标' };
    if (url.pathname === '/api/v1/process-quality/defects') return identityChanged ? { ...list, items: [] } : list;
    return sourceReadResponse(path);
  });
  mount(`/app/process-quality?organizationId=${organizationId}`, <><Link to={sourceLink()}>来源A</Link><Link to={sourceLink(nextId)}>来源B</Link><Link to={`${sourceLink(nextId)}&view=other`}>无关参数</Link></>);
  fireEvent.click(await screen.findByLabelText('选择制程不良 表面划伤'));
  fireEvent.click(screen.getByText('来源A'));
  await waitFor(() => expect(sourceDetailCalls()).toHaveLength(1));
  const oldSignal = sourceDetailCalls()[0][1]?.signal;
  fireEvent.click(screen.getByText('来源B'));
  await screen.findByText('当前链接目标');
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => resolveOld({ ...defect, description: '迟到链接私密内容' }));
  expect(screen.queryByText('迟到链接私密内容')).not.toBeInTheDocument();
  expect(screen.getByLabelText('选择制程不良 表面划伤')).toBeChecked();
  expect(screen.getByText('已选择 1 条来源')).toBeVisible();
  fireEvent.click(screen.getByText('无关参数'));
  const nextCalls = () => vi.mocked(apiRequest).mock.calls.filter(([path]) => new URL(path, 'https://qms.invalid').pathname === `/api/v1/process-quality/defects/${nextId}`);
  expect(nextCalls()).toHaveLength(1);
  const nextSignal = nextCalls()[0][1]?.signal;
  identityChanged = true;
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:another-org:another-user'));
  await waitFor(() => expect(nextSignal?.aborted).toBe(true));
  expect(screen.queryByText('当前链接目标')).not.toBeInTheDocument();
  expect(screen.getByText('已选择 0 条来源')).toBeVisible();
  expect(nextCalls()).toHaveLength(1);
  expect(vi.mocked(apiRequest).mock.calls.some(([, options]) => options?.method)).toBe(false);
});

it('preserves legacy BRIEF issue permission independently from formal 8D issue permission', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => path.includes('/my-permissions') ? { permissions: ['process-quality:defects:read', 'process-quality:defects:write'] } : baseResponse(path));
  mount(); await screen.findByLabelText('选择制程不良 表面划伤');
  expect(screen.getByRole('button', { name: '发起问题' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '发起内部8D' })).not.toBeInTheDocument();
});
async function selectOption(label: string, text: string, queries: Pick<typeof screen, 'getByLabelText'> = screen) {
  const control = queries.getByLabelText(label);
  await waitFor(() => expect(control).not.toBeDisabled());
  fireEvent.mouseDown(control);
  fireEvent.click(await screen.findByText(text, { selector: '.ant-select-item-option-content' }));
}
async function openIssue() {
  const onIssued = vi.fn();
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><ProcessEightDIssueDrawer sources={[defect]} onClose={vi.fn()} onIssued={onIssued} onDenied={vi.fn()} /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  await screen.findByText('PQ-OLD');
  return onIssued;
}
async function fillIssue() {
  const drawer = within(screen.getByText('发起正式内部8D').closest('[role="dialog"]') as HTMLElement);
  fireEvent.click(drawer.getByLabelText('非复发'));
  await selectOption('风险等级', '高', drawer);
  await selectOption('责任科室', '制造科', drawer);
  await selectOption('负责人', '真实负责人', drawer);
}

it('previews visible and hidden relations without defaulting recurrence; posts server-bound 8D with exact token', async () => {
  const onIssued = await openIssue();
  expect(screen.getByText('已有问题')).toBeVisible();
  expect(screen.getByText(/存在无权查看的关联/)).toBeVisible();
  expect(screen.queryByLabelText('流程定义 ID')).not.toBeInTheDocument();
  expect(screen.getByRole('radio', { name: '非复发' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: '非复发' }));
  await selectOption('风险等级', '高');
  await selectOption('责任科室', '制造科');
  await selectOption('负责人', '真实负责人');
  fireEvent.change(screen.getByLabelText('分析/对策期限'), { target: { value: '2026-11-10' } });
  fireEvent.change(screen.getByLabelText('关闭计划'), { target: { value: '2026-11-20' } });
  fireEvent.click(screen.getByText('确认发起8D'));
  await waitFor(() => expect(onIssued).toHaveBeenCalled());
  const call = vi.mocked(apiRequest).mock.calls.find(([path, init]) => path.endsWith('/eight-d') && init?.method === 'POST');
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ sources: [{ defectId: defect.id, expectedVersion: 2 }], severity: 'HIGH', ownerUserId: owner.id, responsibleSectionDepartmentId: section.id, sourceConfirmations: [{ defectId: defect.id, relatedProblemIds: ['old'], recurrence: 'NOT_RECURRENCE', relatedSetToken: 'opaque-exact-1' }] });
  expect(String(call?.[1]?.body)).not.toContain('workflow');
});

it('registers unknown facts as null without inventing quantity, classification, date or SQE tasks', async () => {
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><ProcessDefectEditor suppliers={[]} canReadSuppliers={false} onClose={vi.fn()} onSaved={vi.fn()} onDenied={vi.fn()} /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  fireEvent.change(await screen.findByLabelText('失效现象'), { target: { value: '待分析' } });
  fireEvent.click(screen.getByText('保存登记'));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/process-quality/defects', expect.objectContaining({ method: 'POST' }), { replayAfterReauthentication: false }));
  const call = vi.mocked(apiRequest).mock.calls.find(([path, init]) => path.endsWith('/defects') && init?.method === 'POST');
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ description: '待分析', defectQuantity: null, occurredAt: null, responsibilityCategory: null });
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('/tasks'))).toBe(false);
});

it('uses independent close permission and clears sensitive rows after an actual close 403', async () => {
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.endsWith('/close') && init?.method === 'PUT') throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'private' }, 403);
    return baseResponse(path);
  });
  mount();
  fireEvent.click(await screen.findByText('查看详情'));
  fireEvent.click(await screen.findByText('关闭台账'));
  const title = await screen.findByText('确认关闭', { selector: '.ant-modal-title' });
  await waitFor(() => expect(title).toBeVisible());
  fireEvent.click(within(title.closest('[role="dialog"]') as HTMLElement).getByText('确认关闭', { selector: 'button span' }));
  await screen.findByText('暂无制程不良访问权限');
  expect(screen.queryByText('表面划伤')).not.toBeInTheDocument();
});

it('keeps keyboard-accessible warning explanations and saved manual mapping rather than applying suggestions', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => path.includes('/defects?') ? { ...list, items: [{ ...defect, projectCode: 'MANUAL', issues: ['MANUAL_PROJECT_DIFFERS'], duplicateCount: 1 }] } : baseResponse(path));
  mount();
  const hint = await screen.findByLabelText(/映射与来源提示/);
  fireEvent.focus(hint);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(/人工项目/);
  expect(screen.getByText('MANUAL')).toBeVisible();
});

it('requires an explicit recurrence decision even for a source without existing relations', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => path.endsWith('/sources/preview') ? [{ ...preview[0], relatedProblems: [], hasHiddenRelations: false }] : baseResponse(path));
  render(<LanguageProvider><MemoryRouter><ProcessEightDIssueDrawer sources={[defect]} onClose={vi.fn()} onIssued={vi.fn()} onDenied={vi.fn()} /></MemoryRouter></LanguageProvider>);
  expect(await screen.findByLabelText('非复发')).not.toBeChecked();
});

it('revalidates the exact related-set token before POST and preserves draft when the relation set changes', async () => {
  let reads = 0;
  vi.mocked(apiRequest).mockImplementation(async path => path.endsWith('/sources/preview') ? [{ ...preview[0], relatedSetToken: ++reads === 1 ? 'first-token' : 'changed-token' }] : baseResponse(path));
  const issued = await openIssue();
  await fillIssue();
  fireEvent.change(screen.getByLabelText('分析/对策期限'), { target: { value: '2026-11-10' } });
  fireEvent.click(screen.getByText('确认发起8D'));
  await screen.findByText(/关联集合已变化/);
  expect(issued).not.toHaveBeenCalled();
  expect(screen.getByLabelText('非复发')).not.toBeChecked();
  expect(screen.getByLabelText('分析/对策期限')).toHaveValue('2026-11-10');
  expect(vi.mocked(apiRequest).mock.calls.filter(([path, init]) => path.endsWith('/eight-d') && init?.method === 'POST')).toHaveLength(0);
});

it.each([401, 403])('clears parent sources, relations and draft when the preflight preview returns %i', async status => {
  let reads = 0;
  let reject!: (cause: unknown) => void;
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path.endsWith('/sources/preview') && ++reads === 2) return new Promise((_, fail) => { reject = fail; });
    return baseResponse(path);
  });
  useWorkTabsStore.getState().bindSession(`INTERNAL:${organizationId}:${owner.id}`);
  mount();
  fireEvent.click(await screen.findByLabelText('选择制程不良 表面划伤'));
  fireEvent.click(await screen.findByText('发起内部8D'));
  await screen.findByText('PQ-OLD');
  await fillIssue();
  fireEvent.change(screen.getByLabelText(`判定说明 ${defect.id}`), { target: { value: '敏感判定草稿' } });
  fireEvent.change(screen.getByLabelText('分析/对策期限'), { target: { value: '2026-11-10' } });
  fireEvent.click(screen.getByText('确认发起8D'));
  await waitFor(() => expect(reads).toBe(2));
  await act(async () => { reject(new ApiError({ code: status === 401 ? 'AUTH_SESSION_REQUIRED' : 'FEATURE_PERMISSION_DENIED', message: 'private' }, status)); });
  expect(await screen.findByText(status === 401 ? '会话已退出，请登录' : '暂无制程不良访问权限')).toBeVisible();
  expect(reads).toBe(2);
  expect(screen.queryByText('表面划伤')).not.toBeInTheDocument();
  expect(screen.queryByText('PQ-OLD')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('敏感判定草稿')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('分析/对策期限')).not.toBeInTheDocument();
  expect(screen.queryByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeInTheDocument();
  expect(vi.mocked(apiRequest).mock.calls.filter(([path, init]) => path.endsWith('/eight-d') && init?.method === 'POST')).toHaveLength(0);
  if (status === 401) expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
});

it.each(['material-sqes', 'defect-types'])('ends the parent session when only editor %s candidates return 401', async endpoint => {
  let reject!: (cause: unknown) => void;
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path.includes(`/${endpoint}`)) return new Promise((_, fail) => { reject = fail; });
    return baseResponse(path);
  });
  useWorkTabsStore.getState().bindSession(`INTERNAL:${organizationId}:${owner.id}`);
  mount();
  fireEvent.click(await screen.findByLabelText('选择制程不良 表面划伤'));
  fireEvent.click(await screen.findByText('登记不良', { selector: 'button span' }));
  fireEvent.change(await screen.findByLabelText('失效现象'), { target: { value: '敏感登记草稿' } });
  await waitFor(() => expect(reject).toBeTypeOf('function'));
  await act(async () => { reject(new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: 'private' }, 401)); });
  expect(await screen.findByText('会话已退出，请登录')).toBeVisible();
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(screen.queryByText('表面划伤')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('敏感登记草稿')).not.toBeInTheDocument();
  expect(screen.queryByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeInTheDocument();
  expect(vi.mocked(apiRequest).mock.calls.some(([, init]) => init?.method)).toBe(false);
});

it.each([
  { zone: 'Asia/Taipei', offset: -480, display: '2026-10-26T07:23', edited: '2026-10-26T06:15:00.000Z' },
  { zone: 'America/New_York', offset: 240, display: '2026-10-25T19:23', edited: '2026-10-26T18:15:00.000Z' },
].flatMap(zone => (['untouched', 'edited', 'cleared'] as const).map(action => ({ ...zone, action }))))('preserves occurredAt intent $action across $zone parent/editor saves', async ({ zone, offset, display, edited, action }) => {
  vi.stubEnv('TZ', zone);
  const original = '2026-10-25T23:23:45.678Z';
  expect(new Date(original).getTimezoneOffset()).toBe(offset);
  let persisted: typeof defect = { ...defect, occurredAt: original };
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.includes('/defects?')) return { ...list, items: [persisted] };
    if (path.endsWith(`/defects/${defect.id}`)) {
      if (init?.method === 'PUT') persisted = { ...persisted, ...JSON.parse(String(init.body)), version: 3 };
      return persisted;
    }
    return baseResponse(path);
  });
  mount();
  fireEvent.click(await screen.findByText('查看详情'));
  fireEvent.click(await screen.findByText('维护台账'));
  const time = await screen.findByLabelText('发生时间');
  expect(time).toHaveValue(display);
  if (action !== 'untouched') fireEvent.change(time, { target: { value: action === 'cleared' ? '' : '2026-10-26T14:15' } });
  fireEvent.change(screen.getByLabelText('失效现象'), { target: { value: '只补充描述，不猜时间精度' } });
  fireEvent.click(screen.getByText('保存登记'));
  await waitFor(() => expect(persisted.version).toBe(3));
  expect(persisted.occurredAt).toBe(action === 'untouched' ? original : action === 'cleared' ? null : edited);
  const call = vi.mocked(apiRequest).mock.calls.find(([, init]) => init?.method === 'PUT');
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ description: '只补充描述，不猜时间精度', expectedVersion: 2 });
});

it('keeps a formal issue draft after 409 and reuses the unchanged request key on retry', async () => {
  let attempts = 0;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.endsWith('/eight-d') && init?.method === 'POST' && ++attempts === 1) throw new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409);
    return baseResponse(path);
  });
  const issued = await openIssue();
  await fillIssue();
  fireEvent.click(screen.getByText('确认发起8D'));
  await screen.findByText('记录已被其他用户更新，请刷新后重试');
  expect(screen.getByLabelText('非复发')).toBeChecked();
  fireEvent.click(screen.getByText('确认发起8D'));
  await waitFor(() => expect(issued).toHaveBeenCalled());
  const calls = vi.mocked(apiRequest).mock.calls.filter(([path, init]) => path.endsWith('/eight-d') && init?.method === 'POST');
  expect(calls).toHaveLength(2);
  expect(new Headers(calls[0][1]?.headers).get('Idempotency-Key')).toBe(new Headers(calls[1][1]?.headers).get('Idempotency-Key'));
});

it('freezes the issue fields during the final related-set preflight', async () => {
  let resolve!: (value: typeof preview) => void;
  let reads = 0;
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path.endsWith('/sources/preview') && ++reads > 1) return new Promise(done => { resolve = done; });
    return baseResponse(path);
  });
  const issued = await openIssue();
  await fillIssue();
  fireEvent.click(screen.getByText('确认发起8D'));
  await waitFor(() => expect(reads).toBe(2));
  expect(screen.getByLabelText('分析/对策期限')).toBeDisabled();
  expect(screen.getByLabelText('风险等级')).toBeDisabled();
  expect(screen.getByLabelText('责任科室')).toBeDisabled();
  expect(screen.getByLabelText('负责人')).toBeDisabled();
  await act(async () => { resolve(preview); });
  await waitFor(() => expect(issued).toHaveBeenCalled());
});

it('keeps owner search keyboard-editable while loading and blocks issuing with stale candidates', async () => {
  const user = userEvent.setup();
  let searching = false;
  let resolve!: (value: ReturnType<typeof baseResponse>) => void;
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path.includes('/assignment-options') && new URL(path, 'http://localhost').searchParams.get('search') === 'a') {
      searching = true;
      return new Promise(done => { resolve = done; });
    }
    return baseResponse(path);
  });
  await openIssue();
  await fillIssue();
  const drawer = within(screen.getByText('发起正式内部8D').closest('[role="dialog"]') as HTMLElement);
  const input = drawer.getByLabelText('负责人');
  await user.type(input, 'a');
  await waitFor(() => expect(searching).toBe(true));
  expect(input).toBeEnabled();
  expect(input).toHaveFocus();
  expect(screen.queryByText('真实负责人', { selector: '.ant-select-item-option-content' })).not.toBeInTheDocument();
  expect(drawer.getByText('确认发起8D').closest('button')).toBeDisabled();
  await act(async () => { resolve({ departments: [section], users: [owner], departmentTotal: 1, userTotal: 1, page: 1, pageSize: 100 }); });
  await screen.findByText('真实负责人', { selector: '.ant-select-item-option-content' });
});

it('retains sources across pages and sends both recorded versions in a batch classification', async () => {
  const other = { ...defect, id: '55555555-5555-4555-8555-555555555555', description: '第二页线索', version: 7 };
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.includes('/defects?')) return { ...list, total: 21, items: path.includes('page=2&') ? [other] : [defect] };
    if (path.endsWith('/classification') && init?.method === 'PUT') return { items: [{ ...defect, version: 3 }, { ...other, version: 8 }] };
    return baseResponse(path);
  });
  mount();
  fireEvent.click(await screen.findByLabelText('选择制程不良 表面划伤'));
  fireEvent.click(screen.getByTitle('2'));
  fireEvent.click(await screen.findByLabelText('选择制程不良 第二页线索'));
  expect(screen.getByText('已选择 2 条来源')).toBeVisible();
  fireEvent.mouseDown(screen.getByLabelText('批量责任分类'));
  for (const label of ['物料', '作业', '设备', '工艺', '设计', '误报']) {
    expect(await screen.findByText(label, { selector: '.ant-select-item-option-content' })).toBeInTheDocument();
  }
  fireEvent.click(screen.getByText('误报', { selector: '.ant-select-item-option-content' }));
  fireEvent.click(screen.getByText('应用分类'));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.endsWith('/classification'))).toBe(true));
  const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path.endsWith('/classification'));
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ sources: [{ defectId: defect.id, expectedVersion: 2 }, { defectId: other.id, expectedVersion: 7 }], responsibilityCategory: 'FALSE_POSITIVE' });
});

it.each(['selected', 'new'] as const)('keeps the 100-source limit consistent for a %s detail entry', async entry => {
  compactTable.enabled = true;
  const sources = Array.from({ length: 101 }, (_, index) => ({ ...defect, id: `source-${index}`, description: `边界来源 ${index}` }));
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path.includes('/defects?')) {
      const page = Number(new URL(path, 'http://localhost').searchParams.get('page'));
      return { ...list, total: sources.length, items: sources.slice((page - 1) * 20, page * 20) };
    }
    const record = sources.find(item => path.endsWith(`/defects/${item.id}`));
    return record ?? baseResponse(path);
  });
  mount();
  for (let page = 1; page <= 5; page++) {
    if (page > 1) fireEvent.click(screen.getByTitle(String(page)));
    await screen.findByLabelText(`选择制程不良 边界来源 ${(page - 1) * 20}`);
    act(() => { screen.getAllByLabelText(/^选择制程不良 /).forEach(checkbox => fireEvent.click(checkbox)); });
    expect(screen.getByText(`已选择 ${page * 20} 条来源`)).toBeVisible();
  }
  if (entry === 'new') {
    fireEvent.click(screen.getByTitle('6'));
    expect(await screen.findByLabelText('选择制程不良 边界来源 100')).toBeDisabled();
  }
  fireEvent.click(screen.getByText(entry === 'selected' ? '边界来源 80' : '边界来源 100', { selector: 'button span' }));
  const button = (await screen.findByText('选择此条并发起问题')).closest('button')!;
  if (entry === 'selected') {
    fireEvent.click(button);
    expect(await screen.findByText('发起制程问题', { selector: '.ant-drawer-title' })).toBeVisible();
    expect(screen.getByLabelText('选择制程不良 边界来源 80')).toBeChecked();
  } else {
    expect(button).toBeDisabled();
    expect(screen.getByText('已选满100条来源，请先取消一条已选来源，再选择此条。')).toBeVisible();
    fireEvent.click(button);
    expect(screen.queryByText('发起制程问题', { selector: '.ant-drawer-title' })).not.toBeInTheDocument();
  }
  expect(screen.getByText('已选择 100 条来源')).toBeVisible();
});

it('retries an unknown formal issue result without re-previewing or changing the original payload', async () => {
  let attempts = 0;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.endsWith('/eight-d') && init?.method === 'POST' && ++attempts === 1) throw new TypeError('connection lost');
    return baseResponse(path);
  });
  const issued = await openIssue();
  await fillIssue();
  fireEvent.click(screen.getByText('确认发起8D'));
  const retry = await screen.findByText('同请求重试发起8D');
  const previewCount = vi.mocked(apiRequest).mock.calls.filter(([path]) => path.endsWith('/sources/preview')).length;
  expect(screen.getByLabelText('分析/对策期限')).toBeDisabled();
  fireEvent.click(retry);
  await waitFor(() => expect(issued).toHaveBeenCalled());
  expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path.endsWith('/sources/preview'))).toHaveLength(previewCount);
  const calls = vi.mocked(apiRequest).mock.calls.filter(([path, init]) => path.endsWith('/eight-d') && init?.method === 'POST');
  expect(calls[0][1]?.body).toBe(calls[1][1]?.body);
  expect(new Headers(calls[0][1]?.headers).get('Idempotency-Key')).toBe(new Headers(calls[1][1]?.headers).get('Idempotency-Key'));
});

it('protects an unfinished formal issue on keyboard drawer close', async () => {
  await openIssue();
  fireEvent.change(screen.getByLabelText('分析/对策期限'), { target: { value: '2026-11-10' } });
  const drawer = screen.getByRole('dialog', { name: '发起正式内部8D' });
  fireEvent.keyDown(drawer, { key: 'Escape', keyCode: 27 });
  const title = await screen.findByText('当前草稿尚未保存，继续将放弃修改。', { selector: '.ant-modal-title' });
  await waitFor(() => expect(title).toBeVisible());
  fireEvent.click(within(title.closest('[role="dialog"]') as HTMLElement).getByText('继续编辑'));
  expect(screen.getByLabelText('分析/对策期限')).toHaveValue('2026-11-10');
});

it('never shows PQC close or material review merely because the account can maintain defects', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => path.includes('/my-permissions') ? { permissions: ['process-quality:defects:write'] } : baseResponse(path));
  mount();
  fireEvent.click(await screen.findByText('查看详情'));
  await screen.findByText('维护台账');
  expect(screen.queryByText('关闭台账')).not.toBeInTheDocument();
  expect(screen.queryByText('恢复跟进')).not.toBeInTheDocument();
  expect(screen.queryByText('复核此物料')).not.toBeInTheDocument();
});

it('discards prior identity rows, selections and a late source-detail response on scope change', async () => {
  let resolve!: (value: typeof defect) => void;
  vi.mocked(apiRequest).mockImplementation(async path => path.endsWith(`/defects/${defect.id}`) ? new Promise(done => { resolve = done; }) : baseResponse(path));
  mount();
  fireEvent.click(await screen.findByText('查看详情'));
  vi.mocked(apiRequest).mockImplementation(async path => path.includes('/defects?') ? { ...list, items: [] } : baseResponse(path));
  useWorkTabsStore.getState().bindSession('INTERNAL:new-org:new-user');
  resolve({ ...defect, description: '迟到的旧账号敏感详情' });
  await screen.findByText('暂无不良记录');
  expect(screen.queryByText('迟到的旧账号敏感详情')).not.toBeInTheDocument();
  expect(screen.queryByText('表面划伤')).not.toBeInTheDocument();
  expect(screen.getByText('已选择 0 条来源')).toBeVisible();
});
