import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { components } from '@qms/contracts';
import { LanguageProvider } from '../../i18n/Language';
import type { EightDReport } from '../process-eight-d/eight-d';
import type { InternalEightDDomain } from './domain';
import { extractInternalEightDSourceTitle, InternalEightDSourceFacts } from './InternalEightDSourceFacts';

const saved = (snapshot: Record<string, unknown>, sourceId = 'source-a', sourceVersion = 7, primary = true) => ({ sourceId, sourceVersion, primary, snapshot });
type ControlledSources = components['schemas']['ProcessEightDControlledReportDto']['snapshot']['sources'];
const show = (domain: InternalEightDDomain, sources: EightDReport['sources'] | ControlledSources) => render(<InternalEightDSourceFacts domain={domain} sources={sources} />, { wrapper: LanguageProvider });
function fact(region: HTMLElement, label: string, value: string) {
  const term = within(region).getByText(label, { selector: 'dt' });
  expect(term.nextElementSibling).toHaveTextContent(value, { normalizeWhitespace: false });
}

it('shows saved customer normalized facts and mapping basis rather than raw cells or a UUID title', () => {
  show('customer', [saved({
    complaintNumber: 'CQ-007', complaintType: 'AFTER_SALES', customerName: '已保存客户', stage: 'NEW_PRODUCT',
    normalized: { defectDescription: '客户异响', componentCode: 'PART-7', quantity: 1, occurredOn: '2026-10-20',
      barcode: 'BAR-7', batch: 'BATCH-7', vin: 'VIN-7', mileage: 0, productModel: 'MODEL-7',
      productionOn: '2026-09-01', purchaseOn: '2026-09-02', vehicleDeliveryOn: '2026-09-03',
      vehicleOfflineOn: '2026-08-31', onlineOn: '2026-09-04', occurredAtLocation: '服务站', occurredAtRegion: '华东', terminalCustomerName: '终端客户' },
    mappingSnapshot: { outcome: 'matched', mapping: { id: 'mapping-7', version: 3 }, project: { code: 'SAVED-PROJECT', stage: 'NEW_PRODUCT' } },
    raw: { defectDescription: 'RAW-NOT-FACT', quantity: 'INVALID-NUMBER', projectCode: 'LIVE-NOT-FACT' },
  })]);
  expect(screen.getByRole('heading', { name: '客户异响' })).toBeVisible();
  const source = screen.getByRole('article', { name: '来源 1' });
  for (const [label, value] of [
    ['客诉编号', 'CQ-007'], ['客诉类型', '售后'], ['客户名称', '已保存客户'], ['零部件代码', 'PART-7'],
    ['保存的项目代码', 'SAVED-PROJECT'], ['登记阶段', '新品'], ['发生日期', '2026-10-20'], ['数量', '1'],
    ['产品条码', 'BAR-7'], ['批次', 'BATCH-7'], ['VIN', 'VIN-7'], ['行驶里程', '0'], ['产品型号', 'MODEL-7'],
    ['生产日期', '2026-09-01'], ['购买日期', '2026-09-02'], ['车辆交付日期', '2026-09-03'],
    ['车辆下线日期', '2026-08-31'], ['上线日期', '2026-09-04'], ['发生地点', '服务站'], ['发生区域', '华东'],
    ['终端客户名称', '终端客户'], ['保存的映射标识', 'mapping-7'], ['保存的映射版本', '3'], ['映射时项目阶段', '新品'],
  ]) fact(source, label, value);
  expect(source).not.toHaveTextContent(/RAW-NOT-FACT|INVALID-NUMBER|LIVE-NOT-FACT/);
});

it('distinguishes new-product inclusion evidence from the original process fact', () => {
  const sources: ControlledSources = [{ sourceDomain: 'new-product-quality', sourceType: 'new-product-defect-selection',
    sourceId: 'selection-7', sourceVersion: 7, sourceSnapshot: { selectionId: 'selection-7', projectId: 'project-7', id: 'process-fact-7',
    description: '新品密封不良', occurredAt: '2026-10-19T08:00:00.000Z', operationCode: 'OP-7', lineCode: 'LINE-7',
    defectQuantity: 2, traceCode: 'TRACE-7', projectCode: 'ORIGINAL-PROJECT', productCode: 'ORIGINAL-PART',
    inclusion: { projectCode: 'INCLUDED-PROJECT', componentCode: 'INCLUDED-PART', observedProjectStage: 'NEW_PRODUCT',
      occurredAt: '2026-10-19T08:00:00.000Z', observedAt: '2026-10-20T09:00:00.000Z', mappingId: 'mapping-7',
      mappingVersion: 3, temporalEvidence: 'UNVERIFIED', confirmationReason: null },
  } }];
  show('new-product', sources);
  const source = screen.getByRole('article', { name: '来源 1' });
  expect(screen.getByRole('heading', { name: '新品密封不良' })).toBeVisible();
  for (const [label, value] of [
    ['纳入记录标识', 'selection-7'], ['新品项目标识', 'project-7'], ['纳入时项目代码', 'INCLUDED-PROJECT'],
    ['纳入时零部件代码', 'INCLUDED-PART'], ['纳入时观察阶段', '新品'], ['纳入依据发生时间', '2026-10-19T08:00:00.000Z'],
    ['纳入观察时间', '2026-10-20T09:00:00.000Z'], ['历史阶段依据', '未核实'], ['确认理由', '未记录'],
    ['原过程事实标识', 'process-fact-7'], ['事实描述', '新品密封不良'], ['工序', 'OP-7'], ['产线', 'LINE-7'],
    ['不良数量', '2'], ['追溯码', 'TRACE-7'], ['过程事实项目代码', 'ORIGINAL-PROJECT'], ['过程事实产品代码', 'ORIGINAL-PART'],
  ]) fact(source, label, value);
  expect(within(source).queryByText('来源角色')).not.toBeInTheDocument();
});

it('keeps process facts and every source saved version and explicit primary status', () => {
  show('process', [
    { defectId: 'defect-a', sourceVersion: 4, primary: true, snapshot: { description: '过程划伤', occurredAt: '2026-10-18T10:00:00.000Z',
      defectQuantity: 6, traceCode: 'TRACE-A', batchCode: 'BATCH-A', workOrderCode: 'WO-A', operationCode: 'OP-A', lineCode: 'LINE-A', productCode: 'PRODUCT-A', projectCode: 'PROJECT-A' } },
    { defectId: 'defect-b', sourceVersion: 9, primary: false, snapshot: { description: '另一条过程事实', defectQuantity: null, occurredAt: null } },
  ]);
  const first = screen.getByRole('article', { name: '来源 1' });
  const second = screen.getByRole('article', { name: '来源 2' });
  for (const [label, value] of [
    ['来源标识', 'defect-a'], ['保存来源版本', '4'], ['来源角色', '主来源'], ['事实描述', '过程划伤'],
    ['发生时间', '2026-10-18T10:00:00.000Z'], ['不良数量', '6'], ['追溯码', 'TRACE-A'], ['批次', 'BATCH-A'],
    ['工单', 'WO-A'], ['工序', 'OP-A'], ['产线', 'LINE-A'], ['产品代码', 'PRODUCT-A'], ['项目代码', 'PROJECT-A'],
  ]) fact(first, label, value);
  fact(second, '来源标识', 'defect-b'); fact(second, '保存来源版本', '9'); fact(second, '来源角色', '关联来源');
  fact(second, '不良数量', '未记录'); fact(second, '发生时间', '未记录');
  expect(screen.queryByText('客诉编号')).not.toBeInTheDocument();
  expect(screen.queryByText('纳入记录标识')).not.toBeInTheDocument();
});

it('leaves missing or stripped facts unrecorded and never promotes malformed raw or normalized values', () => {
  show('customer', [saved({ normalized: { defectDescription: null, quantity: null, occurredOn: null, mileage: null },
    raw: { defectDescription: 'RAW-SECRET', quantity: 99, occurredOn: '2026-01-01', vin: 'HIDDEN-VIN' } }),
  saved({ normalized: ['NOT-A-NORMALIZED-OBJECT'], mappingSnapshot: { project: ['NOT-A-PROJECT'] } }, 'source-b', 8, false)]);
  for (const source of screen.getAllByRole('article')) {
    for (const label of ['客户名称', '零部件代码', '保存的项目代码', '数量', '发生日期', 'VIN', '行驶里程']) fact(source, label, '未记录');
  }
  expect(screen.getByRole('heading', { name: 'source-a · 未记录', level: 4 })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'source-b · 未记录', level: 4 })).toBeVisible();
  expect(screen.getByRole('region', { name: '来源基础信息' })).not.toHaveTextContent(/RAW-SECRET|HIDDEN-VIN|2026-01-01|NOT-A-/);
});

it('uses only supplied report snapshots when CURRENT and APPROVED are replaced and handles no sources', () => {
  const current = [saved({ complaintNumber: 'CURRENT-7', normalized: { defectDescription: '当前保存描述' } })];
  const approved: ControlledSources = [
    { sourceDomain: 'customer-quality', sourceType: 'customer-complaint', sourceId: 'source-a', sourceVersion: 3,
      sourceSnapshot: { complaintNumber: 'APPROVED-3', normalized: { defectDescription: '批准时描述' } } },
    { sourceDomain: 'customer-quality', sourceType: 'customer-complaint', sourceId: 'redacted-source', sourceVersion: 2, sourceSnapshot: {} },
  ];
  Object.freeze(current[0].snapshot); Object.freeze(current[0]); Object.freeze(current);
  Object.freeze(approved[0].sourceSnapshot); Object.freeze(approved[0]); Object.freeze(approved);
  const view = show('customer', current);
  expect(screen.getByRole('heading', { name: '当前保存描述' })).toBeVisible();
  view.rerender(<InternalEightDSourceFacts domain="customer" sources={approved} />);
  expect(screen.getByRole('heading', { name: '批准时描述' })).toBeVisible();
  expect(screen.queryByText('CURRENT-7')).not.toBeInTheDocument();
  fact(screen.getByRole('article', { name: '来源 1' }), '保存来源版本', '3');
  expect(screen.queryByText('来源角色')).not.toBeInTheDocument();
  const redacted = screen.getByRole('article', { name: '来源 2' });
  expect(within(redacted).getByRole('heading', { name: 'redacted-source · 未记录' })).toBeVisible();
  fact(redacted, '来源标识', 'redacted-source'); fact(redacted, '事实描述', '未记录');
  view.rerender(<InternalEightDSourceFacts domain="customer" sources={[]} />);
  expect(screen.getByText('未记录来源')).toBeVisible();
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
});

it('extracts bounded plain-text titles and contains long or hostile values without serializing unknown objects', () => {
  const unknown = { hidden: 'OBJECT-SECRET', toString: () => { throw new Error('Must not stringify an unknown object'); } };
  expect(extractInternalEightDSourceTitle('customer', { normalized: { defectDescription: unknown } })).toBeUndefined();
  expect(extractInternalEightDSourceTitle('customer', { description: 'NOT-NORMALIZED' })).toBeUndefined();
  expect(extractInternalEightDSourceTitle('process', { description: 'x'.repeat(1000) })?.length).toBeLessThanOrEqual(240);
  const literal = '<img src=x onerror=alert(1)>';
  const { container } = show('customer', [saved({ normalized: { defectDescription: literal, componentCode: 'X'.repeat(1000),
    quantity: unknown, occurredOn: ['NOT-A-DATE'], mileage: false, vin: unknown }, mappingSnapshot: unknown })]);
  expect(screen.getByRole('heading', { name: literal })).toBeVisible();
  const region = screen.getByRole('region', { name: '来源基础信息' });
  expect(region).toHaveStyle({ minWidth: '0', maxWidth: '100%', overflowWrap: 'anywhere' });
  expect(container.querySelector('img, script, pre, input, textarea, select, button')).toBeNull();
  expect(region).not.toHaveTextContent(/OBJECT-SECRET|NOT-A-DATE|\[object Object\]/);
  for (const label of ['数量', '发生日期', '行驶里程', 'VIN']) fact(screen.getByRole('article'), label, '未记录');
});
