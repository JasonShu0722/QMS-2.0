import type { components } from '@qms/contracts';
import { Alert, Button, Checkbox, Descriptions, Drawer, Empty, Form, Input, List, Select, Space, Spin, Table, Tag, Typography, type TableColumnsType } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, apiRequest, safeAccountError } from '../../api/client';
import './process-quality.css';
import { useCompletedSessionNavigation, useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { LedgerTable, useLedgerPageSize } from '../../ui/ledger';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { ProcessEightDIssueDrawer } from './ProcessEightDIssueDrawer';
import { ProcessDefectEditor } from './ProcessDefectEditor';
import { ProcessLedgerAction } from './ProcessLedgerAction';
import { SupplierSourceCopyDialog } from '../supplier-eight-d-source/SupplierSourceCopyDialog';
import { categoryLabels, categoryOptions, denied, MappingHint, ProcessError, useProcessWrite, verificationLabels } from './process-ledger';

type Defect = components['schemas']['ProcessDefectDto'];
type DefectPage = components['schemas']['ProcessDefectPageDto'];
type IssueBody = components['schemas']['IssueProcessDefectsDto'];
type IssueResult = components['schemas']['ProcessIssueResultDto'];
type LinkedProblem = components['schemas']['ProcessIssueProblemDto'];
type IssueValues = Pick<IssueBody, 'severity'> & IssueBody['workflowBinding'];

const responsibility = (value: Defect['responsibilityCategory']) => value ? categoryLabels[value] : '待分析';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isDenied(cause: unknown) {
  return cause instanceof ApiError && (cause.status === 403 || cause.code === 'FEATURE_PERMISSION_DENIED' || cause.code === 'ORGANIZATION_SCOPE_DENIED');
}

function errorText(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) return safeAccountError(cause);
  return fallback;
}

export function ProcessDefectLedgerPage() {
  const scope = useWorkTabsStore(state => state.sessionScope);
  const [query] = useSearchParams();
  const organizationId = query.get('organizationId') ?? undefined;
  const defectId = query.get('defectId') ?? undefined;
  if (organizationId !== undefined && !uuidPattern.test(organizationId) || defectId !== undefined && !uuidPattern.test(defectId)) return <Alert type="error" showIcon title="制程来源链接参数无效" />;
  return <ProcessLedgerContent key={`${scope ?? 'unbound'}:${organizationId ?? 'current'}`} organizationId={organizationId} initialDefectId={defectId} />;
}

function ProcessLedgerContent({ organizationId, initialDefectId }: { organizationId?: string; initialDefectId?: string }) {
  const sessionOrganizationId = useWorkTabsStore(state => state.sessionScope?.split(':')[1]);
  const targetOrganizationId = organizationId ?? sessionOrganizationId;
  const [pageSize, setPageSize] = useLedgerPageSize('process-defects', targetOrganizationId);
  const navigate = useNavigate();
  const completeSessionNavigation = useCompletedSessionNavigation();
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
  const [issueDirty, setIssueDirty] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [permissionsChecked, setPermissionsChecked] = useState(false);
  const [accessLost, setAccessLost] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [formalOpen, setFormalOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [editor, setEditor] = useState<Defect | 'new'>();
  const [suppliers, setSuppliers] = useState<components['schemas']['SupplierProfileDto'][]>([]);
  const [supplierError, setSupplierError] = useState<unknown>();
  const [classification, setClassification] = useState<NonNullable<Defect['responsibilityCategory']>>();
  const [actionError, setActionError] = useState<unknown>();
  const [action, setAction] = useState<{ mode: 'close' | 'reopen' | 'verification'; record: Defect; materialId?: string }>();
  const [ledgerStatus, setLedgerStatus] = useState<Defect['ledgerStatus']>();
  const alive = useRef(true);
  const detailRequest = useRef(0);
  const detailController = useRef<AbortController>(undefined);
  const listController = useRef<AbortController>(undefined);
  const linkedTarget = useRef<string>(undefined);
  useEffect(() => { alive.current = true; return () => { alive.current = false; detailController.current?.abort(); detailRequest.current += 1; }; }, []);
  const canRead = permissions.includes('process-quality:defects:read');
  const canWrite = permissions.includes('process-quality:defects:write');
  const canClose = permissions.includes('process-quality:defects:close');
  const canReview = permissions.includes('process-quality:materials:review');
  const canIssue = permissions.includes('process-quality:issues:issue');
  const canCopy = permissions.includes('supplier-quality:issues:copy');
  const canReadSuppliers = permissions.includes('supplier-quality:profiles:read');
  function revoke(cause?: unknown) {
    if (!alive.current) return;
    detailController.current?.abort(); listController.current?.abort();
    detailRequest.current += 1; setAccessLost(true); setResult(undefined); setSelected({}); setDetail(undefined); setLinked([]);
    setDetailOpen(false); setIssueOpen(false); setFormalOpen(false); setCopyOpen(false); setEditor(undefined); setAction(undefined); setSuppliers([]);
    setIssueDirty(false); if (issueOpen || issueDirty) form.resetFields();
    if (cause instanceof ApiError && cause.status === 401) setUnauthorized(true);
  }
  useEffect(() => {
    if (unauthorized) completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
  }, [unauthorized, completeSessionNavigation, navigate]);
  const batchWriter = useProcessWrite(revoke);
  const legacyWriter = useProcessWrite(revoke);
  useNavigationBusy(batchWriter.busy);
  useUnsavedChanges(batchWriter.uncertain);
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(issueDirty || legacyWriter.uncertain);
  useNavigationBusy(issuing);
  function closeIssue() {
    if (issuing) return;
    requestLeave(() => { setIssueOpen(false); setIssueDirty(false); form.resetFields(); }, true);
  }

  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<components['schemas']['PermissionsResponseDto']>(scoped('/api/v1/system/my-permissions'), { signal: controller.signal }).then(value => { if (!controller.signal.aborted) { setPermissions(value.permissions ?? []); setPermissionsChecked(true); } }).catch(cause => { if (!controller.signal.aborted) { setPermissions([]); setPermissionsChecked(false); if (denied(cause)) revoke(cause); } });
    return () => controller.abort();
  }, [revision, organizationId]);
  function scoped(path: string) {
    return organizationId ? `${path}${path.includes('?') ? '&' : '?'}organizationId=${encodeURIComponent(organizationId)}` : path;
  }
  useEffect(() => {
    if (!canReadSuppliers || accessLost) { setSuppliers([]); return; }
    let active = true;
    setSupplierError(undefined);
    const controller = new AbortController();
    async function readSuppliers() {
      const items: components['schemas']['SupplierProfileDto'][] = [];
      let page = 1;
      while (active) {
        const value = await apiRequest<components['schemas']['SupplierProfilePageDto']>(scoped(`/api/v1/supplier-quality/profiles?page=${page}&pageSize=100`), { signal: controller.signal });
        items.push(...value.items);
        if (items.length >= value.total) return items;
        if (!value.items.length) throw new Error('供应商资料分页不完整');
        page += 1;
      }
      return [];
    }
    void readSuppliers().then(value => { if (active) setSuppliers(value); }).catch(cause => { if (active) { setSuppliers([]); setSupplierError(cause); } });
    return () => { active = false; controller.abort(); };
  }, [canReadSuppliers, revision, accessLost]);
  function supplierName(item: Defect['materials'][number]) {
    const profile = suppliers.find(supplier => supplier.id === item.supplierProfileId || (item.supplierOrganizationId && supplier.supplierOrganizationId === item.supplierOrganizationId));
    return profile?.displayName ?? (item.supplierProfileId || item.supplierOrganizationId ? '供应商名称不可用' : '—');
  }
  function saved(record: Defect) {
    setDetail(current => current?.id === record.id ? record : current);
    setRevision(value => value + 1);
  }
  async function classify() {
    if (!classification || batchWriter.busy) return;
    setActionError(undefined);
    try {
      const body: components['schemas']['ClassifyProcessDefectsDto'] = { sources: Object.values(selected).map(record => ({ defectId: record.id, expectedVersion: record.version })), responsibilityCategory: classification };
      const value = await batchWriter.write<components['schemas']['ProcessDefectClassificationResultDto']>('/api/v1/process-quality/defects/classification', body);
      if (alive.current) { setSelected(current => Object.fromEntries(Object.entries(current).map(([id, record]) => [id, value.items.find(item => item.id === id) ?? record]))); setRevision(value => value + 1); }
    } catch (cause) { if (alive.current) setActionError(cause); }
  }

  useEffect(() => {
    if (accessLost) return;
    const controller = new AbortController(); listController.current = controller;
    setLoading(true);
    setListError(undefined);
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) query.set('search', search);
    if (ledgerStatus) query.set('ledgerStatus', ledgerStatus);
    void apiRequest<DefectPage>(scoped(`/api/v1/process-quality/defects?${query}`), { signal: controller.signal }).then((value) => {
      if (!controller.signal.aborted) setResult(value);
    }).catch((cause) => {
      if (!controller.signal.aborted) { setResult(undefined); setListError(cause); if (denied(cause)) revoke(cause); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, pageSize, search, revision, ledgerStatus, accessLost, organizationId]);

  async function openDetail(id: string) {
    detailController.current?.abort();
    const controller = new AbortController(); detailController.current = controller;
    const request = ++detailRequest.current;
    setDetailOpen(true);
    setDetail(undefined);
    setLinked([]);
    setDetailError(undefined);
    setDetailLoading(true);
    try {
      const [record, problems] = await Promise.all([
        apiRequest<Defect>(scoped(`/api/v1/process-quality/defects/${id}`), { signal: controller.signal }),
        apiRequest<LinkedProblem[]>(scoped(`/api/v1/process-quality/defects/${id}/issues`), { signal: controller.signal }),
      ]);
      if (!controller.signal.aborted && alive.current && request === detailRequest.current) { setDetail(record); setLinked(problems); }
    } catch (cause) { if (!controller.signal.aborted && alive.current && request === detailRequest.current) { setDetailError(cause); if (denied(cause)) revoke(cause); } }
    finally { if (!controller.signal.aborted && alive.current && request === detailRequest.current) setDetailLoading(false); }
  }

  useEffect(() => {
    if (!initialDefectId) {
      if (linkedTarget.current) { detailController.current?.abort(); detailRequest.current += 1; setDetailOpen(false); setDetail(undefined); setLinked([]); linkedTarget.current = undefined; }
      return;
    }
    if (!permissionsChecked || accessLost) return;
    if (!canRead) { revoke(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, 403)); return; }
    linkedTarget.current = initialDefectId;
    void openDetail(initialDefectId);
    return () => { detailController.current?.abort(); detailRequest.current += 1; };
  }, [initialDefectId, permissionsChecked, canRead, accessLost]);

  function toggle(record: Defect, checked: boolean) {
    setSelected((current) => {
      if (checked) return current[record.id] || Object.keys(current).length >= 100 ? current : { ...current, [record.id]: record };
      const next = { ...current };
      delete next[record.id];
      return next;
    });
  }

  async function issue(values: IssueValues) {
    if (issuing || !canWrite) return;
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
    setIssuing(true);
    setIssueError(undefined);
    try {
      const response = await legacyWriter.write<IssueResult>('/api/v1/process-quality/issues', body, 'POST');
      if (!alive.current) return;
      setIssued(response);
      setIssueOpen(false);
      setSelected({});
      form.resetFields();
      setIssueDirty(false);
    } catch (cause) { if (alive.current) { setIssueError(cause); if (denied(cause)) revoke(cause); } }
    finally { if (alive.current) setIssuing(false); }
  }

  const selectedCount = Object.keys(selected).length;
  const staleSelected = (result?.items ?? []).filter(item => selected[item.id] && selected[item.id].version !== item.version);
  const locked = issuing || legacyWriter.uncertain || batchWriter.busy || batchWriter.uncertain || formalOpen;
  if (accessLost) return <main className="process-quality-page"><Alert type="warning" showIcon title="暂无制程不良访问权限" description="当前会话或权限已变化，已清除来源、选择与草稿；请重新进入。" /></main>;

  const columns: TableColumnsType<Defect> = [
    { title: '选择', key: 'select', width: 64, render: (_, record) => <Checkbox aria-label={`选择制程不良 ${record.description}`} disabled={locked || (!selected[record.id] && selectedCount >= 100) || !!record.archivedAt} checked={Boolean(selected[record.id])} onChange={(event) => { const checked = event.target.checked; if (issueDirty) requestLeave(() => { form.resetFields(); setIssueDirty(false); toggle(record, checked); }); else toggle(record, checked); }} /> },
    { title: '发生时间', key: 'occurredAt', dataIndex: 'occurredAt', width: 165, render: (value: string | null) => value ? new Date(value).toLocaleString('zh-CN') : '—' },
    { title: '失效现象', key: 'description', dataIndex: 'description', width: 260, ellipsis: true, render: (value: string, record) => <Button type="link" className="process-quality-detail-link" onClick={() => void openDetail(record.id)}>{value}</Button> },
    { title: '类型', key: 'defectTypeCode', dataIndex: 'defectTypeCode', width: 115 },
    { title: '数量', key: 'defectQuantity', dataIndex: 'defectQuantity', width: 75 },
    { title: '责任类别', key: 'responsibilityCategory', dataIndex: 'responsibilityCategory', width: 105, render: responsibility },
    { title: '状态', key: 'ledgerStatus', dataIndex: 'ledgerStatus', width: 100, render: value => <Tag>{value === 'CLOSED' ? '已关闭' : '跟进中'}</Tag> },
    { title: '首条物料 / 供应商', key: 'material', width: 190, render: (_, record) => record.materials?.length ? <span>{record.materials[0].materialCode ?? '—'} / {supplierName(record.materials[0])}{record.materials.length > 1 ? `（共${record.materials.length}项）` : ''}</span> : '—' },
    { title: '人工项目 / 映射', key: 'mapping', width: 150, render: (_, record) => <Space>{record.projectCode ?? '—'}<MappingHint record={record} /></Space> },
    { title: '批次 / 工单', key: 'source', width: 175, render: (_, record) => `${record.batchCode ?? '—'} / ${record.workOrderCode ?? '—'}` },
    { title: '操作', key: 'actions', width: 100, render: (_, record) => <Button onClick={() => void openDetail(record.id)}>查看详情</Button> },
  ];

  return <main className="process-quality-page">
    <header className="process-quality-heading">
      <h1 className="sr-only">不良品台账</h1>
      <Space wrap>{canWrite ? <Button type="primary" onClick={() => requestLeave(() => setEditor('new'))}>登记不良</Button> : null}<Button disabled={locked} onClick={() => requestLeave(() => setRevision((value) => value + 1))} loading={loading}>刷新</Button></Space>
    </header>
    {issued ? <Alert type="success" showIcon title={`问题 ${issued.problem.reportNumber} 已发起`} action={<Link to={`/app/problem-workspace/${issued.problem.id}`}>查看问题</Link>} /> : null}
    <section className="process-quality-card">
      <Space className="process-quality-toolbar" wrap>
        <Input.Search aria-label="搜索制程不良" placeholder="搜索现象、批次或工单" value={searchInput} allowClear onChange={(event) => setSearchInput(event.target.value)} onSearch={(value) => { setPage(1); setSearch(value.trim()); }} />
        <Select aria-label="台账状态" placeholder="全部台账状态" allowClear value={ledgerStatus} options={[{ value: 'FOLLOWING', label: '跟进中' }, { value: 'CLOSED', label: '已关闭' }]} onChange={value => { setPage(1); setLedgerStatus(value); }} />
        {canIssue ? <Button type="primary" disabled={locked || !selectedCount || !!listError || loading || !!staleSelected.length} onClick={() => requestLeave(() => setFormalOpen(true))}>发起内部8D</Button> : null}
        {canCopy ? <Button disabled={locked || !selectedCount || !!listError || loading || !!staleSelected.length} onClick={() => requestLeave(() => setCopyOpen(true))}>复制为供应商草稿</Button> : null}
        {canWrite ? <Button type="primary" disabled={issuing || !Object.keys(selected).length || Boolean(listError)} onClick={() => { setIssueError(undefined); setIssueOpen(true); }}>发起问题</Button> : null}
        <Typography.Text type="secondary">已选择 {Object.keys(selected).length} 条来源</Typography.Text>
        <Typography.Text type="secondary">跨页保留，最多100条</Typography.Text>
        {selectedCount ? <Button disabled={locked} onClick={() => requestLeave(() => setSelected({}))}>清空选择</Button> : null}
        {canWrite ? <><Select aria-label="批量责任分类" placeholder="批量分类" value={classification} options={categoryOptions} disabled={locked} onChange={setClassification} /><Button disabled={locked || !selectedCount || !classification || !!staleSelected.length} onClick={() => requestLeave(() => void classify())}>应用分类</Button></> : null}
      </Space>
      {staleSelected.length ? <Alert type="warning" title="所选来源版本已更新。" action={<Button disabled={locked} onClick={() => requestLeave(() => setSelected(current => ({ ...current, ...Object.fromEntries(staleSelected.map(item => [item.id, item])) })))}>更新所选版本</Button>} /> : null}
      <ProcessError cause={actionError} fallback="批量分类失败，保留选择，请重试。" />
      {batchWriter.uncertain ? <Alert type="warning" title="分类结果未知，选择已锁定；重试复用原请求。" action={<Button loading={batchWriter.busy} onClick={() => void classify()}>同请求重试分类</Button>} /> : null}
      <ProcessError cause={supplierError} fallback="供应商名称加载失败，请刷新重试。" />
      {listError ? <Alert type={isDenied(listError) ? 'warning' : 'error'} showIcon title={isDenied(listError) ? '暂无制程不良访问权限' : errorText(listError, '台账加载失败，请重试。')} action={!isDenied(listError) ? <Button onClick={() => setRevision((value) => value + 1)}>重试</Button> : undefined} /> : null}
      {!listError ? <LedgerTable<Defect> ledgerId="process-defects" organizationId={targetOrganizationId} viewId={ledgerStatus ?? 'ALL'} requiredColumnKeys={['select', 'description', 'actions']} rowKey="id" columns={columns} dataSource={result?.items ?? []} loading={loading} scroll={{ x: 1500 }} expandable={{ rowExpandable: record => (record.materials?.length ?? 0) > 0, expandedRowRender: record => <MaterialDetails record={record} supplierName={supplierName} /> }} locale={{ emptyText: <Empty description={search ? '没有匹配的不良记录' : '暂无不良记录'} /> }} pagination={{ current: page, pageSize, total: result?.total ?? 0, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], onChange: (next, size) => { if (!locked) requestLeave(() => { setPage(size === pageSize ? next : 1); setPageSize(size); }); } }} /> : null}
    </section>
    <Drawer title="来源详情" open={detailOpen} onClose={() => { detailController.current?.abort(); detailRequest.current += 1; setDetailOpen(false); setDetail(undefined); setLinked([]); }} size="min(760px, 100vw)" destroyOnHidden>
      {detailLoading ? <div className="process-quality-loading"><Spin /></div> : detailError ? <Alert type={isDenied(detailError) ? 'warning' : 'error'} showIcon title={isDenied(detailError) ? '暂无该来源访问权限' : errorText(detailError, '详情加载失败，请重试。')} /> : detail ? <>
        <Descriptions bordered size="small" column={1} items={[
          { key: 'type', label: '失效类型', children: detail.defectTypeCode },
          { key: 'description', label: '失效现象', children: detail.description },
          { key: 'quantity', label: '数量', children: detail.defectQuantity },
          { key: 'responsibility', label: '责任类别', children: responsibility(detail.responsibilityCategory) },
          { key: 'ledgerStatus', label: '台账状态', children: detail.ledgerStatus === 'CLOSED' ? '已关闭' : '跟进中' },
          { key: 'trace', label: '条码', children: detail.traceCode ?? '—' },
          { key: 'progress', label: '分析进展', children: detail.analysisProgress ?? '—' },
          { key: 'mapping', label: '人工项目 / 映射建议', children: <Space>{detail.projectCode ?? '—'} / {detail.componentProject?.project?.code ?? '—'}<MappingHint record={detail} /></Space> },
          { key: 'batch', label: '批次 / 工单', children: `${detail.batchCode ?? '—'} / ${detail.workOrderCode ?? '—'}` },
          { key: 'operation', label: '工序 / 产线', children: `${detail.operationCode ?? '—'} / ${detail.lineCode ?? '—'}` },
          { key: 'product', label: '产品 / 物料', children: `${detail.productCode ?? '—'} / ${detail.materialCode ?? '—'}` },
          { key: 'source', label: '来源', children: <Space><Tag>{detail.sourceKind === 'MANUAL' ? '人工录入' : detail.sourceKind}</Tag>{detail.externalSourceSystem ? <Tag>{detail.externalSourceSystem} · 待核验</Tag> : null}</Space> },
          { key: 'version', label: '记录版本', children: detail.version },
        ]} />
        <Typography.Title level={4}>已关联问题</Typography.Title>
        <List dataSource={linked} locale={{ emptyText: <Empty description="尚未关联正式问题" /> }} renderItem={(problem) => <List.Item><Link to={`/app/problem-workspace/${problem.id}`}>{problem.reportNumber}</Link></List.Item>} />
        <Typography.Title level={4}>可用证据</Typography.Title>
        <AttachmentPanel resource={{ resourceType: 'process-defect', resourceId: detail.id }} fileIds={(detail.evidence ?? []).map(evidence => evidence.id)} readOnly={!canWrite} />
        <Typography.Title level={4}>物料与复核事实</Typography.Title>
        <MaterialDetails record={detail} supplierName={supplierName} onReview={canReview && !detail.archivedAt ? materialId => setAction({ mode: 'verification', record: detail, materialId }) : undefined} />
        <Space wrap>{canWrite && !detail.archivedAt ? <Button onClick={() => requestLeave(() => setEditor(detail))}>维护台账</Button> : null}{canClose && !detail.archivedAt ? <Button onClick={() => setAction({ mode: detail.ledgerStatus === 'CLOSED' ? 'reopen' : 'close', record: detail })}>{detail.ledgerStatus === 'CLOSED' ? '恢复跟进' : '关闭台账'}</Button> : null}</Space>
        {!selected[detail.id] && selectedCount >= 100 ? <Alert type="warning" showIcon title="已选满100条来源，请先取消一条已选来源，再选择此条。" /> : null}
        {canWrite && !detail.archivedAt ? <Button type="primary" disabled={locked || (!selected[detail.id] && selectedCount >= 100)} onClick={() => requestLeave(() => { form.resetFields(); setIssueDirty(false); toggle(detail, true); setDetailOpen(false); setIssueError(undefined); setIssueOpen(true); })}>选择此条并发起问题</Button> : null}
      </> : null}
    </Drawer>
    {formalOpen ? <ProcessEightDIssueDrawer sources={Object.values(selected)} onClose={() => setFormalOpen(false)} onDenied={revoke} onIssued={response => { setIssued(response); setFormalOpen(false); setSelected({}); setRevision(value => value + 1); }} /> : null}
    {canCopy && copyOpen ? <SupplierSourceCopyDialog organizationId={Object.values(selected)[0]?.organizationId} sources={Object.values(selected).map(row => ({ kind: 'PROCESS_LEDGER', sourceId: row.id, sourceVersion: row.version }))} onClose={() => setCopyOpen(false)} onDenied={revoke} /> : null}
    {editor ? <ProcessDefectEditor key={editor === 'new' ? 'new' : editor.id} record={editor === 'new' ? undefined : editor} suppliers={suppliers} canReadSuppliers={canReadSuppliers} onClose={() => setEditor(undefined)} onSaved={saved} onDenied={revoke} /> : null}
    {action ? <ProcessLedgerAction {...action} onClose={() => setAction(undefined)} onSaved={record => { saved(record); setAction(undefined); }} onDenied={revoke} /> : null}
    <Drawer title="发起制程问题" open={issueOpen} onClose={closeIssue} closable={!issuing} keyboard={!issuing} mask={{ closable: !issuing }} size="min(620px, 100vw)" destroyOnHidden={false}>
      <Typography.Paragraph>已选择 {Object.keys(selected).length} 条来源。</Typography.Paragraph>
      {issueError ? <Alert className="process-quality-issue-error" type={isDenied(issueError) ? 'warning' : 'error'} showIcon title={isDenied(issueError) ? '暂无发单权限' : errorText(issueError, '发单失败，请重试。')} /> : null}
      {legacyWriter.uncertain ? <Alert type="warning" title="简报发单结果未知，重试仅复用原请求和同一幂等键。" /> : null}
      <Form<IssueValues> form={form} layout="vertical" disabled={issuing || legacyWriter.uncertain} onValuesChange={() => setIssueDirty(true)} initialValues={{ severity: 'MEDIUM' }} onFinish={(values) => void issue(values)}>
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

function MaterialDetails({ record, supplierName, onReview }: { record: Defect; supplierName: (item: Defect['materials'][number]) => string; onReview?: (id: string) => void }) {
  return <Table<Defect['materials'][number]> rowKey={item => item.id ?? String(item.position)} dataSource={record.materials ?? []} size="small" pagination={false} scroll={{ x: 850 }} locale={{ emptyText: '暂无物料明细' }} columns={[
    { title: '物料编码', dataIndex: 'materialCode', render: value => value ?? '—' }, { title: '物料名称', dataIndex: 'materialName', render: value => value ?? '—' },
    { title: '供应商', render: (_, item) => supplierName(item) }, { title: '物料批次', dataIndex: 'materialBatch', render: value => value ?? '—' },
    { title: 'SQE', dataIndex: 'sqeUserId', render: value => value ? '已人工分配' : '未分配' }, { title: '复核状态', dataIndex: 'verification', render: (value: keyof typeof verificationLabels) => verificationLabels[value] ?? '未复核' },
    { title: '复核说明', dataIndex: 'verificationNotes', render: value => value ?? '—' },
    ...(onReview ? [{ title: '操作', render: (_: unknown, item: Defect['materials'][number]) => item.id ? <Button onClick={() => onReview(item.id!)}>复核此物料</Button> : null }] : []),
  ]} />;
}
