import type { components } from '@qms/contracts';
import { Alert, Button, Empty, Form, Input, InputNumber, Modal, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import './coordinate-inspection.css';

type CreateInput = components['schemas']['CreateCoordinateInspectionDto'];
type RequestRow = components['schemas']['CoordinateInspectionRequestDto'];
type RequestPage = components['schemas']['CoordinateInspectionPageDto'];
const basePath = '/api/v1/coordinate-inspection/requests';
const statusLabels: Record<string, string> = { DRAFT: '草稿', SUBMITTED: '待审批', APPROVED: '已批准', REJECTED: '已驳回', SCHEDULED: '已排单', IN_PROGRESS: '进行中', COMPLETED: '已完成' };

async function mutate<T>(path: string, method: 'POST' | 'PUT', body: unknown) { const token = await csrfToken(); return apiRequest<T>(path, { method, headers: { 'x-csrf-token': token, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) }); }
function denied(error: unknown) { return error instanceof ApiError && (error.status === 403 || error.code === 'FEATURE_PERMISSION_DENIED' || error.code === 'ORGANIZATION_SCOPE_DENIED'); }

export function CoordinateInspectionPage() {
  const [rows, setRows] = useState<RequestRow[]>([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1); const [loading, setLoading] = useState(true); const [error, setError] = useState<unknown>(); const [revision, setRevision] = useState(0); const [createOpen, setCreateOpen] = useState(false); const [selected, setSelected] = useState<RequestRow | null>(null);
  useEffect(() => { let active = true; apiRequest<RequestPage>(`${basePath}?page=${page}&pageSize=20`).then((result) => { if (active) { setRows(result.items); setTotal(result.total); setError(undefined); } }).catch((cause) => { if (active) { setRows([]); setTotal(0); setError(cause); } }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [page, revision]);
  function refresh() { setLoading(true); setRevision((value) => value + 1); }
  return <section className="coordinate-inspection-page"><header className="coordinate-inspection-heading"><h1 className="sr-only">三坐标检测</h1><Space><Button onClick={refresh} loading={loading}>刷新</Button><Button type="primary" onClick={() => setCreateOpen(true)}>新建申请</Button></Space></header>
    {error ? <Alert type={denied(error) ? 'warning' : 'error'} showIcon title={denied(error) ? '暂无三坐标检测权限' : error instanceof ApiError ? safeAccountError(error) : '检测申请加载失败，请重试。'} description={error instanceof ApiError ? error.traceId : undefined} /> : null}
    <section className="coordinate-inspection-card">{loading ? <div className="coordinate-inspection-loading"><Spin /></div> : error ? null : <Table<RequestRow> rowKey="id" dataSource={rows} scroll={{ x: 900 }} locale={{ emptyText: <Empty description="暂无三坐标检测申请" /> }} pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: (nextPage) => { setLoading(true); setPage(nextPage); } }} columns={[{ title: '申请编号', dataIndex: 'requestNumber', render: (value: string, row) => <Button type="link" onClick={() => setSelected(row)}>{value}</Button> }, { title: '零件', key: 'part', render: (_: unknown, row) => `${row.partNumber} / ${row.partName}` }, { title: '批次', dataIndex: 'batchNumber', render: (value?: string | null) => value || '—' }, { title: '优先级', dataIndex: 'priority' }, { title: '状态', dataIndex: 'status', render: (value: string) => <Tag color={value === 'COMPLETED' ? 'green' : value === 'REJECTED' ? 'red' : 'blue'}>{statusLabels[value] ?? value}</Tag> }, { title: '进度', render: (_: unknown, row) => `${row.progressPercent}%` }, { title: '更新时间', dataIndex: 'updatedAt', render: (value: string) => new Date(value).toLocaleString('zh-CN') }]} />}</section>
    {createOpen ? <CreateRequestModal close={() => setCreateOpen(false)} saved={() => { setCreateOpen(false); refresh(); }} /> : null}
    {selected ? <RequestActionModal request={selected} close={() => setSelected(null)} saved={() => { setSelected(null); refresh(); }} /> : null}
  </section>;
}

function CreateRequestModal({ close: discard, saved }: { close: () => void; saved: () => void }) {
  const [form] = Form.useForm<CreateInput>(); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>();

  const [dirty, setDirty] = useState(false);
  const pending = useRef(false);
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(dirty);
  useNavigationBusy(busy);
  function close() { if (!pending.current) requestLeave(discard, true); }
  async function submit(values: CreateInput) { if (pending.current) return; pending.current = true; setBusy(true); setError(undefined); try { await mutate<RequestRow>(basePath, 'POST', values); form.resetFields(); setDirty(false); saved(); } catch (cause) { setError(cause); } finally { pending.current = false; setBusy(false); } }
  return <Modal open title="新建三坐标检测申请" footer={null} onCancel={close} closable={!busy} mask={{ closable: false }}>{error ? <Alert type={denied(error) ? 'warning' : 'error'} showIcon title={error instanceof ApiError ? safeAccountError(error) : '申请保存失败，请重试。'} /> : null}<Form form={form} layout="vertical" onValuesChange={() => setDirty(true)} onFinish={submit} disabled={busy} initialValues={{ priority: 'NORMAL', purpose: 'PROCESS' }}><div className="coordinate-inspection-form-grid"><Form.Item name="partNumber" label="零件号" rules={[{ required: true, message: '请输入零件号' }]}><Input maxLength={120} /></Form.Item><Form.Item name="partName" label="零件名称" rules={[{ required: true, message: '请输入零件名称' }]}><Input maxLength={240} /></Form.Item><Form.Item name="drawingRevision" label="图纸版本"><Input maxLength={80} /></Form.Item><Form.Item name="batchNumber" label="批次号"><Input maxLength={160} /></Form.Item><Form.Item name="sampleQuantity" label="样品数量" rules={[{ required: true, type: 'number', min: 1 }]}><InputNumber min={1} precision={0} style={{ width: '100%' }} /></Form.Item><Form.Item name="purpose" label="检测目的" rules={[{ required: true }]}><Select options={[{ value: 'INCOMING', label: '来料' }, { value: 'PROCESS', label: '制程' }, { value: 'CUSTOMER', label: '客户' }, { value: 'NEW_PRODUCT', label: '新品' }, { value: 'OTHER', label: '其他' }]} /></Form.Item></div><Form.Item name="priority" label="优先级"><Select options={[{ value: 'LOW', label: '低' }, { value: 'NORMAL', label: '普通' }, { value: 'HIGH', label: '高' }, { value: 'URGENT', label: '紧急' }]} /></Form.Item><div className="qms-dialog-actions" role="group" aria-label="新建三坐标检测申请"><Button onClick={close}>取消</Button><Button type="primary" htmlType="submit" loading={busy}>保存申请</Button></div></Form></Modal>;
}

type ActionInput = { note?: string; scheduledAt?: string; assignedToId?: string; status?: 'IN_PROGRESS' | 'COMPLETED'; progressPercent?: number; partNumber?: string; partName?: string; sampleQuantity?: number; batchNumber?: string };

function RequestActionModal({ request, close: discard, saved }: { request: RequestRow; close: () => void; saved: () => void }) {
  const [form] = Form.useForm<ActionInput>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  const [dirty, setDirty] = useState(false);
  const pending = useRef(false);
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(dirty);
  useNavigationBusy(busy);
  function close() { if (!pending.current) requestLeave(discard, true); }
  const hasDraftChanges = (values: ActionInput) => values.partNumber !== request.partNumber || values.partName !== request.partName || (values.batchNumber ?? '') !== (request.batchNumber ?? '') || values.sampleQuantity !== request.sampleQuantity;
  const draftValues = Form.useWatch((values: ActionInput) => values, form);
  const draftChanged = draftValues !== undefined && hasDraftChanges(draftValues);
  async function act(action: 'revise' | 'submit' | 'approve' | 'reject' | 'schedule' | 'progress', values: ActionInput = {}) {
    if (pending.current || (action === 'submit' && hasDraftChanges(form.getFieldsValue()))) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const payload = action === 'revise' ? { expectedVersion: request.version, partNumber: values.partNumber, partName: values.partName, sampleQuantity: values.sampleQuantity, batchNumber: values.batchNumber }
        : action === 'submit' ? { expectedVersion: request.version }
        : action === 'approve' || action === 'reject' ? { expectedVersion: request.version, decision: action === 'approve' ? 'APPROVE' : 'REJECT', note: values.note }
          : action === 'schedule' ? { expectedVersion: request.version, scheduledAt: new Date(values.scheduledAt!).toISOString(), assignedToId: values.assignedToId }
            : { expectedVersion: request.version, status: values.status, progressPercent: values.progressPercent, note: values.note };
      await mutate(`${basePath}/${request.id}${action === 'revise' ? '' : `/${action === 'reject' ? 'approve' : action}`}`, 'PUT', payload);
      setDirty(false); saved();
    } catch (cause) { setError(cause); } finally { pending.current = false; setBusy(false); }
  }
  return <Modal open title={`检测申请 ${request.requestNumber}`} footer={null} onCancel={close} closable={!busy} mask={{ closable: false }}>
    <Typography.Paragraph>零件：{request.partNumber} / {request.partName}；状态：{statusLabels[request.status] ?? request.status}；进度：{request.progressPercent}%</Typography.Paragraph>
    {request.scheduledAt ? <Typography.Paragraph>排单时间：{new Date(request.scheduledAt).toLocaleString('zh-CN')}</Typography.Paragraph> : null}
    {request.approvalNote ? <Typography.Paragraph>审批意见：{request.approvalNote}</Typography.Paragraph> : null}

    {error ? <Alert type={denied(error) ? 'warning' : 'error'} showIcon title={error instanceof ApiError ? safeAccountError(error) : '操作失败，请重试。'} description={error instanceof ApiError && error.status === 409 ? '记录已变化，请关闭后刷新重试。' : undefined} /> : null}
    {request.status === 'DRAFT' || request.status === 'REJECTED' ? <Form form={form} layout="vertical" onValuesChange={() => setDirty(true)} initialValues={{ partNumber: request.partNumber, partName: request.partName, batchNumber: request.batchNumber, sampleQuantity: request.sampleQuantity }} onFinish={(values) => void act('revise', values)} disabled={busy}><div className="coordinate-inspection-form-grid"><Form.Item name="partNumber" label="零件号" rules={[{ required: true }]}><Input maxLength={120} /></Form.Item><Form.Item name="partName" label="零件名称" rules={[{ required: true }]}><Input maxLength={240} /></Form.Item><Form.Item name="batchNumber" label="批次号"><Input maxLength={160} /></Form.Item><Form.Item name="sampleQuantity" label="样品数量" rules={[{ required: true, type: 'number', min: 1 }]}><InputNumber min={1} precision={0} style={{ width: '100%' }} /></Form.Item></div><div className="qms-dialog-actions" role="group" aria-label={`检测申请 ${request.requestNumber}`}><Button htmlType="submit" loading={busy}>保存修改</Button>{request.status === 'DRAFT' ? <Button type="primary" loading={busy} disabled={busy || draftChanged} onClick={() => void act('submit')}>提交审批</Button> : null}</div></Form> : null}
    {request.status === 'SUBMITTED' ? <Form form={form} layout="vertical" onValuesChange={() => setDirty(true)} onFinish={(values) => void act('approve', values)} disabled={busy}><Form.Item name="note" label="审批意见"><Input.TextArea maxLength={2000} rows={3} /></Form.Item><div className="qms-dialog-actions" role="group" aria-label={`检测申请 ${request.requestNumber}`}><Button type="primary" htmlType="submit" loading={busy}>批准</Button><Button danger loading={busy} onClick={() => void act('reject', form.getFieldsValue())}>驳回</Button></div></Form> : null}
    {request.status === 'APPROVED' ? <Form form={form} layout="vertical" onValuesChange={() => setDirty(true)} onFinish={(values) => void act('schedule', values)} disabled={busy}><Form.Item name="scheduledAt" label="排单时间" rules={[{ required: true, message: '请输入排单时间' }]}><Input type="datetime-local" /></Form.Item><Form.Item name="assignedToId" label="检测负责人 ID" rules={[{ required: true, message: '请输入负责人 ID' }, { pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, message: '请输入有效 UUID' }]}><Input /></Form.Item><div className="qms-dialog-actions" role="group" aria-label={`检测申请 ${request.requestNumber}`}><Button type="primary" htmlType="submit" loading={busy}>确认排单</Button></div></Form> : null}
    {request.status === 'SCHEDULED' || request.status === 'IN_PROGRESS' ? <Form form={form} layout="vertical" onValuesChange={() => setDirty(true)} initialValues={{ status: 'IN_PROGRESS', progressPercent: request.progressPercent }} onFinish={(values) => void act('progress', values)} disabled={busy}><Form.Item name="status" label="进度状态" rules={[{ required: true }]}><Select options={[{ value: 'IN_PROGRESS', label: '进行中' }, { value: 'COMPLETED', label: '已完成' }]} /></Form.Item><Form.Item name="progressPercent" label="完成比例" rules={[{ required: true, type: 'number', min: 0, max: 100 }]}><InputNumber min={0} max={100} precision={0} style={{ width: '100%' }} /></Form.Item><Form.Item name="note" label="进度说明"><Input.TextArea maxLength={2000} rows={3} /></Form.Item><div className="qms-dialog-actions" role="group" aria-label={`检测申请 ${request.requestNumber}`}><Button type="primary" htmlType="submit" loading={busy}>更新进度</Button></div></Form> : null}
    {request.status === 'COMPLETED' ? <Typography.Text type="secondary">当前申请已完成。</Typography.Text> : null}
  </Modal>;
}
