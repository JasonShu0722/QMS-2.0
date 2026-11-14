import { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Form, Input, Modal, Select, Space, Tag, type TableProps } from 'antd';
import { RefreshCw } from 'lucide-react';
import type { components } from '@qms/contracts';
import { useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { LedgerTable, useLedgerPageSize } from '../../ui/ledger';
import { isAborted, useScopedIntegrationRequests, type IntegrationScope } from '../api-integrations/integration-ui';
import { IngestionError, IngestionFields, ingestionIssue, ingestionPath, label, useIngestionMutation, useIngestionPage, useIngestionText, type Endpoint, type Item, type Job } from './ingestion-ui';

export function JobList({ scope, endpoints, receiptId, clearReceipt, canReceipts }: { scope: IntegrationScope; endpoints: Endpoint[]; receiptId?: string; clearReceipt: () => void; canReceipts: boolean }) {
  const text = useIngestionText(); const english = text('zh', 'en') === 'en';
  const [pageSize, setPageSize] = useLedgerPageSize('console-ingestion-jobs', scope.organizationId); const [page, setPage] = useState(1); const [revision, setRevision] = useState(0); const [endpointId, setEndpointId] = useState<string>(); const [detail, setDetail] = useState<Job>();
  const result = useIngestionPage<components['schemas']['IngestionJobPageDto']>(scope, `${ingestionPath}/jobs`, page, pageSize, revision, { ...(endpointId ? { endpointId } : {}), ...(receiptId ? { receiptId } : {}) });
  const reload = () => setRevision(value => value + 1);
  const columns: TableProps<Job>['columns'] = [
    { key: 'identity', title: text('接收接口 / 任务顺序', 'Interface / sequence'), width: 210, render: (_, job) => <>{endpoints.find(endpoint => endpoint.id === job.endpointId)?.name ?? text('接口不可用', 'Interface unavailable')}<small>#{job.sequence} · {label(job.target, english)}</small></> },
    { key: 'source', title: text('来源', 'Source'), width: 110, dataIndex: 'source', render: value => label(value, english) },
    { key: 'status', title: text('状态', 'Status'), width: 110, dataIndex: 'status', render: value => <Tag color={value === 'BLOCKED' ? 'error' : value === 'COMPLETED' ? 'success' : undefined}>{label(value, english)}</Tag> },
    { key: 'counts', title: text('处理进度', 'Progress'), width: 310, render: (_, job) => <JobCounts job={job} /> },
    { key: 'createdAt', title: text('创建时间', 'Created'), width: 180, dataIndex: 'createdAt', render: value => new Date(value).toLocaleString(english ? 'en-US' : 'zh-CN') },
    { key: 'actions', title: text('操作', 'Actions'), width: 100, render: (_, job) => <Button size="small" aria-label={text(`查看任务${job.sequence}`, `View job ${job.sequence}`)} onClick={() => setDetail(job)}>{text('查看详情', 'View details')}</Button> },
  ];
  return <div className="qms-ingestion-section">
    {receiptId && <Space wrap><Tag>{text('接收编号', 'Receiving ID')}: {receiptId}</Tag><Button size="small" onClick={clearReceipt}>{text('清除接收记录筛选', 'Clear receiving record filter')}</Button></Space>}
    <Space wrap><Select aria-label={text('筛选接收接口', 'Filter receiving interface')} style={{ minWidth: 220 }} allowClear showSearch optionFilterProp="label" placeholder={text('全部接收接口', 'All interfaces')} value={endpointId} onChange={value => { setEndpointId(value); setPage(1); }} options={endpoints.map(endpoint => ({ value: endpoint.id, label: endpoint.name }))} /><Button icon={<RefreshCw size={15} />} loading={result.loading} onClick={reload}>{text('刷新任务', 'Refresh jobs')}</Button></Space>
    <IngestionError error={result.error} />
    <LedgerTable<Job> ledgerId="console-ingestion-jobs" organizationId={scope.organizationId} requiredColumnKeys={['identity', 'actions']} rowKey="id" loading={result.loading} dataSource={result.data?.items ?? []} columns={columns} scroll={{ x: 1080 }} pagination={{ current: page, pageSize, total: result.data?.total ?? 0, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], onChange: (next, size) => { setPage(size === pageSize ? next : 1); setPageSize(size); } }} />
    {detail && <JobDetail scope={scope} initial={detail} endpointName={endpoints.find(endpoint => endpoint.id === detail.endpointId)?.name ?? text('接口不可用', 'Interface unavailable')} close={() => setDetail(undefined)} changed={reload} canReceipts={canReceipts} />}
  </div>;
}
function JobCounts({ job }: { job: Job }) {
  const text = useIngestionText();
  return <div className="qms-ingestion-counts">{job.expansionComplete === false && job.status !== 'CANCELLED' && job.status !== 'COMPLETED' && <span>{text('准备中', 'Preparing')}</span>}{job.planningPreviewId && <span>{text('接收准备进度', 'Receiving preparation')} {job.planned}/{job.receiptCount}</span>}<span>{text('总数', 'Total')} {job.total ?? text('后台统计', 'Counting in background')}</span><span>{text('待处理', 'Pending')} {job.pending}</span><span>{text('成功', 'Succeeded')} {job.succeeded}</span><span>{text('跳过', 'Skipped')} {job.skipped}</span><span>{text('失败', 'Failed')} {job.failed}</span><span>{text('待确认', 'To confirm')} {job.awaitingConfirmation}</span></div>;
}
function JobDetail({ scope, initial, endpointName, close, changed, canReceipts }: { scope: IntegrationScope; initial: Job; endpointName: string; close: () => void; changed: () => void; canReceipts: boolean }) {
  const text = useIngestionText(); const english = text('zh', 'en') === 'en'; const requestLeave = useNavigationGuard();
  const [job, setJob] = useState<Job>(); const [jobError, setJobError] = useState<unknown>(); const [jobLoading, setJobLoading] = useState(true);
  const [pageSize, setPageSize] = useLedgerPageSize('console-ingestion-items', scope.organizationId); const [page, setPage] = useState(1); const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Item>(); const [control, setControl] = useState<components['schemas']['IngestionControlDto']['action']>();
  const { read, current } = useScopedIntegrationRequests(scope);
  const result = useIngestionPage<components['schemas']['IngestionItemPageDto']>(scope, `${ingestionPath}/jobs/${initial.id}/items`, page, pageSize, revision);
  const canRun = scope.permissions.includes('ingestion:run');
  const parent = initial.parentJobId === null && !!initial.planningPreviewId;
  useEffect(() => {
    let active = true; setJob(undefined); setJobLoading(true); setJobError(undefined);
    void read<Job>(`${ingestionPath}/jobs/${initial.id}`).then(value => {
      if (!active || !current()) return;
      if (value.id !== initial.id || value.endpointId !== initial.endpointId) { scope.deny(); return; } setJob(value);
    }).catch(cause => { if (active && current() && !isAborted(cause)) setJobError(cause); }).finally(() => { if (active && current()) setJobLoading(false); });
    return () => { active = false; };
  }, [read, current, scope.deny, initial.id, initial.endpointId, revision]);
  useEffect(() => { if (!parent && result.data?.items.some(item => item.jobId !== initial.id)) scope.deny(); }, [result.data, scope.deny, initial.id, parent]);
  const reload = () => { setRevision(value => value + 1); changed(); };
  const available = (action: components['schemas']['IngestionControlDto']['action']) => !!job && (action === 'PAUSE' ? job.status === 'PENDING' : action === 'RESUME' ? job.status === 'PAUSED' : action === 'RETRY' ? (job.failed > 0 || job.status === 'BLOCKED') && job.status !== 'CANCELLED' : job.status !== 'CANCELLED' && (job.expansionComplete === false && job.status !== 'COMPLETED' || job.pending > 0 || job.failed > 0 || job.awaitingConfirmation > 0));
  const columns: TableProps<Item>['columns'] = [
    { key: 'row', title: text('数组行号', 'Array row'), width: 100, render: (_, item) => item.rowIndex + 1 },
    { key: 'status', title: text('处理结果', 'Result'), width: 160, render: (_, item) => <>{label(item.status, english)}{item.duplicateOfItemId && <small>{text('已关联既有待确认项', 'Linked to an existing confirmation')}</small>}</> },
    { key: 'error', title: text('错误原因', 'Error'), width: 280, render: (_, item) => item.errorCode || item.errorField ? <>{item.errorCode ? ingestionIssue(item.errorCode, english) : '—'}{item.errorField && <small>{text('字段', 'Field')}: <code>{item.errorField}</code></small>}</> : '—' },
    { key: 'version', title: text('版本', 'Version'), width: 80, dataIndex: 'version' },
    { key: 'actions', title: text('操作', 'Actions'), width: 100, render: (_, item) => <Button size="small" disabled={!canReceipts} title={!canReceipts ? text('需要接收正文查看权限', 'Receiving payload permission is required') : undefined} onClick={() => { if (canReceipts) setSelected(item); }}>{text('查看差异', 'View differences')}</Button> },
  ];
  return <Modal open title={`${endpointName} · #${initial.sequence}`} width={1040} footer={null} destroyOnHidden mask={{ closable: false }} onCancel={() => requestLeave(close, true)}>
    <div className="qms-ingestion-section">
      <Space wrap><Button icon={<RefreshCw size={15} />} loading={jobLoading || result.loading} disabled={!!control || !!selected} onClick={reload}>{text('刷新详情', 'Refresh details')}</Button>{job && <Tag>{label(job.status, english)}</Tag>}{canRun && (['PAUSE', 'RESUME', 'CANCEL', 'RETRY'] as const).map(action => <Button key={action} danger={action === 'CANCEL'} disabled={!available(action) || !!control || !!selected} onClick={() => setControl(action)}>{label(action, english)}</Button>)}</Space>
      <IngestionError error={jobError} />{job && <><JobCounts job={job} /><Descriptions size="small" column={1} items={[{ key: 'source', label: text('来源', 'Source'), children: label(job.source, english) }, { key: 'receipt', label: text('接收编号', 'Receiving ID'), children: parent ? text('历史接收集合', 'Historical receiving snapshot') : job.receiptId ?? text('接收记录已清理', 'Receiving record removed') }, { key: 'version', label: text('规则版本', 'Rule version'), children: job.ruleVersion }]} />{job.errorCode && <Alert type="error" showIcon title={text('任务处理异常', 'Job processing error')} description={ingestionIssue(job.errorCode, english)} />}</>}
      <IngestionError error={result.error} />
      <LedgerTable<Item> ledgerId="console-ingestion-items" organizationId={scope.organizationId} requiredColumnKeys={['row', 'actions']} rowKey="id" loading={result.loading} dataSource={result.data?.items.filter(item => parent || item.jobId === initial.id) ?? []} columns={columns} scroll={{ x: 720 }} pagination={{ current: page, pageSize, total: result.data?.total ?? 0, disabled: !!control || !!selected, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], onChange: (next, size) => { setPage(size === pageSize ? next : 1); setPageSize(size); } }} />
      <Button onClick={() => requestLeave(close, true)}>{text('关闭', 'Close')}</Button>
    </div>
    {control && job && <JobControl scope={scope} job={job} action={control} close={() => setControl(undefined)} saved={() => { setControl(undefined); reload(); }} />}
    {selected && canReceipts && <ItemDetail scope={scope} item={selected} canRun={canRun} close={() => setSelected(undefined)} saved={() => { setSelected(undefined); reload(); }} />}
  </Modal>;
}
function JobControl({ scope, job, action, close, saved }: { scope: IntegrationScope; job: Job; action: components['schemas']['IngestionControlDto']['action']; close: () => void; saved: () => void }) {
  const text = useIngestionText(); const english = text('zh', 'en') === 'en'; const mutation = useIngestionMutation(scope); const requestLeave = useNavigationGuard(); const [dirty, setDirty] = useState(false); useUnsavedChanges(dirty);
  function submit(values: { reason: string }) { if (mutation.locked) return; const body: components['schemas']['IngestionControlDto'] = { organizationId: scope.organizationId, action, reason: values.reason.trim() }; void mutation.execute<Job>({ path: `${ingestionPath}/jobs/${job.id}/control`, method: 'POST', body }, () => { setDirty(false); saved(); }); }
  return <Modal open title={label(action, english)} width={520} footer={null} mask={{ closable: false }} closable={!mutation.locked} keyboard={!mutation.locked} onCancel={() => { if (!mutation.locked) requestLeave(close, true); }}>
    {action === 'CANCEL' && <Alert type="warning" showIcon title={text('取消将停止后续接收准备与未完成条目，已入库资料不会回滚', 'Cancellation stops further receiving preparation and unfinished items; imported records are not rolled back')} />}
    {action === 'PAUSE' && <Alert type="info" title={text('暂停阻止后续处理，当前事务可能已完成', 'Pause stops subsequent processing; the current transaction may complete')} />}
    <Form layout="vertical" className="qms-ingestion-form qms-ingestion-actions" disabled={mutation.locked} onValuesChange={() => setDirty(true)} onFinish={submit}>
      <Form.Item name="reason" label={text('操作原因', 'Reason')} rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={300} autoSize={{ minRows: 2, maxRows: 4 }} /></Form.Item>
      <IngestionError error={mutation.error} unknown={mutation.unknown} />
      <Space className="qms-ingestion-actions"><Button disabled={mutation.locked} onClick={() => requestLeave(close, true)}>{text('返回', 'Back')}</Button>{mutation.unknown ? <Button type="primary" disabled={mutation.busy} loading={mutation.busy} onClick={mutation.retry}>{text('重试原请求', 'Retry original request')}</Button> : <Button htmlType="submit" type="primary" danger={action === 'CANCEL'} loading={mutation.busy}>{text('确认操作', 'Confirm action')}</Button>}</Space>
    </Form>
  </Modal>;
}
function ItemDetail({ scope, item, canRun, close, saved }: { scope: IntegrationScope; item: Item; canRun: boolean; close: () => void; saved: () => void }) {
  const text = useIngestionText(); const english = text('zh', 'en') === 'en'; const requestLeave = useNavigationGuard();
  const { read, current } = useScopedIntegrationRequests(scope); const mutation = useIngestionMutation(scope);
  const [detail, setDetail] = useState<components['schemas']['IngestionItemDetailDto']>(); const [error, setError] = useState<unknown>(); const [loading, setLoading] = useState(true); const [revision, setRevision] = useState(0); const [dirty, setDirty] = useState(false);
  const [form] = Form.useForm<{ reason: string }>(); useUnsavedChanges(dirty);
  useEffect(() => {
    let active = true; setDetail(undefined); setError(undefined); setLoading(true);
    void read<components['schemas']['IngestionItemDetailDto']>(`${ingestionPath}/items/${item.id}`).then(value => {
      if (!active || !current()) return;
      if (value.id !== item.id || value.jobId !== item.jobId || value.receiptId !== item.receiptId || value.rowIndex !== item.rowIndex) { scope.deny(); return; } setDetail(value);
    }).catch(cause => { if (active && current() && !isAborted(cause)) setError(cause); }).finally(() => { if (active && current()) setLoading(false); });
    return () => { active = false; };
  }, [read, current, scope.deny, item.id, item.jobId, item.receiptId, item.rowIndex, revision]);
  async function act(confirm: boolean) {
    if (!detail || mutation.locked || !canRun || confirm && (detail.stale || detail.status !== 'AWAITING_CONFIRMATION')) return;
    let values: { reason: string }; try { values = await form.validateFields(); } catch { return; }
    const body: components['schemas']['IngestionItemActionDto'] = { organizationId: scope.organizationId, expectedVersion: detail.version, reason: values.reason.trim() };
    void mutation.execute<Item>({ path: `${ingestionPath}/items/${detail.id}/${confirm ? 'confirm' : 'skip'}`, method: 'POST', body }, () => { setDirty(false); saved(); });
  }
  const actionable = !!detail && ['PENDING', 'AWAITING_CONFIRMATION', 'VALIDATION_FAILED', 'PROCESSING_FAILED'].includes(detail.status);
  return <Modal open title={text(`数组第${item.rowIndex + 1}行`, `Array row ${item.rowIndex + 1}`)} width={700} footer={null} mask={{ closable: false }} closable={!mutation.locked} keyboard={!mutation.locked} onCancel={() => { if (!mutation.locked) requestLeave(close, true); }}>
    <div className="qms-ingestion-section">
      <Space><Button icon={<RefreshCw size={15} />} loading={loading} disabled={mutation.locked} onClick={() => setRevision(value => value + 1)}>{text('刷新差异', 'Refresh differences')}</Button>{detail && <Tag>{label(detail.status, english)}</Tag>}</Space>
      <IngestionError error={error} />
      {detail && <>{detail.stale && <Alert type="warning" showIcon title={text('当前档案已变化，旧差异不可确认覆盖', 'The current record changed; these differences cannot overwrite it')} />}{detail.errorCode && <Alert type="warning" title={text('条目处理异常', 'Item processing error')} description={<>{ingestionIssue(detail.errorCode, english)}{detail.errorField && <div className="qms-ingestion-secondary">{text('字段', 'Field')}: <code>{detail.errorField}</code></div>}</>} />}{detail.duplicateOfItemId && <Alert type="info" showIcon title={text('已关联既有待确认项', 'Linked to an existing confirmation')} description={<>{text('关联条目编号', 'Linked item ID')}: <code>{detail.duplicateOfItemId}</code></>} />}<IngestionFields fields={detail.fields} differences={detail.differences} /></>}
      {canRun && actionable && <Form form={form} layout="vertical" className="qms-ingestion-form" disabled={mutation.locked} onValuesChange={() => setDirty(true)}>
        <Form.Item name="reason" label={text('确认 / 跳过原因', 'Confirmation / skip reason')} rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={300} autoSize={{ minRows: 2, maxRows: 4 }} /></Form.Item>
        {!mutation.unknown && <Space wrap><Button type="primary" loading={mutation.busy} disabled={mutation.locked || detail?.stale || detail?.status !== 'AWAITING_CONFIRMATION'} onClick={() => void act(true)}>{text('确认更新', 'Confirm update')}</Button><Button danger disabled={mutation.locked} onClick={() => void act(false)}>{text('跳过此项', 'Skip item')}</Button></Space>}
      </Form>}
      <IngestionError error={mutation.error} unknown={mutation.unknown} />
      {mutation.unknown && <Button type="primary" loading={mutation.busy} onClick={mutation.retry}>{text('重试原请求', 'Retry original request')}</Button>}
      <Button disabled={mutation.locked} onClick={() => requestLeave(close, true)}>{text('关闭', 'Close')}</Button>
    </div>
  </Modal>;
}
