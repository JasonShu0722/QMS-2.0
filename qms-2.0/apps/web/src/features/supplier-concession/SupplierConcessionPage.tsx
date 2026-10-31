import type { components } from '@qms/contracts';
import { Alert, Button, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal, Select, Space, Spin, Table, Tag, Timeline, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import './supplier-concession.css';

type Concession = components['schemas']['ConcessionRecordDto'];
type ConcessionDetail = components['schemas']['ConcessionDetailDto'];
type ConcessionPage = components['schemas']['ConcessionPageDto'];
type CreateConcession = components['schemas']['CreateConcessionDto'];
type DecideConcession = components['schemas']['DecideConcessionDto'];
type Action = 'submit' | 'approve' | 'reject' | 'release' | 'withdraw';

const basePath = '/api/v1/supplier-concessions';
const labels: Record<string, string> = { DRAFT: '草稿', SUBMITTED: '待审批', APPROVED: '已批准', REJECTED: '已驳回', RELEASED: '已登记放行', WITHDRAWN: '已撤回' };

function errorText(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) {
    if (cause.code === 'SUPPLIER_CONCESSION_EXPIRED') return '特采有效期已过，请重新申请';
    if (cause.code === 'SUPPLIER_CONCESSION_SOURCE_CHANGED') return 'IQC 检验结论或版本已变更，请重新核查';
    if (cause.code === 'SUPPLIER_CONCESSION_REQUIRES_NG') return '只有已完成且结论为 NG 的 IQC 检验可申请特采';
    if (cause.code === 'SUPPLIER_CONCESSION_QUANTITY_INVALID') return '申请数量须为正整数且不能超过来料数量';
    if (cause.code === 'CONCURRENCY_CONFLICT') return '记录已变化，请刷新后重试；已填写内容仍保留';
    if (cause.status === 403 || cause.code === 'FEATURE_PERMISSION_DENIED') return '当前账号无权执行此操作';
    return safeAccountError(cause);
  }
  return fallback;
}

function statusTag(status: string) {
  const color = status === 'RELEASED' ? 'green' : status === 'APPROVED' ? 'blue' : status === 'REJECTED' ? 'red' : 'gold';
  return <Tag color={color}>{labels[status] ?? status}</Tag>;
}

async function mutation<Result>(path: string, body: object, key: string) {
  const token = await csrfToken();
  return apiRequest<Result>(path, { method: 'POST', headers: { 'x-csrf-token': token, 'Idempotency-Key': key }, body: JSON.stringify(body) });
}

export function SupplierConcessionPage() {
  const [rows, setRows] = useState<Concession[]>([]);
  const [total, setTotal] = useState(0);
  const [canCreate, setCanCreate] = useState(false);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(undefined);
    const query = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (status) query.set('status', status);
    void apiRequest<ConcessionPage>(`${basePath}?${query}`).then((result) => {
      if (active) { setRows(result.items); setTotal(result.total); setCanCreate(result.canCreate); }
    }).catch((cause) => {
      if (active) { setRows([]); setCanCreate(false); setError(errorText(cause, '特采台账加载失败，请重试')); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, status, revision]);

  return <main className="supplier-concession-page">
    <header className="supplier-concession-heading"><h1 className="sr-only">特采申请与批次放行</h1><Space><Button onClick={() => setRevision((value) => value + 1)} loading={loading}>刷新</Button>{canCreate ? <Button type="primary" onClick={() => setCreateOpen(true)}>发起特采申请</Button> : null}</Space></header>
    <section className="supplier-concession-card" aria-label="特采申请台账">
      <div className="supplier-concession-toolbar"><Select aria-label="按状态筛选" allowClear placeholder="全部状态" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={Object.entries(labels).map(([value, label]) => ({ value, label }))} /><Typography.Text type="secondary">共 {total} 条</Typography.Text></div>
      {error ? <Alert type="error" showIcon title={error} action={<Button onClick={() => setRevision((value) => value + 1)}>重试</Button>} /> : null}
      {loading ? <div className="supplier-concession-loading"><Spin /></div> : !error ? <Table<Concession> rowKey="id" dataSource={rows} scroll={{ x: 980 }} locale={{ emptyText: <Empty description="暂无特采申请" /> }} pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: setPage }} columns={[
        { title: '供应商', dataIndex: 'supplierName', render: (value: string, row) => <Button type="link" onClick={() => setSelectedId(row.id)}>{value}</Button> },
        { title: '物料', dataIndex: 'materialCode' }, { title: '批次', dataIndex: 'incomingBatch' },
        { title: '申请 / 来料', key: 'quantity', render: (_value: unknown, row) => `${row.quantity} / ${row.receivedQuantity}` },
        { title: '状态', dataIndex: 'status', render: statusTag },
        { title: '有效期至', dataIndex: 'expiresAt', render: (value: string) => new Date(value).toLocaleString('zh-CN') },
      ]} /> : null}
    </section>
    {createOpen ? <CreateConcessionModal close={() => setCreateOpen(false)} saved={() => { setCreateOpen(false); setPage(1); setRevision((value) => value + 1); }} /> : null}
    {selectedId ? <ConcessionDrawer id={selectedId} close={() => setSelectedId(undefined)} changed={() => setRevision((value) => value + 1)} /> : null}
  </main>;
}

function CreateConcessionModal({ close, saved }: { close: () => void; saved: () => void }) {
  const [form] = Form.useForm<CreateConcession>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const key = useRef<string | undefined>(undefined);
  const pending = useRef(false);
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(dirty);
  useNavigationBusy(busy);

  function cancel() {
    if (busy || pending.current) return;
    requestLeave(() => { form.resetFields(); setDirty(false); setError(undefined); key.current = undefined; close(); }, true);
  }

  async function create(values: CreateConcession) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(undefined);
    try {
      key.current ??= crypto.randomUUID();
      const expiresAt = new Date(values.expiresAt);
      if (!Number.isFinite(expiresAt.getTime())) { setError('请填写有效期'); return; }
      await mutation<Concession>(basePath, { ...values, expiresAt: expiresAt.toISOString() }, key.current);
      key.current = undefined; setDirty(false); form.resetFields(); saved();
    } catch (cause) { setError(errorText(cause, '特采申请创建失败，请重试')); }
    finally { pending.current = false; setBusy(false); }
  }

  return <Modal open title="发起特采申请" footer={null} onCancel={cancel} closable={!busy} keyboard={!busy} mask={{ closable: false }}>

    {error ? <Alert type="error" showIcon title={error} /> : null}
    <Form form={form} layout="vertical" disabled={busy} onValuesChange={() => { setDirty(true); key.current = undefined; }} onFinish={(values) => void create(values)}>
      <Form.Item name="inspectionId" label="IQC 检验记录 ID" rules={[{ required: true, message: '请输入 IQC 检验记录 ID' }, { type: 'string', pattern: /^[0-9a-f-]{36}$/i, message: '请输入有效的 UUID' }]}><Input placeholder="已完成的 NG 检验 UUID" /></Form.Item>
      <div className="supplier-concession-form-grid"><Form.Item name="quantity" label="特采数量" rules={[{ required: true, type: 'number', min: 1, message: '请输入特采数量' }]}><InputNumber min={1} precision={0} /></Form.Item><Form.Item name="expiresAt" label="有效期至" rules={[{ required: true, message: '请选择有效期' }]}><Input type="datetime-local" /></Form.Item></div>
      <Form.Item name="reason" label="偏差及风险评估依据" rules={[{ required: true, whitespace: true, message: '请填写特采依据' }]}><Input.TextArea rows={4} maxLength={2000} showCount /></Form.Item>
      <Space><Button disabled={busy} onClick={cancel}>取消</Button><Button type="primary" htmlType="submit" loading={busy}>保存草稿</Button></Space>
    </Form>
  </Modal>;
}

function ConcessionDrawer({ id, close, changed }: { id: string; close: () => void; changed: () => void }) {
  const [record, setRecord] = useState<ConcessionDetail>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [action, setAction] = useState<Action>();
  const [note, setNote] = useState('');
  const [actionError, setActionError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const key = useRef<string | undefined>(undefined);
  const pending = useRef(false);
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(!!action && !!note.trim());
  useNavigationBusy(busy);
  function closeDrawer() {
    if (busy || pending.current) return;
    requestLeave(close, true);
  }
  function cancelAction() {
    if (busy || pending.current) return;
    requestLeave(() => { setAction(undefined); setNote(''); setActionError(undefined); key.current = undefined; }, true);
  }

  async function load() {
    setLoading(true); setError(undefined);
    try { setRecord(await apiRequest<ConcessionDetail>(`${basePath}/${id}`)); }
    catch (cause) { setRecord(undefined); setError(errorText(cause, '特采详情加载失败，请重试')); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [id]);

  async function run(target: Action, decisionNote?: string) {
    if (!record || pending.current) return;
    pending.current = true;
    setBusy(true); setActionError(undefined);
    try {
      key.current ??= crypto.randomUUID();
      const body: DecideConcession | { expectedVersion: number } = target === 'submit' || target === 'withdraw' ? { expectedVersion: record.version } : { expectedVersion: record.version, note: decisionNote ?? '' };
      await mutation<Concession>(`${basePath}/${id}/${target}`, body, key.current);
      key.current = undefined; setAction(undefined); setNote(''); await load(); changed();
    } catch (cause) { setActionError(errorText(cause, '操作失败，请重试')); }
    finally { pending.current = false; setBusy(false); }
  }

  const actions = record ? <Space wrap>{record.canSubmit ? <Button type="primary" disabled={busy} onClick={() => void run('submit')}>提交审批</Button> : null}{record.canApprove ? <><Button type="primary" disabled={busy} onClick={() => { setAction('approve'); setActionError(undefined); }}>批准</Button><Button danger disabled={busy} onClick={() => { setAction('reject'); setActionError(undefined); }}>驳回</Button></> : null}{record.canRelease ? <Button type="primary" disabled={busy} onClick={() => { setAction('release'); setActionError(undefined); }}>登记批次放行</Button> : null}{record.canWithdraw ? <Button disabled={busy} onClick={() => void run('withdraw')}>撤回申请</Button> : null}</Space> : null;

  return <Drawer open title="特采申请详情" width={680} onClose={closeDrawer} closable={!busy} keyboard={!busy} mask={{ closable: !busy }}>
    {loading ? <div className="supplier-concession-loading"><Spin /></div> : error ? <Alert type="error" showIcon title={error} action={<Button onClick={() => void load()}>重试</Button>} /> : record ? <div className="supplier-concession-detail">
      {actionError ? <Alert type="error" showIcon title={actionError} /> : null}
      <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small" items={[
        { key: 'status', label: '状态', children: statusTag(record.status) }, { key: 'supplier', label: '供应商', children: record.supplierName },
        { key: 'material', label: '物料编码', children: record.materialCode }, { key: 'batch', label: '来料批次', children: record.incomingBatch },
        { key: 'quantity', label: '特采 / 来料数量', children: `${record.quantity} / ${record.receivedQuantity}` }, { key: 'version', label: 'IQC 检验版本', children: record.inspectionVersion },
        { key: 'expiry', label: '有效期至', children: new Date(record.expiresAt).toLocaleString('zh-CN') }, { key: 'inspection', label: '检验记录 ID', children: record.inspectionId },
        { key: 'reason', label: '申请依据', children: record.reason, span: 2 },
        ...(record.decisionNote ? [{ key: 'decision', label: '审批意见', children: record.decisionNote, span: 2 }] : []),
        ...(record.releaseNote ? [{ key: 'release', label: '放行备注', children: record.releaseNote, span: 2 }] : []),
      ]} />
      {actions}
      <section><Typography.Title level={4}>操作轨迹</Typography.Title><Timeline items={record.events.map((event) => ({ children: <span>{labels[event.eventType] ?? event.eventType} · 第 {event.requestVersion} 版 · {new Date(event.createdAt).toLocaleString('zh-CN')}{event.note ? ` · ${event.note}` : ''}</span> }))} /></section>
    </div> : <Empty description="特采申请不存在或无权访问" />}
    <Modal open={!!action} title={action === 'approve' ? '批准特采申请' : action === 'reject' ? '驳回特采申请' : '登记批次放行'} onCancel={cancelAction} closable={!busy} keyboard={!busy} cancelButtonProps={{ disabled: busy }} onOk={() => { if (action && note.trim()) void run(action, note); }} okButtonProps={{ disabled: !note.trim(), loading: busy }} okText="确认" cancelText="取消" mask={{ closable: false }}>
      {actionError ? <Alert type="error" showIcon title={actionError} /> : null}
      <Input.TextArea aria-label="处理意见" disabled={busy} rows={4} maxLength={2000} showCount placeholder="请说明审批结论或批次放行依据" value={note} onChange={(event) => { setNote(event.target.value); key.current = undefined; }} />
    </Modal>
  </Drawer>;
}
