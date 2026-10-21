import { Alert, Button, Empty, Input, Radio, Spin, Tag, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { useNavigationBusy } from '../../layouts/UnsavedChanges';

type Snapshot = components['schemas']['AuditExecutionSnapshotDto'];
type Checklist = components['schemas']['AuditChecklistResponseDto'];
type DraftValue = { result: 'OK' | 'NG' | 'NA'; note?: string; expectedVersion: number; idempotencyKey: string };
type Draft = Record<string, DraftValue>;

function draftKey(scope: string, executionId: string) { return `qms.audit.mobile-draft.${scope}.${executionId}`; }
function readDraft(scope: string, executionId: string): Draft {
  try {
    const value = JSON.parse(localStorage.getItem(draftKey(scope, executionId)) ?? '{}') as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Draft : {};
  } catch { return {}; }
}
function isConflict(cause: unknown) { return cause instanceof ApiError && cause.status === 409; }

export function AuditMobileExecution({ initialExecutionId }: { initialExecutionId?: string } = {}) {
  const sessionScope = useWorkTabsStore((state) => state.sessionScope);
  const [input, setInput] = useState(initialExecutionId ?? '');
  const [executionId, setExecutionId] = useState(initialExecutionId ?? '');
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [draft, setDraft] = useState<Draft>({});
  const [loading, setLoading] = useState(Boolean(initialExecutionId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [conflict, setConflict] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const generation = useRef(0);
  const writing = useRef(false);
  useNavigationBusy(busy);

  const checklistByKey = useMemo(() => new Map((snapshot?.checklist ?? []).map((item) => [item.item_key, item])), [snapshot]);
  const effective = (key: string, existing: Checklist | undefined): Partial<DraftValue> | undefined => draft[key] ?? (existing ? { result: existing.result, note: existing.note ?? undefined, expectedVersion: existing.version } : undefined);

  function persist(next: Draft, targetId = executionId, updateView = true) {
    if (updateView) setDraft(next);
    if (!targetId || !sessionScope) return;
    try { localStorage.setItem(draftKey(sessionScope, targetId), JSON.stringify(next)); } catch { /* local storage is optional */ }
  }

  async function load(id = executionId) {
    const targetId = id.trim();
    if (!targetId) return;
    const requestGeneration = ++generation.current;
    setLoading(true); setError(undefined); setConflict(false);
    try {
      const result = await apiRequest<Snapshot>(`/api/v1/audit-management/executions/${encodeURIComponent(targetId)}`);
      if (generation.current !== requestGeneration) return;
      setExecutionId(targetId); setSnapshot(result); setDraft(sessionScope ? readDraft(sessionScope, targetId) : {});
    } catch (cause) {
      if (generation.current !== requestGeneration) return;
      setSnapshot(undefined); setDraft({}); if (cause instanceof ApiError && cause.status === 403 && sessionScope) { try { localStorage.removeItem(draftKey(sessionScope, targetId)); } catch { /* optional */ } } setError(cause);
    } finally { if (generation.current === requestGeneration) setLoading(false); }
  }

  async function sync(submitAfter = false): Promise<boolean> {
    if (writing.current || !snapshot || !executionId) return false;
    writing.current = true;
    const syncGeneration = generation.current;
    const syncExecutionId = executionId;
    const syncSnapshot = snapshot;
    const syncDraft = { ...draft };
    setBusy(true); setError(undefined); setConflict(false);
    try {
      const token = await csrfToken();
      const remaining = { ...syncDraft };
      for (const item of syncSnapshot.items) {
        const value = remaining[item.key];
        if (!value) continue;
        const saved = await apiRequest<Checklist>(`/api/v1/audit-management/executions/${encodeURIComponent(syncExecutionId)}/checklist`, { method: 'POST', headers: { 'x-csrf-token': token, 'Idempotency-Key': value.idempotencyKey }, body: JSON.stringify({ itemKey: item.key, expectedVersion: value.expectedVersion, result: value.result, note: value.note }) });
        delete remaining[item.key]; persist({ ...remaining }, syncExecutionId, generation.current === syncGeneration);
        if (generation.current === syncGeneration) setSnapshot((current) => current ? { ...current, checklist: [...current.checklist.filter((entry) => entry.item_key !== saved.item_key), saved] } : current);
      }
      const refreshed = await apiRequest<Snapshot>(`/api/v1/audit-management/executions/${encodeURIComponent(syncExecutionId)}`);
      if (generation.current !== syncGeneration) return true;
      setSnapshot(refreshed);
      if (sessionScope) try { localStorage.removeItem(draftKey(sessionScope, syncExecutionId)); } catch { /* optional */ }
      setDraft({});
      if (submitAfter) {
        const result = await apiRequest<Snapshot['execution']>(`/api/v1/audit-management/executions/${encodeURIComponent(syncExecutionId)}/submit`, { method: 'POST', headers: { 'x-csrf-token': token, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ expectedVersion: refreshed.execution.version }) });
        if (generation.current === syncGeneration) setSnapshot((current) => current ? { ...current, execution: result } : current);
      }
      return true;
    } catch (cause) { if (generation.current === syncGeneration) { if (isConflict(cause)) setConflict(true); else setError(cause); } return false; } finally { writing.current = false; setBusy(false); }
  }

  useEffect(() => {
    const onOnline = () => setOnline(true); const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);
  useEffect(() => { if (initialExecutionId) void load(initialExecutionId); }, [initialExecutionId]);

  return <section className="audit-mobile-execution" aria-label="移动审核执行">
    <div className="audit-mobile-heading"><div><Typography.Title level={2}>移动审核执行</Typography.Title><Typography.Text type="secondary">现场逐条记录；弱网时保存在本机，恢复联网后可继续同步。</Typography.Text></div><Tag color={online ? 'green' : 'orange'}>{online ? '在线' : '离线草稿'}</Tag></div>
    <div className="audit-mobile-lookup"><Input aria-label="审核执行 ID" value={input} onChange={(event) => setInput(event.target.value)} placeholder="输入审核执行 ID" disabled={busy} /><Button type="primary" onClick={() => void load(input)} loading={loading} disabled={busy}>打开执行</Button></div>
    {error ? <Alert type="error" showIcon title={error instanceof ApiError ? safeAccountError(error) : '审核执行加载失败，请重试。'} action={<Button onClick={() => void load()}>重试</Button>} /> : null}
    {conflict ? <Alert type="warning" showIcon title="审核已在其他会话中更新" description="本机草稿仍保留。请刷新最新执行后检查差异，再重新同步。" action={<Button onClick={() => void load()}>刷新最新执行</Button>} /> : null}
    {loading ? <div className="audit-mobile-loading"><Spin /></div> : !snapshot ? <Empty description="输入执行 ID 开始现场审核" /> : <>
      <div className="audit-mobile-status"><Tag>{snapshot.execution.status}</Tag><Typography.Text type="secondary">服务端版本 v{snapshot.execution.version}</Typography.Text><Button aria-label="同步草稿" onClick={() => void sync()} loading={busy} disabled={busy || !online}>同步草稿</Button><Button aria-label="提交审核" type="primary" onClick={() => void sync(true)} loading={busy} disabled={busy || !online || snapshot.execution.status !== 'OPEN'}>提交审核</Button></div>
      <div className="audit-mobile-items">{snapshot.items.map((item) => { const value = effective(item.key, checklistByKey.get(item.key)); const update = (change: Partial<DraftValue>) => persist({ ...draft, [item.key]: { result: change.result ?? value?.result ?? 'OK', note: change.note ?? value?.note, expectedVersion: value?.expectedVersion ?? 0, idempotencyKey: crypto.randomUUID() } }); return <article className="audit-mobile-item" key={item.key}><Typography.Title level={3}>{item.key} · {item.text}</Typography.Title><Radio.Group aria-label={`${item.key} 结果`} value={value?.result} onChange={(event) => update({ result: event.target.value })} options={[{ label: '符合', value: 'OK' }, { label: '不符合', value: 'NG' }, { label: '不适用', value: 'NA' }]} disabled={busy} /><Input.TextArea aria-label={`${item.key} 备注`} value={value?.note} onChange={(event) => update({ note: event.target.value })} placeholder="现场备注（可选）" maxLength={5000} autoSize={{ minRows: 2, maxRows: 5 }} disabled={busy} /></article>; })}</div>
    </>}
  </section>;
}
