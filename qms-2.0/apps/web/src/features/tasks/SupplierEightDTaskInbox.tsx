import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Select, Space, Spin, Tag, Typography } from 'antd';
import { Link, useLocation } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { SupplierSourceCollaborationInbox, useSupplierSourceCollaboration } from './SupplierSourceCollaborationInbox';
import { LedgerTable, useLedgerPageSize } from '../../ui/ledger';

type Task = components['schemas']['SupplierEightDTaskDto'];
type Notice = components['schemas']['SupplierEightDNotificationDto'];
type Page<T> = Pick<components['schemas']['SupplierEightDTaskPageDto'], 'examined' | 'nextCursor'> & { items: T[] };
const duties = { PROFESSIONAL: '专业审核', SECTION_MANAGER: '科室经理', MINISTER: '部长', SQE: 'SQE', MANAGER: '经理' };
const kinds = { HANDLING: '整改处理', CLOSURE: '关闭审核', EXTENSION: '专用延期审核' };
const stages = { ANALYSIS: '分析计划', SUBMISSION: '完整提交计划', CLOSURE: '关闭计划' };
const statuses = { HANDLING: '处理中', PENDING: '待审核', QUALITY_PENDING: 'SQE待审', MANAGER_PENDING: '经理待审' };
const actions = { OPEN_REPORT: '打开8D报告', ANALYSIS_COMPLETE: '确认分析完成', SUBMIT: '完整提交8D', DECIDE_CLOSURE: '审核关闭', DECIDE_EXTENSION: '审核延期' };
const noticeKinds = { HANDLING_REMINDER: '处理提醒', CLOSURE_REMINDER: '关闭提醒', EXTENSION_PENDING: '延期待审' };

export function SupplierEightDTaskInbox({ portal = false }: { portal?: boolean }) {
  const session = useWorkTabsStore(state => state.sessionScope);
  const { pathname, search } = useLocation();
  const organizationId = portal ? null : new URLSearchParams(search).get('organizationId');
  return <AccessScope key={JSON.stringify([session, portal, pathname, search])} session={session} portal={portal} organizationId={organizationId} />;
}

function AccessScope(props: { session?: string; portal: boolean; organizationId: string | null }) {
  const { t } = useLanguage();
  const [denied, setDenied] = useState(false);
  const revoke = useCallback(() => setDenied(true), []);
  if (denied || !props.session?.startsWith(props.portal ? 'SUPPLIER:' : 'INTERNAL:')) return <Alert type="error" showIcon
    title={t('当前会话失效或无权访问，敏感内容已清除。')}
    action={denied && <Button onClick={() => setDenied(false)}>{t('重新核对访问权限')}</Button>} />;
  return <Inbox {...props} onDenied={revoke} />;
}

function useProjection<T extends { id: string }>(path: string, lifetime: React.RefObject<AbortController>, current: () => boolean, onDenied: () => void, ledgerId: string, organizationId?: string) {
  const [pageSize, setPageSize] = useLedgerPageSize(ledgerId, organizationId);
  const [data, setData] = useState<Page<T>>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState<{ cursor?: string }>({});
  useEffect(() => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const signal = lifetime.current.signal;
    signal.addEventListener('abort', abort);
    const active = () => current() && !controller.signal.aborted;
    setError(undefined); setLoading(true);
    if (!request.cursor) setData(undefined);
    const query = new URLSearchParams({ pageSize: String(pageSize) });
    if (request.cursor) query.set('cursor', request.cursor);
    if (active()) void apiRequest<Page<T>>(`${path}${path.includes('?') ? '&' : '?'}${query}`, { signal: controller.signal }, { replayAfterReauthentication: false })
      .then(page => {
        if (!active()) return;
        setData(previous => request.cursor && previous ? {
          items: [...new Map([...previous.items, ...page.items].map(item => [item.id, item])).values()],
          examined: previous.examined + page.examined, nextCursor: page.nextCursor,
        } : page);
      }).catch(cause => {
        if (!active()) return;
        if (cause instanceof ApiError && [401, 403].includes(cause.status ?? 0)) { onDenied(); return; }
        setError(cause);
      }).finally(() => { if (active()) setLoading(false); });
    return () => { controller.abort(); signal.removeEventListener('abort', abort); };
  }, [path, request, lifetime, current, onDenied, pageSize]);
  return { data, error, loading, pageSize, changeSize: (size: number) => { setPageSize(size); setRequest({}); }, refresh: () => setRequest({}), retry: () => setRequest({ ...request }), more: () => { if (data?.nextCursor && !loading) setRequest({ cursor: data.nextCursor }); } };
}

function Inbox({ session, portal, organizationId, onDenied }: { session?: string; portal: boolean; organizationId: string | null; onDenied: () => void }) {
  const { t, locale } = useLanguage();
  const lifetime = useRef(new AbortController());
  const revoked = useRef(false);
  const current = useCallback(() => !revoked.current && !lifetime.current.signal.aborted && session === useWorkTabsStore.getState().sessionScope, [session]);
  useEffect(() => {
    lifetime.current = new AbortController();
    const unsubscribe = useWorkTabsStore.subscribe(state => { if (state.sessionScope !== session) lifetime.current.abort(); });
    return () => { lifetime.current.abort(); unsubscribe(); };
  }, [session]);
  const revoke = useCallback(() => {
    revoked.current = true; lifetime.current.abort(); onDenied();
  }, [onDenied]);
  const base = `/api/v1/${portal ? 'supplier-portal' : 'supplier-quality'}/eight-d`;
  const scope = organizationId ? `?${new URLSearchParams({ organizationId })}` : '';
  const tasks = useProjection<Task>(`${base}/tasks${scope}`, lifetime, current, revoke, 'supplier-eight-d-tasks', organizationId ?? undefined);
  const notices = useProjection<Notice>(`${base}/notifications${scope}`, lifetime, current, revoke, 'supplier-eight-d-notifications', organizationId ?? undefined);
  const collaboration = useSupplierSourceCollaboration(organizationId, lifetime, current, revoke, !portal);
  const workspace = (id: string) => `${portal ? '/supplier/corrections/problems' : '/app/supplier-quality/eight-d'}/${encodeURIComponent(id)}`;
  const date = (value: string | null) => value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : t('未设置期限');
  const error = (cause: unknown, label: string, retry: () => void) => <Alert type="error" showIcon title={t(`${label}加载失败，请重试`)}
    description={<>{t(safeAccountError(cause))}{cause instanceof ApiError && cause.traceId && <code> {cause.traceId}</code>}</>}
    action={<Button onClick={retry}>{t(`重试${label}`)}</Button>} />;
  return <div style={{ minWidth: 0, maxWidth: '100%' }}>
    {!portal && <SupplierSourceCollaborationInbox {...collaboration} />}
    <section aria-label={t('供应商8D正式待办')}>
      <Space wrap><Typography.Title level={3}>{t('供应商8D正式待办')}</Typography.Title><Button disabled={tasks.loading} onClick={tasks.refresh}>{t('刷新8D待办')}</Button><Select aria-label={locale === 'en-US' ? 'Task load batch size' : '待办加载批次条数'} value={tasks.pageSize} onChange={tasks.changeSize} options={[10, 20, 50, 100].map(value => ({ value, label: String(value) }))} /></Space>
      {portal && <p>{t('同一问题的多份职责分别列出，不代表多个问题；处理、关闭审核和专用延期均在完整工作空间执行。')}</p>}
      {tasks.error ? error(tasks.error, '8D待办', tasks.retry) : null}
      {tasks.loading && <Spin aria-label={t('正在加载8D待办')} />}
      {tasks.data && <>
        <div role="group" aria-label={t('供应商8D待办表格')} tabIndex={0} style={{ overflowX: 'auto', maxWidth: '100%' }}>
        <LedgerTable<Task> ledgerId="supplier-eight-d-tasks" organizationId={organizationId ?? undefined} requiredColumnKeys={['reportNumber', 'actions']} size="small" style={{ minWidth: 900 }} rowKey="id" pagination={false} dataSource={tasks.data.items}
          locale={{ emptyText: t('暂无供应商8D待办') }} columns={[
            { key: 'reportNumber', title: t('问题编号'), dataIndex: 'reportNumber' },
            { key: 'kind', title: t('任务类型'), render: (_, task) => t(kinds[task.kind] ?? task.kind) },
            { key: 'duty', title: t('职责'), render: (_, task) => task.duty ? t(duties[task.duty] ?? task.duty) : t('供应商处理') },
            { key: 'stage', title: t('阶段'), render: (_, task) => t(stages[task.stage] ?? task.stage) },
            { key: 'status', title: t('状态'), render: (_, task) => t(statuses[task.status] ?? task.status) },
            { key: 'dueAt', title: t('原期限'), render: (_, task) => <>{date(task.dueAt)}{task.overdue && <Tag color="error">{t('已逾期')}</Tag>}{task.requestedDueAt && <div>{t('申请期限')}：{date(task.requestedDueAt)}</div>}</> },
            { key: 'actions', title: t('操作'), render: (_, task) => <Space wrap>{task.actions.map(action => <Link key={action} to={workspace(task.supplierProblemId)}>{t(actions[action] ?? action)}</Link>)}</Space> },
          ]} />
        </div>
        <p>{t('当前已加载任务')}：{tasks.data.items.length}</p><p>{t('已扫描问题')}：{tasks.data.examined}</p>
        {tasks.data.nextCursor && <Button disabled={tasks.loading} onClick={tasks.more}>{t('加载更多8D待办')}</Button>}
      </>}
    </section>
    <section aria-label={t('供应商8D通知')}>
      <Space wrap><Typography.Title level={3}>{t('供应商8D通知')}</Typography.Title><Button disabled={notices.loading} onClick={notices.refresh}>{t('刷新8D通知')}</Button><Select aria-label={locale === 'en-US' ? 'Notification load batch size' : '通知加载批次条数'} value={notices.pageSize} onChange={notices.changeSize} options={[10, 20, 50, 100].map(value => ({ value, label: String(value) }))} /></Space>
      {notices.error ? error(notices.error, '8D通知', notices.retry) : null}
      {notices.loading && <Spin aria-label={t('正在加载8D通知')} />}
      {notices.data && <>
        {notices.data.items.filter(notice => notice.channel === 'IN_APP' && notice.status === 'DELIVERED').map(notice => <Card key={notice.id} className="qms-display-card" title={notice.subject}>
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{notice.body}</Typography.Paragraph>
          <Space wrap><Tag>{t('已送达')}</Tag><span>{t(noticeKinds[notice.kind] ?? notice.kind)}</span><time dateTime={notice.deliveredAt}>{date(notice.deliveredAt)}</time><Link to={workspace(notice.supplierProblemId)}>{t('查看关联8D')}</Link></Space>
        </Card>)}
        {!notices.data.items.some(notice => notice.channel === 'IN_APP' && notice.status === 'DELIVERED') && <p>{t('暂无供应商8D通知')}</p>}
        <p>{t('通知已扫描问题')}：{notices.data.examined}</p>
        {notices.data.nextCursor && <Button disabled={notices.loading} onClick={notices.more}>{t('加载更多8D通知')}</Button>}
      </>}
    </section>
  </div>;
}
