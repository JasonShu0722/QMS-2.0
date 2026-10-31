import { Alert, Button, Input, Modal, Select, Skeleton, Tag, type TableProps } from 'antd';
import { LedgerTable, useLedgerPageSize } from '../ui/ledger';
import { Clock3, RefreshCw } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { components, operations } from '@qms/contracts';
import { ApiError, apiRequest } from '../api/client';
import { subscribeSessionSignals } from '../features/auth/session-invalidation';
import { useLanguage } from '../i18n/Language';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { useConsoleContext } from './ConsoleLayout';
import type { ConsoleContext } from './console-navigation';
import './data-exchanges.css';

type Page = components['schemas']['DataExchangePageDto'];
type Attempt = components['schemas']['DataExchangeAttemptDto'];
type Stage = keyof Attempt['stages'];
type Outcome = Attempt['stages'][Stage]['outcome'];
type Query = NonNullable<operations['DataExchangeObservationController_list']['parameters']['query']>;
type Filters = Pick<Query, 'sourceKey' | 'direction' | 'objectType' | 'level' | 'stage' | 'outcome'> & { scope: Page['scope']; period: '24' | '168' | '720'; batchId: string; page: number };
type ReadToken = { controller: AbortController; pending: boolean; recheck: boolean };
const defaults: Filters = { scope: 'ORGANIZATION', period: '24', batchId: '', page: 1 };
const stages: Stage[] = ['transfer', 'validation', 'processing', 'reconciliation'];
const outcomes: Outcome[] = ['NOT_REPORTED', 'PENDING', 'UNKNOWN', 'SUCCEEDED', 'FAILED'];
const opaque = /^[A-Za-z0-9_.:-]{1,80}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function identity(context: ConsoleContext) {
  const organization = (value: ConsoleContext['targetOrganization']) => [value.id, value.type, value.status, value.configurationRequired];
  return JSON.stringify([context.actor.id, context.actor.accountType, organization(context.actor.homeOrganization), organization(context.targetOrganization), context.hasPlatformAdministrator,
    context.modules.map(module => [module.key, module.scope, module.coverage, module.organizationId, [...module.permissions].sort()]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
}

export function DataExchangePage() {
  const { context, refresh, invalidate } = useConsoleContext();
  const session = useWorkTabsStore(state => state.sessionScope);
  return <ExchangeScope key={JSON.stringify([session, identity(context)])} context={context} session={session} refresh={refresh} invalidate={invalidate} />;
}

function ExchangeScope({ context, session, refresh, invalidate }: { context: ConsoleContext; session?: string; refresh: () => void; invalidate: () => void }) {
  const [pageSize, setPageSize] = useLedgerPageSize('console-data-exchanges', context.targetOrganization.id);
  const { locale } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const id = useId();
  const canRead = context.actor.accountType === 'INTERNAL' && context.targetOrganization.status === 'ACTIVE' && !context.targetOrganization.configurationRequired
    && context.modules.some(module => module.key === 'data-exchanges' && module.scope === 'TARGET' && module.coverage === 'ORGANIZATION'
      && module.organizationId === context.targetOrganization.id && module.permissions.includes('console:exchanges:read'));
  const matchesSession = session === `INTERNAL:${context.actor.homeOrganization.id}:${context.actor.id}`;
  const [filters, setFilters] = useState<Filters>(defaults);
  const [draft, setDraft] = useState<Filters>(defaults);
  const [validation, setValidation] = useState(false);
  const [data, setData] = useState<Page>();
  const [error, setError] = useState<'denied' | 'network'>();
  const [loading, setLoading] = useState(canRead && matchesSession);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<{ row: Attempt }>();
  const [detail, setDetail] = useState<Attempt>();
  const [detailError, setDetailError] = useState(false);
  const active = useRef<ReadToken | undefined>(undefined);
  const activeDetail = useRef<ReadToken | undefined>(undefined);
  const revoked = useRef(false);
  const invalidator = useRef(invalidate); invalidator.current = invalidate;
  const range = useMemo(() => {
    const to = Date.now();
    // Retention is checked when the server receives the query, so reserve minute headroom.
    const from = Math.floor((to - Number(filters.period) * 3600000) / 60000) * 60000 + 60000;
    return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
  }, [filters.scope, filters.period, filters.sourceKey, filters.direction, filters.objectType, filters.level, filters.stage, filters.outcome, filters.batchId, revision]);
  const dismissDetail = () => {
    activeDetail.current?.controller.abort(); activeDetail.current = undefined;
    setSelected(undefined); setDetail(undefined); setDetailError(false);
  };
  const restart = () => {
    active.current?.controller.abort(); dismissDetail(); setData(undefined); setError(undefined); setLoading(true); setRevision(value => value + 1);
  };
  const deny = () => {
    active.current?.controller.abort(); dismissDetail(); setData(undefined); setError('denied'); setLoading(false);
    if (!revoked.current) { revoked.current = true; invalidator.current(); }
  };
  useEffect(() => {
    const unsubscribe = useWorkTabsStore.subscribe((next, previous) => { if (next.sessionScope !== previous.sessionScope) restart(); });
    const signals = subscribeSessionSignals(signal => {
      if (signal !== 'revalidate') { deny(); return; }
      if (revoked.current) return;
      // Keep a pending rejection owned until the real client has delivered its 401/403.
      if (activeDetail.current?.pending) { activeDetail.current.recheck = true; setData(undefined); setDetail(undefined); setLoading(true); }
      else if (active.current?.pending) { active.current.recheck = true; setData(undefined); setLoading(true); }
      else restart();
    });
    return () => { unsubscribe(); signals(); active.current?.controller.abort(); activeDetail.current?.controller.abort(); };
  }, []);
  const validRow = (row: Attempt, sources: Page['sources'], scope: Page['scope']) => uuid.test(row.id) && uuid.test(row.organizationId)
    && (scope === 'PLATFORM' ? context.hasPlatformAdministrator : row.organizationId === context.targetOrganization.id)
    && sources.some(source => source.key === row.sourceKey) && stages.every(stage => row.stages?.[stage] && outcomes.includes(row.stages[stage].outcome));

  useEffect(() => {
    if (!canRead || !matchesSession || revoked.current) { setData(undefined); setError('denied'); setLoading(false); return; }
    const token: ReadToken = { controller: new AbortController(), pending: true, recheck: false }; active.current = token;
    const current = () => active.current === token && !token.controller.signal.aborted && useWorkTabsStore.getState().sessionScope === session;
    const query = new URLSearchParams({ organizationId: context.targetOrganization.id, scope: filters.scope, ...range, page: String(filters.page), limit: String(pageSize) });
    for (const key of ['sourceKey', 'direction', 'objectType', 'level', 'stage', 'outcome', 'batchId'] as const) if (filters[key]) query.set(key, filters[key]!);
    setData(undefined); setError(undefined); setLoading(true);
    void apiRequest<Page>(`/api/v1/admin/console/data-exchanges?${query}`, { signal: token.controller.signal }).then(result => {
      if (!current()) return;
      token.pending = false;
      if (token.recheck) { restart(); return; }
      if (result.scope !== filters.scope || result.organizationId !== context.targetOrganization.id || !Array.isArray(result.sources) || !Array.isArray(result.items)
        || result.items.some(row => !validRow(row, result.sources, result.scope))) { deny(); return; }
      if (![result.asOf, result.from, result.to].every(value => Number.isFinite(Date.parse(value))) || result.page !== filters.page || result.limit !== pageSize
        || !Number.isSafeInteger(result.total) || result.total < 0 || !Object.values(result.summary).every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) throw new Error('Invalid exchange observation response');
      setData(result); setLoading(false);
    }).catch(cause => {
      if (!current()) return;
      token.pending = false;
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) { deny(); return; }
      if (token.recheck) { restart(); return; }
      setData(undefined); setError('network'); setLoading(false);
    });
    return () => token.controller.abort();
  }, [filters, range, pageSize, session, context, canRead, matchesSession]);

  useEffect(() => {
    if (!selected || !data || !canRead || !matchesSession || revoked.current) return;
    const token: ReadToken = { controller: new AbortController(), pending: true, recheck: false }; activeDetail.current = token;
    const current = () => activeDetail.current === token && !token.controller.signal.aborted && useWorkTabsStore.getState().sessionScope === session;
    const query = new URLSearchParams({ organizationId: context.targetOrganization.id, scope: filters.scope });
    setDetail(undefined); setDetailError(false);
    void apiRequest<Attempt>(`/api/v1/admin/console/data-exchanges/attempts/${selected.row.id}?${query}`, { signal: token.controller.signal }).then(result => {
      if (!current()) return;
      token.pending = false;
      if (token.recheck) { restart(); return; }
      if (result.id !== selected.row.id || result.organizationId !== selected.row.organizationId || result.sourceKey !== selected.row.sourceKey || !validRow(result, data.sources, filters.scope)) { deny(); return; }
      setDetail(result);
    }).catch(cause => {
      if (!current()) return;
      token.pending = false;
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) { deny(); return; }
      if (token.recheck) { restart(); return; }
      setDetail(undefined); setDetailError(true);
    });
    return () => token.controller.abort();
  }, [selected, session, context, canRead, matchesSession, filters.scope]);

  const apply = () => {
    const batchId = draft.batchId.trim();
    if (batchId && !opaque.test(batchId) || !!draft.stage !== !!draft.outcome) { setValidation(true); return; }
    setValidation(false); active.current?.controller.abort(); dismissDetail(); setData(undefined); setFilters({ ...draft, batchId, page: 1 }); setRevision(value => value + 1);
  };
  const changePage = (page: number) => { active.current?.controller.abort(); dismissDetail(); setData(undefined); setFilters(value => ({ ...value, page })); };
  const closeDetail = () => { if (activeDetail.current?.recheck) restart(); else dismissDetail(); };
  const clock = (value: string) => <time dateTime={value}>{new Date(value).toLocaleString(locale, { hour12: false })}</time>;
  const count = (value: number) => value.toLocaleString(locale);
  const stageLabel: Record<Stage, string> = { transfer: text('传输', 'Transfer'), validation: text('校验', 'Validation'), processing: text('业务处理', 'Processing'), reconciliation: text('对账', 'Reconciliation') };
  const outcomeLabel: Record<Outcome, string> = { NOT_REPORTED: text('未报告', 'Not reported'), PENDING: text('待完成', 'Pending'), UNKNOWN: text('未知', 'Unknown'), SUCCEEDED: text('成功', 'Succeeded'), FAILED: text('失败', 'Failed') };
  const badge = (value: Attempt['stages'][Stage]) => <Tag color={value.outcome === 'FAILED' ? 'error' : value.outcome === 'SUCCEEDED' ? 'success' : value.outcome === 'PENDING' ? 'processing' : undefined}>{outcomeLabel[value.outcome]}{value.observedCount !== undefined ? ` · ${count(value.observedCount)}` : ''}</Tag>;
  const description = (row: Attempt) => text(`${row.level === 'BATCH' ? '批次' : '记录'} ${row.level === 'BATCH' ? row.batchId ?? row.correlationId : row.recordId ?? row.correlationId} 第 ${row.attemptNumber} 次尝试`, `${row.level === 'BATCH' ? 'Batch' : 'Record'} ${row.level === 'BATCH' ? row.batchId ?? row.correlationId : row.recordId ?? row.correlationId}, attempt ${row.attemptNumber}`);
  const sourceLabel = (key: string) => data?.sources.find(source => source.key === key)?.label ?? key;
  const columns: TableProps<Attempt>['columns'] = [
    { title: text('来源与方向', 'Source & direction'), key: 'source', width: 170, render: (_, row) => <div>{sourceLabel(row.sourceKey)}<small>{row.direction === 'INBOUND' ? text('接收', 'Inbound') : text('发出', 'Outbound')} · {row.objectType}</small></div> },
    { title: text('批次 / 记录', 'Batch / record'), key: 'record', width: 210, render: (_, row) => <div><strong>{row.level === 'BATCH' ? row.batchId ?? row.correlationId : row.recordId ?? row.correlationId}</strong><small>{row.level === 'BATCH' ? text('批次', 'Batch') : text('记录', 'Record')} · {text(`第 ${row.attemptNumber} 次尝试`, `Attempt ${row.attemptNumber}`)}</small><code>{row.correlationId}</code></div> },
    ...stages.map(stage => ({ title: stageLabel[stage], key: stage, width: 135, render: (_: unknown, row: Attempt) => badge(row.stages[stage]) })),
    { title: text('最近观测', 'Last observed'), key: 'observed', width: 185, render: (_, row) => clock(row.observedAt) },
    { title: text('详情', 'Details'), key: 'details', width: 90, render: (_, row) => <Button size="small" aria-label={text(`查看${description(row)}`, `View ${description(row)}`)} onClick={() => { dismissDetail(); setSelected({ row }); }}>{text('查看', 'View')}</Button> },
  ];
  const denied = error === 'denied' || !canRead || !matchesSession;
  const objectTypes = [...new Set((data?.sources ?? []).filter(source => !draft.sourceKey || source.key === draft.sourceKey).flatMap(source => source.objectTypes))];
  return <div className="qms-exchange-page">
    <header className="qms-exchange-heading"><Button icon={<RefreshCw size={15} />} onClick={denied ? refresh : restart} aria-label={text('刷新交换观测', 'Refresh exchange observations')}>{text('刷新', 'Refresh')}</Button></header>
    <div className="qms-exchange-scope"><strong>{context.targetOrganization.name} ({context.targetOrganization.code})</strong><span>{filters.scope === 'PLATFORM' ? text('平台范围 · 只读观测', 'Platform scope · Read-only observations') : text('目标组织范围 · 只读观测', 'Target organization · Read-only observations')}</span><span>{text('仅保留近 30 天元数据', 'Metadata retained for 30 days')}</span></div>
    {denied ? <Alert role="alert" type="error" showIcon title={text('交换观测访问已失效或无权限', 'Exchange observation access expired or denied')} /> : <>
      <form className="qms-exchange-filters" onSubmit={event => { event.preventDefault(); apply(); }} aria-label={text('交换观测筛选', 'Exchange observation filters')}>
        {context.hasPlatformAdministrator && <label><span>{text('交换范围', 'Exchange scope')}</span><Select aria-label={text('交换范围', 'Exchange scope')} value={filters.scope} options={[{ value: 'ORGANIZATION', label: text('目标组织', 'Target organization') }, { value: 'PLATFORM', label: text('平台交换观测', 'Platform observations') }]} onChange={(scope: Filters['scope']) => { restart(); setDraft({ ...defaults, scope }); setFilters({ ...defaults, scope }); }} /></label>}
        <label><span>{text('查询时段', 'Time window')}</span><Select aria-label={text('查询时段', 'Time window')} value={draft.period} options={[{ value: '24', label: text('近 24 小时', 'Last 24 hours') }, { value: '168', label: text('近 7 天', 'Last 7 days') }, { value: '720', label: text('近 30 天', 'Last 30 days') }]} onChange={(period: Filters['period']) => setDraft(value => ({ ...value, period }))} /></label>
        <label><span>{text('交换来源', 'Exchange source')}</span><Select aria-label={text('交换来源', 'Exchange source')} value={draft.sourceKey ?? ''} options={[{ value: '', label: text('全部来源', 'All sources') }, ...(data?.sources ?? []).map(source => ({ value: source.key, label: source.label }))]} onChange={(sourceKey: string) => setDraft(value => ({ ...value, sourceKey: sourceKey || undefined, objectType: undefined }))} /></label>
        <label><span>{text('交换方向', 'Direction')}</span><Select aria-label={text('交换方向', 'Direction')} value={draft.direction ?? ''} options={[{ value: '', label: text('全部方向', 'All directions') }, { value: 'INBOUND', label: text('接收', 'Inbound') }, { value: 'OUTBOUND', label: text('发出', 'Outbound') }]} onChange={(direction: Query['direction'] | '') => setDraft(value => ({ ...value, direction: direction || undefined }))} /></label>
        <label><span>{text('对象类型', 'Object type')}</span><Select aria-label={text('对象类型', 'Object type')} value={draft.objectType ?? ''} options={[{ value: '', label: text('全部对象', 'All object types') }, ...objectTypes.map(value => ({ value, label: value }))]} onChange={(objectType: string) => setDraft(value => ({ ...value, objectType: objectType || undefined }))} /></label>
        <label><span>{text('记录层级', 'Record level')}</span><Select aria-label={text('记录层级', 'Record level')} value={draft.level ?? ''} options={[{ value: '', label: text('全部层级', 'All levels') }, { value: 'BATCH', label: text('批次', 'Batch') }, { value: 'RECORD', label: text('记录', 'Record') }]} onChange={(level: Query['level'] | '') => setDraft(value => ({ ...value, level: level || undefined }))} /></label>
        <label><span>{text('观测阶段', 'Observed stage')}</span><Select aria-label={text('观测阶段', 'Observed stage')} value={draft.stage ?? ''} options={[{ value: '', label: text('全部阶段', 'All stages') }, ...stages.map(value => ({ value, label: stageLabel[value] }))]} onChange={(stage: Stage | '') => setDraft(value => ({ ...value, stage: stage || undefined }))} /></label>
        <label><span>{text('阶段结果', 'Stage outcome')}</span><Select aria-label={text('阶段结果', 'Stage outcome')} value={draft.outcome ?? ''} options={[{ value: '', label: text('全部结果', 'All outcomes') }, ...outcomes.map(value => ({ value, label: outcomeLabel[value] }))]} onChange={(outcome: Outcome | '') => setDraft(value => ({ ...value, outcome: outcome || undefined }))} /></label>
        <label className="qms-exchange-batch-filter" htmlFor={`${id}-batch`}><span>{text('批次标识', 'Batch identifier')}</span><Input id={`${id}-batch`} aria-label={text('批次标识', 'Batch identifier')} value={draft.batchId} maxLength={80} onChange={event => setDraft(value => ({ ...value, batchId: event.target.value }))} /></label>
        <Button type="primary" htmlType="submit">{text('应用筛选', 'Apply filters')}</Button>
      </form>
      {validation && <Alert type="warning" showIcon title={text('请选择成对的阶段与结果，并使用不含 URL 或查询参数的批次标识。', 'Choose stage and outcome together; use a batch identifier without a URL or query string.')} />}
      {error === 'network' && <Alert role="alert" type="error" showIcon title={text('交换观测读取失败，请重试。', 'Exchange observations could not be read. Retry.')} action={<Button onClick={restart}>{text('重试读取', 'Retry read')}</Button>} />}
      {loading && <div role="status" aria-label={text('读取交换观测中', 'Reading exchange observations')}><Skeleton active paragraph={{ rows: 4 }} /></div>}
      {data && <>
        <div className="qms-exchange-times"><Clock3 size={15} aria-hidden="true" /><span>{text('服务器查询时间：', 'Server query time: ')}{clock(data.asOf)}</span><span>{text('实际查询窗口：', 'Actual query window: ')}{clock(data.from)} — {clock(data.to)}</span></div>
        <Alert type="info" showIcon title={data.connectionStatus === 'NOT_CONNECTED' ? text('尚未接入数据交换来源', 'No data exchange source connected') : text('来源已注册', 'Sources registered')} />
        <Alert type="warning" showIcon title={data.collection.status === 'UNAVAILABLE' ? text('观测采集不可用', 'Observation collection unavailable') : text('采集完整性未知', 'Collection completeness unknown')} />
        <section className="qms-exchange-metrics" aria-label={text('交换摘要', 'Exchange summary')}><dl>
          <div><dt>{text('批次尝试', 'Batch attempts')}</dt><dd>{count(data.summary.batchAttempts)}</dd></div><div><dt>{text('记录尝试', 'Record attempts')}</dt><dd>{count(data.summary.recordAttempts)}</dd></div><div><dt>{text('传输成功批次', 'Transfer-succeeded batches')}</dt><dd>{count(data.summary.transferSucceededBatches)}</dd></div><div><dt>{text('处理失败批次', 'Processing-failed batches')}</dt><dd>{count(data.summary.processingFailedBatches)}</dd></div><div><dt>{text('对账成功批次', 'Reconciled batches')}</dt><dd>{count(data.summary.reconciliationSucceededBatches)}</dd></div>
        </dl></section>
        <section className="qms-exchange-records" aria-label={text('交换尝试记录', 'Exchange attempt records')}><h3>{text('交换尝试记录', 'Exchange attempts')}</h3>
          {!data.items.length ? <div className="qms-exchange-empty"><strong>{text('当前范围没有交换观测记录', 'No exchange observations in this scope')}</strong></div> : <LedgerTable<Attempt> ledgerId="console-data-exchanges" organizationId={context.targetOrganization.id} viewId={filters.scope} requiredColumnKeys={['record', 'details']} size="small" columns={columns} dataSource={data.items} rowKey="id" pagination={false} scroll={{ x: 1200 }} />}
          <div className="qms-exchange-pagination"><span>{text(`共 ${count(data.total)} 个尝试 · 第 ${data.page} 页`, `${count(data.total)} attempts · Page ${data.page}`)}</span><div><Select aria-label={text('每页条数', 'Page size')} value={pageSize} options={[10, 20, 50, 100].map(value => ({ value, label: String(value) }))} disabled={loading} onChange={size => { changePage(1); setPageSize(size); setRevision(value => value + 1); }} /><Button disabled={loading || data.page <= 1} onClick={() => changePage(data.page - 1)}>{text('上一页', 'Previous page')}</Button><Button disabled={loading || data.page >= 10000 || data.page * data.limit >= data.total} onClick={() => changePage(data.page + 1)}>{text('下一页', 'Next page')}</Button></div></div>
        </section>
      </>}
      <Modal title={text('交换尝试详情', 'Exchange attempt details')} open={!!selected} onCancel={closeDetail} footer={<Button onClick={closeDetail}>{text('关闭', 'Close')}</Button>} destroyOnHidden width={720}>
        {selected && (!detail && !detailError ? <div role="status" aria-label={text('读取交换详情中', 'Reading exchange details')}><Skeleton active paragraph={{ rows: 3 }} /></div> : detailError ? <Alert type="error" showIcon title={text('交换详情不可用或已过期，请重新查询。', 'Exchange details are unavailable or expired. Query again.')} /> : detail && <div className="qms-exchange-detail">
          <dl><div><dt>{text('来源', 'Source')}</dt><dd>{sourceLabel(detail.sourceKey)}</dd></div><div><dt>{text('关联标识', 'Correlation')}</dt><dd>{detail.correlationId}</dd></div><div><dt>{text('批次 / 记录', 'Batch / record')}</dt><dd>{detail.batchId ?? '—'}{detail.recordId ? ` / ${detail.recordId}` : ''}</dd></div><div><dt>{text('尝试', 'Attempt')}</dt><dd>{detail.attemptNumber}</dd></div><div><dt>{text('开始时间', 'Started')}</dt><dd>{clock(detail.startedAt)}</dd></div><div><dt>{text('完成时间', 'Completed')}</dt><dd>{detail.finishedAt ? clock(detail.finishedAt) : text('未全部报告终态', 'Not all stages have terminal results')}</dd></div></dl>
          <div className="qms-exchange-stage-list">{stages.map(stage => <section key={stage}><h4>{stageLabel[stage]}</h4>{badge(detail.stages[stage])}{detail.stages[stage].errorCode && <code>{detail.stages[stage].errorCode}</code>}{detail.stages[stage].observedAt && clock(detail.stages[stage].observedAt!)}</section>)}</div>
        </div>)}
      </Modal>
    </>}
  </div>;
}
