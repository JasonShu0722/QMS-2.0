import { Alert, Button, Skeleton } from 'antd';
import { ArrowUpRight, Clock3, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest } from '../api/client';
import { subscribeSessionSignals } from '../features/auth/session-invalidation';
import { useLanguage } from '../i18n/Language';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { useConsoleContext } from './ConsoleLayout';
import { consoleNavigation, type ConsoleContext } from './console-navigation';
import './ConsoleHome.css';
import { ConsoleObservationSummary } from './ConsoleObservationSummary';

type Home = components['schemas']['ConsoleHomeDto'];
type Source = components['schemas']['ConsoleHomeSourceDto'];
const labels: Record<Source['key'], [string, string]> = {
  outbox: ['失败队列', 'Failed events'], audit: ['最近管理审计', 'Recent management audit'],
  'reconfiguration-organizations': ['待配置组织', 'Pending organizations'],
  'reconfiguration-departments': ['待配置部门', 'Pending departments'],
  'reconfiguration-positions': ['待配置岗位', 'Pending positions'],
  'reconfiguration-users': ['待配置用户', 'Pending users'],
};

function capabilityKey(context: ConsoleContext) {
  const structure = (organization: ConsoleContext['targetOrganization']) => [organization.id, organization.type, organization.status, organization.configurationRequired];
  return JSON.stringify([context.actor.id, context.actor.accountType, structure(context.actor.homeOrganization), structure(context.targetOrganization), context.hasPlatformAdministrator,
    context.modules.map(module => [module.key, module.scope, module.coverage, module.organizationId, [...module.permissions].sort()]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
}

function allowed(source: Source, context: ConsoleContext) {
  const pending = source.key.startsWith('reconfiguration-');
  const moduleKey = pending ? 'reconfiguration' : source.key;
  const permission = pending ? 'organization:reconfigure' : source.key === 'audit' ? 'audit:read' : 'outbox:read';
  return Object.hasOwn(labels, source.key) && source.scope === (pending ? 'SESSION_HOME' : 'TARGET')
    && source.coverage === (pending ? 'PLATFORM' : 'ORGANIZATION')
    && source.organizationId === (pending ? context.actor.homeOrganization.id : context.targetOrganization.id)
    && context.modules.some(module => module.key === moduleKey && module.scope === source.scope && module.coverage === source.coverage
      && module.organizationId === source.organizationId && module.permissions.includes(permission));
}

export function ConsoleHome() {
  const { context, refresh, invalidate } = useConsoleContext();
  const session = useWorkTabsStore(state => state.sessionScope);
  const identity = capabilityKey(context);
  return <><HomeScope key={JSON.stringify([session, identity])} context={context} identity={identity} session={session} refresh={refresh} invalidate={invalidate} /><ConsoleObservationSummary /></>;
}

function HomeScope({ context, identity, session, refresh, invalidate }: {
  context: ConsoleContext; identity: string; session?: string; refresh: () => void; invalidate: () => void;
}) {
  const { locale } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const [data, setData] = useState<Home>();
  const [error, setError] = useState<'denied' | 'network'>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const active = useRef<{ controller: AbortController; pending: boolean; recheck: boolean } | undefined>(undefined);
  const revoked = useRef(false);
  const invalidator = useRef(invalidate); invalidator.current = invalidate;
  const matchesSession = session === `INTERNAL:${context.actor.homeOrganization.id}:${context.actor.id}`;
  const restart = (clear = false) => {
    active.current?.controller.abort();
    if (clear) setData(undefined);
    setError(undefined); setLoading(true); setRevision(value => value + 1);
  };
  const deny = () => {
    active.current?.controller.abort(); setData(undefined); setError('denied'); setLoading(false);
    if (!revoked.current) { revoked.current = true; invalidator.current(); }
  };

  useEffect(() => {
    const unsubscribe = useWorkTabsStore.subscribe((next, previous) => {
      // Retire synchronously even when React batches an A -> B -> A transition.
      if (next.sessionScope !== previous.sessionScope) restart(true);
    });
    const signals = subscribeSessionSignals(signal => {
      if (signal === 'revalidate') {
        // The client broadcasts before rejecting 403; queue a recheck without accepting this read's success.
        if (active.current?.pending) { active.current.recheck = true; setLoading(true); }
        else restart();
      } else deny();
    });
    return () => { unsubscribe(); signals(); };
  }, []);

  useEffect(() => {
    if (!matchesSession) { setData(undefined); setError('denied'); setLoading(false); return; }
    const controller = new AbortController();
    const token = { controller, pending: true, recheck: false }; active.current = token; revoked.current = false;
    const current = () => active.current === token && !controller.signal.aborted && useWorkTabsStore.getState().sessionScope === session;
    void apiRequest<Home>(`/api/v1/admin/console/home?${new URLSearchParams({ organizationId: context.targetOrganization.id })}`, { signal: controller.signal }).then(result => {
      if (!current()) return;
      token.pending = false;
      if (token.recheck) { restart(); return; }
      let valid = false;
      try { valid = capabilityKey(result.context) === identity && Array.isArray(result.sources) && Number.isFinite(Date.parse(result.asOf)); } catch { /* A malformed identity is never authorization evidence. */ }
      if (!valid) throw new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: 'Invalid console home scope' }, 403);
      setData({ ...result, sources: result.sources.filter(source => allowed(source, context)) }); setError(undefined); setLoading(false);
    }).catch(cause => {
      if (!current()) return;
      token.pending = false;
      const denied = cause instanceof ApiError && (cause.status === 401 || cause.status === 403);
      if (denied) { deny(); return; }
      if (token.recheck) { restart(); return; }
      setData(undefined); setError('network'); setLoading(false);
    });
    return () => controller.abort();
  }, [revision, identity, session, matchesSession, context]);

  const href = (path: string, resource?: { resourceType: string; resourceId: string | null }) => {
    const query = new URLSearchParams({ organizationId: context.targetOrganization.id });
    if (resource?.resourceType.trim() && resource.resourceType.length <= 100 && resource.resourceId?.trim() && resource.resourceId.length <= 128
      && !/[\u0000-\u001f\u007f]/.test(resource.resourceType + resource.resourceId)) {
      query.set('resourceType', resource.resourceType); query.set('resourceId', resource.resourceId);
    }
    return `${path}?${query}`;
  };
  const clock = (value: string) => <time dateTime={value}>{new Date(value).toLocaleString(locale, { hour12: false })}</time>;
  const denied = error === 'denied' || !matchesSession;
  const entries = consoleNavigation(context).filter(entry => entry.path !== '/console');

  return <div className="qms-console-home" aria-busy={loading}>
    <div className="qms-console-home-intro">
      <div><h2>{text('当前管理事项', 'Current management items')}</h2><details className="qms-console-reading-notes"><summary>{text('来源可能不完整 · 非实时', 'Sources may be incomplete · Not live')}</summary><p>{text('仅展示当前有权读取的公开来源；没有汇总不代表事项为零。', 'Only authorized public sources are shown. Missing summaries do not mean zero items.')}</p><p>{text('各来源独立查询，不是同一原子快照或实时运行状态。', 'Sources are queried independently, not an atomic snapshot or live operational status.')}</p></details></div>
      {!denied && <Button icon={<RefreshCw size={16} aria-hidden="true" />} onClick={() => restart()} aria-label={error === 'network' ? text('重试读取', 'Retry reading') : text('刷新管理事项', 'Refresh management items')}>
        {error === 'network' ? text('重试读取', 'Retry reading') : text('刷新', 'Refresh')}
      </Button>}
    </div>
    {denied ? <div className="qms-console-state"><Alert showIcon type="error" role="alert" title={text('管理访问已失效或无权限，请重新核验。', 'Management access expired or denied. Verify authorization again.')} /><Button onClick={refresh}>{text('重新核验权限', 'Verify authorization again')}</Button></div>
      : <>
        {error === 'network' && <Alert showIcon type="error" role="alert" title={text('管理事项读取失败，请重试。', 'Management items could not be read. Retry.')} />}
        {loading && <div role="status" aria-label={text('读取管理事项中', 'Reading management items')} className="qms-console-home-loading">{data ? text('正在重新读取，以下为上次查询结果。', 'Refreshing; the previous query results remain below.') : <Skeleton active paragraph={{ rows: 3 }} />}</div>}
        {data && <>
          <p className="qms-console-home-time"><Clock3 size={15} aria-hidden="true" /><span>{text('服务器查询时间：', 'Server query time: ')}{clock(data.asOf)}</span></p>
          {!data.sources.length && <div className="qms-console-home-empty"><h3>{text('当前无可汇总事项', 'No summarized management items available')}</h3><p>{text('可从下方常用入口进入已授权功能。', 'Use the authorized common entries below.')}</p></div>}
          <div className="qms-console-home-sources">{data.sources.map(source => {
            const label = text(...labels[source.key]);
            const audit = source.key === 'audit';
            const path = audit ? '/console/audit-log' : source.key === 'outbox' ? '/console/outbox' : '/console/reconfiguration';
            const unavailable = source.status !== 'AVAILABLE' || (audit ? !Array.isArray(source.items) : !Number.isSafeInteger(source.total) || source.total! < 0);
            return <section key={source.key} aria-label={label} className={`qms-console-home-source${audit ? ' qms-console-home-audit' : ''}`}>
              <header><h3>{label}</h3></header>
              <details className="qms-console-reading-notes"><summary>{text('范围与来源', 'Scope & source')}</summary><span className="qms-console-home-range">{source.scope} · {source.coverage === 'PLATFORM' ? text('平台级目录', 'Platform directory') : text('组织范围', 'Organization scope')}</span><p className="qms-console-home-note">{source.coverage === 'PLATFORM' ? text(`授权来源：${context.actor.homeOrganization.name} (${context.actor.homeOrganization.code})，不是全部资源的归属组织。`, `Authorization source: ${context.actor.homeOrganization.name} (${context.actor.homeOrganization.code}), not the owner of every resource.`)
                : `${context.targetOrganization.name} (${context.targetOrganization.code})`}</p></details>
              {unavailable ? <div className="qms-console-home-source-error" role="status"><p>{source.reasonCode === 'AUTHORIZATION_CHANGED' ? text('来源权限已变化，请重新核验。', 'Source authorization changed. Verify access again.') : text('来源暂不可用', 'Source unavailable')}</p>
                {source.reasonCode === 'AUTHORIZATION_CHANGED' && <Button onClick={refresh}>{text('重新核验权限', 'Verify authorization again')}</Button>}</div>
                : audit ? source.items!.length ? <ul className="qms-console-home-events">{source.items!.slice(0, 5).filter(event => event.organizationId === source.organizationId).map(event => <li key={event.id}>
                  <div><strong>{event.actionLabel}</strong><span>{event.actorSummary?.username ?? text('系统或历史账号', 'System or historical account')}</span></div>
                  <p>{event.resourceType}{event.resourceId ? ` · ${event.resourceId}` : ''}</p>
                  <div className="qms-console-home-event-meta">{clock(event.createdAt)}<span>{event.outcome === 'SUCCESS' ? text('成功', 'Success') : event.outcome === 'DENIED' ? text('拒绝', 'Denied') : text('失败', 'Failure')}</span>
                    <Link to={href(path, event)} aria-label={`${text('查看审计记录', 'View audit record')} ${event.actionLabel}`}>{text('查看记录', 'View record')}<ArrowUpRight size={14} aria-hidden="true" /></Link></div>
                </li>)}</ul> : <p className="qms-console-home-empty-note">{text('当前范围暂无审计记录', 'No audit events in this scope')}</p>
                  : <p className="qms-console-home-total">{source.total}</p>}
              <footer><span>{text('来源查询时间：', 'Source query time: ')}{clock(source.completedAt)}</span>
                <Link to={href(path)} aria-label={`${text('查看', 'View ')}${label}`}>{text('查看来源', 'View source')}<ArrowUpRight size={15} aria-hidden="true" /></Link></footer>
            </section>;
          })}</div>
          <nav className="qms-console-home-shortcuts" aria-label={text('常用入口', 'Common entries')}><h2>{text('常用入口', 'Common entries')}</h2><div>{entries.map(entry => <Link key={entry.path} to={href(entry.path)}>{text(entry.label, entry.english)}<ArrowUpRight size={15} aria-hidden="true" /></Link>)}</div></nav>
        </>}
      </>}
  </div>;
}
