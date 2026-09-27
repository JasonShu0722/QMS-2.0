import type { components } from '@qms/contracts';
import { Alert, Button, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import type { Attachment } from '../attachments/attachments';
import './supplier-incoming.css';

type IncomingItem = components['schemas']['IncomingItemDto'];
type CreateInput = components['schemas']['CreateIncomingInspectionDto'];
type CompleteInput = components['schemas']['CompleteIncomingInspectionDto'];
type CorrectInput = components['schemas']['CorrectIncomingInspectionDto'];
type ProblemDraft = components['schemas']['SupplierProblemDraftDto'];
type InspectionStatus = 'DRAFT' | 'COMPLETED' | 'CORRECTED';
type Inspection = {
  id: string;
  organizationId: string;
  profileId: string;
  supplierOrganizationId: string;
  supplierBusinessCode: string;
  supplierName: string;
  materialCode: string;
  incomingBatch: string;
  receivedQuantity: number;
  sampledQuantity: number;
  conclusion: 'PASS' | 'NG' | null;
  status: InspectionStatus;
  inspectorId: string;
  inspectedAt: string | null;
  sourceSystem: 'MANUAL' | 'MES';
  externalRecordKey: string | null;
  externalBatchKey: string | null;
  observedAt: string | null;
  sourceSnapshot?: unknown;
  correctionReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  items?: Array<IncomingItem & { id?: string }>;
  photos?: Array<{ id: string; file_id?: string; fileId?: string; purpose?: string; note?: string; created_at?: string }>;
  problemLinks?: Array<{ id: string; problem_id?: string; problemId?: string; created_at?: string }>;
};
type InspectionPage = { items: Inspection[]; total: number; page: number; pageSize: number };
type MutationBody = CreateInput | CompleteInput | CorrectInput | { fileId: string; expectedVersion: number } | (ProblemDraft & { expectedVersion: number });

const basePath = '/api/v1/supplier-incoming/inspections';
const statusLabels: Record<InspectionStatus, string> = { DRAFT: '草稿', COMPLETED: '已完成', CORRECTED: '已更正' };

function isDenied(cause: unknown) {
  return cause instanceof ApiError && (cause.status === 403 || cause.code === 'FEATURE_PERMISSION_DENIED' || cause.code === 'ORGANIZATION_SCOPE_DENIED');
}

function statusTag(status: InspectionStatus) {
  return <Tag color={status === 'COMPLETED' ? 'green' : status === 'CORRECTED' ? 'blue' : 'gold'}>{statusLabels[status]}</Tag>;
}

async function mutate<T>(path: string, method: 'POST' | 'PUT', body: MutationBody) {
  const token = await csrfToken();
  return apiRequest<T>(path, { method, headers: { 'x-csrf-token': token, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });
}

function errorTitle(cause: unknown, fallback: string) {
  return isDenied(cause) ? '暂无 IQC 台账访问权限' : cause instanceof ApiError ? safeAccountError(cause) : fallback;
}

export function SupplierIncomingPage() {
  const [rows, setRows] = useState<Inspection[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<InspectionStatus>();
  const [materialCode, setMaterialCode] = useState('');
  const [queryMaterial, setQueryMaterial] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);

  async function load() {
    setLoading(true); setError(undefined);
    const query = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (status) query.set('status', status);
    if (queryMaterial.trim()) query.set('materialCode', queryMaterial.trim());
    try {
      const result = await apiRequest<InspectionPage>(`${basePath}?${query}`);
      setRows(result.items); setTotal(result.total);
    } catch (cause) { setRows([]); setTotal(0); setError(cause); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [page, status, queryMaterial, revision]);

  return <main className="supplier-incoming-page">
    <header className="supplier-incoming-heading"><div><Typography.Text type="secondary">供应商质量 · IQC</Typography.Text><Typography.Title level={1}>来料检验台账</Typography.Title><Typography.Paragraph type="secondary">登记人工来料检验，完成结论后保留版本与照片文件引用。MES 来源暂未开放。</Typography.Paragraph></div><Space><Button onClick={() => setRevision((value) => value + 1)} loading={loading}>刷新</Button><Button type="primary" onClick={() => setCreateOpen(true)}>新建检验草稿</Button></Space></header>
    {error ? <Alert type={isDenied(error) ? 'warning' : 'error'} showIcon title={errorTitle(error, 'IQC 台账加载失败，请重试。')} description={error instanceof ApiError ? error.traceId : undefined} action={isDenied(error) ? undefined : <Button onClick={() => void load()}>重试</Button>} /> : null}
    <section className="supplier-incoming-card"><Space className="supplier-incoming-toolbar" wrap><Input.Search aria-label="按物料编码筛选" placeholder="物料编码" allowClear value={materialCode} onChange={(event) => setMaterialCode(event.target.value)} onSearch={(value) => { setPage(1); setQueryMaterial(value); }} /><Select aria-label="按状态筛选" placeholder="全部状态" allowClear value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))} /><Typography.Text type="secondary">共 {total} 条</Typography.Text></Space>
      {loading ? <div className="supplier-incoming-loading"><Spin /></div> : error ? null : <Table<Inspection> rowKey="id" dataSource={rows} scroll={{ x: 1040 }} locale={{ emptyText: <Empty description={queryMaterial || status ? '没有匹配的检验记录' : '暂无来料检验记录'} /> }} pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: setPage }} columns={[
        { title: '供应商', dataIndex: 'supplierName', render: (value: string, row) => <Button type="link" onClick={() => setSelectedId(row.id)}>{value || row.supplierBusinessCode}</Button> },
        { title: '物料编码', dataIndex: 'materialCode' }, { title: '来料批次', dataIndex: 'incomingBatch' },
        { title: '收货 / 抽检', key: 'quantity', render: (_: unknown, row) => `${row.receivedQuantity} / ${row.sampledQuantity}` },
        { title: '结论', dataIndex: 'conclusion', render: (value: Inspection['conclusion']) => value ?? '未完成' }, { title: '状态', dataIndex: 'status', render: statusTag },
        { title: '更新时间', dataIndex: 'updatedAt', render: (value: string) => new Date(value).toLocaleString('zh-CN') },
      ]} />}
    </section>
    {createOpen ? <CreateInspectionModal close={() => setCreateOpen(false)} saved={() => { setCreateOpen(false); setPage(1); setRevision((value) => value + 1); }} /> : null}
    {selectedId ? <InspectionDrawer id={selectedId} close={() => setSelectedId(undefined)} refreshed={() => setRevision((value) => value + 1)} /> : null}
  </main>;
}

function CreateInspectionModal({ close, saved }: { close: () => void; saved: () => void }) {
  const [form] = Form.useForm<CreateInput>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  async function submit(values: CreateInput) {
    setBusy(true); setError(undefined);
    try { await mutate<Inspection>(basePath, 'POST', { ...values, sourceSystem: 'MANUAL' }); form.resetFields(); saved(); }
    catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }
  return <Modal open title="新建来料检验草稿" footer={null} onCancel={close} closable={!busy} mask={{ closable: false }}>
    {error ? <Alert type={isDenied(error) ? 'warning' : 'error'} showIcon title={errorTitle(error, '草稿创建失败，请检查填写内容。')} description={error instanceof ApiError ? error.traceId : undefined} /> : null}
    <Form form={form} layout="vertical" onFinish={submit} disabled={busy} initialValues={{ sourceSystem: 'MANUAL' }}>
      <Form.Item name="profileId" label="供应商资料 ID" rules={[{ required: true, message: '请输入供应商资料 ID' }]}><Input placeholder="供应商资料 UUID" /></Form.Item>
      <div className="supplier-incoming-form-grid"><Form.Item name="materialCode" label="物料编码" rules={[{ required: true, message: '请输入物料编码' }]}><Input maxLength={100} /></Form.Item><Form.Item name="incomingBatch" label="来料批次" rules={[{ required: true, message: '请输入来料批次' }]}><Input maxLength={160} /></Form.Item><Form.Item name="receivedQuantity" label="收货数量" rules={[{ required: true, type: 'number', min: 1, message: '请输入收货数量' }]}><InputNumber min={1} precision={0} style={{ width: '100%' }} /></Form.Item><Form.Item name="sampledQuantity" label="抽检数量" rules={[{ required: true, type: 'number', min: 1, message: '请输入抽检数量' }]}><InputNumber min={1} precision={0} style={{ width: '100%' }} /></Form.Item></div>
      <Form.Item label="来源系统"><Input value="人工登记（MANUAL）" disabled /></Form.Item><Form.Item><Space><Button onClick={close}>取消</Button><Button type="primary" htmlType="submit" loading={busy}>保存草稿</Button></Space></Form.Item>
    </Form>
  </Modal>;
}

function InspectionDrawer({ id, close, refreshed }: { id: string; close: () => void; refreshed: () => void }) {
  const [record, setRecord] = useState<Inspection>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [actionError, setActionError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [readyPhoto, setReadyPhoto] = useState<Attachment>();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<unknown>();
  const [problemOpen, setProblemOpen] = useState(false);
  const [problemBusy, setProblemBusy] = useState(false);
  const [problemError, setProblemError] = useState<unknown>();

  async function load() {
    setLoading(true); setError(undefined);
    try { setRecord(await apiRequest<Inspection>(`${basePath}/${id}`)); }
    catch (cause) { setRecord(undefined); setError(cause); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [id]);
  async function complete(conclusion: CompleteInput['conclusion']) {
    if (!record) return; setBusy(true); setActionError(undefined);
    try { setRecord(await mutate<Inspection>(`${basePath}/${id}/complete`, 'PUT', { expectedVersion: record.version, conclusion })); refreshed(); }
    catch (cause) { setActionError(cause); }
    finally { setBusy(false); }
  }
  async function attachPhoto() {
    if (!record || !readyPhoto || readyPhoto.status !== 'AVAILABLE' || readyPhoto.scanStatus !== 'CLEAN') return; setPhotoBusy(true); setPhotoError(undefined);
    try { await mutate(`${basePath}/${id}/photos`, 'POST', { fileId: readyPhoto.id, expectedVersion: record.version }); setReadyPhoto(undefined); await load(); refreshed(); }
    catch (cause) { setPhotoError(cause); }
    finally { setPhotoBusy(false); }
  }
  async function createProblem(values: ProblemDraft) {
    if (!record) return;
    setProblemBusy(true); setProblemError(undefined);
    try {
      await mutate(`${basePath}/${id}/problem-links`, 'POST', { ...values, profileId: record.profileId, materialCode: record.materialCode, expectedVersion: record.version });
      setProblemOpen(false); await load(); refreshed();
    } catch (cause) { setProblemError(cause); }
    finally { setProblemBusy(false); }
  }
  const linkedProblemId = record?.problemLinks?.[0]?.problem_id ?? record?.problemLinks?.[0]?.problemId;
  return <Drawer open title="来料检验详情" size={Math.min(720, window.innerWidth - 16)} onClose={close}>
    {loading ? <div className="supplier-incoming-loading"><Spin /></div> : error ? <Alert type={isDenied(error) ? 'warning' : 'error'} showIcon title={errorTitle(error, '详情加载失败，请重试。')} action={!isDenied(error) ? <Button onClick={() => void load()}>重试</Button> : undefined} /> : record ? <div className="supplier-incoming-detail">
      <Space align="center">{statusTag(record.status)}<Typography.Text type="secondary">版本 {record.version}</Typography.Text></Space>
      <Descriptions column={{ xs: 1, sm: 2 }} items={[{ key: 'id', label: '检验记录 ID', children: <Typography.Text copyable={{ text: record.id }}>{record.id}</Typography.Text>, span: 2 }, { key: 'supplier', label: '供应商', children: record.supplierName || record.supplierBusinessCode }, { key: 'material', label: '物料编码', children: record.materialCode }, { key: 'batch', label: '来料批次', children: record.incomingBatch }, { key: 'quantity', label: '收货 / 抽检', children: `${record.receivedQuantity} / ${record.sampledQuantity}` }, { key: 'conclusion', label: '结论', children: record.conclusion ?? '未完成' }, { key: 'source', label: '来源', children: record.sourceSystem === 'MANUAL' ? '人工登记' : 'MES' }, { key: 'reason', label: '更正原因', children: record.correctionReason ?? '—' }]} />
      {actionError ? <Alert type={isDenied(actionError) ? 'warning' : 'error'} showIcon title={errorTitle(actionError, '操作失败，请刷新后重试。')} description={actionError instanceof ApiError ? actionError.traceId : undefined} /> : null}
      {record.status === 'DRAFT' ? <Space wrap><Button type="primary" loading={busy} onClick={() => void complete('PASS')}>完成并判定合格</Button><Button danger loading={busy} onClick={() => void complete('NG')}>完成并判定不合格</Button></Space> : <Button onClick={() => setCorrectionOpen(true)}>发起更正</Button>}
      {record.conclusion === 'NG' && record.status !== 'DRAFT' ? <section className="supplier-incoming-detail-section"><Typography.Title level={4}>供应商问题</Typography.Title>{linkedProblemId ? <a href={`/app/supplier-quality/problems/${linkedProblemId}`}>查看供应商问题</a> : <Button onClick={() => setProblemOpen(true)}>创建供应商问题草稿</Button>}</section> : null}
      <section className="supplier-incoming-detail-section"><Typography.Title level={4}>检验项目</Typography.Title><Table<IncomingItem & { id?: string }> size="small" rowKey={(item) => item.id ?? `${item.order}-${item.name}`} pagination={false} dataSource={record.items ?? []} locale={{ emptyText: '未记录检验项目' }} columns={[{ title: '序号', dataIndex: 'order' }, { title: '项目', dataIndex: 'name' }, { title: '实测值', dataIndex: 'measuredValue', render: (value?: string) => value || '—' }, { title: '结果', dataIndex: 'result' }]} /></section>
      <section className="supplier-incoming-detail-section"><Typography.Title level={4}>检验照片</Typography.Title><Typography.Paragraph type="secondary">上传后等待安全扫描，通过后将照片归档到本次检验。扫描失败可在附件卡片重试或上传新照片，检验草稿会保留。</Typography.Paragraph>{photoError ? <Alert type={isDenied(photoError) ? 'warning' : 'error'} showIcon title={errorTitle(photoError, '照片归档失败，请检查文件状态或刷新版本。')} action={photoError instanceof ApiError && photoError.status === 409 ? <Button onClick={() => void load()}>重新加载</Button> : undefined} /> : null}<AttachmentPanel resource={{ resourceType: 'supplier-incoming', resourceId: record.id }} fileIds={(record.photos ?? []).map((photo) => photo.file_id ?? photo.fileId).filter((value): value is string => Boolean(value))} readOnly={record.status === 'CORRECTED' || photoBusy} onReady={(file) => setReadyPhoto(file)} onRemoved={(fileId) => { if (readyPhoto?.id === fileId) setReadyPhoto(undefined); }} />{readyPhoto && !(record.photos ?? []).some((photo) => (photo.file_id ?? photo.fileId) === readyPhoto.id) ? <Button type="primary" loading={photoBusy} onClick={() => void attachPhoto()}>归档已扫描照片</Button> : null}<Table size="small" rowKey="id" pagination={false} dataSource={record.photos ?? []} locale={{ emptyText: '尚未归档照片' }} columns={[{ title: '照片', render: (_: unknown, photo) => photo.file_id ?? photo.fileId }, { title: '归档时间', dataIndex: 'created_at', render: (value?: string) => value ? new Date(value).toLocaleString('zh-CN') : '—' }]} /></section>
    </div> : <Empty description="检验记录不存在" />}
    {correctionOpen && record ? <CorrectionModal record={record} close={() => setCorrectionOpen(false)} saved={(updated) => { setRecord(updated); setCorrectionOpen(false); refreshed(); }} /> : null}
    {problemOpen && record ? <ProblemDraftModal record={record} busy={problemBusy} error={problemError} close={() => setProblemOpen(false)} submit={createProblem} /> : null}
  </Drawer>;
}

function ProblemDraftModal({ record, busy, error, close, submit }: { record: Inspection; busy: boolean; error: unknown; close: () => void; submit: (values: ProblemDraft) => Promise<void> }) {
  const [form] = Form.useForm<ProblemDraft>();
  return <Modal open title="创建供应商问题草稿" footer={null} onCancel={close} closable={!busy} mask={{ closable: false }}>
    <Typography.Paragraph type="secondary">将此 NG 检验与一张供应商问题草稿关联。正式发单仍在供应商问题页面完成。</Typography.Paragraph>
    {error ? <Alert type={isDenied(error) ? 'warning' : 'error'} showIcon title={errorTitle(error, '创建问题草稿失败，请检查资料、权限和版本。')} action={error instanceof ApiError && error.status === 409 ? <Button onClick={close}>返回检验详情</Button> : undefined} /> : null}
    <Form form={form} layout="vertical" disabled={busy} onFinish={(values) => void submit(values)} initialValues={{ title: `${record.materialCode} 来料批次 ${record.incomingBatch} 检验不合格`, defectQuantity: 1, severity: 'MEDIUM', responseForm: 'BRIEF', replyMode: 'SUPPLIER' }}>
      <Form.Item name="title" label="问题标题" rules={[{ required: true }]}><Input maxLength={500} /></Form.Item>
      <Form.Item name="defectDescription" label="不良描述" rules={[{ required: true }]}><Input.TextArea rows={4} maxLength={10000} /></Form.Item>
      <Form.Item name="defectQuantity" label="不良数量" rules={[{ required: true, type: 'number', min: 1 }]}><InputNumber min={1} precision={0} style={{ width: '100%' }} /></Form.Item>
      <Form.Item name="severity" label="严重程度" rules={[{ required: true }]}><Select options={[{ value: 'LOW', label: '低' }, { value: 'MEDIUM', label: '中' }, { value: 'HIGH', label: '高' }, { value: 'CRITICAL', label: '严重' }]} /></Form.Item>
      <Form.Item name="responseForm" label="回复形式" rules={[{ required: true }]}><Select options={[{ value: 'BRIEF', label: '简报' }, { value: 'EIGHT_D', label: '8D' }]} /></Form.Item>
      <Form.Item name="replyMode" label="回复方" rules={[{ required: true }]}><Select options={[{ value: 'SUPPLIER', label: '供应商' }, { value: 'INTERNAL', label: '内部' }]} /></Form.Item>
      <Form.Item noStyle shouldUpdate={(previous, current) => previous.replyMode !== current.replyMode}>{({ getFieldValue }) => getFieldValue('replyMode') === 'INTERNAL' ? <Form.Item name="internalResponderId" label="内部回复人 ID" rules={[{ required: true }]}><Input /></Form.Item> : null}</Form.Item>
      <Space><Button onClick={close}>取消</Button><Button type="primary" htmlType="submit" loading={busy}>创建并关联</Button></Space>
    </Form>
  </Modal>;
}

function CorrectionModal({ record, close, saved }: { record: Inspection; close: () => void; saved: (record: Inspection) => void }) {
  const [form] = Form.useForm<CorrectInput>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  async function submit(values: CorrectInput) { setBusy(true); setError(undefined); try { saved(await mutate<Inspection>(`${basePath}/${record.id}/correct`, 'PUT', { ...values, expectedVersion: record.version })); } catch (cause) { setError(cause); } finally { setBusy(false); } }
  return <Modal open title="更正检验结论" footer={null} onCancel={close} closable={!busy} mask={{ closable: false }}><Typography.Paragraph type="secondary">更正会保留当前记录版本，并要求填写原因。</Typography.Paragraph>{error ? <Alert type={isDenied(error) ? 'warning' : 'error'} showIcon title={errorTitle(error, '更正失败，请重试。')} /> : null}<Form form={form} layout="vertical" onFinish={submit} disabled={busy}><Form.Item name="conclusion" label="更正结论" rules={[{ required: true, message: '请选择更正结论' }]}><Select options={[{ value: 'PASS', label: '合格' }, { value: 'NG', label: '不合格' }]} /></Form.Item><Form.Item name="reason" label="更正原因" rules={[{ required: true, min: 1, message: '请填写更正原因' }]}><Input.TextArea rows={4} maxLength={2000} showCount /></Form.Item><Space><Button onClick={close}>取消</Button><Button type="primary" htmlType="submit" loading={busy}>提交更正</Button></Space></Form></Modal>;
}
