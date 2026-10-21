import { Alert, Button, Empty, Input, List, Modal, Space, Spin, Tag, Typography } from 'antd';
import { useState } from 'react';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken, getSession, safeAccountError } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';

type AuditNc = components['schemas']['AuditNcResponseDto'];
type Action = 'assign' | 'response' | 'verify' | 'close';

const statusLabels: Record<string, string> = { OPEN: '待分派', ASSIGNED: '整改中', RESPONDED: '待验证', VERIFIED: '待关闭', REJECTED: '验证退回', CLOSED: '已关闭' };

export function AuditNcClosurePanel() {
  const [executionInput, setExecutionInput] = useState('');
  const [executionId, setExecutionId] = useState('');
  const [items, setItems] = useState<AuditNc[]>();
  const [userId, setUserId] = useState('');
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [action, setAction] = useState<{ type: Action; item: AuditNc }>();
  const [note, setNote] = useState('');
  const [assignee, setAssignee] = useState('');
  const conflict = error instanceof ApiError && error.status === 409;
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(Boolean(action) && (Boolean(note) || action?.type === 'assign' && assignee !== (action.item.assignee_user_id ?? '')));
  useNavigationBusy(busy);
  function close() { if (!busy) requestLeave(() => { setAction(undefined); setNote(''); }, true); }
  function lookup() { if (!busy) requestLeave(() => { setAction(undefined); setNote(''); void load(executionInput); }); }
  function refresh() { if (!busy) requestLeave(() => { setAction(undefined); setNote(''); void load(); }); }

  async function load(id = executionId) {
    const value = id.trim();
    if (!value) return;
    setLoading(true);
    setError(undefined);
    try {
      const [ncs, permissions, session] = await Promise.all([
        apiRequest<AuditNc[]>(`/api/v1/audit-management/executions/${encodeURIComponent(value)}/ncs`),
        apiRequest<components['schemas']['PermissionsResponseDto']>('/api/v1/system/my-permissions'),
        getSession(),
      ]);
      setExecutionId(value);
      setItems(ncs);
      setUserId(session.userId);
      setCanWrite(permissions.organizationId === session.organizationId && permissions.permissions.includes('audit-management:write'));
    } catch (cause) {
      setItems(undefined);
      setCanWrite(false);
      setError(cause);
    } finally { setLoading(false); }
  }

  function open(type: Action, item: AuditNc) {
    if (!busy) requestLeave(() => {
      setError(undefined);
      setNote('');
      setAssignee(item.assignee_user_id ?? '');
      setAction({ type, item });
    });
  }

  async function submit(accepted = true) {
    if (!action || busy || conflict) return;
    const { item, type } = action;
    const body = type === 'assign' ? { expectedVersion: item.version, assigneeUserId: assignee.trim() }
      : type === 'response' ? { expectedVersion: item.version, response: note.trim() }
        : type === 'verify' ? { expectedVersion: item.version, accepted, verificationNote: note.trim() }
          : { expectedVersion: item.version };
    if (type === 'assign' && !assignee.trim() || (type === 'response' || type === 'verify') && !note.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await apiRequest(`/api/v1/audit-management/ncs/${item.id}/${type}`, {
        method: 'PUT',
        headers: { 'x-csrf-token': await csrfToken(), 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      setAction(undefined);
      await load();
    } catch (cause) {
      setError(cause);
      if (cause instanceof ApiError && cause.status !== undefined && [403, 404].includes(cause.status)) {
        setAction(undefined);
        await load();
        setError(cause);
      }
    } finally { setBusy(false); }
  }

  return <section className="audit-management-card audit-nc-panel" aria-label="审核整改验证关闭">
    <Typography.Title level={3}>审核整改验证关闭</Typography.Title>
    <Space.Compact className="audit-management-lookup"><Input aria-label="整改审核执行 ID" value={executionInput} onChange={(event) => setExecutionInput(event.target.value)} placeholder="输入审核执行 ID" /><Button onClick={lookup} loading={loading} disabled={busy || !executionInput.trim()}>查看整改记录</Button></Space.Compact>
    {error ? <Alert type={error instanceof ApiError && error.status === 403 ? 'warning' : 'error'} showIcon title={error instanceof ApiError ? safeAccountError(error) : '整改记录加载或操作失败'} action={executionId ? <Button disabled={busy} onClick={refresh}>刷新记录</Button> : undefined} /> : null}
    {loading ? <Spin /> : items ? <List dataSource={items} locale={{ emptyText: <Empty description="该执行暂无整改记录" /> }} renderItem={(item) => <List.Item key={item.id} actions={canWrite ? [
      ...(['OPEN', 'REJECTED'].includes(item.status) ? [<Button key="assign" onClick={() => open('assign', item)}>分派整改</Button>] : []),
      ...(['ASSIGNED', 'REJECTED'].includes(item.status) && item.assignee_user_id === userId ? [<Button key="response" onClick={() => open('response', item)}>提交整改</Button>] : []),
      ...(item.status === 'RESPONDED' && item.assignee_user_id !== userId ? [<Button key="verify" onClick={() => open('verify', item)}>验证整改</Button>] : []),
      ...(item.status === 'VERIFIED' ? [<Button key="close" onClick={() => open('close', item)}>关闭整改</Button>] : []),
    ] : undefined}><List.Item.Meta title={<Space><Typography.Text strong>{item.severity}</Typography.Text><Tag>{statusLabels[item.status] ?? item.status}</Tag></Space>} description={<Space orientation="vertical"><span>期限：{new Date(item.due_at).toLocaleString()}</span>{item.response ? <span>整改回复：{item.response}</span> : null}{item.verification_note ? <span>验证结论：{item.verification_note}</span> : null}{item.problem_index_id ? <span>正式问题：{item.problem_index_id}</span> : null}</Space>} /></List.Item>} /> : null}
    <Modal open={Boolean(action)} title={action ? ({ assign: '分派审核整改', response: '提交整改回复', verify: '独立验证整改', close: '关闭审核整改' }[action.type]) : ''} onCancel={close} closable={!busy} keyboard={!busy} mask={{ closable: !busy }} footer={action?.type === 'verify' ? <div className="qms-dialog-actions" role="group" aria-label="独立验证整改"><Button disabled={busy} onClick={close}>取消</Button><Button danger loading={busy} disabled={conflict || !note.trim()} onClick={() => void submit(false)}>验证退回</Button><Button type="primary" loading={busy} disabled={conflict || !note.trim()} onClick={() => void submit(true)}>验证通过</Button></div> : (_, { CancelBtn, OkBtn }) => <div className="qms-dialog-actions" role="group" aria-label={action ? ({ assign: '分派审核整改', response: '提交整改回复', verify: '独立验证整改', close: '关闭审核整改' }[action.type]) : '审核整改验证关闭'}><CancelBtn /><OkBtn /></div>} onOk={() => void submit()} okText="确认提交" okButtonProps={{ loading: busy, disabled: conflict || (action?.type === 'assign' ? !assignee.trim() : action?.type === 'response' ? !note.trim() : false) }} cancelButtonProps={{ disabled: busy }}>
      {action?.type === 'assign' ? <Input aria-label="整改责任人用户 ID" value={assignee} onChange={(event) => setAssignee(event.target.value)} disabled={busy} /> : action?.type === 'response' || action?.type === 'verify' ? <Input.TextArea aria-label={action.type === 'verify' ? '验证结论' : '整改回复'} value={note} onChange={(event) => setNote(event.target.value)} maxLength={action.type === 'verify' ? 5000 : 10000} rows={4} disabled={busy} /> : <p>仅已通过独立验证的整改记录可关闭。</p>}
      {error ? <Alert type="error" showIcon title={conflict ? '记录版本已变化，输入已保留。请核对输入，放弃后刷新最新记录。' : error instanceof ApiError ? safeAccountError(error) : '操作失败，请重试'} action={conflict ? <Button disabled={busy} onClick={refresh}>放弃输入并刷新记录</Button> : undefined} /> : null}
    </Modal>
  </section>;
}
