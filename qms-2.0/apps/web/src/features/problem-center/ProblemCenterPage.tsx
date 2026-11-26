import type { components } from '@qms/contracts';
import { Alert, Button, Card, Checkbox, Empty, Input, Pagination, Popconfirm, Select, Space, Tag, Typography, type TableColumnsType } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { LedgerTable, useLedgerPageSize } from '../../ui/ledger';
import { LedgerFilterCondition, LedgerFilterHeader, LedgerFilterPanel, LedgerFilterPopover } from '../../ui/ledger/FilterPopover';
import { normalizePreferences, preferenceKey } from '../../ui/ledger/model';
import { useLedgerScope, usePreference } from '../../ui/ledger/preferences';
import { ProcessProblemDeadlines, ProcessProblemTitle, processSummaryValue } from '../process-quality/ProcessProblemSummary';
import { useEightDSeverityText } from '../process-eight-d/eight-d';
import { emptyFollowupGroup, followupFields, followupFiltersTooLong, followupMaxItems, followupOperators, followupSeverities, followupStageLabels, normalizeFollowupFilters, withoutValue, type FollowupCondition, type FollowupField, type FollowupGroup } from './process-followup-filters';
import {
  createProblemView,
  deleteProblemView,
  getProblemIndex,
  getProblemOrganizationId,
  getProblemViews,
  getProcessFollowup,
  updateProblemView,
  type ProblemPage,
  type ProblemQuery,
  type ProblemView,
  type ProblemViewConfiguration,
  type ProcessFollowupPage,
  type ProcessFollowupQuery,
} from './problem-center-api';
import './problem-center.css';

type ProblemItem = components['schemas']['ProblemIndexResponseDto'] | ProcessFollowupPage['items'][number];
type ProblemFilters = components['schemas']['ProblemSavedViewFiltersDto'];
type ProblemSort = components['schemas']['ProblemSavedViewSortDto'];
type ProblemStatus = NonNullable<ProblemFilters['status']>;
type LayoutKey = ProblemViewConfiguration['visibleColumns'][number];
type ColumnKey = Exclude<LayoutKey, 'processStage'>;
type ColumnLayout = { order: LayoutKey[]; visible: LayoutKey[] };
type ErrorState = { message: string; traceId?: string; code?: string };

const statuses: ProblemStatus[] = ['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'ARCHIVED'];
const sortFields: ProblemSort['sortBy'][] = ['createdAt', 'updatedAt', 'dueAt', 'reportNumber', 'status', 'severity'];
const allColumns: ColumnKey[] = ['reportNumber', 'title', 'domainCode', 'problemType', 'status', 'severity', 'responsibleParty', 'ownerId', 'dueAt', 'updatedAt'];
const processColumns: LayoutKey[] = ['reportNumber', 'title', 'processStage', 'status', 'severity', 'responsibleParty', 'ownerId', 'dueAt', 'updatedAt'];
const processHeaderFilters: Partial<Record<LayoutKey, FollowupField>> = {
  processStage: 'stage', status: 'status', severity: 'severity', responsibleParty: 'responsibleSectionName', ownerId: 'ownerName', dueAt: 'dueAt',
};
function isFollowupStage(value: unknown): value is NonNullable<ProcessFollowupQuery['stage']> {
  return typeof value === 'string' && Object.hasOwn(followupStageLabels, value);
}
const followupPath = '/app/process-quality/problems';
type FollowupSnapshot = { scope: string; page: number; filters: ProblemFilters; sort: ProblemSort; selectedViewId: string; layout: ColumnLayout };
let followupSnapshot: FollowupSnapshot | undefined;
useWorkTabsStore.subscribe((next, previous) => {
  if (next.sessionScope !== previous.sessionScope || previous.tabs.some(tab => tab.id === followupPath) && !next.tabs.some(tab => tab.id === followupPath)) followupSnapshot = undefined;
});
const defaultConfiguration: ProblemViewConfiguration = {
  schemaVersion: 1,
  filters: {},
  sort: { sortBy: 'updatedAt', sortDirection: 'desc' },
  visibleColumns: [...allColumns],
  columnOrder: [...allColumns],
};
function normalizeColumnLayout(input: unknown, processOnly: boolean): ColumnLayout {
  const columns = processOnly ? processColumns : allColumns;
  const normalized = normalizePreferences(input ?? (processOnly ? { order: processColumns, visible: processColumns.slice(0, -1) } : undefined), columns,
    false, processOnly ? [['processStage', 'status', true]] : undefined);
  return { order: normalized.order as LayoutKey[], visible: normalized.visible as LayoutKey[] };
}
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

function normalizeConfiguration(configuration: ProblemViewConfiguration, processOnly: boolean): ProblemViewConfiguration {
  const visibleColumns = allColumns.filter((column) => configuration.visibleColumns.includes(column));
  const ordered = configuration.columnOrder.filter((column, index, source) => allColumns.includes(column as ColumnKey) && source.indexOf(column) === index);
  const columnOrder = [...ordered, ...allColumns.filter((column) => !ordered.includes(column))];
  const sortBy = sortFields.includes(configuration.sort.sortBy) ? configuration.sort.sortBy : defaultConfiguration.sort.sortBy;
  const processLayout = processOnly ? normalizeColumnLayout(configuration === defaultConfiguration ? undefined : { order: configuration.columnOrder, visible: configuration.visibleColumns }, true) : undefined;
  return {
    schemaVersion: 1,
    filters: processOnly ? normalizeFollowupFilters(configuration.filters) : normalizeFilters(configuration.filters),
    sort: { sortBy, sortDirection: configuration.sort.sortDirection === 'asc' ? 'asc' : 'desc' },
    visibleColumns: processLayout?.visible ?? (visibleColumns.length ? visibleColumns : ['reportNumber']),
    columnOrder: processLayout?.order ?? columnOrder,
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
  const scope = `${session}:${explicitOrganization || 'session-primary-organization'}`;
  return <ProblemCenterScope key={`${scope}:${processQuality}:${eightDDomain}`} explicitOrganization={explicitOrganization} processQuality={processQuality} eightDDomain={eightDDomain} followupScope={session && processQuality && !eightDDomain ? scope : undefined} />;
}

function ProblemCenterScope({ explicitOrganization, processQuality: processOnly, eightDDomain, followupScope }: { explicitOrganization: string; processQuality: boolean; eightDDomain?: EightDDomain; followupScope?: string }) {
  const processQuality = processOnly || !!eightDDomain;
  const followupTitle = eightDDomain === 'customer-quality' ? '客户问题跟进' : eightDDomain === 'new-product-quality' ? '新品问题跟进' : '制程问题跟进';
  const { locale, t } = useLanguage();
  const severityText = useEightDSeverityText();
  const [searchParams, setSearchParams] = useSearchParams();
  const [organizationId, setOrganizationId] = useState<string>();
  const [organizationInput, setOrganizationInput] = useState(explicitOrganization);
  const [organizationError, setOrganizationError] = useState<ErrorState>();
  const [restored] = useState(() => followupScope && followupSnapshot?.scope === followupScope ? followupSnapshot : undefined);
  const [filters, setFilters] = useState<ProblemFilters>(restored?.filters ?? {});
  const [appliedFilters, setAppliedFilters] = useState<ProblemFilters>(restored?.filters ?? {});
  const [searchInput, setSearchInput] = useState(restored?.filters.search ?? '');
  const [sort, setSort] = useState<ProblemSort>(restored?.sort ?? defaultConfiguration.sort);
  const [draftSort, setDraftSort] = useState(sort);
  const [viewLayout, setViewLayout] = useState<ColumnLayout>(() => restored?.layout ?? normalizeColumnLayout(undefined, processOnly));
  const [page, setPage] = useState(restored?.page ?? 1);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterRow, setFilterRow] = useState<number>();
  const filterAnchor = useRef<HTMLElement>(undefined);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const filterControl = useRef<HTMLSelectElement>(null);
  const filterRows = useRef<HTMLDivElement>(null);
  const ledgerId = eightDDomain ? `${eightDDomain}-problem-followup` : processOnly ? 'process-problem-followup' : 'problem-center';
  const [pageSize, setPageSize] = useLedgerPageSize(ledgerId, organizationId);
  const [result, setResult] = useState<ProblemPage | ProcessFollowupPage>();
  const [resultError, setResultError] = useState<ErrorState>();
  const [resultLoading, setResultLoading] = useState(false);
  const [views, setViews] = useState<ProblemView[]>([]);
  const [viewTotal, setViewTotal] = useState(0);
  const [viewOffset, setViewOffset] = useState(0);
  const [viewsError, setViewsError] = useState<ErrorState>();
  const [viewsLoading, setViewsLoading] = useState(false);
  const [selectedViewId, setSelectedViewId] = useState(restored?.selectedViewId ?? '');
  const ledgerScope = useLedgerScope(organizationId);
  const layoutKey = organizationId ? preferenceKey(ledgerScope, ledgerId, 'columns', 'default-layout') : undefined;
  const layoutStateKey = layoutKey ?? JSON.stringify([ledgerScope, ledgerId, 'default-layout']);
  const [defaultLayout, setDefaultLayout] = usePreference(layoutKey, ledgerScope.sessionScope, input => normalizeColumnLayout(input, processOnly), layoutStateKey);
  const activeLayout = useRef({ key: layoutStateKey, viewId: selectedViewId, value: defaultLayout });
  activeLayout.current = { key: layoutStateKey, viewId: selectedViewId, value: defaultLayout };
  const { order: columnOrder, visible: visibleColumns } = selectedViewId ? viewLayout : defaultLayout;
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
    if (followupScope && followupSnapshot?.scope === followupScope) followupSnapshot = undefined;
    scopeActive.current = false;
    problemResource.current = ''; viewResource.current = ''; viewGeneration.current += 1;
    processReads.current.forEach(controller => controller.abort()); processReads.current.clear();
    setAccessLost(true); setResult(undefined); setViews([]); setViewTotal(0); setSelectedViewId(''); setViewName('');
    setResultLoading(false); setViewsLoading(false); setMutating(false); setWriteForbidden(true);
  }, [followupScope]);
  useEffect(() => {
    if (followupScope && organizationId && !accessLost) {
      followupSnapshot = { scope: followupScope, page, filters: appliedFilters, sort, selectedViewId, layout: viewLayout };
    }
  }, [followupScope, organizationId, accessLost, page, appliedFilters, sort, selectedViewId, viewLayout]);
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
    if (!restored) setPage(1);
  }, [explicitOrganization, organizationId, restored]);

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

  const query = useMemo<ProblemQuery | ProcessFollowupQuery | undefined>(() => {
    if (!organizationId || accessLost) return undefined;
    if (processOnly) {
      const { search, overdueAt, processFollowupFilters } = appliedFilters;
      return { organizationId, page, pageSize, ...(search ? { search } : {}), ...(overdueAt ? { overdueAt } : {}),
        ...(processFollowupFilters ? { filters: JSON.stringify(processFollowupFilters) } : {}), ...sort };
    }
    const value: ProblemQuery = { organizationId, page, pageSize, ...normalizeFilters(appliedFilters), ...sort };
    if (processQuality) {
      value.domainCode = eightDDomain ?? 'process-quality';
      if (eightDDomain) {
        value.sourceType = eightDDomain === 'customer-quality' ? 'customer-complaint' : 'new-product-defect-selection';
        delete value.problemType;
      } else value.problemType = 'PROCESS_DEFECT';
      value.responseForm = 'EIGHT_D';
    }
    return value;
  }, [appliedFilters, organizationId, page, pageSize, sort, processOnly, processQuality, eightDDomain, accessLost]);

  useEffect(() => {
    if (!query || processQuality && !scopeActive.current) return;
    const controller = new AbortController();
    if (processQuality) processReads.current.add(controller);
    const key = JSON.stringify(query);
    problemResource.current = key;
    setResult(undefined);
    setResultError(undefined);
    setResultLoading(true);
    const request = processOnly ? getProcessFollowup : getProblemIndex;
    void request(query, controller.signal).then((response) => {
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
  }, [query, revision, processOnly, processQuality, revokeProcessAccess]);

  const selectedView = views.find((view) => view.id === selectedViewId);
  function changeColumnLayout(next: Partial<ColumnLayout>) {
    if (activeLayout.current.key !== layoutStateKey || activeLayout.current.viewId !== selectedViewId) return;
    if (selectedViewId) setViewLayout(current => ({ ...current, ...next }));
    else {
      const value = { ...activeLayout.current.value, ...next };
      activeLayout.current.value = value;
      setDefaultLayout(value);
    }
  }
  const configuration = useMemo<ProblemViewConfiguration>(() => ({
    schemaVersion: 1,
    filters: processOnly ? normalizeFollowupFilters(filters) : { ...filters, ...(eightDDomain ? { domainCode: eightDDomain, problemType: undefined } : {}) },
    sort: processOnly ? draftSort : sort,
    visibleColumns,
    columnOrder,
  }), [columnOrder, filters, draftSort, sort, visibleColumns, processOnly, eightDDomain]);

  const applyConfiguration = (next: ProblemViewConfiguration, name?: string) => {
    const normalized = normalizeConfiguration(next, processOnly);
    const nextFilters = normalized.filters;
    if (processOnly && nextFilters.overdueAt) nextFilters.overdueAt = new Date().toISOString();
    const nextSort = normalized.sort;
    setFilters(nextFilters);
    setSearchInput(nextFilters.search ?? '');
    setAppliedFilters(nextFilters);
    setSort(nextSort);
    setDraftSort(nextSort);
    changeColumnLayout({ visible: normalized.visibleColumns, order: normalized.columnOrder });
    if (name !== undefined) setViewName(name);
    setPage(1);
    setMutationError(undefined);
    setMutationMessage('');
    setConflicted(false);
  };

  const switchOrganization = () => {
    const selected = organizationInput.trim();
    if (!selected || processOnly && selected === organizationId) return;
    if (processOnly) followupSnapshot = undefined;
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

  const draftGroup = filters.processFollowupFilters ?? emptyFollowupGroup;
  const completeDraft = normalizeFollowupFilters(filters);
  const draftTooLong = followupFiltersTooLong(completeDraft.processFollowupFilters);
  function setDraftGroup(next: FollowupGroup) {
    setFilters(current => ({ ...current, processFollowupFilters: next }));
  }
  function updateCondition(index: number, next: FollowupCondition) {
    setDraftGroup({ ...draftGroup, items: draftGroup.items.map((item, itemIndex) => itemIndex === index ? next : item) });
  }
  function newCondition(field: FollowupField): FollowupCondition {
    return { field, operator: followupOperators(field)[0]![0] };
  }
  const focusFilter = useCallback(() => {
    const control = filterControl.current;
    control?.focus({ preventScroll: true });
    const rows = filterRows.current;
    const row = control?.parentElement;
    if (!rows || !row || row.parentElement !== rows) return;
    const bounds = row.getBoundingClientRect();
    const top = rows.getBoundingClientRect().top + rows.clientTop;
    const bottom = top + rows.clientHeight;
    if (bounds.top < top) rows.scrollTop -= Math.ceil(top - bounds.top);
    else if (bounds.bottom > bottom) rows.scrollTop += Math.ceil(bounds.bottom - bottom);
  }, []);
  function openFilters(anchor: HTMLElement, field?: FollowupField) {
    filterAnchor.current = anchor;
    const next = filterOpen ? filters : appliedFilters;
    const group = next.processFollowupFilters ?? emptyFollowupGroup;
    const found = field ? group.items.findIndex(item => item.field === field) : -1;
    const append = !!field && found < 0 && group.items.length < followupMaxItems;
    const row = found >= 0 ? found : append ? group.items.length : undefined;
    setFilterRow(row);
    setFilters(append ? { ...next, processFollowupFilters: { ...group, items: [...group.items, newCondition(field)] } } : next);
    if (!filterOpen) setDraftSort(sort);
    else if (row === filterRow) focusFilter();
    setFilterOpen(true);
  }
  useEffect(() => {
    if (filterOpen) focusFilter();
  }, [filterOpen, filterRow, focusFilter]);

  function applyFilters(restoreFocus: boolean, next = completeDraft, nextSort = draftSort, submittedSearch = false) {
    if (followupFiltersTooLong(next.processFollowupFilters)) return;
    const changed = JSON.stringify(next) !== JSON.stringify(appliedFilters) || nextSort.sortBy !== sort.sortBy || nextSort.sortDirection !== sort.sortDirection;
    if (changed) {
      setAppliedFilters(next);
      setSort(nextSort);
      setPage(1);
    }
    setFilters(next);
    if (submittedSearch) setSearchInput(next.search ?? '');
    setFilterOpen(false);
    if (restoreFocus) filterAnchor.current?.focus({ preventScroll: true });
  }

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
      setViewLayout({ visible: visibleColumns, order: columnOrder });
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

  const columns = (() => {
    const definitions: Record<ColumnKey, TableColumnsType<ProblemItem>[number]> = {
      reportNumber: { title: t('报告编号'), dataIndex: 'reportNumber', render: (value: string, item) => <Link to={`/app/problem-workspace/${item.id}?organizationId=${encodeURIComponent(item.organizationId)}`} state={processOnly ? { processFollowupReturnScope: explicitOrganization ? 'explicit' : 'primary' } : undefined}>{value}</Link> },
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
    if (processOnly) {
      definitions.title = { title: t('问题标题'), ellipsis: { showTitle: false }, render: (_, item: ProblemItem) => {
        const { summary, reportNumber } = item;
        const title = summary.title && summary.title !== reportNumber && summary.title !== summary.description.slice(0, 200) ? summary.title : summary.description || summary.title;
        return <ProcessProblemTitle summary={{ ...summary, description: title }} />;
      } };
      definitions.dueAt = { title: t('办理期限'), render: (_, item: ProblemItem) => {
        const value = item.dueAt;
        const date = value && item.status !== 'CLOSED' && item.status !== 'ARCHIVED' ? new Date(value) : undefined;
        if (!date || !Number.isFinite(date.getTime())) return '—';
        return <time dateTime={date.toISOString()}>{date.toLocaleString(locale)}</time>;
      } };
      const widths: Partial<Record<LayoutKey, number>> = { reportNumber: 138, title: 245, processStage: 126, status: 90, severity: 84, responsibleParty: 130, ownerId: 104, dueAt: 170 };
      return processColumns.map((key): TableColumnsType<ProblemItem>[number] => {
        const definition = key === 'processStage' ? { title: t('当前环节'), render: (_: unknown, item: ProblemItem) =>
          t('stage' in item && isFollowupStage(item.stage) ? followupStageLabels[item.stage] : '—') } : definitions[key];
        const label = String(definition.title);
        const field = processHeaderFilters[key];
        const triggerLabel = locale === 'en-US' ? `Filter by ${label}` : `按${label}筛选`;
        return { ...definition, key, width: widths[key] ?? 150, onHeaderCell: () => ({ 'aria-label': label }),
          title: field ? <LedgerFilterHeader aria-label={label} triggerLabel={triggerLabel} active={!!appliedFilters.processFollowupFilters?.items.some(item => item.field === field) || key === 'dueAt' && !!appliedFilters.overdueAt} expanded={filterOpen && filterAnchor.current?.getAttribute('aria-label') === triggerLabel} disabled={!organizationId} onOpen={anchor => openFilters(anchor, field)} /> : label };
      });
    }
    const selected: TableColumnsType<ProblemItem> = allColumns.map((column) => ({ ...definitions[column], key: column, width: column === 'title' ? 260 : 170 }));
    if (processQuality) selected.push(
      { title: t('当前阶段'), key: 'processStage', width: 170, render: (_, item) => t(processSummaryValue(item.summary, 'stage') || '—') },
      { title: t('当前期限'), key: 'processDeadlines', width: 230, render: (_, item) => <ProcessProblemDeadlines problem={item} /> },
    );
    return selected;
  })();

  const disabledWrites = writeForbidden || mutating || viewsLoading;
  if (accessLost) return <main className="problem-center"><h1 className="sr-only">{t(processQuality ? followupTitle : '问题管理面板')}</h1><Alert role="alert" type="warning" title={t('当前会话失效或无权访问，敏感内容已清除，请重新登录或联系授权人员。')} /></main>;
  const organizationControl = <Space.Compact><Input aria-label={t('组织上下文')} value={organizationInput} onChange={(event) => setOrganizationInput(event.target.value)} /><Button onClick={switchOrganization}>{t('切换组织')}</Button></Space.Compact>;
  const viewControls = <>
      <div className="problem-center__view-row">
        <label>{t('保存视图')}<select aria-label={t('保存视图')} value={selectedViewId} onChange={(event) => {
          const id = event.target.value;
          if (id) setViewLayout({ visible: visibleColumns, order: columnOrder });
          setSelectedViewId(id);
          const view = views.find((candidate) => candidate.id === id);
          if (view) setViewName(view.name);
        }} disabled={viewsLoading}><option value="">{t('请选择')}</option>{views.map((view) => <option value={view.id} key={view.id}>{view.name}</option>)}</select></label>
        <label>{t('视图名称')}<Input aria-label={t('视图名称')} value={viewName || (processOnly && restored?.selectedViewId === selectedViewId ? selectedView?.name : '')} maxLength={80} onChange={(event) => setViewName(event.target.value)} /></label>
        <Space wrap>
          <Button disabled={!selectedView} onClick={() => selectedView && applyConfiguration(selectedView.configuration, selectedView.name)}>{t('应用视图')}</Button>
          <Button type="primary" disabled={disabledWrites || processOnly && draftTooLong} loading={mutating} onClick={saveView}>{t('保存新视图')}</Button>
          <Button disabled={disabledWrites || !selectedView || processOnly && draftTooLong} loading={mutating} onClick={updateView}>{t('更新视图')}</Button>
          <Popconfirm
            title={selectedView ? `${locale === 'en-US' ? 'Delete personal view' : '删除个人视图'} · ${selectedView.name}` : undefined}
            description={locale === 'en-US' ? 'Only the view settings are removed. Problem records are retained.' : '仅移除视图配置，问题记录保留。'}
            okText={t('删除')}
            cancelText={t('取消')}
            okButtonProps={{ danger: true }}
            disabled={disabledWrites || !selectedView}
            getPopupContainer={processOnly ? trigger => trigger.parentElement ?? trigger : undefined}
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
    </>;
  const statusCounts = result?.statusCounts.length ? <Space wrap className="problem-center__counts">{result.statusCounts.map((entry) => <Tag key={entry.status}>{t(statusLabels[entry.status])}: {entry.count}</Tag>)}</Space> : null;
  const updateColumnOrder = (keys: string[]) => changeColumnLayout({ order: keys.filter((key): key is LayoutKey => (processOnly ? processColumns : allColumns).includes(key as ColumnKey)) });
  const updateVisibleColumns = (keys: string[]) => changeColumnLayout({ visible: keys.filter((key): key is LayoutKey => (processOnly ? processColumns : allColumns).includes(key as ColumnKey)) });
  const emptyText = <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={page > 1 && (result?.total ?? 0) > 0 ? t('本页暂无问题') : t(processOnly && Object.keys(appliedFilters).length ? '没有匹配的问题' : '暂无问题')} />;
  const refresh = () => {
    if (processOnly && appliedFilters.overdueAt) {
      const overdueAt = new Date().toISOString();
      const advanceOverdueCutoff = (current: ProblemFilters) => current.overdueAt && current.overdueAt !== overdueAt ? { ...current, overdueAt } : current;
      setAppliedFilters(advanceOverdueCutoff);
      setFilters(advanceOverdueCutoff);
    }
    setRevision(value => value + 1);
  };
  if (processOnly) return <main className="problem-center process-quality-page">
    <h1 className="sr-only">{t(followupTitle)}</h1>
    <Feedback error={organizationError} t={t} />
    {statusCounts}
    <section aria-label={t('问题列表')} className="process-quality-card process-quality-compact-ledger">
      <LedgerTable<ProblemItem> compactHeaders compactLayout pinnedHorizontalScroll className="process-quality-ledger"
        actionBar={<div className="process-quality-toolbar-main" role="group" aria-label={t('台账工具栏')}>
          <Input.Search aria-label={t('搜索报告编号或问题标题')} placeholder={t('搜索报告编号或问题标题')} allowClear maxLength={100} disabled={!organizationId} value={searchInput}
            onChange={event => setSearchInput(event.target.value)} onSearch={search => applyFilters(false, normalizeFollowupFilters({ ...(filterOpen ? filters : appliedFilters), search }), filterOpen ? draftSort : sort, true)} />
          <LedgerFilterPopover open={filterOpen} trigger={filterTrigger} label={t('筛选条件')} count={(appliedFilters.processFollowupFilters?.items.length ?? 0) + Number(!!appliedFilters.overdueAt)} disabled={!organizationId}
            onOpen={openFilters} onDismiss={applyFilters} onFocus={focusFilter}>
            <LedgerFilterPanel anchor={filterAnchor} trigger={filterTrigger} label={t('筛选面板')} title={t('筛选条件')} closeLabel={t('关闭筛选')} onDismiss={applyFilters}>
              <Checkbox checked={!!filters.overdueAt} onChange={event => setFilters(current => ({ ...current, overdueAt: event.target.checked ? new Date().toISOString() : undefined }))}>{t('仅看当前已逾期')}</Checkbox>
              <div className="process-quality-filter-logic"><span>{t('满足条件')}</span>
                <select ref={filterRow === undefined ? filterControl : undefined} aria-label={t('筛选逻辑')} value={draftGroup.logic} onChange={event => setDraftGroup({ ...draftGroup, logic: event.target.value === 'ANY' ? 'ANY' : 'ALL' })}>
                  <option value="ALL">{t('全部条件')}</option><option value="ANY">{t('任一条件')}</option>
                </select>
              </div>
              <div ref={filterRows} className="process-quality-filter-rows problem-center__popup-filter-rows">
                {draftGroup.items.map((item, index) => {
                  const { field, operator } = item;
                  const valueLabel = `${t('筛选值')} ${index + 1}`;
                  const choices = field === 'stage' ? Object.entries(followupStageLabels).map(([value, text]) => [value, t(text)])
                    : field === 'status' ? statuses.map(value => [value, t(statusLabels[value])])
                      : field === 'severity' ? followupSeverities.map(value => [value, severityText(value)]) : undefined;
                  const updateValue = (value?: string) => updateCondition(index, { ...item, value });
                  return <LedgerFilterCondition key={index} index={index} field={field} operator={operator} label={t}
                    fieldRef={filterRow === index ? filterControl : undefined}
                    fields={followupFields.map(([value, text]) => [value, t(text)])}
                    operators={followupOperators(field).map(([value, text]) => [value, t(text)])}
                    onFieldChange={value => { if (value !== field) updateCondition(index, newCondition(value as FollowupField)); }}
                    onOperatorChange={value => updateCondition(index, { ...item, operator: value as FollowupCondition['operator'] })}
                    onRemove={() => { setFilterRow(undefined); setDraftGroup({ ...draftGroup, items: draftGroup.items.filter((_, entry) => entry !== index) }); }}>
                    {withoutValue(operator) ? <span /> : choices ? <select aria-label={valueLabel} value={item.value ?? ''} onChange={event => updateValue(event.target.value)}>
                      <option value="">{t('请选择')}</option>{choices.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                    </select> : field === 'dueAt' ? <input type="datetime-local" aria-label={valueLabel} value={localDateTime(item.value)} onChange={event => updateValue(isoDateTime(event.target.value))} />
                      : <input type="text" aria-label={valueLabel} maxLength={100} value={item.value ?? ''} onChange={event => updateValue(event.target.value)} />}
                  </LedgerFilterCondition>;
                })}
              </div>
              {draftTooLong ? <Alert type="warning" showIcon title={t('筛选内容过长，请缩短文字或减少条件。')} /> : null}
              <Space wrap>
                <Button disabled={draftGroup.items.length >= followupMaxItems} onClick={() => { setFilterRow(draftGroup.items.length); setDraftGroup({ ...draftGroup, items: [...draftGroup.items, newCondition('stage')] }); }}>{t('添加筛选条件')}</Button>
                <Button onClick={() => { applyFilters(true, {}, defaultConfiguration.sort, true); }}>{t('恢复系统默认筛选')}</Button>
                <Button aria-label={t('清空')} onClick={() => { setFilterRow(undefined); setFilters(current => ({ search: current.search })); setDraftSort(defaultConfiguration.sort); }}>{t('清空')}</Button>
                <Button type="primary" disabled={draftTooLong} onClick={() => applyFilters(true)}>{t('应用筛选')}</Button>
              </Space>
              <div className="problem-center problem-center__popup">
                <div className="problem-center__filters">
                  <label>{t('排序字段')}<select aria-label={t('排序字段')} value={draftSort.sortBy} onChange={event => setDraftSort(current => ({ ...current, sortBy: event.target.value as ProblemSort['sortBy'] }))}>{sortFields.map(value => <option key={value} value={value}>{t(value === 'severity' ? '风险' : value === 'dueAt' ? '办理期限' : sortLabels[value])}</option>)}</select></label>
                  <label>{t('排序方向')}<select aria-label={t('排序方向')} value={draftSort.sortDirection} onChange={event => setDraftSort(current => ({ ...current, sortDirection: event.target.value === 'asc' ? 'asc' : 'desc' }))}><option value="desc">{t('降序')}</option><option value="asc">{t('升序')}</option></select></label>
                </div>
                {organizationControl}
                {viewControls}
              </div>
            </LedgerFilterPanel>
          </LedgerFilterPopover>
          <Button aria-label={t('刷新')} loading={resultLoading} disabled={!organizationId} onClick={refresh}>{t('刷新')}</Button>
        </div>}
        ledgerId={ledgerId} organizationId={organizationId} viewId={selectedViewId || 'default'} requiredColumnKeys={['reportNumber']}
        columnOrder={columnOrder} visibleColumnKeys={visibleColumns} onColumnOrderChange={updateColumnOrder} onVisibleColumnKeysChange={updateVisibleColumns}
        rowKey="id" loading={resultLoading} columns={columns} dataSource={result?.items ?? []} locale={{ emptyText: resultLoading ? t('加载中') : emptyText }}
        bodyFallback={resultError ? <Space wrap><Feedback error={resultError} t={t} /><Button onClick={refresh}>{t('重试')}</Button></Space> : undefined}
        pagination={{ current: page, pageSize, total: result?.total ?? 0, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: total => <Typography.Text>{t('总数')}: {total}</Typography.Text>,
          onChange: (next, size) => { setPageSize(size); setPage(size === pageSize ? Math.min(10001, next) : 1); } }} />
    </section>
  </main>;

  return <main className="problem-center">
    <div className="problem-center__heading">
      <h1 className="sr-only">{t(processQuality ? followupTitle : '问题管理面板')}</h1>
      <Space wrap>
        {organizationControl}
        {processQuality ? <Button loading={resultLoading} onClick={refresh}>{t('刷新')}</Button> : null}
      </Space>
    </div>
    <Feedback error={organizationError} t={t} />
    <Card title={t('保存视图')} loading={!organizationId && !organizationError}>{viewControls}</Card>

    <section aria-label={t('问题列表')}>
      {statusCounts}
      <Feedback error={resultError} t={t} />
      <LedgerTable<ProblemItem> actionBar={<details className="problem-center__query" open={true}><summary>{t('筛选与排序')}</summary>
      <div className="problem-center__filters">
        <label>{t('报告编号检索')}<Input aria-label={t('报告编号检索')} value={filters.search ?? ''} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value || undefined }))} /></label>
        {!processQuality ? <label>{t('领域代码')}<Input aria-label={t('领域代码')} value={filters.domainCode ?? ''} onChange={(event) => setFilters((current) => ({ ...current, domainCode: event.target.value || undefined }))} /></label> : null}
        {!processQuality ? <label>{t('问题类型')}<Input aria-label={t('问题类型')} value={filters.problemType ?? ''} onChange={(event) => setFilters((current) => ({ ...current, problemType: event.target.value || undefined }))} /></label> : null}
        <label>{t('状态')}<select aria-label={t('状态筛选')} value={filters.status ?? ''} onChange={(event) => setFilters((current) => ({ ...current, status: (event.target.value || undefined) as ProblemStatus | undefined }))}><option value="">{t('全部状态')}</option>{statuses.map((status) => <option key={status} value={status}>{t(statusLabels[status])}</option>)}</select></label>
        <label>{t('严重度')}<Input aria-label={t('严重度筛选')} value={filters.severity ?? ''} onChange={(event) => setFilters((current) => ({ ...current, severity: event.target.value || undefined }))} /></label>
        <label>{t('负责人 ID')}<Input aria-label={t('负责人 ID')} value={filters.ownerId ?? ''} onChange={(event) => setFilters((current) => ({ ...current, ownerId: event.target.value || undefined }))} /></label>
        <label>{t(processQuality ? '问题截止起始' : '截止起始')}<input aria-label={t(processQuality ? '问题截止起始' : '截止起始')} type="datetime-local" value={localDateTime(filters.dueFrom)} onChange={(event) => setFilters((current) => ({ ...current, dueFrom: isoDateTime(event.target.value) }))} /></label>
        <label>{t(processQuality ? '问题截止结束' : '截止结束')}<input aria-label={t(processQuality ? '问题截止结束' : '截止结束')} type="datetime-local" value={localDateTime(filters.dueTo)} onChange={(event) => setFilters((current) => ({ ...current, dueTo: isoDateTime(event.target.value) }))} /></label>
        <label>{t('排序字段')}<Select aria-label={t('排序字段')} value={sort.sortBy} options={sortFields.map((value) => ({ value, label: t(processQuality && value === 'dueAt' ? '问题截止时间' : sortLabels[value]) }))} onChange={(sortBy) => { setSort((current) => ({ ...current, sortBy })); setPage(1); }} /></label>
        <label>{t('排序方向')}<Select aria-label={t('排序方向')} value={sort.sortDirection} options={[{ value: 'desc', label: t('降序') }, { value: 'asc', label: t('升序') }]} onChange={(sortDirection) => { setSort((current) => ({ ...current, sortDirection })); setPage(1); }} /></label>
      </div>
      <Space wrap className="problem-center__filter-actions">
        <Checkbox checked={Boolean(filters.overdueAt)} onChange={(event) => setFilters((current) => ({ ...current, overdueAt: event.target.checked ? new Date().toISOString() : undefined }))}>{t('仅看当前已逾期')}</Checkbox>
        {filters.overdueAt ? <Typography.Text type="secondary">{t('逾期基准')}: {new Date(filters.overdueAt).toLocaleString(locale)}</Typography.Text> : null}
        <Button type="primary" onClick={() => { setAppliedFilters({ ...filters }); setPage(1); }}>{t('查询')}</Button>
        <Button onClick={() => applyConfiguration(defaultConfiguration, '')}>{t('重置')}</Button>
      </Space>
      </details>} ledgerId={ledgerId} organizationId={organizationId} viewId={selectedViewId || 'default'} toolbarContent={!resultError && result ? <><Typography.Text>{t('总数')}: {result.total}</Typography.Text><Pagination current={page} pageSize={pageSize} total={result.total} showSizeChanger pageSizeOptions={[10, 20, 50, 100]} onChange={(nextPage, nextPageSize) => { setPageSize(nextPageSize); setPage(Math.min(10001, nextPageSize === pageSize ? nextPage : 1)); }} /></> : null} requiredColumnKeys={processQuality ? ['reportNumber', 'processStage', 'processDeadlines'] : ['reportNumber']} columnOrder={columnOrder} visibleColumnKeys={visibleColumns} onColumnOrderChange={keys => changeColumnLayout({ order: keys.filter((key): key is ColumnKey => allColumns.includes(key as ColumnKey)) })} onVisibleColumnKeysChange={keys => changeColumnLayout({ visible: keys.filter((key): key is ColumnKey => allColumns.includes(key as ColumnKey)) })} rowKey="id" loading={resultLoading} columns={columns} showHeader={!resultError} dataSource={resultError ? [] : result?.items ?? []} pagination={false} locale={{ emptyText: resultError ? null : resultLoading ? t('加载中') : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={page > 1 && (result?.total ?? 0) > 0 ? t('本页暂无问题') : t('暂无问题')} /> }} scroll={{ x: 'max-content' }} />
    </section>
  </main>;
}
