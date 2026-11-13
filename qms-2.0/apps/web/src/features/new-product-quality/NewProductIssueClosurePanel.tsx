import { Alert, Button, Empty, Input, List, Modal, Pagination, Select, Space, Tag, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { Link } from 'react-router-dom';
import { personLabel } from '../../ui/personLabel';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

type Issue = components['schemas']['NewProductIssueDto'];
type IssueList = components['schemas']['NewProductIssueListDto'];
type Action = 'assign' | 'measure' | 'verify' | 'close';

const labels: Record<string, string> = { OPEN: '待分派', ESCALATED: '已升级', IN_PROGRESS: '整改中', VERIFIED: '待关闭', CLOSED: '已关闭' };
const formalLabels: Record<string, string> = { OPEN: '待处理', IN_PROGRESS: '办理中', PENDING: '审批中', RESOLVED: '已解决', CLOSED: '已关闭', ARCHIVED: '已归档' };
const emptyStats: IssueList['stats'] = { total: 0, open: 0, escalated: 0, in_progress: 0, verified: 0, closed: 0, pending: 0, resolved: 0, archived: 0 };

function issueList(value: unknown): IssueList {
  if (!value || typeof value !== 'object') return { items: [], internalEightDIssues: [], stats: emptyStats };
  const candidate = value as Partial<IssueList>;
  return { items: Array.isArray(candidate.items) ? candidate.items : [], internalEightDIssues: Array.isArray(candidate.internalEightDIssues) ? candidate.internalEightDIssues : [], stats: candidate.stats ?? emptyStats };
}

export function NewProductIssueClosurePanel({ projectId, value, active, currentUserId, organizationId, onRefresh }: { projectId: string; value: unknown; active: boolean; currentUserId?: string; organizationId?: string; onRefresh: () => Promise<void> }) {
  const data = useMemo(() => issueList(value), [value]);
  const [action, setAction] = useState<{ type: Action; issue: Issue }>();
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [assigneeReady, setAssigneeReady] = useState(false);
  const [invalidated, setInvalidated] = useState(false);
  const initialScope = useRef(useWorkTabsStore.getState().sessionScope);
  const retired = useRef(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(Boolean(action) && (Boolean(text) || action?.type === 'assign' && Boolean(assigneeUserId)));
  useNavigationBusy(busy);
  useEffect(() => useWorkTabsStore.subscribe(state => {
    if (state.sessionScope === initialScope.current) return;
    retired.current = true; setInvalidated(true); setAssigneeReady(false); setAssigneeUserId(''); setAction(undefined);
  }), []);
  function close() { if (!busy) requestLeave(() => { setAction(undefined); setText(''); }, true); }

  function open(type: Action, issue: Issue) { if (!busy && !retired.current) requestLeave(() => { setError(undefined); setText(''); setAssigneeUserId(''); setAssigneeReady(false); setAction({ type, issue }); }); }
  async function submit() {
    if (!action || busy || retired.current || !active || action.type === 'assign' && !assigneeReady) return;
    const { type, issue } = action;
    const body = { ...(organizationId ? { organizationId } : {}), ...(type === 'assign' ? { expectedVersion: issue.version, assigneeUserId: assigneeUserId.trim() } : type === 'measure' ? { expectedVersion: issue.version, measurePlan: text.trim() } : type === 'verify' ? { expectedVersion: issue.version, verificationSummary: text.trim() } : { expectedVersion: issue.version, closureNote: text.trim() }) };
    if (type === 'assign' && !assigneeUserId.trim() || type !== 'assign' && !text.trim()) return;
    setBusy(true); setError(undefined);
    try {
      const token = await csrfToken();
      if (retired.current) return;
      await apiRequest(`/api/v1/new-product-quality/issues/${issue.id}/${type}`, { method: 'PUT', headers: { 'x-csrf-token': token, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });
      if (retired.current) return;
      setAction(undefined);
      await onRefresh();
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }

  return <section aria-label="试产问题闭环" className="new-product-quality-issue-panel">
    {invalidated ? <Alert type="warning" title="会话已变化，请重新打开项目。" /> : null}
    <Space align="center"><Typography.Title level={3} style={{ margin: 0 }}>试产问题闭环</Typography.Title><Tag>{data.stats.total} 条</Tag><Typography.Text type="secondary">待分派 {data.stats.open + data.stats.escalated} · 整改中 {data.stats.in_progress} · 待关闭 {data.stats.verified}</Typography.Text></Space>
    {error ? <Alert type="error" showIcon title="问题闭环操作失败" description={error instanceof ApiError ? safeAccountError(error) : '请重试'} /> : null}
    {data.internalEightDIssues.length ? <section aria-label="正式新品8D"><Typography.Title level={4}>正式新品8D</Typography.Title>{data.internalEightDIssues.map(issue => <Space wrap key={issue.problemId}><Link to={`/app/problem-workspace/${encodeURIComponent(issue.problemId)}`}>{issue.reportNumber}</Link><Tag>{formalLabels[issue.status] ?? issue.status}</Tag><span>{issue.severity}</span></Space>)}</section> : null}
    <List size="small" dataSource={data.items} locale={{ emptyText: <Empty description="暂无试产问题" /> }} renderItem={(issue) => <List.Item actions={active && issue.status !== 'CLOSED' ? [issue.status === 'OPEN' || issue.status === 'ESCALATED' ? <Button key="assign" type="link" onClick={() => open('assign', issue)}>分派</Button> : null, issue.status === 'IN_PROGRESS' ? <Button key="measure" type="link" onClick={() => open('measure', issue)}>记录措施</Button> : null, issue.status === 'IN_PROGRESS' && issue.owner_user_id !== currentUserId ? <Button key="verify" type="link" onClick={() => open('verify', issue)}>验证</Button> : null, issue.status === 'VERIFIED' && issue.verified_by_id !== currentUserId ? <Button key="close" type="link" onClick={() => open('close', issue)}>关闭</Button> : null].filter(Boolean) : undefined}><Space wrap><Typography.Text strong>{issue.severity}</Typography.Text><Tag color={issue.status === 'CLOSED' ? 'default' : issue.status === 'VERIFIED' ? 'success' : 'processing'}>{labels[issue.status] ?? issue.status}</Tag><Typography.Text type="secondary">责任人：{issue.owner_username ?? '未分派'}</Typography.Text>{issue.measure_plan ? <Typography.Text type="secondary">措施：{issue.measure_plan}</Typography.Text> : null}</Space></List.Item>} />
    <Modal open={Boolean(action)} title={action ? ({ assign: '分派试产问题', measure: '记录整改措施', verify: '验证整改效果', close: '关闭试产问题' }[action.type]) : ''} onCancel={close} closable={!busy} keyboard={!busy} mask={{ closable: !busy }} onOk={() => void submit()} okText="提交" okButtonProps={{ loading: busy, disabled: invalidated || !active || (action?.type === 'assign' ? !assigneeUserId.trim() || !assigneeReady : !text.trim()) }} cancelButtonProps={{ disabled: busy }} footer={(_, { CancelBtn, OkBtn }) => <div className="qms-dialog-actions" role="group" aria-label={action ? ({ assign: '分派试产问题', measure: '记录整改措施', verify: '验证整改效果', close: '关闭试产问题' }[action.type]) : '试产问题闭环'}><CancelBtn /><OkBtn /></div>}>
      {action?.type === 'assign' ? <TrialIssueAssigneePicker key={action.issue.id} issueId={action.issue.id} organizationId={organizationId} value={assigneeUserId} onChange={setAssigneeUserId} onReady={setAssigneeReady} disabled={busy || !active} /> : <Input.TextArea aria-label={action?.type === 'measure' ? '整改措施' : action?.type === 'verify' ? '验证结论' : '关闭说明'} value={text} onChange={(event) => setText(event.target.value)} maxLength={action?.type === 'close' ? 2000 : 10000} rows={4} disabled={busy} />}
    </Modal>
  </section>;
}

function TrialIssueAssigneePicker({ issueId, organizationId, value, disabled, onChange, onReady }: { issueId: string; organizationId?: string; value: string; disabled: boolean; onChange: (value: string) => void; onReady: (ready: boolean) => void }) {
  type Page = components['schemas']['NewProductIssueAssigneesDto'];
  const [query, setQuery] = useState({ search: '', page: 1 });
  const [result, setResult] = useState<Page>();
  const [selected, setSelected] = useState<Page['items'][number]>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setResult(undefined); setError(undefined);
    const params = new URLSearchParams({ search: query.search, page: String(query.page), pageSize: '20' });
    if (organizationId) params.set('organizationId', organizationId);
    void apiRequest<Page>(`/api/v1/new-product-quality/issues/${encodeURIComponent(issueId)}/assignees?${params}`, { signal: controller.signal }).then(next => {
      if (controller.signal.aborted) return;
      setResult(next); setSelected(previous => next.items.find(person => person.id === previous?.id) ?? previous);
    }).catch(cause => { if (!controller.signal.aborted) { setError(cause); setSelected(undefined); onChange(''); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [issueId, organizationId, query, revision, onChange]);
  const ready = !loading && !error && selected?.id === value && !!value;
  useEffect(() => { onReady(ready); }, [ready, onReady]);
  const options = selected && !result?.items.some(person => person.id === selected.id) ? [selected, ...(result?.items ?? [])] : result?.items ?? [];
  return <Space orientation="vertical" style={{ width: '100%' }}>
    <Input.Search aria-label="搜索责任人姓名" maxLength={200} disabled={disabled} onSearch={search => setQuery({ search: search.trim(), page: 1 })} />
    {error ? <Alert type="error" title={error instanceof ApiError ? safeAccountError(error) : '责任候选加载失败，请重试。'} action={<Button disabled={disabled || loading} onClick={() => setRevision(current => current + 1)}>重试候选人员</Button>} /> : null}
    <Select aria-label="试产问题责任人" value={value || undefined} placeholder="请选择责任人" disabled={disabled || loading || !!error} loading={loading} style={{ width: '100%' }} options={options.map(person => ({ value: person.id, label: personLabel(person) }))} onChange={id => { setSelected(options.find(person => person.id === id)); onChange(id); }} />
    <Pagination aria-label="试产责任人候选分页" size="small" current={query.page} pageSize={20} total={result?.total ?? 0} showSizeChanger={false} disabled={disabled || loading || !!error} onChange={page => setQuery({ ...query, page })} />
  </Space>;
}
