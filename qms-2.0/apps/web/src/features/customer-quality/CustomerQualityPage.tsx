import type { components } from '@qms/contracts';
import { Alert, Button, Checkbox, Empty, Input, Space, Spin, Table, Tag, Typography, type TableColumnsType } from 'antd';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, apiRequest, getSession, type SessionView } from '../../api/client';
import { useNavigationGuard } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { CustomerMasterSection } from './CustomerMasterSection';
import { CustomerLegacyQualityPage } from './CustomerLegacyQualityPage';
import { CustomerAnalysisPanel } from './customer-analysis-panel';
import { CustomerLedgerDetail } from './customer-ledger-detail';
import { CustomerLedgerEditor } from './customer-ledger-editor';
import { CustomerLedgerImportPanel } from './customer-ledger-import-panel';
import { ledgerDenied } from './customer-ledger-write';
import { LedgerError, LedgerWarnings, ledgerBase, scopedLedger, stageLabel, typeLabel, uuid, type LedgerCandidate, type LedgerDetail, type LedgerItem } from './customer-ledger-ui';
import './customer-quality.css';

type LedgerPage = components['schemas']['CustomerLedgerPageDto'];
type Permissions = components['schemas']['PermissionsResponseDto'];
type Props = { renderAnalysis?: (complaintId: string, onDenied: (cause: unknown) => void, sourceRecord: LedgerDetail) => ReactNode };

export function CustomerQualityPage({ renderAnalysis }: Props = {}) {
  const scope = useWorkTabsStore(state => state.sessionScope);
  const [query] = useSearchParams();
  const organizationId = query.get('organizationId') ?? undefined;
  const complaintId = query.get('complaintId') ?? undefined;
  if (organizationId !== undefined && !uuid.test(organizationId) || complaintId !== undefined && !uuid.test(complaintId)) return <Alert type="error" showIcon title="客诉链接参数无效" />;
  return <CustomerLedgerContent key={`${scope ?? 'unbound'}:${organizationId ?? 'current'}`} organizationId={organizationId} initialComplaintId={complaintId} renderAnalysis={renderAnalysis ?? ((id, onDenied, sourceRecord) => <CustomerAnalysisPanel complaintId={id} organizationId={organizationId} onDenied={onDenied} sourceRecord={sourceRecord} />)} />;
}

function CustomerLedgerContent({ organizationId, initialComplaintId, renderAnalysis }: Props & { organizationId?: string; initialComplaintId?: string }) {
  const scope = useWorkTabsStore(state => state.sessionScope);
  const [session, setSession] = useState<SessionView>(); const [permissions, setPermissions] = useState<string[]>([]);
  const [authorized, setAuthorized] = useState(false); const [accessLost, setAccessLost] = useState(false);
  const [error, setError] = useState<unknown>(); const [permissionError, setPermissionError] = useState<unknown>(); const [detailError, setDetailError] = useState<unknown>();
  const [loading, setLoading] = useState(true); const [detailLoading, setDetailLoading] = useState(false);
  const [result, setResult] = useState<LedgerPage>(); const [detail, setDetail] = useState<LedgerDetail>();
  const [candidates, setCandidates] = useState<LedgerCandidate[]>([]);
  const [auxiliaryLoading, setAuxiliaryLoading] = useState(false); const [auxiliaryError, setAuxiliaryError] = useState<unknown>();
  const [view, setView] = useState<'ALL' | 'ZERO_KM' | 'AFTER_SALES'>('ALL');
  const [page, setPage] = useState(1); const [search, setSearch] = useState(''); const [searchDraft, setSearchDraft] = useState('');
  const [status, setStatus] = useState(''); const [stage, setStage] = useState(''); const [mine, setMine] = useState(false);
  const [component, setComponent] = useState(''); const [project, setProject] = useState(''); const [customerId, setCustomerId] = useState('');
  const [engineer, setEngineer] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [customers, setCustomers] = useState<components['schemas']['CustomerMasterDto'][]>([]);
  const [revision, setRevision] = useState(0); const [editorOpen, setEditorOpen] = useState(false); const [importOpen, setImportOpen] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const life = useRef<AbortController>(undefined); const detailController = useRef<AbortController>(undefined);
  const selectedId = useRef<string | undefined>(undefined); const detailSequence = useRef(0);
  const requestLeave = useNavigationGuard();
  const revoke = useCallback((cause: unknown) => {
    life.current?.abort(); detailController.current?.abort(); detailSequence.current++;
    selectedId.current = undefined; setAccessLost(true); setAuthorized(false); setPermissions([]); setSession(undefined);
    setResult(undefined); setDetail(undefined); setCandidates([]); setCustomers([]); setEditorOpen(false); setImportOpen(false); setLegacy(false);
    setSearchDraft(''); setSearch(''); setError(cause); setDetailError(undefined); setPermissionError(undefined); setLoading(false); setDetailLoading(false); setAuxiliaryError(undefined); setAuxiliaryLoading(false);
  }, []);
  const loadAuxiliary = useCallback(async (controller: AbortController, revalidate = false) => {
    if (controller.signal.aborted) return;
    setAuxiliaryLoading(true); setAuxiliaryError(undefined);
    const reject = (cause: unknown): never => { if (!controller.signal.aborted && ledgerDenied(cause)) revoke(cause); throw cause; };
    try {
      if (revalidate) {
        const access = await apiRequest<Permissions>(scopedLedger('/api/v1/system/my-permissions', organizationId), { signal: controller.signal });
        controller.signal.throwIfAborted();
        if (!access.permissions.includes('customer-quality:complaints:read')) throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, 403);
        setPermissions(access.permissions);
      }
      const [people, customerRows] = await Promise.all([
        apiRequest<components['schemas']['CustomerLedgerCandidatesDto']>(scopedLedger(`${ledgerBase}/candidates`, organizationId), { signal: controller.signal }).catch(reject),
        apiRequest<components['schemas']['CustomerMasterDto'][]>(scopedLedger('/api/v1/customer-quality/customers', organizationId), { signal: controller.signal }).catch(reject),
      ]);
      controller.signal.throwIfAborted(); setCandidates(people.items); setCustomers(customerRows);
    } catch (cause) { if (!controller.signal.aborted) { setCandidates([]); setCustomers([]); if (ledgerDenied(cause)) revoke(cause); else setAuxiliaryError(cause); } }
    finally { if (!controller.signal.aborted) setAuxiliaryLoading(false); }
  }, [organizationId, revoke]);
  useEffect(() => {
    const controller = new AbortController(); life.current = controller;
    setAuthorized(false); setPermissionError(undefined);
    async function initialize() {
      try {
        const actor = await getSession(); controller.signal.throwIfAborted();
        if (actor.accountType !== 'INTERNAL' || useWorkTabsStore.getState().sessionScope !== scope || scope && scope !== `${actor.accountType}:${actor.organizationId}:${actor.userId}`) throw new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: '' }, 401);
        const access = await apiRequest<Permissions>(scopedLedger('/api/v1/system/my-permissions', organizationId), { signal: controller.signal });
        controller.signal.throwIfAborted();
        if (!access.permissions.includes('customer-quality:complaints:read')) throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, 403);
        setSession(actor); setPermissions(access.permissions); setAuthorized(true);
        await loadAuxiliary(controller);
      } catch (cause) { if (!controller.signal.aborted) { if (ledgerDenied(cause)) revoke(cause); else { setPermissionError(cause); setLoading(false); } } }
    }
    void initialize();
    return () => { controller.abort(); detailController.current?.abort(); detailSequence.current++; };
  }, [organizationId, scope, revoke, loadAuxiliary]);

  useEffect(() => {
    if (!authorized || legacy || accessLost) return;
    const controller = new AbortController(); setLoading(true); setError(undefined); setResult(undefined);
    const query = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (view !== 'ALL') query.set('complaintType', view);
    if (search) query.set('search', search);
    if (status) query.set('status', status); if (stage) query.set('stage', stage); if (mine) query.set('mine', 'true');
    if (component) query.set('componentCode', component); if (project) query.set('projectCode', project); if (customerId) query.set('customerId', customerId);
    if (engineer) query.set('qualityEngineerId', engineer); if (from) query.set('occurredFrom', from); if (to) query.set('occurredTo', to);
    void apiRequest<LedgerPage>(scopedLedger(`${ledgerBase}?${query}`, organizationId), { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted && !life.current?.signal.aborted) setResult(value);
    }).catch(cause => { if (!controller.signal.aborted && !life.current?.signal.aborted) { setError(cause); if (ledgerDenied(cause)) revoke(cause); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [authorized, legacy, accessLost, page, view, search, status, stage, mine, component, project, customerId, engineer, from, to, revision, organizationId, revoke]);

  const openDetail = useCallback(async (id: string, preserve = false) => {
    detailController.current?.abort(); const controller = new AbortController(); detailController.current = controller;
    const sequence = ++detailSequence.current; selectedId.current = id;
    if (!preserve) setDetail(undefined); setDetailError(undefined); setDetailLoading(true);
    try {
      const value = await apiRequest<LedgerDetail>(scopedLedger(`${ledgerBase}/${id}`, organizationId), { signal: controller.signal });
      if (!controller.signal.aborted && !life.current?.signal.aborted && sequence === detailSequence.current) { setDetail(value); return value; }
    } catch (cause) {
      if (!controller.signal.aborted && !life.current?.signal.aborted && sequence === detailSequence.current) { setDetailError(cause); if (ledgerDenied(cause)) revoke(cause); else throw cause; }
    } finally { if (!controller.signal.aborted && sequence === detailSequence.current) setDetailLoading(false); }
  }, [organizationId, revoke]);
  useEffect(() => {
    if (!authorized || !initialComplaintId || legacy || accessLost) return;
    requestLeave(() => { void openDetail(initialComplaintId).catch(() => undefined); });
  }, [authorized, initialComplaintId, legacy, accessLost, openDetail, requestLeave]);

  function saved(value: LedgerItem) {
    setEditorOpen(false); setRevision(current => current + 1);
    if (detail?.id === value.id) setDetail(current => current ? { ...current, ...value } : current);
    void openDetail(value.id, true).catch(() => undefined);
  }
  function refresh() { requestLeave(() => { setRevision(current => current + 1); if (selectedId.current) void openDetail(selectedId.current).catch(() => undefined); }); }
  function chooseView(next: typeof view) { requestLeave(() => { setView(next); setPage(1); setDetail(undefined); selectedId.current = undefined; detailController.current?.abort(); }); }
  const columns: TableColumnsType<LedgerItem> = [
    { title: '客诉编号', width: 180, render: (_, row) => <Space><Button className="customer-ledger-number" aria-label={row.complaintNumber} type="link" onClick={() => requestLeave(() => { void openDetail(row.id).catch(() => undefined); })}>{row.complaintNumber}</Button><LedgerWarnings label={row.complaintNumber} warnings={row.warnings} raw={row.raw} /></Space> },
    { title: '客户 / 类型', width: 180, render: (_, row) => <><div>{row.normalized.customerName ?? '客户待匹配'}</div><Typography.Text type="secondary">{typeLabel(row.normalized.complaintType)}</Typography.Text></> },
    { title: '组件 / 项目 / 阶段', width: 210, render: (_, row) => <><div>{row.normalized.componentCode ?? '组件待补'}</div><div>{row.mapping?.project ? `${row.mapping.project.code} · ${row.mapping.project.name}` : '未检索到映射关系'}</div><div>{row.mapping?.mapping?.productCategory ?? '分类待匹配'}{row.mapping?.mapping?.productSubcategory ? ` / ${row.mapping.mapping.productSubcategory}` : ''}</div><Tag>{stageLabel(row.stage)}</Tag></> },
    { title: '发生日期', width: 120, render: (_, row) => row.normalized.occurredOn ?? '未填写' },
    { title: '详细故障描述', width: 250, render: (_, row) => <span className="customer-ledger-raw">{row.normalized.defectDescription ?? '待补正'}</span> },
    { title: '登记件数', width: 90, render: (_, row) => row.normalized.quantity ?? '待补正' },
    ...(view === 'ZERO_KM' ? [
      { title: '上线日期', width: 120, render: (_: unknown, row: LedgerItem) => row.normalized.onlineOn ?? '未填写' },
      { title: '生产日期 / 追溯', width: 180, render: (_: unknown, row: LedgerItem) => <>{row.normalized.productionOn ?? '未填写'}<br />{row.normalized.barcode ?? row.normalized.batch ?? '未填写'}</> },
    ] : view === 'AFTER_SALES' ? [
      { title: '里程分档 / MIS', width: 160, render: (_: unknown, row: LedgerItem) => <>{row.mileageBand ?? '未计算'}<br />{row.misTag ?? '未计算'} / {row.serviceMonths === null ? '月数未计算' : `${row.serviceMonths} 月`}</> },
      { title: '收件', width: 150, render: (_: unknown, row: LedgerItem) => <>{row.courierNumber ?? '未填写'}<br />{row.receivedOn ?? '日期未填写'}</> },
    ] : []),
    { title: '实际工程师', width: 140, render: (_, row) => { const person = candidates.find(candidate => candidate.assignmentId === row.qualityEngineerAssignmentId && candidate.userId === row.qualityEngineerId); return person?.fullName || person?.username || (row.qualityEngineerId ? '原跟进人（任职待核对）' : '待分配'); } },
    { title: '台账状态', width: 100, render: (_, row) => <Tag>{row.status === 'CLOSED' ? '已关闭' : '跟进中'}</Tag> },
  ];
  if (accessLost) return <main className="customer-quality-page"><Alert type="warning" showIcon title="访问已失效，当前列表、详情和草稿已清除。请重新登录或确认目标组织权限后重新进入。" /><LedgerError cause={error} /></main>;
  if (legacy) return <><div className="customer-ledger-legacy-banner"><Alert type="info" title="历史台账：旧契约登记 / 严格导入与历史报告，不代表 N4 正式登记。新业务请返回正式台账。" /><Button onClick={() => requestLeave(() => setLegacy(false))}>返回正式台账</Button></div><CustomerLegacyQualityPage /></>;
  return <main className="customer-quality-page">
    <header className="customer-quality-heading"><div><Typography.Text type="secondary">客户质量 · 正式台账</Typography.Text><Typography.Title level={1}>客诉台账</Typography.Title><Typography.Paragraph type="secondary">同一事实的全部、零公里和售后视图。登记数量唯一归口，台账状态与解析、8D 分开。</Typography.Paragraph></div><Space wrap><Button onClick={refresh} loading={loading}>刷新</Button><Button onClick={() => requestLeave(() => { detailController.current?.abort(); setDetail(undefined); setLegacy(true); })}>历史台账</Button></Space></header>
    <LedgerError cause={permissionError} /><LedgerError cause={error} />
    <LedgerError cause={auxiliaryError} />{auxiliaryError || auxiliaryLoading ? <Button loading={auxiliaryLoading} disabled={auxiliaryLoading} onClick={() => { if (life.current) void loadAuxiliary(life.current, true); }}>重试候选人员与客户</Button> : null}
    {authorized ? <>
      <section className="customer-quality-card">
        <div className="customer-ledger-views" role="group" aria-label="台账视图">{([['ALL', '全部'], ['ZERO_KM', '零公里'], ['AFTER_SALES', '售后']] as const).map(([value, label]) => <Button key={value} aria-label={label} type={view === value ? 'primary' : 'default'} aria-pressed={view === value} onClick={() => chooseView(value)}>{label}</Button>)}</div>
        <Space wrap className="customer-quality-toolbar"><Input.Search aria-label="搜索客诉" placeholder="编号、客户、描述或原填写" value={searchDraft} onChange={event => setSearchDraft(event.target.value)} onSearch={() => requestLeave(() => { setSearch(searchDraft); setPage(1); })} /><Checkbox checked={mine} onChange={event => { setMine(event.target.checked); setPage(1); }}>我负责的</Checkbox><Typography.Text type="secondary">权限范围内共 {result?.total ?? '—'} 条</Typography.Text>
          {permissions.includes('customer-quality:complaints:write') ? <><Button aria-label="人工登记客诉" type="primary" onClick={() => requestLeave(() => setEditorOpen(true))}>人工登记客诉</Button><Button aria-label="粘贴 / Excel 导入" onClick={() => requestLeave(() => setImportOpen(true))}>粘贴 / Excel 导入</Button></> : null}
        </Space>
        <details className="customer-ledger-filters"><summary>筛选客户、组件 / 项目、阶段、日期、工程师及状态</summary><div className="customer-ledger-form">
          <label><span>客户</span><select aria-label="筛选客户" value={customerId} onChange={event => { setCustomerId(event.target.value); setPage(1); }}><option value="">全部客户</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
          <label><span>组件号</span><Input aria-label="筛选组件号" value={component} onChange={event => { setComponent(event.target.value); setPage(1); }} /></label>
          <label><span>项目代码</span><Input aria-label="筛选项目代码" value={project} onChange={event => { setProject(event.target.value); setPage(1); }} /></label>
          <label><span>阶段</span><select aria-label="筛选阶段" value={stage} onChange={event => { setStage(event.target.value); setPage(1); }}><option value="">全部阶段</option><option value="NEW_PRODUCT">新品</option><option value="MASS_PRODUCTION">量产</option></select></label>
          <label><span>发生日期从</span><Input type="date" aria-label="发生日期从" value={from} onChange={event => { setFrom(event.target.value); setPage(1); }} /></label>
          <label><span>发生日期至</span><Input type="date" aria-label="发生日期至" value={to} onChange={event => { setTo(event.target.value); setPage(1); }} /></label>
          <label><span>工程师</span><select aria-label="筛选工程师" value={engineer} onChange={event => { setEngineer(event.target.value); setPage(1); }}><option value="">全部工程师</option>{[...new Map(candidates.map(person => [person.userId, person])).values()].map(person => <option key={person.userId} value={person.userId}>{person.fullName || person.username || person.userId}</option>)}</select></label>
          <label><span>台账状态</span><select aria-label="筛选台账状态" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">全部状态</option><option value="FOLLOWING">跟进中</option><option value="CLOSED">已关闭</option></select></label>
        </div></details>
        {loading ? <div className="customer-quality-loading"><Spin /></div> : error ? <Button onClick={refresh}>重试台账读取</Button> : <Table<LedgerItem> className="customer-ledger-table" tableLayout="fixed" rowKey="id" dataSource={result?.items ?? []} columns={columns} scroll={{ x: view === 'ALL' ? 1350 : 1650 }} locale={{ emptyText: <Empty description="权限范围内暂无符合条件的客诉" /> }} pagination={{ current: page, pageSize: 20, total: result?.total ?? 0, showSizeChanger: false, onChange: next => { setPage(next); } }} />}
      </section>
      {detailLoading && !detail ? <Spin /> : null}<LedgerError cause={detailError} />
      {detailError && selectedId.current ? <Button onClick={() => { void openDetail(selectedId.current!).catch(() => undefined); }}>重试详情读取</Button> : null}
      {detail ? <CustomerLedgerDetail key={detail.id} record={detail} candidates={candidates} customers={customers} userId={session?.userId} permissions={permissions} organizationId={organizationId} onDenied={revoke} onSaved={saved} refreshDetail={() => openDetail(detail.id, true)} renderAnalysis={renderAnalysis} /> : null}
      <section className="customer-quality-card"><details><summary>客户主数据</summary><CustomerMasterSection organizationId={organizationId} organizationPermissions={permissions} /></details></section>
      {editorOpen ? <CustomerLedgerEditor organizationId={organizationId} candidates={candidates} customers={customers} onDenied={revoke} onClose={() => setEditorOpen(false)} onSaved={saved} refreshDetail={async () => undefined} /> : null}
      {importOpen ? <CustomerLedgerImportPanel organizationId={organizationId} existing={result?.items ?? []} customers={customers} candidates={candidates} onDenied={revoke} onClose={() => setImportOpen(false)} onCommitted={() => setRevision(current => current + 1)} /> : null}
    </> : loading ? <Spin /> : <Typography.Paragraph>权限读取未完成，台账未加载。请重新进入页面重试。</Typography.Paragraph>}
  </main>;
}
