import { Alert, Button, Select, Skeleton, Tag } from 'antd';
import { Clock3, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { components, operations } from '@qms/contracts';
import { ApiError, apiRequest } from '../api/client';
import { subscribeSessionSignals } from '../features/auth/session-invalidation';
import { useLanguage } from '../i18n/Language';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { useConsoleContext } from './ConsoleLayout';
import type { ConsoleContext } from './console-navigation';
import './service-operations.css';

type Page = components['schemas']['ServiceOperationsPageDto'];
type Source = components['schemas']['ServiceOperationsSourceDto'];
type Result = components['schemas']['ServiceOperationsResultDto'];
type Counts = components['schemas']['ServiceOperationsCountsDto'];
type Query = NonNullable<operations['ServiceOperationsController_read']['parameters']['query']>;
const labels: Record<Source['key'], [string, string]> = { worker: ['Worker 执行回执', 'Worker execution receipts'], outbox: ['失败队列元数据', 'Failure queue metadata'], files: ['文件与扫描', 'Files & scanning'], mail: ['邮件投递', 'Mail delivery'], pdf: ['PDF 按请求渲染', 'PDF per-request rendering'] };
const statuses: Record<Source['status'], [string, string]> = { UNKNOWN: ['事实完整性未知', 'Fact completeness unknown'], STALE: ['回执已过期', 'Receipt stale'], UNAVAILABLE: ['来源不可用', 'Source unavailable'], RECENT_RESULT: ['近期执行事实', 'Recent execution fact'] };
const resultStatuses: Record<Result['status'], [string, string]> = { STARTED: ['已开始', 'Started'], SUCCEEDED: ['执行成功', 'Execution succeeded'], FAILED: ['执行失败', 'Execution failed'], STOPPED: ['已停止', 'Stopped'] };
const reasons: Record<NonNullable<Source['reasonCode']>, [string, string]> = { NO_RECEIPT: ['尚无执行回执', 'No execution receipt'], GLOBAL_SCOPE_REQUIRED: ['需显式平台范围才能读取全局回执', 'Explicit platform scope required for global receipts'], NOT_CONFIGURED: ['所需配置未满足', 'Required configuration is incomplete'], SOURCE_UNAVAILABLE: ['当前无法读取此来源', 'This source cannot currently be read'], RECEIPT_EXPIRED: ['最近执行事实已过期', 'The latest execution fact is stale'] };
const countLabels: Record<keyof Counts, [string, string]> = { waiting: ['等待上传', 'Waiting upload'], pending: ['待处理', 'Pending'], processing: ['处理中', 'Processing'], failed: ['失败', 'Failed'], succeeded: ['成功', 'Succeeded'], processed: ['已处理', 'Processed'], retried: ['已重试', 'Retried'] };
const domainLabels: Record<string, [string, string]> = { 'process-quality': ['制程质量', 'Process quality'], 'customer-quality': ['客户质量', 'Customer quality'], 'new-product-quality': ['新品质量', 'New product quality'], 'supplier-quality': ['供应商质量', 'Supplier quality'] };
const validTime = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validCounts = (counts?: Counts) => counts === undefined || counts !== null && Object.entries(counts).every(([key, value]) => Object.hasOwn(countLabels, key) && Number.isSafeInteger(value) && value >= 0);
function identity(context: ConsoleContext) {
  return JSON.stringify([context.actor, context.targetOrganization, context.hasPlatformAdministrator,
    context.modules.map(module => [module.key, module.scope, module.coverage, module.organizationId, [...module.permissions].sort()]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
}

export function ServiceOperationsPage() {
  const { context, refresh, invalidate } = useConsoleContext();
  const session = useWorkTabsStore(state => state.sessionScope);
  return <ServiceScope key={JSON.stringify([session, identity(context)])} context={context} session={session} refresh={refresh} invalidate={invalidate} />;
}

function ServiceScope({ context, session, refresh, invalidate }: { context: ConsoleContext; session?: string; refresh: () => void; invalidate: () => void }) {
  const { locale } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const canRead = context.actor.accountType === 'INTERNAL' && context.targetOrganization.status === 'ACTIVE' && !context.targetOrganization.configurationRequired
    && context.modules.some(module => module.key === 'services' && module.scope === 'TARGET' && module.coverage === 'ORGANIZATION'
      && module.organizationId === context.targetOrganization.id && module.permissions.includes('console:services:read'));
  const matchesSession = session === `INTERNAL:${context.actor.homeOrganization.id}:${context.actor.id}`;
  const [scope, setScope] = useState<NonNullable<Query['scope']>>('ORGANIZATION');
  const [data, setData] = useState<Page>();
  const [error, setError] = useState<'denied' | 'network'>();
  const [loading, setLoading] = useState(canRead && matchesSession);
  const [revision, setRevision] = useState(0);
  const active = useRef<{ controller: AbortController; pending: boolean; recheck: boolean } | undefined>(undefined);
  const revoked = useRef(false);
  const invalidator = useRef(invalidate); invalidator.current = invalidate;
  const restart = () => { active.current?.controller.abort(); setData(undefined); setError(undefined); setLoading(true); setRevision(value => value + 1); };
  const deny = () => {
    active.current?.controller.abort(); setData(undefined); setError('denied'); setLoading(false);
    if (!revoked.current) { revoked.current = true; invalidator.current(); }
  };
  useEffect(() => {
    const unsubscribe = useWorkTabsStore.subscribe((next, previous) => { if (next.sessionScope !== previous.sessionScope) restart(); });
    const signals = subscribeSessionSignals(signal => {
      if (signal !== 'revalidate') { deny(); return; }
      if (revoked.current) return;
      // The real client signals before rejecting a forbidden read; preserve that rejection's ownership.
      if (active.current?.pending) { active.current.recheck = true; setData(undefined); setLoading(true); }
      else restart();
    });
    return () => { unsubscribe(); signals(); active.current?.controller.abort(); };
  }, []);
  useEffect(() => {
    if (!canRead || !matchesSession || revoked.current) { setData(undefined); setError('denied'); setLoading(false); return; }
    const token = { controller: new AbortController(), pending: true, recheck: false }; active.current = token;
    const current = () => active.current === token && !token.controller.signal.aborted && useWorkTabsStore.getState().sessionScope === session;
    setData(undefined); setError(undefined); setLoading(true);
    const query = new URLSearchParams({ organizationId: context.targetOrganization.id, scope });
    void apiRequest<Page>(`/api/v1/admin/console/services?${query}`, { signal: token.controller.signal }).then(result => {
      if (!current()) return;
      token.pending = false;
      if (token.recheck) { restart(); return; }
      if (result.scope !== scope || result.organizationId !== context.targetOrganization.id || scope === 'PLATFORM' && !context.hasPlatformAdministrator || !Array.isArray(result.sources)
        || new Set(result.sources.map(source => source.key)).size !== result.sources.length
        || result.sources.some(source => !Object.hasOwn(labels, source.key)
          || source.organizationId !== context.targetOrganization.id || source.coverage !== (source.key === 'worker' ? 'PLATFORM' : 'ORGANIZATION')
          || scope === 'ORGANIZATION' && source.key === 'worker' && (source.counts !== undefined || !!source.results?.length || source.status !== 'UNKNOWN'))) { deny(); return; }
      if (!validTime(result.asOf) || result.sources.some(source => !validTime(source.asOf) || !Object.hasOwn(statuses, source.status) || !validCounts(source.counts)
        || source.reasonCode !== undefined && !Object.hasOwn(reasons, source.reasonCode)
        || [source.configured, source.scannerConfigured, source.storageConfigured].some(value => value !== undefined && typeof value !== 'boolean')
        || source.results !== undefined && (!Array.isArray(source.results) || source.results.length > 100 || source.results.some(row => !Object.hasOwn(resultStatuses, row.status) || !validTime(row.observedAt)
          || row.startedAt !== undefined && !validTime(row.startedAt) || row.completedAt != null && !validTime(row.completedAt)
          || row.durationMs != null && (!Number.isFinite(row.durationMs) || row.durationMs < 0) || !validCounts(row.counts)
          || row.domainCode !== undefined && !Object.hasOwn(domainLabels, row.domainCode)
          || row.reasonCode !== undefined && !['PDF_RENDER_FAILED', 'WORKER_EXECUTION_FAILED'].includes(row.reasonCode))))) throw new Error('Invalid service observation response');
      setData(result); setLoading(false);
    }).catch(cause => {
      if (!current()) return;
      token.pending = false;
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) { deny(); return; }
      if (token.recheck) { restart(); return; }
      setData(undefined); setError('network'); setLoading(false);
    });
    return () => token.controller.abort();
  }, [scope, revision, context, session, canRead, matchesSession]);
  const denied = error === 'denied' || !canRead || !matchesSession;
  const clock = (value: string) => <time dateTime={value}>{new Date(value).toLocaleString(locale, { hour12: false })}</time>;
  const counts = (value?: Counts) => value && <dl className="qms-services-counts">{Object.entries(value).map(([key, count]) => <div key={key}><dt>{text(...countLabels[key as keyof Counts])}</dt><dd>{count.toLocaleString(locale)}</dd></div>)}</dl>;
  const canReadOutbox = context.modules.some(module => module.key === 'outbox' && module.scope === 'TARGET' && module.organizationId === context.targetOrganization.id && module.permissions.includes('outbox:read'));
  return <div className="qms-service-operations" aria-busy={loading}>
    <header className="qms-services-heading"><div><h2>{text('运行服务事实', 'Service operation facts')}</h2><p>{text('配置、执行结果和采集状态分别展示，不代表实时在线或全系统健康。', 'Configuration, execution results and collection states are separate, not live availability or overall system health.')}</p></div>
      {!denied && <Button icon={<RefreshCw size={16} aria-hidden="true" />} onClick={restart} aria-label={error === 'network' ? text('重试读取', 'Retry reading') : text('刷新运行服务事实', 'Refresh service operation facts')}>{error === 'network' ? text('重试读取', 'Retry reading') : text('刷新', 'Refresh')}</Button>}</header>
    {denied ? <div className="qms-console-state"><Alert role="alert" showIcon type="error" title={text('运行服务访问已失效或无权限，请重新核验。', 'Service operation access expired or denied. Verify authorization again.')} /><Button onClick={refresh}>{text('重新核验权限', 'Verify authorization again')}</Button></div> : <>
      <div className="qms-services-scope"><strong>{context.targetOrganization.name} ({context.targetOrganization.code})</strong><span>{scope === 'PLATFORM' ? text('目标组织事实及平台执行回执', 'Target organization facts and platform execution receipts') : text('当前目标组织', 'Current target organization')}</span>
        {context.hasPlatformAdministrator && <label><span>{text('观测范围', 'Observation scope')}</span><Select aria-label={text('观测范围', 'Observation scope')} value={scope} options={[
          { value: 'ORGANIZATION', label: text('当前目标组织', 'Current target organization') }, { value: 'PLATFORM', label: text('平台执行回执', 'Platform execution receipts') },
        ]} onChange={value => { active.current?.controller.abort(); setData(undefined); setScope(value); }} /></label>}</div>
      {error === 'network' && <Alert role="alert" type="error" showIcon title={text('运行服务事实读取失败，请重试。', 'Service operation facts could not be read. Retry.')} />}
      {loading && <div role="status" aria-label={text('读取运行服务事实中', 'Reading service operation facts')}><Skeleton active paragraph={{ rows: 5 }} /></div>}
      {data && <><div className="qms-services-time"><Clock3 size={15} aria-hidden="true" /><span>{text('服务器查询时间：', 'Server query time: ')}{clock(data.asOf)}</span></div>
        {!data.sources.length ? <div className="qms-services-empty"><strong>{text('当前没有可展示的服务事实', 'No service facts are available')}</strong><p>{text('没有事实不代表没有任务或服务正常。', 'No facts do not mean no tasks or normally operating services.')}</p></div> : <div className="qms-services-grid">{data.sources.map(source => <section key={source.key} className="qms-services-source" aria-label={text(...labels[source.key])}>
          <header><h3>{text(...labels[source.key])}</h3><Tag color={source.status === 'UNAVAILABLE' || source.status === 'STALE' ? 'warning' : undefined}>{text(...statuses[source.status])}</Tag></header>
          <p className="qms-services-note">{text('来源查询：', 'Source query: ')}{clock(source.asOf)}</p>
          {source.key === 'worker' && <p className="qms-services-note">{text('计数为最近周期快照，不是累计吞吐；耗时自本进程启动，不是单轮耗时。', 'Counts are the latest cycle snapshot, not cumulative throughput; duration is since this process started, not one cycle.')}</p>}
          {source.key === 'pdf' && <p className="qms-services-note">{text('PDF 为按请求线程渲染，不是常驻队列；渲染结果不代表最终业务请求成功。', 'PDF uses per-request rendering threads, not a persistent queue; rendering results do not establish final business request success.')}</p>}
          {source.configured !== undefined && <p className="qms-services-config">{source.configured ? text('配置满足', 'Configuration satisfied') : text('配置未满足', 'Configuration incomplete')}<span>{text('（不表示实际可用）', ' (not proof of availability)')}</span></p>}
          {source.scannerConfigured !== undefined && <p className="qms-services-note">{text('扫描配置：', 'Scanner configuration: ')}{source.scannerConfigured ? text('已配置', 'Configured') : text('未满足', 'Incomplete')}</p>}
          {source.storageConfigured !== undefined && <p className="qms-services-note">{text('对象存储配置：', 'Storage configuration: ')}{source.storageConfigured ? text('已配置', 'Configured') : text('未满足', 'Incomplete')}</p>}
          {source.reasonCode && <p className="qms-services-reason">{text(...reasons[source.reasonCode])}</p>}
          {counts(source.counts)}
          {source.results?.length ? <ul className="qms-services-results">{source.results.map((row, index) => <li key={`${row.domainCode ?? ''}:${row.observedAt}:${index}`}><div><strong>{text(...resultStatuses[row.status])}</strong>{row.domainCode && <span>{text(...domainLabels[row.domainCode]!)}</span>}{row.durationMs != null && <span>{row.durationMs.toLocaleString(locale)} ms</span>}</div>
            <p className="qms-services-note">{text('执行观测：', 'Observed execution: ')}{clock(row.observedAt)}</p>
            {row.startedAt && <p className="qms-services-note">{text('开始：', 'Started: ')}{clock(row.startedAt)}{row.completedAt && <>{text('；完成：', '; completed: ')}{clock(row.completedAt)}</>}</p>}
            {row.reasonCode && <p className="qms-services-reason">{row.reasonCode === 'PDF_RENDER_FAILED' ? text('渲染未成功', 'Rendering did not succeed') : text('Worker 执行未成功', 'Worker execution did not succeed')}</p>}{counts(row.counts)}</li>)}</ul> : null}
          {source.key === 'outbox' && canReadOutbox && <Link to={`/console/outbox?${new URLSearchParams({ organizationId: context.targetOrganization.id })}`}>{text('查看失败队列', 'View failed events')}</Link>}
        </section>)}</div>}
      </>}
    </>}
  </div>;
}
