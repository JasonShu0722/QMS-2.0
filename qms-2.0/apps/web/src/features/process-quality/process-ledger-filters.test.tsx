import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  dispositionPlan: null, dispositionProgress: null, dispositionCompletedAt: null, dispositionHistory: [],
  materialVerificationHistory: [], ledgerHistory: [], classificationHistory: [], lineName: '一线', operationName: '贴片',
  factoryCode: 'FACTORY_1', shift: 'DAY', operationSector: 'SMT', productCategory: 'PCBA', productSubcategory: '主板', projectStage: 'MASS_PRODUCTION', projectName: null,
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
    if (path.includes('/ledger-workflow-configuration/capabilities')) return { boards: ['REGISTRATION'] };
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

const maintenanceColumns = ['分析进度', '处置方案', '处置进度', '处置完成时间'];

it('keeps selection first and frozen, hides maintenance columns by default and adds them before actions', async () => {
  items = [{ ...defect, dispositionCompletedAt: '2026-11-10T16:23:00.000Z' }];
  const { container } = mount();
  const headers = within(container.querySelector('thead')!);
  expect(headers.queryByRole('columnheader', { name: '明细' })).not.toBeInTheDocument();
  const selection = headers.getByRole('columnheader', { name: '选择' });
  expect(selection.previousElementSibling).toBeNull();
  expect(selection.className).toMatch(/ant-table-cell-fix-(left|start)/);
  for (const label of maintenanceColumns) expect(headers.queryByRole('columnheader', { name: label })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '列设置' }));
  for (const label of maintenanceColumns) fireEvent.click(await screen.findByLabelText(`显示 ${label}`));
  const visible = headers.getAllByRole('columnheader').map(header => header.getAttribute('aria-label'));
  expect(visible.slice(-5)).toEqual([...maintenanceColumns, '操作']);
  const row = (await screen.findByLabelText(`选择制程不良 ${defect.description}`)).closest('tr')!;
  expect(row.cells[visible.indexOf('处置完成时间')]).toHaveTextContent(/^2026\/11\/11$/);
}, 30000);

it('retains explicit visibility and width while moving legacy maintenance columns before actions', async () => {
  const order = ['select', 'occurredAt', 'description', 'actions', 'analysisProgress', 'dispositionPlan'];
  localStorage.setItem(columnsKey, JSON.stringify({ schema: 1, value: { order, visible: ['select', 'description', 'actions', 'dispositionPlan'], widths: { description: 390 } } }));
  const { container } = mount();
  const headers = within(container.querySelector('thead')!);
  expect(headers.queryByRole('columnheader', { name: '分析进度' })).not.toBeInTheDocument();
  expect(headers.queryByRole('columnheader', { name: '处置进度' })).not.toBeInTheDocument();
  expect(headers.queryByRole('columnheader', { name: '处置完成时间' })).not.toBeInTheDocument();
  const actions = headers.getByRole('columnheader', { name: '操作' });
  expect(headers.getByRole('columnheader', { name: '处置方案' }).compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(headers.getByRole('columnheader', { name: '不良描述' })).getByRole('separator')).toHaveAttribute('aria-valuenow', '390');
});

it('offers the shared filter trigger for every configurable data column', () => {
  const visible = ['select', 'occurredAt', 'factoryCode', 'shift', 'project', 'productCategory', 'productSubcategory', 'projectStage', 'description', 'traceCode', 'lineName', 'operationName', 'operationSector', 'defectTypeCode', 'defectQuantity', 'productCode', 'workOrderCode', 'lineCode', 'operationCode', 'registeredByName', 'completion', 'responsibilityCategory', 'ledgerStatus', 'material', 'mapping', 'source', 'analysisProgress', 'dispositionPlan', 'dispositionProgress', 'dispositionCompletedAt', 'actions'];
  localStorage.setItem(columnsKey, JSON.stringify({ schema: 1, value: { visible } }));
  const { container } = mount();
  const headers = Array.from(container.querySelectorAll('thead th[data-compact-ledger-column]'));
  expect(headers.map(header => header.getAttribute('data-compact-ledger-column'))).toEqual(visible);
  for (const header of headers) {
    const label = header.getAttribute('aria-label')!;
    const controls = within(header as HTMLElement).queryAllByLabelText(`按${label}筛选`, { selector: 'button' });
    expect(controls, label).toHaveLength(['选择', '操作'].includes(label) ? 0 : 1);
  }
});

it('shows the completion state alongside duplicate warnings', async () => {
  items = [{ ...defect, duplicateCount: 1, pendingCompletion: false }];
  localStorage.setItem(columnsKey, JSON.stringify({ schema: 1, value: { visible: ['select', 'description', 'completion', 'actions'] } }));
  mount();
  const row = within((await screen.findByLabelText(`选择制程不良 ${defect.description}`)).closest('tr')!);
  const completion = row.getByText('已完善').closest('td')!;
  expect(completion).toHaveTextContent('同工序同条码已有记录。');
});

it('shows the factory before shift and displays saved and missing values in the ledger and detail', async () => {
  const missing = { ...defect, id: '33333333-3333-4333-8333-333333333333', description: '历史记录', factoryCode: null, issues: ['factory:INVALID'], pendingCompletion: true };
  items = [defect, missing];
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation((path, init) => path.endsWith(`/defects/${missing.id}`) ? Promise.resolve(missing) : read(path, init));
  const { container } = mount();
  const headers = within(container.querySelector('thead')!);
  const factory = headers.getByRole('columnheader', { name: '工厂' }) as HTMLTableCellElement;
  expect(factory.previousElementSibling).toBe(headers.getByRole('columnheader', { name: '发生时间' }));
  expect(factory.nextElementSibling).toBe(headers.getByRole('columnheader', { name: '班次' }));
  const savedRow = (await screen.findByLabelText(`选择制程不良 ${defect.description}`)).closest('tr')!;
  const oldRow = screen.getByLabelText(`选择制程不良 ${missing.description}`).closest('tr')!;
  expect(savedRow.cells[factory.cellIndex]).toHaveTextContent('一工厂');
  expect(oldRow.cells[factory.cellIndex]).toHaveTextContent(/^\/$/);
  fireEvent.click(within(oldRow).getByLabelText('查看详情'));
  const drawer = screen.getByText('不良品详情', { selector: '.ant-drawer-title' }).closest<HTMLElement>('[role="dialog"]')!;
  expect((await within(drawer).findByText('工厂', { selector: 'dt' })).nextElementSibling).toHaveTextContent(/^\/$/);
  expect(within(drawer).queryByText(/工厂来源值无效/)).not.toBeInTheDocument();
});

it('submits factory codes and value-free empty conditions from the shared filter panel', async () => {
  mount();
  const { queries } = await openPanel('按工厂筛选');
  expect(queries.getByLabelText('筛选字段 1')).toHaveValue('factoryCode');
  const select = queries.getByLabelText('筛选值 1');
  expect(within(select).getByRole('option', { name: '一工厂' })).toHaveValue('FACTORY_1');
  fireEvent.change(select, { target: { value: 'FACTORY_2' } });
  fireEvent.click(queries.getByText('应用筛选'));
  expect(JSON.parse(latestQuery().get('filters')!)).toEqual({ logic: 'ALL', items: [{ field: 'factoryCode', operator: 'EQ', value: 'FACTORY_2' }] });
  const panel = (await openPanel()).queries;
  fireEvent.change(panel.getByLabelText('筛选运算符 1'), { target: { value: 'EMPTY' } });
  fireEvent.click(panel.getByText('应用筛选'));
  expect(JSON.parse(latestQuery().get('filters')!)).toEqual({ logic: 'ALL', items: [{ field: 'factoryCode', operator: 'EMPTY' }] });
});

it('upgrades a saved order, keeps an explicitly hidden factory after reload, and restores defaults', () => {
  const order = ['select', 'project', 'shift', 'occurredAt', 'productSubcategory', 'description', 'actions'];
  localStorage.setItem(columnsKey, JSON.stringify({ schema: 1, value: { order, visible: order.filter(key => key !== 'occurredAt'), widths: { description: 390 } } }));
  const mounted = mount();
  const savedHeaders = within(mounted.container.querySelector('thead')!);
  const headerOptions = { selector: 'th' };
  expect(savedHeaders.getByLabelText('工厂', headerOptions).nextElementSibling).toBe(savedHeaders.getByLabelText('班次', headerOptions));
  expect(savedHeaders.getByLabelText('产品类型', headerOptions).nextElementSibling).toBe(savedHeaders.getByLabelText('细分类型', headerOptions));
  expect(savedHeaders.queryByLabelText('发生时间', headerOptions)).not.toBeInTheDocument();
  expect(within(savedHeaders.getByLabelText('不良描述', headerOptions)).getByRole('separator')).toHaveAttribute('aria-valuenow', '390');
  fireEvent.click(within(mounted.container).getByRole('button', { name: '列设置' }));
  const settings = within(document.querySelector<HTMLElement>('.qms-ledger__settings')!);
  fireEvent.click(settings.getByLabelText('显示 工厂'));
  mounted.unmount();
  const { container } = mount();
  const restoredHeaders = within(container.querySelector('thead')!);
  expect(restoredHeaders.queryByLabelText('工厂', headerOptions)).not.toBeInTheDocument();
  fireEvent.click(within(container).getByRole('button', { name: '列设置' }));
  const restoredSettings = within(document.querySelector<HTMLElement>('.qms-ledger__settings')!);
  fireEvent.click(restoredSettings.getByText('恢复录单默认列', { selector: 'button span' }));
  const factory = restoredHeaders.getByLabelText('工厂', headerOptions);
  expect(factory.previousElementSibling).toBe(restoredHeaders.getByLabelText('发生时间', headerOptions));
  expect(factory.nextElementSibling).toBe(restoredHeaders.getByLabelText('班次', headerOptions));
}, 60000);

it('displays the mapped product category even without a linked project and shows missing categories as unconfirmed', async () => {
  const unmapped = { ...defect, id: '33333333-3333-4333-8333-333333333333', description: '历史记录', productCategory: null, productSubcategory: null };
  items = [defect, unmapped];
  const { container } = mount();
  const headers = within(container.querySelector('thead')!);
  const category = headers.getByLabelText('产品类型', { selector: 'th' });
  expect(category.nextElementSibling).toBe(headers.getByLabelText('细分类型', { selector: 'th' }));
  const categoryIndex = (category as HTMLTableCellElement).cellIndex;
  for (const [record, label] of [[defect, 'PCBA'], [unmapped, '未确认']] as const) {
    const selection = await screen.findByLabelText(`选择制程不良 ${record.description}`);
    expect(selection.closest('tr')?.cells[categoryIndex]).toHaveTextContent(label);
    expect(selection.closest('tr')?.cells[categoryIndex + 1]).toHaveTextContent(record.productSubcategory ?? /^\/$/);
  }
});

it('applies the product category text filter from the header and resets pagination', async () => {
  localStorage.setItem(columnsKey, JSON.stringify({ schema: 1, value: { visible: ['productCategory'] } }));
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation((path, init) => path.includes('/defects?')
    ? Promise.resolve({ items: [defect], total: 32, page: 1, pageSize: 20 })
    : read(path, init));
  const { container } = mount();
  await screen.findByText('共 32 条');
  fireEvent.click(within(container.querySelector<HTMLElement>('.ant-table-pagination')!).getByText('2'));
  expect(latestQuery().get('page')).toBe('2');

  const { trigger, queries } = await openPanel('按产品类型筛选');
  expect(queries.getByLabelText('筛选字段 1')).toHaveValue('productCategory');
  expect(queries.getByLabelText('筛选运算符 1')).toHaveValue('CONTAINS');
  fireEvent.change(queries.getByLabelText('筛选值 1'), { target: { value: ' PCBA ' } });
  fireEvent.click(queries.getByText('应用筛选'));
  expect(latestQuery().get('page')).toBe('1');
  expect(JSON.parse(latestQuery().get('filters')!)).toEqual({ logic: 'ALL', items: [{ field: 'productCategory', operator: 'CONTAINS', value: 'PCBA' }] });
  expect(trigger).toHaveAttribute('aria-pressed', 'true');
  expect(JSON.parse(localStorage.getItem(filtersKey)!).value.filters.items).toEqual([{ field: 'productCategory', operator: 'CONTAINS', value: ' PCBA ' }]);
});

it('loads and clears the shared product category filter from the toolbar', async () => {
  localStorage.setItem(columnsKey, JSON.stringify({ schema: 1, value: { visible: ['productCategory'] } }));
  localStorage.setItem(filtersKey, JSON.stringify({ schema: 1, value: { search: '', filters: { currentMonth: true, logic: 'ALL', items: [{ field: 'productCategory', operator: 'CONTAINS', value: ' PCBA ' }] } } }));
  const { container } = mount();
  const trigger = within(container.querySelector('thead')!).getByLabelText('按产品类型筛选', { selector: 'button' });
  expect(trigger).toHaveAttribute('aria-pressed', 'true');

  const toolbar = (await openPanel()).queries;
  const field = toolbar.getByLabelText('筛选字段 1');
  expect(within(field).getByRole('option', { name: '产品类型' })).toHaveProperty('selected', true);
  expect(toolbar.getByLabelText('筛选值 1')).toHaveValue(' PCBA ');
  fireEvent.change(toolbar.getByLabelText('筛选运算符 1'), { target: { value: 'EMPTY' } });
  expect(toolbar.queryByLabelText('筛选值 1')).not.toBeInTheDocument();
  fireEvent.click(toolbar.getByLabelText('清空', { selector: 'button' }));
  fireEvent.click(toolbar.getByText('应用筛选'));
  expect(latestQuery().has('filters')).toBe(false);
  expect(trigger).toHaveAttribute('aria-pressed', 'false');
});

it.each([
  ['类型', 'defectTypeCode'], ['成品编码', 'productCode'], ['工单号', 'workOrderCode'],
  ['生产线编码', 'lineCode'], ['工序编码', 'operationCode'],
])('opens the matching text filter from the optional %s column', async (label, field) => {
  localStorage.setItem(columnsKey, JSON.stringify({ schema: 1, value: { visible: [field] } }));
  const { container } = mount();
  const header = within(container.querySelector('thead')!).getByRole('columnheader', { name: label });
  fireEvent.click(within(header).getByRole('button', { name: `按${label}筛选` }));
  const panel = within(await screen.findByRole('dialog', { name: '筛选面板' }));
  expect(panel.getByLabelText('筛选字段 1')).toHaveValue(field);
  expect(panel.getByLabelText('筛选运算符 1')).toHaveValue('CONTAINS');
});

it.each([
  ['完善情况', 'pendingCompletion'], ['首条物料 / 供应商', 'firstMaterialCode'], ['人工项目 / 映射', 'manualProjectCode'], ['批次 / 工单', 'batchOrWorkOrder'],
])('opens the matching filter for the %s projection', async (label, field) => {
  localStorage.setItem(columnsKey, JSON.stringify({ schema: 1, value: { visible: ['completion', 'material', 'mapping', 'source'] } }));
  mount();
  const { queries } = await openPanel(`按${label}筛选`);
  expect(queries.getByLabelText('筛选字段 1')).toHaveValue(field);
});

it('starts the ledger columns narrower and preserves individually saved widths', () => {
  const mounted = mount();
  const headerOptions = { selector: 'th' };
  const headers = within(mounted.container.querySelector('thead')!);
  for (const [name, width] of [['发生时间', 104], ['板块', 76], ['不良数量', 80]] as const) {
    expect(within(headers.getByLabelText(name, headerOptions)).getByRole('separator')).toHaveAttribute('aria-valuenow', String(width));
  }
  mounted.unmount();
  const saved = JSON.stringify({ schema: 1, value: { widths: { project: 222, shift: 48, occurredAt: 158, operationSector: 136, defectQuantity: 140 } } });
  localStorage.setItem(columnsKey, saved);
  const restoredHeaders = within(mount().container.querySelector('thead')!);
  for (const label of maintenanceColumns) expect(restoredHeaders.queryByLabelText(label, headerOptions)).not.toBeInTheDocument();
  for (const [name, width] of [['发生时间', 158], ['板块', 136], ['不良数量', 140], ['班次', 64], ['项目号', 222], ['产品类型', 84], ['细分类型', 112], ['项目状态', 100]] as const) {
    const handle = within(restoredHeaders.getByLabelText(name, headerOptions)).getByRole('separator');
    expect(handle).toHaveAttribute('aria-valuenow', String(width));
  }
  expect(localStorage.getItem(columnsKey)).toBe(saved);
});

it('shows the Beijing calendar date with the complete timestamp on hover and keeps the sector readable', async () => {
  const occurredAt = '2026-11-10T23:07:42.000Z';
  const operationSector = '较长的制程板块名称示例';
  items = [{ ...defect, occurredAt, operationSector }];
  const { container } = mount();
  const row = within((await screen.findByLabelText(`选择制程不良 ${defect.description}`)).closest('tr')!);
  const date = new Date(occurredAt);
  const dateOptions = { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' } as const;
  expect(row.getByText(date.toLocaleDateString('zh-CN', dateOptions))).toHaveAttribute('title', date.toLocaleString('zh-CN', { ...dateOptions, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
  expect(row.getByText(operationSector)).toHaveAttribute('title', operationSector);
  expect(within(container.querySelector('thead')!).getByLabelText('按板块筛选')).toBeVisible();
  expect(container.querySelector('.qms-ledger__horizontal-scroll')).toBeInTheDocument();
});

it('uses the same header layout for the compact quantity and description filters', async () => {
  items = [defect];
  const { container } = mount();
  const headers = within(container.querySelector('thead')!);
  const description = headers.getByRole<HTMLTableCellElement>('columnheader', { name: '不良描述' });
  const selection = await screen.findByLabelText(`选择制程不良 ${defect.description}`);
  expect(selection.closest('tr')?.cells[description.cellIndex]).toHaveStyle({ textAlign: 'left' });
  const { trigger, queries } = await openPanel('按不良数量筛选');
  expect(trigger.parentElement?.className).toBe(within(description).getByRole('button', { name: '按不良描述筛选' }).parentElement?.className);
  expect(queries.getByLabelText('筛选字段 1')).toHaveValue('defectQuantity');
  expect(queries.getByLabelText('筛选值 1')).toHaveAttribute('type', 'number');
});

it('places the single controlled paginator before the defect table', async () => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation((path, init) => path.includes('/defects?')
    ? Promise.resolve({ items: [defect], total: 32, page: 1, pageSize: 20 })
    : read(path, init));
  const { container } = mount();
  await screen.findByText('共 32 条');
  const ledger = container.querySelector('.qms-ledger')!;
  const pagination = ledger.querySelector('.ant-table-pagination')!;
  const table = ledger.querySelector('table')!;
  expect(ledger.querySelectorAll('.ant-table-pagination')).toHaveLength(1);
  expect(pagination.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(within(pagination as HTMLElement).getByText('2'));
  expect(latestQuery().get('page')).toBe('2');
});

it('shows the compact registration fields and keeps permitted record actions in the drawer header', async () => {
  const pending = { ...defect, defectTypeCode: 'DEFECT-9', projectCode: 'MANUAL-PROJECT', batchCode: 'BATCH-9', workOrderCode: 'WO-20261125-12345', productCode: 'PRODUCT-9', materialCode: 'MATERIAL-9', operationSector: null, productSubcategory: null, pendingConfiguration: true, issues: ['PROJECT_MAPPING_PENDING', 'OPERATION_SECTOR_PENDING', 'PRODUCT_SUBCATEGORY_PENDING', 'SOURCE_IDENTITY_INCOMPLETE', 'DEFECT_TYPE_UNKNOWN'] };
  items = [pending];
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.includes('/my-permissions')) return { permissions: [...permissions, 'process-quality:defects:close', 'process-quality:defects:delete'] };
    if (path.includes('/ledger-workflow-configuration/capabilities')) return { boards: ['REGISTRATION', 'CLOSURE'] };
    if (path.endsWith(`/defects/${pending.id}`)) return pending;
    return read(path, init);
  });
  mount();
  const row = (await screen.findByLabelText(`选择制程不良 ${pending.description}`)).closest('tr')!;
  expect(within(row).queryByLabelText(`映射与来源提示 ${pending.description}`)).not.toBeInTheDocument();
  fireEvent.click(within(row).getByLabelText('查看详情'));
  const dialog = screen.getByText('不良品详情', { selector: '.ant-drawer-title' }).closest<HTMLElement>('[role="dialog"]')!;
  const registration = within((await within(dialog).findByRole('heading', { name: '表单登记' })).closest('section')!);
  for (const [label, value] of [['工单号', pending.workOrderCode], ['成品编码', pending.productCode]]) {
    expect(registration.getByText(label, { exact: true }).parentElement).toHaveTextContent(value);
  }
  expect(registration.queryByText(/失效类型|完善情况|人工项目|映射建议|批次 \/ 工单|产品 \/ 物料|DEFECT-9|MANUAL-PROJECT|BATCH-9|MATERIAL-9/)).not.toBeInTheDocument();
  const header = within(dialog.querySelector<HTMLElement>('.ant-drawer-header')!);
  for (const name of ['维护登记信息', '删除台账', '选择此条并返回台账']) {
    expect(header.getByText(name, { selector: 'button span' })).toBeInTheDocument();
  }
  fireEvent.click(header.getByText('选择此条并返回台账', { selector: 'button span' }));
  expect(within(row).getByLabelText(`选择制程不良 ${pending.description}`)).toBeChecked();
});

it.each([true, false])('inserts the category before the saved subcategory and follows its visibility (%s)', (showSubcategory) => {
  const order = ['select', 'project', 'occurredAt', 'shift', 'productSubcategory', 'description', 'actions'];
  const visible = order.filter(key => key !== 'shift' && (showSubcategory || key !== 'productSubcategory'));
  const saved = JSON.stringify({ schema: 1, value: { order, visible, widths: { description: 390 } } });
  localStorage.setItem(columnsKey, saved);
  const { container } = mount();
  const headers = within(container.querySelector('thead')!);
  const expected = visible.flatMap(key => key === 'occurredAt' ? [key, 'factoryCode'] : key === 'productSubcategory' ? ['productCategory', key] : [key]);
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
  expect(toolbar.closest('.qms-ledger__action-bar')).toBeInTheDocument();
  expect(within(toolbar.closest<HTMLElement>('.qms-ledger')!.querySelector<HTMLElement>('.qms-ledger__tools')!).getByRole('button', { name: '列设置' })).toBeInTheDocument();
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

it('preserves selected sources on a same-month refresh and resets them and the page at Beijing month rollover', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date('2026-01-31T15:59:59Z'));
    const read = vi.mocked(apiRequest).getMockImplementation()!;
    vi.mocked(apiRequest).mockImplementation(async (path, init) => {
      if (!path.includes('/defects?')) return read(path, init);
      const query = new URL(path, 'http://localhost').searchParams;
      return { items: [defect], total: 41, page: Number(query.get('page')), pageSize: 20 };
    });
    const { container } = mount();
    await screen.findByLabelText(`选择制程不良 ${defect.description}`);
    fireEvent.click(within(container.querySelector<HTMLElement>('.ant-pagination')!).getByTitle('2'));
    const selection = screen.getByLabelText(`选择制程不良 ${defect.description}`);
    await waitFor(() => expect(selection).toBeEnabled());
    fireEvent.click(selection);
    const refresh = screen.getByLabelText('刷新');
    fireEvent.click(refresh);
    await waitFor(() => expect(selection).toBeEnabled());
    expect(selection).toBeChecked();
    expect(latestQuery().get('page')).toBe('2');
    expect(latestQuery().get('occurredFrom')).toBe('2025-12-31T16:00:00.000Z');

    vi.setSystemTime(new Date('2026-01-31T16:00:00Z'));
    const previousReads = listCalls().length;
    fireEvent.click(refresh);
    const refreshedSelection = await screen.findByLabelText(`选择制程不良 ${defect.description}`);
    await waitFor(() => expect(refreshedSelection).toBeEnabled());
    expect(refreshedSelection).not.toBeChecked();
    expect(screen.queryByLabelText('台账批量操作')).not.toBeInTheDocument();
    const rolledReads = listCalls().slice(previousReads).map(([path]) => new URL(path, 'http://localhost').searchParams);
    expect(rolledReads.map(query => query.get('page'))).toEqual(['1']);
    expect(rolledReads[0].get('occurredFrom')).toBe('2026-01-31T16:00:00.000Z');
    expect(rolledReads[0].get('occurredTo')).toBe('2026-02-28T16:00:00.000Z');
  } finally {
    vi.useRealTimers();
  }
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
