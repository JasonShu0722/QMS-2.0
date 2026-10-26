import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Space, Spin, Tabs, Tag } from 'antd';
import { useLocation } from 'react-router-dom';
import { ApiError, apiRequest, csrfToken } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { EightDDocumentEditor } from './EightDDocumentEditor';
import { EightDActionDialog, type EightDAction } from './EightDActionDialog';
import { EightDControlledReport } from './EightDControlledReport';
import { EightDEvidenceScopeContext } from './EightDEvidenceScope';
import { EightDHistory, EightDRounds } from './EightDHistory';
import { aborted, eightDFieldLocation, eightDPath, useEightDSeverityText, useEightDStyle, useEightDText, type EightDDocument, type EightDFields, type EightDRead, type EightDReport, type EightDWriteBody } from './eight-d';
import styles from './eight-d.module.css';

type Attempt = { path: string; method: 'POST' | 'PUT'; body: EightDWriteBody; key: string };
export function ProcessEightDWorkspace({ problemId, onAccessDenied }: { problemId: string; onAccessDenied?: (cause: unknown) => void }) {
  const session = useWorkTabsStore(state => state.sessionScope);
  const { search } = useLocation();
  const organizationId = new URLSearchParams(search).get('organizationId') || undefined;
  return <Workspace key={JSON.stringify([problemId, session, organizationId])} problemId={problemId} session={session} organizationId={organizationId} onAccessDenied={onAccessDenied} />;
}

function Workspace({ problemId, session, organizationId, onAccessDenied }: { problemId: string; session?: string; organizationId?: string; onAccessDenied?: (cause: unknown) => void }) {
  const text = useEightDText();
  const severityText = useEightDSeverityText();
  const statusLabels = new Map([
    ['PROCESSING', text('办理中', 'Processing')], ['IN_REVIEW', text('审批中', 'In review')], ['CLOSED', text('已关闭', 'Closed')],
  ]);
  const css = useEightDStyle();
  const requestLeave = useNavigationGuard();
  const [report, setReport] = useState<EightDReport>();
  const [draft, setDraft] = useState<EightDDocument>();
  const [dirty, setDirty] = useState(false);
  const [modalDirty, setModalDirty] = useState(false);
  const [action, setAction] = useState<EightDAction>();
  const [actionVisible, setActionVisible] = useState(true);
  const [fieldTarget, setFieldTarget] = useState<ReturnType<typeof eightDFieldLocation>>();
  const [tab, setTab] = useState('workspace');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<EightDFields>({});
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState<Attempt>();
  const [receipt, setReceipt] = useState(false);
  const [evidencePending, setEvidencePending] = useState(0);
  const pendingPanels = useRef(new Set<string>());
  const evidenceBlocks = useCallback((path: string) => pendingPanels.current.size > 0 && (path === `${eightDPath(problemId)}/submit` || path === `${eightDPath(problemId)}/reassign`), [problemId]);
  const lifetime = useRef(new AbortController());
  const alive = useRef(true);
  const revoked = useRef(false);
  const writing = useRef(false);
  const attempt = useRef<Attempt | undefined>(undefined);
  const loadVersion = useRef(0);
  const current = useCallback(() => alive.current && !revoked.current && session === useWorkTabsStore.getState().sessionScope && !lifetime.current.signal.aborted, [session]);
  const revoke = useCallback((cause: unknown) => {
    if (current() && cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
      revoked.current = true; lifetime.current.abort(); loadVersion.current++;
      setReport(undefined); setDraft(undefined); setDirty(false); setModalDirty(false); setAction(undefined); setFields({}); setError('');
      pendingPanels.current.clear(); setEvidencePending(0);
      setFieldTarget(undefined);
      attempt.current = undefined; setPending(undefined); writing.current = false; setBusy(false); setLoading(false); setDenied(true);
      onAccessDenied?.(cause);
    }
  }, [current, onAccessDenied]);
  const onPendingChange = useCallback((id: string, pending: boolean) => {
    if (!current()) return;
    const panels = pendingPanels.current;
    if (panels.has(id) === pending) return;
    if (pending) panels.add(id); else panels.delete(id);
    setEvidencePending(panels.size);
  }, [current]);
  const evidenceScope = useMemo(() => ({ onAccessDenied: revoke, onPendingChange }), [revoke, onPendingChange]);
  const read: EightDRead = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    if (!current()) throw new DOMException('Stale scope', 'AbortError');
    const signal = init.signal ? AbortSignal.any([lifetime.current.signal, init.signal]) : lifetime.current.signal;
    try {
      signal.throwIfAborted();
      const headers = init.body ? { 'x-csrf-token': await csrfToken(signal), ...init.headers } : init.headers;
      if (!current()) throw new DOMException('Stale scope', 'AbortError');
      signal.throwIfAborted();
      if (init.body && evidenceBlocks(path)) throw new ApiError({ code: 'EVIDENCE_PENDING', message: 'Evidence is still pending' }, 400);
      const value = await apiRequest<T>(path, { ...init, headers, signal }, { replayAfterReauthentication: false });
      if (!current()) throw new DOMException('Stale scope', 'AbortError');
      signal.throwIfAborted();
      return value;
    } catch (cause) { if (current()) revoke(cause); throw cause; }
  }, [current, revoke, evidenceBlocks]);
  const load = useCallback(async (preserveDraft = false) => {
    const version = ++loadVersion.current; setLoading(true); setError('');
    try {
      const query = new URLSearchParams(); if (organizationId) query.set('organizationId', organizationId);
      const value = await read<EightDReport>(`${eightDPath(problemId)}?${query}`);
      if (!current() || version !== loadVersion.current) return;
      if (value.problemId !== problemId || organizationId && value.organizationId !== organizationId) {
        revoke(new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: 'Scope mismatch' }, 403)); return;
      }
      setReport(value);
      if (!preserveDraft) { setDraft(value.document); setDirty(false); }
      setConflict(false); setFields({});
    } catch (cause) { if (current() && version === loadVersion.current && !aborted(cause)) setError(text('工作区加载失败，请重试。', 'Workspace could not be loaded. Retry.')); }
    finally { if (current() && version === loadVersion.current) setLoading(false); }
  }, [problemId, organizationId, read, current, revoke]);
  useEffect(() => {
    alive.current = true; lifetime.current = new AbortController();
    const unsubscribe = useWorkTabsStore.subscribe(() => { if (session !== useWorkTabsStore.getState().sessionScope) lifetime.current.abort(); });
    void load();
    return () => { alive.current = false; lifetime.current.abort(); unsubscribe(); };
  }, [load, session]);
  useUnsavedChanges(!denied && (dirty || modalDirty || !!pending || evidencePending > 0));
  useNavigationBusy(!denied && (busy || !!pending || evidencePending > 0));
  const focusField = useCallback(() => {
    if (!fieldTarget || !current()) return;
    const section = document.getElementById(`eight-d-${problemId}-${fieldTarget.section}`);
    const row = fieldTarget.row && Array.from(section?.querySelectorAll<HTMLElement>('[data-eight-d-path]') ?? []).find(element => element.dataset.eightDPath === fieldTarget.row);
    const target = row || section;
    target?.focus(); target?.scrollIntoView?.({ block: 'center' });
  }, [current, problemId, fieldTarget]);
  useEffect(() => { if (tab === 'workspace' && (!action || !actionVisible)) focusField(); }, [tab, action, actionVisible, focusField]);

  async function run(value: Attempt): Promise<boolean> {
    if (!current() || writing.current) return false;
    if (evidenceBlocks(value.path)) {
      setError(text('附件仍在处理中，请等待完成或取消操作表单后恢复证据。', 'Evidence is still pending. Wait or cancel the action form to resume evidence editing.'));
      return false;
    }
    attempt.current = value;
    writing.current = true; setBusy(true); setError(''); setFields({}); setReceipt(false); loadVersion.current++;
    try {
      const result = await read<EightDReport | unknown>(value.path, { method: value.method, headers: { 'Idempotency-Key': value.key }, body: JSON.stringify(value.body) });
      if (!current()) return false;
      attempt.current = undefined; setPending(undefined);
      if (!(action && !actionVisible && value.method === 'PUT' && value.path === eightDPath(problemId))) { setAction(undefined); setModalDirty(false); }
      setConflict(false); setReceipt(true);
      if (result && typeof result === 'object' && 'problemId' in result && 'document' in result && 'allowedActions' in result) {
        const updated = result as EightDReport;
        if (updated.problemId !== problemId || updated.organizationId !== report?.organizationId) {
          revoke(new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: 'Scope mismatch' }, 403)); return false;
        }
        setReport(updated); setDraft(updated.document); setDirty(false);
      } else await load();
      return true;
    } catch (cause) {
      if (!current() || aborted(cause)) return false;
      if (cause instanceof ApiError && cause.status !== undefined && cause.status < 500 && cause.status !== 408 && cause.status !== 425 && (cause.status === 409 || !pending && cause.code !== 'CLIENT_REAUTHENTICATION_COMPLETED')) {
        attempt.current = undefined; setPending(undefined); setFields(cause.fields);
        if (cause.status === 409) { setConflict(true); setError(text('版本冲突：草稿与表单已保留，请显式刷新基线后核对再保存。', 'Version conflict: draft and form retained. Explicitly refresh the baseline, compare, then save.')); }
        else setError(text('操作未通过，请核对缺项、资格与服务端返回的字段。', 'Operation rejected. Check required fields, eligibility and server field errors.'));
      } else {
        setPending(value);
        setError(text('写入结果未知：原内容与幂等键已冻结，仅可重试原请求。', 'Write outcome unknown: original content and idempotency key are frozen. Retry only the original request.'));
      }
      return false;
    } finally { writing.current = false; if (current()) setBusy(false); }
  }
  async function write(path: string, method: 'POST' | 'PUT', body: EightDWriteBody) {
    if (writing.current || attempt.current || conflict || !current()) return false;
    const value: Attempt = { path, method, body: structuredClone(body), key: crypto.randomUUID() };
    return run(value);
  }
  const download = useCallback(async (path: string) => {
    if (!current()) throw new DOMException('Stale scope', 'AbortError');
    onPendingChange('workspace-report-pdf', true);
    try {
      const response = await fetch(path, { credentials: 'include', signal: lifetime.current.signal, headers: { Accept: 'application/pdf' } });
      if (!current()) throw new DOMException('Stale scope', 'AbortError');
      if (!response.ok) throw new ApiError({ code: `HTTP_${response.status}`, message: 'PDF download refused' }, response.status);
      if (!response.headers.get('content-type')?.includes('application/pdf')) throw new Error('Invalid PDF response');
      const blob = await response.blob();
      if (!current()) throw new DOMException('Stale scope', 'AbortError');
      const url = URL.createObjectURL(blob);
      try { const link = document.createElement('a'); link.href = url; link.download = `${problemId}.pdf`; document.body.append(link); link.click(); link.remove(); }
      finally { URL.revokeObjectURL(url); }
    } catch (cause) { if (current()) revoke(cause); throw cause; }
    finally { onPendingChange('workspace-report-pdf', false); }
  }, [current, problemId, revoke, onPendingChange]);
  const can = (name: string) => report?.allowedActions.includes(name);
  const locked = busy || !!pending || conflict || loading;
  const open = (value: EightDAction) => { if (!locked && !dirty && !evidenceBlocks(`${eightDPath(problemId)}/${value}`)) { setAction(value); setFieldTarget(undefined); setActionVisible(true); setModalDirty(false); setReceipt(false); } };
  const close = () => {
    if (writing.current || attempt.current) return;
    // Closing this form preserves the editor and releases its temporary readOnly state.
    if (!modalDirty) { setAction(undefined); return; }
    setActionVisible(false);
    requestLeave(() => { setAction(undefined); setModalDirty(false); }, true);
  };
  const recovery = <>
    {error && <Alert role="alert" type="error" title={error} description={Object.keys(fields).length ? <ul>{Object.entries(fields).map(([path, values]) => <li key={path}>{eightDFieldLocation(path) ? <button type="button" disabled={busy || loading || !!pending || evidencePending > 0} onClick={() => { setFieldTarget(eightDFieldLocation(path)); setTab('workspace'); setActionVisible(false); }}><code>{path}</code></button> : <code>{path}</code>} · {values.join(' / ')}</li>)}</ul> : undefined} />}
    {conflict && <Button disabled={busy || loading} onClick={() => void load(true)}>{text('刷新基线并保留草稿', 'Refresh baseline and keep draft')}</Button>}
    {pending && <Button loading={busy} disabled={busy} onClick={() => void run(pending)}>{text('重试原请求', 'Retry original request')}</Button>}
  </>;
  if (denied) return <Alert role="alert" type="error" title={text('当前会话失效或无权访问，敏感内容已清除，请重新登录或联系授权人员。', 'Session expired or access denied. Sensitive content cleared. Sign in again or contact an authorized person.')} />;
  return <EightDEvidenceScopeContext.Provider value={evidenceScope}><section className={styles.workspace} style={css} aria-label={text('正式过程 8D 工作区', 'Formal process 8D workspace')}>
    <header className={styles.header}><div><h2>{report?.reportNumber ?? text('过程 8D', 'Process 8D')}</h2>{report && <Space wrap><Tag>{statusLabels.get(report.status) ?? report.status}</Tag><Tag>{severityText(report.severity)}</Tag><span>{text('内容版本', 'Content version')} {report.contentVersion} · {text('记录版本', 'Row version')} {report.version}</span></Space>}</div>
      <Button disabled={busy || !!pending || !!action || evidencePending > 0} onClick={() => requestLeave(() => void load())}>{text('刷新工作区', 'Refresh workspace')}</Button>
    </header>
    {(!action || !actionVisible) && recovery}
    {action && !actionVisible && <Button disabled={locked || dirty} onClick={() => setActionVisible(true)}>{text('返回操作表单', 'Return to action form')}</Button>}
    {receipt && <Alert role="status" type="success" title={text('服务端已确认保存 / 操作成功。', 'The server confirmed the save / operation.')} />}
    {loading && <Spin aria-label={text('正在加载工作区', 'Loading workspace')} />}
    {report && draft && <>
      <section className={styles.section}><h3>{text('当前责任与计划', 'Current responsibility and plans')}</h3><p>{text('负责人', 'Owner')}：{report.ownerUserId} · {text('专业审核人', 'Professional reviewer')}：{report.professionalUserId}</p><p>{text('责任科室', 'Responsible section')}：{report.responsibleSectionDepartmentId} · {text('协作者', 'Collaborators')}：{report.collaboratorUserIds.join(', ') || '—'}</p>
        <table aria-label={text('计划与实际', 'Planned and actual dates')}><thead><tr><th>{text('阶段', 'Stage')}</th><th>{text('计划', 'Planned')}</th><th>{text('实际', 'Actual')}</th></tr></thead><tbody>
          <tr><th scope="row">{text('分析', 'Analysis')}</th><td>{report.analysisDueAt ?? '—'}</td><td>{report.analysisCompletedAt ?? '—'}</td></tr>
          <tr><th scope="row">{text('完整提交', 'Complete submission')}</th><td>{report.submissionDueAt ?? '—'}</td><td>{report.submittedAt ?? '—'}</td></tr>
        </tbody></table><p>{text('关闭计划', 'Closure due')}：{report.closureDueAt ?? '—'}</p>
        <Space wrap>{can('save') && <Button type="primary" disabled={locked || !!action && actionVisible} loading={busy} onClick={() => void write(eightDPath(problemId), 'PUT', { organizationId: report.organizationId, expectedVersion: report.version, document: draft })}>{text('保存草稿', 'Save draft')}</Button>}
          {([
            ['analysis-complete', text('分析完成并设提交计划', 'Complete analysis and plan submission')], ['submit', text('完整提交', 'Submit complete report')], ['collaborators', text('维护协作者', 'Manage collaborators')], ['reassign', text('专业重派 / 科室内转派', 'Professional / within-section reassignment')], ['risk', text('调整风险', 'Change risk')], ['sources', text('调整来源', 'Change sources')], ['deadlines', text('设置期限', 'Set deadlines')],
          ] as [EightDAction, string][]).filter(([name]) => can(name)).map(([name, label]) => <Button key={name} disabled={locked || dirty || !!action || evidenceBlocks(`${eightDPath(problemId)}/${name}`)} onClick={() => open(name)}>{label}</Button>)}
          {can('submit') && <Button disabled={locked || dirty || !!action} onClick={() => open('extension')}>{text('申请延期', 'Request extension')}</Button>}
        </Space>{dirty && <p role="status">{text('有未保存草稿，请先保存，再执行提交或责任 / 来源 / 计划变更。', 'Unsaved draft: save before submitting or changing responsibility, sources or plans.')}</p>}
      </section>
      {report.closedRevisionId && <Alert type="info" title={text('已关闭：正文与批准版只读，批准版不随关闭后来源补充改变。', 'Closed: content and approved version are read-only. Source supplements do not change the approved version.')} />}
      <Tabs activeKey={tab} onChange={value => { if (!locked && !action) { if (pendingPanels.current.size) requestLeave(() => setTab(value)); else setTab(value); } }} items={[
        { key: 'workspace', label: text('工作区', 'Workspace'), children: tab === 'workspace' ? <EightDDocumentEditor problemId={problemId} document={draft} removalBlocked={evidencePending > 0} disabled={!can('save') || locked || !!action && actionVisible} read={read} onChange={change => { if (!writing.current && !attempt.current && can('save')) { setDraft(current => current ? change(current) : current); setDirty(true); setReceipt(false); } }} /> : null },
        { key: 'report', label: text('报告', 'Report'), children: tab === 'report' ? <EightDControlledReport report={report} read={read} download={download} /> : null },
        { key: 'history', label: text('轨迹', 'History'), children: tab === 'history' ? <EightDHistory report={report} read={read} /> : null },
      ]} />
      <EightDRounds problemId={problemId} read={read} revision={report.version} blocked={locked || dirty || !!action} onInboxClosed={() => void load()} />
      {action && <EightDActionDialog key={action} open={actionVisible} afterClose={focusField} action={action} report={report} read={read} write={write} frozen={!!pending || conflict || loading} busy={busy} recovery={recovery} onClose={close} onDirty={() => setModalDirty(true)} />}
    </>}
  </section></EightDEvidenceScopeContext.Provider>;
}
