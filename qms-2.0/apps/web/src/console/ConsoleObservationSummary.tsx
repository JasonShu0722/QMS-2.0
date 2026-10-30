import { Alert, Button, Skeleton } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest } from '../api/client';
import { subscribeSessionSignals } from '../features/auth/session-invalidation';
import { useLanguage } from '../i18n/Language';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { useConsoleContext } from './ConsoleLayout';
import type { ConsoleContext } from './console-navigation';
import './console-observation-summary.css';

type Api = components['schemas']['ApiObservationPageDto'];
type Exchanges = components['schemas']['DataExchangePageDto'];
type Services = components['schemas']['ServiceOperationsPageDto'];
const sources = [
  { key: 'api', module: 'api-monitoring', permission: 'console:api:read', endpoint: 'api-observations', path: 'api-monitoring', title: ['API 观测摘要', 'API observation summary'], link: ['查看 API 观测', 'View API observations'] },
  { key: 'exchanges', module: 'data-exchanges', permission: 'console:exchanges:read', endpoint: 'data-exchanges', path: 'data-exchanges', title: ['数据交换摘要', 'Data exchange summary'], link: ['查看数据交换', 'View data exchanges'] },
  { key: 'services', module: 'services', permission: 'console:services:read', endpoint: 'services', path: 'services', title: ['运行服务摘要', 'Service operation summary'], link: ['查看运行服务', 'View service operations'] },
] as const;
type Key = (typeof sources)[number]['key'];
const serviceLabels = { worker: ['Worker 回执', 'Worker receipts'], outbox: ['失败队列', 'Failed events'], files: ['文件与扫描', 'Files & scanning'], mail: ['邮件投递', 'Mail delivery'], pdf: ['PDF 渲染', 'PDF rendering'] } as const;
const receiptLabels = { UNKNOWN: ['未知', 'Unknown'], STALE: ['已过期', 'Stale'], UNAVAILABLE: ['不可读取', 'Unavailable'], RECENT_RESULT: ['近期执行事实', 'Recent execution fact'] } as const;
const executionLabels = { STARTED: ['已开始', 'Started'], SUCCEEDED: ['执行成功', 'Execution succeeded'], FAILED: ['执行失败', 'Execution failed'], STOPPED: ['已停止', 'Stopped'] } as const;
const safeCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const validTime = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
function identity(context: ConsoleContext) {
  return JSON.stringify([context.actor, context.targetOrganization, context.hasPlatformAdministrator,
    context.modules.map(module => [module.key, module.scope, module.coverage, module.organizationId, [...module.permissions].sort()]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
}
function allowed(context: ConsoleContext) {
  return context.actor.accountType === 'INTERNAL' && context.targetOrganization.status === 'ACTIVE' && !context.targetOrganization.configurationRequired ? sources.filter(source => context.modules.some(module => module.key === source.module && module.scope === 'TARGET' && module.coverage === 'ORGANIZATION' && module.organizationId === context.targetOrganization.id && module.permissions.includes(source.permission))) : [];
}

export function ConsoleObservationSummary() {
  const { context, refresh, invalidate } = useConsoleContext();
  const session = useWorkTabsStore(state => state.sessionScope);
  if (!allowed(context).length) return null;
  return <ObservationScope key={JSON.stringify([session, identity(context)])} context={context} session={session} refresh={refresh} invalidate={invalidate} />;
}

function ObservationScope({ context, session, refresh, invalidate }: { context: ConsoleContext; session?: string; refresh: () => void; invalidate: () => void }) {
  const { locale } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const enabled = allowed(context);
  const [api, setApi] = useState<Api>();
  const [exchanges, setExchanges] = useState<Exchanges>();
  const [services, setServices] = useState<Services>();
  const [failed, setFailed] = useState<Key[]>([]);
  const [loading, setLoading] = useState<Key[]>(enabled.map(source => source.key));
  const [denied, setDenied] = useState(false);
  const [revision, setRevision] = useState(0);
  const active = useRef<{ controller: AbortController; pending: number; recheck: boolean } | undefined>(undefined);
  const revoked = useRef(false);
  const invalidator = useRef(invalidate); invalidator.current = invalidate;
  const clear = () => { setApi(undefined); setExchanges(undefined); setServices(undefined); };
  const restart = () => { active.current?.controller.abort(); clear(); setFailed([]); setLoading(enabled.map(source => source.key)); setRevision(value => value + 1); };
  const deny = () => {
    active.current?.controller.abort(); clear(); setFailed([]); setLoading([]); setDenied(true);
    if (!revoked.current) { revoked.current = true; invalidator.current(); }
  };
  useEffect(() => {
    const unsubscribe = useWorkTabsStore.subscribe((next, previous) => { if (next.sessionScope !== previous.sessionScope) restart(); });
    const signals = subscribeSessionSignals(signal => {
      if (signal !== 'revalidate') { deny(); return; }
      if (revoked.current) return;
      // A forbidden client read broadcasts first; do not replace it with an overlapping successful read.
      if (active.current?.pending) { active.current.recheck = true; clear(); setLoading(enabled.map(source => source.key)); }
      else restart();
    });
    return () => { unsubscribe(); signals(); active.current?.controller.abort(); };
  }, []);
  useEffect(() => {
    if (revoked.current) return;
    if (session !== `INTERNAL:${context.actor.homeOrganization.id}:${context.actor.id}`) { deny(); return; }
    const token = { controller: new AbortController(), pending: enabled.length, recheck: false }; active.current = token;
    const current = () => active.current === token && !token.controller.signal.aborted && useWorkTabsStore.getState().sessionScope === session;
    clear(); setFailed([]); setLoading(enabled.map(source => source.key));
    const query = new URLSearchParams({ organizationId: context.targetOrganization.id, scope: 'ORGANIZATION' });
    for (const source of enabled) void apiRequest<Api | Exchanges | Services>(`/api/v1/admin/console/${source.endpoint}?${query}`, { signal: token.controller.signal }).then(response => {
      if (!current() || token.recheck) return;
      if (response.scope !== 'ORGANIZATION' || response.organizationId !== context.targetOrganization.id) { deny(); return; }
      if (!validTime(response.asOf)) throw new Error('Invalid observation summary');
      if (source.key === 'api') {
        const result = response as Api;
        if (!result.summary || !safeCount(result.summary.requests) || !safeCount(result.summary.errors) || !validTime(result.from) || !validTime(result.to) || !result.collector || !['UNKNOWN', 'CURRENT', 'PARTIAL', 'STALE'].includes(result.collector.status)) throw new Error('Invalid API observation summary');
        setApi(result);
      } else if (source.key === 'exchanges') {
        const result = response as Exchanges;
        if (!result.summary || !Object.values(result.summary).every(safeCount) || !['NOT_CONNECTED', 'REGISTERED'].includes(result.connectionStatus) || !result.collection || !['UNKNOWN', 'UNAVAILABLE'].includes(result.collection.status)) throw new Error('Invalid exchange summary');
        setExchanges(result);
      } else {
        const result = response as Services;
        if (!Array.isArray(result.sources) || new Set(result.sources.map(row => row.key)).size !== result.sources.length || result.sources.some(row => !Object.hasOwn(serviceLabels, row.key)
          || row.organizationId !== context.targetOrganization.id || row.coverage !== (row.key === 'worker' ? 'PLATFORM' : 'ORGANIZATION')
          || row.key === 'worker' && (row.counts !== undefined || !!row.results?.length || row.status !== 'UNKNOWN'))) { deny(); return; }
        if (result.sources.some(row => !Object.hasOwn(receiptLabels, row.status) || !validTime(row.asOf)
          || row.results !== undefined && (!Array.isArray(row.results) || row.results.length > 100 || row.results.some(receipt => !Object.hasOwn(executionLabels, receipt.status) || !validTime(receipt.observedAt))))) throw new Error('Invalid service summary');
        setServices(result);
      }
    }).catch(cause => {
      if (!current()) return;
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) { deny(); return; }
      if (!token.recheck) setFailed(previous => [...previous, source.key]);
    }).finally(() => {
      token.pending--;
      if (!current()) return;
      if (token.recheck) { if (!token.pending) restart(); }
      else setLoading(previous => previous.filter(key => key !== source.key));
    });
    return () => token.controller.abort();
  }, [context, session, revision]);
  const clock = (value: string) => <time dateTime={value}>{new Date(value).toLocaleString(locale, { hour12: false })}</time>;
  const count = (value: number) => value.toLocaleString(locale);
  if (denied) return <section className="qms-observation-summary"><Alert role="alert" showIcon type="error" title={text('观测摘要访问已失效，请重新核验权限。', 'Observation summary access expired. Verify authorization again.')} /><Button onClick={refresh}>{text('重新核验权限', 'Verify authorization again')}</Button></section>;
  return <section className="qms-observation-summary" aria-label={text('管理观测摘要', 'Management observation summaries')}>
    <header><div><h2>{text('观测与运行事实', 'Observation & operation facts')}</h2><p>{text('当前目标组织的最近可取得事实，不是系统健康总分。', 'The latest available facts for the target organization, not an overall system health score.')}</p></div><Button onClick={restart}>{text('刷新观测摘要', 'Refresh observation summaries')}</Button></header>
    <div className="qms-observation-cards">{enabled.map(source => {
      const data = source.key === 'api' ? api : source.key === 'exchanges' ? exchanges : services;
      return <section key={source.key} aria-label={text(source.title[0], source.title[1])} className="qms-observation-card"><h3>{text(source.title[0], source.title[1])}</h3>
        {loading.includes(source.key) && <div role="status" aria-label={text('读取摘要中', 'Reading summary')}><Skeleton active paragraph={{ rows: 2 }} title={false} /></div>}
        {failed.includes(source.key) && <p className="qms-observation-warning">{text('此来源暂不可读取', 'This source is temporarily unavailable')}</p>}
        {data && <p className="qms-observation-time">{text('服务器查询：', 'Server query: ')}{clock(data.asOf)}</p>}
        {source.key === 'api' && api && <><dl className="qms-observation-metrics"><div><dt>{text('24 小时请求', '24h requests')}</dt><dd>{count(api.summary.requests)}</dd></div><div><dt>{text('错误（4xx / 5xx）', 'Errors (4xx / 5xx)')}</dt><dd>{count(api.summary.errors)}</dd></div></dl><p className="qms-observation-note">{text('实际窗口：', 'Actual window: ')}{clock(api.from)} — {clock(api.to)}</p><p className="qms-observation-note">{api.collector.status === 'UNKNOWN' ? text('采集完整性未知；不代表零丢失。', 'Collection completeness unknown; not proof of zero loss.') : text('采集回执不代表业务健康，详情请查看 API 观测。', 'Collection receipts do not indicate business health; see API observations.')}</p></>}
        {source.key === 'exchanges' && exchanges && <>{exchanges.connectionStatus === 'NOT_CONNECTED' ? <p className="qms-observation-note">{text('尚未接入外部数据来源', 'No external data sources connected')}</p> : <><p className="qms-observation-note">{text('仅已注册来源，不代表在线或业务联调完成。', 'Registered sources only, not proof of availability or business integration.')}</p><dl className="qms-observation-metrics"><div><dt>{text('批次尝试', 'Batch attempts')}</dt><dd>{count(exchanges.summary.batchAttempts)}</dd></div><div><dt>{text('记录尝试', 'Record attempts')}</dt><dd>{count(exchanges.summary.recordAttempts)}</dd></div></dl></>}<p className="qms-observation-note">{exchanges.collection.status === 'UNAVAILABLE' ? text('观测采集不可用', 'Observation collection unavailable') : text('采集完整性未知，传输成功不等于业务落地或对账成功。', 'Collection completeness unknown; transfer success is not business completion or reconciliation.')}</p></>}
        {source.key === 'services' && services && <>{!services.sources.length && <p className="qms-observation-note">{text('暂无服务执行事实', 'No service execution facts')}</p>}<ul className="qms-observation-service-list">{services.sources.map(row => <li key={row.key}><span>{text(serviceLabels[row.key][0], serviceLabels[row.key][1])}</span><strong>{text(receiptLabels[row.status][0], receiptLabels[row.status][1])}</strong>{row.results?.[0] && <span>{text(executionLabels[row.results[0].status][0], executionLabels[row.results[0].status][1])}</span>}</li>)}</ul><p className="qms-observation-note">{text('渲染或执行事实不等于最终业务成功；配置存在不代表实时在线。', 'Rendering or execution facts are not final business success; configuration does not establish live availability.')}</p></>}
        <Link to={`/console/${source.path}?${new URLSearchParams({ organizationId: context.targetOrganization.id })}`}>{text(source.link[0], source.link[1])}</Link>
      </section>;
    })}</div>
  </section>;
}
