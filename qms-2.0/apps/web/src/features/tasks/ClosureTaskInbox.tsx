import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Collapse, Input, Modal, Pagination, Radio, Space, Spin, Table, Tag, Typography } from 'antd';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, createAdminMutation, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useCompletedSessionNavigation, useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

type Task = components['schemas']['ClosureTaskDto'];
type Tasks = components['schemas']['ClosureTaskPageDto'];
type Notices = components['schemas']['ClosureNotificationPageDto'];
type Round = components['schemas']['WorkflowClosureRoundDto'];
type Decision = components['schemas']['DecideWorkflowClosureRoundDto'];
const pageSize = 25;
const taskPath = (offset: number) => `/api/v1/tasks/closure?pageSize=${pageSize}&offset=${offset}`;
const historyPath = (problemId: string) => `/api/v1/workflow-closure/problems/${encodeURIComponent(problemId)}/rounds`;
const dutyNames = { PROFESSIONAL: '专业审核', SECTION_MANAGER: '科室经理', MINISTER: '部长' };
const statusNames = { PENDING: '待处理', WAITING: '等待前序', APPROVED: '已通过', RETURNED: '已退回', CANCELLED: '已取消', SKIPPED_SAME_PERSON: '同人跳过' };
const english: Record<string, string> = {
  '关闭职责待办': 'Closure duty inbox', '关闭职责通知': 'Closure notifications', '刷新职责待办': 'Refresh closure tasks', '刷新职责通知': 'Refresh closure notifications',
  '审核关闭职责': 'Review closure duty', '关闭职责审核': 'Closure duty review', '固定内容版本': 'Fixed content version', '轮次标识': 'Round ID',
  '专业审核': 'Professional review', '科室经理': 'Section manager', '部长': 'Minister', '等待前序': 'Waiting for prerequisite', '已通过': 'Approved', '已退回': 'Returned', '已取消': 'Cancelled', '同人跳过': 'Skipped: same person',
  '职责': 'Duty', '职责人员标识': 'Duty user ID', '审核状态': 'Review status', '问题编号': 'Report number', '轮次版本': 'Round version',
  '暂无关闭职责待办': 'No closure duty tasks', '暂无关闭职责通知': 'No closure notifications', '暂无轮次历史': 'No round history',
  '审核意见': 'Review comment', '审核决定': 'Review decision', '同意': 'Approve', '退回修改': 'Return for changes', '提交审核': 'Submit review', '关闭审核': 'Close review',
  '刷新审核基线': 'Refresh review baseline', '重试原请求': 'Retry original request', '正在核对审核基线': 'Checking review baseline',
  '本次一次确认科室经理与部长两份职责，不包含专业审核。': 'This confirms both section manager and minister duties once. Professional review is not included.',
  '我确认同时审核科室经理与部长两份职责': 'I confirm both section manager and minister duties',
  '审核基线已失效，请刷新核对；审核意见已保留。': 'The review baseline is stale. Refresh and check again; your comment is retained.',
  '审核结果尚未确认，意见、决定与幂等请求已冻结；只能重试原请求。': 'The review result is unknown. Comment, decision and idempotent request are frozen. Retry only the original request.',
  '身份验证已完成，意见、决定与幂等请求已冻结；请显式重试原请求。': 'Identity verification is complete. Comment, decision and idempotent request are frozen. Explicitly retry the original request.',
  '先前审核结果仍待核对；权限失效不代表请求已撤销，请联系有权限人员核对。': 'The previous review result still needs verification. Losing permission does not cancel the request. Contact an authorized reviewer to check the result.',
  '提交审核前，请打开问题工作空间核对完整内容。': 'Open the problem workspace and review the full content before deciding.',
  '核对问题工作空间': 'Check problem workspace', '轮次与职责历史': 'Round and duty history', '无权审核关闭职责': 'You cannot review closure duties',
  '加载失败，请重试': 'Loading failed. Retry.', '审核失败，意见已保留。': 'Review failed. Your comment is retained.',
  '审核回执': 'Review receipt', '本轮已取消，请恢复修改后重新提交；本次不算审核通过。': 'This round was cancelled. Restore editing and resubmit; this is not an approval.',
  '本轮已退回，请修改后重新提交。': 'The round was returned. Make changes and resubmit.', '本次职责已记录；本轮待处理。': 'Your duty decision is recorded. This round is still pending.', '本轮已通过。': 'This round is approved.',
  '职责由后台分派，不支持申领或转派审批人员。': 'Duties are assigned by the server. Reviewers cannot be claimed or transferred here.',
};

function usePage<Page>(path: string, current: () => boolean, reportError: (cause: unknown) => void) {
  const [data, setData] = useState<Page>();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision(value => value + 1);
  const replace = (value: Page) => { setData(value); setError(false); };
  useEffect(() => {
    const controller = new AbortController();
    const unsubscribe = useWorkTabsStore.subscribe(() => { if (!current()) controller.abort(); });
    setLoading(true); setError(false); setData(undefined);
    apiRequest<Page>(path, { signal: controller.signal }).then(value => {
      if (current() && !controller.signal.aborted) setData(value);
    }).catch((cause: unknown) => {
      if (current() && !controller.signal.aborted) { setError(true); reportError(cause); }
    }).finally(() => { if (current() && !controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); unsubscribe(); };
  }, [path, revision, current, reportError]);
  return { data, error, loading, refresh, replace };
}

export function ClosureTaskInbox({ onDenied }: { onDenied?: (cause: unknown) => void } = {}) {
  const session = useWorkTabsStore(state => state.sessionScope);
  const location = useLocation();
  return <ClosureInboxScope key={JSON.stringify([session, location.pathname, location.search])} session={session} onDenied={onDenied} />;
}

function ClosureInboxScope({ session, onDenied }: { session?: string; onDenied?: (cause: unknown) => void }) {
  const { t, locale } = useLanguage();
  const text = (value: string) => locale === 'en-US' ? english[value] ?? t(value) : t(value);
  const navigate = useNavigate();
  const completeSessionNavigation = useCompletedSessionNavigation();
  const requestLeave = useNavigationGuard();
  const alive = useRef(true);
  const ending = useRef(false);
  const accessRevoked = useRef(false);
  const lifetime = useRef(new AbortController());
  const deniedCallback = useRef(onDenied); deniedCallback.current = onDenied;
  const historyController = useRef<AbortController | undefined>(undefined);
  const writing = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const mutate = useRef(createAdminMutation({ replayAfterReauthentication: false }));
  const [denied, setDenied] = useState<ApiError>();
  const [unauthorized, setUnauthorized] = useState(false);
  const [taskOffset, setTaskOffset] = useState(0);
  const [noticeOffset, setNoticeOffset] = useState(0);
  const [selected, setSelected] = useState<Task>();
  const [history, setHistory] = useState<Round[]>([]);
  const [baseline, setBaseline] = useState<{ round: Round; duties: Decision['duties'] }>();
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [decision, setDecision] = useState<Decision['decision']>('APPROVE');
  const [jointConfirmed, setJointConfirmed] = useState(false);
  const [attempt, setAttempt] = useState<{ path: string; body: Decision }>();
  const [outcomeNeedsCheck, setOutcomeNeedsCheck] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [receipt, setReceipt] = useState<Round>();
  useEffect(() => { if (!selected) trigger.current?.focus(); }, [selected]);
  const current = useCallback(() => alive.current && !ending.current && !accessRevoked.current && session === useWorkTabsStore.getState().sessionScope, [session]);
  useEffect(() => {
    alive.current = true; lifetime.current = new AbortController();
    const abort = () => { lifetime.current.abort(); historyController.current?.abort(); };
    const unsubscribe = useWorkTabsStore.subscribe(() => { if (!current()) abort(); });
    return () => { alive.current = false; abort(); unsubscribe(); };
  }, [current]);
  const reportError = useCallback((cause: unknown, writeSettled = false) => {
    if (!current()) return;
    if (cause instanceof ApiError && cause.status === 401) {
      ending.current = true; lifetime.current.abort(); historyController.current?.abort();
      setSelected(undefined); setComment(''); setAttempt(undefined); setReceipt(undefined); setBusy(false);
      setUnauthorized(true);
    } else if (cause instanceof ApiError && cause.status === 403) {
      // Revoke this scope before aborting: even transports ignoring abort must not refill it.
      accessRevoked.current = true; lifetime.current.abort(); historyController.current?.abort();
      if (writing.current && !writeSettled) setOutcomeNeedsCheck(true);
      writing.current = false; setBusy(false); setChecking(false);
      setDenied(cause); setBaseline(undefined); setHistory([]); setReceipt(undefined); setReviewError('无权审核关闭职责');
    }
    if (cause instanceof ApiError && [401, 403].includes(cause.status ?? 0)) deniedCallback.current?.(cause);
  }, [current]);
  const tasks = usePage<Tasks>(taskPath(taskOffset), current, reportError);
  const notices = usePage<Notices>(`/api/v1/notifications/closure?pageSize=${pageSize}&offset=${noticeOffset}`, current, reportError);
  useUnsavedChanges(!!selected && (comment.length > 0 || decision !== 'APPROVE' || jointConfirmed || !!attempt));
  useNavigationBusy(!denied && (busy || !!attempt));
  useEffect(() => {
    if (!unauthorized || !alive.current || session !== useWorkTabsStore.getState().sessionScope) return;
    // Release this inbox's busy registration before bypassing the parent draft guard.
    completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
  }, [unauthorized, session, completeSessionNavigation, navigate]);

  async function checkHistory(task: Task, reloadTask = false) {
    if (writing.current || denied) return;
    historyController.current?.abort();
    const controller = new AbortController(); historyController.current = controller;
    setChecking(true); setBaseline(undefined); setHistory([]); setJointConfirmed(false); setReviewError('');
    const active = () => current() && !controller.signal.aborted;
    try {
      if (reloadTask) {
        const fresh = await apiRequest<Tasks>(taskPath(taskOffset), { signal: controller.signal });
        if (!active()) return;
        tasks.replace(fresh);
        const updated = fresh.items.find(item => item.id === task.id && item.roundId === task.roundId && item.userId === task.userId && item.duty === task.duty);
        if (!updated) throw new Error('Stale closure task');
        task = updated; setSelected(updated);
      }
      const rounds = await apiRequest<Round[]>(historyPath(task.problemId), { signal: controller.signal });
      if (!active()) return;
      setHistory(rounds);
      const pending = rounds.filter(item => item.status === 'PENDING');
      const round = pending.find(item => item.id === task.roundId);
      const joint = task.duty !== 'PROFESSIONAL' && task.requiresJointConfirmation;
      const duties: Decision['duties'] = joint ? ['SECTION_MANAGER', 'MINISTER'] : [task.duty];
      // The server's same-person group is user-level metadata, not a professional decision.
      const validJoint = task.requiresJointConfirmation
        ? task.jointDuties.length === 2 && task.jointDuties.includes('SECTION_MANAGER') && task.jointDuties.includes('MINISTER')
        : task.jointDuties.length === 0;
      const mine = round?.duties.filter(item => item.userId === task.userId && item.status === 'PENDING');
      const bothManagement = mine?.some(item => item.duty === 'SECTION_MANAGER') && mine.some(item => item.duty === 'MINISTER');
      if (!round || pending.length !== 1 || !task.canAct || task.status !== 'PENDING' || round.problemId !== task.problemId || round.version !== task.roundVersion || round.contentVersion !== task.contentVersion || round.workflowVersionId !== task.workflowVersionId || !validJoint || (task.duty !== 'PROFESSIONAL' && !!bothManagement !== joint) || !duties.every(name => mine?.some(item => item.duty === name))) throw new Error('Stale closure baseline');
      setBaseline({ round, duties });
    } catch (cause) {
      if (active()) { setReviewError('审核基线已失效，请刷新核对；审核意见已保留。'); reportError(cause); }
    } finally { if (active()) setChecking(false); }
  }
  function closeReview() {
    if (!denied && (writing.current || attempt)) return;
    requestLeave(() => {
      historyController.current?.abort(); setChecking(false); setSelected(undefined); setBaseline(undefined); setHistory([]); setComment(''); setDecision('APPROVE'); setJointConfirmed(false); setAttempt(undefined); setReviewError('');
      trigger.current?.focus();
    }, true);
  }
  async function submit(original = attempt) {
    if (!current() || writing.current || denied || checking || (!original && (!selected || !baseline || !comment.trim() || comment.length > 2000 || (baseline.duties.length === 2 && !jointConfirmed)))) return;
    const request = original ?? { path: `/api/v1/workflow-closure/rounds/${encodeURIComponent(baseline!.round.id)}/decide`, body: { expectedRoundVersion: baseline!.round.version, duties: [...baseline!.duties], decision, comment } };
    writing.current = true; setBusy(true); setReviewError('');
    try {
      const result = await mutate.current<Round>(request.path, 'POST', request.body, lifetime.current.signal);
      if (!current()) return;
      setReceipt(result); setAttempt(undefined); setOutcomeNeedsCheck(false); setBaseline(undefined); setSelected(undefined); setHistory([]); setComment(''); setDecision('APPROVE'); setJointConfirmed(false);
      tasks.refresh(); notices.refresh(); trigger.current?.focus();
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof ApiError && cause.code === 'CLIENT_REAUTHENTICATION_COMPLETED') {
        setAttempt(request); setReviewError('身份验证已完成，意见、决定与幂等请求已冻结；请显式重试原请求。');
      } else if (!(cause instanceof ApiError) || !cause.status || cause.status >= 500) {
        setAttempt(request); setOutcomeNeedsCheck(true); setReviewError('审核结果尚未确认，意见、决定与幂等请求已冻结；只能重试原请求。');
      } else {
        setAttempt(undefined); mutate.current = createAdminMutation({ replayAfterReauthentication: false });
        if (cause.status === 409 || cause.status === 404) { setBaseline(undefined); setHistory([]); setJointConfirmed(false); setReviewError('审核基线已失效，请刷新核对；审核意见已保留。'); }
        else setReviewError(safeAccountError(cause));
      }
      reportError(cause, true);
    } finally { if (current()) { writing.current = false; setBusy(false); } }
  }
  const pagination = (offset: number, total: number, change: (value: number) => void) => <Pagination current={offset / pageSize + 1} pageSize={pageSize} total={Math.min(total, 10000 + pageSize)} showSizeChanger={false} onChange={page => change((page - 1) * pageSize)} />;
  const refreshTasks = () => { if (!writing.current && !attempt) requestLeave(tasks.refresh); };
  const locked = busy || !!attempt || !!denied;
  const closeLocked = !denied && (busy || !!attempt);
  const workspace = (problemId: string, instanceId?: string) => `/app/problem-workspace/${encodeURIComponent(problemId)}${instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : ''}`;
  const roundLabel = (number: number) => locale === 'en-US' ? `Round ${number}` : `第 ${number} 轮`;
  const summary = (result: Round) => result.status === 'CANCELLED' ? '本轮已取消，请恢复修改后重新提交；本次不算审核通过。' : result.status === 'RETURNED' ? '本轮已退回，请修改后重新提交。' : result.status === 'PENDING' ? '本次职责已记录；本轮待处理。' : '本轮已通过。';
  const deniedOutcome = denied && outcomeNeedsCheck && <Alert type="warning" showIcon title={text('先前审核结果仍待核对；权限失效不代表请求已撤销，请联系有权限人员核对。')} />;
  return <div style={{ display: 'grid', gap: 'var(--qms-section-gap)', minWidth: 0 }}>

    {!denied && receipt && <Alert showIcon type={receipt.status === 'CANCELLED' || receipt.status === 'RETURNED' ? 'warning' : 'success'} title={`${text('审核回执')}：${receipt.id} · ${roundLabel(receipt.roundNumber)} · ${text(statusNames[receipt.status])} · v${receipt.version}`} description={text(summary(receipt))} />}
    {denied ? <Alert type="error" showIcon title={text('无权审核关闭职责')} description={denied.traceId ? <code>{denied.traceId}</code> : undefined} /> : <>
      <section aria-label={text('关闭职责待办')} style={{ minWidth: 0 }}>
        <Space wrap><Typography.Title level={4}>{text('关闭职责待办')}</Typography.Title><Button onClick={refreshTasks} disabled={tasks.loading || locked || checking}>{text('刷新职责待办')}</Button></Space>
        {tasks.error && <Alert type="error" showIcon title={text('加载失败，请重试')} />}
        {!tasks.error && <Table<Task> rowKey="id" size="small" loading={tasks.loading} dataSource={tasks.data?.items ?? []} pagination={false} scroll={{ x: 880 }} locale={{ emptyText: text('暂无关闭职责待办') }} columns={[
          { title: text('问题编号'), dataIndex: 'reportNumber', render: (value: string, item) => <Link to={workspace(item.problemId)}>{value}</Link> },
          { title: text('职责'), dataIndex: 'duty', render: (value: Task['duty'], item) => <Space orientation="vertical" size={0}><Tag>{text(dutyNames[value])}</Tag>{value !== 'PROFESSIONAL' && item.requiresJointConfirmation && <Typography.Text strong>{text('本次一次确认科室经理与部长两份职责，不包含专业审核。')}</Typography.Text>}</Space> },
          { title: text('固定内容版本'), dataIndex: 'contentVersion' }, { title: text('轮次版本'), dataIndex: 'roundVersion' },
          { title: text('轮次标识'), dataIndex: 'roundId' },
          { title: text('操作'), render: (_, item) => <Button disabled={!item.canAct || item.status !== 'PENDING' || locked || checking || !!selected} onClick={event => { trigger.current = event.currentTarget; setSelected(item); setComment(''); setDecision('APPROVE'); void checkHistory(item); }}>{text('审核关闭职责')}</Button> },
        ]} />}
        {tasks.data && <><Typography.Paragraph>{locale === 'en-US' ? `Duty tasks: ${tasks.data.total} (not problem count)` : `职责待办总数：${tasks.data.total}（非问题数）`}</Typography.Paragraph>{pagination(taskOffset, tasks.data.total, value => requestLeave(() => setTaskOffset(value)))}</>}
      </section>
      <section aria-label={text('关闭职责通知')} style={{ minWidth: 0 }}>
        <Space wrap><Typography.Title level={4}>{text('关闭职责通知')}</Typography.Title><Button onClick={notices.refresh} disabled={notices.loading}>{text('刷新职责通知')}</Button></Space>
        {notices.error && <Alert type="error" showIcon title={text('加载失败，请重试')} />}
        {!notices.error && <Table<Notices['items'][number]> rowKey="id" size="small" loading={notices.loading} dataSource={notices.data?.items ?? []} pagination={false} scroll={{ x: 650 }} locale={{ emptyText: text('暂无关闭职责通知') }} columns={[
          { title: text('问题编号'), render: (_, item) => <Link to={workspace(item.problemId)}>{item.reportNumber}</Link> },
          { title: text('通知'), render: (_, item) => <Space orientation="vertical" size={0}><Typography.Text strong>{item.subject}</Typography.Text><Typography.Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.body}</Typography.Text></Space> },
          { title: text('职责'), render: (_, item) => item.duties.map(name => text(dutyNames[name])).join(' / ') },
        ]} />}
        {notices.data && pagination(noticeOffset, notices.data.total, setNoticeOffset)}
      </section>
    </>}
    {!selected && deniedOutcome}
    {selected && <Modal open title={text('关闭职责审核')} onCancel={closeReview} closable={!closeLocked} mask={{ closable: !closeLocked }} keyboard={!closeLocked} focusable={{ focusTriggerAfterClose: false }} width={720} footer={<Space wrap>
      <Button onClick={closeReview} disabled={closeLocked}>{text('关闭审核')}</Button>
      {!attempt && <Button onClick={() => selected && void checkHistory(selected, true)} disabled={locked || checking}>{text('刷新审核基线')}</Button>}
      {attempt ? <Button type="primary" loading={busy} disabled={!!denied} onClick={() => void submit(attempt)}>{text('重试原请求')}</Button> : <Button type="primary" loading={busy} disabled={locked || checking || !baseline || !comment.trim() || comment.length > 2000 || (baseline.duties.length === 2 && !jointConfirmed)} onClick={() => void submit()}>{text('提交审核')}</Button>}
    </Space>}>
      <Space orientation="vertical" size={6} style={{ width: '100%', minWidth: 0 }}>
        {reviewError && <Alert showIcon type="error" title={text(reviewError)} description={denied?.traceId ? <code>{denied.traceId}</code> : undefined} />}
        {deniedOutcome}
        {checking && <Spin aria-label={text('正在核对审核基线')} />}
        {!denied && <>
          <Alert type="info" showIcon title={text('提交审核前，请打开问题工作空间核对完整内容。')} />
          {selected && <Link to={workspace(selected.problemId, baseline?.round.instanceId)} target="_blank" rel="noopener noreferrer">{text('核对问题工作空间')}</Link>}
          {baseline && <><Typography.Text strong>{roundLabel(baseline.round.roundNumber)}</Typography.Text><Typography.Text>{`${text('固定内容版本')}：${baseline.round.contentVersion}`}</Typography.Text><Typography.Text>{baseline.duties.map(name => text(dutyNames[name])).join(' / ')}</Typography.Text></>}
          {baseline?.duties.length === 2 && <Alert type="warning" showIcon title={text('本次一次确认科室经理与部长两份职责，不包含专业审核。')} description={<Checkbox checked={jointConfirmed} disabled={locked} onChange={event => setJointConfirmed(event.target.checked)}>{text('我确认同时审核科室经理与部长两份职责')}</Checkbox>} />}
          <Collapse items={[{ key: 'history', label: text('轮次与职责历史'), children: <Table rowKey="id" size="small" dataSource={history} pagination={false} scroll={{ x: 500 }} locale={{ emptyText: text('暂无轮次历史') }} columns={[
            { title: text('轮次标识'), render: (_, item) => `${roundLabel(item.roundNumber)} · v${item.version}` },
            { title: text('固定内容版本'), dataIndex: 'contentVersion' },
            { title: text('审核状态'), render: (_, item) => text(statusNames[item.status]) },
            { title: text('职责'), render: (_, item) => item.duties.map(record => <div key={record.id}>{text(dutyNames[record.duty])} · {text(statusNames[record.status])} · {text('职责人员标识')}：{record.userId}{record.comment && <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{record.comment}</Typography.Paragraph>}</div>) },
          ]} /> }]} />
        </>}
        <label htmlFor="closure-review-decision">{text('审核决定')}</label>
        <Radio.Group id="closure-review-decision" aria-label={text('审核决定')} value={decision} disabled={locked} onChange={event => setDecision(event.target.value)} options={[{ label: text('同意'), value: 'APPROVE' }, { label: text('退回修改'), value: 'RETURN' }]} />
        <label htmlFor="closure-review-comment">{text('审核意见')}</label>
        <Input.TextArea id="closure-review-comment" value={comment} disabled={locked} maxLength={2000} showCount rows={4} onChange={event => setComment(event.target.value)} autoFocus />
      </Space>
    </Modal>}
  </div>;
}
