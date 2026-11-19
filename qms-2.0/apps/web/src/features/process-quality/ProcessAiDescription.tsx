import type { components } from '@qms/contracts';
import { Alert, Button, Descriptions, Modal, Space, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../../api/client';
import { useNavigationBusy, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { getLedgerSessionEpoch } from '../../ui/ledger/preferences';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { denied, ProcessError, useProcessWrite } from './process-ledger';
import { ingestionIssue, useIngestionText } from '../../console/api-ingestion/ingestion-ui';

type Defect = components['schemas']['ProcessDefectDto'];
type Task = components['schemas']['AiDescriptionTaskDto'];
const tasksPath = '/api/v1/admin/integrations/ingestion/ai-tasks';
const states: Record<string, string> = { DISABLED: '直接组合', PENDING: '等待整理', PROCESSING: '整理中', RETRY: '等待重试', FAILED: '整理失败，保留当前描述', APPLIED: '已采用AI结果', SUGGESTED: 'AI建议待采用', STALE: '输入已更新，保留当前描述' };

export function ProcessAiDescription({ record, permissions, onSaved, onDenied }: { record: Defect; permissions: string[]; onSaved: (record: Defect) => void; onDenied: (cause?: unknown) => void }) {
  const text = useIngestionText();
  const [tasks, setTasks] = useState<Task[]>([]); const [loading, setLoading] = useState(false); const [revision, setRevision] = useState(0);
  const [error, setError] = useState<unknown>(); const [adopting, setAdopting] = useState(false); const [retired, setRetired] = useState(false);
  const alive = useRef(true); const invalidated = useRef(false); const initialSession = useRef(useWorkTabsStore.getState().sessionScope); const initialEpoch = useRef(getLedgerSessionEpoch());
  const controller = useRef<AbortController>(undefined); const inFlight = useRef(false);
  const pending = useRef<{ task: Task; action: 'retry' | 'adopt' }>(undefined);
  const writer = useProcessWrite(onDenied); useNavigationBusy(writer.busy); useUnsavedChanges(writer.uncertain);
  const canReadTasks = permissions.includes('ingestion:read'); const canRun = canReadTasks && permissions.includes('ingestion:run') && permissions.includes('process-quality:defects:write') && !record.archivedAt;
  const hasSource = record.descriptionDirect != null || record.descriptionAi != null || record.descriptionInput?.length;
  const hasAi = record.descriptionAiStatus !== 'DISABLED' && (!!record.descriptionTaskId || record.descriptionAi != null || !!record.descriptionAiStatus);
  const current = () => alive.current && !invalidated.current && initialSession.current === useWorkTabsStore.getState().sessionScope && initialEpoch.current === getLedgerSessionEpoch();
  useEffect(() => {
    alive.current = true; controller.current = new AbortController();
    const unsubscribe = useWorkTabsStore.subscribe(() => { if (!current()) { invalidated.current = true; controller.current?.abort(); pending.current = undefined; setTasks([]); setAdopting(false); setRetired(true); } });
    return () => { alive.current = false; controller.current?.abort(); pending.current = undefined; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!hasAi || !canReadTasks || !current()) return;
    let active = true; setLoading(true); setError(undefined);
    const query = new URLSearchParams({ organizationId: record.organizationId, defectId: record.id });
    void apiRequest<components['schemas']['AiDescriptionTaskListDto']>(`${tasksPath}?${query}`, { signal: controller.current?.signal }).then(result => {
      if (!active || !current()) return;
      if (!Array.isArray(result.items) || result.items.some(task => task.defectId !== record.id)) { onDenied(); return; }
      setTasks(result.items);
    }).catch(cause => { if (active && current()) { setError(cause); if (denied(cause)) onDenied(cause); } }).finally(() => { if (active && current()) setLoading(false); });
    return () => { active = false; };
  }, [record.id, record.version, hasAi, canReadTasks, revision]);
  async function refresh() {
    if (!current() || writer.busy || writer.uncertain || loading) return;
    setError(undefined); setLoading(true);
    try {
      const updated = await apiRequest<Defect>(`/api/v1/process-quality/defects/${record.id}?organizationId=${encodeURIComponent(record.organizationId)}`, { signal: controller.current?.signal });
      if (current()) { if (updated.id !== record.id || updated.organizationId !== record.organizationId) onDenied(); else { onSaved(updated); setRevision(value => value + 1); } }
    } catch (cause) { if (current()) { setError(cause); if (denied(cause)) onDenied(cause); } }
    finally { if (current()) setLoading(false); }
  }
  async function execute(task?: Task, action?: 'retry' | 'adopt') {
    if (inFlight.current || !canRun || !current()) return;
    const attempt = pending.current ?? (task && action ? { task, action } : undefined); if (!attempt) return;
    pending.current = attempt; inFlight.current = true; setError(undefined);
    try {
      const body: components['schemas']['AiDescriptionTaskActionDto'] = { organizationId: record.organizationId, expectedVersion: attempt.task.version };
      const result = await writer.write<Task>(`${tasksPath}/${attempt.task.id}/${attempt.action}`, body, 'POST');
      if (!current()) return;
      pending.current = undefined; setAdopting(false); setTasks(previous => previous.map(item => item.id === result.id ? result : item));
      const updated = await apiRequest<Defect>(`/api/v1/process-quality/defects/${record.id}?organizationId=${encodeURIComponent(record.organizationId)}`, { signal: controller.current?.signal });
      if (current()) { if (updated.id !== record.id || updated.organizationId !== record.organizationId) onDenied(); else onSaved(updated); }
    } catch (cause) { if (current()) { if (cause instanceof ApiError && cause.status !== undefined && cause.status < 500 && ![408, 425].includes(cause.status)) pending.current = undefined; setError(cause); if (denied(cause)) onDenied(cause); } }
    finally { inFlight.current = false; }
  }
  if (!hasSource || retired) return null;
  const task = hasAi ? record.descriptionTaskId ? tasks.find(item => item.id === record.descriptionTaskId) : tasks[0] : undefined;
  const status = task?.status ?? record.descriptionAiStatus;
  const unknownRetry = writer.uncertain ? <Button type="primary" loading={writer.busy} onClick={() => void execute()}>重试原请求</Button> : null;
  return <section className="process-ai-description" role="region" aria-label="描述来源">
    <Space wrap><Tag>{record.descriptionSource === 'AI' ? 'AI整理' : record.descriptionSource === 'MANUAL' ? '人工修订' : '直接组合'}</Tag>{status && status !== 'DISABLED' ? <span>{states[status] ?? '状态待核对'}</span> : null}{hasAi && canReadTasks ? <Button disabled={writer.busy || writer.uncertain} loading={loading} onClick={() => void refresh()}>刷新整理状态</Button> : null}</Space>
    {task?.errorCode && (status === 'FAILED' || status === 'RETRY') && <Alert type="warning" showIcon title={ingestionIssue(task.errorCode, text('zh', 'en') === 'en')} description={<>{text('任务编号', 'Task ID')}: <code>{task.id}</code></>} />}
    <Descriptions size="small" column={1} items={[
      { key: 'direct', label: '直接组合', children: <span className="process-quality-description">{record.descriptionDirect ?? '—'}</span> },
      ...(hasAi && record.descriptionInput?.length ? [{ key: 'inputs', label: '原始选定字段', children: record.descriptionInput.map((field, index) => <div key={index}>{field.label || field.path}：{field.value === null ? '—' : String(field.value)}</div>) }] : []),
      ...(hasAi ? [{ key: 'ai', label: record.descriptionSource === 'MANUAL' ? 'AI建议' : 'AI结果', children: <span className="process-quality-description">{record.descriptionAi ?? task?.result ?? '—'}</span> }] : []),
    ]} />
    <ProcessError cause={error} fallback="描述状态加载或操作失败，请重试。" />
    {writer.uncertain ? <Alert type="warning" title="操作结果未知，请重试原请求。" action={unknownRetry} /> : null}
    {canRun && !writer.uncertain && task ? <Space wrap>{task.status === 'FAILED' && !task.errorCode?.startsWith('AI_DESCRIPTION_INPUT_') ? <Button loading={writer.busy} onClick={() => void execute(task, 'retry')}>重试AI整理</Button> : null}{task.status === 'SUGGESTED' && task.result ? <Button disabled={writer.busy} onClick={() => setAdopting(true)}>采用AI建议</Button> : null}</Space> : null}
    <Modal open={adopting} title="采用AI建议" onCancel={() => { if (!writer.busy && !writer.uncertain) setAdopting(false); }} closable={!writer.busy && !writer.uncertain} keyboard={!writer.busy && !writer.uncertain} mask={{ closable: !writer.busy && !writer.uncertain }} footer={writer.uncertain ? unknownRetry : <Space><Button disabled={writer.busy} onClick={() => setAdopting(false)}>取消</Button><Button type="primary" loading={writer.busy} onClick={() => task && void execute(task, 'adopt')}>确认采用</Button></Space>}>
      <ProcessError cause={error} fallback="采用结果尚未确认，请重试。" /><p>采用后将替换当前不良描述。</p><p className="process-quality-description">{task?.result}</p>
    </Modal>
  </section>;
}
