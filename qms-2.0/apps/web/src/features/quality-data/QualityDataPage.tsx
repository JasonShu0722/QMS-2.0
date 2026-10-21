import type { components } from '@qms/contracts';
import { Alert, Button, Descriptions, Drawer, Empty, Select, Spin, Table, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest, safeAccountError } from '../../api/client';
import './quality-data.css';

type Metric = components['schemas']['MetricDefinitionDto'];
type Fact = components['schemas']['MetricFactDto'];
type Drilldown = components['schemas']['QualityFactDrilldownDto'];
type Dashboard = components['schemas']['QualityDashboardDto'];
type Insight = components['schemas']['QualityInsightDto'];

function isDenied(cause: unknown) {
  return cause instanceof ApiError && (cause.status === 403 || cause.code === 'FEATURE_PERMISSION_DENIED' || cause.code === 'ORGANIZATION_SCOPE_DENIED');
}

function drilldownError(cause: unknown) {
  if (cause instanceof ApiError && cause.code === 'QUALITY_METRIC_VERSION_STALE') return '指标口径已变化，请刷新后查看。';
  if (cause instanceof ApiError && cause.code === 'QUALITY_SOURCE_NOT_VERIFIED') return '来源快照尚未核实，当前无法下钻。';
  return cause instanceof ApiError ? safeAccountError(cause) : '明细加载失败，请重试。';
}

function formatRatio(value: number) {
  return Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: 4 }) : '—';
}

function formatMetric(value: unknown, unit: string) {
  if (value == null || typeof value === 'string' && !value.trim() || !Number.isFinite(Number(value))) return '—';
  return unit === '%' ? `${formatRatio(Number(value) * 100)}%` : `${formatRatio(Number(value))} ${unit?.trim() || '未配置单位'}`;
}

const signalLabels = { GREEN: '绿灯', YELLOW: '黄灯', RED: '红灯', NO_DATA: '未配置阈值' } as const;

function TrendChart({ facts }: { facts: Fact[] }) {
  const points = [...facts].reverse();
  const values = points.map((fact) => fact.value).filter(Number.isFinite);
  if (values.length < 2) return null;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const path = points.map((fact, index) => {
    const horizontal = 24 + index * 552 / (points.length - 1);
    const vertical = 184 - (fact.value - minimum) / range * 152;
    return `${horizontal},${vertical}`;
  }).join(' ');
  return <figure className="quality-data-chart">
    <svg viewBox="0 0 600 216" role="img" aria-label={`原始比值趋势，共 ${points.length} 个统计期间；明细见下方表格`} preserveAspectRatio="xMidYMid meet">
      <line x1="24" x2="576" y1="184" y2="184" className="quality-data-chart-axis" />
      <polyline points={path} className="quality-data-chart-line" />
      {points.map((fact, index) => <circle key={fact.id} cx={24 + index * 552 / (points.length - 1)} cy={184 - (fact.value - minimum) / range * 152} r="4" className="quality-data-chart-point" />)}
      <text x="24" y="205">{new Date(points[0]!.periodStart).toLocaleDateString('zh-CN')}</text>
      <text x="576" y="205" textAnchor="end">{new Date(points.at(-1)!.periodStart).toLocaleDateString('zh-CN')}</text>
    </svg>
    <figcaption>趋势展示原始分子 / 分母比值；单位换算规则尚未配置。下方表格提供相同数据。</figcaption>
  </figure>;
}

export function QualityDataPage() {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [facts, setFacts] = useState<Fact[]>([]);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [loadingFacts, setLoadingFacts] = useState(false);
  const [metricError, setMetricError] = useState<unknown>();
  const [trendError, setTrendError] = useState<unknown>();
  const [trendLoaded, setTrendLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [drillFact, setDrillFact] = useState<Fact>();
  const [drilldown, setDrilldown] = useState<Drilldown>();
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<unknown>();
  const [dashboard, setDashboard] = useState<Dashboard>();
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<unknown>();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightsError, setInsightsError] = useState<unknown>();
  const [exporting, setExporting] = useState<'xlsx' | 'pdf'>();
  const selected = useMemo(() => metrics.find((metric) => metric.id === selectedId), [metrics, selectedId]);

  useEffect(() => { setDrillFact(undefined); setDrilldown(undefined); setDrillError(undefined); }, [selectedId, revision]);

  useEffect(() => {
    if (!drillFact || !selected) return;
    let active = true;
    setDrillLoading(true);
    setDrilldown(undefined);
    setDrillError(undefined);
    const query = new URLSearchParams({ expectedMetricVersion: String(selected.version) });
    void Promise.resolve(apiRequest<Drilldown>(`/api/v1/quality-data/facts/${encodeURIComponent(drillFact.id)}/drilldown?${query}`)).then((result) => {
      if (active) setDrilldown(result);
    }).catch((cause) => {
      if (active) setDrillError(cause);
    }).finally(() => { if (active) setDrillLoading(false); });
    return () => { active = false; };
  }, [drillFact, selected]);

  useEffect(() => {
    let active = true;
    setLoadingMetrics(true);
    setMetricError(undefined);
    void apiRequest<Metric[]>('/api/v1/quality-data/metrics').then((result) => {
      if (!active) return;
      setMetrics(result);
      setSelectedId((current) => result.some((metric) => metric.id === current) ? current : result.find((metric) => metric.active)?.id ?? result[0]?.id);
    }).catch((cause) => {
      if (!active) return;
      setMetrics([]);
      setSelectedId(undefined);
      setMetricError(cause);
    }).finally(() => { if (active) setLoadingMetrics(false); });
    return () => { active = false; };
  }, [revision]);

  useEffect(() => {
    if (!selectedId || metricError) { setFacts([]); return; }
    let active = true;
    setFacts([]);
    setLoadingFacts(true);
    setTrendLoaded(false);
    setTrendError(undefined);
    const query = new URLSearchParams({ metricDefinitionId: selectedId, limit: '50' });
    void Promise.resolve(apiRequest<Fact[]>(`/api/v1/quality-data/trend?${query}`)).then((result) => {
      if (active) setFacts(result);
    }).catch((cause) => {
      if (!active) return;
      setTrendError(cause);
    }).finally(() => { if (active) { setLoadingFacts(false); setTrendLoaded(true); } });
    return () => { active = false; };
  }, [selectedId, revision, metricError]);

  useEffect(() => {
    if (!selectedId || loadingFacts || !trendLoaded) return;
    let active = true;
    setDashboardLoading(true);
    setDashboardError(undefined);
    void fetch('/api/v1/quality-data/dashboard?limit=100', { credentials: 'include' }).then(async (response) => {
      if (!response.ok) throw new Error('dashboard failed');
      return response.json() as Promise<Dashboard>;
    }).then((result) => {
      if (active && result && Array.isArray(result.domains) && Array.isArray(result.cards)) setDashboard(result);
    }).catch((cause) => { if (active) setDashboardError(cause); }).finally(() => { if (active) setDashboardLoading(false); });
    return () => { active = false; };
  }, [revision, selectedId, loadingFacts, trendLoaded]);

  useEffect(() => {
    if (!selectedId || metricError) { setInsights([]); return; }
    let active = true;
    setInsightsError(undefined);
    void Promise.resolve(apiRequest<Insight[]>(`/api/v1/quality-data/insights?metricDefinitionId=${encodeURIComponent(selectedId)}&limit=50`)).then((result) => { if (active) setInsights(Array.isArray(result) ? result : []); }).catch((cause) => { if (active) setInsightsError(cause); });
    return () => { active = false; };
  }, [selectedId, revision, metricError]);

  async function exportReport(format: 'xlsx' | 'pdf') {
    setExporting(format);
    try {
      const response = await fetch(`/api/v1/quality-data/management-report/export/${format}?limit=500`, { credentials: 'include' });
      if (!response.ok) throw new Error('export failed');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `qms-quality-management-${new Date().toISOString().slice(0, 10)}.${format}`; anchor.click(); URL.revokeObjectURL(url);
    } catch (cause) { setDashboardError(cause); } finally { setExporting(undefined); }
  }

  return <section className="quality-data-page">
    <header className="quality-data-heading">
      <div><Typography.Text type="secondary">质量数据</Typography.Text><Typography.Title level={1}>质量指标趋势</Typography.Title><Typography.Paragraph type="secondary">查看指标来源、统计期间和已配置阈值的预警结果。未配置阈值的指标不判定红绿灯。</Typography.Paragraph></div>
      <Button onClick={() => setRevision((value) => value + 1)} loading={loadingMetrics || loadingFacts}>刷新</Button>
    </header>
    {metricError ? <Alert type={isDenied(metricError) ? 'warning' : 'error'} showIcon title={isDenied(metricError) ? '暂无质量指标访问权限' : metricError instanceof ApiError ? safeAccountError(metricError) : '指标定义加载失败，请重试。'} description={metricError instanceof ApiError ? metricError.traceId : undefined} action={isDenied(metricError) ? undefined : <Button onClick={() => setRevision((value) => value + 1)}>重试</Button>} /> : null}
    <section className="quality-data-card" aria-label="指标筛选">
      <label className="quality-data-label" htmlFor="quality-data-metric">指标</label>
      <Select id="quality-data-metric" aria-label="选择质量指标" className="quality-data-select" value={selectedId} onChange={setSelectedId} disabled={loadingMetrics || Boolean(metricError) || metrics.length === 0} options={metrics.map((metric) => ({ label: `${metric.name} (${metric.code})${metric.active ? '' : ' · 已停用'}`, value: metric.id }))} placeholder="选择指标" />
      {loadingMetrics ? <div className="quality-data-loading"><Spin /></div> : !metricError && metrics.length === 0 ? <Empty description="暂无指标定义" /> : null}
      {selected ? <dl className="quality-data-definition"><div><dt>指标代码</dt><dd>{selected.code}</dd></div><div><dt>定义单位</dt><dd>{selected.unit?.trim() || '未配置单位'}</dd></div><div><dt>计算口径</dt><dd>{selected.numeratorLabel} / {selected.denominatorLabel}</dd></div><div><dt>口径版本</dt><dd>{selected.formulaVersion}</dd></div><div><dt>阈值方向</dt><dd>{selected.resolvedThresholdDirection === 'LTE' ? '越低越好' : '越高越好'}</dd></div><div><dt>达标 / 预警阈值</dt><dd>{selected.resolvedGreenThreshold == null || selected.resolvedYellowThreshold == null ? '未配置' : `${formatMetric(selected.resolvedGreenThreshold, selected.unit)} / ${formatMetric(selected.resolvedYellowThreshold, selected.unit)}`}</dd></div></dl> : null}
    </section>
    <section className="quality-data-card qms-display-card" aria-label="四域综合看板">
      <div className="quality-data-section-heading"><div><Typography.Title level={2}>四域综合看板</Typography.Title><Typography.Text type="secondary">跨供应商、制程、客户和新品指标；未核实来源只显示状态，不参与数值汇总。</Typography.Text></div><div className="qms-dialog-actions" role="group" aria-label="四域综合看板"><Button loading={exporting === 'xlsx'} onClick={() => void exportReport('xlsx')}>下载 Excel</Button><Button loading={exporting === 'pdf'} onClick={() => void exportReport('pdf')}>下载 PDF</Button></div></div>
      {dashboardError ? <Alert type="error" showIcon title="综合看板加载失败，请重试。" action={<Button onClick={() => setRevision((value) => value + 1)}>重试</Button>} /> : dashboardLoading ? <div className="quality-data-loading"><Spin /></div> : dashboard ? <>
        <div className="quality-data-domain-grid">{dashboard.domains.map((domain) => <div className="quality-data-domain" key={domain.domain}><Typography.Text type="secondary">{domain.label}</Typography.Text><strong>{domain.factCount} / {domain.metricCount}</strong><span>有事实 / 指标</span></div>)}</div>
        {dashboard.cards.length ? <Table rowKey={(card) => `${card.domain}-${card.metricCode}`} dataSource={dashboard.cards} pagination={false} scroll={{ x: 1000 }} columns={[{ title: '领域', dataIndex: 'domain' }, { title: '指标', dataIndex: 'metricName', render: (value, card) => `${value} (${card.metricCode})` }, { title: '来源状态', dataIndex: 'status' }, { title: '阈值状态', key: 'signal', render: (_, card) => <Tag color={card.signal === 'RED' ? 'error' : card.signal === 'YELLOW' ? 'warning' : card.signal === 'GREEN' ? 'success' : 'default'}>{signalLabels[card.signal ?? 'NO_DATA']}</Tag> }, { title: '最新值', dataIndex: 'latestValue', render: (value, card) => formatMetric(value, card.unit) }, { title: '异常期间', key: 'abnormal', render: (_, card) => card.consecutiveRedPeriods ? `连续红灯 ${card.consecutiveRedPeriods} 期` : card.abnormalPeriods ? `${card.abnormalPeriods} 期异常` : '—' }, { title: '来源', dataIndex: 'sourceSystem', render: (value) => value ?? '—' }, { title: '统计期间', render: (_, card) => card.periodStart ? `${new Date(String(card.periodStart)).toLocaleDateString('zh-CN')} – ${new Date(String(card.periodEnd)).toLocaleDateString('zh-CN')}` : '—' }]} /> : <Empty description="暂无看板指标" />}
      </> : <Empty description="暂无看板数据" />}
    </section>
    {selected && !metricError ? <section className="quality-data-card qms-display-card" aria-label="指标趋势">
      <div className="quality-data-section-heading"><div><Typography.Title level={2}>期间趋势</Typography.Title><Typography.Text type="secondary">最近最多 50 条事实 · 按统计起始时间排序</Typography.Text></div></div>
      {trendError ? <Alert type={isDenied(trendError) ? 'warning' : 'error'} showIcon title={isDenied(trendError) ? '暂无该指标趋势访问权限' : trendError instanceof ApiError ? safeAccountError(trendError) : '趋势加载失败，请重试。'} description={trendError instanceof ApiError ? trendError.traceId : undefined} action={isDenied(trendError) ? undefined : <Button onClick={() => setRevision((value) => value + 1)}>重试</Button>} /> : null}
      {loadingFacts && facts.length === 0 ? <div className="quality-data-loading"><Spin /></div> : (!trendError || facts.length > 0) ? <>
        {facts.length ? <TrendChart facts={facts} /> : <Empty description="该指标暂无期间事实" />}
        {facts.length ? <Table<Fact> rowKey="id" dataSource={facts} pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 760 }} columns={[
          { title: '统计期间', key: 'period', render: (_, fact) => `${new Date(fact.periodStart).toLocaleDateString('zh-CN')} – ${new Date(fact.periodEnd).toLocaleDateString('zh-CN')}` },
          { title: selected.numeratorLabel, dataIndex: 'numerator' },
          { title: selected.denominatorLabel, dataIndex: 'denominator' },
          { title: '原始比值', dataIndex: 'value', render: (value: number) => formatRatio(value) },
          { title: '来源系统', dataIndex: 'sourceSystem' },
          { title: '来源记录键', dataIndex: 'sourceRecordKey', render: (value: unknown) => typeof value === 'string' && value ? value : '—' },
          { title: '明细', key: 'drilldown', render: (_, fact) => <Button type="link" onClick={() => setDrillFact(fact)} aria-label="查看事实明细">查看明细</Button> },
        ]} /> : null}
      </> : null}
    </section> : null}
    {selected && !metricError ? <section className="quality-data-card qms-display-card" aria-label="辅助分析">
      <div className="quality-data-section-heading"><div><Typography.Title level={2}>辅助分析</Typography.Title><Typography.Text type="secondary">仅基于已核实手工事实生成规则分析，不自动改变业务状态。</Typography.Text></div></div>
      {insightsError ? <Alert type="error" showIcon title="辅助分析加载失败" /> : insights.length ? <div className="quality-data-insight-list">{insights.map((insight) => <div className="quality-data-insight" key={insight.metricDefinitionId}><Typography.Text strong>{insight.metricName} ({insight.metricCode})</Typography.Text><Tag>{insight.signal}</Tag><p>{insight.summary}</p><Typography.Text type="secondary">{insight.evidence.join(' · ')}</Typography.Text></div>)}</div> : <Empty description="暂无辅助分析" />}
    </section> : null}
    <Drawer title="指标事实明细" open={Boolean(drillFact)} onClose={() => setDrillFact(undefined)}>
      {drillLoading ? <Spin /> : null}
      {drillError ? <Alert type={isDenied(drillError) ? 'warning' : 'error'} showIcon title={isDenied(drillError) ? '明细访问权限已失效' : drilldownError(drillError)} /> : null}
      {drilldown && !drillError ? <>
        <Descriptions column={1} size="small" items={[
          { key: 'period', label: '统计期间', children: `${new Date(drilldown.fact.periodStart).toLocaleDateString('zh-CN')} – ${new Date(drilldown.fact.periodEnd).toLocaleDateString('zh-CN')}` },
          { key: 'numerator', label: selected?.numeratorLabel ?? '分子', children: drilldown.fact.numerator },
          { key: 'denominator', label: selected?.denominatorLabel ?? '分母', children: drilldown.fact.denominator },
          { key: 'value', label: '原始比值', children: formatRatio(drilldown.fact.value) },
          { key: 'source', label: '来源系统', children: drilldown.fact.sourceSystem },
          { key: 'record', label: '来源记录键', children: typeof drilldown.fact.sourceRecordKey === 'string' && drilldown.fact.sourceRecordKey ? drilldown.fact.sourceRecordKey : '—' },
        ]} />
        {typeof drilldown.reason === 'string' && drilldown.reason === 'NO_SOURCE_REFERENCE' ? <Empty description="尚无可核实的来源关联" /> : null}
      </> : null}
    </Drawer>
  </section>;
}
