import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Empty, Select, Space, Spin, Tag, Typography } from 'antd';
import { LedgerTable, useLedgerPageSize } from '../../ui/ledger';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useCompletedSessionNavigation, useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import * as api from './workflow-api';
import { workflowLabel } from './workflow-labels';
import { WorkflowClosureTemplateDialog } from './WorkflowClosureTemplateDialog';
import { ProcessEightDBinding, type EightDBindingDomain } from './ProcessEightDBinding';
import { SupplierEightDBinding } from './SupplierEightDBinding';
import './workflows.css';

type CreateAttempt = { action: 'create'; path: '/api/v1/workflows'; method: 'POST'; rawBody: string; key: string };

export function WorkflowListPage({ expectedOrganizationId }: { expectedOrganizationId?: string } = {}) {
  const session = useWorkTabsStore(state => state.sessionScope);
  return <List key={`${session ?? ''}:${expectedOrganizationId ?? ''}`} session={session} expectedOrganizationId={expectedOrganizationId} />;
}
function List({ session, expectedOrganizationId }: { session?: string; expectedOrganizationId?: string }) {
  const [pageSize, setPageSize] = useLedgerPageSize('workflows', expectedOrganizationId);
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const [page, setPage] = useState<Awaited<ReturnType<typeof api.getWorkflows>>>();
  const [history, setHistory] = useState<Awaited<ReturnType<typeof api.getWorkflow>>>();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<unknown>();
  const [actionError, setActionError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [bindingDomain, setBindingDomain] = useState<EightDBindingDomain>('process-quality');
  const [createdPath, setCreatedPath] = useState<string>();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [denied, setDenied] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [uncertain, setUncertain] = useState<CreateAttempt>();
  const [stale, setStale] = useState(false);
  const draftDirty = !denied && creating && Boolean(code.trim() || name.trim());
  const requestLeave = useNavigationGuard();
  const completeSessionNavigation = useCompletedSessionNavigation();
  useUnsavedChanges(draftDirty);
  useNavigationBusy(busy || !!uncertain);
  const lock = useRef(false);
  const lifetime = useRef<AbortController | undefined>(undefined);
  const revoked = useRef(false);
  const current = () => !revoked.current && !!lifetime.current && !lifetime.current.signal.aborted && useWorkTabsStore.getState().sessionScope === session;
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    const unsubscribe = useWorkTabsStore.subscribe(state => { if (state.sessionScope !== session) controller.abort(); });
    return () => { controller.abort(); unsubscribe(); };
  }, [session]);
  function report(cause: unknown) {
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403 || ['AUTH_SESSION_REQUIRED', 'FEATURE_PERMISSION_DENIED', 'ORGANIZATION_SCOPE_DENIED'].includes(cause.code))) {
      revoked.current = true; lifetime.current?.abort(); setDenied(true); setBusy(false); setLoading(false);
      setPage(undefined); setHistory(undefined); setCreating(false); setCode(''); setName(''); setCreatedPath(undefined); setTemplateOpen(false); setUncertain(undefined); setStale(false);
      if (cause.status === 401 || cause.code === 'AUTH_SESSION_REQUIRED') setUnauthorized(true);
    }
  }
  useEffect(() => {
    if (!unauthorized || session !== useWorkTabsStore.getState().sessionScope) return;
    completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
  }, [unauthorized, session, completeSessionNavigation, navigate]);
  useEffect(() => {
    if (!createdPath || busy || !current()) return;
    // The guard registrations above must clear before entering the created draft.
    setCreatedPath(undefined);
    navigate(createdPath);
  }, [busy, createdPath, navigate]);
  useEffect(() => {
    const controller = new AbortController();
    // A late pre-conflict read must not unlock creation; only an explicit refresh can.
    const checkingCreateConflict = stale;
    setLoading(true); setError(undefined);
    const timer = setTimeout(() => {
      api.getWorkflows(new URLSearchParams({ search, ...(status ? { status } : {}), offset: String(offset), pageSize: String(pageSize) }), controller.signal)
        .then((result) => { if (current() && !controller.signal.aborted) {
          if (expectedOrganizationId && result.items.some(item => item.organizationId !== expectedOrganizationId)) throw new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: '' }, 403);
          setPage(result); if (checkingCreateConflict) { setStale(false); setActionError(undefined); }
        } })
        .catch((cause) => { if (current() && !controller.signal.aborted) { setError(cause); setPage(undefined); report(cause); } })
        .finally(() => { if (current() && !controller.signal.aborted) setLoading(false); });
    }, 150);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [search, status, offset, pageSize, revision]);
  async function act(id?: string, retry?: CreateAttempt) {
    if (!current() || lock.current || stale || (!retry && uncertain)) return;
    lock.current = true; setBusy(true); setActionError(undefined);
    let attempt: CreateAttempt | undefined;
    try {
      if (id) {
        const result = await api.getWorkflow(id, lifetime.current!.signal);
        if (current()) {
          if (expectedOrganizationId && (result.organizationId !== expectedOrganizationId || result.id.toLowerCase() !== id.toLowerCase()
            || result.versions.some(version => version.workflowDefinitionId.toLowerCase() !== id.toLowerCase()))) throw new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: '' }, 403);
          setHistory(result);
        }
      } else {
        attempt = retry ?? { action: 'create', path: '/api/v1/workflows', method: 'POST', rawBody: JSON.stringify({ code: code.trim(), name: name.trim(), ...api.initialGraph() }), key: crypto.randomUUID() };
        const result = await api.createWorkflow(attempt.rawBody, { signal: lifetime.current!.signal, key: attempt.key });
        if (current()) {
          if (expectedOrganizationId && result.organizationId !== expectedOrganizationId) throw new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: '' }, 403);
          setUncertain(undefined); setCreating(false); setCode(''); setName(''); setCreatedPath(api.workflowPath(result));
        }
      }
    } catch (cause) {
      if (!current()) return;
      setActionError(cause); report(cause);
      if (!current() || !attempt) return;
      if (cause instanceof ApiError && (cause.status === 409 || cause.code === 'CONCURRENCY_CONFLICT')) { setStale(true); setUncertain(undefined); }
      else setUncertain(retry || api.unknownWorkflowWrite(cause) ? attempt : undefined);
    }
    finally { lock.current = false; if (current()) setBusy(false); }
  }
  const displayedError = actionError ?? error;
  const createFrozen = denied || busy || !!uncertain || stale;
  return <section className="workflow-list">
    <header className="workflow-heading"><Typography.Title level={2}>{t('受控流程列表')}</Typography.Title>
      <Space wrap><Button disabled={createFrozen || templateBusy || !!error} onClick={() => requestLeave(() => { setCreating(false); setCode(''); setName(''); setTemplateOpen(true); })}>{locale === 'en-US' ? 'Initialize closure review template' : '初始化关闭审核模板'}</Button>
      <Button type="primary" disabled={createFrozen || templateBusy || templateOpen || !!error} onClick={() => {
        if (creating) requestLeave(() => { setCreating(false); setCode(''); setName(''); });
        else setCreating(true);
      }}>{t('新建流程')}</Button></Space></header>
    {templateOpen && <WorkflowClosureTemplateDialog onClose={() => setTemplateOpen(false)} onBusyChange={setTemplateBusy} onCreated={result => {
      if (!current()) return;
      if (expectedOrganizationId && result.organizationId !== expectedOrganizationId) { const cause = new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: '' }, 403); setActionError(cause); report(cause); return; }
      setTemplateOpen(false); setCreatedPath(api.workflowPath(result));
    }} />}
    {!!displayedError && <Alert type="error" title={t(stale ? error ? '刷新流程列表失败，创建输入仍保留，请重试刷新核对。' : '创建结果需核对，输入已保留，请显式刷新流程列表。' : safeAccountError(displayedError))} description={displayedError instanceof ApiError && displayedError.traceId ? <code>{displayedError.traceId}</code> : undefined}
      action={error && !stale ? <Button disabled={createFrozen} aria-label={t('重试')} onClick={() => setRevision((value) => value + 1)}>{t('重试')}</Button> : undefined} />}
    {uncertain && <Alert type="warning" title={t('创建请求结果未确认，输入已冻结，只能重试原请求。')} action={<Button disabled={busy || denied} onClick={() => void act(undefined, uncertain)}>{t('重试原创建请求')}</Button>} />}
    {stale && <Button disabled={loading || busy || denied} onClick={() => setRevision(value => value + 1)}>{t('刷新流程列表核对')}</Button>}
    <Space wrap className="workflow-list__filters"><label>{t('搜索流程')}<input aria-label={t('搜索流程')} value={search} maxLength={100} disabled={createFrozen} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} /></label>
      <label>{t('状态')}<select aria-label={t('状态')} value={status} disabled={createFrozen} onChange={(event) => { setStatus(event.target.value); setOffset(0); }}>
        <option value="">{t('全部状态')}</option>{['DRAFT', 'PUBLISHED', 'RETIRED'].map((value) => <option key={value} value={value}>{t(workflowLabel(value))}</option>)}
      </select></label></Space>
    {creating && <Card title={t('新建流程')}><form onSubmit={(event) => { event.preventDefault(); void act(); }}>
      <label>{t('流程代码')}<input aria-label={t('流程代码')} required maxLength={100} value={code} disabled={createFrozen} onChange={(event) => setCode(event.target.value)} /></label>
      <label>{t('流程名称')}<input aria-label={t('流程名称')} required maxLength={200} value={name} disabled={createFrozen} onChange={(event) => setName(event.target.value)} /></label>

      <Button htmlType="submit" disabled={createFrozen || !code.trim() || !name.trim()}>{t('创建草稿')}</Button>
    </form></Card>}
    {loading ? <Spin aria-label={t('加载中')} /> : page && !page.items.length ? <Empty description={t('暂无流程')} /> : page && <LedgerTable ledgerId="workflows" organizationId={expectedOrganizationId} requiredColumnKeys={['code', 'actions']} className="workflow-list__table" rowKey="id" dataSource={page.items} pagination={false} scroll={{ x: 760 }} columns={[
      { key: 'code', title: t('代码'), render: (_, item) => <code>{item.code}</code> },
      { key: 'name', title: t('名称'), dataIndex: 'name' },
      { key: 'status', title: t('状态'), render: (_, item) => <Tag>{t(workflowLabel(item.version.status))}</Tag> },
      { key: 'version', title: t('版本'), render: (_, item) => item.version.version },
      { key: 'actions', title: t('操作'), render: (_, item) => <Space><Link to={`/console/workflows/${item.id}/${item.version.id}`}>{t('打开流程')}</Link><Button disabled={createFrozen} aria-label={`${t('版本历史')} ${item.name}`} onClick={() => void act(item.id)}>{t('版本历史')}</Button></Space> },
    ]} />}
    {page && <Space className="workflow-list__pagination"><span>{t('总数')} {page.total}</span><Select aria-label={locale === 'en-US' ? 'Page size' : '每页条数'} value={pageSize} options={[10, 20, 50, 100].map(value => ({ value, label: String(value) }))} disabled={createFrozen || loading} onChange={size => requestLeave(() => { if (!current()) return; setOffset(0); setPageSize(size); })} /><Button disabled={createFrozen || loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - pageSize))}>{t('上一页')}</Button>
      <Button disabled={createFrozen || loading || offset + pageSize >= page.total || offset + pageSize > 10000} onClick={() => setOffset((value) => value + pageSize)}>{t('下一页')}</Button></Space>}
    {history && <Card title={`${history.name} · ${t('版本历史')}`}><ul>{history.versions.map((version) => <li key={version.id}>
      <Link to={`/console/workflows/${history.id}/${version.id}`}>{t('版本')} {version.version} · {t(workflowLabel(version.status))}</Link>{version.changeNote && <span> — {version.changeNote}</span>}
    </li>)}</ul></Card>}
    <ProcessEightDBinding domain={bindingDomain} onDomainChange={setBindingDomain} />
    <SupplierEightDBinding />
  </section>;
}
