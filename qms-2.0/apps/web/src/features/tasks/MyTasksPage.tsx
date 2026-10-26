import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Empty, List, Pagination, Space, Spin, Tabs, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { ApiError, apiRequest, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { mutateInbox, type NotificationPage, type TaskPage } from './task-inbox';
import { useNavigationGuard } from '../../layouts/UnsavedChanges';
import { ClosureTaskInbox } from './ClosureTaskInbox';
import { ProcessEightDTaskInbox } from './ProcessEightDTaskInbox';

import './tasks.css';

const pageSize = 25;

function useInboxPage<Page>(path: string) {
  const [data, setData] = useState<Page>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setData(undefined);
    setError(undefined);
    apiRequest<Page>(path, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setData(result);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, revision]);
  return { data, error, loading, refresh: () => setRevision((value) => value + 1) };
}

function InboxError({ cause }: { cause: unknown }) {
  const { t } = useLanguage();
  if (!cause) return null;
  const message = cause instanceof ApiError && cause.code.startsWith('TASK_')
    ? '任务状态或领取资格已变化，请刷新后重试' : safeAccountError(cause);
  return <Alert type="error" showIcon title={t(message)} description={cause instanceof ApiError && cause.traceId ? <span>{t('追踪标识')}：<code>{cause.traceId}</code></span> : undefined} />;
}

function pageQuery(offset: number, status: string, claim?: string) {
  const query = new URLSearchParams({ pageSize: String(pageSize), offset: String(offset) });
  if (status) query.set('status', status);
  if (claim) query.set('claim', claim);
  return query.toString();
}

export function MyTasksPage() {
  const { t, locale } = useLanguage();
  const [activeTab, setActiveTab] = useState('tasks');
  const requestLeave = useNavigationGuard();
  const [taskOffset, setTaskOffset] = useState(0);
  const [noticeOffset, setNoticeOffset] = useState(0);
  const [taskStatus, setTaskStatus] = useState('');
  const [claim, setClaim] = useState('');
  const [noticeStatus, setNoticeStatus] = useState('');
  const tasks = useInboxPage<TaskPage>(`/api/v1/tasks?${pageQuery(taskOffset, taskStatus, claim)}`);
  const notifications = useInboxPage<NotificationPage>(`/api/v1/notifications?${pageQuery(noticeOffset, noticeStatus)}`);
  const [mutationError, setMutationError] = useState<unknown>();
  const [pendingId, setPendingId] = useState<string>();
  const writing = useRef(false);
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  async function mutate(path: string, id: string, version: number, refresh: () => void) {
    if (writing.current) return;
    writing.current = true;
    setPendingId(id);
    setMutationError(undefined);
    try { await mutateInbox(path, version); }
    catch (cause) { setMutationError(cause); }
    finally { writing.current = false; setPendingId(undefined); refresh(); }
  }
  const pagination = (offset: number, total: number, change: (value: number) => void) => <Pagination current={offset / pageSize + 1} pageSize={pageSize} total={Math.min(total, 10000 + pageSize)} showSizeChanger={false} onChange={(page) => change((page - 1) * pageSize)} showTotal={() => `${t('总数')}：${total}`} />;
  return <main className="task-inbox">
    <Typography.Title level={2}>{t('我的待办')}</Typography.Title>
    <InboxError cause={mutationError} />
    <Tabs activeKey={activeTab} onChange={key => { if (!writing.current) requestLeave(() => setActiveTab(key)); }} items={[
      { key: 'process-eight-d', label: t('过程8D'), children: activeTab === 'process-eight-d' ? <ProcessEightDTaskInbox /> : null },
      { key: 'closure', label: t('关闭审核'), children: activeTab === 'closure' ? <ClosureTaskInbox /> : null },
      { key: 'tasks', label: t('我的待办'), children: <Space orientation="vertical" size={6} style={{ width: '100%' }}>
        <Space wrap className="task-inbox__filters">
          <label>{t('任务状态')} <select aria-label={t('任务状态')} value={taskStatus} onChange={(event) => { setTaskStatus(event.target.value); setTaskOffset(0); }}>
            <option value="">{t('全部状态')}</option><option value="PENDING">{t('待处理')}</option><option value="IN_PROGRESS">{t('处理中')}</option><option value="OVERDUE">{t('已逾期')}</option><option value="FAILED">{t('失败')}</option>
          </select></label>
          <label>{t('领取状态')} <select aria-label={t('领取状态')} value={claim} onChange={(event) => { setClaim(event.target.value); setTaskOffset(0); }}>
            <option value="">{t('全部领取状态')}</option><option value="UNCLAIMED">{t('未领取')}</option><option value="MINE">{t('我已领取')}</option><option value="OTHERS">{t('他人已领取')}</option>
          </select></label>
          <Button onClick={tasks.refresh} disabled={tasks.loading}>{t('刷新')}</Button>
        </Space>
        <InboxError cause={tasks.error} />
        {tasks.loading ? <Spin aria-label={t('正在加载待办')} /> : tasks.data && <>
          <List dataSource={tasks.data.items} locale={{ emptyText: <Empty description={t('暂无待办')} /> }} renderItem={(task) => <List.Item key={task.id} actions={[
            ...(task.canClaim ? [<Button key="claim" aria-label={t(task.claimedByUserId ? '重新领取' : '领取')} loading={pendingId === task.id} disabled={!!pendingId} onClick={() => void mutate(`/api/v1/tasks/${task.id}/claim`, task.id, task.version, tasks.refresh)}>{t(task.claimedByUserId ? '重新领取' : '领取')}</Button>] : []),
            ...(task.canRelease ? [<Button key="release" aria-label={t('释放')} loading={pendingId === task.id} disabled={!!pendingId} onClick={() => void mutate(`/api/v1/tasks/${task.id}/release`, task.id, task.version, tasks.refresh)}>{t('释放')}</Button>] : []),
            ...(task.canRetry ? [<Button key="retry" aria-label={t('失败重试')} loading={pendingId === task.id} disabled={!!pendingId} onClick={() => void mutate(`/api/v1/tasks/${task.id}/retry`, task.id, task.version, tasks.refresh)}>{t('失败重试')}</Button>] : []),
          ]}>
            <List.Item.Meta title={<Link to={`/app/problem-workspace/${task.problemId}?instanceId=${encodeURIComponent(task.instanceId)}`}>{task.reportNumber}</Link>} description={<Space orientation="vertical">
              <span>{task.name}</span>
              <Space wrap className="task-inbox__filters"><Tag color={task.status === 'OVERDUE' ? 'red' : task.status === 'FAILED' ? 'volcano' : 'blue'}>{t(task.status === 'OVERDUE' ? '已逾期' : task.status === 'FAILED' ? '失败' : task.status === 'IN_PROGRESS' ? '处理中' : '待处理')}</Tag>
                <span>{t(task.claimedByUserId ? task.canAct ? '我已领取' : task.canClaim ? '可重新领取' : '已由其他人领取' : '未领取')}</span>
              </Space>
              {task.dueAt && <span>{t('截止时间')}：{date(task.dueAt)}</span>}
            </Space>} />
          </List.Item>} />
          {pagination(taskOffset, tasks.data.total, setTaskOffset)}
        </>}
      </Space> },
      { key: 'notifications', label: t('我的通知'), children: <Space orientation="vertical" size={6} style={{ width: '100%' }}>
        <Space wrap className="task-inbox__filters"><label>{t('阅读状态')} <select aria-label={t('阅读状态')} value={noticeStatus} onChange={(event) => { setNoticeStatus(event.target.value); setNoticeOffset(0); }}>
          <option value="">{t('全部通知')}</option><option value="UNREAD">{t('仅未读')}</option><option value="READ">{t('仅已读')}</option>
        </select></label><Button onClick={notifications.refresh} disabled={notifications.loading}>{t('刷新')}</Button></Space>
        <InboxError cause={notifications.error} />
        {notifications.loading ? <Spin aria-label={t('正在加载通知')} /> : notifications.data && <>
          <List dataSource={notifications.data.items} locale={{ emptyText: <Empty description={t('暂无通知')} /> }} renderItem={(notice) => <List.Item key={notice.id}>
            <Card className="qms-display-card" style={{ width: '100%' }} title={notice.subject ?? t(notice.kind === 'TASK_ESCALATED' ? '超时升级' : notice.kind === 'TASK_REMINDER' ? '时限提醒' : '任务分配')} extra={<Tag>{t(notice.readAt ? '已读' : '未读')}</Tag>}>
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{notice.body}</Typography.Paragraph>
              <Space wrap className="task-inbox__filters"><span>{notice.nodeName}</span><time dateTime={notice.createdAt}>{date(notice.createdAt)}</time>
                <Link to={`/app/problem-workspace/${notice.problemId}?${new URLSearchParams({ organizationId: notice.organizationId, instanceId: notice.instanceId })}`}>{t('查看关联实例')}</Link>
                {!notice.readAt && <Button loading={pendingId === notice.id} disabled={!!pendingId} onClick={() => void mutate(`/api/v1/notifications/${notice.id}/read`, notice.id, notice.version, notifications.refresh)}>{t('标为已读')}</Button>}
              </Space>
            </Card>
          </List.Item>} />
          {pagination(noticeOffset, notifications.data.total, setNoticeOffset)}
        </>}
      </Space> },
    ]} />
  </main>;
}
