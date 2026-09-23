import { Alert, Button, Descriptions, Empty, Form, Input, InputNumber, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { createSupplierMutation, severityLabels, statusLabels, supplierApi, supplierError, supplierPath, type ProblemDraft, type ProblemPage, type ProblemQuery, type ResponseContent, type SupplierProblem } from './supplierQuality';
import { SupplierReferenceSelect } from './SupplierReferenceSelect';
import { SupplierProfilesPage } from './SupplierProfilesPage';
import { SupplierResponseHistory } from './SupplierResponseHistory';
import { SupplierWorkflowActions } from './SupplierWorkflowActions';
import { useSupplierData } from './useSupplierData';
import './supplier-quality.css';

function LoadError({ error, retry }: { error?: string; retry: () => void }) {
  return error ? <Alert type="error" showIcon title={error} action={<Button onClick={retry}>重新加载</Button>} /> : null;
}

function ProblemLedger({ portal }: { portal: boolean }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [severity, setSeverity] = useState<ProblemQuery['severity']>();
  const [responseForm, setResponseForm] = useState<ProblemQuery['responseForm']>();
  const [stage, setStage] = useState<ProblemQuery['stage']>();
  const navigate = useNavigate();
  const query = new URLSearchParams({ page: String(page), search });
  if (severity) query.set('severity', severity);
  if (responseForm) query.set('responseForm', responseForm);
  if (stage && !portal) query.set('stage', stage);
  const result = useSupplierData<ProblemPage>(`${supplierApi(portal)}/problems?${query}`);
  return <>
    <div className="supplier-toolbar"><Input.Search aria-label="搜索问题" placeholder="搜索问题标题或物料号" maxLength={100} allowClear onSearch={(value) => { setSearch(value); setPage(1); }} />
      {result.data?.canCreateDraft ? <Button type="primary" onClick={() => navigate(`${supplierPath(portal)}/new`)}>创建问题草稿</Button> : null}</div>
    <Space wrap className="supplier-filters">
      <Select aria-label="筛选严重度" placeholder="全部严重度" allowClear value={severity} onChange={(value) => { setSeverity(value); setPage(1); }} options={Object.entries(severityLabels).map(([value, label]) => ({ value, label }))} />
      <Select aria-label="筛选回复形式" placeholder="全部回复形式" allowClear value={responseForm} onChange={(value) => { setResponseForm(value); setPage(1); }} options={[{ value: 'BRIEF', label: '简报' }, { value: 'EIGHT_D', label: '8D' }]} />
      {!portal ? <Select aria-label="筛选发单状态" placeholder="全部发单状态" allowClear value={stage} onChange={(value) => { setStage(value); setPage(1); }} options={[{ value: 'DRAFT', label: '草稿' }, { value: 'ISSUED', label: '已发单' }]} /> : null}
    </Space>
    <LoadError error={result.error} retry={result.reload} />
    {!result.error ? <Table<SupplierProblem> rowKey="id" loading={result.loading} dataSource={result.data?.items ?? []} scroll={{ x: 850 }} pagination={{ current: page, pageSize: 20, total: result.data?.total ?? 0, showSizeChanger: false, onChange: setPage }} locale={{ emptyText: <Empty description={portal ? '尚未收到问题单' : '暂无问题草稿'} /> }} columns={[
      { title: '问题 / 编号', key: 'title', render: (_, record) => <><Link to={`${supplierPath(portal)}/problems/${record.id}`}>{record.title}</Link><div className="supplier-secondary">{record.reportNumber ?? '未发单'}</div></> },
      { title: '供应商', dataIndex: 'supplierName' }, { title: '物料号', dataIndex: 'materialCode' },
      { title: '严重度', key: 'severity', render: (_, record) => <Tag color={record.severity === 'CRITICAL' || record.severity === 'HIGH' ? 'red' : 'default'}>{severityLabels[record.severity]}</Tag> },
      { title: '回复形式', key: 'form', render: (_, record) => record.responseForm === 'BRIEF' ? '简报' : '8D' },
      { title: '进度', key: 'stage', render: (_, record) => record.problemStatus ? statusLabels[record.problemStatus] : '草稿' },
      { title: '截止时间', key: 'due', render: (_, record) => record.dueAt ? new Date(record.dueAt).toLocaleString() : '未设定' },
    ]} /> : null}
  </>;
}

const required = [{ required: true, message: '请填写此项' }];

function ProblemForm({ record, saved }: { record?: SupplierProblem; saved: (value: SupplierProblem, notice: string) => void }) {
  const [form] = Form.useForm<ProblemDraft>();
  const mode = Form.useWatch('replyMode', form);
  const [mutate] = useState(createSupplierMutation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [dirty, setDirty] = useState(false);
  async function submit(values: ProblemDraft) {
    setBusy(true); setError(undefined);
    const body: ProblemDraft = { profileId: values.profileId, title: values.title, materialCode: values.materialCode, materialCategory: values.materialCategory, defectDescription: values.defectDescription, defectQuantity: values.defectQuantity, severity: values.severity, responseForm: values.responseForm, replyMode: values.replyMode, ...(values.replyMode === 'INTERNAL' ? { internalResponderId: values.internalResponderId } : {}) };
    try { const result = await mutate<SupplierProblem>(`${supplierApi(false)}/drafts${record ? `/${record.id}` : ''}`, record ? 'PUT' : 'POST', record ? { ...body, expectedVersion: record.version } : body); setDirty(false); saved(result, '草稿已保存'); }
    catch (cause) { setError(supplierError(cause)); }
    finally { setBusy(false); }
  }
  async function issue() {
    if (!record || busy || dirty) return;
    setBusy(true); setError(undefined);
    try { saved(await mutate<SupplierProblem>(`${supplierApi(false)}/drafts/${record.id}/issue`, 'POST', { expectedVersion: record.version }), '正式发单成功'); }
    catch (cause) { setError(supplierError(cause)); }
    finally { setBusy(false); }
  }
  return <section className="supplier-card"><Typography.Title level={3}>问题资料</Typography.Title>
    {error ? <Alert type="error" showIcon title={error} /> : null}
    <Form form={form} layout="vertical" initialValues={record ?? { replyMode: 'SUPPLIER' }} onValuesChange={() => setDirty(true)} onFinish={submit} disabled={busy}>
      <Form.Item name="title" label="问题标题" rules={required}><Input maxLength={500} /></Form.Item>
      <div className="supplier-form-grid">
        <Form.Item name="profileId" label="责任供应商" rules={required}><SupplierReferenceSelect path={`${supplierApi(false)}/reference-options?kind=profiles`} placeholder="选择一家供应商" /></Form.Item>
        <Form.Item name="materialCode" label="物料号" rules={required}><Input maxLength={100} /></Form.Item>
        <Form.Item name="materialCategory" label="物料类别"><Select allowClear options={[{ value: 'STRUCTURE', label: '结构件' }, { value: 'ELECTRONIC', label: '电子件' }]} /></Form.Item>
        <Form.Item name="defectQuantity" label="不良数量" rules={required}><InputNumber min={1} max={2147483647} precision={0} /></Form.Item>
        <Form.Item name="severity" label="严重度" rules={required}><Select options={Object.entries(severityLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
        <Form.Item name="responseForm" label="回复形式" rules={required}><Select placeholder="发单前必须选择" options={[{ value: 'BRIEF', label: '简报' }, { value: 'EIGHT_D', label: '8D' }]} /></Form.Item>
        <Form.Item name="replyMode" label="回复方" rules={required}><Select options={[{ value: 'SUPPLIER', label: '供应商企业' }, { value: 'INTERNAL', label: '内部指定人员' }]} /></Form.Item>
        {mode === 'INTERNAL' ? <Form.Item name="internalResponderId" label="内部回复人" rules={required}><SupplierReferenceSelect path={`${supplierApi(false)}/reference-options?kind=responders`} /></Form.Item> : null}
      </div>
      <Form.Item name="defectDescription" label="不良描述" rules={required}><Input.TextArea rows={4} maxLength={10000} showCount /></Form.Item>
      <Space wrap><Button type="primary" htmlType="submit" loading={busy}>保存问题草稿</Button>{record ? <Button onClick={() => void issue()} disabled={dirty || busy} loading={busy}>正式发单</Button> : null}</Space>
      {record && dirty ? <Typography.Paragraph type="secondary">请先保存当前修改，再正式发单。</Typography.Paragraph> : null}
    </Form>
  </section>;
}

const responseFields: { key: keyof ResponseContent; label: string }[] = [
  { key: 'problemDescription', label: '问题描述' }, { key: 'containmentAction', label: '围堵措施' },
  { key: 'interimAction', label: '临时措施' }, { key: 'rootCause', label: '根本原因' },
  { key: 'correctiveAction', label: '纠正措施' }, { key: 'preventiveAction', label: '预防措施' },
  { key: 'verificationResult', label: '整改自验结果' },
];

function ResponseForm({ record, portal, saved }: { record: SupplierProblem; portal: boolean; saved: (value: SupplierProblem, notice: string) => void }) {
  const [form] = Form.useForm<ResponseContent>();
  const [mutate] = useState(createSupplierMutation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [evidenceFileIds, setEvidenceFileIds] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const completion = record.responseDraft.completionTime ? new Date(record.responseDraft.completionTime) : undefined;
  const localCompletion = completion ? new Date(completion.getTime() - completion.getTimezoneOffset() * 60000).toISOString().slice(0, 19) : undefined;
  const fields = responseFields.filter((field) => record.responseForm === 'EIGHT_D' || ['containmentAction', 'rootCause', 'correctiveAction'].includes(field.key) || record.responseDraft[field.key]);
  const content = (values: ResponseContent): ResponseContent => ({ ...values, completionTime: values.completionTime ? new Date(values.completionTime).toISOString() : undefined });
  async function saveDraft() {
    if (busy) return;
    setBusy(true); setError(undefined);
    try { saved(await mutate<SupplierProblem>(`${supplierApi(portal)}/problems/${record.id}/response-draft`, 'PUT', { expectedVersion: record.version, content: content(form.getFieldsValue()) }), '回复草稿已保存'); }
    catch (cause) { setError(supplierError(cause)); }
    finally { setBusy(false); }
  }
  async function submit(values: ResponseContent) {
    if (busy) return;
    if (evidenceFileIds.length > 10) { setError('一次最多提交 10 个证据附件'); return; }
    setBusy(true); setError(undefined);
    try {
      const result = await mutate<SupplierProblem>(`${supplierApi(portal)}/problems/${record.id}/actions`, 'POST', {
        expectedContentVersion: record.version, content: content(values), evidenceFileIds, evidencePurpose: 'RESPONSE',
      });
      setSubmitted(true);
      saved(result, '回复已提交');
    } catch (cause) { setError(supplierError(cause)); }
    finally { setBusy(false); }
  }
  if (!record.canEditResponse) return <section className="supplier-card"><Typography.Title level={3}>{record.responseForm === 'BRIEF' ? '简报' : '8D'}回复</Typography.Title>
    <Alert type={submitted ? 'success' : 'info'} showIcon title={submitted ? '回复已提交，当前节点不可再编辑' : '当前节点不可编辑回复'} description={record.problemStatus ? `问题进度：${statusLabels[record.problemStatus]}` : undefined} />
  </section>;
  return <section className="supplier-card"><Typography.Title level={3}>{record.responseForm === 'BRIEF' ? '简报' : '8D'}回复草稿</Typography.Title>
    <Typography.Paragraph type="secondary">可分次保存草稿；正式提交后当前修订不可编辑。仅扫描通过的附件可作为证据。</Typography.Paragraph>
    {error ? <Alert type="error" showIcon title={error} /> : null}
    <Form form={form} layout="vertical" initialValues={{ ...record.responseDraft, completionTime: localCompletion }} onFinish={submit} disabled={busy}>
      {fields.map((field) => <Form.Item key={field.key} name={field.key} label={field.label} rules={record.responseForm === 'EIGHT_D' || ['rootCause', 'correctiveAction'].includes(field.key) ? required : undefined}><Input.TextArea rows={3} maxLength={10000} showCount /></Form.Item>)}
      <Form.Item name="completionTime" label="完成时间" extra="按当前设备所在时区填写" rules={record.responseForm === 'BRIEF' ? required : undefined}><Input type="datetime-local" step={1} /></Form.Item>
      <Space wrap><Button onClick={() => void saveDraft()} loading={busy}>保存回复草稿</Button>{record.availableActions?.includes('SUBMIT') ? <Button type="primary" htmlType="submit" loading={busy}>正式提交回复</Button> : null}</Space>
    </Form>
    {record.stage === 'ISSUED' ? <div className="supplier-evidence"><AttachmentPanel resource={{ resourceType: 'supplier-quality', resourceId: record.id }} fileIds={evidenceFileIds} readOnly={busy} onReady={(file) => setEvidenceFileIds((current) => current.includes(file.id) ? current : [...current, file.id])} onRemoved={(id) => setEvidenceFileIds((current) => current.filter((fileId) => fileId !== id))} />
      <Typography.Paragraph type="secondary">已选 {evidenceFileIds.length} 个可提交证据；等待扫描或扫描未通过的附件不会加入本次提交。未提交附件在离开或刷新页面后不能自动恢复，请保持当前页面直到扫描完成。</Typography.Paragraph>
    </div> : null}
  </section>;
}

function ProblemDetail({ id, portal }: { id: string; portal: boolean }) {
  const [revisionPage, setRevisionPage] = useState(1);
  const result = useSupplierData<SupplierProblem>(`${supplierApi(portal)}/problems/${id}?revisionPage=${revisionPage}&revisionPageSize=10`);
  const [savedRecord, setSavedRecord] = useState<SupplierProblem>();
  const [notice, setNotice] = useState<string>();
  useEffect(() => { if (result.data) setSavedRecord(undefined); }, [result.data]);
  const record = savedRecord ?? result.data;
  function saved(value: SupplierProblem, message: string) {
    const draftSaved = message === '草稿已保存' || message === '回复草稿已保存';
    const definedFields = Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));
    setSavedRecord(draftSaved ? { ...record, ...definedFields } as SupplierProblem : value);
    setNotice(message);
    result.reload();
  }
  function reload() { setSavedRecord(undefined); setNotice(undefined); result.reload(); }
  return <><div className="supplier-toolbar"><Link to={supplierPath(portal)}>返回台账</Link><Button onClick={reload}>重新加载</Button></div>
    <LoadError error={result.error} retry={reload} />
    {result.loading ? <Spin /> : null}
    {notice ? <Alert type="success" showIcon title={notice} /> : null}
    {record && !result.error ? <div key={record.id}>
      <section className="supplier-card"><Typography.Title level={2}>{record.title}</Typography.Title><Descriptions column={{ xs: 1, sm: 2 }} items={[
        { key: 'supplier', label: '供应商', children: record.supplierName }, { key: 'number', label: '报告编号', children: record.reportNumber ?? '草稿尚未编号' },
        { key: 'status', label: '进度', children: record.problemStatus ? statusLabels[record.problemStatus] : '草稿' },
        { key: 'node', label: '当前节点', children: record.currentWorkflowNode?.name ?? record.currentWorkflowNode?.type ?? '尚未启动' },
        { key: 'material', label: '物料号', children: record.materialCode }, { key: 'quantity', label: '不良数量', children: record.defectQuantity },
        { key: 'severity', label: '严重度', children: severityLabels[record.severity] },
        { key: 'due', label: '截止时间', children: record.dueAt ? new Date(record.dueAt).toLocaleString() : '未设定' },
        { key: 'mode', label: '回复方', children: record.replyMode === 'SUPPLIER' ? '供应商企业' : '内部指定人员' },
        { key: 'description', label: '不良描述', children: <span className="supplier-text">{record.defectDescription}</span>, span: 'filled' },
      ]} /></section>
      {!portal && record.problemIndexId && record.organizationId ? <Link to={`/app/problem-workspace/${record.problemIndexId}?organizationId=${encodeURIComponent(record.organizationId)}`}>打开公共问题工作空间，查看升级预览与追溯</Link> : null}
      {!portal && record.canEditFacts ? <ProblemForm record={record} saved={saved} /> : null}
      <ResponseForm record={record} portal={portal} saved={saved} />
      {!portal ? <SupplierWorkflowActions record={record} changed={saved} reload={reload} /> : null}
      <SupplierResponseHistory record={record} page={revisionPage} changePage={setRevisionPage} />
    </div> : null}
  </>;
}

export function SupplierQualityPage({ portal = false }: { portal?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const base = supplierPath(portal);
  const suffix = location.pathname.slice(base.length);
  const match = /^\/problems\/([0-9a-f-]{36})$/i.exec(suffix);
  return <main className="supplier-quality-page"><div className="supplier-heading"><div><Typography.Text type="secondary">供应商质量协作</Typography.Text><Typography.Title level={1}>{portal ? '问题与整改' : '供应商质量'}</Typography.Title></div>
    {!portal ? <Space wrap><Link to={base}>问题台账</Link><Link to={`${base}/profiles`}>供应商资料</Link></Space> : null}</div>
    {match ? <ProblemDetail key={match[1]} id={match[1]} portal={portal} /> : !portal && suffix === '/new' ? <><Link to={base}>返回台账</Link><ProblemForm saved={(value) => navigate(`${base}/problems/${value.id}`)} /></> : !portal && suffix === '/profiles' ? <SupplierProfilesPage /> : <ProblemLedger portal={portal} />}
  </main>;
}
