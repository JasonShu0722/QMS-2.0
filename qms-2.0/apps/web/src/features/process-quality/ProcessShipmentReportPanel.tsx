import type { components } from '@qms/contracts';
import { Alert, Button, Checkbox, Descriptions, Drawer, Empty, Form, Input, List, Select, Space, Spin, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { LedgerTable, useLedgerPageSize } from '../../ui/ledger';

type Report = components['schemas']['ProcessShipmentReportDto'];
type ReportPage = components['schemas']['ProcessShipmentReportPageDto'];
type Batch = components['schemas']['ProcessProductionDto'];
type BatchPage = components['schemas']['ProcessProductionPageDto'];
type Customer = components['schemas']['CustomerMasterDto'];
type Permissions = components['schemas']['PermissionsResponseDto'];
type CreateReport = components['schemas']['CreateProcessShipmentReportDto'];
const base = '/api/v1/process-quality/shipment-reports';

function message(cause: unknown, fallback: string) { return cause instanceof ApiError ? safeAccountError(cause) : fallback; }
function denied(cause: unknown) { return cause instanceof ApiError && [401, 403].includes(cause.status ?? 0); }

export function ProcessShipmentReportPanel() {
  const organizationId = useWorkTabsStore(state => state.sessionScope?.split(':')[1]);
  const [pageSize, setPageSize] = useLedgerPageSize('process-shipment-reports', organizationId);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [reports, setReports] = useState<Report[]>([]);
  const [permissions, setPermissions] = useState<Permissions>();
  const [selectedId, setSelectedId] = useState<string>();
  const [report, setReport] = useState<Report>();
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [detailError, setDetailError] = useState<unknown>();
  const [revision, setRevision] = useState(0);
  const canWrite = !!permissions?.permissions?.includes('process-quality:defects:write');
  const canReadCustomers = !!permissions?.permissions?.includes('customer-quality:complaints:read');
  const refresh = () => setRevision((value) => value + 1);
  const requestLeave = useNavigationGuard();
  const refreshFromUser = () => requestLeave(() => { setReport(undefined); refresh(); });

  useEffect(() => {
    let active = true;
    setLoading(true); setError(undefined);
    void Promise.all([apiRequest<ReportPage>(`${base}?page=${page}&pageSize=${pageSize}`), apiRequest<Permissions>('/api/v1/system/my-permissions')]).then(([result, access]) => {
      if (active) { setReports(result.items); setTotal(result.total); setPermissions(access); }
    }).catch((cause) => { if (active) { setReports([]); if (denied(cause)) { setReport(undefined); setPermissions(undefined); } setError(cause); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision, page, pageSize]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setDetailLoading(true); setDetailError(undefined);
    void apiRequest<Report>(`${base}/${selectedId}`).then((value) => { if (active) setReport(value); }).catch((cause) => {
      if (active) { setDetailError(cause); if (denied(cause)) { setReport(undefined); setReports([]); setPermissions(undefined); } }
    }).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId, revision]);

  return <section className="process-quality-card" aria-label="出货报告台账">
    <Space className="process-quality-toolbar" wrap><Button onClick={selectedId ? refreshFromUser : refresh} loading={loading}>刷新报告</Button>{canWrite ? <CreateReportDrawer created={refresh} /> : null}</Space>
    {error ? <Alert type={denied(error) ? 'warning' : 'error'} showIcon title={denied(error) ? '暂无出货报告访问权限' : message(error, '出货报告加载失败')} action={!denied(error) ? <Button onClick={refresh}>重试</Button> : undefined} /> : loading ? <Spin /> : <LedgerTable<Report> ledgerId="process-shipment-reports" organizationId={organizationId} viewId="ALL" requiredColumnKeys={['reportNumber', 'actions']} rowKey="id" dataSource={reports} pagination={{ current: page, pageSize, total, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], onChange: (next, size) => requestLeave(() => { setPage(size === pageSize ? next : 1); setPageSize(size); }) }} scroll={{ x: 700 }} locale={{ emptyText: <Empty description="暂无出货报告" /> }} columns={[
      { title: '报告编号', key: 'reportNumber', width: 160, dataIndex: 'reportNumber' }, { title: '产品', key: 'productCode', width: 150, dataIndex: 'productCode', render: (value: string | null) => value ?? '全部' },
      { title: '批次数', key: 'batchCount', width: 90, dataIndex: 'batchCount' }, { title: '良率', key: 'yieldRate', width: 100, dataIndex: 'yieldRate', render: (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)}%` },
      { title: '状态', key: 'status', width: 100, dataIndex: 'status', render: (value: string) => <Tag>{value === 'ARCHIVED' ? '已归档' : '草稿'}</Tag> },
      { title: '操作', key: 'actions', width: 150, render: (_, item) => <Button type="link" aria-label={`查看出货报告 ${item.reportNumber}`} onClick={() => requestLeave(() => { setReport(undefined); setSelectedId(item.id); if (item.id === selectedId) refresh(); })}>查看与关联</Button> },
    ]} />}
    <Drawer title={report?.reportNumber ?? '出货报告详情'} open={!!selectedId} onClose={() => requestLeave(() => { setSelectedId(undefined); setReport(undefined); }, true)} width="min(760px, 100vw)" destroyOnHidden>
      {detailError ? <Alert type={denied(detailError) ? 'warning' : 'error'} showIcon title={denied(detailError) ? '暂无出货报告访问权限' : message(detailError, '详情加载失败')} action={!denied(detailError) ? <Button onClick={refreshFromUser}>重试</Button> : undefined} /> : null}
      {detailLoading && !report ? <Spin /> : report ? <ReportDetail key={report.id} report={report} canWrite={canWrite} canReadCustomers={canReadCustomers} changed={refresh} /> : null}
    </Drawer>
  </section>;
}

function CreateReportDrawer({ created }: { created: () => void }) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<CreateReport>();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef<{ signature: string; key: string } | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(dirty);
  useNavigationBusy(busy || searching);
  function close() {
    if (busy || searching) return;
    requestLeave(() => { setOpen(false); form.resetFields(); setBatches([]); setDirty(false); pending.current = undefined; }, true);
  }
  async function findBatches() {
    const start = form.getFieldValue('periodStart') as string;
    const end = form.getFieldValue('periodEnd') as string;
    if (!start || !end) { setError('请先填写统计起止日期'); return; }
    setSearching(true); setError(undefined);
    try { const query = new URLSearchParams({ periodStart: new Date(start).toISOString(), periodEnd: new Date(end).toISOString(), page: '1', pageSize: '100' }); const result = await apiRequest<BatchPage>(`/api/v1/process-quality/production-batches?${query}`); setBatches(result.items); }
    catch (cause) { setBatches([]); setError(message(cause, '生产批次加载失败')); }
    finally { setSearching(false); }
  }
  async function create(values: CreateReport) {
    if (busy || searching) return;
    const body = { ...values, periodStart: new Date(values.periodStart).toISOString(), periodEnd: new Date(values.periodEnd).toISOString() };
    const signature = JSON.stringify(body);
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    setBusy(true); setError(undefined);
    try { await apiRequest(base, { method: 'POST', headers: { 'x-csrf-token': await csrfToken(), 'Idempotency-Key': pending.current.key }, body: signature }); pending.current = undefined; form.resetFields(); setDirty(false); setBatches([]); setOpen(false); created(); }
    catch (cause) { setError(message(cause, '创建出货报告失败')); }
    finally { setBusy(false); }
  }
  return <><Button type="primary" onClick={() => setOpen(true)}>新建出货报告</Button><Drawer title="新建出货报告" open={open} onClose={close} closable={!busy && !searching} keyboard={!busy && !searching} mask={{ closable: !busy && !searching }} width="min(560px, 100vw)" destroyOnHidden={false}>
    <Form<CreateReport> form={form} layout="vertical" disabled={busy || searching} onValuesChange={() => setDirty(true)} onFinish={(values) => void create(values)}>
      <Form.Item name="reportNumber" label="报告编号"><Input maxLength={100} /></Form.Item>
      <Form.Item name="periodStart" label="统计开始" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item>
      <Form.Item name="periodEnd" label="统计结束" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item>
      <Form.Item name="productCode" label="产品编码"><Input maxLength={100} /></Form.Item>
      <Button onClick={() => void findBatches()} loading={searching}>查找生产批次</Button>
      <Form.Item name="batchIds" label="纳入批次" rules={[{ required: true, message: '请选择至少一个生产批次' }]}><Checkbox.Group options={batches.map((batch) => ({ value: batch.id, label: `${batch.batchCode} · ${batch.productCode} · ${batch.totalQuantity}` }))} /></Form.Item>
      {batches.length === 0 && !searching ? <Empty description="尚未找到批次" /> : null}
      {error ? <Alert type="error" showIcon title={error} /> : null}
      <div className="qms-dialog-actions" role="group" aria-label="新建出货报告"><Button type="primary" htmlType="submit" loading={busy}>创建报告</Button></div>
    </Form>
  </Drawer></>;
}

function ReportDetail({ report, canWrite, canReadCustomers, changed }: { report: Report; canWrite: boolean; canReadCustomers: boolean; changed: () => void }) {
  const [fileIds, setFileIds] = useState(report.evidence.map((item) => item.fileId));
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>();
  const [problemId, setProblemId] = useState('');
  const [problemVersion, setProblemVersion] = useState<number>(1);
  const [savedFileIds, setSavedFileIds] = useState(report.evidence.map((item) => item.fileId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const pending = useRef<{ signature: string; key: string } | undefined>(undefined);
  const editable = canWrite && report.status === 'DRAFT';
  const boundIds = report.evidence.map((item) => item.fileId);
  const previousBoundIds = useRef(boundIds);
  const requestLeave = useNavigationGuard();
  const evidenceDirty = fileIds.join('|') !== savedFileIds.join('|');
  useUnsavedChanges(evidenceDirty || Boolean(customerId) || Boolean(problemId) || problemVersion !== 1);
  useNavigationBusy(busy);
  useEffect(() => {
    const next = report.evidence.map((item) => item.fileId);
    const previous = previousBoundIds.current;
    setFileIds((current) => current.join('|') === previous.join('|') ? next : current);
    setSavedFileIds(next);
    previousBoundIds.current = next;
  }, [report.evidence]);
  useEffect(() => { if (!canReadCustomers) return; let active = true; void apiRequest<Customer[]>('/api/v1/customer-quality/customers').then((items) => { if (active) setCustomers(items.filter((item) => item.active)); }).catch(() => { if (active) setCustomers([]); }); return () => { active = false; }; }, [canReadCustomers]);
  async function write(path: string, method: 'PUT' | 'POST', body: object) {
    if (busy) return;
    const signature = JSON.stringify({ path, method, body });
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    setBusy(true); setError(undefined);
    try { await apiRequest(`${base}/${report.id}${path}`, { method, headers: { 'x-csrf-token': await csrfToken(), 'Idempotency-Key': pending.current.key }, body: JSON.stringify(body) }); pending.current = undefined; if (path === '/evidence') setSavedFileIds(fileIds); if (path === '/customer') setCustomerId(undefined); if (path === '/issues') { setProblemId(''); setProblemVersion(1); } changed(); }
    catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }
  return <Space orientation="vertical" size={6} className="process-quality-report-detail">
    <Descriptions bordered column={1} size="small" items={[
      { key: 'status', label: '状态', children: report.status === 'ARCHIVED' ? '已归档' : '草稿' },
      { key: 'period', label: '统计期间', children: `${new Date(report.periodStart).toLocaleString('zh-CN')} 至 ${new Date(report.periodEnd).toLocaleString('zh-CN')}` },
      { key: 'product', label: '产品', children: report.productCode ?? '全部' },
      { key: 'counts', label: '批次 / 良品 / 不良', children: `${report.batchCount} / ${report.goodQuantity} / ${report.defectQuantity}` },
      { key: 'version', label: '报告版本', children: report.version },
    ]} />
    {error ? <Alert type={denied(error) ? 'warning' : 'error'} showIcon title={error instanceof ApiError && error.status === 409 ? '版本已变化，请刷新后重试' : message(error, '操作失败，请重试')} action={<Button disabled={busy} onClick={() => requestLeave(() => { setFileIds(boundIds); setCustomerId(undefined); setProblemId(''); setProblemVersion(1); changed(); })}>刷新详情</Button>} /> : null}
    <Typography.Title level={4}>扫描文件版本</Typography.Title>
    <AttachmentPanel resource={{ resourceType: 'process-shipment-report', resourceId: report.id }} fileIds={fileIds} readOnly={!editable || busy} onReady={(file) => setFileIds((current) => [...new Set([...current, file.id])])} onRemoved={(id) => setFileIds((current) => current.filter((fileId) => fileId !== id))} />
    {editable ? <Button disabled={!fileIds.length || fileIds.join('|') === boundIds.join('|')} loading={busy} onClick={() => void write('/evidence', 'PUT', { expectedVersion: report.version, fileIds })}>绑定扫描文件</Button> : null}
    <List size="small" dataSource={report.evidence} locale={{ emptyText: '尚未绑定扫描文件' }} renderItem={(item) => <List.Item>文件 {item.fileId} · 第 {item.fileVersion} 版 · 扫描于 {new Date(item.scannedAt).toLocaleString('zh-CN')}</List.Item>} />
    <Typography.Title level={4}>客户关联</Typography.Title>
    <List size="small" dataSource={report.customers} locale={{ emptyText: '尚未关联客户' }} renderItem={(item) => <List.Item>{item.customerCode} · {item.customerName}（第 {item.customerVersion} 版）</List.Item>} />
    {editable && canReadCustomers ? <Space wrap><Select disabled={busy} aria-label="选择出货客户" className="process-quality-report-select" placeholder="选择客户" value={customerId} options={customers.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} onChange={setCustomerId} /><Button disabled={!customerId} loading={busy} onClick={() => void write('/customer', 'PUT', { expectedVersion: report.version, customerId })}>关联客户</Button></Space> : null}
    <Typography.Title level={4}>正式问题</Typography.Title>
    <List size="small" dataSource={report.issues} locale={{ emptyText: '尚未关联正式问题' }} renderItem={(item) => <List.Item><Link to={`/app/problem-workspace/${item.id}`}>{item.reportNumber}</Link> · {item.status} · 第 {item.version} 版</List.Item>} />
    {editable ? <Space wrap><Input disabled={busy} aria-label="正式问题 ID" placeholder="正式问题 ID" value={problemId} onChange={(event) => setProblemId(event.target.value)} /><Input disabled={busy} aria-label="正式问题版本" type="number" min={1} className="process-quality-report-version" value={problemVersion} onChange={(event) => setProblemVersion(Number(event.target.value))} /><Button disabled={!problemId || problemVersion < 1} loading={busy} onClick={() => void write('/issues', 'POST', { problemId, expectedVersion: report.version, expectedProblemVersion: problemVersion })}>关联正式问题</Button></Space> : null}
    {editable ? <Button danger loading={busy} aria-label="归档出货报告" onClick={() => void write('/archive', 'PUT', { expectedVersion: report.version })}>归档出货报告</Button> : null}
  </Space>;
}
