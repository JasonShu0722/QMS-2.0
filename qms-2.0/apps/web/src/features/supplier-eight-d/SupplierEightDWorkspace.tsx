import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Space, Spin, Tag } from 'antd';
import { ApiError, apiRequest, csrfToken } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { EightDDocumentEditor, EightDField } from '../process-eight-d/EightDDocumentEditor';
import { EightDEvidenceScopeContext } from '../process-eight-d/EightDEvidenceScope';
import { aborted, eightDFieldLocation, useEightDStyle, useEightDText, type EightDRead } from '../process-eight-d/eight-d';
import { ClosureTaskInbox } from '../tasks/ClosureTaskInbox';
import { useCustomerLedgerWrite } from '../customer-quality/customer-ledger-write';
import { supplierEightDPath, type SupplierCommand, type SupplierReport, type SupplierWriteBody } from './supplier-eight-d';
import { SupplierDisclosure } from './SupplierDisclosure';
import { SupplierDeadlines } from './SupplierDeadlines';
import { SupplierControlledReport } from './SupplierControlledReport';
import styles from './supplier-eight-d.module.css';

export type SupplierEightDWorkspaceProps = { supplierProblemId: string; portal: boolean; onDenied?: (cause: unknown) => void };
export function SupplierEightDWorkspace(props: SupplierEightDWorkspaceProps) {
  const session = useWorkTabsStore(state => state.sessionScope);
  return <AccessScope key={JSON.stringify([props.supplierProblemId, props.portal, session])} {...props} session={session} />;
}

function AccessScope(props: SupplierEightDWorkspaceProps & { session?: string }) {
  const [denied, setDenied] = useState(false);
  const text = useEightDText();
  if (denied) return <Alert role="alert" type="error" title={text('当前会话失效或无权访问，敏感内容已清除。', 'Session expired or access denied. Sensitive content cleared.')} />;
  // Unmounting also aborts and clears the shared writer's private pending request.
  return <Workspace {...props} onDenied={cause => { setDenied(true); props.onDenied?.(cause); }} />;
}

function Workspace({ supplierProblemId, portal, onDenied, session }: SupplierEightDWorkspaceProps & { session?: string }) {
  const text = useEightDText();
  const css = useEightDStyle();
  const leave = useNavigationGuard();
  const base = supplierEightDPath(supplierProblemId, portal);
  const [report, setReport] = useState<SupplierReport>();
  const [draft, setDraft] = useState<SupplierReport['document']>();
  const [dirty, setDirty] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [receipt, setReceipt] = useState(false);
  const [action, setAction] = useState<string>();
  const [date, setDate] = useState('');
  const [closureDate, setClosureDate] = useState('');
  const [inbox, setInbox] = useState(false);
  const [evidencePending, setEvidencePending] = useState(0);
  const panels = useRef(new Set<string>());
  const lifetime = useRef(new AbortController());
  const alive = useRef(true);
  const revoked = useRef(false);
  const writing = useRef(false);
  const clearWrite = useRef(() => {});
  const frozen = useRef<{ path: string; method: 'POST' | 'PUT'; body: SupplierWriteBody }>(undefined);
  const identity = useRef<{ problemId: string; organizationId: string }>(undefined);
  const completion = useRef<Parameters<SupplierCommand>[3]>(undefined);
  const sequence = useRef(0);
  const actionForm = useRef<HTMLElement>(null);
  const actionTrigger = useRef<HTMLElement | null>(null);
  const deniedCallback = useRef(onDenied); deniedCallback.current = onDenied;
  const current = useCallback(() => alive.current && !revoked.current && !lifetime.current.signal.aborted && session === useWorkTabsStore.getState().sessionScope, [session]);
  const revoke = useCallback((cause: unknown) => {
    if (!current() || !(cause instanceof ApiError) || ![401, 403].includes(cause.status ?? 0)) return;
    revoked.current = true; lifetime.current.abort(); sequence.current++;
    clearWrite.current(); frozen.current = undefined; completion.current = undefined; identity.current = undefined;
    setReport(undefined); setDraft(undefined); setDirty(false); setFormDirty(false); setAction(undefined); setInbox(false);
    setDate(''); setClosureDate(''); setFields({}); setError(''); setReceipt(false); setBusy(false); setLoading(false);
    panels.current.clear(); setEvidencePending(0); deniedCallback.current?.(cause);
  }, [current]);
  const read: EightDRead = useCallback(async <T,>(path: string, init: RequestInit = {}) => {
    if (!current()) throw new DOMException('Stale scope', 'AbortError');
    const signal = init.signal ? AbortSignal.any([lifetime.current.signal, init.signal]) : lifetime.current.signal;
    try {
      const headers = new Headers(init.headers);
      if (init.body) headers.set('x-csrf-token', await csrfToken(signal));
      signal.throwIfAborted();
      if (!current()) throw new DOMException('Stale scope', 'AbortError');
      if (init.body && panels.current.size && (path === base || path === `${base}/submit` || path === `${base}/analysis-complete` || path === `${base}/release`)) throw new ApiError({ code: 'EVIDENCE_PENDING', message: 'Evidence pending' }, 400);
      if (headers.get('Accept') === 'application/pdf') {
        const response = await fetch(path, { ...init, credentials: 'include', headers, signal, cache: 'no-store' });
        if (!response.ok) throw new ApiError({ code: `HTTP_${response.status}`, message: 'PDF download refused' }, response.status);
        if (!response.headers.get('content-type')?.includes('application/pdf')) throw new Error('INVALID_PDF_RESPONSE');
        const bytes = await response.arrayBuffer();
        signal.throwIfAborted();
        if (!current()) throw new DOMException('Stale scope', 'AbortError');
        if (String.fromCharCode(...new Uint8Array(bytes).subarray(0, 5)) !== '%PDF-') throw new Error('INVALID_PDF_BYTES');
        return bytes as T;
      }
      const value = await apiRequest<T>(path, { ...init, headers: Object.fromEntries(headers), signal }, { replayAfterReauthentication: false });
      signal.throwIfAborted();
      if (!current()) throw new DOMException('Stale scope', 'AbortError');
      return value;
    } catch (cause) { revoke(cause); throw cause; }
  }, [base, current, revoke]);
  const writer = useCustomerLedgerWrite(revoke, portal ? 'SUPPLIER' : 'INTERNAL');
  const pending = writer.uncertain;
  clearWrite.current = writer.discard;
  const valid = useCallback((value: SupplierReport) => {
    if (value.supplierProblemId !== supplierProblemId || identity.current && (value.problemId !== identity.current.problemId || value.organizationId !== identity.current.organizationId)) { revoke(new ApiError({ code: 'SCOPE_MISMATCH', message: 'Scope mismatch' }, 403)); return false; }
    identity.current = { problemId: value.problemId, organizationId: value.organizationId };
    return true;
  }, [supplierProblemId, revoke]);
  const load = useCallback(async (preserve = false) => {
    const n = ++sequence.current; setLoading(true); setError('');
    try {
      const value = await read<SupplierReport>(base);
      if (!current() || n !== sequence.current || !valid(value)) return;
      setReport(value); if (!preserve) { setDraft(value.document); setDirty(false); }
      setConflict(false); setFields({});
    } catch (cause) { if (current() && n === sequence.current && !aborted(cause)) setError(text('工作区加载失败，请重试。', 'Workspace could not be loaded. Retry.')); }
    finally { if (current() && n === sequence.current) setLoading(false); }
  }, [base, read, current, valid]);
  useEffect(() => {
    alive.current = true; lifetime.current = new AbortController();
    const unsubscribe = useWorkTabsStore.subscribe(() => { if (session !== useWorkTabsStore.getState().sessionScope) { lifetime.current.abort(); clearWrite.current(); frozen.current = undefined; } });
    void load();
    return () => { alive.current = false; lifetime.current.abort(); clearWrite.current(); frozen.current = undefined; unsubscribe(); };
  }, [load, session]);
  const onPendingChange = useCallback((id: string, value: boolean) => {
    if (!current()) return;
    if (value) panels.current.add(id); else panels.current.delete(id);
    setEvidencePending(panels.current.size);
  }, [current]);
  const evidenceScope = useMemo(() => ({ onAccessDenied: revoke, onPendingChange }), [revoke, onPendingChange]);
  useUnsavedChanges(dirty || formDirty || pending || evidencePending > 0);
  useNavigationBusy(busy || pending || evidencePending > 0);

  async function run(path?: string, method?: 'POST' | 'PUT', body?: SupplierWriteBody, options?: Parameters<SupplierCommand>[3]) {
    if (!current() || writing.current || conflict || loading || panels.current.size) return false;
    if (path && method && body) { if (pending) return false; completion.current = options; frozen.current = { path, method, body: structuredClone(body) }; }
    const attempt = frozen.current; if (!attempt) return false;
    writing.current = true; setBusy(true); setError(''); setReceipt(false); sequence.current++;
    try {
      const result = await writer.write<unknown>(attempt.path, attempt.body, attempt.method, () => current() && panels.current.size === 0);
      if (!current()) return false;
      const completed = completion.current; completion.current = undefined;
      frozen.current = undefined; setConflict(false); setFields({}); setReceipt(true);
      if (!completed?.keepOpen) { setAction(undefined); setFormDirty(false); }
      completed?.receive?.(result);
      if (result && typeof result === 'object' && 'supplierProblemId' in result && 'document' in result && 'allowedActions' in result) {
        const value = result as SupplierReport;
        if (!valid(value)) return false;
        setReport(value); setDraft(value.document); setDirty(false);
      } else if (completed?.refresh !== false) await load();
      return true;
    } catch (cause) {
      if (!current() || aborted(cause)) { writer.discard(); frozen.current = undefined; return false; }
      if (cause instanceof ApiError) { setFields(cause.fields); if (cause.status === 409) setConflict(true); }
      setError(cause instanceof ApiError && cause.status === 409 ? text('版本冲突：草稿与表单已保留，请刷新基线后核对。', 'Version conflict. Draft and form retained; refresh the baseline.') : text('操作未通过，请核对字段、阶段与当前资格。', 'Operation rejected. Check fields, stage and eligibility.'));
      return false;
    } finally { writing.current = false; if (current()) setBusy(false); }
  }
  const can = (name: string) => report?.allowedActions.includes(name) === true;
  const locked = busy || pending || conflict || loading;
  const inReview = report?.status === 'IN_REVIEW' || report?.closure?.status === 'PENDING';
  const editable = report && !inReview && (!report.closedAt && can('save') || !portal && !!report.closedAt && can('supplement'));
  const versions = report && { expectedRowVersion: report.rowVersion, expectedInstanceVersion: report.instanceVersion };
  const open = (name: string) => { if (!locked && !dirty && !evidencePending) { actionTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setAction(name); setDate(''); setClosureDate(''); setFormDirty(false); setReceipt(false); } };
  useEffect(() => {
    if (action) actionForm.current?.querySelector<HTMLElement>('input:not(:disabled),textarea:not(:disabled),select:not(:disabled),button:not(:disabled)')?.focus();
    else actionTrigger.current?.focus();
  }, [action]);
  const focusField = (path: string) => {
    const location = eightDFieldLocation(path); if (!location) return;
    const section = document.getElementById(`eight-d-${supplierProblemId}-${location.section}`);
    const row = Array.from(section?.querySelectorAll<HTMLElement>('[data-eight-d-path]') ?? []).find(item => item.dataset.eightDPath === location.row);
    (row ?? section)?.focus(); (row ?? section)?.scrollIntoView?.({ block: 'center' });
  };
  const statusText = new Map([['PROCESSING', text('办理中', 'Processing')], ['IN_REVIEW', text('审批中', 'In review')], ['CLOSED', text('已关闭', 'Closed')], ['ARCHIVED', text('已归档', 'Archived')]]);
  const riskText = new Map([['LOW', text('低风险', 'Low risk')], ['MEDIUM', text('中风险', 'Medium risk')], ['HIGH', text('高风险', 'High risk')], ['CRITICAL', text('重大风险', 'Critical risk')]]);
  return <EightDEvidenceScopeContext.Provider value={evidenceScope}><section className={styles.workspace} style={css} aria-label={text('供应商8D工作区', 'Supplier 8D workspace')}>
    <header className={styles.header}><div><h2>{report?.reportNumber ?? text('供应商8D', 'Supplier 8D')}</h2>{report && <Space wrap><Tag>{statusText.get(report.status) ?? report.status}</Tag><Tag>{riskText.get(report.severity) ?? report.severity}</Tag><span>{text('记录版本', 'Row version')} {report.rowVersion} · {text('内容版本', 'Content version')} {report.contentVersion}</span></Space>}</div><Button disabled={busy || pending || evidencePending > 0} onClick={() => leave(() => { setAction(undefined); setFormDirty(false); void load(); })}>{text('刷新工作区', 'Refresh workspace')}</Button></header>
    {(error || pending) && <Alert role="alert" type="error" title={pending ? text('写入结果未知：原内容与幂等键已冻结，仅可重试原请求。', 'Write outcome unknown. Retry only the frozen original request.') : error} description={<ul>{Object.entries(fields).map(([path, messages]) => <li key={path}>{eightDFieldLocation(path) ? <button type="button" disabled={locked} onClick={() => focusField(path)}>{path}</button> : <code>{path}</code>} · {messages.join(' / ')}</li>)}</ul>} />}
    {conflict && <Button disabled={busy || loading} onClick={() => void load(true)}>{text('刷新基线并保留草稿', 'Refresh baseline and keep draft')}</Button>}
    {pending && <Button loading={busy} disabled={busy || evidencePending > 0} onClick={() => void run()}>{text('重试原请求', 'Retry original request')}</Button>}
    {receipt && <Alert role="status" type="success" title={text('服务端已确认保存 / 操作成功。', 'Server confirmed the save / operation.')} />}
    {loading && <Spin aria-label={text('正在加载工作区', 'Loading workspace')} />}
    {report && draft && versions && <>
      <section className={styles.section}><h3>{report.title}</h3><p>SQE：{report.sqeUserId} · {text('责任科室', 'Responsible section')}：{report.responsibleSectionDepartmentId}</p>
        <div className={styles.scroll}><table><thead><tr><th>{text('阶段', 'Stage')}</th><th>{text('计划', 'Planned')}</th><th>{text('实际', 'Actual')}</th></tr></thead><tbody>{[
          [text('分析', 'Analysis'), report.analysisDueAt, report.analysisCompletedAt], [text('完整提交', 'Complete submission'), report.submissionDueAt, report.submittedAt], [text('关闭', 'Closure'), report.closureDueAt, report.closedAt],
        ].map(([label, planned, actual]) => <tr key={label}><th scope="row">{label}</th><td>{planned || '—'}</td><td>{actual || '—'}</td></tr>)}</tbody></table></div>
        <Space wrap>{editable && <Button type="primary" loading={busy} disabled={locked || !!action || evidencePending > 0} onClick={() => void run(base, 'PUT', { ...versions, document: draft })}>{report.closedAt ? text('保存内部补充', 'Save internal supplement') : text('保存草稿', 'Save draft')}</Button>}
          {['analysis-complete', 'submit', 'deadlines'].filter(name => can(name) && !report.closedAt && !inReview && (!portal || name !== 'deadlines')).map(name => <Button key={name} disabled={locked || dirty || !!action || evidencePending > 0} onClick={() => open(name)}>{name === 'analysis-complete' ? text('分析完成并设提交计划', 'Complete analysis and plan submission') : name === 'submit' ? text('完整提交', 'Submit complete report') : text('设置期限', 'Set deadlines')}</Button>)}
          {!portal && can('disclosure-preview') && <Button disabled={locked || dirty || !!action || evidencePending > 0} onClick={() => open('disclosure')}>{text('披露预览与释放', 'Preview and release disclosure')}</Button>}
          {(can('deadline-extensions') || can('request-extension')) && <Button disabled={locked || dirty || !!action || evidencePending > 0} onClick={() => open('extensions')}>{text('期限与延期', 'Deadlines and extensions')}</Button>}
          {can('report') && <Button disabled={locked || dirty || !!action || evidencePending > 0} onClick={() => open('report')}>{text('受控报告与历史', 'Controlled reports and history')}</Button>}
        </Space>{dirty && <p role="status">{text('有未保存草稿，请先保存，再执行其他操作。', 'Unsaved draft. Save before other actions.')}</p>}
      </section>
      {report.status === 'IN_REVIEW' && <Alert type="info" title={text('在审锁版：SQE先审，管理侧随后处理；任一退回均须整轮重审。', 'Review locked: SQE first, then management. Any return restarts the whole round.')} />}
      {report.closedAt && <Alert type="info" title={portal ? text('已关闭，仅显示获准版本。', 'Closed. Only authorized versions are shown.') : text('已关闭：内部补充不改变原批准依据、审批结果或实际关闭时间，不向供应商公开。', 'Closed: internal supplements do not change the approved basis, decisions or actual closure date and are not shared with the supplier.')} />}
      {action && <section ref={actionForm} className={styles.section} role="region" aria-label={text('操作表单', 'Action form')}>
        {action === 'disclosure' ? <SupplierDisclosure report={report} base={base} blocked={locked} command={run} onDirty={setFormDirty} /> : action === 'extensions' ? <SupplierDeadlines report={report} base={base} portal={portal} read={read} blocked={locked} command={run} onDirty={setFormDirty} /> : action === 'report' ? <SupplierControlledReport report={report} base={base} portal={portal} read={read} /> : <>
        {action !== 'submit' && <EightDField label={action === 'analysis-complete' ? text('完整提交计划', 'Complete submission plan') : text('分析计划', 'Analysis plan')}><input type="datetime-local" disabled={locked} value={date} onChange={event => { setDate(event.target.value); setFormDirty(true); }} /></EightDField>}
        {action === 'deadlines' && <EightDField label={text('计划关闭日期', 'Closure plan')}><input type="datetime-local" disabled={locked} value={closureDate} onChange={event => { setClosureDate(event.target.value); setFormDirty(true); }} /></EightDField>}
        {action === 'submit' && <p>{text('确认完整提交服务端已保存版本。提交后锁版，退回后重新提交将启动整轮审核。', 'Confirm submission of the server-saved version. It locks for review; resubmission after a return starts a whole new round.')}</p>}
        <Space wrap><Button type="primary" disabled={locked || action === 'analysis-complete' && !date || action === 'deadlines' && !date && !closureDate} onClick={() => {
          if (action === 'analysis-complete') void run(`${base}/${action}`, 'POST', { ...versions, submissionDueAt: new Date(date).toISOString() });
          else if (action === 'deadlines') void run(`${base}/deadlines`, 'PUT', { ...versions, ...(date ? { analysisDueAt: new Date(date).toISOString() } : {}), ...(closureDate ? { closureDueAt: new Date(closureDate).toISOString() } : {}) });
          else void run(`${base}/submit`, 'POST', versions);
        }}>{text('确认提交', 'Confirm submission')}</Button></Space></>}
        <Button disabled={busy || pending || evidencePending > 0} onClick={() => leave(() => { setAction(undefined); setFormDirty(false); }, true)}>{text('取消操作', 'Cancel action')}</Button>
      </section>}
      <EightDDocumentEditor problemId={supplierProblemId} document={draft} resource={{ resourceType: report.closedAt && !portal ? 'supplier-eight-d-supplement' : 'supplier-quality', resourceId: supplierProblemId }} disabled={!editable || locked || !!action} removalBlocked={evidencePending > 0} read={read} onChange={change => { if (editable && !locked && !action) { setDraft(value => value && change(value)); setDirty(true); } }} />
      {report.closure && <section className={styles.section}><h3>{text('当前关闭轮次', 'Current closure round')} {report.closure.roundNumber}</h3><p>{text('固定内容版本', 'Fixed content version')} {report.closure.contentVersion} · {report.closure.status}</p><p>{text('先SQE后管理，高 / 重大风险管理侧并行；任一退回后供应商重新提交，整轮重审。', 'SQE precedes management. High / critical management duties run in parallel. Any return requires supplier resubmission and a full new review.')}</p>{report.closure.duties.map(duty => <p key={duty.id}>{duty.duty === 'PROFESSIONAL' ? 'SQE' : duty.duty === 'SECTION_MANAGER' ? text('科室经理', 'Section manager') : text('部长', 'Minister')} · {duty.status} · {duty.userId}{!portal && duty.comment && <> · {duty.comment}</>}</p>)}</section>}
      {!portal && <section className={styles.section}><Button disabled={locked || dirty || !!action || evidencePending > 0} onClick={() => setInbox(true)}>{text('打开关闭职责待办', 'Open closure duty inbox')}</Button>{inbox && <><Button onClick={() => leave(() => { setInbox(false); void load(); }, true)}>{text('关闭职责待办并刷新', 'Close duty inbox and refresh')}</Button><ClosureTaskInbox onDenied={revoke} /></>}</section>}
    </>}
  </section></EightDEvidenceScopeContext.Provider>;
}
