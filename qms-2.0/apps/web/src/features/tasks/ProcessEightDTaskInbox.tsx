import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Modal, Pagination, Space, Spin, Table, Typography } from 'antd';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useCompletedSessionNavigation, useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

type Task = components['schemas']['ProcessEightDTaskDto'];
type Tasks = components['schemas']['ProcessEightDTaskPageDto'];
type Notices = components['schemas']['ProcessEightDNotificationPageDto'];
type Extension = components['schemas']['WorkflowDeadlineExtensionDto'];
type Decision = components['schemas']['DecideWorkflowDeadlineExtensionDto'];
type Attempt = { path: string; body: Decision; key: string };
type Domain = 'process-quality' | 'customer-quality' | 'new-product-quality';
const extensionBase = '/api/v1/workflow-deadline-extensions';
const stages = { ANALYSIS: '分析计划', SUBMISSION: '完整提交计划', CLOSURE: '关闭计划' };
const statuses = new Map([['HANDLING', '负责人处理'], ['LEADER_PENDING', '上级待审'], ['QUALITY_PENDING', '专业待审'], ['AVAILABLE', '可申请延期']]);

export function ProcessEightDTaskInbox({ domain = 'process-quality' }: { domain?: Domain } = {}) {
  const session = useWorkTabsStore(state => state.sessionScope);
  const location = useLocation();
  return <InboxScope key={JSON.stringify([domain, session, location.search])} session={session} domain={domain} />;
}

function InboxScope({ session, domain }: { session?: string; domain: Domain }) {
  const base = `/api/v1/${domain}/eight-d`;
  const domainLabel = domain === 'customer-quality' ? '客户8D' : domain === 'new-product-quality' ? '新品8D' : '过程8D';
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const completeSessionNavigation = useCompletedSessionNavigation();
  const leave = useNavigationGuard();
  const [tasks, setTasks] = useState<Tasks>();
  const [notices, setNotices] = useState<Notices>();
  const [taskOffset, setTaskOffset] = useState(0);
  const [noticeOffset, setNoticeOffset] = useState(0);
  const [taskRevision, setTaskRevision] = useState(0);
  const [noticeRevision, setNoticeRevision] = useState(0);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [noticesLoading, setNoticesLoading] = useState(true);
  const [taskError, setTaskError] = useState<unknown>();
  const [noticeError, setNoticeError] = useState<unknown>();
  const [error, setError] = useState<unknown>();
  const [denied, setDenied] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [selected, setSelected] = useState<Task>();
  const [baseline, setBaseline] = useState<Extension>();
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [decision, setDecision] = useState<Decision['decision']>('APPROVE');
  const [reviewMessage, setReviewMessage] = useState('');
  const [attempt, setAttempt] = useState<Attempt>();
  const lifetime = useRef<AbortController | undefined>(undefined);
  const reviewController = useRef<AbortController | undefined>(undefined);
  const revoked = useRef(false);
  const writing = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const current = () => !revoked.current && !!lifetime.current && !lifetime.current.signal.aborted && session === useWorkTabsStore.getState().sessionScope;
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    const unsubscribe = useWorkTabsStore.subscribe(state => { if (state.sessionScope !== session) { controller.abort(); reviewController.current?.abort(); } });
    return () => { controller.abort(); reviewController.current?.abort(); unsubscribe(); };
  }, [session]);
  function report(cause: unknown) {
    setError(cause);
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403 || ['AUTH_SESSION_REQUIRED', 'FEATURE_PERMISSION_DENIED', 'ORGANIZATION_SCOPE_DENIED'].includes(cause.code))) {
      revoked.current = true; lifetime.current?.abort(); reviewController.current?.abort();
      setDenied(true); setTasks(undefined); setNotices(undefined); setSelected(undefined); setBaseline(undefined); setComment(''); setAttempt(undefined); setBusy(false); setChecking(false);
      if (cause.status === 401 || cause.code === 'AUTH_SESSION_REQUIRED') setUnauthorized(true);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    const active = () => current() && !controller.signal.aborted;
    setTasks(undefined); setTasksLoading(true); setTaskError(undefined);
    apiRequest<Tasks>(`${base}/tasks?pageSize=25&offset=${taskOffset}`, { signal: controller.signal }).then(value => { if (active()) setTasks(value); })
      .catch(cause => { if (active()) { setTaskError(cause); report(cause); } }).finally(() => { if (active()) setTasksLoading(false); });
    return () => controller.abort();
  }, [taskOffset, taskRevision, session]);
  useEffect(() => {
    const controller = new AbortController();
    const active = () => current() && !controller.signal.aborted;
    setNotices(undefined); setNoticesLoading(true); setNoticeError(undefined);
    apiRequest<Notices>(`${base}/notifications?pageSize=25&offset=${noticeOffset}`, { signal: controller.signal }).then(value => { if (active()) setNotices(value); })
      .catch(cause => { if (active()) { setNoticeError(cause); report(cause); } }).finally(() => { if (active()) setNoticesLoading(false); });
    return () => controller.abort();
  }, [noticeOffset, noticeRevision, session]);
  useUnsavedChanges(!!selected && (!!comment || decision !== 'APPROVE' || !!attempt));
  useNavigationBusy(busy || !!attempt);
  useEffect(() => {
    if (!unauthorized || session !== useWorkTabsStore.getState().sessionScope) return;
    completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
  }, [unauthorized, session, completeSessionNavigation, navigate]);
  const workspace = (id: string, report = false) => `/app/problem-workspace/${encodeURIComponent(id)}${report ? '?view=report' : ''}`;
  const date = (value: string | null) => value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : t('未设置期限');
  const status = (value: string) => value === 'AVAILABLE' && locale === 'en-US' ? 'Extension available' : t(statuses.get(value) ?? value);
  async function check(task: Task) {
    if (!current() || writing.current || attempt) return;
    reviewController.current?.abort();
    const controller = new AbortController(); reviewController.current = controller;
    const active = () => current() && !controller.signal.aborted;
    setChecking(true); setBaseline(undefined); setReviewMessage(''); setError(undefined);
    try {
      const [fresh, history] = await Promise.all([
        apiRequest<Tasks>(`${base}/tasks?pageSize=25&offset=${taskOffset}`, { signal: controller.signal }),
        apiRequest<Extension[]>(`${extensionBase}/problems/${encodeURIComponent(task.problemId)}/requests`, { signal: controller.signal }),
      ]);
      if (!active()) return;
      setTasks(fresh);
      const updated = fresh.items.find(item => item.id === task.id && item.problemId === task.problemId && item.userId === task.userId && item.kind === 'EXTENSION' && item.actions.includes('DECIDE_EXTENSION'));
      const request = history.find(item => item.id === updated?.extensionRequestId);
      if (!updated || !request || request.problemId !== updated.problemId || request.workflowVersionId !== updated.workflowVersionId || request.version !== updated.extensionRequestVersion || request.stage !== updated.stage || request.status !== updated.status
        || (request.status === 'LEADER_PENDING' ? request.leaderUserId : request.professionalUserId) !== updated.userId) throw new Error('Stale extension');
      setSelected(updated); setBaseline(request);
    } catch (cause) { if (active()) { report(cause); setReviewMessage('延期基线已变化，请重新核对；意见已保留。'); } }
    finally { if (active()) setChecking(false); }
  }
  function close() {
    if (writing.current || attempt) return;
    leave(() => { reviewController.current?.abort(); setSelected(undefined); setBaseline(undefined); setComment(''); setDecision('APPROVE'); setReviewMessage(''); trigger.current?.focus(); }, true);
  }
  async function submit(retry?: Attempt) {
    if (!current() || writing.current || (!retry && (!baseline || !selected || checking || attempt))) return;
    const next = retry ?? { path: `${extensionBase}/requests/${encodeURIComponent(baseline!.id)}/decide`, body: { expectedVersion: baseline!.version, decision, comment: comment.trim() }, key: crypto.randomUUID() };
    writing.current = true; setBusy(true); setReviewMessage(''); setError(undefined);
    try {
      const signal = lifetime.current!.signal;
      const token = await csrfToken(signal);
      if (!current()) return;
      await apiRequest<Extension>(next.path, { method: 'POST', signal, headers: { 'x-csrf-token': token, 'Idempotency-Key': next.key }, body: JSON.stringify(next.body) }, { replayAfterReauthentication: false });
      if (current()) { setAttempt(undefined); setSelected(undefined); setBaseline(undefined); setComment(''); setDecision('APPROVE'); setTaskRevision(value => value + 1); setNoticeRevision(value => value + 1); trigger.current?.focus(); }
    } catch (cause) {
      if (!current()) return;
      report(cause);
      if (!current()) return;
      if (cause instanceof ApiError && (cause.status === 409 || cause.code === 'CONCURRENCY_CONFLICT')) {
        setAttempt(undefined); setBaseline(undefined); setReviewMessage('延期基线已变化，请重新核对；意见已保留。');
      } else if (retry || !(cause instanceof ApiError) || cause.code === 'CLIENT_REAUTHENTICATION_COMPLETED' || !cause.status || cause.status === 408 || cause.status === 425 || cause.status >= 500) {
        setAttempt(next); setReviewMessage('延期审核结果未确认，输入已冻结，只能重试原请求。');
      } else { setAttempt(undefined); setReviewMessage('延期审核被拒，意见已保留。'); }
    } finally { writing.current = false; if (current()) setBusy(false); }
  }
  const pager = (offset: number, total: number, change: (value: number) => void) => <Pagination current={offset / 25 + 1} pageSize={25} total={Math.min(total, 10025)} showSizeChanger={false} onChange={page => leave(() => change((page - 1) * 25))} />;
  return <div className="closure-task-inbox">
    {!!error && <Alert type="error" showIcon title={t(safeAccountError(error))} description={error instanceof ApiError && error.traceId ? <code>{error.traceId}</code> : undefined} />}
    {!denied && <>
      <section aria-label={t(`${domainLabel}正式待办`)}><Space wrap><Typography.Title level={3}>{t(`${domainLabel}正式待办`)}</Typography.Title><Button disabled={tasksLoading || !!selected} onClick={() => setTaskRevision(value => value + 1)}>{t('刷新8D待办')}</Button></Space>
        <p>{t('不支持旧任务领取、转派或任意完成。关闭审核请使用关闭审核入口。')}</p>
        {taskError ? <Alert type="error" title={t('8D待办加载失败，请重试')} /> : <Table<Task> rowKey="id" size="small" loading={tasksLoading} pagination={false} scroll={{ x: 760 }} dataSource={tasks?.items ?? []} locale={{ emptyText: t(`暂无${domainLabel}待办`) }} columns={[
          { title: t('问题编号'), dataIndex: 'reportNumber' },
          { title: t('职责'), render: (_, task) => `${status(task.status)} · ${t(stages[task.stage])}` },
          { title: t('原期限'), render: (_, task) => <span>{date(task.dueAt)}{task.overdue ? ` · ${t('已逾期')}` : ''}</span> },
          { title: t('操作'), render: (_, task) => <Space wrap>
            {task.actions.includes('OPEN_REPORT') && <Link to={workspace(task.problemId, true)}>{t('打开8D报告')}</Link>}
            {task.kind === 'HANDLING' && <>
              {task.actions.includes('ANALYSIS_COMPLETE') && <Link to={workspace(task.problemId)}>{t('确认分析完成')}</Link>}
              {task.actions.includes('SUBMIT') && <Link to={workspace(task.problemId)}>{t('完整提交8D')}</Link>}
            </>}
            {task.actions.includes('REQUEST_EXTENSION') && <Link to={workspace(task.problemId)}>{t('申请延期')}</Link>}
            {task.kind === 'EXTENSION' && task.actions.includes('DECIDE_EXTENSION') && task.extensionRequestId && <Button disabled={!!selected || busy} onClick={event => { trigger.current = event.currentTarget; setSelected(task); setComment(''); setDecision('APPROVE'); void check(task); }}>{t('审核延期')}</Button>}
          </Space> },
        ]} />}
        {tasks && pager(taskOffset, tasks.total, setTaskOffset)}
      </section>
      <section aria-label={t(`${domainLabel}通知`)}><Space wrap><Typography.Title level={3}>{t(`${domainLabel}通知`)}</Typography.Title><Button disabled={noticesLoading} onClick={() => setNoticeRevision(value => value + 1)}>{t('刷新8D通知')}</Button></Space>
        {noticeError ? <Alert type="error" title={t('8D通知加载失败，请重试')} /> : noticesLoading ? <Spin aria-label={t('正在加载8D通知')} /> : notices?.items.map(notice => <Card key={notice.id} title={notice.subject}>
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{notice.body}</Typography.Paragraph><Space wrap><time>{date(notice.deliveredAt)}</time><Link to={workspace(notice.problemId)}>{t('查看关联8D')}</Link></Space>
        </Card>)}
        {notices && !notices.items.length && <p>{t(`暂无${domainLabel}通知`)}</p>}
        {notices && pager(noticeOffset, notices.total, setNoticeOffset)}
      </section>
    </>}
    {selected && !denied && <Modal open title={t('延期审核')} onCancel={close} closable={!busy && !attempt} mask={{ closable: !busy && !attempt }} keyboard={!busy && !attempt} focusable={{ focusTriggerAfterClose: false }} footer={<Space wrap>
      <Button disabled={busy || !!attempt} onClick={close}>{t('关闭延期审核')}</Button>
      {!attempt && <Button disabled={busy || checking} onClick={() => void check(selected)}>{t('重新核对延期')}</Button>}
      {attempt ? <Button loading={busy} onClick={() => void submit(attempt)}>{t('重试原延期请求')}</Button> : <Button type="primary" disabled={!baseline || checking || busy || comment.length > 2000} onClick={() => void submit()}>{t('提交延期审核')}</Button>}
    </Space>}>
      {reviewMessage && <Alert type="warning" title={t(reviewMessage)} />}
      {checking && <Spin aria-label={t('正在核对延期')} />}
      {baseline && <><p>{baseline.reason}</p><p>{t('原期限')}：{date(baseline.originalDueAt)} → {t('申请期限')}：{date(baseline.requestedDueAt)}</p><p>{t('全部审批通过前原期限继续生效。')}</p>{selected.actions.includes('OPEN_REPORT') && <Link to={workspace(selected.problemId, true)} target="_blank" rel="noopener noreferrer">{t('核对8D报告')}</Link>}</>}
      <fieldset disabled={busy || !!attempt || checking}><label>{t('延期审核决定')}<select aria-label={t('延期审核决定')} value={decision} onChange={event => setDecision(event.target.value as Decision['decision'])}><option value="APPROVE">{t('同意')}</option><option value="RETURN">{t('退回修改')}</option></select></label>
        <label>{t('延期审核意见')}<textarea aria-label={t('延期审核意见')} rows={4} maxLength={2000} value={comment} onChange={event => setComment(event.target.value)} autoFocus /></label></fieldset>
    </Modal>}
  </div>;
}
