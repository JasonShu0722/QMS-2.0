import type { components } from '@qms/contracts';
import { Alert, Button, Checkbox, Drawer, Input, Radio, Space, Spin } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { type Defect, useProcessWrite } from './process-ledger';

const base = '/api/v1/process-quality/eight-d';
type Report = components['schemas']['ProcessEightDReportDto'];
type Preview = components['schemas']['ProcessEightDSourcePreviewDto'];
type Body = components['schemas']['ProcessEightDSourcesDto'];
type Confirmation = NonNullable<Body['sourceConfirmations']>[number];
type Target = Pick<Report, 'problemId' | 'reportNumber'> & { title: string };

type Props = {
  sources: Defect[];
  organizationId: string;
  loadTargets: (keyword: string, organizationId: string, signal: AbortSignal) => Promise<Target[]>;
  onClose: () => void;
  onLinked: (report: Report, linkedIds: string[]) => void;
  onRefreshSources: () => void;
  onSessionExpired: (cause: unknown) => void;
};

export function ProcessExistingEightDDialog({ sources, organizationId, loadTargets, onClose, onLinked, onRefreshSources, onSessionExpired }: Props) {
  const [keyword, setKeyword] = useState('');
  const [targets, setTargets] = useState<Target[]>([]);
  const [searched, setSearched] = useState(false);
  const [target, setTarget] = useState<Target>();
  const [report, setReport] = useState<Report>();
  const [preview, setPreview] = useState<Preview[]>([]);
  const [confirmations, setConfirmations] = useState<Record<string, Confirmation>>({});
  const [cancelApproval, setCancelApproval] = useState(false);
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const [staleSource, setStaleSource] = useState(false);
  const [recheck, setRecheck] = useState(false);
  const read = useRef<AbortController>(undefined);
  const submitting = useRef(false);
  const scope = useWorkTabsStore(state => state.sessionScope);
  const requestLeave = useNavigationGuard();
  const writer = useProcessWrite(cause => {
    if (cause instanceof ApiError && cause.status === 401) onSessionExpired(cause);
  });
  useNavigationBusy(writer.busy);
  useUnsavedChanges(!!target || writer.uncertain);
  useEffect(() => () => read.current?.abort(), []);

  function startRead() {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    setLoading(true);
    setError(undefined);
    return controller.signal;
  }

  function current(signal: AbortSignal) {
    return !signal.aborted && useWorkTabsStore.getState().sessionScope === scope;
  }

  function readFailed(cause: unknown, signal: AbortSignal) {
    if (!current(signal)) return;
    if (cause instanceof ApiError && cause.status === 401) onSessionExpired(cause);
    else {
      setStaleSource(cause instanceof ApiError && cause.code === 'SOURCE_VERSION_CONFLICT');
      setError(cause);
    }
  }

  function resetSelection(next?: Target) {
    setTarget(next);
    setReport(undefined);
    setPreview([]);
    setConfirmations({});
    setCancelApproval(false);
    setRecheck(false);
    setStaleSource(false);
  }

  async function search(value: string) {
    const term = value.trim();
    if (!term || writer.busy || writer.uncertain) return;
    const signal = startRead();
    resetSelection();
    setTargets([]);
    setSearched(true);
    try {
      const rows = await loadTargets(term, organizationId, signal);
      if (current(signal)) setTargets(rows);
    } catch (cause) { readFailed(cause, signal); }
    finally { if (current(signal)) setLoading(false); }
  }

  function sourceRefs(existing: Report) {
    const linked = new Set(existing.sources.map(source => source.defectId));
    return sources.filter(source => !linked.has(source.id)).map(source => ({ defectId: source.id, expectedVersion: source.version }));
  }

  async function choose(next: Target) {
    const signal = startRead();
    resetSelection(next);
    try {
      const existing = await apiRequest<Report>(`${base}/${encodeURIComponent(next.problemId)}?${new URLSearchParams({ organizationId })}`, { signal });
      if (!current(signal)) return;
      if (existing.organizationId !== organizationId || existing.problemId !== next.problemId || !existing.allowedActions.includes('sources')) {
        throw new Error('此 8D 当前不可补充来源。');
      }
      const add = sourceRefs(existing);
      if (existing.sources.length + add.length > 100) throw new Error('关联后超过 100 条来源，请减少所选台账。');
      if (add.length) {
        const body: components['schemas']['ProcessEightDSourcePreviewInputDto'] = { organizationId, problemId: next.problemId, sources: add };
        const token = await csrfToken(signal);
        signal.throwIfAborted();
        const rows = await apiRequest<Preview[]>(`${base}/sources/preview`, { method: 'POST', headers: { 'x-csrf-token': token }, signal, body: JSON.stringify(body) });
        if (rows.length !== add.length || add.some(source => !rows.some(row => row.defectId === source.defectId))) throw new Error('来源预览不完整，请重试。');
        if (current(signal)) setPreview(rows);
      }
      if (current(signal)) setReport(existing);
    } catch (cause) { readFailed(cause, signal); }
    finally { if (current(signal)) setLoading(false); }
  }

  const add = report ? sourceRefs(report) : [];
  const related = preview.filter(row => row.relatedProblems.length || row.hasHiddenRelations);
  const inReview = report?.status === 'IN_REVIEW';
  const complete = related.every(({ defectId }) => confirmations[defectId]?.recurrence === 'RECURRENCE' || !!confirmations[defectId]?.reason?.trim());
  const locked = writer.busy || writer.uncertain;

  async function submit() {
    if (!report || !add.length || !complete || recheck || loading || (inReview && !cancelApproval) || submitting.current) return;
    submitting.current = true;
    setError(undefined);
    const body: Body = {
      organizationId, expectedVersion: report.version, add, removeDefectIds: [],
      sourceConfirmations: related.map(row => confirmations[row.defectId]),
      ...(inReview ? { confirmCancelApproval: true } : {}),
    };
    try {
      const updated = await writer.write<Report>(`${base}/${encodeURIComponent(report.problemId)}/sources`, body);
      if (current(writer.signal())) onLinked(updated, sources.map(source => source.id));
    } catch (cause) {
      if (current(writer.signal())) {
        if (cause instanceof ApiError && cause.status === 409) setRecheck(true);
        readFailed(cause, writer.signal());
      }
    } finally { submitting.current = false; }
  }

  const errorMessage = error instanceof ApiError
    ? error.code === 'SOURCE_VERSION_CONFLICT' ? '来源台账已更新，请刷新后重新选择。' : error.status === 409 ? '来源关联或目标 8D 已变化，请重新核对。' : safeAccountError(error)
    : error instanceof Error ? error.message : '关联失败，请重试。';

  return <Drawer open title="关联已有问题" size="min(640px, 100vw)" onClose={() => { if (!locked) requestLeave(onClose, true); }} closable={!locked} keyboard={!locked} mask={{ closable: !locked }}
    footer={<Space wrap><Button type="primary" disabled={writer.busy || loading || !add.length || !complete || recheck || (inReview && !cancelApproval)} loading={writer.busy} onClick={() => void submit()}>{writer.uncertain ? '重试关联' : '确认关联'}</Button></Space>}>
    <p>已选择 {sources.length} 条来源</p>
    <Space.Compact block>
      <Input aria-label="搜索已有 8D" placeholder="输入报告编号" value={keyword} maxLength={100} disabled={locked} onChange={event => setKeyword(event.target.value)} onPressEnter={event => { event.preventDefault(); void search(keyword); }} />
      <Button aria-label="搜索" disabled={locked || !keyword.trim()} onClick={() => void search(keyword)}>搜索</Button>
    </Space.Compact>
    {loading ? <Spin aria-label="读取已有 8D" /> : null}
    {searched && !loading && !error && !targets.length ? <p>未找到可关联的 8D</p> : null}
    <Radio.Group aria-label="选择目标 8D" disabled={locked || loading} value={target?.problemId} onChange={event => {
      const next = targets.find(row => row.problemId === event.target.value);
      if (next) void choose(next);
    }}><Space orientation="vertical">{targets.map(row => <Radio key={row.problemId} value={row.problemId}>{row.reportNumber} · {row.title}</Radio>)}</Space></Radio.Group>
    {target && <p>目标 8D：{target.reportNumber} · {target.title}</p>}
    {report && add.length < sources.length && <Alert type="info" title={add.length ? `${sources.length - add.length} 条来源已关联，将只补充其余 ${add.length} 条。` : '所选来源已全部关联到该 8D。'} />}
    {!!error && <Alert showIcon type="error" title={errorMessage} />}
    {writer.uncertain && <Alert showIcon type="warning" title="关联结果未知，重试会使用同一请求。" />}
    {staleSource ? <Button disabled={locked} onClick={onRefreshSources}>刷新台账并重新选择</Button>
      : target && (recheck || !report && !!error) ? <Button disabled={locked || loading} onClick={() => void choose(target)}>重新核对目标和来源</Button> : null}
    {related.map(row => <section key={row.defectId}>
      <h4>{sources.find(source => source.id === row.defectId)?.description}</h4>
      {row.relatedProblems.map(problem => <p key={problem.problemId}>{problem.reportNumber} · {problem.title}</p>)}
      {row.hasHiddenRelations && <Alert type="warning" title="另有不可见关联，请核对复发结论。" />}
      <label>复发关联结论 <select aria-label={`复发关联结论 ${row.defectId}`} disabled={locked || recheck} value={confirmations[row.defectId]?.recurrence ?? ''} onChange={event => {
        const recurrence = event.target.value as Confirmation['recurrence'] | '';
        setConfirmations(previous => {
          const next = { ...previous };
          if (!recurrence) delete next[row.defectId];
          else next[row.defectId] = { defectId: row.defectId, relatedProblemIds: row.relatedProblems.map(problem => problem.problemId), relatedSetToken: row.relatedSetToken, recurrence, reason: previous[row.defectId]?.reason };
          return next;
        });
      }}><option value="">请明确选择</option><option value="RECURRENCE">复发</option><option value="NOT_RECURRENCE">非复发继续关联</option></select></label>
      {confirmations[row.defectId] && <Input.TextArea aria-label={`关联说明 ${row.defectId}`} placeholder="关联说明（非复发必填）" disabled={locked || recheck} maxLength={2000} value={confirmations[row.defectId].reason ?? ''} onChange={event => setConfirmations(previous => ({ ...previous, [row.defectId]: { ...previous[row.defectId], reason: event.target.value } }))} />}
    </section>)}
    {inReview && !!add.length && <Alert type="warning" title="关联来源会取消当前整轮审批。" action={<Checkbox disabled={locked || recheck} checked={cancelApproval} onChange={event => setCancelApproval(event.target.checked)}>确认取消当前审批</Checkbox>} />}
  </Drawer>;
}
