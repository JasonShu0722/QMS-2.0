import type { components } from '@qms/contracts';
import { Alert, Button, Checkbox, Input, Modal, Pagination, Space, Spin, Table } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiRequest, getSession, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ledgerDenied, useCustomerLedgerWrite } from '../customer-quality/customer-ledger-write';
import { InternalEightDIssueDrawer } from '../internal-eight-d/InternalEightDIssueDrawer';
import { SupplierSourceCopyDialog } from '../supplier-eight-d-source/SupplierSourceCopyDialog';

type Selection = components['schemas']['NewProductDefectSelectionDto'];
type DefectPage = components['schemas']['ProcessDefectPageDto'];
type Defect = DefectPage['items'][number];
type Props = { projectId: string; organizationId: string; projectContext?: Pick<components['schemas']['NewProductProjectDetailDto'], 'code' | 'product_code'>; active: boolean; onDenied?: (cause: unknown) => void };
export function NewProductEightDPanel(props: Props) {
  const scope = useWorkTabsStore(state => state.sessionScope);
  return <SourcePanel key={`${scope}:${props.organizationId}:${props.projectId}`} {...props} />;
}
function SourcePanel({ projectId, organizationId, projectContext, active, onDenied }: Props) {
  const { t } = useLanguage();
  const scope = useWorkTabsStore(state => state.sessionScope);
  const base = `/api/v1/new-product-quality/projects/${encodeURIComponent(projectId)}/defect-selections`;
  const [permissions, setPermissions] = useState<string[]>([]);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectionPage, setSelectionPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [denied, setDenied] = useState(false);
  const [revision, setRevision] = useState(0);
  const [including, setIncluding] = useState(false);
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [projectCode, setProjectCode] = useState(projectContext?.code ?? '');
  const [productCode, setProductCode] = useState('');
  const [candidateFilters, setCandidateFilters] = useState({ projectCode: projectContext?.code ?? '', productCode: '' });
  const [page, setPage] = useState(1);
  const [defects, setDefects] = useState<DefectPage>();
  const [defectsError, setDefectsError] = useState<unknown>();
  const [issueOpen, setIssueOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [issued, setIssued] = useState<components['schemas']['NewProductEightDIssueResultDto']>();
  const lifetime = useRef<AbortController>(undefined);
  const denyCallback = useRef(onDenied); denyCallback.current = onDenied;
  const leave = useNavigationGuard();
  function revoke(cause: unknown) {
    lifetime.current?.abort(); setDenied(true); setPermissions([]); setSelections([]); setSelected([]); setDefects(undefined); setIssued(undefined); setIssueOpen(false); setCopyOpen(false); setIncluding(false); setReason(''); setError(cause);
    denyCallback.current?.(cause);
  }
  const writer = useCustomerLedgerWrite(revoke);
  useUnsavedChanges(including && (!!reason || writer.uncertain));
  useNavigationBusy(writer.busy);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    const unsubscribe = useWorkTabsStore.subscribe(state => { if (state.sessionScope !== scope) controller.abort(); });
    setLoading(true); setError(undefined);
    void (async () => {
      const actor = await getSession(); controller.signal.throwIfAborted();
      if (actor.accountType !== 'INTERNAL' || useWorkTabsStore.getState().sessionScope !== scope || scope && scope !== `${actor.accountType}:${actor.organizationId}:${actor.userId}`) throw new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: '' }, 401);
      const access = await apiRequest<components['schemas']['PermissionsResponseDto']>(`/api/v1/system/my-permissions?organizationId=${encodeURIComponent(organizationId)}`, { signal: controller.signal });
      controller.signal.throwIfAborted();
      if (!access.permissions?.includes('new-product-quality:projects:read') || !access.permissions.includes('process-quality:defects:read')) throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, 403);
      const rows = await apiRequest<Selection[]>(`${base}?organizationId=${encodeURIComponent(organizationId)}`, { signal: controller.signal });
      controller.signal.throwIfAborted(); setPermissions(access.permissions); setSelections(rows);
      setSelected(previous => previous.filter(id => rows.some(row => row.id === id)));
      setSelectionPage(previous => Math.min(previous, Math.max(1, Math.ceil(rows.length / 20))));
    })().catch(cause => { if (!controller.signal.aborted) { if (ledgerDenied(cause)) revoke(cause); else setError(cause); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); unsubscribe(); };
  }, [base, organizationId, scope, revision]);
  useEffect(() => {
    if (!including || denied) return;
    const controller = new AbortController(); setDefects(undefined); setDefectsError(undefined);
    const query = new URLSearchParams({ organizationId, page: String(page), pageSize: '20', search });
    if (candidateFilters.projectCode) query.set('projectCode', candidateFilters.projectCode);
    if (candidateFilters.productCode) query.set('productCode', candidateFilters.productCode);
    void apiRequest<DefectPage>(`/api/v1/process-quality/defects?${query}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setDefects(value); }).catch(cause => { if (!controller.signal.aborted) { if (ledgerDenied(cause)) revoke(cause); else setDefectsError(cause); } });
    return () => controller.abort();
  }, [including, denied, organizationId, search, candidateFilters, page, revision]);
  const canInclude = active && permissions.includes('new-product-quality:projects:write');
  const canIssue = active && permissions.includes('new-product-quality:issues:issue');
  const canCopy = active && permissions.includes('supplier-quality:issues:copy');
  async function include(row: Defect) {
    if (!canInclude || writer.busy || denied) return;
    const body: components['schemas']['SelectNewProductDefectDto'] = { organizationId, defectId: row.id, expectedVersion: row.version, ...(reason.trim() ? { reason: reason.trim() } : {}) };
    setError(undefined);
    try {
      const value = await writer.write<Selection>(base, body, 'POST');
      setSelections(previous => [...previous.filter(item => item.id !== value.id), value]); setIncluding(false); setReason('');
    } catch (cause) { if (!lifetime.current?.signal.aborted) setError(cause); }
  }
  return <section aria-label="新品同源8D入口">
    {!!error && <Alert showIcon type={denied ? 'warning' : 'error'} title={safeAccountError(error)} />}
    {!denied && <>
      <Space wrap><h3>新品同源来源</h3><Button disabled={loading || writer.busy} onClick={() => leave(() => setRevision(value => value + 1))}>刷新新品来源</Button>
        {canInclude && <Button disabled={writer.busy} onClick={() => leave(() => setIncluding(true))}>纳入过程事实</Button>}
        {canIssue && <Button disabled={!selected.length || writer.busy || loading} onClick={() => leave(() => setIssueOpen(true))}>发起新品8D</Button>}
        {canCopy && <Button disabled={!selected.length || writer.busy || loading || !!error} onClick={() => leave(() => setCopyOpen(true))}>复制为供应商草稿</Button>}
        {(canIssue || canCopy) && <span>已选择 {selected.length}/100 条</span>}
      </Space>
      <p>{t('按项目映射及发生/纳入依据选择过程事实，纳入后发起正式8D；不改写原事实，不以问题关闭替代阶段门。')}</p>
      {issued && <Alert type="success" title={`问题 ${issued.problem.reportNumber} 已发起`} action={<Link to={`/app/problem-workspace/${encodeURIComponent(issued.problem.id)}`}>查看问题</Link>} />}
      {loading ? <Spin aria-label="正在加载新品来源" /> : !selections.length ? <p>暂无已纳入来源</p> : selections.slice((selectionPage - 1) * 20, selectionPage * 20).map(row => <div key={row.id}>
        {(canIssue || canCopy) && <Checkbox aria-label={`选择新品来源 ${row.id}`} checked={selected.includes(row.id)} disabled={writer.busy || selected.length >= 100 && !selected.includes(row.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, row.id] : previous.filter(id => id !== row.id))} />}
        <span>{String(row.source_snapshot.description ?? row.id)}</span> · v{row.source_version}{row.selection_reason ? <p>{row.selection_reason}</p> : null}
      </div>)}
      {!loading && selections.length > 20 && <Pagination aria-label="新品来源分页" current={selectionPage} pageSize={20} total={selections.length} showSizeChanger={false} onChange={setSelectionPage} />}
      {issueOpen && <InternalEightDIssueDrawer domain="new-product-quality" organizationId={organizationId} sources={selections.filter(row => selected.includes(row.id)).map(row => ({ id: row.id, version: row.source_version, organizationId: row.organization_id, projectId: row.project_id, description: String(row.source_snapshot.description ?? row.id) }))} onDenied={revoke} onClose={() => setIssueOpen(false)} onIssued={value => { setIssued(value); setIssueOpen(false); setSelected([]); }} />}
      {canCopy && copyOpen && <SupplierSourceCopyDialog organizationId={organizationId} sources={selections.filter(row => selected.includes(row.id)).map(row => ({ kind: 'NEW_PRODUCT_SELECTION', sourceId: row.id, sourceVersion: row.source_version }))} onDenied={revoke} onClose={() => setCopyOpen(false)} />}
      {including && <Modal open title="纳入过程事实" footer={null} onCancel={() => { if (!writer.busy) leave(() => { writer.discard(); setIncluding(false); setReason(''); }, true); }} closable={!writer.busy} mask={{ closable: !writer.busy }} keyboard={!writer.busy}>
        {!!error && <Alert role="alert" type="error" showIcon title={safeAccountError(error)} />}
        <p>仅提交明确选择的事实。服务器复验项目映射和当前新品资格；历史量产/已归档项目只保留既有记录。</p>
        <p>当前项目：{projectContext?.code ?? projectId}；当前组件线索：{projectContext?.product_code || '未提供'}。</p>
        <p>以下仅为台账字段筛选，不代表有效项目映射或纳入资格；筛选无结果时可显式调整条件，纳入仍由服务器复验。</p>
        <Space wrap>
          <label>候选项目代码<Input aria-label="候选项目代码" value={projectCode} maxLength={100} disabled={writer.busy || writer.uncertain} onChange={event => setProjectCode(event.target.value)} /></label>
          <label>候选组件号<Input aria-label="候选组件号" value={productCode} placeholder={projectContext?.product_code || undefined} maxLength={100} disabled={writer.busy || writer.uncertain} onChange={event => setProductCode(event.target.value)} /></label>
          <Button disabled={writer.busy || writer.uncertain} onClick={() => { setCandidateFilters({ projectCode: projectCode.trim(), productCode: productCode.trim() }); setPage(1); }}>筛选候选</Button>
        </Space>
        <label>纳入依据（可空）<Input.TextArea aria-label="纳入依据（可空）" value={reason} maxLength={2000} disabled={writer.busy || writer.uncertain} onChange={event => setReason(event.target.value)} /></label>
        {writer.uncertain && <Alert type="warning" title="纳入结果未知，输入已冻结；只能重试原纳入请求。" />}
        <Input.Search aria-label="搜索过程事实" disabled={writer.busy || writer.uncertain} onSearch={value => { setSearch(value); setPage(1); }} />
        {defectsError ? <Alert type="error" title={safeAccountError(defectsError)} action={<Button onClick={() => setRevision(value => value + 1)}>重试来源读取</Button>} /> : <Table<Defect> rowKey="id" size="small" loading={!defects} pagination={false} scroll={{ x: 460 }} dataSource={defects?.items ?? []} columns={[
          { title: '过程事实', dataIndex: 'description' }, { title: '版本', dataIndex: 'version' },
          { title: '纳入', render: (_, row) => <Button aria-label={`纳入 ${row.description}`} disabled={writer.busy || !writer.uncertain && selections.some(item => item.defect_id === row.id)} onClick={() => void include(row)}>{writer.uncertain ? '重试原纳入请求' : '纳入'}</Button> },
        ]} />}
        {defects && <Pagination current={page} pageSize={20} total={defects.total} disabled={writer.busy || writer.uncertain} showSizeChanger={false} onChange={setPage} />}
      </Modal>}
    </>}
  </section>;
}
