import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Input, InputNumber, Modal, Popover, Select, Space, Tag, type TableProps } from 'antd';
import { Copy } from 'lucide-react';
import type { components } from '@qms/contracts';
import { ApiError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy } from '../../layouts/UnsavedChanges';
import { LedgerTable, useLedgerPageSize } from '../../ui/ledger';
import { useLedgerSessionEpoch } from '../../ui/ledger/preferences';
import { integrationError, isAborted, useScopedIntegrationRequests, type IntegrationScope } from './integration-ui';

type Receipt = components['schemas']['IntegrationReceiptDto'];
type Attempt = components['schemas']['IntegrationAttemptDto'];
type ReceiptPage = components['schemas']['IntegrationReceiptPageDto'];
type AttemptPage = components['schemas']['IntegrationAttemptPageDto'];
type Payload = components['schemas']['IntegrationPayloadDto'];
type Operation = components['schemas']['IntegrationOperationDto'];
type ReceiptEndpointPage = components['schemas']['IntegrationReceiptEndpointPageDto'];
type ReceiptDeleteResult = components['schemas']['IntegrationReceiptDeleteResultDto'];
type Row = Receipt | Attempt;
type Filters = { endpointId: string; sourceCode: string; messageId: string; receiptId: string; traceId: string; outcome: string; period: number };
const defaults: Filters = { endpointId: '', sourceCode: '', messageId: '', receiptId: '', traceId: '', outcome: '', period: 7 };
const root = '/api/v1/admin/integrations';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ReceiptList({ scope }: { scope: IntegrationScope }) {
  const { locale } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const [mode, setMode] = useState<'receipts' | 'attempts'>('receipts');
  const [draft, setDraft] = useState<Filters>(defaults);
  const [filters, setFilters] = useState<Filters>(defaults);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useLedgerPageSize('console-integration-receipts', scope.organizationId, 1000);
  const sessionEpoch = useLedgerSessionEpoch();
  const [total, setTotal] = useState(0);
  const [jumpPage, setJumpPage] = useState('');
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<ReceiptPage | AttemptPage>();
  const [operation, setOperation] = useState<Operation>();
  const [operationFailed, setOperationFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [validation, setValidation] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [endpointSearch, setEndpointSearch] = useState('');
  const [endpointOptions, setEndpointOptions] = useState<ReceiptEndpointPage['items']>([]);
  const [endpointLoading, setEndpointLoading] = useState(false);
  const [endpointPage, setEndpointPage] = useState(1);
  const [endpointTotal, setEndpointTotal] = useState(0);
  const [endpointLoadedPage, setEndpointLoadedPage] = useState(0);
  const [endpointError, setEndpointError] = useState<unknown>();
  const [endpointRetry, setEndpointRetry] = useState(0);
  const [selected, setSelected] = useState<Row>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [deleteIds, setDeleteIds] = useState<string[] | undefined>();
  const [deleteError, setDeleteError] = useState<unknown>();
  const [deleteNotice, setDeleteNotice] = useState<unknown>();
  const [deleteUnknown, setDeleteUnknown] = useState(false);
  const [capacityOpen, setCapacityOpen] = useState(false);
  const [capacityGiB, setCapacityGiB] = useState<number>();
  const [capacitySaving, setCapacitySaving] = useState(false);
  const [capacityError, setCapacityError] = useState<unknown>();
  const [capacityUnknown, setCapacityUnknown] = useState(false);
  const capacityPending = useRef(false);
  const capacityRequest = useRef<components['schemas']['UpdateIntegrationCapacityDto'] | undefined>(undefined);
  const deletePending = useRef(false);
  const deleteBusy = deleting || deleteUnknown;
  const capacityBusy = capacitySaving || capacityUnknown;
  const busy = deleteBusy || capacityBusy;
  useNavigationBusy(deleteBusy || capacityBusy);
  const { read, write, current } = useScopedIntegrationRequests(scope);
  const capacityRequests = useScopedIntegrationRequests(scope);
  const canManageCapacity = scope.permissions.includes('integration:manage');
  const range = useMemo(() => {
    const now = Date.now();
    return { from: new Date(now - filters.period * 86400000 + 60000).toISOString(), to: new Date(now).toISOString() };
  }, [filters, revision]);
  useEffect(() => {
    let active = true; setLoading(true); setData(undefined); setError(undefined); setSelected(undefined); setSelectedIds([]);
    const query: Record<string, string> = { ...range, page: String(page), limit: String(pageSize) };
    for (const key of ['endpointId', 'sourceCode', 'messageId', 'receiptId', 'traceId', 'outcome'] as const) if (filters[key]) query[key] = filters[key];
    void read<ReceiptPage | AttemptPage>(`${root}/${mode}`, query).then(result => {
      if (!active || !current()) return;
      if (!Array.isArray(result.items) || result.items.some(item => item.organizationId !== scope.organizationId) || result.page !== page || result.limit !== pageSize || !Number.isSafeInteger(result.total) || result.total < 0) { scope.deny(); return; }
      setTotal(result.total);
      const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
      if (page > lastPage) { setPage(lastPage); return; }
      setData(result);
    }).catch(cause => { if (active && current() && !isAborted(cause)) setError(cause); }).finally(() => { if (active && current()) setLoading(false); });
    return () => { active = false; };
  }, [mode, filters, range, page, pageSize, read, current, scope.organizationId]);
  useEffect(() => { setSelectedIds([]); setSelected(undefined); }, [scope.organizationId, scope.session, scope.epoch, sessionEpoch]);
  useEffect(() => {
    let active = true; setOperation(undefined); setOperationFailed(false);
    void read<Operation>(`${root}/status`).then(result => {
      if (active && current()) {
        if (!Number.isSafeInteger(result.usedBodyBytes) || !Number.isSafeInteger(result.capacityBytes) || result.capacityBytes <= 0) throw new Error('Invalid operation facts');
        setOperation(result);
      }
    }).catch(cause => { if (active && current() && !isAborted(cause)) setOperationFailed(true); });
    return () => { active = false; };
  }, [read, current, revision]);
  async function saveCapacity() {
    if (!canManageCapacity || deleteBusy || capacityPending.current || !current() || !Number.isInteger(capacityGiB) || capacityGiB! < 1 || capacityGiB! > 10) return;
    if (!capacityUnknown) capacityRequest.current = { organizationId: scope.organizationId, capacityBytes: capacityGiB! * 1073741824 };
    const body = capacityRequest.current;
    if (!body) return;
    capacityPending.current = true;
    setCapacitySaving(true); setCapacityError(undefined);
    try {
      await capacityRequests.write<Operation>(`${root}/status`, 'PATCH', body);
      if (current()) { setCapacityUnknown(false); capacityRequest.current = undefined; setCapacityOpen(false); setRevision(value => value + 1); }
    } catch (cause) {
      if (current() && !isAborted(cause)) {
        const known = cause instanceof ApiError && (cause.code === 'CLIENT_REAUTHENTICATION_COMPLETED' || cause.status !== undefined && cause.status >= 400 && cause.status < 500 && cause.status !== 408 && cause.status !== 425);
        setCapacityError(cause); setCapacityUnknown(!known);
      }
    } finally { capacityPending.current = false; if (current()) setCapacitySaving(false); }
  }
  useEffect(() => {
    let active = true;
    const search = endpointSearch.trim();
    if (!filtersOpen || !search) { if (!draft.endpointId) { setEndpointOptions([]); setEndpointPage(1); setEndpointLoadedPage(0); setEndpointTotal(0); } setEndpointError(undefined); setEndpointLoading(false); return () => { active = false; }; }
    setEndpointLoading(true); setEndpointError(undefined);
    void read<ReceiptEndpointPage>(`${root}/receipt-endpoints`, { search, page: String(endpointPage), limit: '20' }).then(result => {
      if (!active || !current()) return;
      if (!Array.isArray(result.items) || result.page !== endpointPage || result.limit !== 20 || result.items.some(item => !uuid.test(item.id) || typeof item.name !== 'string' || typeof item.code !== 'string') || !Number.isSafeInteger(result.total) || result.total < 0) { scope.deny(); return; }
      setEndpointTotal(result.total);
      setEndpointLoadedPage(endpointPage);
      setEndpointOptions(previous => [...(endpointPage === 1 ? previous.filter(option => option.id === draft.endpointId && !result.items.some(item => item.id === option.id)) : previous.filter(option => !result.items.some(item => item.id === option.id))), ...result.items]);
    }).catch(cause => { if (active && current() && !isAborted(cause)) setEndpointError(cause); }).finally(() => { if (active && current()) setEndpointLoading(false); });
    return () => { active = false; };
  }, [current, draft.endpointId, endpointSearch, endpointPage, endpointRetry, filtersOpen, read, scope.deny]);
  function apply() {
    if (busy || !current()) return;
    const next = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])) as Filters;
    if (['endpointId', 'receiptId', 'traceId'].some(key => next[key as keyof Filters] && !uuid.test(String(next[key as keyof Filters]))) || next.sourceCode && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(next.sourceCode) || next.messageId && !/^[A-Za-z0-9._:-]{8,128}$/.test(next.messageId)) { setValidation(true); return; }
    setValidation(false); setSelectedIds([]); setPage(1); setFilters(next); setJumpPage('');
  }
  const canDelete = current() && mode === 'receipts' && scope.permissions.includes('integration:manage');
  const pageRows = data?.items ?? [];
  const pageIds = canDelete ? pageRows.map(item => item.id) : [];
  const selectionDisabled = busy || loading || !data || !current();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  function changePage(next: number, size = pageSize) {
    if (busy || loading || !current()) return;
    setSelectedIds([]); setJumpPage(''); setPage(size === pageSize ? Math.max(1, Math.min(pageCount, next)) : 1); setPageSize(size);
  }
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.includes(id));
  const rowSelection: TableProps<Row>['rowSelection'] = canDelete ? {
    selectedRowKeys: selectedIds,
    onChange: keys => { if (!selectionDisabled) setSelectedIds(keys.map(String).filter(id => pageIds.includes(id))); },
    columnTitle: <input type="checkbox" disabled={selectionDisabled} aria-label={text('选择当前页', 'Select current page')} checked={allPageSelected} ref={node => { if (node) node.indeterminate = selectedIds.length > 0 && !allPageSelected; }} onChange={event => { if (!selectionDisabled) setSelectedIds(event.target.checked ? pageIds : []); }} />,
    getCheckboxProps: () => ({ disabled: selectionDisabled }),
  } : undefined;
  function confirmDelete(ids: string[]) { if (canDelete && !deleteBusy && !capacityBusy && ids.length > 0) { setDeleteError(undefined); setDeleteNotice(undefined); setDeleteUnknown(false); setDeleteIds([...ids]); } }
  async function executeDelete() {
    const ids = deleteIds;
    if (!ids || !canDelete || deletePending.current || !current()) return;
    deletePending.current = true;
    setDeleting(true); setError(undefined);
    try {
      const result = await write<ReceiptDeleteResult>(`${root}/receipts`, 'DELETE', { organizationId: scope.organizationId, receiptIds: ids });
      if (!current()) return;
      if (!Number.isSafeInteger(result.deletedCount) || result.deletedCount < 0 || !Array.isArray(result.receiptIds)) { scope.deny(); return; }
      const returnedIds = new Set(result.receiptIds);
      if (result.deletedCount !== result.receiptIds.length || result.receiptIds.some(id => !ids.includes(id)) || returnedIds.size !== result.receiptIds.length) { scope.deny(); return; }
      setSelectedIds([]);
      setDeleteIds(undefined);
      setDeleteUnknown(false);
      setRevision(value => value + 1);
    } catch (cause) {
      if (current() && !isAborted(cause)) {
        const known = cause instanceof ApiError && (cause.code === 'INTEGRATION_RECEIPT_NOT_FOUND' || !deleteUnknown && ((cause.status !== undefined && cause.status >= 400 && cause.status < 500 && cause.status !== 408 && cause.status !== 425) || cause.code === 'CLIENT_REAUTHENTICATION_COMPLETED'));
        setDeleteError(cause); setDeleteUnknown(!known);
        if (known) { setDeleteIds(undefined); setDeleteNotice(cause); setRevision(value => value + 1); }
      }
    }
    finally { deletePending.current = false; if (current()) setDeleting(false); }
  }
  const outcomes: Record<Attempt['outcome'], [string, string]> = { RECEIVED: ['已接收', 'Received'], DUPLICATE: ['重复', 'Duplicate'], REJECTED: ['已拒绝', 'Rejected'], FAILED: ['失败', 'Failed'], UNKNOWN: ['结果未知', 'Unknown'] };
  const clock = (value: string) => <time dateTime={value}>{new Date(value).toLocaleString(locale, { hour12: false })}</time>;
  const columns: TableProps<Row>['columns'] = [
    { key: 'messageId', title: text('消息编号', 'Message ID'), width: 220, render: (_, item) => <>{item.messageId ?? '—'}<small>{'receivedAt' in item ? item.id : item.traceId}</small></> },
    { key: 'endpoint', title: text('来源 / 接口', 'Source / interface'), width: 220, render: (_, item) => <>{'endpointName' in item && item.endpointName ? item.endpointName : item.endpointId}<small>{'endpointCode' in item && item.endpointCode ? item.endpointCode : item.endpointId}</small><small>{'sourceName' in item ? `${item.sourceName} (${item.sourceCode})` : ''}</small></> },
    { key: 'result', title: text('接收结果', 'Result'), width: 145, render: (_, item) => 'outcome' in item ? <><Tag color={['FAILED', 'REJECTED'].includes(item.outcome) ? 'error' : undefined}>{text(...outcomes[item.outcome])}</Tag><small>{item.reasonCode}</small></> : text(item.bodyAvailable ? '正文可查看' : '正文已清理', item.bodyAvailable ? 'Payload available' : 'Payload removed') },
    { key: 'time', title: text('时间', 'Time'), width: 185, render: (_, item) => clock('receivedAt' in item ? item.receivedAt : item.observedAt) },
    { key: 'actions', title: text('详情', 'Details'), width: canDelete ? 170 : 90, render: (_, item) => <Space size={4}><Button size="small" disabled={busy || loading || !current()} aria-label={text(`查看消息${item.messageId ?? item.id}`, `View message ${item.messageId ?? item.id}`)} onClick={() => { if (!busy && current()) setSelected(item); }}>{text('查看', 'View')}</Button>{canDelete && <Button size="small" danger disabled={selectionDisabled} aria-label={text(`删除消息${item.messageId ?? item.id}`, `Delete message ${item.messageId ?? item.id}`)} onClick={() => confirmDelete([item.id])}>{text('删除', 'Delete')}</Button>}</Space> },
  ];
  return <div className={`qms-integration-section qms-integration-records${canDelete && selectedIds.length > 0 ? ' qms-integration-records--selected' : ''}`}>
    <div role="toolbar" aria-label={text('接收记录操作', 'Receiving record actions')} className="qms-integration-record-actions"><Select disabled={busy} aria-label={text('记录视图', 'Record view')} value={mode} options={[{ value: 'receipts', label: text('已收数据', 'Received data') }, { value: 'attempts', label: text('请求结果', 'Request results') }]} onChange={value => { if (busy) return; setSelectedIds([]); setMode(value); setPage(1); setTotal(0); setJumpPage(''); setFilters(defaults); setDraft(defaults); setEndpointSearch(''); setEndpointOptions([]); setEndpointLoadedPage(0); }} />
      <Button disabled={busy} loading={loading} onClick={() => setRevision(value => value + 1)}>{text('刷新记录', 'Refresh records')}</Button>
      <Button disabled={busy} aria-expanded={filtersOpen} aria-controls="qms-integration-record-filters" onClick={() => setFiltersOpen(value => !value)}>{text('筛选条件', 'Filters')}</Button>
      {operation && <button type="button" className={`qms-integration-capacity-button${operation.usedBodyBytes >= operation.capacityBytes * .8 ? ' qms-integration-capacity-warning' : ''}`} disabled={!canManageCapacity || busy} onClick={() => { setCapacityGiB(Math.max(1, Math.min(10, Math.round(operation.capacityBytes / 1073741824)))); setCapacityError(undefined); setCapacityUnknown(false); setCapacityOpen(true); }} aria-label={text('设置组织正文容量', 'Set organization payload capacity')}>{text('组织正文容量', 'Organization payload capacity')} {(operation.usedBodyBytes / 1048576).toFixed(1)} / {(operation.capacityBytes / 1048576).toFixed(0)} MiB</button>}
    </div>
    {operationFailed && <Alert type="warning" showIcon title={text('运行事实暂不可读取', 'Operation facts are unavailable')} />}
    {mode === 'attempts' && <Alert type="info" showIcon title={text(data && 'collectionStatus' in data && data.collectionStatus === 'UNAVAILABLE' ? '请求明细采集不可用，部分请求可能没有记录' : '请求明细仅保留近7天，采集完整性未知', data && 'collectionStatus' in data && data.collectionStatus === 'UNAVAILABLE' ? 'Request collection is unavailable; some requests may be missing' : 'Request details are retained for seven days; collection completeness unknown')} />}
    {canDelete && selectedIds.length > 0 && <div role="toolbar" aria-label={text('已选接收记录', 'Selected receiving records')} className="qms-integration-selection-bar"><span>{text(`已选择 ${selectedIds.length} 条`, `${selectedIds.length} selected`)}</span><Button disabled={busy} onClick={() => { if (!busy) setSelectedIds([]); }}>{text('取消选择', 'Clear selection')}</Button><Button danger disabled={busy} loading={deleting} onClick={() => confirmDelete(selectedIds)}>{text('删除所选', 'Delete selected')}</Button></div>}
    {deleteUnknown && <Alert role="status" type="error" showIcon title={text('删除结果未确认，请使用原请求重试；期间请勿离开页面。', 'Deletion result is unknown. Retry the original request; do not leave this page.')} description={deleteError instanceof ApiError ? deleteError.traceId : undefined} />}
    {deleteNotice ? <Alert role="alert" type="error" showIcon title={text(deleteNotice instanceof ApiError && deleteNotice.code === 'CLIENT_REAUTHENTICATION_COMPLETED' ? '身份验证已完成，请重新提交删除操作' : '删除未完成，请检查后重试', deleteNotice instanceof ApiError && deleteNotice.code === 'CLIENT_REAUTHENTICATION_COMPLETED' ? 'Reauthentication completed. Submit the deletion again.' : 'Deletion was not completed. Check and retry.')} description={deleteNotice instanceof ApiError ? deleteNotice.traceId : undefined} /> : null}
    {filtersOpen && <fieldset disabled={busy} className="qms-integration-filter-fieldset"><form id="qms-integration-record-filters" className="qms-integration-filters" aria-label={text('接收记录筛选', 'Record filters')} onSubmit={event => { event.preventDefault(); apply(); }}>
      {endpointError ? <Alert role="alert" type="error" title={text('接口候选加载失败，请重试', 'Unable to load interfaces. Retry.')} action={<Button type="link" disabled={endpointLoading} onClick={() => setEndpointRetry(value => value + 1)}>{text('重试', 'Retry')}</Button>} /> : null}
      <label><span>{text('接口名称或编码', 'Interface name or code')}</span><Select disabled={busy} showSearch filterOption={false} allowClear aria-label={text('接口名称或编码', 'Interface name or code')} value={draft.endpointId || undefined} searchValue={endpointSearch} onSearch={value => { setEndpointSearch(value); setEndpointPage(1); setEndpointLoadedPage(0); }} onChange={value => setDraft(currentDraft => ({ ...currentDraft, endpointId: value ?? '' }))} loading={endpointLoading} options={endpointOptions.map(item => ({ value: item.id, label: `${item.name} (${item.code}) · ${item.id}` }))} dropdownRender={menu => <>{menu}{!endpointError && endpointLoadedPage * 20 < endpointTotal && <Button type="link" disabled={busy || endpointLoading} onMouseDown={event => event.preventDefault()} onClick={() => setEndpointPage(value => value + 1)}>{text('加载更多接口', 'Load more interfaces')}</Button>}</>} placeholder={text('输入名称或编码搜索', 'Search by interface name or code')} /></label>
      <label><span>{text('来源系统编码', 'Source system code')}</span><Input aria-label={text('来源系统编码', 'Source system code')} value={draft.sourceCode} onChange={event => setDraft(value => ({ ...value, sourceCode: event.target.value }))} maxLength={64} /></label>
      <label><span>{text('消息编号', 'Message ID')}</span><Input aria-label={text('消息编号', 'Message ID')} value={draft.messageId} onChange={event => setDraft(value => ({ ...value, messageId: event.target.value }))} maxLength={128} /></label>
      <label><span>{text('接收编号', 'Receipt ID')}</span><Input aria-label={text('接收编号', 'Receipt ID')} value={draft.receiptId} onChange={event => setDraft(value => ({ ...value, receiptId: event.target.value }))} maxLength={36} /></label>
      {mode === 'attempts' && <><label><span>{text('请求追踪号', 'Request ID')}</span><Input aria-label={text('请求追踪号', 'Request ID')} value={draft.traceId} onChange={event => setDraft(value => ({ ...value, traceId: event.target.value }))} maxLength={36} /></label>
        <label><span>{text('请求结果', 'Request outcome')}</span><Select disabled={busy} aria-label={text('请求结果', 'Request outcome')} value={draft.outcome} options={[{ value: '', label: text('全部结果', 'All outcomes') }, ...Object.entries(outcomes).map(([value, labels]) => ({ value, label: text(...labels) }))]} onChange={outcome => setDraft(value => ({ ...value, outcome }))} /></label></>}
      <label><span>{text('查询时段', 'Time window')}</span><Select disabled={busy} aria-label={text('查询时段', 'Time window')} value={draft.period} options={(mode === 'attempts' ? [1, 7] : [1, 7, 30, 90]).map(value => ({ value, label: text(`近${value}天`, `Last ${value} days`) }))} onChange={period => setDraft(value => ({ ...value, period }))} /></label>
      <Button htmlType="submit" type="primary">{text('应用筛选', 'Apply filters')}</Button>
    </form></fieldset>}
    {validation && <Alert role="alert" type="warning" title={text('请检查标识格式；来源系统编码最多64位，消息编号为8～128位', 'Check ID formats. Source system codes allow up to 64 characters; message IDs require 8–128 characters.')} />}
    {error ? <Alert role="alert" showIcon type="error" title={text(integrationError(error), 'Unable to read records. Retry.')} description={error instanceof ApiError ? error.traceId : undefined} /> : null}
    <Modal open={capacityOpen} title={text('设置组织正文容量', 'Set organization payload capacity')} onCancel={() => { if (!capacityBusy) setCapacityOpen(false); }} maskClosable={!capacityBusy} keyboard={!capacityBusy} closable={!capacityBusy} onOk={() => void saveCapacity()} okText={text(capacityUnknown ? '重试保存' : '保存', capacityUnknown ? 'Retry save' : 'Save')} cancelText={text('取消', 'Cancel')} cancelButtonProps={{ disabled: capacityBusy }} okButtonProps={{ loading: capacitySaving, disabled: !Number.isInteger(capacityGiB) || capacityGiB! < 1 || capacityGiB! > 10 }}>
      <Space orientation="vertical" style={{ width: '100%' }}>
        <span>{text('容量范围：1～10 GiB；不能小于当前已使用容量。', 'Capacity: 1–10 GiB; it cannot be lower than current usage.')}</span>
        <InputNumber aria-label={text('组织容量GiB', 'Organization capacity GiB')} disabled={capacityBusy} min={1} max={10} precision={0} value={capacityGiB} onChange={value => setCapacityGiB(value ?? undefined)} addonAfter="GiB" style={{ width: '100%' }} />
        {capacityError ? <Alert role="alert" type="error" showIcon title={text(integrationError(capacityError), 'Unable to update organization capacity. Retry.')} description={capacityError instanceof ApiError ? capacityError.traceId : undefined} /> : null}
      </Space>
    </Modal>
    <LedgerTable<Row> ledgerId={`console-integration-${mode}`} organizationId={scope.organizationId} rowKey="id" dataSource={data?.items ?? []} columns={columns} requiredColumnKeys={['messageId', 'actions']} rowSelection={rowSelection} resizableSelection className={canDelete ? 'qms-integration-receipt-table--selection' : undefined} loading={loading} scroll={{ x: canDelete ? 'max-content' : 860 }}
      pagination={false} toolbarContent={<nav aria-label={text('接收记录分页', 'Receiving record pagination')} className="qms-integration-pagination">
        <span>{text(`共 ${total} 条`, `${total} records`)}</span>
        <label><span>{text('每页', 'Per page')}</span><select aria-label={text('每页条数', 'Records per page')} disabled={busy || loading} value={pageSize} onChange={event => changePage(1, Number(event.target.value))}>{[10, 20, 50, 100, 500, 1000].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
        <Button size="small" aria-label={text('上一页', 'Previous page')} disabled={busy || loading || page <= 1} onClick={() => changePage(page - 1)}>‹</Button>
        <span aria-live="polite">{page} / {pageCount}</span>
        <Button size="small" aria-label={text('下一页', 'Next page')} disabled={busy || loading || page >= pageCount} onClick={() => changePage(page + 1)}>›</Button>
        <form onSubmit={event => { event.preventDefault(); const next = Number(jumpPage); if (Number.isSafeInteger(next) && next >= 1 && next <= pageCount) changePage(next); }}><label><span>{text('跳至', 'Go to')}</span><input type="number" aria-label={text('跳至页', 'Go to page')} min={1} max={pageCount} step={1} value={jumpPage} disabled={busy || loading} onChange={event => setJumpPage(event.target.value)} /></label><Button size="small" htmlType="submit" disabled={busy || loading || !jumpPage}>{text('跳转', 'Go')}</Button></form>
      </nav>} />
    {selected && <ReceiptDetail key={selected.id} scope={scope} row={selected} close={() => setSelected(undefined)} />}
    <Modal zIndex={1000} open={deleteIds !== undefined && current()} title={text('删除接收记录', 'Delete receiving records')} onCancel={() => { if (!deleteBusy) setDeleteIds(undefined); }} maskClosable={!deleteBusy} keyboard={!deleteBusy} closable={!deleteBusy} okButtonProps={{ danger: true, loading: deleting, 'aria-label': text(deleteUnknown ? '重试删除' : '删除', deleteUnknown ? 'Retry delete' : 'Delete') }} cancelButtonProps={{ disabled: deleteBusy, 'aria-label': text('取消', 'Cancel') }} onOk={() => void executeDelete()} okText={text(deleteUnknown ? '重试删除' : '删除', deleteUnknown ? 'Retry delete' : 'Delete')} cancelText={text('取消', 'Cancel')}>
      <p>{text(`确认删除选中的 ${deleteIds?.length ?? 0} 条接收记录？删除后不可恢复。`, `Delete ${deleteIds?.length ?? 0} receiving record(s)? This cannot be undone.`)}</p>
      {deleteError ? <Alert role="alert" type="error" showIcon title={text(deleteUnknown ? '删除结果未确认，请使用原请求重试；期间请勿离开页面。' : '删除未完成，请检查后重试', deleteUnknown ? 'Deletion result is unknown. Retry the original request; do not leave this page.' : 'Deletion was not completed. Check and retry.')} description={deleteError instanceof ApiError ? deleteError.traceId : undefined} /> : null}
    </Modal>
  </div>;
}

function ReceiptDetail({ scope, row, close }: { scope: IntegrationScope; row: Row; close: () => void }) {
  const { locale } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const { read, current } = useScopedIntegrationRequests(scope);
  const [payload, setPayload] = useState<Payload>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');
  const payloadRequest = useRef(0);
  const loadPayload = useCallback(async () => {
    if (!('bodyAvailable' in row) || !row.bodyAvailable || !scope.permissions.includes('integration:payload:read')) return;
    const requestId = ++payloadRequest.current;
    setLoading(true); setError(undefined);
    try {
      const result = await read<Payload>(`${root}/receipts/${row.id}/payload`);
      if (result.id !== row.id || typeof result.text !== 'string') { scope.deny(); return; }
      if (requestId === payloadRequest.current && current()) setPayload(result);
    } catch (cause) { if (requestId === payloadRequest.current && current() && !isAborted(cause)) setError(cause); }
    finally { if (requestId === payloadRequest.current && current()) setLoading(false); }
  }, [current, read, row, scope.deny, scope.permissions]);
  useEffect(() => {
    void loadPayload();
    return () => { payloadRequest.current += 1; };
  }, [loadPayload]);
  async function copyPayload() {
    if (!payload || !current()) return;
    try {
      await navigator.clipboard.writeText(payload.text);
      if (current()) setCopyState('success');
    } catch (cause) {
      if (current() && !isAborted(cause)) setCopyState('error');
    }
  }
  const entries = 'receivedAt' in row ? [
    [text('接收编号', 'Receipt ID'), row.id], [text('消息编号', 'Message ID'), row.messageId], [text('来源系统', 'Source system'), row.sourceName],
    [text('接口', 'Interface'), 'endpointName' in row && row.endpointName ? row.endpointName : row.endpointId], [text('接口标识', 'Interface ID'), row.endpointId], [text('接收时间', 'Received'), new Date(row.receivedAt).toLocaleString(locale, { hour12: false })], [text('接收配置版本', 'Configuration version'), row.configurationVersion],
  ] : [
    [text('请求追踪号', 'Request ID'), row.traceId], [text('消息编号', 'Message ID'), row.messageId ?? '—'], [text('接收编号', 'Receipt ID'), row.receiptId ?? '—'], [text('接口', 'Interface'), 'endpointName' in row && row.endpointName ? row.endpointName : row.endpointId],
    [text('HTTP状态', 'HTTP status'), row.statusCode], [text('错误分类', 'Reason'), row.reasonCode ?? '—'], [text('耗时（毫秒）', 'Duration (ms)'), row.durationMs],
  ];
  const detailValue = (label: unknown, value: unknown) => {
    const fullValue = String(value);
    if (fullValue.length < 24) return <span>{fullValue}</span>;
    return <Popover trigger="click" placement="topLeft" content={<div className="qms-integration-detail-value-popover">{fullValue}</div>}><button type="button" className="qms-integration-detail-value" aria-label={`${String(label)}：${fullValue}`} title={fullValue}>{fullValue}</button></Popover>;
  };
  return <Modal open centered title={text('接收详情', 'Receiving details')} footer={<Button onClick={close}>{text('关闭', 'Close')}</Button>} onCancel={close} destroyOnHidden width={760} className="qms-integration-detail-modal" classNames={{ body: 'qms-integration-detail-body' }} styles={{ wrapper: { overflow: 'hidden' }, container: { display: 'flex', flexDirection: 'column', maxHeight: 'calc(100dvh - 32px)', padding: '12px 16px' }, header: { flexShrink: 0 }, footer: { flexShrink: 0 } }}>
    <dl className="qms-integration-detail">{entries.map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{detailValue(label, value)}</dd></div>)}</dl>
    {'bodyAvailable' in row && !row.bodyAvailable && <Alert type="info" title={text('正文已按保留期限清理', 'The payload has been removed under its retention policy')} />}
    {error ? <Alert role="alert" type="error" title={text(integrationError(error), 'Unable to read the payload. Retry.')} action={<Button aria-label={text('重试读取正文', 'Retry payload read')} onClick={() => void loadPayload()}>{text('重试', 'Retry')}</Button>} /> : null}
    {loading && !payload && <Alert type="info" title={text('正在读取接收正文', 'Reading payload')} />}
    {payload && <div className="qms-integration-payload-frame"><Button className="qms-integration-payload-copy" size="small" type="text" icon={<Copy size={15} aria-hidden="true" />} aria-label={text('复制接收正文', 'Copy payload')} onClick={() => void copyPayload()} /><pre className="qms-integration-payload" aria-label={text('接收正文', 'Payload')} tabIndex={0}>{payload.text}</pre>{copyState === 'success' && <span role="status" className="qms-integration-copy-feedback">{text('已复制接收正文', 'Payload copied')}</span>}{copyState === 'error' && <span role="alert" className="qms-integration-copy-feedback qms-integration-copy-error">{text('复制失败，请重试', 'Copy failed. Retry.')}</span>}</div>}
  </Modal>;
}
