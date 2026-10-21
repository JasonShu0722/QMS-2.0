import type { components } from '@qms/contracts';
import { Alert, Button, Checkbox, Descriptions, Drawer, Empty, Form, Input, List, Space, Spin, Table, Tag, Typography, type TableColumnsType } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import './process-quality.css';
import { ProcessShipmentReportPanel } from './ProcessShipmentReportPanel';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';

type Defect = components['schemas']['ProcessDefectDto'];
type DefectPage = components['schemas']['ProcessDefectPageDto'];
type IssueBody = components['schemas']['IssueProcessDefectsDto'];
type IssueResult = components['schemas']['ProcessIssueResultDto'];
type LinkedProblem = components['schemas']['ProcessIssueProblemDto'];
type IssueValues = Pick<IssueBody, 'severity'> & IssueBody['workflowBinding'];

const responsibilityLabels: Record<Defect['responsibilityCategory'], string> = {
  MATERIAL: '物料', OPERATION: '作业', EQUIPMENT: '设备', PROCESS: '工艺', DESIGN: '设计',
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isDenied(cause: unknown) {
  return cause instanceof ApiError && (cause.status === 403 || cause.code === 'FEATURE_PERMISSION_DENIED' || cause.code === 'ORGANIZATION_SCOPE_DENIED');
}

function errorText(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) return safeAccountError(cause);
  return fallback;
}

export function ProcessDefectLedgerPage() {
  const [form] = Form.useForm<IssueValues>();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<DefectPage>();
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<unknown>();
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Record<string, Defect>>({});
  const [detail, setDetail] = useState<Defect>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<unknown>();
  const [linked, setLinked] = useState<LinkedProblem[]>([]);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<unknown>();
  const [issued, setIssued] = useState<IssueResult>();
  const pending = useRef<{ signature: string; key: string } | undefined>(undefined);
  const [issueDirty, setIssueDirty] = useState(false);
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(issueDirty);
  useNavigationBusy(issuing);
  function closeIssue() {
    if (issuing) return;
    requestLeave(() => { setIssueOpen(false); setIssueDirty(false); form.resetFields(); pending.current = undefined; }, true);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setListError(undefined);
    const query = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (search) query.set('search', search);
    void apiRequest<DefectPage>(`/api/v1/process-quality/defects?${query}`).then((value) => {
      if (active) setResult(value);
    }).catch((cause) => {
      if (active) { setResult(undefined); setListError(cause); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, search, revision]);

  async function openDetail(id: string) {
    setDetailOpen(true);
    setDetail(undefined);
    setLinked([]);
    setDetailError(undefined);
    setDetailLoading(true);
    try {
      const [record, problems] = await Promise.all([
        apiRequest<Defect>(`/api/v1/process-quality/defects/${id}`),
        apiRequest<LinkedProblem[]>(`/api/v1/process-quality/defects/${id}/issues`),
      ]);
      setDetail(record);
      setLinked(problems);
    } catch (cause) { setDetailError(cause); }
    finally { setDetailLoading(false); }
  }

  function toggle(record: Defect, checked: boolean) {
    setSelected((current) => {
      const next = { ...current };
      if (checked) next[record.id] = record;
      else delete next[record.id];
      return next;
    });
    pending.current = undefined;
  }

  async function issue(values: IssueValues) {
    if (issuing) return;
    const sources = Object.values(selected).map((record) => ({ defectId: record.id, expectedVersion: record.version }));
    if (!sources.length) return;
    const body: IssueBody = {
      sources, problemType: 'PROCESS_DEFECT', responseForm: 'BRIEF', responsibleScope: 'process-quality',
      severity: values.severity, workflowBinding: {
        workflowDefinitionId: values.workflowDefinitionId,
        workflowVersionId: values.workflowVersionId,
        instanceKey: values.instanceKey,
      },
    };
    const signature = JSON.stringify(body);
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    setIssuing(true);
    setIssueError(undefined);
    try {
      const token = await csrfToken();
      const response = await apiRequest<IssueResult>('/api/v1/process-quality/issues', {
        method: 'POST', headers: { 'x-csrf-token': token, 'Idempotency-Key': pending.current.key }, body: JSON.stringify(body),
      });
      setIssued(response);
      setIssueOpen(false);
      setSelected({});
      form.resetFields();
      setIssueDirty(false);
      pending.current = undefined;
    } catch (cause) { setIssueError(cause); }
    finally { setIssuing(false); }
  }

  const columns: TableColumnsType<Defect> = [
    { title: '选择', key: 'select', width: 64, render: (_, record) => <Checkbox aria-label={`选择制程不良 ${record.description}`} disabled={issuing} checked={Boolean(selected[record.id])} onChange={(event) => { const checked = event.target.checked; if (issueDirty) requestLeave(() => { form.resetFields(); setIssueDirty(false); toggle(record, checked); }); else toggle(record, checked); }} /> },
    { title: '发生时间', dataIndex: 'occurredAt', width: 165, render: (value: string) => new Date(value).toLocaleString('zh-CN') },
    { title: '失效现象', dataIndex: 'description', ellipsis: true, render: (value: string, record) => <Button type="link" className="process-quality-detail-link" onClick={() => void openDetail(record.id)}>{value}</Button> },
    { title: '类型', dataIndex: 'defectTypeCode', width: 115 },
    { title: '数量', dataIndex: 'defectQuantity', width: 75 },
    { title: '责任类别', dataIndex: 'responsibilityCategory', width: 105, render: (value: Defect['responsibilityCategory']) => responsibilityLabels[value] },
    { title: '批次 / 工单', key: 'source', width: 175, render: (_, record) => `${record.batchCode ?? '—'} / ${record.workOrderCode ?? '—'}` },
    { title: '操作', key: 'actions', width: 100, render: (_, record) => <Button onClick={() => void openDetail(record.id)}>查看详情</Button> },
  ];

  return <main className="process-quality-page">
    <header className="process-quality-heading">
      <div><Typography.Text type="secondary">制程质量</Typography.Text><Typography.Title level={1}>不良品台账</Typography.Title><Typography.Paragraph type="secondary">核对来源事实，选择一条或多条不良记录发起正式问题。</Typography.Paragraph></div>
      <Button disabled={issuing} onClick={() => setRevision((value) => value + 1)} loading={loading}>刷新</Button>
    </header>
    {issued ? <Alert type="success" showIcon title={`问题 ${issued.problem.reportNumber} 已发起`} action={<Link to={`/app/problem-workspace/${issued.problem.id}`}>查看问题</Link>} /> : null}
    <section className="process-quality-card">
      <Space className="process-quality-toolbar" wrap>
        <Input.Search aria-label="搜索制程不良" placeholder="搜索现象、批次或工单" value={searchInput} allowClear onChange={(event) => setSearchInput(event.target.value)} onSearch={(value) => { setPage(1); setSearch(value.trim()); }} />
        <Button type="primary" disabled={issuing || !Object.keys(selected).length || Boolean(listError)} onClick={() => { setIssueError(undefined); setIssueOpen(true); }}>发起问题</Button>
        <Typography.Text type="secondary">已选择 {Object.keys(selected).length} 条来源</Typography.Text>
      </Space>
      {listError ? <Alert type={isDenied(listError) ? 'warning' : 'error'} showIcon title={isDenied(listError) ? '暂无制程不良访问权限' : errorText(listError, '台账加载失败，请重试。')} action={!isDenied(listError) ? <Button onClick={() => setRevision((value) => value + 1)}>重试</Button> : undefined} /> : null}
      {!listError ? <Table<Defect> rowKey="id" columns={columns} dataSource={result?.items ?? []} loading={loading} scroll={{ x: 1050 }} locale={{ emptyText: <Empty description={search ? '没有匹配的不良记录' : '暂无不良记录'} /> }} pagination={{ current: page, pageSize: 20, total: result?.total ?? 0, showSizeChanger: false, onChange: setPage }} /> : null}
    </section>
    <ProcessShipmentReportPanel />
    <Drawer title="来源详情" open={detailOpen} onClose={() => setDetailOpen(false)} width="min(680px, 100vw)" destroyOnHidden>
      {detailLoading ? <div className="process-quality-loading"><Spin /></div> : detailError ? <Alert type={isDenied(detailError) ? 'warning' : 'error'} showIcon title={isDenied(detailError) ? '暂无该来源访问权限' : errorText(detailError, '详情加载失败，请重试。')} /> : detail ? <>
        <Descriptions bordered size="small" column={1} items={[
          { key: 'type', label: '失效类型', children: detail.defectTypeCode },
          { key: 'description', label: '失效现象', children: detail.description },
          { key: 'quantity', label: '数量', children: detail.defectQuantity },
          { key: 'responsibility', label: '责任类别', children: responsibilityLabels[detail.responsibilityCategory] },
          { key: 'batch', label: '批次 / 工单', children: `${detail.batchCode ?? '—'} / ${detail.workOrderCode ?? '—'}` },
          { key: 'operation', label: '工序 / 产线', children: `${detail.operationCode ?? '—'} / ${detail.lineCode ?? '—'}` },
          { key: 'product', label: '产品 / 物料', children: `${detail.productCode ?? '—'} / ${detail.materialCode ?? '—'}` },
          { key: 'source', label: '来源', children: <Space><Tag>{detail.sourceKind === 'MANUAL' ? '人工录入' : detail.sourceKind}</Tag>{detail.externalSourceSystem ? <Tag>{detail.externalSourceSystem} · 待核验</Tag> : null}</Space> },
          { key: 'version', label: '记录版本', children: detail.version },
        ]} />
        <Typography.Title level={4}>已关联问题</Typography.Title>
        <List dataSource={linked} locale={{ emptyText: <Empty description="尚未关联正式问题" /> }} renderItem={(problem) => <List.Item><Link to={`/app/problem-workspace/${problem.id}`}>{problem.reportNumber}</Link></List.Item>} />
        <Typography.Title level={4}>可用证据</Typography.Title>
        <List dataSource={detail.evidence ?? []} locale={{ emptyText: <Empty description="暂无已扫描证据" /> }} renderItem={(evidence) => <List.Item>{evidence.originalName}</List.Item>} />
        {!detail.archivedAt ? <Button type="primary" disabled={issuing} onClick={() => requestLeave(() => { form.resetFields(); setIssueDirty(false); toggle(detail, true); setDetailOpen(false); setIssueError(undefined); setIssueOpen(true); })}>选择此条并发起问题</Button> : null}
      </> : null}
    </Drawer>
    <Drawer title="发起制程问题" open={issueOpen} onClose={closeIssue} closable={!issuing} keyboard={!issuing} mask={{ closable: !issuing }} width="min(620px, 100vw)" destroyOnHidden={false}>
      <Typography.Paragraph>已选择 {Object.keys(selected).length} 条来源。当前支持问题简报；请选择已发布的 PROCESS_BRIEF 流程定义和版本。</Typography.Paragraph>
      {issueError ? <Alert className="process-quality-issue-error" type={isDenied(issueError) ? 'warning' : 'error'} showIcon title={isDenied(issueError) ? '暂无发单权限' : issueError instanceof ApiError && issueError.status === 409 ? '来源版本已变化或流程配置不可用；请核对后重试。' : errorText(issueError, '发单失败，请重试。')} /> : null}
      <Form<IssueValues> form={form} layout="vertical" disabled={issuing} onValuesChange={() => setIssueDirty(true)} initialValues={{ severity: 'MEDIUM' }} onFinish={(values) => void issue(values)}>
        <Form.Item name="severity" label="严重度" rules={[{ required: true, message: '请选择严重度' }, { pattern: /^(LOW|MEDIUM|HIGH|CRITICAL)$/, message: '使用 LOW、MEDIUM、HIGH 或 CRITICAL' }]}><Input list="process-severity-options" /></Form.Item>
        <datalist id="process-severity-options"><option value="LOW" /><option value="MEDIUM" /><option value="HIGH" /><option value="CRITICAL" /></datalist>
        <Form.Item name="workflowDefinitionId" label="流程定义 ID" rules={[{ required: true, message: '请输入流程定义 ID' }, { pattern: uuidPattern, message: '请输入有效的 UUID' }]}><Input /></Form.Item>
        <Form.Item name="workflowVersionId" label="流程版本 ID" rules={[{ required: true, message: '请输入流程版本 ID' }, { pattern: uuidPattern, message: '请输入有效的 UUID' }]}><Input /></Form.Item>
        <Form.Item name="instanceKey" label="实例标识" rules={[{ required: true, whitespace: true, message: '请输入实例标识' }, { max: 128, message: '最多 128 个字符' }]}><Input /></Form.Item>
        <div className="qms-dialog-actions" role="group" aria-label="发起制程问题"><Button type="primary" htmlType="submit" loading={issuing} disabled={!Object.keys(selected).length}>确认发单</Button></div>
      </Form>
    </Drawer>
  </main>;
}
