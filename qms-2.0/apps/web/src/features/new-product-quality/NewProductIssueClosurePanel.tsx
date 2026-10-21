import { Alert, Button, Empty, Input, List, Modal, Space, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';

type Issue = components['schemas']['NewProductIssueDto'];
type IssueList = components['schemas']['NewProductIssueListDto'];
type Action = 'assign' | 'measure' | 'verify' | 'close';

const labels: Record<string, string> = { OPEN: '待分派', ESCALATED: '已升级', IN_PROGRESS: '整改中', VERIFIED: '待关闭', CLOSED: '已关闭' };

function issueList(value: unknown): IssueList {
  if (!value || typeof value !== 'object') return { items: [], stats: { total: 0, open: 0, escalated: 0, in_progress: 0, verified: 0, closed: 0 } };
  const candidate = value as Partial<IssueList>;
  return { items: Array.isArray(candidate.items) ? candidate.items : [], stats: candidate.stats ?? { total: 0, open: 0, escalated: 0, in_progress: 0, verified: 0, closed: 0 } };
}

export function NewProductIssueClosurePanel({ projectId, value, active, currentUserId, onRefresh }: { projectId: string; value: unknown; active: boolean; currentUserId?: string; onRefresh: () => Promise<void> }) {
  const data = useMemo(() => issueList(value), [value]);
  const [action, setAction] = useState<{ type: Action; issue: Issue }>();
  const [assigneeUserId, setAssigneeUserId] = useState(currentUserId ?? '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(Boolean(action) && (Boolean(text) || action?.type === 'assign' && assigneeUserId !== (currentUserId ?? '')));
  useNavigationBusy(busy);
  function close() { if (!busy) requestLeave(() => { setAction(undefined); setText(''); }, true); }

  function open(type: Action, issue: Issue) { if (!busy) requestLeave(() => { setError(undefined); setText(''); setAssigneeUserId(currentUserId ?? ''); setAction({ type, issue }); }); }
  async function submit() {
    if (!action || busy) return;
    const { type, issue } = action;
    const body = type === 'assign' ? { expectedVersion: issue.version, assigneeUserId: assigneeUserId.trim() } : type === 'measure' ? { expectedVersion: issue.version, measurePlan: text.trim() } : type === 'verify' ? { expectedVersion: issue.version, verificationSummary: text.trim() } : { expectedVersion: issue.version, closureNote: text.trim() };
    if (type === 'assign' && !assigneeUserId.trim() || type !== 'assign' && !text.trim()) return;
    setBusy(true); setError(undefined);
    try {
      const token = await csrfToken();
      await apiRequest(`/api/v1/new-product-quality/issues/${issue.id}/${type}`, { method: 'PUT', headers: { 'x-csrf-token': token, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });
      setAction(undefined);
      await onRefresh();
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }

  return <section aria-label="试产问题闭环" className="new-product-quality-issue-panel">
    <Space align="center"><Typography.Title level={3} style={{ margin: 0 }}>试产问题闭环</Typography.Title><Tag>{data.stats.total} 条</Tag><Typography.Text type="secondary">待分派 {data.stats.open + data.stats.escalated} · 整改中 {data.stats.in_progress} · 待关闭 {data.stats.verified}</Typography.Text></Space>
    {error ? <Alert type="error" showIcon title="问题闭环操作失败" description={error instanceof ApiError ? safeAccountError(error) : '请重试'} /> : null}
    <List size="small" dataSource={data.items} locale={{ emptyText: <Empty description="暂无试产问题" /> }} renderItem={(issue) => <List.Item actions={active && issue.status !== 'CLOSED' ? [issue.status === 'OPEN' || issue.status === 'ESCALATED' ? <Button key="assign" type="link" onClick={() => open('assign', issue)}>分派</Button> : null, issue.status === 'IN_PROGRESS' ? <Button key="measure" type="link" onClick={() => open('measure', issue)}>记录措施</Button> : null, issue.status === 'IN_PROGRESS' && issue.owner_user_id !== currentUserId ? <Button key="verify" type="link" onClick={() => open('verify', issue)}>验证</Button> : null, issue.status === 'VERIFIED' && issue.verified_by_id !== currentUserId ? <Button key="close" type="link" onClick={() => open('close', issue)}>关闭</Button> : null].filter(Boolean) : undefined}><Space wrap><Typography.Text strong>{issue.severity}</Typography.Text><Tag color={issue.status === 'CLOSED' ? 'default' : issue.status === 'VERIFIED' ? 'success' : 'processing'}>{labels[issue.status] ?? issue.status}</Tag><Typography.Text type="secondary">责任人：{issue.owner_username ?? '未分派'}</Typography.Text>{issue.measure_plan ? <Typography.Text type="secondary">措施：{issue.measure_plan}</Typography.Text> : null}</Space></List.Item>} />
    <Modal open={Boolean(action)} title={action ? ({ assign: '分派试产问题', measure: '记录整改措施', verify: '验证整改效果', close: '关闭试产问题' }[action.type]) : ''} onCancel={close} closable={!busy} keyboard={!busy} mask={{ closable: !busy }} onOk={() => void submit()} okText="提交" okButtonProps={{ loading: busy, disabled: action?.type === 'assign' ? !assigneeUserId.trim() : !text.trim() }} cancelButtonProps={{ disabled: busy }} footer={(_, { CancelBtn, OkBtn }) => <div className="qms-dialog-actions" role="group" aria-label={action ? ({ assign: '分派试产问题', measure: '记录整改措施', verify: '验证整改效果', close: '关闭试产问题' }[action.type]) : '试产问题闭环'}><CancelBtn /><OkBtn /></div>}>
      {action?.type === 'assign' ? <Input aria-label="责任人用户 ID" value={assigneeUserId} onChange={(event) => setAssigneeUserId(event.target.value)} placeholder="输入组织内责任人用户 ID" disabled={busy} /> : <Input.TextArea aria-label={action?.type === 'measure' ? '整改措施' : action?.type === 'verify' ? '验证结论' : '关闭说明'} value={text} onChange={(event) => setText(event.target.value)} maxLength={action?.type === 'close' ? 2000 : 10000} rows={4} disabled={busy} />}
    </Modal>
  </section>;
}
