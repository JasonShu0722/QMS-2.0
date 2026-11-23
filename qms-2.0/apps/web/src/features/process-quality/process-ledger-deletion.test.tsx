import type { components } from '@qms/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { preferenceKey } from '../../ui/ledger/model';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ProcessDefectLedgerPage } from './ProcessDefectLedgerPage';
import type { ReactNode } from 'react';

const compact = vi.hoisted(() => ({ enabled: false }));
vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  return { ...actual, Checkbox: (props: { checked?: boolean; disabled?: boolean; 'aria-label'?: string; onChange?: (event: { target: { checked: boolean } }) => void }) => compact.enabled ? <button role="checkbox" aria-label={props['aria-label']} aria-checked={props.checked} disabled={props.disabled} onClick={() => props.onChange?.({ target: { checked: !props.checked } })} /> : <actual.Checkbox {...props} />, Table: (props: import('antd').TableProps<components['schemas']['ProcessDefectDto']>) => {
    if (!compact.enabled) return <actual.Table {...props} />;
    const selection = props.columns?.find(column => column.key === 'select');
    const pagination = props.pagination;
    const pageSize = pagination ? pagination.pageSize ?? 20 : 20;
    return <div>{selection && (typeof selection.title === 'function' ? selection.title({}) : selection.title)}{props.dataSource?.map((row, index) => <div key={row.id}>{selection?.render?.('', row, index) as ReactNode}</div>)}{pagination && <>
      <select aria-label="每页条数" value={pageSize} onChange={event => pagination.onChange?.(pagination.current ?? 1, Number(event.target.value))}>{pagination.pageSizeOptions?.map(size => <option key={size} value={size}>{size}</option>)}</select>
      {Array.from({ length: Math.ceil((pagination.total ?? 0) / pageSize) }, (_, index) => <button key={index} title={String(index + 1)} onClick={() => pagination.onChange?.(index + 1, pageSize)}>{index + 1}</button>)}
    </>}</div>;
  } };
});
vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
vi.mock('../attachments/AttachmentPanel', () => ({ AttachmentPanel: () => null }));
const organizationId = '22222222-2222-4222-8222-222222222222';
const record: components['schemas']['ProcessDefectDto'] = { id: '11111111-1111-4111-8111-111111111111', organizationId, description: '删除测试来源', defectTypeCode: null, defectQuantity: 1, occurredAt: null, factoryCode: null, responsibilityCategory: null, traceCode: 'TRACE-DELETE', ledgerStatus: 'FOLLOWING', version: 2, materials: [], issues: [], duplicateCount: 0, componentProject: null, evidence: [], analysisProgress: null, closedAt: null, closedById: null, sourceKind: 'MANUAL', materialVerificationHistory: [], ledgerHistory: [], classificationHistory: [], lineName: null, operationName: null, shift: null, operationSector: null, productCategory: null, productSubcategory: null, projectStage: null, projectName: null, pendingCompletion: true, pendingConfiguration: true, registrationIssues: ['OCCURRED_AT_REQUIRED', 'PROJECT_MAPPING_PENDING'], registeredByName: '登记人' };
const other = { ...record, id: '33333333-3333-4333-8333-333333333333', description: '第二页来源', version: 7 };
const permissions = ['process-quality:defects:read', 'process-quality:defects:write', 'process-quality:defects:delete'];
const preview = { count: 1, canDelete: true, items: [{ defectId: record.id, expectedVersion: record.version, description: record.description, blocked: false, blockers: [] }] };
function response(path: string) {
  if (path.includes('/my-permissions')) return { permissions };
  if (path.includes('/defects?')) return { items: [record], total: 1, page: 1, pageSize: 20 };
  if (path.endsWith('/deletion-preview')) return preview;
  if (path.endsWith('/deletion')) return { deletedIds: [record.id], count: 1 };
  if (path.endsWith(`/defects/${record.id}`)) return record;
  return [];
}
beforeEach(() => {
  compact.enabled = false;
  localStorage.clear();
  useWorkTabsStore.getState().reset();
  useWorkTabsStore.getState().bindSession(`INTERNAL:${organizationId}:user`);
  vi.mocked(getSession).mockReset().mockResolvedValue({ userId: 'user', organizationId, accountType: 'INTERNAL', landingPath: '/app/workbench' });
  vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockReset().mockImplementation(async path => response(path));
});
function mount() { return render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><ProcessDefectLedgerPage /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>); }
async function openDelete() {
  fireEvent.click(await screen.findByLabelText(`选择制程不良 ${record.description}`));
  fireEvent.click(within(screen.getByLabelText('台账批量操作')).getByText('删除所选'));
  return deletionDialog();
}
async function deletionDialog() {
  const title = await screen.findByText('删除制程不良台账', { selector: '.ant-modal-title' });
  await waitFor(() => expect(title).toBeVisible());
  return title.closest<HTMLElement>('[role="dialog"]')!;
}
const pageSelection = () => within(document.querySelector<HTMLElement>('.qms-ledger thead')!).getByLabelText('选择当前页制程不良');

it('orders the default recording columns and keeps optional facts recoverable without unlocking selection', async () => {
  const { container } = mount();
  await screen.findByLabelText(`选择制程不良 ${record.description}`);
  const headers = within(container.querySelector<HTMLElement>('.qms-ledger thead')!);
  const titles = ['选择', '发生时间', '工厂', '班次', '项目号', '产品类型', '细分类型', '项目状态', '不良描述', '追溯码', '生产线名称', '工序名称', '板块', '不良数量', '操作'];
  const defaultTitles = headers.getAllByRole('columnheader').map(header => header.getAttribute('aria-label'));
  expect(defaultTitles).toEqual(titles);
  fireEvent.click(within(container.querySelector<HTMLElement>('.qms-ledger__tools')!).getByRole('button', { name: '列设置' }));
  expect(await screen.findByLabelText('显示 选择')).toBeDisabled();
  expect(screen.getByLabelText('固定 选择')).toBeDisabled();
  expect(screen.getByLabelText('下移 选择', { selector: 'button' })).toBeDisabled();
  for (const title of ['类型', '成品编码', '工单号', '生产线编码', '工序编码', '登记人', '完善情况', '责任类别', '状态', '首条物料 / 供应商', '人工项目 / 映射', '批次 / 工单']) {
    expect(defaultTitles).not.toContain(title);
    expect(screen.getByLabelText(`显示 ${title}`)).not.toBeChecked();
  }
  fireEvent.click(screen.getByLabelText('显示 成品编码'));
  expect(headers.getByRole('columnheader', { name: '成品编码' })).toBeVisible();
  fireEvent.click(screen.getByText('恢复录单默认列', { selector: 'button span' }));
  expect(headers.getAllByRole('columnheader').map(header => header.getAttribute('aria-label'))).toEqual(titles);
});

it('keeps row actions as accessible icons and previews the same source before deletion', async () => {
  mount();
  const selection = await screen.findByLabelText(`选择制程不良 ${record.description}`);
  const row = within(selection.closest('tr')!);
  const view = row.getByRole('button', { name: '查看详情' });
  const remove = row.getByRole('button', { name: '删除台账' });
  expect(view.textContent).toBe('');
  expect(remove.textContent).toBe('');
  expect(view.querySelector('svg.lucide-eye')).not.toBeNull();
  expect(remove.querySelector('svg.lucide-trash2')).not.toBeNull();
  fireEvent.click(view);
  const detail = await screen.findByRole('dialog', { name: '不良品详情' });
  await waitFor(() => expect(within(detail).getByText(record.traceCode!)).toBeVisible());
  fireEvent.click(within(detail).getByLabelText('关闭', { selector: 'button' }));
  fireEvent.click(remove);
  const dialog = await deletionDialog();
  await waitFor(() => expect(within(dialog).getByRole('button', { name: '确认删除' })).toBeEnabled());
  expect(within(dialog).getByText(/删除 1 条制程不良台账/)).toBeVisible();
  expect(within(dialog).queryByText(record.description)).not.toBeInTheDocument();
  const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path.endsWith('/deletion-preview'));
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ sources: [{ defectId: record.id, expectedVersion: record.version }] });
});

it('caps cross-page selection at 1000 and allows a partially selected capped page to cancel', async () => {
  compact.enabled = true;
  const pageSizeKey = preferenceKey({ sessionScope: `INTERNAL:${organizationId}:user`, organizationId, portal: 'business' }, 'process-defects', 'pageSize')!;
  localStorage.setItem(pageSizeKey, JSON.stringify({ schema: 1, value: 500 }));
  const sources = Array.from({ length: 1001 }, (_, index) => ({ ...record, id: `source-${index}`, description: `来源 ${index}` }));
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (!path.includes('/defects?')) return response(path);
    const query = new URL(path, 'http://localhost').searchParams;
    const page = Number(query.get('page'));
    const pageSize = Number(query.get('pageSize'));
    return { items: sources.slice((page - 1) * pageSize, page * pageSize), total: sources.length, page, pageSize };
  });
  mount();
  await screen.findByLabelText('选择制程不良 来源 499');
  expect(screen.getByLabelText('每页条数')).toHaveValue('500');
  fireEvent.click(screen.getByLabelText('选择当前页制程不良'));
  expect(screen.getByText('已选择 500 条来源')).toBeVisible();
  fireEvent.click(screen.getByTitle('3'));
  fireEvent.click(await screen.findByLabelText('选择制程不良 来源 1000'));
  fireEvent.click(screen.getByTitle('2'));
  await screen.findByLabelText('选择制程不良 来源 999');
  fireEvent.click(screen.getByLabelText('选择当前页制程不良'));
  expect(screen.getByText('已选择 1000 条来源')).toBeVisible();
  expect(screen.getByLabelText('选择制程不良 来源 999')).not.toBeChecked();
  fireEvent.click(screen.getByLabelText('选择当前页制程不良'));
  expect(screen.getByText('已选择 501 条来源')).toBeVisible();
});

it('selects and deletes one 1000-row page in one request, then moves back from the empty last page', async () => {
  compact.enabled = true;
  const sources = Array.from({ length: 2000 }, (_, index) => ({ ...record, id: `source-${index}`, description: `来源 ${index}` }));
  const expected = sources.slice(1000).map(source => ({ defectId: source.id, expectedVersion: source.version }));
  let total = sources.length;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.includes('/my-permissions')) return { permissions: [...permissions, 'process-quality:issues:issue'] };
    if (path.includes('/defects?')) {
      const query = new URL(path, 'http://localhost').searchParams;
      const page = Number(query.get('page'));
      const pageSize = Number(query.get('pageSize'));
      return { items: sources.slice(0, total).slice((page - 1) * pageSize, page * pageSize), total, page, pageSize };
    }
    if (path.endsWith('/deletion-preview')) return { count: expected.length, canDelete: true, items: [...expected].reverse().map(source => ({ ...source, description: '行级预览', blocked: false, blockers: [] })) };
    if (path.endsWith('/deletion')) {
      expect(JSON.parse(String(init?.body))).toEqual({ sources: expected });
      total = 1000;
      return { count: expected.length, deletedIds: expected.map(source => source.defectId) };
    }
    return response(path);
  });
  mount();
  await screen.findByLabelText('选择制程不良 来源 19');
  fireEvent.change(screen.getByLabelText('每页条数'), { target: { value: '1000' } });
  await screen.findByLabelText('选择制程不良 来源 999');
  fireEvent.click(screen.getByTitle('2'));
  await screen.findByLabelText('选择制程不良 来源 1999');
  fireEvent.click(screen.getByLabelText('选择当前页制程不良'));
  expect(screen.getByText('已选择 1000 条来源')).toBeVisible();
  expect(screen.getByLabelText('发起 8D')).toBeDisabled();
  fireEvent.click(within(screen.getByLabelText('台账批量操作')).getByText('删除所选'));
  const dialog = await deletionDialog();
  const confirm = within(dialog).getByRole('button', { name: '确认删除' });
  await waitFor(() => expect(confirm).toBeEnabled());
  expect(within(dialog).queryByText('行级预览')).not.toBeInTheDocument();
  expect(within(dialog).getByText(/删除 1000 条制程不良台账/)).toBeVisible();
  await act(async () => { fireEvent.click(confirm); });
  const reads = vi.mocked(apiRequest).mock.calls.filter(([path]) => path.includes('/defects?'));
  expect(reads.slice(-2).map(([path]) => new URL(path, 'http://localhost').searchParams.get('page'))).toEqual(['2', '1']);
  expect(screen.getByLabelText('选择制程不良 来源 999')).toBeEnabled();
  expect(screen.getByText('已选择 0 条来源')).toBeVisible();
  expect(screen.queryByTitle('2')).not.toBeInTheDocument();
  for (const route of ['/deletion-preview', '/deletion']) {
    const calls = vi.mocked(apiRequest).mock.calls.filter(([path]) => path.endsWith(route));
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ sources: expected });
  }
}, 30000);

it('keeps current-page selection separate from preserved pages and previews the exact recorded versions', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => path.includes('/defects?') ? { items: path.includes('page=2&') ? [other] : [record], total: 21, page: 1, pageSize: 20 } : response(path));
  mount();
  await screen.findByLabelText(`选择制程不良 ${record.description}`);
  fireEvent.click(pageSelection());
  expect(screen.getByText('已选择 1 条来源')).toBeVisible();
  fireEvent.click(screen.getByTitle('2'));
  await screen.findByLabelText(`选择制程不良 ${other.description}`);
  fireEvent.click(pageSelection());
  expect(screen.getByText('已选择 2 条来源')).toBeVisible();
  fireEvent.click(pageSelection());
  expect(screen.getByText('已选择 1 条来源')).toBeVisible();
  fireEvent.click(within(screen.getByLabelText('台账批量操作')).getByText('删除所选'));
  await deletionDialog();
  const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path.endsWith('/deletion-preview'));
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ sources: [{ defectId: record.id, expectedVersion: 2 }] });
});

it.each(['delete', 'read'])('requires %s permission without granting deletion through ordinary write', async missing => {
  vi.mocked(apiRequest).mockImplementation(async path => path.includes('/my-permissions') ? { permissions: permissions.filter(permission => !permission.endsWith(`:${missing}`)) } : response(path));
  mount(); const selection = await screen.findByLabelText(`选择制程不良 ${record.description}`);
  fireEvent.click(selection);
  expect(within(screen.getByLabelText('台账批量操作')).queryByRole('button', { name: '删除所选' })).not.toBeInTheDocument();
  expect(within(selection.closest('tr')!).queryByRole('button', { name: '删除台账' })).not.toBeInTheDocument();
});

it('displays formal reference blockers and never confirms a partly blocked batch', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path.includes('/defects?')) return { items: [record, other], total: 2, page: 1, pageSize: 20 };
    if (path.endsWith('/deletion-preview')) return {
      count: 2, canDelete: false, items: [
        { ...preview.items[0], blocked: true, blockers: [{ code: 'FORMAL_PROBLEM', reportNumber: 'PQ-2026-123' }, { code: 'FORMAL_PROBLEM', reportNumber: 'PQ-2026-124' }] },
        { ...preview.items[0], defectId: other.id, expectedVersion: other.version, description: other.description },
      ],
    };
    return response(path);
  });
  mount();
  await screen.findByLabelText(`选择制程不良 ${record.description}`);
  fireEvent.click(pageSelection());
  fireEvent.click(within(screen.getByLabelText('台账批量操作')).getByText('删除所选'));
  const dialog = await deletionDialog();
  expect(await within(dialog).findByText('1 条记录无法删除')).toBeVisible();
  expect(within(dialog).getByText('1 条已关联正式问题')).toBeVisible();
  expect(within(dialog).queryByText(/PQ-2026-12[34]|删除测试来源|第二页来源/)).not.toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: '确认删除' })).toBeDisabled();
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.endsWith('/deletion'))).toBe(false);
});

it('only offers cancel and confirm after a clean deletion preview', async () => {
  mount(); const dialog = await openDelete();
  const confirm = within(dialog).getByRole('button', { name: '确认删除' });
  await waitFor(() => expect(confirm).toBeEnabled());
  expect(within(dialog).getByRole('button', { name: /^取\s?消$/ })).toBeEnabled();
  expect(within(dialog).queryByLabelText('删除原因')).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: '重新预览' })).not.toBeInTheDocument();
});

it('allows an unfinished preview to close without retaining a write-unknown state', async () => {
  let complete!: (value: typeof preview) => void;
  vi.mocked(apiRequest).mockImplementation(async path => path.endsWith('/deletion-preview') ? new Promise(done => { complete = done; }) : response(path));
  mount(); const dialog = await openDelete();
  fireEvent.click(within(dialog).getByRole('button', { name: /^取\s?消$/ }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '删除制程不良台账' })).not.toBeInTheDocument());
  await act(async () => complete(preview));
  expect(screen.queryByText('恢复删除操作')).not.toBeInTheDocument();
  expect(screen.getByLabelText(`选择制程不良 ${record.description}`)).not.toBeDisabled();
});

it('submits the recorded version without a reason and closes the deleted detail', async () => {
  let deleted = false;
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path.endsWith('/deletion')) { deleted = true; return { deletedIds: [record.id], count: 1 }; }
    if (deleted && path.includes('/defects?')) return { items: [], total: 0, page: 1, pageSize: 20 };
    return response(path);
  });
  mount(); fireEvent.click(await screen.findByLabelText('查看详情', { selector: 'button' }));
  await screen.findByText('维护台账');
  const detail = screen.getByRole('dialog', { name: '不良品详情' });
  fireEvent.click(within(detail).getByRole('button', { name: '删除台账' }));
  const dialog = await deletionDialog();
  const confirm = within(dialog).getByRole('button', { name: '确认删除' });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await screen.findByText('没有匹配的不良记录');
  expect(screen.queryByRole('dialog', { name: '不良品详情' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('台账批量操作')).not.toBeInTheDocument();
  const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path.endsWith('/deletion'));
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ sources: [{ defectId: record.id, expectedVersion: 2 }] });
});

it('retains an unknown deletion while returning to the table then retries the original request and key', async () => {
  let attempts = 0;
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path.endsWith('/deletion') && ++attempts === 1) throw new TypeError('connection lost');
    return response(path);
  });
  mount(); const dialog = await openDelete();
  const confirm = within(dialog).getByRole('button', { name: '确认删除' });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await within(dialog).findByText('删除结果未知，请使用原请求重试。');
  fireEvent.click(within(dialog).getByRole('button', { name: '返回台账' }));
  fireEvent.click(await screen.findByText('恢复删除操作'));
  const restored = await deletionDialog();
  expect(within(restored).queryByRole('button', { name: '确认删除' })).not.toBeInTheDocument();
  fireEvent.click(within(restored).getByRole('button', { name: '同请求重试删除' }));
  await waitFor(() => expect(attempts).toBe(2));
  const calls = vi.mocked(apiRequest).mock.calls.filter(([path]) => path.endsWith('/deletion'));
  expect(calls[0][1]?.body).toBe(calls[1][1]?.body);
  expect(new Headers(calls[0][1]?.headers).get('Idempotency-Key')).toBe(new Headers(calls[1][1]?.headers).get('Idempotency-Key'));
  expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path.endsWith('/deletion-preview'))).toHaveLength(1);
});

it('reports a known submit conflict without deleting or keeping an unknown lock', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => { if (path.endsWith('/deletion')) throw new ApiError({ code: 'PROCESS_DEFECT_DELETE_BLOCKED', message: '' }, 409); return response(path); });
  mount(); const dialog = await openDelete();
  const confirm = within(dialog).getByRole('button', { name: '确认删除' });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await waitFor(() => expect(within(dialog).getByRole('button', { name: '重新预览' })).toBeEnabled());
  expect(within(dialog).queryByText('同请求重试删除')).not.toBeInTheDocument();
  expect(screen.getByText('已选择 1 条来源')).toBeInTheDocument();
});

it('refreshes and drops stale deletion targets before selecting their updated versions', async () => {
  const updated = { ...record, version: 3 };
  let refreshed = false;
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path.endsWith('/deletion-preview')) {
      if (!refreshed) throw new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409);
      return { ...preview, items: [{ ...preview.items[0], expectedVersion: updated.version }] };
    }
    if (refreshed && path.includes('/defects?')) return { items: [updated], total: 1, page: 1, pageSize: 20 };
    return response(path);
  });
  mount(); const dialog = await openDelete();
  const refresh = await within(dialog).findByRole('button', { name: '刷新台账' });
  refreshed = true;
  fireEvent.click(refresh);
  await waitFor(() => expect(screen.getByLabelText(`选择制程不良 ${record.description}`)).toBeEnabled());
  expect(screen.getByText('已选择 0 条来源')).toBeVisible();
  const updatedDialog = await openDelete();
  await waitFor(() => expect(within(updatedDialog).getByRole('button', { name: '确认删除' })).toBeEnabled());
  const calls = vi.mocked(apiRequest).mock.calls.filter(([path]) => path.endsWith('/deletion-preview'));
  expect(JSON.parse(String(calls.at(-1)?.[1]?.body))).toEqual({ sources: [{ defectId: updated.id, expectedVersion: 3 }] });
});
