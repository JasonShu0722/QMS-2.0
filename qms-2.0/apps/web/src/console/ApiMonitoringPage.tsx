import { Alert, Button, Input, Select, Skeleton, Table } from 'antd';
import { Clock3, RefreshCw } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { components, operations } from '@qms/contracts';
import { ApiError, apiRequest } from '../api/client';
import { subscribeSessionSignals } from '../features/auth/session-invalidation';
import { useLanguage } from '../i18n/Language';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { useConsoleContext } from './ConsoleLayout';
import type { ConsoleContext } from './console-navigation';
import './api-monitoring.css';

type Page = components['schemas']['ApiObservationPageDto'];
type Bucket = components['schemas']['ApiObservationBucketDto'];
type Query = NonNullable<operations['ApiObservationController_query']['parameters']['query']>;
type Filters = { scope: Page['scope']; period: '1' | '24' | '168'; method: Query['method']; statusClass?: number; route: string; page: number };
const initialFilters: Filters = { scope: 'ORGANIZATION', period: '24', method: undefined, statusClass: undefined, route: '', page: 1 };
const routePattern = /^(?:UNKNOWN|\/api\/v1(?:\/[A-Za-z0-9_:.*-]+)*)$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function identity(context: ConsoleContext) {
  const structure = (organization: ConsoleContext['targetOrganization']) => [organization.id, organization.type, organization.status, organization.configurationRequired];
  return JSON.stringify([context.actor.id, context.actor.accountType, structure(context.actor.homeOrganization), structure(context.targetOrganization), context.hasPlatformAdministrator,
    context.modules.map(module => [module.key, module.scope, module.coverage, module.organizationId, [...module.permissions].sort()]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
}

export function ApiMonitoringPage() {
  const { context, refresh, invalidate } = useConsoleContext();
  const session = useWorkTabsStore(state => state.sessionScope);
  const key = identity(context);
  return <ObservationScope key={JSON.stringify([session, key])} context={context} session={session} refresh={refresh} invalidate={invalidate} />;
}

function ObservationScope({ context, session, refresh, invalidate }: { context: ConsoleContext; session?: string; refresh: () => void; invalidate: () => void }) {
  const { locale } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const id = useId();
  const canRead = context.actor.accountType === 'INTERNAL' && context.targetOrganization.status === 'ACTIVE' && !context.targetOrganization.configurationRequired
    && context.modules.some(module => module.key === 'api-monitoring' && module.scope === 'TARGET' && module.coverage === 'ORGANIZATION'
      && module.organizationId === context.targetOrganization.id && module.permissions.includes('console:api:read'));
  const matchesSession = session === `INTERNAL:${context.actor.homeOrganization.id}:${context.actor.id}`;
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [draft, setDraft] = useState<Filters>(initialFilters);
  const [validation, setValidation] = useState(false);
  const [data, setData] = useState<Page>();
  const [error, setError] = useState<'denied' | 'network'>();
  const [loading, setLoading] = useState(canRead && matchesSession);
  const [revision, setRevision] = useState(0);
  const range = useMemo(() => {
    const to = Date.now();
    // Retention is checked at server receive time; leave minute headroom at seven days.
    const from = Math.floor((to - Number(filters.period) * 3600000) / 60000) * 60000 + 60000;
    return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
  }, [filters.scope, filters.period, filters.method, filters.statusClass, filters.route, revision]);
  const active = useRef<{ controller: AbortController; pending: boolean; recheck: boolean } | undefined>(undefined);
  const revoked = useRef(false);
  const invalidator = useRef(invalidate); invalidator.current = invalidate;
  const restart = () => {
    active.current?.controller.abort(); setData(undefined); setError(undefined); setLoading(true); setRevision(value => value + 1);
  };
  const deny = () => {
    active.current?.controller.abort(); setData(undefined); setError('denied'); setLoading(false);
    if (!revoked.current) { revoked.current = true; invalidator.current(); }
  };
  useEffect(() => {
    const unsubscribe = useWorkTabsStore.subscribe((next, previous) => {
      if (next.sessionScope !== previous.sessionScope) restart();
    });
    const signals = subscribeSessionSignals(signal => {
      if (signal !== 'revalidate') { deny(); return; }
      if (revoked.current) return;
      // The client broadcasts revalidate before rejecting a forbidden read.
      if (active.current?.pending) { active.current.recheck = true; setData(undefined); setLoading(true); }
      else restart();
    });
    return () => { unsubscribe(); signals(); };
  }, []);
  useEffect(() => {
    if (!canRead || !matchesSession || revoked.current) { setData(undefined); setError('denied'); setLoading(false); return; }
    const controller = new AbortController();
    const token = { controller, pending: true, recheck: false }; active.current = token;
    const current = () => active.current === token && !controller.signal.aborted && useWorkTabsStore.getState().sessionScope === session;
    const query = new URLSearchParams({ organizationId: context.targetOrganization.id, scope: filters.scope,
      ...range, page: String(filters.page), limit: '50' });
    if (filters.method) query.set('method', filters.method);
    if (filters.statusClass) query.set('statusClass', String(filters.statusClass));
    if (filters.route) query.set('route', filters.route);
    setData(undefined); setError(undefined); setLoading(true);
    void apiRequest<Page>(`/api/v1/admin/console/api-observations?${query}`, { signal: controller.signal }).then(result => {
      if (!current()) return;
      token.pending = false;
      if (token.recheck) { restart(); return; }
      if (result.scope !== filters.scope || result.organizationId !== context.targetOrganization.id
        || result.scope === 'PLATFORM' && !context.hasPlatformAdministrator
        || !Array.isArray(result.items) || result.items.some(row => result.scope === 'ORGANIZATION' ? row.scopeKey !== context.targetOrganization.id : row.scopeKey !== 'UNSCOPED' && !uuid.test(row.scopeKey))) {
        deny(); return;
      }
      if (![result.asOf, result.from, result.to].every(value => Number.isFinite(Date.parse(value)))
        || result.page !== filters.page || result.limit !== 50 || !Number.isSafeInteger(result.total) || result.total < 0
        || !Object.values(result.summary).every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) throw new Error('Invalid observation response');
      setData(result); setLoading(false);
    }).catch(cause => {
      if (!current()) return;
      token.pending = false;
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) { deny(); return; }
      if (token.recheck) { restart(); return; }
      setData(undefined); setError('network'); setLoading(false);
    });
    return () => controller.abort();
  }, [filters, range, session, canRead, matchesSession, context]);

  const denied = error === 'denied' || !canRead || !matchesSession;
  const apply = () => {
    const route = draft.route.trim();
    if (route.length > 200 || route && !routePattern.test(route)) { setValidation(true); return; }
    setValidation(false); active.current?.controller.abort(); setData(undefined); setFilters({ ...draft, route, page: 1 }); setRevision(value => value + 1);
  };
  const changePage = (page: number) => { active.current?.controller.abort(); setData(undefined); setFilters(value => ({ ...value, page })); };
  const clock = (value: string) => <time dateTime={value}>{new Date(value).toLocaleString(locale, { hour12: false })}</time>;
  const count = (value: number) => value.toLocaleString(locale);
  const duration = (value: number) => `${Number(value.toFixed(2)).toLocaleString(locale)} ms`;
  const receipts = {
    UNKNOWN: text('采集完整性未知', 'Collection completeness unknown'),
    CURRENT: text('采集回执近期更新', 'Collection receipts updated recently'),
    PARTIAL: text('采集存在缺口', 'Collection has gaps'),
    STALE: text('采集回执已过期', 'Collection receipts stale'),
  };
  const columns = [
    { title: text('分钟', 'Minute'), key: 'minute', width: 185, render: (_: unknown, row: Bucket) => clock(row.minute) },
    ...(data?.scope === 'PLATFORM' ? [{ title: text('归属组织', 'Scope'), dataIndex: 'scopeKey', width: 235 }] : []),
    { title: text('方法', 'Method'), dataIndex: 'method', width: 90 },
    { title: text('注册路由模板', 'Registered route template'), dataIndex: 'route', render: (value: string) => <code className="qms-api-route">{value}</code> },
    { title: text('状态类别', 'Status class'), key: 'status', width: 95, render: (_: unknown, row: Bucket) => `${row.statusClass}xx` },
    { title: text('请求次数', 'Requests'), dataIndex: 'count', width: 100, render: count },
    { title: text('平均耗时', 'Mean latency'), key: 'mean', width: 115, render: (_: unknown, row: Bucket) => duration(row.count ? row.durationTotal / row.count : 0) },
    { title: text('最大耗时', 'Maximum latency'), dataIndex: 'durationMax', width: 115, render: duration },
  ];
  const latency = data ? [
    { label: '≤ 50 ms', value: data.summary.le50 }, { label: '50–200 ms', value: data.summary.le200 },
    { label: '200–1000 ms', value: data.summary.le1000 }, { label: '1000–5000 ms', value: data.summary.le5000 }, { label: '> 5000 ms', value: data.summary.gt5000 },
  ] : [];
  return <div className="qms-api-monitoring" aria-busy={loading}>
    <header className="qms-api-heading">
      {!denied && <Button icon={<RefreshCw size={16} aria-hidden="true" />} onClick={restart} aria-label={error === 'network' ? text('重试读取', 'Retry reading') : text('刷新 API 观测', 'Refresh API observations')}>{error === 'network' ? text('重试读取', 'Retry reading') : text('刷新', 'Refresh')}</Button>}</header>
    {denied ? <div className="qms-console-state"><Alert role="alert" showIcon type="error" title={text('API 观测访问已失效或无权限，请重新核验。', 'API observation access expired or denied. Verify authorization again.')} /><Button onClick={refresh}>{text('重新核验权限', 'Verify authorization again')}</Button></div> : <>
      <div className="qms-api-scope"><strong>{context.targetOrganization.name} ({context.targetOrganization.code})</strong><span>{filters.scope === 'PLATFORM' ? text('平台观测（含未归属请求）', 'Platform observations including unscoped requests') : text('当前目标组织', 'Current target organization')}</span></div>
      <form className="qms-api-filters" aria-label={text('API 观测筛选', 'API observation filters')} onSubmit={event => { event.preventDefault(); apply(); }}>
        {context.hasPlatformAdministrator && <label><span>{text('观测范围', 'Observation scope')}</span><Select aria-label={text('观测范围', 'Observation scope')} value={filters.scope} options={[
          { value: 'ORGANIZATION', label: text('当前目标组织', 'Current target organization') }, { value: 'PLATFORM', label: text('平台观测（含未归属请求）', 'Platform observations including unscoped requests') },
        ]} onChange={(scope: Page['scope']) => { active.current?.controller.abort(); setData(undefined); setDraft(value => ({ ...value, scope })); setFilters(value => ({ ...value, scope, page: 1 })); }} /></label>}
        <label><span>{text('查询时段', 'Time window')}</span><Select aria-label={text('查询时段', 'Time window')} value={draft.period} options={[
          { value: '1', label: text('近 1 小时', 'Last hour') }, { value: '24', label: text('近 24 小时', 'Last 24 hours') }, { value: '168', label: text('近 7 天', 'Last 7 days') },
        ]} onChange={(period: Filters['period']) => setDraft(value => ({ ...value, period }))} /></label>
        <label><span>{text('请求方法', 'Request method')}</span><Select aria-label={text('请求方法', 'Request method')} value={draft.method ?? ''} options={[
          { value: '', label: text('全部方法', 'All methods') }, ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'OTHER'].map(value => ({ value, label: value })),
        ]} onChange={(method: Query['method'] | '') => setDraft(value => ({ ...value, method: method || undefined }))} /></label>
        <label><span>{text('状态类别', 'Status class')}</span><Select aria-label={text('状态类别', 'Status class')} value={draft.statusClass ?? 0} options={[
          { value: 0, label: text('全部状态', 'All statuses') }, ...[1, 2, 3, 4, 5].map(value => ({ value, label: `${value}xx` })),
        ]} onChange={statusClass => setDraft(value => ({ ...value, statusClass: statusClass || undefined }))} /></label>
        <label className="qms-api-filter-route" htmlFor={`${id}-route`}><span>{text('路由模板', 'Route template')}</span><Input id={`${id}-route`} aria-label={text('路由模板', 'Route template')} value={draft.route} maxLength={200} placeholder="/api/v1/tasks/:id" onChange={event => setDraft(value => ({ ...value, route: event.target.value }))} /></label>
        <Button htmlType="submit" type="primary">{text('应用筛选', 'Apply filters')}</Button>
      </form>
      {validation && <Alert role="alert" type="warning" showIcon title={text('请输入静态路由模板或 UNKNOWN，不可包含查询参数或原请求 URL。', 'Enter a static route template or UNKNOWN, never query parameters or a raw request URL.')} />}
      {error === 'network' && <Alert role="alert" type="error" showIcon title={text('API 观测读取失败，请重试。', 'API observations could not be read. Retry.')} />}
      {loading && <div role="status" aria-label={text('读取 API 观测中', 'Reading API observations')}><Skeleton active paragraph={{ rows: 4 }} /></div>}
      {data && <>
        <div className="qms-api-times"><Clock3 size={15} aria-hidden="true" /><span>{text('服务器查询时间：', 'Server query time: ')}{clock(data.asOf)}</span><span>{text('实际统计窗口：', 'Actual observed window: ')}{clock(data.from)} — {clock(data.to)}</span></div>
        <Alert type={data.collector.status === 'CURRENT' ? 'info' : 'warning'} showIcon title={receipts[data.collector.status]} />
        {data.scope === 'PLATFORM' && <p className="qms-api-note">{text('当前进程丢弃：', 'Current process drops: ')}{data.collector.liveDropped === undefined ? text('未知', 'Unknown') : count(data.collector.liveDropped)} · {text('当前进程采集失败：', 'Current process collection failures: ')}{data.collector.liveFailures === undefined ? text('未知', 'Unknown') : count(data.collector.liveFailures)}</p>}
        <section className="qms-api-metrics" aria-label={text('请求摘要', 'Request summary')}><dl>
          <div><dt>{text('请求次数', 'Requests')}</dt><dd>{count(data.summary.requests)}</dd></div><div><dt>{text('错误次数（4xx / 5xx）', 'Errors (4xx / 5xx)')}</dt><dd>{count(data.summary.errors)}</dd></div>
          <div><dt>{text('平均耗时', 'Mean latency')}</dt><dd>{data.summary.requests ? duration(data.summary.durationTotal / data.summary.requests) : '—'}</dd></div><div><dt>{text('最大耗时', 'Maximum latency')}</dt><dd>{data.summary.requests ? duration(data.summary.durationMax) : '—'}</dd></div>
        </dl></section>
        <section className="qms-api-latency" aria-label={text('耗时分布', 'Latency distribution')}><h3>{text('耗时分布', 'Latency distribution')}</h3><div>{latency.map(bucket => <dl key={bucket.label}><dt>{bucket.label}</dt><dd>{count(bucket.value)}</dd><div className="qms-api-meter" aria-hidden="true"><span style={{ width: `${data.summary.requests ? Math.min(100, bucket.value / data.summary.requests * 100) : 0}%` }} /></div></dl>)}</div></section>
        <section aria-label={text('分钟聚合明细', 'Minute aggregate details')} className="qms-api-details"><h3>{text('分钟聚合明细', 'Minute aggregate details')}</h3>
          {!data.items.length ? <div className="qms-api-empty"><strong>{text('当前查询范围没有观测记录', 'No observations in this query window')}</strong></div> : <Table<Bucket> size="small" columns={columns} dataSource={data.items} pagination={false} rowKey={row => JSON.stringify([row.minute, row.scopeKey, row.method, row.route, row.statusClass])} scroll={{ x: data.scope === 'PLATFORM' ? 1170 : 950 }} />}
          <div className="qms-api-pagination"><span>{text(`共 ${count(data.total)} 个聚合桶 · 第 ${data.page} 页`, `${count(data.total)} aggregate buckets · Page ${data.page}`)}</span><div><Button disabled={loading || data.page <= 1} onClick={() => changePage(data.page - 1)}>{text('上一页', 'Previous page')}</Button><Button disabled={loading || data.page >= 10000 || data.page * data.limit >= data.total} onClick={() => changePage(data.page + 1)}>{text('下一页', 'Next page')}</Button></div></div>
        </section>
      </>}
    </>}
  </div>;
}
