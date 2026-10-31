import type { components } from '@qms/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { CustomerQualityPage } from './CustomerQualityPage';
import { CustomerLedgerDetail } from './customer-ledger-detail';
import { CustomerLedgerEditor } from './customer-ledger-editor';
import { CustomerLedgerImportPanel } from './customer-ledger-import-panel';
import type { ReactNode } from 'react';

vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
vi.mock('./CustomerMasterSection', () => ({ CustomerMasterSection: () => <div>客户主数据保留入口</div> }));
vi.mock('./customer-analysis-panel', () => ({ CustomerAnalysisPanel: ({ complaintId, onDenied }: { complaintId: string; onDenied: (cause: ApiError) => void }) => <button aria-label="正式解析权限失效" onClick={() => onDenied(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, 403))}>正式解析 {complaintId}</button> }));
const base = '/api/v1/customer-quality/ledger';
const id = '11111111-1111-4111-8111-111111111111';
const org = '22222222-2222-4222-8222-222222222222';
const item: components['schemas']['CustomerLedgerDetailDto'] = {
  id, organizationId: org, complaintNumber: 'CQ-N4-1', version: 1, status: 'FOLLOWING', legacyStatus: 'OPEN', customerId: null,
  raw: { complaintType: 'AFTER_SALES', customerName: '待匹配客户', quantity: '2', mileage: '2000异常' },
  normalized: { complaintType: 'AFTER_SALES', customerName: '待匹配客户', terminalCustomerName: null, componentCode: 'C001', productModel: null, defectDescription: '真实故障', quantity: 2, vin: null, barcode: null, batch: null, mileage: null, occurredOn: null, productionOn: null, purchaseOn: null, vehicleDeliveryOn: null, vehicleOfflineOn: null, onlineOn: null, occurredAtLocation: null, occurredAtRegion: null, serviceMode: null, interceptionStatus: null, investigation: null },
  warnings: [{ field: 'mileage', code: 'INVALID_VALUE' }], registeredByUserId: 'user', qualityEngineerId: 'user', qualityEngineerAssignmentId: 'assignment', qualityEngineerSource: 'MANUAL', stage: 'NEW_PRODUCT', mapping: null,
  mileageBand: null, serviceMonths: null, misTag: null, courierNumber: null, receivedOn: null, closedAt: null, closedByUserId: null, closureNote: null, createdAt: '2026-10-26T01:00:00Z', history: [],
};
const permissions = ['customer-quality:complaints:read', 'customer-quality:complaints:write', 'customer-quality:complaints:close', 'customer-quality:complaints:closed-edit'];
const preview = { items: [{ rowNumber: 2, outcome: 'PREVIEW', complaintId: null, errorCode: null, warnings: item.warnings, record: item, similarities: [item] }], created: 0, supplemented: 0, skipped: 0, failed: 0, pendingCorrection: 1 };

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('NODE_ENV', 'development');
  useWorkTabsStore.getState().bindSession(`INTERNAL:${org}:user`);
  vi.mocked(getSession).mockReset().mockResolvedValue({ userId: 'user', organizationId: org, accountType: 'INTERNAL', landingPath: '/app/workbench' });
  vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockReset().mockImplementation(async (path, init) => {
    if (path.includes('/my-permissions')) return { organizationId: org, permissions };
    if (path.includes('/candidates')) return { items: [{ assignmentId: 'assignment', userId: 'user', fullName: '实际工程师', username: 'qe', positionName: '项目质量', departmentName: '质量' }] };
    if (path.includes('/customers')) return [];
    if (path.includes('/import/preview')) return preview;
    if (path.includes('/import/commit')) return { ...preview, created: 1 };
    if (path.split('?')[0] === `${base}/${id}/attachments` && (!init?.method || init.method === 'GET')) return [];
    if (init?.method) return { ...item, version: 2 };
    if (path.includes(`/${id}`)) return item;
    if (path.startsWith(base)) return { items: [item], total: 21, page: 1, pageSize: 20 };
    throw new Error(`Unexpected API: ${path}`);
  });
});
afterEach(() => vi.unstubAllEnvs());
const testContent = (content: ReactNode, route = '/app/customer-quality') => <ConfigProvider theme={{ token: { motion: false } }}><LanguageProvider><MemoryRouter initialEntries={[route]}><UnsavedChangesProvider>{content}</UnsavedChangesProvider></MemoryRouter></LanguageProvider></ConfigProvider>;
function showContent(content: ReactNode, route = '/app/customer-quality') { return render(testContent(content, route)); }
function show(route = '/app/customer-quality') { return showContent(<CustomerQualityPage renderAnalysis={complaintId => <div>解析插槽 {complaintId}</div>} />, route); }
const writes = () => vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method);

it('changes the real ledger page size and retains the selected source version', async () => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => path.includes('/my-permissions') ? { organizationId: org, permissions: [...permissions, 'customer-quality:issues:issue'] } : read(path, init));
  show();
  fireEvent.click(await screen.findByLabelText('选择客诉 CQ-N4-1'));
  const columnSettings = screen.getByText('列设置', { selector: 'button span' }).closest('button')!;
  fireEvent.click(columnSettings);
  fireEvent.click(screen.getByLabelText('上移 台账状态', { selector: 'button' }));
  expect(screen.getByLabelText('选择客诉 CQ-N4-1')).toBeChecked();
  fireEvent.click(columnSettings);
  fireEvent.click(screen.getByTitle('2'));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('page=2&pageSize=20'))).toBe(true));
  await screen.findByLabelText('选择客诉 CQ-N4-1');
  fireEvent.mouseDown(document.querySelector('.ant-pagination-options-size-changer [role="combobox"]')!);
  fireEvent.click(await screen.findByText('50 条/页', { selector: '.ant-select-item-option-content' }));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('page=1&pageSize=50'))).toBe(true));
  expect(await screen.findByLabelText('选择客诉 CQ-N4-1')).toBeChecked();
  expect(screen.getByText('已选择 1/100 条（跨页保留）')).toBeVisible();
});

it('opens supplier copy from customer selection with copy-only access but does not enable customer issue', async () => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.includes('/my-permissions')) return { organizationId: org, permissions: ['customer-quality:complaints:read', 'supplier-quality:issues:copy'] };
    if (path.includes('/reference-options')) return { items: [{ id: org, label: '复制目标档案' }], total: 1 };
    if (path.endsWith('/source-copies/preview')) return { token: id, expiresAt: '2099-01-01T00:00:00Z', facts: [] };
    return read(path, init);
  });
  show();
  const toolbar = within((await screen.findByLabelText('搜索客诉')).closest('.customer-quality-toolbar')!);
  const copy = await toolbar.findByRole('button', { name: '复制为供应商草稿' });
  expect(copy).toBeDisabled();
  fireEvent.click(await screen.findByLabelText('选择客诉 CQ-N4-1'));
  await waitFor(() => expect(copy).toBeEnabled());
  fireEvent.click(copy);
  const dialog = await screen.findByRole('dialog', { name: '受控复制为供应商草稿' });
  await waitFor(() => expect(dialog).toBeVisible());
  expect(toolbar.queryByRole('button', { name: '发起客户8D' })).not.toBeInTheDocument();
  fireEvent.mouseDown(screen.getByLabelText('目标供应商档案'));
  fireEvent.click(await screen.findByText('复制目标档案', { selector: '.ant-select-item-option-content' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '读取受控预览' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/supplier-quality/source-copies/preview', expect.objectContaining({ body: JSON.stringify({ supplierProfileId: org, sources: [{ kind: 'CUSTOMER_LEDGER', sourceId: id, sourceVersion: item.version }] }) }), { replayAfterReauthentication: false }));
  expect(writes().map(([path]) => path)).toEqual(['/api/v1/supplier-quality/source-copies/preview']);
});

it('hides supplier copy and copy selection without copy or internal issue access', async () => {
  show(); await screen.findByRole('button', { name: 'CQ-N4-1' }, { timeout: 5000 });
  expect(screen.queryByRole('button', { name: '复制为供应商草稿' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('选择客诉 CQ-N4-1')).not.toBeInTheDocument();
});

it('selects across pages, customers and complaint types for the actual issuer instead of limiting to the source QE', async () => {
  const second = { ...item, id: '33333333-3333-4333-8333-333333333333', complaintNumber: 'CQ-N4-2', qualityEngineerId: 'another-qe', normalized: { ...item.normalized, customerName: '其他客户', complaintType: 'ZERO_KM' } };
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.includes('/my-permissions')) return { organizationId: org, permissions: [...permissions, 'customer-quality:issues:issue'] };
    if (path.includes('/eight-d/sources/preview')) return [item, second].map(row => ({ sourceId: row.id, relatedProblems: [], hasHiddenRelations: false, relatedSetToken: `token-${row.id}` }));
    if (path.includes('/assignment-options')) return { departments: [], users: [], departmentTotal: 0, userTotal: 0 };
    if (path.startsWith(`${base}?`)) return { items: [path.includes('page=2') ? second : item], total: 21, pageSize: 20 };
    return read(path, init);
  });
  show(); fireEvent.click(await screen.findByLabelText('选择客诉 CQ-N4-1'));
  fireEvent.click(screen.getByTitle('2'));
  fireEvent.click(await screen.findByLabelText('选择客诉 CQ-N4-2'));
  fireEvent.click(screen.getByText('发起客户8D', { selector: 'button span' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/eight-d/sources/preview', expect.objectContaining({ body: JSON.stringify({ sources: [{ sourceId: id, expectedVersion: 1 }, { sourceId: second.id, expectedVersion: 1 }] }) })));
  const preview = await screen.findByRole('region', { name: '发单来源预览' });
  expect(preview).toHaveTextContent(item.complaintNumber);
  expect(preview).toHaveTextContent(second.complaintNumber);
});

it('mounts the authorized stale-engineer handoff in the formal ledger detail', async () => {
  const stale = { ...item, warnings: [{ field: 'qualityEngineerId', code: 'ENGINEER_NO_LONGER_ELIGIBLE' }] };
  showContent(<CustomerLedgerDetail record={stale} candidates={[]} permissions={[...permissions, 'customer-quality:complaints:reassign']} organizationId={org}
    onDenied={vi.fn()} onSaved={vi.fn()} refreshDetail={vi.fn().mockResolvedValue(stale)} />);
  const handoff = screen.getByRole('button', { name: '交接失效跟进人' });
  await act(async () => { fireEvent.click(handoff); });
  await waitFor(() => expect(screen.getByRole('combobox', { name: '接任质量工程师' })).toBeVisible());
  expect(screen.getByLabelText('交接原因')).toBeVisible();
  expect(writes()).toHaveLength(0);
});

it('loads three formal views and paginates at the server without the legacy strict importer', async () => {
  show();
  expect(await screen.findByLabelText('CQ-N4-1')).toBeVisible();
  fireEvent.click(screen.getByLabelText('零公里'));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('complaintType=ZERO_KM'))).toBe(true));
  fireEvent.click(screen.getByLabelText('售后'));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('complaintType=AFTER_SALES'))).toBe(true));
  fireEvent.click(screen.getByTitle('2'));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('page=2'))).toBe(true));
  expect(screen.queryByText(/severityPolicyVersion/)).not.toBeInTheDocument();
  expect(screen.getByText('客户主数据保留入口')).toBeInTheDocument();
});
it('preserves declared ledger column widths instead of letting long issue numbers squeeze other headers', async () => {
  show();
  const number = await screen.findByLabelText('CQ-N4-1');
  expect(screen.getByRole('table')).toHaveStyle({ tableLayout: 'fixed' });
  expect(number).toHaveClass('customer-ledger-number');
});
it('loads controlled deep-link detail in the target organization and exposes the analysis slot', async () => {
  show(`/app/customer-quality?complaintId=${id}&organizationId=${org}`);
  expect(await screen.findByText(`解析插槽 ${id}`)).toBeVisible();
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path === `${base}/${id}?organizationId=${org}`)).toBe(true);
  expect(await within(screen.getByRole('region', { name: '客诉详情' })).findByText('实际工程师')).toBeVisible();
  expect(screen.getAllByText('未计算').length).toBeGreaterThan(0);
});
it('mounts the formal analysis panel by default and clears the ledger when its access is revoked', async () => {
  showContent(<CustomerQualityPage />, `/app/customer-quality?complaintId=${id}&organizationId=${org}`);
  const detail = await screen.findByRole('region', { name: '客诉详情' });
  const deny = within(detail).getByRole('button', { name: '正式解析权限失效' });
  expect(deny).toHaveTextContent(id);
  fireEvent.click(deny);
  await waitFor(() => expect(screen.queryByRole('region', { name: '客诉详情' })).not.toBeInTheDocument());
  expect(screen.queryByLabelText('CQ-N4-1')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '正式解析权限失效' })).not.toBeInTheDocument();
});
it('rejects invalid query identifiers rather than issuing arbitrary detail requests', async () => {
  show('/app/customer-quality?complaintId=../private&organizationId=invalid');
  expect(await screen.findByText('客诉链接参数无效')).toBeVisible();
  expect(apiRequest).not.toHaveBeenCalled();
});
it('registers nullable/unknown customer and multi-quantity raw input without default risk or derived data', async () => {
  show();
  fireEvent.click(await screen.findByLabelText('人工登记客诉'));
  const dialog = screen.getByRole('dialog', { name: '人工登记客诉' });
  fireEvent.change(within(dialog).getByLabelText('客户'), { target: { value: '未建档客户' } });
  fireEvent.change(within(dialog).getByLabelText('件数'), { target: { value: '20' } });
  fireEvent.change(within(dialog).getByLabelText('详细故障描述'), { target: { value: `  ${'异'.repeat(2000)}  ` } });
  fireEvent.click(within(dialog).getByRole('button', { name: '登记' }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  const body = JSON.parse(String(writes()[0]?.[1]?.body));
  expect(body.fields).toEqual({ customerName: '未建档客户', quantity: '20', defectDescription: `  ${'异'.repeat(2000)}  ` });
  expect(body.customerId).toBeUndefined();
  expect(body).not.toHaveProperty('severity');
});
it('previews Chinese paste, explicitly selects a versioned supplement and reports actual results', async () => {
  show();
  fireEvent.click(await screen.findByLabelText('粘贴 / Excel 导入'));
  fireEvent.change(screen.getByLabelText('中文 TSV 粘贴'), { target: { value: '客户\t件数\t故障里程\n未知客户\t2\t异常2000' } });
  fireEvent.click(screen.getByLabelText('预览'));
  await screen.findByLabelText('第 2 行操作');
  fireEvent.change(screen.getByLabelText('第 2 行操作'), { target: { value: 'SUPPLEMENT' } });
  expect(screen.getByLabelText('继续，保留原文')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('第 2 行补充目标'), { target: { value: id } });
  fireEvent.click(screen.getByLabelText('第 2 行确认补充变更'));
  fireEvent.click(screen.getByLabelText('继续，保留原文'));
  await waitFor(() => expect(writes().some(([path]) => path.endsWith('/import/commit'))).toBe(true));
  const call = writes().find(([path]) => path.endsWith('/import/commit'))!;
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({ mode: 'CONTINUE', rows: [{ action: 'SUPPLEMENT', targetId: id, expectedVersion: 1, fields: { mileage: '异常2000' } }] });
  expect(await screen.findByText(/实际新增 1/)).toBeVisible();
});
it('exposes detailed warning raw values on keyboard focus', async () => {
  show();
  const hint = await screen.findByLabelText('CQ-N4-1 待补正说明');
  fireEvent.focus(hint);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('2000异常');
  expect(screen.getByRole('tooltip')).toHaveTextContent('故障里程');
});
it('keeps the edited draft and refreshes the expectedVersion after a conflict', async () => {
  let version = 1;
  const previous = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init, options) => {
    if (path === `${base}/${id}` && init?.method === 'PUT') { if (version === 1) { version = 2; throw new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409); } return { ...item, version: 3 }; }
    if (path === `${base}/${id}`) return { ...item, version };
    return previous(path, init, options);
  });
  show();
  fireEvent.click(await screen.findByLabelText('CQ-N4-1'));
  fireEvent.click(await screen.findByLabelText('编辑台账'));
  fireEvent.change(screen.getByLabelText('详细故障描述', { selector: 'textarea' }), { target: { value: '保留草稿' } });
  fireEvent.click(screen.getByLabelText('保存台账'));
  await waitFor(() => expect(screen.getByText(/已刷新服务器版本，草稿保留/)).toBeVisible());
  expect(screen.getByLabelText('详细故障描述', { selector: 'textarea' })).toHaveValue('保留草稿');
  fireEvent.click(screen.getByLabelText('保存台账'));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(JSON.parse(String(writes()[1]?.[1]?.body))).toMatchObject({ expectedVersion: 2, fields: { defectDescription: '保留草稿' } });
});
it.each([401, 403])('clears sensitive list/detail/draft on %s rather than leaving stale evidence', async status => {
  const previous = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init, options) => {
    if (init?.method === 'PUT') throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, status);
    return previous(path, init, options);
  });
  show();
  fireEvent.click(await screen.findByLabelText('CQ-N4-1'));
  fireEvent.click(await screen.findByLabelText('编辑台账'));
  fireEvent.change(screen.getByLabelText('详细故障描述', { selector: 'textarea' }), { target: { value: '敏感草稿' } });
  fireEvent.click(screen.getByLabelText('保存台账'));
  expect(await screen.findByText(/访问已失效/)).toBeVisible();
  expect(screen.queryByDisplayValue('敏感草稿')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'CQ-N4-1' })).not.toBeInTheDocument();
});
it('does not allow a non-responsible feature holder to edit or close another engineer record', async () => {
  vi.mocked(getSession).mockResolvedValue({ userId: 'other', organizationId: org, accountType: 'INTERNAL', landingPath: '/app/workbench' });
  useWorkTabsStore.getState().bindSession(`INTERNAL:${org}:other`);
  show();
  fireEvent.click(await screen.findByLabelText('CQ-N4-1'));
  await screen.findByText(`解析插槽 ${id}`);
  expect(screen.queryByRole('button', { name: '编辑台账' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '关闭台账' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '维护收件' })).not.toBeInTheDocument();
});
it('ignores an old scope detail that resolves after session change', async () => {
  let resolve!: (value: typeof item) => void;
  const previous = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation((path, init, options) => path === `${base}/${id}` ? new Promise(done => { resolve = done; }) : previous(path, init, options));
  show();
  fireEvent.click(await screen.findByLabelText('CQ-N4-1'));
  await waitFor(() => expect(resolve).toBeDefined());
  act(() => useWorkTabsStore.getState().bindSession(`INTERNAL:${org}:other`));
  await act(async () => { resolve(item); });
  expect(screen.queryByText(`解析插槽 ${id}`)).not.toBeInTheDocument();
});
it('clears the formal ledger parent when a mounted analysis slot reports a current denial', async () => {
  showContent(<CustomerQualityPage renderAnalysis={(complaintId, onDenied) => <button aria-label="解析报告权限失效" onClick={() => onDenied(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, 403))}>{complaintId}</button>} />);
  fireEvent.click(await screen.findByLabelText('CQ-N4-1'));
  fireEvent.click(await screen.findByLabelText('解析报告权限失效'));
  expect(await screen.findByText(/访问已失效/)).toBeVisible();
  expect(screen.queryByLabelText('CQ-N4-1')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('解析报告权限失效')).not.toBeInTheDocument();
});

const assignedCandidates = [{ assignmentId: 'assignment', userId: 'user', fullName: '实际工程师', username: 'qe', positionName: '项目质量', departmentName: '质量' }];
it('keeps accepted CQE editing while offering only qualified NEW assignment options', async () => {
  const candidates = [{ ...assignedCandidates[0], projectQualified: false }, { ...assignedCandidates[0], assignmentId: 'project-assignment', userId: 'project-user', fullName: '项目工程师', projectQualified: true }];
  showContent(<CustomerLedgerDetail record={item} candidates={candidates} userId="user" permissions={permissions} onDenied={vi.fn()} onSaved={vi.fn()} refreshDetail={async () => item} />);
  await act(async () => { fireEvent.click(screen.getByLabelText('编辑台账')); });
  await waitFor(() => expect(screen.getByLabelText('实际跟进质量工程师')).toBeVisible());
  const choices = within(screen.getByLabelText('实际跟进质量工程师'));
  expect(choices.queryByRole('option', { name: /实际工程师/ })).not.toBeInTheDocument();
  expect(choices.getByRole('option', { name: /项目工程师/ })).toBeEnabled();
  expect(choices.getByRole('option', { name: '保留当前实际跟进人' })).toBeEnabled();
  fireEvent.change(screen.getByLabelText('调查情况'), { target: { value: '保留已接受责任的更新' } });
  fireEvent.click(screen.getByLabelText('保存台账'));
  await waitFor(() => expect(writes()).toHaveLength(1));
  const body = JSON.parse(String(writes()[0][1]?.body));
  expect(body.fields.investigation).toBe('保留已接受责任的更新');
  expect(body).not.toHaveProperty('qualityEngineerAssignmentId');
});

it.each(['FOLLOWING', 'CLOSED'] as const)('only permits clearing an engineer while %s is following', async status => {
  const record = { ...item, status };
  showContent(<CustomerLedgerEditor record={record} candidates={assignedCandidates} onDenied={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} refreshDetail={async () => record} />);
  const engineer = screen.getByLabelText('实际跟进质量工程师');
  const clear = within(engineer).getByRole('option', { name: /清除指定/ });
  if (status === 'CLOSED') expect(clear).toBeDisabled(); else expect(clear).toBeEnabled();
  expect(within(engineer).getByRole('option', { name: '保留当前实际跟进人' })).toBeEnabled();
  expect(within(engineer).getByRole('option', { name: /实际工程师/ })).toBeEnabled();
  fireEvent.change(screen.getByLabelText('详细故障描述'), { target: { value: '允许正常补充事实' } });
  fireEvent.click(screen.getByLabelText('保存台账'));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(JSON.parse(String(writes()[0]?.[1]?.body))).toMatchObject({ fields: { defectDescription: '允许正常补充事实' }, expectedVersion: 1 });
  expect(JSON.parse(String(writes()[0]?.[1]?.body))).not.toHaveProperty('qualityEngineerAssignmentId');
});

function detailContent(record = item) {
  return <CustomerLedgerDetail record={record} candidates={assignedCandidates} userId="user" permissions={permissions} onDenied={vi.fn()} onSaved={vi.fn()} refreshDetail={async () => record} />;
}
it.each(['close', 'receiving'] as const)('discards only the confirmed local unknown %s attempt before starting the other action', async first => {
  const fallback = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation((path, init, options) => init?.method && writes().length === 1 ? Promise.reject(new TypeError('lost response')) : fallback(path, init, options));
  showContent(detailContent());
  fireEvent.click(screen.getByLabelText(first === 'close' ? '关闭台账' : '维护收件'));
  const label = first === 'close' ? '调查结论 / 关闭结果' : '快递单号';
  fireEvent.change(screen.getByLabelText(label), { target: { value: '原动作原文' } });
  fireEvent.click(screen.getByLabelText('保存台账动作'));
  await screen.findByText(/保存结果未知/);
  await waitFor(() => expect(screen.getByText(/不会撤销服务端/)).toBeVisible(), { timeout: 5000 });
  const original = writes()[0]!;
  fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
  fireEvent.click(await screen.findByText('继续编辑', { selector: 'button span' }));
  expect(screen.getByLabelText(label)).toHaveValue('原动作原文');
  expect(screen.getByLabelText(label)).toBeDisabled();
  expect(writes()).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
  fireEvent.click(await screen.findByText('放弃修改并关闭', { selector: 'button span' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(writes()).toHaveLength(1);
  fireEvent.click(screen.getByLabelText(first === 'close' ? '维护收件' : '关闭台账'));
  const nextLabel = first === 'close' ? '快递单号' : '调查结论 / 关闭结果';
  expect(screen.getByLabelText(nextLabel)).toBeEnabled();
  fireEvent.change(screen.getByLabelText(nextLabel), { target: { value: '新动作原文' } });
  fireEvent.click(screen.getByLabelText('保存台账动作'));
  await waitFor(() => expect(writes()).toHaveLength(2));
  const next = writes()[1]!;
  expect(next[0]).toBe(`${base}/${id}/${first === 'close' ? 'receiving' : 'close'}`);
  expect(JSON.parse(String(next[1]?.body))).toEqual({ expectedVersion: 1, ...(first === 'close' ? { courierNumber: '新动作原文' } : { note: '新动作原文' }) });
  expect(next[1]?.headers).not.toEqual(original[1]?.headers);
}, 30000);

it.each(['close', 'receiving'] as const)('keeps the exact unknown %s attempt when retrying without confirmed discard', async action => {
  const fallback = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation((path, init, options) => init?.method && writes().length === 1 ? Promise.reject(new TypeError('lost response')) : fallback(path, init, options));
  showContent(detailContent());
  fireEvent.click(screen.getByLabelText(action === 'close' ? '关闭台账' : '维护收件'));
  fireEvent.change(screen.getByLabelText(action === 'close' ? '调查结论 / 关闭结果' : '快递单号'), { target: { value: '同一原文' } });
  fireEvent.click(screen.getByLabelText('保存台账动作'));
  await screen.findByText(/保存结果未知/);
  fireEvent.click(screen.getByLabelText('保存台账动作'));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(writes()[1]).toEqual(writes()[0]);
});

it.each(['archived', 'legacy'] as const)('retains archived %s read/history but excludes edit, receiving, reopening and source upload', async mode => {
  const record = Object.assign({ ...item, status: 'CLOSED' as const }, mode === 'archived' ? { archived: true } : { legacyStatus: 'ARCHIVED' });
  showContent(detailContent(record));
  await waitFor(() => expect(screen.queryByLabelText('正在读取来源附件')).not.toBeInTheDocument());
  expect(screen.getByRole('region', { name: '客诉详情' })).toBeVisible();
  expect(screen.getByText('台账历史（0）')).toBeInTheDocument();
  expect(screen.getByText('登记事实与原填写（含待补正值）')).toBeInTheDocument();
  for (const name of ['编辑台账', '维护收件', '恢复跟进', '关闭台账']) expect(screen.queryByLabelText(name)).not.toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: '客诉来源附件' })).queryByLabelText('选择附件')).not.toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});

it.each(['edit', 'close', 'receiving'] as const)('blocks an open %s dispatch if the source becomes archived while CSRF is pending', async action => {
  let resolve!: (token: string) => void;
  const view = showContent(detailContent());
  fireEvent.click(screen.getByLabelText(action === 'edit' ? '编辑台账' : action === 'close' ? '关闭台账' : '维护收件'));
  fireEvent.change(screen.getByLabelText(action === 'edit' ? '详细故障描述' : action === 'close' ? '调查结论 / 关闭结果' : '快递单号'), { target: { value: '归档前的本地输入' } });
  vi.mocked(csrfToken).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByLabelText(action === 'edit' ? '保存台账' : '保存台账动作'));
  await waitFor(() => expect(csrfToken).toHaveBeenCalledTimes(1));
  view.rerender(testContent(detailContent(Object.assign({ ...item, version: 2 }, { archived: true }))));
  await act(async () => { resolve('late'); });
  expect(writes()).toHaveLength(0);
});

it('blocks an already open editor as soon as its source becomes archived', async () => {
  const view = showContent(detailContent());
  fireEvent.click(screen.getByLabelText('编辑台账'));
  fireEvent.change(screen.getByLabelText('详细故障描述'), { target: { value: '本地草稿' } });
  view.rerender(testContent(detailContent(Object.assign({ ...item, version: 2 }, { archived: true }))));
  expect(screen.queryByRole('dialog', { name: '编辑台账' })).not.toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});

it('keeps ordinary CLOSED records editable with closed-edit and leaves reopening available', async () => {
  showContent(detailContent(Object.assign({ ...item, status: 'CLOSED' as const }, { archived: false })));
  expect(screen.getByLabelText('恢复跟进')).toBeEnabled();
  expect(screen.getByLabelText('维护收件')).toBeEnabled();
  fireEvent.click(screen.getByLabelText('编辑台账'));
  fireEvent.change(screen.getByLabelText('详细故障描述'), { target: { value: '关闭后补充的事实' } });
  fireEvent.click(screen.getByLabelText('保存台账'));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(JSON.parse(String(writes()[0]?.[1]?.body))).toEqual({ expectedVersion: 1, fields: { defectDescription: '关闭后补充的事实' } });
});

it('uses CAS after a local unknown discard instead of undoing or replaying the original server action', async () => {
  const fallback = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation((path, init, options) => {
    if (init?.method && writes().length === 1) throw new TypeError('lost close response');
    if (init?.method && writes().length === 2) throw new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409);
    return fallback(path, init, options);
  });
  const latest = { ...item, status: 'CLOSED' as const, version: 2 };
  const refresh = vi.fn().mockResolvedValue(latest);
  showContent(<CustomerLedgerDetail record={item} candidates={assignedCandidates} userId="user" permissions={permissions} onDenied={vi.fn()} onSaved={vi.fn()} refreshDetail={refresh} />);
  fireEvent.click(screen.getByLabelText('关闭台账'));
  fireEvent.change(screen.getByLabelText('调查结论 / 关闭结果'), { target: { value: '服务端可能已经关闭' } });
  fireEvent.click(screen.getByLabelText('保存台账动作'));
  await screen.findByText(/保存结果未知/);
  fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
  fireEvent.click(await screen.findByText('放弃修改并关闭', { selector: 'button span' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByLabelText('维护收件'));
  fireEvent.change(screen.getByLabelText('快递单号'), { target: { value: '新收件原文' } });
  fireEvent.click(screen.getByLabelText('保存台账动作'));
  await screen.findByText(/已刷新服务器版本，草稿保留/);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('快递单号')).toHaveValue('新收件原文');
  fireEvent.click(screen.getByLabelText('保存台账动作'));
  await waitFor(() => expect(writes()).toHaveLength(3));
  expect(writes().map(([path]) => path)).toEqual([`${base}/${id}/close`, `${base}/${id}/receiving`, `${base}/${id}/receiving`]);
  expect(JSON.parse(String(writes()[1]?.[1]?.body))).toEqual({ expectedVersion: 1, courierNumber: '新收件原文' });
  expect(JSON.parse(String(writes()[2]?.[1]?.body))).toEqual({ expectedVersion: 2, courierNumber: '新收件原文' });
});

it('maintains only courier and received date, with no fabricated received quantity or date', async () => {
  showContent(detailContent());
  fireEvent.click(screen.getByLabelText('维护收件'));
  expect(screen.getByLabelText('收件日期')).toHaveValue('');
  expect(screen.queryByLabelText('实收数量')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('快递单号'), { target: { value: 'SF123' } });
  fireEvent.change(screen.getByLabelText('收件日期'), { target: { value: '2026-10-27' } });
  fireEvent.click(screen.getByLabelText('保存台账动作'));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0]?.[0]).toBe(`${base}/${id}/receiving`);
  expect(JSON.parse(String(writes()[0]?.[1]?.body))).toEqual({ expectedVersion: 1, courierNumber: 'SF123', receivedOn: '2026-10-27' });
});
it.each([['FOLLOWING', '关闭台账', '调查结论 / 关闭结果', 'close'], ['CLOSED', '恢复跟进', '恢复原因', 'reopen']] as const)('keeps %s ledger action separate from 8D', async (status, button, label, endpoint) => {
  showContent(detailContent({ ...item, status }));
  fireEvent.click(screen.getByLabelText(button));
  expect(screen.getByLabelText('保存台账动作')).toBeDisabled();
  fireEvent.change(screen.getByLabelText(label), { target: { value: '  实际结论或原因  ' } });
  fireEvent.click(screen.getByLabelText('保存台账动作'));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0]?.[0]).toBe(`${base}/${id}/${endpoint}`);
  expect(JSON.parse(String(writes()[0]?.[1]?.body))).toEqual({ expectedVersion: 1, note: '  实际结论或原因  ' });
});
it('does not grant close or edit from a stale engineer assignment flagged by the server', () => {
  showContent(detailContent({ ...item, warnings: [{ field: 'qualityEngineerId', code: 'ENGINEER_NO_LONGER_ELIGIBLE' }] }));
  expect(screen.queryByLabelText('编辑台账')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('关闭台账')).not.toBeInTheDocument();
});
it('protects manual raw input on cancel and only discards after explicit confirmation', async () => {
  const close = vi.fn();
  showContent(<CustomerLedgerEditor candidates={[]} onDenied={vi.fn()} onSaved={vi.fn()} onClose={close} refreshDetail={async () => undefined} />);
  fireEvent.change(screen.getByLabelText('详细故障描述'), { target: { value: '  未保存原文  ' } });
  fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
  fireEvent.click(await screen.findByText('继续编辑', { selector: 'button span' }));
  expect(screen.getByLabelText('详细故障描述')).toHaveValue('  未保存原文  ');
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
  fireEvent.click(await screen.findByText('放弃修改并关闭', { selector: 'button span' }));
  expect(close).toHaveBeenCalledTimes(1);
});
it('allows explicit existing customer selection without UUID input or changing the raw customer name', async () => {
  const customer = { id, organization_id: org, code: 'C-1', name: '客户主数据名称', active: true, version: 1 };
  showContent(<CustomerLedgerEditor customers={[customer]} candidates={[]} onDenied={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} refreshDetail={async () => undefined} />);
  fireEvent.change(screen.getByLabelText('客户'), { target: { value: '  来源客户原文  ' } });
  fireEvent.change(screen.getByLabelText('关联客户主数据'), { target: { value: id } });
  fireEvent.click(screen.getByLabelText('登记'));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(JSON.parse(String(writes()[0]?.[1]?.body))).toMatchObject({ customerId: id, fields: { customerName: '  来源客户原文  ' } });
});
it.each(['CANCEL', 'SKIP_ERRORS'] as const)('sends explicit %s choice without turning warnings into fake success', async mode => {
  showContent(<CustomerLedgerImportPanel existing={[]} onDenied={vi.fn()} onClose={vi.fn()} onCommitted={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('中文 TSV 粘贴'), { target: { value: '客户\t件数\n未知客户\t错误原文' } });
  fireEvent.click(screen.getByLabelText('预览'));
  await screen.findByLabelText('第 2 行操作');
  fireEvent.click(screen.getByLabelText(mode === 'CANCEL' ? '取消本次导入' : '跳过错误行'));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(JSON.parse(String(writes()[1]?.[1]?.body))).toMatchObject({ mode });
  expect(writes()[1]?.[0]).toBe(`${base}/import/commit`);
});
it('retains a failed supplement raw row and refreshes its target version instead of retrying successful rows', async () => {
  const previous = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init, options) => {
    if (path.endsWith('/import/commit')) return { ...preview, items: [{ ...preview.items[0], outcome: 'FAILED', errorCode: 'CONCURRENCY_CONFLICT' }], created: 0, failed: 1 };
    if (path === `${base}/${id}`) return { ...item, version: 8 };
    return previous(path, init, options);
  });
  showContent(<CustomerLedgerImportPanel existing={[item]} onDenied={vi.fn()} onClose={vi.fn()} onCommitted={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('中文 TSV 粘贴'), { target: { value: '客户\t件数\n  原客户  \t异常件数' } });
  fireEvent.click(screen.getByLabelText('预览'));
  await screen.findByLabelText('第 2 行操作');
  fireEvent.change(screen.getByLabelText('第 2 行操作'), { target: { value: 'SUPPLEMENT' } });
  fireEvent.change(screen.getByLabelText('第 2 行补充目标'), { target: { value: id } });
  fireEvent.click(screen.getByLabelText('第 2 行确认补充变更'));
  fireEvent.click(screen.getByLabelText('继续，保留原文'));
  fireEvent.click(await screen.findByText('保留失败行并刷新版本，重新预览', { selector: 'button span' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`${base}/${id}`, expect.anything()));
  await waitFor(() => expect(screen.getByLabelText('预览')).toBeEnabled());
  fireEvent.click(screen.getByLabelText('预览'));
  await screen.findByLabelText('第 2 行操作');
  const lastPreview = writes().filter(([path]) => path.endsWith('/import/preview')).at(-1)!;
  expect(JSON.parse(String(lastPreview[1]?.body))).toMatchObject({ rows: [{ fields: { customerName: '  原客户  ', quantity: '异常件数' }, targetId: id, expectedVersion: 8 }] });
  expect(screen.getByLabelText('第 2 行确认补充变更')).not.toBeChecked();
});

it('rebases an edit onto fresh concurrent facts and sends only the local diff, not old quantity or protected investigation', async () => {
  const original = { ...item, raw: { ...item.raw, defectDescription: '原故障', investigation: '已有调查' } };
  const latest = { ...original, version: 2, raw: { ...original.raw, quantity: '3', productModel: '服务器新增型号' }, normalized: { ...original.normalized, quantity: 3 } };
  vi.mocked(apiRequest).mockRejectedValueOnce(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409)).mockResolvedValueOnce({ ...latest, version: 3 });
  showContent(<CustomerLedgerEditor record={original} candidates={assignedCandidates} onDenied={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} refreshDetail={async () => latest} />);
  const dialog = screen.getByRole('dialog', { name: '编辑台账' });
  fireEvent.change(within(dialog).getByLabelText('详细故障描述'), { target: { value: '  本地故障  ' } });
  fireEvent.click(within(dialog).getByLabelText('保存台账'));
  await waitFor(() => expect(within(dialog).getByLabelText('件数')).toHaveValue('3'));
  expect(within(dialog).getByLabelText('产品型号')).toHaveValue('服务器新增型号');
  expect(within(dialog).getByLabelText('详细故障描述')).toHaveValue('  本地故障  ');
  expect(JSON.parse(String(writes()[0]?.[1]?.body)).fields).toEqual({ defectDescription: '  本地故障  ' });
  fireEvent.click(within(dialog).getByLabelText('保存台账'));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(JSON.parse(String(writes()[1]?.[1]?.body))).toEqual({ expectedVersion: 2, fields: { defectDescription: '  本地故障  ' } });
});

it('shows original, server and local values for an actual edit conflict and requires explicit confirmation', async () => {
  const original = { ...item, raw: { ...item.raw, defectDescription: '原故障' } };
  const latest = { ...original, version: 2, raw: { ...original.raw, defectDescription: '服务器故障' } };
  vi.mocked(apiRequest).mockRejectedValueOnce(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409)).mockResolvedValueOnce({ ...latest, version: 3 });
  showContent(<CustomerLedgerEditor record={original} candidates={assignedCandidates} onDenied={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} refreshDetail={async () => latest} />);
  const dialog = screen.getByRole('dialog', { name: '编辑台账' });
  fireEvent.change(within(dialog).getByLabelText('详细故障描述'), { target: { value: '本地故障' } });
  fireEvent.click(within(dialog).getByLabelText('保存台账'));
  const conflict = await within(dialog).findByRole('region', { name: '字段冲突核对' });
  expect(conflict).toHaveTextContent('原：原故障');
  expect(conflict).toHaveTextContent('服务器：服务器故障');
  expect(conflict).toHaveTextContent('本地：本地故障');
  expect(within(dialog).getByLabelText('保存台账')).toBeDisabled();
  expect(writes()).toHaveLength(1);
  fireEvent.click(within(conflict).getByLabelText('确认保留本地冲突值'));
  fireEvent.click(within(dialog).getByLabelText('保存台账'));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(JSON.parse(String(writes()[1]?.[1]?.body))).toMatchObject({ expectedVersion: 2, fields: { defectDescription: '本地故障' } });
});

it('rebases receiving onto the latest untouched date and sends only the changed courier', async () => {
  const original = { ...item, courierNumber: '原单号', receivedOn: '2026-10-25' };
  const latest = { ...original, version: 2, receivedOn: '2026-10-27' };
  const fallback = vi.mocked(apiRequest).getMockImplementation()!;
  let receivingWrites = 0;
  vi.mocked(apiRequest).mockImplementation(async (path, init, options) => {
    if (path === `${base}/${id}/receiving` && init?.method === 'PUT') {
      if (++receivingWrites === 1) throw new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409);
      return { ...latest, version: 3 };
    }
    return fallback(path, init, options);
  });
  showContent(<CustomerLedgerDetail record={original} candidates={assignedCandidates} userId="user" permissions={permissions} onDenied={vi.fn()} onSaved={vi.fn()} refreshDetail={async () => latest} />);
  fireEvent.click(screen.getByLabelText('维护收件'));
  const dialog = screen.getByRole('dialog', { name: '维护收件' });
  fireEvent.change(within(dialog).getByLabelText('快递单号'), { target: { value: '本地单号' } });
  fireEvent.click(within(dialog).getByLabelText('保存台账动作'));
  await waitFor(() => expect(within(dialog).getByLabelText('收件日期')).toHaveValue('2026-10-27'));
  expect(within(dialog).getByLabelText('快递单号')).toHaveValue('本地单号');
  expect(JSON.parse(String(writes()[0]?.[1]?.body))).toEqual({ expectedVersion: 1, courierNumber: '本地单号' });
  fireEvent.click(within(dialog).getByLabelText('保存台账动作'));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(JSON.parse(String(writes()[1]?.[1]?.body))).toEqual({ expectedVersion: 2, courierNumber: '本地单号' });
});

it('requires confirmation of a same-field receiving conflict instead of blindly advancing the version', async () => {
  const original = { ...item, courierNumber: '原单号' };
  const latest = { ...original, version: 2, courierNumber: '服务器单号' };
  const fallback = vi.mocked(apiRequest).getMockImplementation()!;
  let receivingWrites = 0;
  vi.mocked(apiRequest).mockImplementation(async (path, init, options) => {
    if (path === `${base}/${id}/receiving` && init?.method === 'PUT') {
      if (++receivingWrites === 1) throw new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409);
      return { ...latest, version: 3 };
    }
    return fallback(path, init, options);
  });
  showContent(<CustomerLedgerDetail record={original} candidates={assignedCandidates} userId="user" permissions={permissions} onDenied={vi.fn()} onSaved={vi.fn()} refreshDetail={async () => latest} />);
  fireEvent.click(screen.getByLabelText('维护收件'));
  const dialog = screen.getByRole('dialog', { name: '维护收件' });
  fireEvent.change(within(dialog).getByLabelText('快递单号'), { target: { value: '本地单号' } });
  fireEvent.click(within(dialog).getByLabelText('保存台账动作'));
  const conflict = await within(dialog).findByRole('region', { name: '字段冲突核对' });
  expect(conflict).toHaveTextContent('原：原单号');
  expect(conflict).toHaveTextContent('服务器：服务器单号');
  expect(conflict).toHaveTextContent('本地：本地单号');
  expect(within(dialog).getByLabelText('保存台账动作')).toBeDisabled();
  fireEvent.click(within(conflict).getByLabelText('确认保留本地冲突值'));
  fireEvent.click(within(dialog).getByLabelText('保存台账动作'));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(JSON.parse(String(writes()[1]?.[1]?.body))).toEqual({ expectedVersion: 2, courierNumber: '本地单号' });
});

it('selects a real QE for an ADD row while leaving another ADD row to server mapping or unassigned semantics', async () => {
  show();
  fireEvent.click(await screen.findByLabelText('粘贴 / Excel 导入'));
  const dialog = screen.getByRole('dialog', { name: '粘贴 / Excel 导入' });
  fireEvent.change(within(dialog).getByLabelText('中文 TSV 粘贴'), { target: { value: '客户\t件数\n  人工行  \t2\n  待分配行  \t\n  映射行  \t' } });
  fireEvent.click(within(dialog).getByLabelText('预览'));
  const first = await within(dialog).findByLabelText('第 2 行实际跟进质量工程师');
  expect(within(first).getByRole('option', { name: /实际工程师/ })).toHaveValue('assignment');
  fireEvent.change(first, { target: { value: 'assignment' } });
  expect(within(dialog).getByLabelText('第 3 行实际跟进质量工程师')).toHaveValue('__AUTO__');
  fireEvent.change(within(dialog).getByLabelText('第 3 行实际跟进质量工程师'), { target: { value: '' } });
  expect(within(dialog).getByLabelText('第 4 行实际跟进质量工程师')).toHaveValue('__AUTO__');
  fireEvent.click(within(dialog).getByLabelText('继续，保留原文'));
  await waitFor(() => expect(writes()).toHaveLength(2));
  const rows = JSON.parse(String(writes()[1]?.[1]?.body)).rows;
  expect(rows).toEqual([
    { rowNumber: 2, action: 'ADD', fields: { customerName: '  人工行  ', quantity: '2' }, qualityEngineerAssignmentId: 'assignment' },
    { rowNumber: 3, action: 'ADD', fields: { customerName: '  待分配行  ', quantity: '' }, qualityEngineerAssignmentId: null },
    { rowNumber: 4, action: 'ADD', fields: { customerName: '  映射行  ', quantity: '' } },
  ]);
});

it('strips an ADD engineer selection when the row becomes SUPPLEMENT, in preview and commit', async () => {
  show();
  fireEvent.click(await screen.findByLabelText('粘贴 / Excel 导入'));
  const dialog = screen.getByRole('dialog', { name: '粘贴 / Excel 导入' });
  fireEvent.change(within(dialog).getByLabelText('中文 TSV 粘贴'), { target: { value: '客户\t件数\n  原文  \t2' } });
  fireEvent.click(within(dialog).getByLabelText('预览'));
  fireEvent.change(await within(dialog).findByLabelText('第 2 行实际跟进质量工程师'), { target: { value: 'assignment' } });
  fireEvent.change(within(dialog).getByLabelText('第 2 行操作'), { target: { value: 'SUPPLEMENT' } });
  expect(within(dialog).queryByLabelText('第 2 行实际跟进质量工程师')).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByLabelText('预览'));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(JSON.parse(String(writes()[1]?.[1]?.body)).rows[0]).not.toHaveProperty('qualityEngineerAssignmentId');
  fireEvent.change(await within(dialog).findByLabelText('第 2 行补充目标'), { target: { value: id } });
  fireEvent.click(within(dialog).getByLabelText('第 2 行确认补充变更'));
  fireEvent.click(within(dialog).getByLabelText('继续，保留原文'));
  await waitFor(() => expect(writes()).toHaveLength(3));
  const row = JSON.parse(String(writes()[2]?.[1]?.body)).rows[0];
  expect(row).toMatchObject({ action: 'SUPPLEMENT', targetId: id, expectedVersion: 1, fields: { customerName: '  原文  ', quantity: '2' } });
  expect(row).not.toHaveProperty('qualityEngineerAssignmentId');
  expect(row.fields).not.toHaveProperty('investigation');
});

it.each(['changed', 'unresolved', 'unchanged', 'empty'] as const)('F1QUALITY2P2 confirms only an effective %s customer association when ADD becomes SUPPLEMENT', async mode => {
  const customerA = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', organization_id: org, code: 'C-A', name: '原关联客户', active: true, version: 1 };
  const customerB = { ...customerA, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', code: 'C-B', name: '新关联客户' };
  const oldId = mode === 'unresolved' ? 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' : customerA.id;
  const target = { ...item, customerId: oldId };
  showContent(<CustomerLedgerImportPanel existing={[target]} customers={[customerA, customerB]} onDenied={vi.fn()} onClose={vi.fn()} onCommitted={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('中文 TSV 粘贴'), { target: { value: '客户\t件数\n来源原文\t2' } });
  fireEvent.click(screen.getByLabelText('预览'));
  const selected = mode === 'empty' ? '' : mode === 'unchanged' ? customerA.id : customerB.id;
  fireEvent.change(await screen.findByLabelText('第 2 行关联客户'), { target: { value: selected } });
  fireEvent.change(screen.getByLabelText('第 2 行操作'), { target: { value: 'SUPPLEMENT' } });
  fireEvent.change(screen.getByLabelText('第 2 行补充目标'), { target: { value: id } });
  const changes = screen.getByText(/核对具体变更/).closest('details')!;
  if (mode === 'changed' || mode === 'unresolved') {
    expect(changes).toHaveTextContent(`客户主数据关联原：${mode === 'unresolved' ? `${oldId}（名称未解析）` : 'C-A · 原关联客户'} → 补充：C-B · 新关联客户`);
  } else expect(within(changes).queryByText('客户主数据关联')).not.toBeInTheDocument();
  expect(screen.getByLabelText('继续，保留原文')).toBeDisabled();
  fireEvent.click(screen.getByLabelText('第 2 行确认补充变更'));
  fireEvent.change(screen.getByLabelText('第 2 行关联客户'), { target: { value: customerA.id } });
  expect(screen.getByLabelText('第 2 行确认补充变更')).not.toBeChecked();
  expect(screen.getByLabelText('继续，保留原文')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('第 2 行关联客户'), { target: { value: selected } });
  fireEvent.click(screen.getByLabelText('第 2 行确认补充变更'));
  fireEvent.click(screen.getByLabelText('继续，保留原文'));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(JSON.parse(String(writes()[1]?.[1]?.body)).rows[0]).toMatchObject({ action: 'SUPPLEMENT', targetId: id, customerId: selected || null, fields: { customerName: '来源原文', quantity: '2' } });
});

it.each(['candidates', 'customers'] as const)('F1QUALITY2P2 retries failed %s initialization and restores actual QE actions without replacing the detail draft', async resource => {
  let failed = false;
  const previous = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init, options) => {
    if (path.includes(`/${resource}`) && !failed) { failed = true; throw new ApiError({ code: 'SERVICE_UNAVAILABLE', message: '' }, 503); }
    if (path.includes('/customers')) return [{ id, organization_id: org, code: 'C-RETRY', name: '重试读取的客户', active: true, version: 1 }];
    return previous(path, init, options);
  });
  showContent(<CustomerQualityPage renderAnalysis={() => <input aria-label="解析保留草稿" defaultValue="" />} />);
  fireEvent.click(await screen.findByLabelText('CQ-N4-1'));
  const draft = await screen.findByLabelText('解析保留草稿');
  fireEvent.change(draft, { target: { value: '辅助读取重试不可丢失' } });
  expect(screen.queryByLabelText('编辑台账')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('关闭台账')).not.toBeInTheDocument();
  expect(within(screen.getByLabelText('筛选客户')).queryByRole('option', { name: '重试读取的客户' })).not.toBeInTheDocument();
  const detailReads = vi.mocked(apiRequest).mock.calls.filter(([path]) => path === `${base}/${id}`).length;
  fireEvent.click(screen.getByText('重试候选人员与客户', { selector: 'button span' }));
  expect(await screen.findByLabelText('编辑台账')).toBeVisible();
  expect(screen.getByLabelText('关闭台账')).toBeVisible();
  expect(within(screen.getByLabelText('筛选客户')).getByRole('option', { name: '重试读取的客户' })).toHaveValue(id);
  expect(screen.getByLabelText('解析保留草稿')).toBe(draft);
  expect(draft).toHaveValue('辅助读取重试不可丢失');
  expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path === `${base}/${id}`)).toHaveLength(detailReads);
  expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path.includes('/my-permissions'))).toHaveLength(2);
  expect(writes()).toHaveLength(0);
});

it.each([401, 403, 'read-only'] as const)('F1QUALITY2P2 respects current %s permissions when retrying auxiliary initialization', async access => {
  let permissionReads = 0; let candidateReads = 0;
  const previous = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init, options) => {
    if (path.includes('/my-permissions') && ++permissionReads === 2) {
      if (access !== 'read-only') throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, access);
      return { organizationId: org, permissions: ['customer-quality:complaints:read'] };
    }
    if (path.includes('/candidates') && ++candidateReads === 1) throw new Error('候选人员读取失败');
    return previous(path, init, options);
  });
  show();
  fireEvent.click(await screen.findByLabelText('CQ-N4-1'));
  await screen.findByText(`解析插槽 ${id}`);
  fireEvent.click(screen.getByText('重试候选人员与客户', { selector: 'button span' }));
  if (access === 'read-only') {
    await waitFor(() => expect(screen.queryByText('重试候选人员与客户', { selector: 'button span' })).not.toBeInTheDocument());
    expect(screen.getByLabelText('客诉详情', { selector: 'section' })).toBeVisible();
    expect(screen.queryByLabelText('人工登记客诉')).not.toBeInTheDocument();
  } else {
    expect(await screen.findByText(/访问已失效/)).toBeVisible();
    expect(screen.queryByLabelText('客诉详情', { selector: 'section' })).not.toBeInTheDocument();
    expect(candidateReads).toBe(1);
  }
  expect(permissionReads).toBe(2);
  expect(screen.queryByLabelText('编辑台账')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('关闭台账')).not.toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});

it('F1QUALITY2P2 aborts an auxiliary retry on scope change and ignores its late denial', async () => {
  let permissionReads = 0; let candidateReads = 0;
  let reject!: (cause: unknown) => void; let signal: AbortSignal | undefined;
  const previous = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init, options) => {
    if (path.includes('/my-permissions') && ++permissionReads === 2) { signal = init?.signal ?? undefined; return new Promise((_resolve, fail) => { reject = fail; }); }
    if (path.includes('/candidates') && ++candidateReads === 1) throw new Error('候选人员读取失败');
    return previous(path, init, options);
  });
  show();
  await screen.findByLabelText('CQ-N4-1');
  fireEvent.click(screen.getByText('重试候选人员与客户', { selector: 'button span' }));
  await waitFor(() => expect(reject).toBeDefined());
  vi.mocked(getSession).mockResolvedValue({ userId: 'other', organizationId: org, accountType: 'INTERNAL', landingPath: '/app/workbench' });
  act(() => useWorkTabsStore.getState().bindSession(`INTERNAL:${org}:other`));
  expect(await screen.findByLabelText('CQ-N4-1')).toBeVisible();
  expect(signal?.aborted).toBe(true);
  await act(async () => { reject(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, 403)); });
  expect(screen.queryByText(/访问已失效/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('CQ-N4-1')).toBeVisible();
});

it('lets the corresponding QE edit investigation while FOLLOWING without requiring or forcing closure', async () => {
  showContent(detailContent());
  fireEvent.click(screen.getByLabelText('编辑台账'));
  const dialog = screen.getByRole('dialog', { name: '编辑台账' });
  const investigation = within(dialog).getByLabelText('调查情况');
  expect(investigation).not.toBeRequired();
  fireEvent.change(investigation, { target: { value: '  跟进中的实际调查  ' } });
  fireEvent.click(within(dialog).getByLabelText('保存台账'));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0]?.[0]).toBe(`${base}/${id}`);
  expect(JSON.parse(String(writes()[0]?.[1]?.body))).toEqual({ expectedVersion: 1, fields: { investigation: '  跟进中的实际调查  ' } });
});

it('does not expose investigation at registration or replay a protected original field from registrar fact edits', async () => {
  const view = showContent(<CustomerLedgerEditor candidates={[]} onDenied={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} refreshDetail={async () => undefined} />);
  const create = screen.getByRole('dialog', { name: '人工登记客诉' });
  expect(within(create).queryByLabelText('调查情况')).not.toBeInTheDocument();
  view.unmount();
  showContent(detailContent({ ...item, qualityEngineerId: null, qualityEngineerAssignmentId: null, qualityEngineerSource: null, raw: { ...item.raw, investigation: '保留的历史调查' } }));
  fireEvent.click(screen.getByLabelText('编辑台账'));
  const edit = screen.getByRole('dialog', { name: '编辑台账' });
  expect(within(edit).queryByLabelText('调查情况')).not.toBeInTheDocument();
  fireEvent.change(within(edit).getByLabelText('件数'), { target: { value: '4' } });
  fireEvent.click(within(edit).getByLabelText('保存台账'));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(JSON.parse(String(writes()[0]?.[1]?.body)).fields).toEqual({ quantity: '4' });
});

it('passes current source status, version and actual engineer to the analysis slot without remounting its draft', () => {
  const content = (record: typeof item) => <CustomerLedgerDetail record={record} candidates={assignedCandidates} userId="user" permissions={permissions} onDenied={vi.fn()} onSaved={vi.fn()} refreshDetail={async () => record}
    renderAnalysis={(_id, _onDenied, source) => <input aria-label="解析未保存草稿" defaultValue="原草稿" data-source-version={source?.version} data-source-status={source?.status} data-source-engineer={source?.qualityEngineerId} />} />;
  const view = showContent(content(item));
  const draft = screen.getByLabelText('解析未保存草稿');
  expect(draft).toHaveAttribute('data-source-version', '1');
  fireEvent.change(draft, { target: { value: '不能丢失的解析草稿' } });
  for (const record of [{ ...item, status: 'CLOSED' as const, version: 2 }, { ...item, version: 3 }, { ...item, version: 4, qualityEngineerId: 'other', qualityEngineerAssignmentId: 'other-assignment' }]) {
    view.rerender(testContent(content(record)));
    expect(screen.getByLabelText('解析未保存草稿')).toBe(draft);
    expect(draft).toHaveValue('不能丢失的解析草稿');
    expect(draft).toHaveAttribute('data-source-version', String(record.version));
    expect(draft).toHaveAttribute('data-source-status', record.status);
    expect(draft).toHaveAttribute('data-source-engineer', record.qualityEngineerId);
  }
});
