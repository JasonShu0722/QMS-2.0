import type { components } from '@qms/contracts';
import { Alert, Button, Card, Checkbox, Empty, Input, Pagination, Select, Space, Table, Tag, Typography, type TableColumnsType } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import {
  createProblemView,
  deleteProblemView,
  getProblemIndex,
  getProblemOrganizationId,
  getProblemViews,
  updateProblemView,
  type ProblemPage,
  type ProblemQuery,
  type ProblemView,
  type ProblemViewConfiguration,
} from './problem-center-api';
import './problem-center.css';

type ProblemItem = components['schemas']['ProblemIndexResponseDto'];
type ProblemFilters = components['schemas']['ProblemSavedViewFiltersDto'];
type ProblemSort = components['schemas']['ProblemSavedViewSortDto'];
type ProblemStatus = NonNullable<ProblemFilters['status']>;
type ColumnKey = ProblemViewConfiguration['visibleColumns'][number];
type ErrorState = { message: string; traceId?: string; code?: string };

const statuses: ProblemStatus[] = ['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'ARCHIVED'];
const sortFields: ProblemSort['sortBy'][] = ['createdAt', 'updatedAt', 'dueAt', 'reportNumber', 'status', 'severity'];
const allColumns: ColumnKey[] = ['reportNumber', 'title', 'domainCode', 'problemType', 'status', 'severity', 'responsibleParty', 'ownerId', 'dueAt', 'updatedAt'];
const defaultConfiguration: ProblemViewConfiguration = {
  schemaVersion: 1,
  filters: {},
  sort: { sortBy: 'updatedAt', sortDirection: 'desc' },
  visibleColumns: [...allColumns],
  columnOrder: [...allColumns],
};
const columnLabels: Record<ColumnKey, string> = {
  reportNumber: '报告编号', title: '标题', domainCode: '领域', problemType: '问题类型', status: '状态', severity: '严重度',
  responsibleParty: '责任方', ownerId: '负责人 ID', dueAt: '截止时间', updatedAt: '更新时间',
};
const statusLabels: Record<ProblemStatus, string> = {
  OPEN: '待处理', IN_PROGRESS: '处理中', PENDING: '等待中', RESOLVED: '已解决', CLOSED: '已关闭', ARCHIVED: '已归档',
};
const sortLabels: Record<ProblemSort['sortBy'], string> = {
  createdAt: '创建时间', updatedAt: '更新时间', dueAt: '截止时间', reportNumber: '报告编号', status: '状态', severity: '严重度',
};

function controlledError(cause: unknown): ErrorState {
  if (!(cause instanceof ApiError)) return { message: '请求失败，请重试' };
  return { message: safeAccountError(cause), traceId: cause.traceId, code: cause.code };
}

function isForbidden(error?: ErrorState) {
  return error?.code === 'FEATURE_PERMISSION_DENIED' || error?.code === 'ORGANIZATION_SCOPE_DENIED' || error?.code === 'HTTP_403';
}

function normalizeFilters(filters: ProblemFilters): ProblemFilters {
  const source = filters as Record<string, unknown>;
  const normalized: ProblemFilters = {};
  const stringKeys: Array<keyof Pick<ProblemFilters, 'domainCode' | 'problemType' | 'severity' | 'ownerId' | 'search' | 'dueFrom' | 'dueTo' | 'overdueAt'>> =
    ['domainCode', 'problemType', 'severity', 'ownerId', 'search', 'dueFrom', 'dueTo', 'overdueAt'];
  stringKeys.forEach((key) => {
    if (typeof source[key] === 'string' && source[key]) normalized[key] = source[key];
  });
  if (statuses.includes(source.status as ProblemStatus)) normalized.status = source.status as ProblemStatus;
  return normalized;
}

function normalizeConfiguration(configuration: ProblemViewConfiguration): ProblemViewConfiguration {
  const visibleColumns = allColumns.filter((column) => configuration.visibleColumns.includes(column));
  const ordered = configuration.columnOrder.filter((column, index, source) => allColumns.includes(column) && source.indexOf(column) === index);
  const columnOrder = [...ordered, ...allColumns.filter((column) => !ordered.includes(column))];
  const sortBy = sortFields.includes(configuration.sort.sortBy) ? configuration.sort.sortBy : defaultConfiguration.sort.sortBy;
  return {
    schemaVersion: 1,
    filters: normalizeFilters(configuration.filters),
    sort: { sortBy, sortDirection: configuration.sort.sortDirection === 'asc' ? 'asc' : 'desc' },
    visibleColumns: visibleColumns.length ? visibleColumns : ['reportNumber'],
    columnOrder,
  };
}

function localDateTime(iso?: string) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function isoDateTime(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function Feedback({ error, t }: { error?: ErrorState; t: (text: string) => string }) {
  if (!error) return null;
  return <Alert role="alert" type="error" showIcon title={t(error.message)} description={error.traceId ? <span>{t('追踪标识')}: <code>{error.traceId}</code></span> : undefined} />;
}

export function ProblemCenterPage() {
  const [searchParams] = useSearchParams();
  const explicitOrganization = searchParams.get('organizationId')?.trim() ?? '';
  return <ProblemCenterScope key={explicitOrganization || 'session-primary-organization'} explicitOrganization={explicitOrganization} />;
}

function ProblemCenterScope({ explicitOrganization }: { explicitOrganization: string }) {
  const { locale, t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const [organizationId, setOrganizationId] = useState<string>();
  const [organizationInput, setOrganizationInput] = useState(explicitOrganization);
  const [organizationError, setOrganizationError] = useState<ErrorState>();
  const [filters, setFilters] = useState<ProblemFilters>({});
  const [appliedFilters, setAppliedFilters] = useState<ProblemFilters>({});
  const [sort, setSort] = useState<ProblemSort>(defaultConfiguration.sort);
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(defaultConfiguration.visibleColumns);
  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(defaultConfiguration.columnOrder);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [result, setResult] = useState<ProblemPage>();
  const [resultError, setResultError] = useState<ErrorState>();
  const [resultLoading, setResultLoading] = useState(false);
  const [views, setViews] = useState<ProblemView[]>([]);
  const [viewTotal, setViewTotal] = useState(0);
  const [viewOffset, setViewOffset] = useState(0);
  const [viewsError, setViewsError] = useState<ErrorState>();
  const [viewsLoading, setViewsLoading] = useState(false);
  const [selectedViewId, setSelectedViewId] = useState('');
  const [viewName, setViewName] = useState('');
  const [mutationError, setMutationError] = useState<ErrorState>();
  const [mutationMessage, setMutationMessage] = useState('');
  const [mutating, setMutating] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const [writeForbidden, setWriteForbidden] = useState(false);
  const primaryOrganization = useRef('');
  const mutationPending = useRef(false);
  const problemResource = useRef('');
  const viewResource = useRef('');
  const viewGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    void getProblemOrganizationId().then((primaryOrganizationId) => {
      if (!active) return;
      primaryOrganization.current = primaryOrganizationId;
      const selected = explicitOrganization || primaryOrganizationId;
      setOrganizationId(selected);
      setOrganizationInput(selected);
    }).catch((cause) => { if (active) setOrganizationError(controlledError(cause)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const selected = explicitOrganization || primaryOrganization.current;
    if (!selected || organizationId === selected) return;
    setOrganizationId(selected);
    setOrganizationInput(selected);
    setPage(1);
  }, [explicitOrganization, organizationId]);

  useEffect(() => {
    if (organizationId) setWriteForbidden(false);
  }, [organizationId]);

  const loadViews = useCallback(async (selectedOrganizationId: string, offset: number, signal?: AbortSignal) => {
    const key = `${selectedOrganizationId}:${offset}`;
    const generation = ++viewGeneration.current;
    const current = () => viewResource.current === key && viewGeneration.current === generation && !signal?.aborted;
    viewResource.current = key;
    setViews([]);
    setViewTotal(0);
    setViewsError(undefined);
    setViewsLoading(true);
    try {
      const response = await getProblemViews({ organizationId: selectedOrganizationId, pageSize: 100, offset }, signal);
      if (!current()) return undefined;
      setViews(response.items);
      setViewTotal(response.total);
      return response;
    } catch (cause) {
      if (signal?.aborted || (cause instanceof DOMException && cause.name === 'AbortError') || !current()) return undefined;
      const error = controlledError(cause);
      setViewsError(error);
      if (isForbidden(error)) setWriteForbidden(true);
      return undefined;
    } finally {
      if (current()) setViewsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!organizationId) return;
    const controller = new AbortController();
    void loadViews(organizationId, viewOffset, controller.signal);
    return () => controller.abort();
  }, [loadViews, organizationId, viewOffset]);

  const query = useMemo<ProblemQuery | undefined>(() => organizationId ? ({
    organizationId,
    page,
    pageSize,
    ...appliedFilters,
    sortBy: sort.sortBy,
    sortDirection: sort.sortDirection,
  }) : undefined, [appliedFilters, organizationId, page, pageSize, sort]);

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    const key = JSON.stringify(query);
    problemResource.current = key;
    setResult(undefined);
    setResultError(undefined);
    setResultLoading(true);
    void getProblemIndex(query, controller.signal).then((response) => {
      if (problemResource.current === key && !controller.signal.aborted) setResult(response);
    }).catch((cause) => {
      if (controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError') || problemResource.current !== key) return;
      const error = controlledError(cause);
      setResultError(error);
      if (isForbidden(error)) setWriteForbidden(true);
    }).finally(() => {
      if (problemResource.current === key && !controller.signal.aborted) setResultLoading(false);
    });
    return () => controller.abort();
  }, [query]);

  const selectedView = views.find((view) => view.id === selectedViewId);
  const configuration = useMemo<ProblemViewConfiguration>(() => ({
    schemaVersion: 1,
    filters: { ...filters },
    sort: { ...sort },
    visibleColumns: [...visibleColumns],
    columnOrder: [...columnOrder],
  }), [columnOrder, filters, sort, visibleColumns]);

  const applyConfiguration = useCallback((next: ProblemViewConfiguration, name?: string) => {
    const normalized = normalizeConfiguration(next);
    setFilters(normalized.filters);
    setAppliedFilters(normalized.filters);
    setSort(normalized.sort);
    setVisibleColumns(normalized.visibleColumns);
    setColumnOrder(normalized.columnOrder);
    if (name !== undefined) setViewName(name);
    setPage(1);
    setMutationError(undefined);
    setMutationMessage('');
    setConflicted(false);
  }, []);

  const switchOrganization = () => {
    const selected = organizationInput.trim();
    if (!selected) return;
    const next = new URLSearchParams(searchParams);
    next.set('organizationId', selected);
    problemResource.current = `switching:${selected}`;
    viewResource.current = `switching:${selected}`;
    setSearchParams(next, { replace: true });
    setPage(1);
    setViewOffset(0);
    setSelectedViewId('');
    setResult(undefined);
    setViews([]);
    setMutationError(undefined);
  };

  const mutate = async (operation: () => Promise<void>, message: string) => {
    if (mutationPending.current) return;
    mutationPending.current = true;
    setMutating(true);
    setMutationError(undefined);
    setMutationMessage('');
    setConflicted(false);
    try {
      await operation();
      setMutationMessage(message);
    } catch (cause) {
      const error = controlledError(cause);
      setMutationError(error);
      if (error.code === 'CONCURRENCY_CONFLICT' || error.code === 'HTTP_409') setConflicted(true);
      if (isForbidden(error)) setWriteForbidden(true);
    } finally {
      mutationPending.current = false;
      setMutating(false);
    }
  };

  const saveView = () => {
    const name = viewName.trim();
    if (!organizationId || !name) {
      setMutationError({ message: '请输入视图名称' });
      return;
    }
    void mutate(async () => {
      const created = await createProblemView(organizationId, { name, configuration });
      setViews((current) => [created, ...current]);
      setViewTotal((total) => total + 1);
      setSelectedViewId(created.id);
    }, '视图已保存');
  };

  const updateView = () => {
    if (!organizationId || !selectedView) return;
    void mutate(async () => {
      const updated = await updateProblemView(organizationId, selectedView.id, {
        name: viewName.trim() || selectedView.name,
        configuration,
        expectedVersion: selectedView.version,
      });
      setViews((current) => current.map((view) => view.id === updated.id ? updated : view));
    }, '视图已更新');
  };

  const removeView = () => {
    if (!organizationId || !selectedView) return;
    void mutate(async () => {
      await deleteProblemView(organizationId, selectedView.id, { expectedVersion: selectedView.version });
      setViews((current) => current.filter((view) => view.id !== selectedView.id));
      setViewTotal((total) => Math.max(0, total - 1));
      setSelectedViewId('');
      setViewName('');
    }, '视图已删除');
  };

  const reloadConflictedView = () => {
    if (!organizationId || !selectedViewId) return;
    void (async () => {
      const response = await loadViews(organizationId, viewOffset);
      const latest = response?.items.find((view) => view.id === selectedViewId);
      if (latest) applyConfiguration(latest.configuration, latest.name);
    })();
  };

  const changeColumn = (column: ColumnKey, checked: boolean) => {
    setVisibleColumns((current) => checked ? [...current, column] : current.filter((value) => value !== column));
  };

  const moveColumn = (column: ColumnKey, direction: -1 | 1) => {
    setColumnOrder((current) => {
      const index = current.indexOf(column);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const columns = useMemo<TableColumnsType<ProblemItem>>(() => {
    const definitions: Record<ColumnKey, TableColumnsType<ProblemItem>[number]> = {
      reportNumber: { title: t('报告编号'), dataIndex: 'reportNumber', render: (value: string, item) => <Link to={`/app/problem-workspace/${item.id}?organizationId=${encodeURIComponent(item.organizationId)}`}>{value}</Link> },
      title: { title: t('标题'), dataIndex: ['summary', 'title'] },
      domainCode: { title: t('领域'), dataIndex: 'domainCode' },
      problemType: { title: t('问题类型'), dataIndex: 'problemType' },
      status: { title: t('状态'), dataIndex: 'status', render: (value: ProblemStatus) => <Tag>{t(statusLabels[value] ?? value)}</Tag> },
      severity: { title: t('严重度'), dataIndex: 'severity' },
      responsibleParty: { title: t('责任方'), dataIndex: 'responsibleParty', render: (value: string | null) => value || '—' },
      ownerId: { title: t('负责人 ID'), dataIndex: 'ownerId', render: (value: string | null) => value || '—' },
      dueAt: { title: t('截止时间'), dataIndex: 'dueAt', render: (value: string | null) => value ? new Date(value).toLocaleString(locale) : '—' },
      updatedAt: { title: t('更新时间'), dataIndex: 'updatedAt', render: (value: string) => new Date(value).toLocaleString(locale) },
    };
    return columnOrder.filter((column) => visibleColumns.includes(column)).map((column) => ({ ...definitions[column], key: column }));
  }, [columnOrder, locale, t, visibleColumns]);

  const disabledWrites = writeForbidden || mutating || viewsLoading;
  return <main className="problem-center">
    <div className="problem-center__heading">
      <div><Typography.Title level={1}>{t('问题管理面板')}</Typography.Title><Typography.Paragraph type="secondary">{t('在授权组织内检索问题，并保存个人视图。')}</Typography.Paragraph></div>
      <Space.Compact><Input aria-label={t('组织上下文')} value={organizationInput} onChange={(event) => setOrganizationInput(event.target.value)} /><Button onClick={switchOrganization}>{t('切换组织')}</Button></Space.Compact>
    </div>
    <Feedback error={organizationError} t={t} />

    <Card title={t('保存视图')} loading={!organizationId && !organizationError}>
      <div className="problem-center__view-row">
        <label>{t('保存视图')}<select aria-label={t('保存视图')} value={selectedViewId} onChange={(event) => {
          const id = event.target.value;
          setSelectedViewId(id);
          const view = views.find((candidate) => candidate.id === id);
          if (view) setViewName(view.name);
        }} disabled={viewsLoading}><option value="">{t('请选择')}</option>{views.map((view) => <option value={view.id} key={view.id}>{view.name}</option>)}</select></label>
        <label>{t('视图名称')}<Input aria-label={t('视图名称')} value={viewName} maxLength={80} onChange={(event) => setViewName(event.target.value)} /></label>
        <Space wrap>
          <Button disabled={!selectedView} onClick={() => selectedView && applyConfiguration(selectedView.configuration, selectedView.name)}>{t('应用视图')}</Button>
          <Button type="primary" disabled={disabledWrites} loading={mutating} onClick={saveView}>{t('保存新视图')}</Button>
          <Button disabled={disabledWrites || !selectedView} loading={mutating} onClick={updateView}>{t('更新视图')}</Button>
          <Button danger disabled={disabledWrites || !selectedView} loading={mutating} onClick={removeView}>{t('删除视图')}</Button>
          {conflicted ? <Button disabled={viewsLoading} loading={viewsLoading} onClick={reloadConflictedView}>{t('重新加载保存视图')}</Button> : null}
        </Space>
      </div>
      <Feedback error={viewsError} t={t} /><Feedback error={mutationError} t={t} />
      {mutationMessage ? <Alert type="success" showIcon role="status" title={t(mutationMessage)} /> : null}
      {viewTotal > 100 ? <Space className="problem-center__view-pages"><Button disabled={viewOffset === 0} onClick={() => setViewOffset(Math.max(0, viewOffset - 100))}>{t('上一页')}</Button><span>{viewOffset + 1}–{Math.min(viewOffset + 100, viewTotal)} / {viewTotal}</span><Button disabled={viewOffset + 100 >= viewTotal} onClick={() => setViewOffset(viewOffset + 100)}>{t('下一页')}</Button></Space> : null}
    </Card>

    <Card title={t('筛选与排序')}>
      <div className="problem-center__filters">
        <label>{t('报告编号检索')}<Input aria-label={t('报告编号检索')} value={filters.search ?? ''} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value || undefined }))} /></label>
        <label>{t('领域代码')}<Input aria-label={t('领域代码')} value={filters.domainCode ?? ''} onChange={(event) => setFilters((current) => ({ ...current, domainCode: event.target.value || undefined }))} /></label>
        <label>{t('问题类型')}<Input aria-label={t('问题类型')} value={filters.problemType ?? ''} onChange={(event) => setFilters((current) => ({ ...current, problemType: event.target.value || undefined }))} /></label>
        <label>{t('状态')}<select aria-label={t('状态筛选')} value={filters.status ?? ''} onChange={(event) => setFilters((current) => ({ ...current, status: (event.target.value || undefined) as ProblemStatus | undefined }))}><option value="">{t('全部状态')}</option>{statuses.map((status) => <option key={status} value={status}>{t(statusLabels[status])}</option>)}</select></label>
        <label>{t('严重度')}<Input aria-label={t('严重度筛选')} value={filters.severity ?? ''} onChange={(event) => setFilters((current) => ({ ...current, severity: event.target.value || undefined }))} /></label>
        <label>{t('负责人 ID')}<Input aria-label={t('负责人 ID')} value={filters.ownerId ?? ''} onChange={(event) => setFilters((current) => ({ ...current, ownerId: event.target.value || undefined }))} /></label>
        <label>{t('截止起始')}<input aria-label={t('截止起始')} type="datetime-local" value={localDateTime(filters.dueFrom)} onChange={(event) => setFilters((current) => ({ ...current, dueFrom: isoDateTime(event.target.value) }))} /></label>
        <label>{t('截止结束')}<input aria-label={t('截止结束')} type="datetime-local" value={localDateTime(filters.dueTo)} onChange={(event) => setFilters((current) => ({ ...current, dueTo: isoDateTime(event.target.value) }))} /></label>
        <label>{t('排序字段')}<Select aria-label={t('排序字段')} value={sort.sortBy} options={sortFields.map((value) => ({ value, label: t(sortLabels[value]) }))} onChange={(sortBy) => { setSort((current) => ({ ...current, sortBy })); setPage(1); }} /></label>
        <label>{t('排序方向')}<Select aria-label={t('排序方向')} value={sort.sortDirection} options={[{ value: 'desc', label: t('降序') }, { value: 'asc', label: t('升序') }]} onChange={(sortDirection) => { setSort((current) => ({ ...current, sortDirection })); setPage(1); }} /></label>
      </div>
      <Space wrap className="problem-center__filter-actions">
        <Checkbox checked={Boolean(filters.overdueAt)} onChange={(event) => setFilters((current) => ({ ...current, overdueAt: event.target.checked ? new Date().toISOString() : undefined }))}>{t('仅看当前已逾期')}</Checkbox>
        {filters.overdueAt ? <Typography.Text type="secondary">{t('逾期基准')}: {new Date(filters.overdueAt).toLocaleString(locale)}</Typography.Text> : null}
        <Button type="primary" onClick={() => { setAppliedFilters({ ...filters }); setPage(1); }}>{t('查询')}</Button>
        <Button onClick={() => applyConfiguration(defaultConfiguration, '')}>{t('重置')}</Button>
      </Space>
    </Card>

    <Card title={t('显示列')}>
      <div className="problem-center__columns">{columnOrder.map((column, index) => <div key={column} className="problem-center__column-option"><Checkbox checked={visibleColumns.includes(column)} onChange={(event) => changeColumn(column, event.target.checked)}>{t(columnLabels[column])}</Checkbox><Space.Compact><Button size="small" aria-label={`${t('上移')} ${t(columnLabels[column])}`} disabled={index === 0} onClick={() => moveColumn(column, -1)}>↑</Button><Button size="small" aria-label={`${t('下移')} ${t(columnLabels[column])}`} disabled={index === columnOrder.length - 1} onClick={() => moveColumn(column, 1)}>↓</Button></Space.Compact></div>)}</div>
    </Card>

    <section aria-label={t('问题列表')}>
      {result?.statusCounts.length ? <Space wrap className="problem-center__counts">{result.statusCounts.map((entry) => <Tag key={entry.status}>{t(statusLabels[entry.status])}: {entry.count}</Tag>)}</Space> : null}
      <Feedback error={resultError} t={t} />
      {!resultError ? <Table<ProblemItem> rowKey="id" loading={resultLoading} columns={columns} dataSource={result?.items ?? []} pagination={false} locale={{ emptyText: resultLoading ? t('加载中') : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={page > 1 && (result?.total ?? 0) > 0 ? t('本页暂无问题') : t('暂无问题')} /> }} scroll={{ x: 'max-content' }} /> : null}
      {result ? <div className="problem-center__pagination"><Typography.Text>{t('总数')}: {result.total}</Typography.Text><Pagination current={page} pageSize={pageSize} total={result.total} showSizeChanger pageSizeOptions={[25, 50, 100]} onChange={(nextPage, nextPageSize) => { setPageSize(Math.min(100, nextPageSize)); setPage(Math.min(10001, nextPageSize === pageSize ? nextPage : 1)); }} /></div> : null}
    </section>
  </main>;
}
