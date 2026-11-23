import type { components } from '@qms/contracts';
import { Alert, Button, Modal, Space, Spin } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { useNavigationBusy, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { denied, ProcessError, useProcessWrite, type Defect } from './process-ledger';

type Preview = components['schemas']['ProcessDefectDeletionPreviewDto'];
type Result = components['schemas']['ProcessDefectDeletionResultDto'];
const blockerLabels: Record<string, string> = { FORMAL_PROBLEM: '已关联正式问题', NEW_PRODUCT_SELECTION: '已用于新品质量项目', SUPPLIER_SOURCE_COPY: '已复制为供应商问题来源' };

export function ProcessDefectDeletionDialog({ sources, organizationId, open, onClose, onDeleted, onDenied, onRefresh }: { sources: Defect[]; organizationId?: string; open: boolean; onClose: (uncertain: boolean) => void; onDeleted: (result: Result) => void; onDenied: (cause?: unknown) => void; onRefresh: () => void }) {
  const scope = useWorkTabsStore(state => state.sessionScope);
  const [preview, setPreview] = useState<Preview>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<unknown>();
  const controller = useRef<AbortController>(undefined);
  const alive = useRef(true);
  const submitting = useRef(false);
  const writer = useProcessWrite(onDenied);
  useUnsavedChanges(writer.uncertain);
  useNavigationBusy(writer.busy);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = useWorkTabsStore.subscribe((next, previous) => { if (next.sessionScope !== previous.sessionScope) { alive.current = false; controller.current?.abort(); onDenied(); } });
    return () => { alive.current = false; controller.current?.abort(); unsubscribe(); };
  }, []);
  useEffect(() => {
    const current = new AbortController(); controller.current = current;
    setLoading(true); setPreview(undefined); setError(undefined);
    async function read() {
      const session = await getSession();
      current.signal.throwIfAborted();
      if (scope && scope !== `${session.accountType}:${session.organizationId}:${session.userId}`) throw new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: '' }, 401);
      const token = await csrfToken(current.signal);
      current.signal.throwIfAborted();
      const body: components['schemas']['PreviewProcessDefectDeletionDto'] = { organizationId, sources: sources.map(record => ({ defectId: record.id, expectedVersion: record.version })) };
      const value = await apiRequest<Preview>('/api/v1/process-quality/defects/deletion-preview', { method: 'POST', signal: current.signal, headers: { 'x-csrf-token': token }, body: JSON.stringify(body) });
      current.signal.throwIfAborted();
      const expected = new Map(sources.map(source => [source.id, source.version]));
      if (value.count !== sources.length || value.items.length !== sources.length || value.items.some(item => expected.get(item.defectId) !== item.expectedVersion || !expected.delete(item.defectId))) throw new Error('删除预览不完整，请重新预览。');
      if (alive.current) setPreview(value);
    }
    void read().catch(cause => { if (!current.signal.aborted && alive.current) { setError(cause); if (denied(cause)) onDenied(cause); } }).finally(() => { if (!current.signal.aborted && alive.current) setLoading(false); });
    return () => current.abort();
  }, [revision]);
  function close() {
    if (submitting.current) return;
    if (!writer.uncertain) controller.current?.abort();
    onClose(writer.uncertain);
  }
  const blockedItems = preview?.items.filter(item => item.blocked) ?? [];
  const blocked = !!preview && (!preview.canDelete || blockedItems.length > 0);
  const ready = !loading && !!preview && !blocked;
  async function submit() {
    if (submitting.current || (!writer.uncertain && !ready)) return;
    submitting.current = true; setError(undefined);
    try {
      const body: components['schemas']['DeleteProcessDefectsDto'] = { organizationId, sources: sources.map(record => ({ defectId: record.id, expectedVersion: record.version })) };
      const result = await writer.write<Result>('/api/v1/process-quality/defects/deletion', body, 'POST');
      if (alive.current) onDeleted(result);
    } catch (cause) { if (alive.current) { setError(cause); if (cause instanceof ApiError && (cause.status === 409 || cause.code === 'PROCESS_DEFECT_NOT_FOUND')) setPreview(undefined); } }
    finally { submitting.current = false; }
  }
  const stale = error instanceof ApiError && ['CONCURRENCY_CONFLICT', 'PROCESS_DEFECT_NOT_FOUND'].includes(error.code);
  const referenceConflict = error instanceof ApiError && error.code === 'PROCESS_DEFECT_DELETE_BLOCKED';
  const blockerCounts = new Map<string, number>();
  for (const item of blockedItems) {
    const labels = new Set(item.blockers.map(blocker => blockerLabels[blocker.code] ?? '存在有效业务关联'));
    for (const label of labels) blockerCounts.set(label, (blockerCounts.get(label) ?? 0) + 1);
  }
  return <Modal title="删除制程不良台账" open={open} onCancel={close} closable={!writer.busy} keyboard={!writer.busy} mask={{ closable: !writer.busy }} footer={<Space wrap>
    <Button disabled={writer.busy} onClick={close}>{writer.uncertain ? '返回台账' : '取消'}</Button>
    {!writer.uncertain && !loading && (stale ? <Button onClick={onRefresh}>刷新台账</Button> : blocked || error && !preview ? <Button onClick={() => setRevision(value => value + 1)}>重新预览</Button> : null)}
    {writer.uncertain ? <Button danger type="primary" loading={writer.busy} onClick={() => void submit()}>同请求重试删除</Button> : <Button danger type="primary" disabled={!ready} loading={writer.busy} onClick={() => void submit()}>确认删除</Button>}
  </Space>}>
    <p>删除 {sources.length} 条制程不良台账？记录将从台账移除，附件和历史保留。</p>
    {writer.uncertain ? <Alert type="warning" showIcon title="删除结果未知，请使用原请求重试。" /> :
      stale ? <Alert type="warning" showIcon title="所选记录已变更或移除，请刷新台账后重新选择。" /> :
      referenceConflict ? <Alert type="warning" showIcon title="业务关联已变化，请重新预览。" /> :
      <ProcessError cause={error} fallback={preview ? '删除操作未完成，请重试。' : '无法完成删除预览，请重新预览。'} />}
    {loading ? <Spin aria-label="正在预览删除" /> : blocked ? <Alert type="warning" showIcon title={blockedItems.length ? `${blockedItems.length} 条记录无法删除` : '所选记录无法删除'} description={[...blockerCounts].map(([label, count]) => `${count} 条${label}`).join('；') || undefined} /> : null}
  </Modal>;
}
