import type { components } from '@qms/contracts';
import { Alert, Button, Card, Checkbox, Empty, Input, Pagination, Popconfirm, Select, Space, Table, Tag, Typography, type TableColumnsType } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ProcessProblemDeadlines, ProcessProblemTitle, processSummaryValue } from '../process-quality/ProcessProblemSummary';
import { useEightDSeverityText } from '../process-eight-d/eight-d';
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

type EightDDomain = 'customer-quality' | 'new-product-quality';
export function ProblemCenterPage({ processQuality = false, eightDDomain }: { processQuality?: boolean; eightDDomain?: EightDDomain }) {
  const [searchParams] = useSearchParams();
  const session = useWorkTabsStore(state => state.sessionScope);
  const explicitOrganization = searchParams.get('organizationId')?.trim() ?? '';
  return <ProblemCenterScope key={`${session}:${processQuality}:${eightDDomain}:${explicitOrganization || 'session-primary-organization'}`} explicitOrganization={explicitOrganization} processQuality={processQuality} eightDDomain={eightDDomain} />;
}

function ProblemCenterScope({ explicitOrganization, processQuality: processOnly, eightDDomain }: { explicitOrganization: string; processQuality: boolean; eightDDomain?: EightDDomain }) {
  const processQuality = processOnly || !!eightDDomain;
  const followupTitle = eightDDomain === 'customer-quality' ? '客户问题跟进' : eightDDomain === 'new-product-quality' ? '新品问题跟进' : '制程问题跟进';
  const { locale, t } = useLanguage();
  const severityText = useEightDSeverityText();
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
  const [accessLost, setAccessLost] = useState(false);
  const [revision, setRevision] = useState(0);
  const primaryOrganization = useRef('');
  const mutationPending = useRef(false);
  const problemResource = useRef('');
  const viewResource = useRef('');
  const viewGeneration = useRef(0);
  const scopeActive = useRef(true);
  const processReads = useRef(new Set<AbortController>());
  const revokeProcessAccess = useCallback(() => {
    if (!scopeActive.current) return;
    scopeActive.current = false;
    problemResource.current = ''; viewResource.current = ''; viewGeneration.current += 1;
    processReads.current.forEach(controller => controller.abort()); processReads.current.clear();
    setAccessLost(true); setResult(undefined); setViews([]); setViewTotal(0); setSelectedViewId(''); setViewName('');
    setResultLoading(false); setViewsLoading(false); setMutating(false); setWriteForbidden(true);
  }, []);
  useEffect(() => {
    scopeActive.current = true;
    return () => {
      scopeActive.current = false;
      if (processQuality) { processReads.current.forEach(controller => controller.abort()); processReads.current.clear(); }
    };
  }, [processQuality]);

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
    if (processQuality && !scopeActive.current) return undefined;
    const controller = processQuality ? new AbortController() : undefined;
    const requestSignal = controller ? signal ? AbortSignal.any([signal, controller.signal]) : controller.signal : signal;
    if (controller) processReads.current.add(controller);
    const key = `${selectedOrganizationId}:${offset}`;
    const generation = ++viewGeneration.current;
    const current = () => viewResource.current === key && viewGeneration.current === generation && !requestSignal?.aborted && (!processQuality || scopeActive.current);
    viewResource.current = key;
    setViews([]);
    setViewTotal(0);
    setViewsError(undefined);
    setViewsLoading(true);
    try {
      const response = await getProblemViews({ organizationId: selectedOrganizationId, pageSize: 100, offset }, requestSignal);
      if (!current()) return undefined;
      setViews(response.items);
      setViewTotal(response.total);
      return response;
    } catch (cause) {
      if (requestSignal?.aborted || (cause instanceof DOMException && cause.name === 'AbortError') || !current()) return undefined;
      const error = controlledError(cause);
      setViewsError(error);
      if (isForbidden(error)) setWriteForbidden(true);
      if (processQuality && cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) revokeProcessAccess();
      return undefined;
    } finally {
      if (controller) processReads.current.delete(controller);
      if (current()) setViewsLoading(false);
    }
  }, [processQuality, revokeProcessAccess]);

  useEffect(() => {
    if (!organizationId || accessLost) return;
    const controller = new AbortController();
    void loadViews(organizationId, viewOffset, controller.signal);
    return () => controller.abort();
  }, [loadViews, organizationId, viewOffset, accessLost]);

  const query = useMemo<ProblemQuery | undefined>(() => {
    if (!organizationId || accessLost) return undefined;
    const value: ProblemQuery = { organizationId, page, pageSize, ...appliedFilters, sortBy: sort.sortBy, sortDirection: sort.sortDirection };
    if (processQuality) {
      value.domainCode = eightDDomain ?? 'process-quality';
      if (eightDDomain) {
        value.sourceType = eightDDomain === 'customer-quality' ? 'customer-complaint' : 'new-product-defect-selection';
        delete value.problemType;
      } else value.problemType = 'PROCESS_DEFECT';
      value.responseForm = 'EIGHT_D';
    }
    return value;
  }, [appliedFilters, organizationId, page, pageSize, sort, processQuality, eightDDomain, accessLost]);

  useEffect(() => {
    if (!query || processQuality && !scopeActive.current) return;
    const controller = new AbortController();
    if (processQuality) processReads.current.add(controller);
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
      if (processQuality && cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) revokeProcessAccess();
    }).finally(() => {
      processReads.current.delete(controller);
      if (problemResource.current === key && !controller.signal.aborted) setResultLoading(false);
    });
    return () => { controller.abort(); processReads.current.delete(controller); };
  }, [query, revision, processQuality, revokeProcessAccess]);

  const selectedView = views.find((view) => view.id === selectedViewId);
  const configuration = useMemo<ProblemViewConfiguration>(() => ({
    schemaVersion: 1,
    filters: { ...filters, ...(processQuality ? { domainCode: eightDDomain ?? 'process-quality', problemType: eightDDomain ? undefined : 'PROCESS_DEFECT' } : {}) },
    sort: { ...sort },
    visibleColumns: [...visibleColumns],
    columnOrder: [...columnOrder],
  }), [columnOrder, filters, sort, visibleColumns, processQuality, eightDDomain]);

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
    const current = () => !processQuality || scopeActive.current;
    if (mutationPending.current || !current()) return;
    mutationPending.current = true;
    setMutating(true);
    setMutationError(undefined);
    setMutationMessage('');
    setConflicted(false);
    try {
      await operation();
      if (current()) setMutationMessage(message);
    } catch (cause) {
      if (!current()) return;
      const error = controlledError(cause);
      setMutationError(error);
      if (error.code === 'CONCURRENCY_CONFLICT' || error.code === 'HTTP_409') setConflicted(true);
      if (isForbidden(error)) setWriteForbidden(true);
      if (processQuality && cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) revokeProcessAccess();
    } finally {
      mutationPending.current = false;
      if (current()) setMutating(false);
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
      if (processQuality && !scopeActive.current) return;
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
      if (processQuality && !scopeActive.current) return;
      setViews((current) => current.map((view) => view.id === updated.id ? updated : view));
    }, '视图已更新');
  };

  const removeView = () => {
    if (!organizationId || !selectedView) return;
    void mutate(async () => {
      await deleteProblemView(organizationId, selectedView.id, { expectedVersion: selectedView.version });
      if (processQuality && !scopeActive.current) return;
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
      title: { title: t('标题'), dataIndex: ['summary', 'title'], render: (value: string, item) => processQuality ? <ProcessProblemTitle summary={item.summary} /> : value },
      domainCode: { title: t('领域'), dataIndex: 'domainCode' },
      problemType: { title: t('问题类型'), dataIndex: 'problemType' },
      status: { title: t('状态'), dataIndex: 'status', render: (value: ProblemStatus) => <Tag>{t(statusLabels[value] ?? value)}</Tag> },
      severity: { title: t(processQuality ? '风险' : '严重度'), dataIndex: 'severity', render: (value: string) => processQuality && (value === 'LOW' || value === 'MEDIUM' || value === 'HIGH' || value === 'CRITICAL') ? severityText(value) : value },
      responsibleParty: { title: t(processQuality ? '责任科室' : '责任方'), dataIndex: 'responsibleParty', render: (value: string | null, item) => (processQuality ? processSummaryValue(item.summary, 'responsibleSectionName') : value) || '—' },
      ownerId: { title: t(processQuality ? '负责人' : '负责人 ID'), dataIndex: 'ownerId', render: (value: string | null, item) => (processQuality ? processSummaryValue(item.summary, 'ownerName') : value) || '—' },
      dueAt: { title: t(processQuality ? '问题截止时间' : '截止时间'), dataIndex: 'dueAt', render: (value: string | null) => value ? new Date(value).toLocaleString(locale) : '—' },
      updatedAt: { title: t('更新时间'), dataIndex: 'updatedAt', render: (value: string) => new Date(value).toLocaleString(locale) },
    };
    const selected: TableColumnsType<ProblemItem> = columnOrder.filter((column) => visibleColumns.includes(column)).map((column) => ({ ...definitions[column], key: column }));
    if (processQuality) selected.push(
      { title: t('当前阶段'), key: 'processStage', render: (_, item) => t(processSummaryValue(item.summary, 'stage') || '—') },
      { title: t('当前期限'), key: 'processDeadlines', render: (_, item) => <ProcessProblemDeadlines problem={item} /> },
    );
    return selected;
  }, [columnOrder, locale, t, visibleColumns, processQuality, severityText]);

  const disabledWrites = writeForbidden || mutating || viewsLoading;
  const visibleColumnLabels = processQuality ? { ...columnLabels, severity: '风险', responsibleParty: '责任科室', ownerId: '负责人', dueAt: '问题截止时间' } : columnLabels;
  if (accessLost) return <main className="problem-center"><h1 className="sr-only">{t(processQuality ? followupTitle : '问题管理面板')}</h1><Alert role="alert" type="warning" title={t('当前会话失效或无权访问，敏感内容已清除，请重新登录或联系授权人员。')} /></main>;
  return <main className="problem-center">
    <div className="problem-center__heading">
      <h1 className="sr-only">{t(processQuality ? followupTitle : '问题管理面板')}</h1>
      <Space.Compact><Input aria-label={t('组织上下文')} value={organizationInput} onChange={(event) => setOrganizationInput(event.target.value)} /><Button onClick={switchOrganization}>{t('切换组织')}</Button></Space.Compact>
    </div>
    <Feedback error={organizationError} t={t} />
    {processQuality ? <><Button loading={resultLoading} onClick={() => setRevision(value => value + 1)}>{t('刷新')}</Button><p>{t('一张正式8D一行。')}</p><Alert type="info" title={t('支持编号、状态、风险、负责人及问题截止时间筛选；阶段期限仅供核对，暂不参与截止筛选。')} /></> : null}

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
          <Popconfirm
            title="删除个人保存视图"
            description={selectedView ? `将删除“${selectedView.name}”个人视图及其问题筛选、排序和显示列配置。` : undefined}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            disabled={disabledWrites || !selectedView}
            onConfirm={removeView}
          >
            <Button danger disabled={disabledWrites || !selectedView} loading={mutating}>{t('删除视图')}</Button>
          </Popconfirm>
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
        {!processQuality ? <label>{t('领域代码')}<Input aria-label={t('领域代码')} value={filters.domainCode ?? ''} onChange={(event) => setFilters((current) => ({ ...current, domainCode: event.target.value || undefined }))} /></label> : null}
        {!processQuality ? <label>{t('问题类型')}<Input aria-label={t('问题类型')} value={filters.problemType ?? ''} onChange={(event) => setFilters((current) => ({ ...current, problemType: event.target.value || undefined }))} /></label> : null}
        <label>{t('状态')}<select aria-label={t('状态筛选')} value={filters.status ?? ''} onChange={(event) => setFilters((current) => ({ ...current, status: (event.target.value || undefined) as ProblemStatus | undefined }))}><option value="">{t('全部状态')}</option>{statuses.map((status) => <option key={status} value={status}>{t(statusLabels[status])}</option>)}</select></label>
        <label>{t('严重度')}<Input aria-label={t('严重度筛选')} value={filters.severity ?? ''} onChange={(event) => setFilters((current) => ({ ...current, severity: event.target.value || undefined }))} /></label>
        <label>{t('负责人 ID')}<Input aria-label={t('负责人 ID')} value={filters.ownerId ?? ''} onChange={(event) => setFilters((current) => ({ ...current, ownerId: event.target.value || undefined }))} /></label>
        <label>{t('截止起始')}<input aria-label={t('截止起始')} type="datetime-local" value={localDateTime(filters.dueFrom)} onChange={(event) => setFilters((current) => ({ ...current, dueFrom: isoDateTime(event.target.value) }))} /></label>
        <label>{t('截止结束')}<input aria-label={t('截止结束')} type="datetime-local" value={localDateTime(filters.dueTo)} onChange={(event) => setFilters((current) => ({ ...current, dueTo: isoDateTime(event.target.value) }))} /></label>
        <label>{t('排序字段')}<Select aria-label={t('排序字段')} value={sort.sortBy} options={sortFields.map((value) => ({ value, label: t(processQuality && value === 'dueAt' ? '问题截止时间' : sortLabels[value]) }))} onChange={(sortBy) => { setSort((current) => ({ ...current, sortBy })); setPage(1); }} /></label>
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
      <div className="problem-center__columns">{columnOrder.map((column, index) => <div key={column} className="problem-center__column-option"><Checkbox checked={visibleColumns.includes(column)} onChange={(event) => changeColumn(column, event.target.checked)}>{t(visibleColumnLabels[column])}</Checkbox><Space.Compact><Button size="small" aria-label={`${t('上移')} ${t(visibleColumnLabels[column])}`} disabled={index === 0} onClick={() => moveColumn(column, -1)}>↑</Button><Button size="small" aria-label={`${t('下移')} ${t(visibleColumnLabels[column])}`} disabled={index === columnOrder.length - 1} onClick={() => moveColumn(column, 1)}>↓</Button></Space.Compact></div>)}</div>
    </Card>

    <section aria-label={t('问题列表')}>
      {result?.statusCounts.length ? <Space wrap className="problem-center__counts">{result.statusCounts.map((entry) => <Tag key={entry.status}>{t(statusLabels[entry.status])}: {entry.count}</Tag>)}</Space> : null}
      <Feedback error={resultError} t={t} />
      {!resultError ? <Table<ProblemItem> rowKey="id" loading={resultLoading} columns={columns} dataSource={result?.items ?? []} pagination={false} locale={{ emptyText: resultLoading ? t('加载中') : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={page > 1 && (result?.total ?? 0) > 0 ? t('本页暂无问题') : t('暂无问题')} /> }} scroll={{ x: 'max-content' }} /> : null}
      {result ? <div className="problem-center__pagination"><Typography.Text>{t('总数')}: {result.total}</Typography.Text><Pagination current={page} pageSize={pageSize} total={result.total} showSizeChanger pageSizeOptions={[25, 50, 100]} onChange={(nextPage, nextPageSize) => { setPageSize(Math.min(100, nextPageSize)); setPage(Math.min(10001, nextPageSize === pageSize ? nextPage : 1)); }} /></div> : null}
    </section>
  </main>;
}
