import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from '../../api/client';
import { QualityDataPage } from './QualityDataPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn() };
});

beforeEach(() => { vi.mocked(apiRequest).mockReset(); });

it('renders the four-domain dashboard from the scoped dashboard endpoint', async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce([{ id: 'metric-1', code: 'FPY', name: '一次合格率', unit: '%', numeratorLabel: '合格数', denominatorLabel: '生产数', formulaVersion: 'v1', active: true, version: 1 }])
    .mockResolvedValueOnce([]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ domains: [{ domain: 'SUPPLIER', label: '供应商', factCount: 1, metricCount: 1 }, { domain: 'PROCESS', label: '制程', factCount: 0, metricCount: 0 }, { domain: 'CUSTOMER', label: '客户', factCount: 0, metricCount: 0 }, { domain: 'NEW_PRODUCT', label: '新品', factCount: 0, metricCount: 0 }], cards: [{ domain: 'SUPPLIER', metricCode: 'FPY', metricName: '一次合格率', unit: '%', status: 'MANUAL', latestValue: 0.95, numerator: 95, denominator: 100, sourceSystem: 'MANUAL', sourceRecordKey: 'batch-1', periodStart: '2026-09-01T00:00:00Z', periodEnd: '2026-10-01T00:00:00Z', signal: 'RED', abnormalPeriods: 2, consecutiveRedPeriods: 2, alert: true }], metrics: [], latestFacts: [], generatedAt: '2026-09-26T00:00:00Z', from: null, to: null }) }));
  render(<QualityDataPage />);
  const dashboard = screen.getByRole('region', { name: '四域综合看板' });
  expect(await within(dashboard).findByText('供应商')).toBeVisible();
  expect(within(dashboard).getByText('一次合格率 (FPY)')).toBeVisible();
  expect(within(dashboard).getByText('红灯')).toBeVisible();
  expect(within(dashboard).getByText('95%')).toBeVisible();
  expect(within(dashboard).getByText('连续红灯 2 期')).toBeVisible();
  expect(fetch).toHaveBeenCalledWith('/api/v1/quality-data/dashboard?limit=100', { credentials: 'include' });
  vi.unstubAllGlobals();
});

it('distinguishes a real zero from missing values and identifies a missing unit', async () => {
  vi.mocked(apiRequest).mockImplementation((path) => Promise.resolve(String(path).endsWith('/metrics') ? [{ id: 'metric-zero', code: 'ZERO', name: '零值指标', unit: '', numeratorLabel: '分子', denominatorLabel: '分母', formulaVersion: 'v1', active: true, version: 1 }] : []));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    domains: [], cards: [
      { domain: 'PROCESS', metricCode: 'ZERO', metricName: '真实零值', unit: '%', latestValue: 0 },
      { domain: 'PROCESS', metricCode: 'NULL', metricName: '缺失数值', unit: '%', latestValue: null },
      { domain: 'PROCESS', metricCode: 'EMPTY', metricName: '无效空文本', unit: '%', latestValue: '' },
    ],
  }) }));
  try {
    render(<QualityDataPage />);
    const dashboard = screen.getByRole('region', { name: '四域综合看板' });
    const zero = (await within(dashboard).findByText('真实零值 (ZERO)')).closest('tr')!;
    expect(within(zero).getByText('0%')).toBeVisible();
    for (const label of ['缺失数值 (NULL)', '无效空文本 (EMPTY)']) {
      const row = within(dashboard).getByText(label).closest('tr')!;
      expect(within(row).queryByText('0%')).not.toBeInTheDocument();
    }
    expect(screen.getByText('未配置单位')).toBeVisible();
  } finally { vi.unstubAllGlobals(); }
});

it('shows metric definition and source-backed trend values', async () => {
  const trendFacts = [{ id: 'fact-1', metricDefinitionId: 'metric-1', periodStart: '2026-09-01T00:00:00Z', periodEnd: '2026-09-30T00:00:00Z', numerator: 95, denominator: 100, value: 0.95, sourceSystem: 'MES', sourceRecordKey: 'batch-1' }];
  let resolveTrend!: (facts: typeof trendFacts) => void;
  const trendResponse = new Promise<typeof trendFacts>((resolve) => { resolveTrend = resolve; });
  vi.mocked(apiRequest).mockImplementation((path) => {
    const requestPath = String(path);
    if (requestPath === '/api/v1/quality-data/metrics') return Promise.resolve([{ id: 'metric-1', code: 'FPY', name: '一次合格率', unit: '%', numeratorLabel: '合格数', denominatorLabel: '生产数', formulaVersion: 'v1', active: true, version: 1 }]);
    if (requestPath.startsWith('/api/v1/quality-data/trend')) return trendResponse;
    if (requestPath.startsWith('/api/v1/quality-data/insights')) return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
  render(<QualityDataPage />);
  expect(await screen.findByText('一次合格率 (FPY)')).toBeVisible();
  const trend = await screen.findByRole('region', { name: '指标趋势' });
  expect(trend).toBeVisible();
  expect(within(trend).queryByText('0.95')).not.toBeInTheDocument();
  resolveTrend(trendFacts);
  expect(await within(trend).findByText('0.95')).toBeVisible();
  expect(within(trend).getByText('MES')).toBeVisible();
  expect(within(trend).getByText('batch-1')).toBeVisible();
  expect(apiRequest).toHaveBeenCalledWith('/api/v1/quality-data/metrics');
  expect(apiRequest).toHaveBeenCalledWith('/api/v1/quality-data/trend?metricDefinitionId=metric-1&limit=50');
});

it('distinguishes failed metric loading from an empty definition list', async () => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('offline'));
  render(<QualityDataPage />);
  expect(await screen.findByText('指标定义加载失败，请重试。')).toBeVisible();
  expect(screen.queryByText('暂无指标定义')).not.toBeInTheDocument();
  expect(apiRequest).toHaveBeenCalledTimes(1);
});

it('shows trend failure without presenting it as zero data', async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce([{ id: 'metric-1', code: 'FPY', name: '一次合格率', unit: '%', numeratorLabel: '合格数', denominatorLabel: '生产数', formulaVersion: 'v1', active: true, version: 1 }])
    .mockRejectedValueOnce(new Error('offline'));
  render(<QualityDataPage />);
  expect(await screen.findByText('趋势加载失败，请重试。')).toBeVisible();
  expect(screen.queryByText('该指标暂无期间事实')).not.toBeInTheDocument();
});

it('opens a fact drilldown and explains when no verified source exists', async () => {
  vi.mocked(apiRequest).mockImplementation((path) => {
    const requestPath = String(path);
    if (requestPath === '/api/v1/quality-data/metrics') return Promise.resolve([{ id: 'metric-1', code: 'FPY', name: '一次合格率', unit: '%', numeratorLabel: '合格数', denominatorLabel: '生产数', formulaVersion: 'v1', active: true, version: 1 }]);
    if (requestPath.startsWith('/api/v1/quality-data/trend')) return Promise.resolve([{ id: 'fact-1', metricDefinitionId: 'metric-1', periodStart: '2026-09-01T00:00:00Z', periodEnd: '2026-09-30T00:00:00Z', numerator: 95, denominator: 100, value: 0.95, sourceSystem: 'MANUAL', sourceRecordKey: 'manual-1' }]);
    if (requestPath.startsWith('/api/v1/quality-data/insights')) return Promise.resolve([]);
    if (requestPath.includes('/drilldown')) return Promise.resolve({ fact: { id: 'fact-1', metricDefinitionId: 'metric-1', periodStart: '2026-09-01T00:00:00Z', periodEnd: '2026-09-30T00:00:00Z', numerator: 95, denominator: 100, value: 0.95, sourceSystem: 'MANUAL', sourceRecordKey: 'manual-1' }, snapshot: null, reason: 'NO_SOURCE_REFERENCE' });
    return Promise.resolve(undefined);
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ domains: [], cards: [], metrics: [], latestFacts: [], generatedAt: '2026-09-26T00:00:00Z', from: null, to: null }) }));
  render(<QualityDataPage />);
  expect(await screen.findByText('manual-1')).toBeVisible();
  fireEvent.click(await screen.findByRole('button', { name: '查看事实明细' }));
  expect(await screen.findByText('尚无可核实的来源关联')).toBeVisible();
  expect(apiRequest).toHaveBeenCalledWith('/api/v1/quality-data/facts/fact-1/drilldown?expectedMetricVersion=1');
});

it('explains a stale metric version without showing old detail', async () => {
  vi.mocked(apiRequest).mockImplementation((path) => {
    const requestPath = String(path);
    if (requestPath === '/api/v1/quality-data/metrics') return Promise.resolve([{ id: 'metric-1', code: 'FPY', name: '一次合格率', unit: '%', numeratorLabel: '合格数', denominatorLabel: '生产数', formulaVersion: 'v1', active: true, version: 1 }]);
    if (requestPath.startsWith('/api/v1/quality-data/trend')) return Promise.resolve([{ id: 'fact-1', metricDefinitionId: 'metric-1', periodStart: '2026-09-01T00:00:00Z', periodEnd: '2026-09-30T00:00:00Z', numerator: 95, denominator: 100, value: 0.95, sourceSystem: 'MANUAL' }]);
    if (requestPath.startsWith('/api/v1/quality-data/insights')) return Promise.resolve([]);
    if (requestPath.includes('/drilldown')) return Promise.reject(new ApiError({ code: 'QUALITY_METRIC_VERSION_STALE', message: '指标口径版本已变化' }, 409));
    return Promise.resolve(undefined);
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ domains: [], cards: [], metrics: [], latestFacts: [], generatedAt: '2026-09-26T00:00:00Z', from: null, to: null }) }));
  render(<QualityDataPage />);
  expect(await screen.findByText('一次合格率 (FPY)')).toBeVisible();
  fireEvent.click(await screen.findByRole('button', { name: '查看事实明细' }));
  expect(await screen.findByText('指标口径已变化，请刷新后查看。')).toBeVisible();
  expect(screen.queryByText('尚无可核实的来源关联')).not.toBeInTheDocument();
  vi.unstubAllGlobals();
});

it('does not display a previous metric fact under a newly selected metric after failure', async () => {
  const metric = { id: 'metric-1', code: 'A', name: '指标甲', unit: '%', numeratorLabel: '甲分子', denominatorLabel: '甲分母', formulaVersion: 'v1', active: true, version: 1 };
  vi.mocked(apiRequest).mockImplementation(async (url) => {
    if (url.endsWith('/metrics')) return [metric, { ...metric, id: 'metric-2', code: 'B', name: '指标乙', numeratorLabel: '乙分子' }];
    if (url.includes('/trend?') && url.includes('metric-1')) return [{ id: 'fact-A', metricDefinitionId: 'metric-1', periodStart: '2026-09-01', periodEnd: '2026-09-30', numerator: 95, denominator: 100, value: 0.95, sourceSystem: 'MANUAL', sourceRecordKey: 'A-only' }];
    if (url.includes('/trend?')) throw new Error('offline');
    return [];
  });
  render(<QualityDataPage />);
  await screen.findByText('A-only');
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '选择质量指标' }));
  fireEvent.click(await screen.findByText('指标乙 (B)'));
  await screen.findByText('趋势加载失败，请重试。');
  await waitFor(() => expect(screen.queryByText('A-only')).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: '查看事实明细' })).not.toBeInTheDocument();
});

it('clears old facts when refreshing the catalog automatically selects another metric', async () => {
  const metric = { id: 'metric-A', code: 'A', name: '指标甲', unit: '%', numeratorLabel: '甲分子', denominatorLabel: '甲分母', formulaVersion: 'v1', active: true, version: 1 };
  let catalogs = 0;
  vi.mocked(apiRequest).mockImplementation(async (url) => {
    if (url.endsWith('/metrics')) return [++catalogs === 1 ? metric : { ...metric, id: 'metric-B', code: 'B', name: '指标乙' }];
    if (url.includes('/trend?') && url.includes('metric-A')) return [{ id: 'fact-A', metricDefinitionId: 'metric-A', periodStart: '2026-09-01', periodEnd: '2026-09-30', numerator: 95, denominator: 100, value: 0.95, sourceSystem: 'MANUAL', sourceRecordKey: 'A-only' }];
    if (url.includes('/trend?')) throw new Error('offline');
    return [];
  });
  render(<QualityDataPage />);
  await screen.findByText('A-only');
  fireEvent.click(screen.getByRole('button', { name: /^刷\s*新$/ }));
  await screen.findByText('指标乙 (B)');
  await screen.findByText('趋势加载失败，请重试。');
  expect(screen.queryByText('A-only')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '查看事实明细' })).not.toBeInTheDocument();
});
