import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { apiRequest, csrfToken, getSession } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { preferenceKey } from '../../ui/ledger/model';
import { ProcessDefectLedgerPage } from './ProcessDefectLedgerPage';

vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
vi.mock('../attachments/AttachmentPanel', () => ({ AttachmentPanel: () => null }));

const organizationId = '22222222-2222-4222-8222-222222222222';
const defect: components['schemas']['ProcessDefectDto'] = {
  id: '11111111-1111-4111-8111-111111111111', organizationId, description: '表面划伤', defectTypeCode: null,
  defectQuantity: 2, occurredAt: '2026-11-10T02:00:00.000Z', responsibilityCategory: null, traceCode: 'TRACE-1',
  ledgerStatus: 'FOLLOWING', version: 2, materials: [], issues: [], duplicateCount: 0, componentProject: null,
  evidence: [], analysisProgress: null, closedAt: null, closedById: null, sourceKind: 'MANUAL',
  materialVerificationHistory: [], ledgerHistory: [], classificationHistory: [], lineName: '一线', operationName: '贴片',
  shift: 'DAY', operationSector: 'SMT', productCategory: 'PCBA', productSubcategory: '主板', projectStage: 'MASS_PRODUCTION', projectName: null,
  pendingCompletion: false, pendingConfiguration: false, registrationIssues: [], registeredByName: '登记人',
};
const permissions = ['process-quality:defects:read', 'process-quality:defects:write', 'process-quality:issues:issue'];
const nowInBeijing = new Date(Date.now() + 8 * 3600000);
const monthFrom = new Date(Date.UTC(nowInBeijing.getUTCFullYear(), nowInBeijing.getUTCMonth(), 1, -8)).toISOString();
const monthTo = new Date(Date.UTC(nowInBeijing.getUTCFullYear(), nowInBeijing.getUTCMonth() + 1, 1, -8)).toISOString();
const scope = { sessionScope: `INTERNAL:${organizationId}:user`, organizationId, portal: 'business' as const };
const filtersKey = preferenceKey(scope, 'process-defects', 'filters', 'ALL')!;
const columnsKey = preferenceKey(scope, 'process-defects', 'columns', 'ALL')!;
let items: typeof defect[];

beforeEach(() => {
  items = [];
  localStorage.clear();
  useWorkTabsStore.getState().reset();
  useWorkTabsStore.getState().bindSession(`INTERNAL:${organizationId}:user`);
  vi.mocked(getSession).mockReset().mockResolvedValue({ userId: 'user', organizationId, accountType: 'INTERNAL', landingPath: '/app/workbench' });
  vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockReset().mockImplementation(async path => {
    if (path.includes('/my-permissions')) return { permissions };
    if (path.includes('/defects?')) return { items, total: items.length, page: 1, pageSize: 20 };
    return [];
  });
});

function mount() {
  return render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><ProcessDefectLedgerPage /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
}

function listCalls() {
  return vi.mocked(apiRequest).mock.calls.filter(([path]) => path.includes('/api/v1/process-quality/defects?'));
}
function latestQuery() { return new URL(listCalls().at(-1)?.[0] ?? '/', 'http://localhost').searchParams; }
async function openPanel(label = '筛选条件') {
  const trigger = screen.getAllByLabelText(label, { selector: 'button[aria-haspopup="dialog"]' })[0];
  fireEvent.click(trigger);
  const panel = await screen.findByLabelText('筛选面板');
  return { trigger, panel, queries: within(panel) };
}

it('displays the mapped product category even without a linked project and shows missing categories as unconfirmed', async () => {
  const unmapped = { ...defect, id: '33333333-3333-4333-8333-333333333333', description: '历史记录', productCategory: null };
  items = [defect, unmapped];
  const { container } = mount();
  const headers = within(container.querySelector('thead')!);
  const category = headers.getByLabelText('产品类型', { selector: 'th' });
  expect(category.nextElementSibling).toBe(headers.getByLabelText('细分类型', { selector: 'th' }));
  const categoryIndex = (category as HTMLTableCellElement).cellIndex;
  for (const [record, label] of [[defect, 'PCBA'], [unmapped, '未确认']] as const) {
    const selection = await screen.findByLabelText(`选择制程不良 ${record.description}`);
    expect(selection.closest('tr')?.cells[categoryIndex]).toHaveTextContent(label);
  }
});

it.each([true, false])('inserts the category before the saved subcategory and follows its visibility (%s)', (showSubcategory) => {
  const order = ['select', 'project', 'occurredAt', 'shift', 'productSubcategory', 'description', 'actions'];
  const visible = order.filter(key => key !== 'shift' && (showSubcategory || key !== 'productSubcategory'));
  const saved = JSON.stringify({ schema: 1, value: { order, visible, widths: { description: 390 } } });
  localStorage.setItem(columnsKey, saved);
  const { container } = mount();
  const headers = within(container.querySelector('thead')!);
  const expected = visible.flatMap(key => key === 'productSubcategory' ? ['productCategory', key] : [key]);
  expect(headers.getAllByRole('columnheader').map(header => header.dataset.compactLedgerColumn).slice(0, expected.length)).toEqual(expected);
  expect(Boolean(headers.queryByLabelText('产品类型', { selector: 'th' }))).toBe(showSubcategory);
  expect(headers.queryByRole('columnheader', { name: '班次' })).not.toBeInTheDocument();
  expect(within(headers.getByRole('columnheader', { name: '不良描述' })).getByRole('separator')).toHaveAttribute('aria-valuenow', '390');
  expect(localStorage.getItem(columnsKey)).toBe(saved);
});

it('honors a previously configured category position and visibility', () => {
  const order = ['select', 'productSubcategory', 'description', 'productCategory', 'actions'];
  localStorage.setItem(columnsKey, JSON.stringify({ schema: 1, value: { order, visible: order.filter(key => key !== 'productSubcategory') } }));
  const { container } = mount();
  const headers = within(container.querySelector('thead')!);
  expect(headers.getAllByRole('columnheader').map(header => header.dataset.compactLedgerColumn).slice(0, 4)).toEqual(['select', 'description', 'productCategory', 'actions']);
});

it('activates the description filter with the keyboard and returns focus after Escape', async () => {
  const user = userEvent.setup();
  const { container } = mount();
  const header = within(container.querySelector('thead')!).getByRole('columnheader', { name: '不良描述' });
  const trigger = within(header).getByLabelText('按不良描述筛选', { selector: 'button' });
  trigger.focus();
  await user.keyboard('{Enter}');
  const panel = await screen.findByLabelText('筛选面板', { selector: '[role="dialog"]' });
  const field = within(panel).getByLabelText('筛选字段 1');
  expect(field).toHaveValue('description');
  expect(field).toHaveFocus();
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await user.keyboard('{Escape}');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(trigger).toHaveFocus();
});

it('keeps one 8D action and moves filters into the compact toolbar', async () => {
  items = [defect];
  mount();
  await screen.findByLabelText(`选择制程不良 ${defect.description}`);
  const toolbar = screen.getByLabelText('台账工具栏');
  expect(within(toolbar).getByRole('button', { name: '发起 8D' })).toBeInTheDocument();
  expect(within(toolbar).queryByRole('button', { name: '发起问题' })).not.toBeInTheDocument();
  expect(within(toolbar).queryByRole('button', { name: '复制为供应商草稿' })).not.toBeInTheDocument();
  expect(within(toolbar).getByRole('button', { name: '筛选条件' })).toBeInTheDocument();
  expect(within(toolbar).getByRole('button', { name: '登记不良' })).toBeInTheDocument();
  expect(within(toolbar.parentElement!).getByRole('button', { name: '列设置' })).toBeInTheDocument();
  expect(screen.queryByLabelText('台账批量操作')).not.toBeInTheDocument();
  expect(latestQuery().get('occurredFrom')).toBe(monthFrom);
  expect(latestQuery().get('occurredTo')).toBe(monthTo);
});

it('keeps the default month independent of an ANY condition', async () => {
  mount();
  await screen.findByLabelText('搜索制程不良');
  const { queries } = await openPanel();
  fireEvent.click(queries.getByText('添加筛选条件'));
  fireEvent.change(queries.getByLabelText('筛选字段 1'), { target: { value: 'description' } });
  fireEvent.change(queries.getByLabelText('筛选值 1'), { target: { value: '划伤' } });
  fireEvent.change(queries.getByLabelText('筛选逻辑'), { target: { value: 'ANY' } });
  fireEvent.click(queries.getByText('应用筛选'));
  expect(JSON.parse(latestQuery().get('filters')!)).toEqual({ logic: 'ANY', items: [{ field: 'description', operator: 'CONTAINS', value: '划伤' }] });
  expect(latestQuery().get('occurredFrom')).toBe(monthFrom);
  expect(latestQuery().get('occurredTo')).toBe(monthTo);
});

it('closes an untouched header filter without submitting or clearing the selected row', async () => {
  items = [defect];
  mount();
  const checkbox = await screen.findByLabelText(`选择制程不良 ${defect.description}`);
  fireEvent.click(checkbox);
  const readCount = listCalls().length;
  const search = screen.getByLabelText('搜索制程不良');
  fireEvent.change(search, { target: { value: '尚未提交的关键词' } });
  const { panel, queries } = await openPanel('按班次筛选');
  expect(queries.getByLabelText('筛选字段 1')).toHaveValue('shift');
  fireEvent.keyDown(panel, { key: 'Escape' });
  expect(screen.queryByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeInTheDocument();
  expect(screen.getByLabelText('筛选条件', { selector: 'button' })).toHaveAttribute('aria-expanded', 'false');
  expect(checkbox).toBeChecked();
  expect(search).toHaveValue('尚未提交的关键词');
  expect(listCalls()).toHaveLength(readCount);
  expect(localStorage.getItem(filtersKey)).toBeNull();
});

it('applies complete and valueless empty operators when closing, ignoring an unfinished row', async () => {
  const items = [{ field: 'traceCode', operator: 'EQ', value: 'TRACE-SAVED' }, { field: 'lineName', operator: 'EMPTY' }];
  localStorage.setItem(filtersKey, JSON.stringify({ schema: 1, value: { search: '', filters: { currentMonth: false, logic: 'ALL', items } } }));
  mount();
  const { queries } = await openPanel('按班次筛选');
  expect(queries.getByLabelText('筛选逻辑').closest('label')).toBeNull();
  fireEvent.change(queries.getByLabelText('筛选逻辑'), { target: { value: 'ANY' } });
  fireEvent.click(queries.getByLabelText('关闭筛选'));
  expect(JSON.parse(latestQuery().get('filters')!)).toEqual({ logic: 'ANY', items });
  expect(JSON.parse(localStorage.getItem(filtersKey)!).value.filters.items).toEqual(items);
});

it('keeps an oversized set of text conditions editable without sending or saving it', async () => {
  const condition = { field: 'description', operator: 'CONTAINS', value: '划'.repeat(200) };
  const saved = JSON.stringify({ schema: 1, value: { search: '', filters: { currentMonth: true, logic: 'ALL', items: [condition, condition] } } });
  localStorage.setItem(filtersKey, saved);
  mount();
  fireEvent.click(screen.getByLabelText('筛选条件', { selector: 'button' }));
  const panel = within(await screen.findByLabelText('筛选面板'));
  fireEvent.click(panel.getByText('添加筛选条件'));
  fireEvent.change(panel.getByLabelText('筛选值 3'), { target: { value: condition.value } });
  expect(panel.getByText('筛选内容过长，请缩短文字或减少条件。')).toBeInTheDocument();
  const apply = panel.getByText('应用筛选').closest('button');
  expect(apply).toBeDisabled();
  expect(JSON.parse(latestQuery().get('filters')!).items).toEqual([condition, condition]);
  expect(localStorage.getItem(filtersKey)).toBe(saved);
  fireEvent.click(panel.getByLabelText('删除筛选条件 3'));
  expect(apply).toBeEnabled();
});

it('uses the same filter panel for the date header and submits a calendar date', async () => {
  localStorage.setItem(filtersKey, JSON.stringify({ schema: 1, value: { search: '', filters: { currentMonth: false, logic: 'ALL', items: [{ field: 'traceCode', operator: 'EQ', value: 'TRACE-SAVED' }] } } }));
  mount();
  await screen.findByLabelText('搜索制程不良');
  const trigger = screen.getAllByLabelText('按发生时间筛选', { selector: 'button' })[0];
  fireEvent.click(trigger);
  const queries = within(await screen.findByLabelText('筛选面板'));
  expect(queries.getByLabelText('筛选字段 1')).toHaveValue('traceCode');
  expect(queries.getByLabelText('筛选字段 2')).toHaveValue('occurredAt');
  const date = queries.getByLabelText('筛选值 2');
  expect(date).toHaveAttribute('type', 'date');
  fireEvent.change(date, { target: { value: '2026-11-01' } });
  fireEvent.click(queries.getByText('应用筛选'));
  expect(latestQuery().get('filters')).toContain('"value":"2026-11-01"');
  expect(trigger).toHaveFocus();
});

it('restores an applied filter per account, organization, ledger and view', async () => {
  localStorage.setItem(filtersKey, JSON.stringify({ schema: 1, value: { search: '', filters: { currentMonth: false, logic: 'ALL', items: [{ field: 'traceCode', operator: 'EQ', value: 'TRACE-SAVED' }] } } }));
  mount();
  expect(latestQuery().get('filters')).toContain('TRACE-SAVED');
});

it('clears the default month before filtering for missing dates', async () => {
  mount();
  await screen.findByLabelText('搜索制程不良');
  const { queries } = await openPanel();
  fireEvent.click(queries.getByLabelText('仅当前自然月（北京时间）'));
  fireEvent.click(queries.getByText('添加筛选条件'));
  fireEvent.change(queries.getByLabelText('筛选字段 1'), { target: { value: 'occurredAt' } });
  fireEvent.change(queries.getByLabelText('筛选运算符 1'), { target: { value: 'EMPTY' } });
  fireEvent.click(queries.getByText('应用筛选'));
  expect(JSON.parse(latestQuery().get('filters')!)).toEqual({ logic: 'ALL', items: [{ field: 'occurredAt', operator: 'EMPTY' }] });
  expect(latestQuery().has('occurredFrom')).toBe(false);
  expect(localStorage.getItem(filtersKey)).not.toBeNull();
});

it('restores the month without clearing column preferences', async () => {
  localStorage.setItem(filtersKey, JSON.stringify({ schema: 1, value: { search: '', filters: { currentMonth: false, logic: 'ALL', items: [] } } }));
  const columns = JSON.stringify({ schema: 1, value: { widths: { description: 390 } } });
  localStorage.setItem(columnsKey, columns);
  mount();
  await screen.findByLabelText('搜索制程不良');
  const { queries } = await openPanel();
  fireEvent.click(queries.getByText('恢复系统默认筛选'));
  expect(latestQuery().get('occurredFrom')).toBe(monthFrom);
  expect(latestQuery().has('filters')).toBe(false);
  expect(localStorage.getItem(filtersKey)).toBeNull();
  expect(localStorage.getItem(columnsKey)).toBe(columns);
});
