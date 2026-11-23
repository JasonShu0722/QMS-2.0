import type { components } from '@qms/contracts';
import { Alert, Button, Form, Input, Modal, Space, Spin, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { RecordList } from '../../ui/list/RecordList';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { denied, ProcessError, useProcessWrite, type Defect } from './process-ledger';

type Preview = components['schemas']['ProcessDefectDeletionPreviewDto'];
type Result = components['schemas']['ProcessDefectDeletionResultDto'];
const blockerLabels: Record<string, string> = { FORMAL_PROBLEM: '已关联正式问题', NEW_PRODUCT_SELECTION: '已用于新品质量项目', SUPPLIER_SOURCE_COPY: '已复制为供应商问题来源' };

export function ProcessDefectDeletionDialog({ sources, organizationId, open, onClose, onDeleted, onDenied }: { sources: Defect[]; organizationId?: string; open: boolean; onClose: (uncertain: boolean) => void; onDeleted: (result: Result) => void; onDenied: (cause?: unknown) => void }) {
  const scope = useWorkTabsStore(state => state.sessionScope);
  const [preview, setPreview] = useState<Preview>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>();
  const controller = useRef<AbortController>(undefined);
  const alive = useRef(true);
  const submitting = useRef(false);
  const writer = useProcessWrite(onDenied);
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(!!reason || writer.uncertain);
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
      if (value.count !== sources.length || value.items.length !== sources.length || sources.some(source => !value.items.some(item => item.defectId === source.id && item.expectedVersion === source.version))) throw new Error('删除预览不完整，请重新预览。');
      if (alive.current) setPreview(value);
    }
    void read().catch(cause => { if (!current.signal.aborted && alive.current) { setError(cause); if (denied(cause)) onDenied(cause); } }).finally(() => { if (!current.signal.aborted && alive.current) setLoading(false); });
    return () => current.abort();
  }, [revision]);
  function close() {
    if (submitting.current) return;
    if (writer.uncertain) onClose(true);
    else requestLeave(() => { controller.current?.abort(); onClose(false); }, true);
  }
  async function submit() {
    if (submitting.current || !writer.uncertain && (!preview?.canDelete || preview.items.some(item => item.blocked) || !reason.trim() || reason.trim().length > 300)) return;
    submitting.current = true; setError(undefined);
    try {
      const body: components['schemas']['DeleteProcessDefectsDto'] = { organizationId, sources: sources.map(record => ({ defectId: record.id, expectedVersion: record.version })), reason: reason.trim() };
      const result = await writer.write<Result>('/api/v1/process-quality/defects/deletion', body, 'POST');
      if (alive.current) onDeleted(result);
    } catch (cause) { if (alive.current) { setError(cause); if (cause instanceof ApiError && cause.status === 409) setPreview(undefined); } }
    finally { submitting.current = false; }
  }
  const blocked = !preview?.canDelete || preview.items.some(item => item.blocked);
  return <Modal title="删除制程不良台账" open={open} onCancel={close} closable={!writer.busy} keyboard={!writer.busy} mask={{ closable: !writer.busy }} footer={<Space wrap><Button disabled={writer.busy} onClick={close}>返回台账</Button>{writer.uncertain ? <Button danger type="primary" loading={writer.busy} onClick={() => void submit()}>同请求重试删除</Button> : <Button danger type="primary" disabled={loading || blocked || !reason.trim() || reason.trim().length > 300} loading={writer.busy} onClick={() => void submit()}>确认删除</Button>}</Space>}>
    <p>已选择 {sources.length} 条台账。删除后将退出正常台账，来源身份、附件与历史保留。</p>
    <ProcessError cause={error} fallback="删除操作未完成，请重试。" />
    {writer.uncertain ? <Alert type="warning" showIcon title="删除结果未知，请使用原请求重试。" /> : null}
    {loading ? <Spin aria-label="正在预览删除" /> : preview ? <RecordList items={preview.items} itemKey={item => item.defectId} renderItem={item => <div className="process-quality-description"><span>{item.description || '待完善记录'}</span>{item.blocked ? <Tag color="error">无法删除</Tag> : null}{item.blockers.map((blocker, index) => <div key={index}>{blockerLabels[blocker.code] ?? '存在有效业务关联'}{blocker.reportNumber ? `：${blocker.reportNumber}` : ''}</div>)}</div>} /> : null}
    {!writer.uncertain ? <Button disabled={loading || writer.busy} onClick={() => setRevision(value => value + 1)}>重新预览</Button> : null}
    <Form layout="vertical"><Form.Item label="删除原因" htmlFor="process-defect-deletion-reason" required validateStatus={reason.trim().length > 300 ? 'error' : undefined} help={reason.trim().length > 300 ? '删除原因最多300字' : undefined}><Input.TextArea id="process-defect-deletion-reason" value={reason} disabled={writer.busy || writer.uncertain} showCount maxLength={300} autoSize={{ minRows: 2, maxRows: 5 }} onChange={event => setReason(event.target.value)} /></Form.Item></Form>
  </Modal>;
}
