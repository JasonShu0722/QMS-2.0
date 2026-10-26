import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useCompletedSessionNavigation, useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { Alert, Breadcrumb, Button, Card, Space, Spin, Tag, Typography } from 'antd';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ApiError, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import * as api from './workflow-api';
import { WorkflowProperties } from './WorkflowProperties';
import { editableWorkflowGraph } from './workflow-graph';
import { workflowLabel } from './workflow-labels';
import { WorkflowClosurePreview } from './WorkflowClosurePreview';
import './workflows.css';

const WorkflowCanvas = lazy(() => import('./WorkflowCanvas').then((module) => ({ default: module.WorkflowCanvas })));
interface Props { definitionId: string; versionId: string }
type Action = 'save' | 'validate' | 'publish' | 'copy';
type Attempt = { key: string } & (
  { stage: 'validate'; body: Parameters<typeof api.validateWorkflow>[0] } |
  { stage: 'save'; body: Parameters<typeof api.saveWorkflow>[1] } |
  { stage: 'publish'; body: Parameters<typeof api.publishWorkflow>[1] } |
  { stage: 'copy'; body: Parameters<typeof api.copyWorkflow>[1] }
);
type Operation = { action: Action; graph: api.WorkflowGraph; description: string; changeNote: string; needsSave: boolean };
export function WorkflowDesignerPage(props: Props) {
  const session = useWorkTabsStore(state => state.sessionScope);
  return <Designer key={`${session}:${props.definitionId}:${props.versionId}`} {...props} session={session} />;
}

function Designer({ definitionId, versionId, session }: Props & { session?: string }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const requestLeave = useNavigationGuard();
  const completeSessionNavigation = useCompletedSessionNavigation();
  const openTab = useWorkTabsStore((state) => state.openTab);
  const [baseline, setBaseline] = useState<api.WorkflowDefinition>();
  const [graph, setGraph] = useState<api.WorkflowGraph>({ nodes: [], transitions: [] });
  const [description, setDescription] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<unknown>();
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [stale, setStale] = useState(false);
  const [uncertain, setUncertain] = useState<{ operation: Operation; attempt: Attempt }>();
  const [revision, setRevision] = useState(0);
  const [options, setOptions] = useState<api.WorkflowOptions>({ roles: [], users: [], permissions: [] });
  const [directorySearch, setDirectorySearch] = useState('');
  const [directoryError, setDirectoryError] = useState<unknown>();
  const lock = useRef(false);
  const lifetime = useRef<AbortController | undefined>(undefined);
  const accessRevoked = useRef(false);
  const current = () => !accessRevoked.current && !!lifetime.current && !lifetime.current.signal.aborted && useWorkTabsStore.getState().sessionScope === session;
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    const unsubscribe = useWorkTabsStore.subscribe(state => { if (state.sessionScope !== session) controller.abort(); });
    return () => { controller.abort(); unsubscribe(); };
  }, [session]);
  function report(cause: unknown) {
    setError(cause);
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403 || ['FEATURE_PERMISSION_DENIED', 'ORGANIZATION_SCOPE_DENIED', 'AUTH_SESSION_REQUIRED'].includes(cause.code))) {
      accessRevoked.current = true; lifetime.current?.abort(); setDenied(true); setBusy(false); setUncertain(undefined); setBaseline(undefined); setGraph({ nodes: [], transitions: [] });
      setDescription(''); setChangeNote(''); setSelected(''); setOptions({ roles: [], users: [], permissions: [] }); setDiagnostics([]); setDirectorySearch(''); setDirectoryError(undefined);
      if (cause.status === 401 || cause.code === 'AUTH_SESSION_REQUIRED') setUnauthorized(true);
    }
  }
  function accept(result: api.WorkflowDefinition) {
    setBaseline(result); setGraph(result.version.structureSnapshot); setDescription(result.description ?? '');
  }
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setError(undefined);
    api.getWorkflowVersion(definitionId, versionId, controller.signal).then((result) => {
      if (current() && !controller.signal.aborted) { accept(result); setChangeNote(''); setDenied(false); setStale(false); setUncertain(undefined); setDiagnostics([]); }
    }).catch((cause) => { if (current() && !controller.signal.aborted) report(cause); }).finally(() => { if (current() && !controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [definitionId, versionId, revision]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (!current()) return;
      api.getWorkflowOptions(directorySearch, controller.signal).then((result) => { if (current() && !controller.signal.aborted) { setOptions(result); setDirectoryError(undefined); } })
        .catch((cause) => { if (current() && !controller.signal.aborted) { setDirectoryError(cause); if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403 || ['AUTH_SESSION_REQUIRED', 'FEATURE_PERMISSION_DENIED', 'ORGANIZATION_SCOPE_DENIED'].includes(cause.code))) report(cause); } });
    }, 200);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [directorySearch]);
  const draftDirty = !!baseline && (JSON.stringify(graph) !== JSON.stringify(baseline.version.structureSnapshot) || description !== (baseline.description ?? ''));
  const dirty = !denied && (draftDirty || (baseline?.version.status === 'DRAFT' && changeNote.length > 0));
  useUnsavedChanges(dirty);
  useNavigationBusy(busy || !!uncertain);
  useEffect(() => {
    if (!unauthorized || session !== useWorkTabsStore.getState().sessionScope) return;
    completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
  }, [unauthorized, session, completeSessionNavigation, navigate]);
  const frozen = baseline?.version.status !== 'DRAFT';
  const readOnly = frozen || denied || busy || !!uncertain || stale;
  useEffect(() => {
    if (baseline) openTab({ id: location.pathname, path: `${location.pathname}${location.search}`, title: `${baseline.name} · ${t(baseline.version.status === 'DRAFT' ? '编辑' : '查看')}` });
  }, [baseline, location.pathname, location.search, openTab, t]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  function edit(next: api.WorkflowGraph) { if (!readOnly) { setGraph(next); setDiagnostics([]); } }
  async function act(action: Action, retry?: { operation: Operation; attempt: Attempt }) {
    if (!current() || !baseline || lock.current || busy || denied || stale || (!retry && uncertain) || (frozen && action !== 'copy')) return;
    lock.current = true; setBusy(true); setError(undefined);
    let attempt: Attempt | undefined;
    let operation = retry?.operation;
    try {
      operation ??= { action, graph: structuredClone(graph), description, changeNote, needsSave: draftDirty };
      const options = (key: string) => ({ key, signal: lifetime.current!.signal });
      let saved = baseline;
      if ((action === 'validate' || action === 'publish') && (!retry || retry.attempt.stage === 'validate')) {
        attempt = retry?.attempt.stage === 'validate' ? retry.attempt : { stage: 'validate', body: editableWorkflowGraph(operation.graph), key: crypto.randomUUID() };
        const validation = await api.validateWorkflow(attempt.body, options(attempt.key));
        if (!current()) return;
        setDiagnostics(validation.errors);
        if (!validation.valid || action === 'validate') { setUncertain(undefined); return; }
      }
      if (action === 'save' || (action === 'publish' && operation.needsSave && retry?.attempt.stage !== 'publish')) {
        attempt = retry?.attempt.stage === 'save' ? retry.attempt : { stage: 'save', body: { ...editableWorkflowGraph(operation.graph), description: operation.description, draftVersionId: saved.version.id, expectedRevision: saved.revision }, key: crypto.randomUUID() };
        saved = await api.saveWorkflow(definitionId, attempt.body, options(attempt.key));
        if (!current()) return;
        accept(saved);
      }
      if (action === 'publish') {
        attempt = retry?.attempt.stage === 'publish' ? retry.attempt : { stage: 'publish', body: { draftVersionId: saved.version.id, expectedRevision: saved.revision, changeNote: operation.changeNote }, key: crypto.randomUUID() };
        const published = await api.publishWorkflow(definitionId, attempt.body, options(attempt.key));
        if (!current()) return;
        accept(published); setChangeNote('');
      }
      if (action === 'copy') {
        attempt = retry?.attempt.stage === 'copy' ? retry.attempt : { stage: 'copy', body: { sourceVersionId: saved.version.id, expectedRevision: saved.revision, description: operation.description }, key: crypto.randomUUID() };
        const copied = await api.copyWorkflow(definitionId, attempt.body, options(attempt.key));
        if (!current()) return;
        navigate(api.workflowPath(copied));
      }
      setUncertain(undefined);
    } catch (cause) {
      if (!current()) return;
      report(cause);
      if (!current()) return;
      if (cause instanceof ApiError && (cause.status === 409 || ['CONCURRENCY_CONFLICT', 'WORKFLOW_VERSION_IMMUTABLE', 'WORKFLOW_DRAFT_EXISTS'].includes(cause.code))) { setStale(true); setUncertain(undefined); }
      else if (attempt && operation && (attempt === retry?.attempt || api.unknownWorkflowWrite(cause))) setUncertain({ operation, attempt });
      else setUncertain(undefined);
    } finally { lock.current = false; if (current()) setBusy(false); }
  }
  function addNode() {
    if (readOnly) return;
    const id = crypto.randomUUID();
    edit({ ...graph, nodes: [...graph.nodes, { id, type: 'ACTION', name: t('处理'), config: { editorPosition: { x: 40, y: 80 + graph.nodes.length * 100 } } }] });
    setSelected(id);
  }
  function locate(diagnostic: string) {
    const id = diagnostic.slice(diagnostic.indexOf(':') + 1);
    const node = graph.nodes.find((entry) => entry.id === id);
    const edge = graph.transitions.find((entry) => entry.id === id);
    if (node || edge) setSelected(node?.id ?? edge!.from);
    document.getElementById(node ? 'workflow-properties' : `workflow-edge-${id}`)?.scrollIntoView?.({ block: 'nearest' });
  }
  const conflict = stale;
  const selectedClosure = graph.nodes.find(node => node.id === selected && node.type === 'APPROVAL' && node.config?.closureReview);
  return <section className="workflow-editor">
    {baseline && <nav aria-label={t('流程对象层级')}><Breadcrumb items={[
      { title: <Link to="/app/announcements">{t('系统服务')}</Link> },
      { title: <Link to="/app/workflow-designer">{t('流程设计')}</Link> },
      { title: baseline.name },
      { title: `${t(baseline.version.status === 'DRAFT' ? '草稿编辑' : baseline.version.status === 'PUBLISHED' ? '已发布查看' : '已停用版本查看')} · ${t('版本')} ${baseline.version.version}` },
    ]} /></nav>}
    <Link to="/app/workflow-designer">{t('受控流程列表')}</Link>
    <header className="workflow-heading"><div><Typography.Title level={2}>{baseline?.name ?? t('流程设计器')}</Typography.Title>
      {baseline && <Space><code>{baseline.code}</code><Tag>{t(workflowLabel(baseline.version.status))}</Tag><span>{t('版本')} {baseline.version.version}</span><span>{t('编辑修订')} {baseline.revision}</span>{dirty && <Tag color="orange">{t('未保存')}</Tag>}</Space>}
    </div><Space wrap>
      <Button aria-label={t('保存草稿')} disabled={readOnly} onClick={() => void act('save')}>{t('保存草稿')}</Button>
      <Button aria-label={t('校验流程')} disabled={readOnly} onClick={() => void act('validate')}>{t('校验流程')}</Button>
      <Button aria-label={t('发布流程')} type="primary" disabled={readOnly} onClick={() => void act('publish')}>{t('发布流程')}</Button>
      {baseline?.version.status === 'PUBLISHED' && <Button disabled={busy || denied || !!uncertain || stale} onClick={() => void act('copy')}>{t('复制为新草稿')}</Button>}
    </Space></header>
    {!!error && <Alert type="error" title={t(conflict ? '流程已被修改，本地草稿仍保留，请确认后重新加载。' : safeAccountError(error))} description={error instanceof ApiError && error.traceId ? <code>{error.traceId}</code> : undefined} />}
    {uncertain && <Alert type="warning" title={t('流程请求结果未确认，输入已冻结，只能重试原请求。')} description={t('重试若遇版本冲突，请显式刷新核对服务端结果；不会自动再次保存或发布。')} action={<Button disabled={busy || denied} onClick={() => void act(uncertain.operation.action, uncertain)}>{t('重试原流程请求')}</Button>} />}
    {(error || baseline) && <Button disabled={busy || denied || !!uncertain} onClick={() => requestLeave(() => setRevision((value) => value + 1))}>{t('重新加载流程')}</Button>}
    {frozen && baseline && <Alert type="info" title={t('已发布版本只读；如需修改，请复制为新草稿。')} />}
    {busy && <Spin aria-label={t('加载中')} />}
    {baseline && <>
      <div className="workflow-fields"><label>{t('流程说明')}<textarea aria-label={t('流程说明')} value={description} maxLength={1000} disabled={readOnly} onChange={(event) => setDescription(event.target.value)} /></label>
        <label>{t('发布说明')}<input aria-label={t('发布说明')} value={changeNote} maxLength={500} disabled={readOnly} onChange={(event) => setChangeNote(event.target.value)} /></label></div>
      {!!diagnostics.length && <Card title={t('流程校验结果')}><ul>{diagnostics.map((diagnostic) => <li key={diagnostic}><Button type="link" onClick={() => locate(diagnostic)}>{diagnostic}</Button></li>)}</ul></Card>}
      <div className="workflow-layout"><div><Suspense fallback={<Spin />}><WorkflowCanvas graph={graph} selected={selected} readOnly={readOnly} onSelect={setSelected} onChange={edit} /></Suspense>
        <Card title={t('流程节点')} extra={<Button disabled={readOnly} onClick={addNode}>{t('添加节点')}</Button>}><ol className="workflow-node-list">{graph.nodes.map((node) => <li key={node.id}>
          <Button type={selected === node.id ? 'primary' : 'default'} aria-label={`${t('编辑节点')} ${node.name}`} onClick={() => setSelected(node.id)}>{node.name || t('未命名节点')}</Button><Tag>{t(workflowLabel(node.type))}</Tag>
        </li>)}</ol></Card></div>
        <div id="workflow-properties"><label>{t('搜索处理人和角色')}<input aria-label={t('搜索处理人和角色')} value={directorySearch} onChange={(event) => setDirectorySearch(event.target.value)} /></label>
          {!!directoryError && <Alert type="error" title={t('处理范围选项加载失败')} />}
          <WorkflowProperties graph={graph} selected={selected} readOnly={readOnly} options={options} onChange={edit} onSelect={setSelected} />
          {selectedClosure?.config?.closureReview && <WorkflowClosurePreview key={selectedClosure.id} policy={selectedClosure.config.closureReview.policy} disabled={busy || denied || !!uncertain} />}
        </div></div>
    </>}
  </section>;
}
