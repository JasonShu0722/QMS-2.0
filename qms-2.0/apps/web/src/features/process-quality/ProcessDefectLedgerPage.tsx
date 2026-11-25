import type { components } from '@qms/contracts';
import { Alert, Button, Checkbox, Descriptions, Drawer, Empty, Input, Popover, Space, Spin, Table, Tag, Typography, type TableColumnsType } from 'antd';
import { Eye, Filter, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, apiRequest, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import './process-quality.css';
import { useCompletedSessionNavigation, useNavigationGuard } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { LedgerTable, useLedgerPageSize } from '../../ui/ledger';
import { RecordList } from '../../ui/list/RecordList';
import { preferenceKey } from '../../ui/ledger/model';
import { useLedgerScope, usePreference } from '../../ui/ledger/preferences';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { ProcessEightDIssueDrawer } from './ProcessEightDIssueDrawer';
import { ProcessDefectEditor } from './ProcessDefectEditor';
import { ProcessDefectDeletionDialog } from './ProcessDefectDeletionDialog';
import { boardLabels, dispositionLabels, maintenanceLimit, ProcessDefectBoardDialog, type MaintenanceBoard, type MaintenanceTarget } from './ProcessDefectBoardDialog';
import { ProcessAiDescription } from './ProcessAiDescription';
import { categoryLabels, categoryOptions, CompletionStatus, denied, MappingHint, ProcessError, verificationLabels } from './process-ledger';
import { factoryChoices, factoryFieldLabel, factoryLabel } from './process-factory';

type Defect = components['schemas']['ProcessDefectDto'];
type DefectDetail = components['schemas']['ProcessDefectDetailDto'];
type DefectPage = components['schemas']['ProcessDefectPageDto'];
type IssueResult = components['schemas']['ProcessIssueResultDto'];
type LinkedProblem = components['schemas']['ProcessIssueProblemDto'];
type BoardCapabilities = components['schemas']['ProcessLedgerWorkflowCapabilitiesDto'];

const deletionLimit = 1000;
const formalIssueLimit = 100;
const pageSizeOptions = [10, 20, 50, 100, 500, deletionLimit];
const occurrenceDateOptions = { year: 'numeric', month: '2-digit', day: '2-digit' } as const;
const occurrenceTimestampOptions = { ...occurrenceDateOptions, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false } as const;
const occurrenceDate = new Intl.DateTimeFormat('zh-CN', { ...occurrenceDateOptions, timeZone: 'Asia/Shanghai' });
const occurrenceTimestamp = new Intl.DateTimeFormat('zh-CN', occurrenceTimestampOptions);
const listTimestamp = new Intl.DateTimeFormat('zh-CN', { ...occurrenceTimestampOptions, timeZone: 'Asia/Shanghai' });
const maintenanceColumnKeys = ['analysisProgress', 'dispositionPlan', 'dispositionProgress', 'dispositionCompletedAt'] as const;
const responsibility = (value: Defect['responsibilityCategory']) => value ? categoryLabels[value] : '待分析';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type FilterLogic = 'ALL' | 'ANY';
type FilterField = components['schemas']['ProcessDefectFilterDto']['field'];
type FilterItem = { field: FilterField; operator: string; value?: string };
type FilterState = { currentMonth: boolean; logic: FilterLogic; items: FilterItem[] };
type FilterPreference = { search: string; filters: FilterState };
const filterFields = [
  ['occurredAt', '发生时间', 'Occurred at'], ['factoryCode', ...factoryFieldLabel], ['shift', '班次', 'Shift'], ['projectCode', '项目号', 'Project number'], ['projectStage', '项目状态', 'Project stage'], ['productCategory', '产品类型', 'Product category'], ['productSubcategory', '细分类型', 'Product subcategory'],
  ['description', '不良描述', 'Defect description'], ['traceCode', '追溯码', 'Trace code'], ['lineName', '生产线名称', 'Line name'], ['operationName', '工序名称', 'Operation name'],
  ['operationSector', '板块', 'Sector'], ['defectQuantity', '不良数量', 'Defect quantity'], ['ledgerStatus', '台账状态', 'Ledger status'], ['responsibilityCategory', '责任类别', 'Responsibility category'],
  ['pendingCompletion', '完善情况', 'Completion pending'], ['pendingConfiguration', '配置情况', 'Configuration pending'],
  ['defectTypeCode', '不良类型', 'Defect type'], ['productCode', '成品编码', 'Product code'], ['batchCode', '批次', 'Batch code'], ['workOrderCode', '工单号', 'Work order'],
  ['lineCode', '生产线编码', 'Line code'], ['operationCode', '工序编码', 'Operation code'], ['materialCode', '物料编码', 'Material code'],
  ['registeredByName', '登记人', 'Registrant'], ['firstMaterialCode', '首条物料 / 供应商', 'First material / supplier'], ['manualProjectCode', '人工项目', 'Manual project'], ['batchOrWorkOrder', '批次 / 工单', 'Batch / work order'],
  ['analysisProgress', '分析进度', 'Analysis progress'], ['dispositionPlan', '处置方案', 'Disposition plan'], ['dispositionProgress', '处置进度', 'Disposition progress'], ['dispositionCompletedAt', '处置完成时间', 'Disposition completion date'],
] as const satisfies ReadonlyArray<readonly [FilterField, string, string]>;
const equals = [['EQ', '等于', 'Equals'], ['NE', '不等于', 'Does not equal']];
const empty = [['EMPTY', '为空', 'Is empty'], ['NOT_EMPTY', '不为空', 'Is not empty']];
const textOperators = [['CONTAINS', '包含', 'Contains'], ['NOT_CONTAINS', '不包含', 'Does not contain'], ...equals, ...empty];
const dateOperators = [['AFTER', '晚于', 'After'], ['BEFORE', '早于', 'Before'], ...equals, ...empty];
const numberOperators = [...equals, ['GT', '大于', 'Greater than'], ['GTE', '大于等于', 'At least'], ['LT', '小于', 'Less than'], ['LTE', '小于等于', 'At most'], ...empty];
const enumOperators = [...equals, ...empty];
const filterChoices: Partial<Record<FilterField, string[][]>> = {
  factoryCode: factoryChoices,
  shift: [['DAY', '白班', 'Day'], ['NIGHT', '夜班', 'Night']],
  projectStage: [['NEW_PRODUCT', '新品', 'New product'], ['MASS_PRODUCTION', '量产', 'Mass production']],
  ledgerStatus: [['FOLLOWING', '跟进中', 'Following'], ['CLOSED', '已关闭', 'Closed']],
  responsibilityCategory: categoryOptions.map(({ value, label }) => [value, label, value]),
  dispositionPlan: Object.entries(dispositionLabels).map(([value, label]) => [value, label, value]),
  pendingCompletion: [['true', '待完善', 'Pending'], ['false', '已完善', 'Complete']],
  pendingConfiguration: [['true', '待补配', 'Pending'], ['false', '已配置', 'Configured']],
};
const allowedFields = new Set<string>(filterFields.map(([field]) => field));
const booleanField = (field: FilterField) => field === 'pendingCompletion' || field === 'pendingConfiguration';
const dateField = (field: FilterField) => field === 'occurredAt' || field === 'dispositionCompletedAt';
const emptyOperator = (operator: string) => operator === 'EMPTY' || operator === 'NOT_EMPTY';
const defaultFilters: FilterState = { currentMonth: true, logic: 'ALL', items: [] };
function operatorsFor(field: FilterField) {
  return dateField(field) ? dateOperators : field === 'defectQuantity' ? numberOperators : booleanField(field) ? equals.slice(0, 1) : filterChoices[field] ? enumOperators : textOperators;
}
function filterItem(field: FilterField): FilterItem { return { field, operator: operatorsFor(field)[0][0], value: '' }; }
function filterValue(item: FilterItem): string | number | boolean | undefined {
  const value = item.value?.trim();
  if (emptyOperator(item.operator) || !value) return undefined;
  if (filterChoices[item.field] && !filterChoices[item.field]?.some(([choice]) => choice === value)) return undefined;
  if (booleanField(item.field)) return value === 'true';
  if (item.field === 'defectQuantity') {
    const number = Number(value);
    return Number.isInteger(number) && number >= -2147483648 && number <= 2147483647 ? number : undefined;
  }
  if (dateField(item.field)) {
    const date = new Date(`${value}T00:00:00Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
  }
  return value.length <= 200 ? value : undefined;
}
function serializeFilters({ logic, items }: FilterState) {
  return items.length ? JSON.stringify({ logic, items: items.map(item => ({ field: item.field, operator: item.operator, value: filterValue(item) })) }) : '';
}
// Leave room for the search text and paging in the gateway's request line.
const filtersTooLong = (serialized: string) => new URLSearchParams({ filters: serialized }).toString().length > 5500;
function normalizeFilterPreference(input: unknown): FilterPreference {
  if (!input || typeof input !== 'object') return { search: '', filters: defaultFilters };
  const { search, filters } = input as Partial<FilterPreference>;
  if (!Array.isArray(filters?.items) || filters.items.length > 10 || !['ALL', 'ANY'].includes(filters.logic)) return { search: '', filters: defaultFilters };
  const items = filters.items.filter(item => item && allowedFields.has(item.field) && operatorsFor(item.field as FilterField).some(([operator]) => operator === item.operator) && (emptyOperator(item.operator) || typeof item.value === 'string' && filterValue(item as FilterItem) !== undefined)) as FilterItem[];
  if (items.length !== filters.items.length) return { search: '', filters: defaultFilters };
  const preference = { currentMonth: filters.currentMonth === true, logic: filters.logic, items };
  return { search: typeof search === 'string' ? search.trim().slice(0, 200) : '', filters: filtersTooLong(serializeFilters(preference)) ? defaultFilters : preference };
}
function monthBounds() {
  const parts = Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric' }).formatToParts(new Date());
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  return { occurredFrom: new Date(Date.UTC(year, month - 1, 1, -8)).toISOString(), occurredTo: new Date(Date.UTC(year, month, 1, -8)).toISOString() };
}

function isDenied(cause: unknown) {
  return cause instanceof ApiError && (cause.status === 403 || cause.code === 'FEATURE_PERMISSION_DENIED' || cause.code === 'ORGANIZATION_SCOPE_DENIED');
}

function errorText(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) return safeAccountError(cause);
  return fallback;
}

export function ProcessDefectLedgerPage() {
  const scope = useWorkTabsStore(state => state.sessionScope);
  const [query] = useSearchParams();
  const organizationId = query.get('organizationId') ?? undefined;
  const defectId = query.get('defectId') ?? undefined;
  if (organizationId !== undefined && !uuidPattern.test(organizationId) || defectId !== undefined && !uuidPattern.test(defectId)) return <Alert type="error" showIcon title="制程来源链接参数无效" />;
  const targetOrganizationId = organizationId ?? scope?.split(':')[1];
  return <ProcessLedgerContent key={`${scope ?? 'unbound'}:${targetOrganizationId ?? 'current'}`} organizationId={organizationId} targetOrganizationId={targetOrganizationId} initialDefectId={defectId} />;
}

function ProcessLedgerContent({ organizationId, targetOrganizationId, initialDefectId }: { organizationId?: string; targetOrganizationId?: string; initialDefectId?: string }) {
  const english = useLanguage().locale === 'en-US';
  const factoryTitle = factoryFieldLabel[english ? 1 : 0];
  const sessionScope = useWorkTabsStore(state => state.sessionScope);
  const sessionUserId = sessionScope?.split(':')[2];
  const [pageSize, setPageSize] = useLedgerPageSize('process-defects', targetOrganizationId, deletionLimit);
  const ledgerScope = useLedgerScope(targetOrganizationId);
  const viewId = 'ALL';
  const filterPreferenceStorageKey = preferenceKey(ledgerScope, 'process-defects', 'filters', viewId);
  const filterPreferenceStateKey = filterPreferenceStorageKey ?? JSON.stringify([ledgerScope, 'process-defects', 'filters', viewId]);
  const [savedFilterPreference, saveFilterPreference] = usePreference<FilterPreference>(filterPreferenceStorageKey, ledgerScope.sessionScope, normalizeFilterPreference, filterPreferenceStateKey);
  const navigate = useNavigate();
  const completeSessionNavigation = useCompletedSessionNavigation();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState(savedFilterPreference.search);
  const search = savedFilterPreference.search;
  const [draftFilters, setDraftFilters] = useState<FilterState>(() => savedFilterPreference.filters);
  const appliedFilters = savedFilterPreference.filters;
  const [filterOpen, setFilterOpen] = useState(false);
  const [result, setResult] = useState<DefectPage>();
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<unknown>();
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Record<string, Defect>>({});
  const [detail, setDetail] = useState<DefectDetail>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<unknown>();
  const [linked, setLinked] = useState<LinkedProblem[]>([]);
  const [issued, setIssued] = useState<IssueResult>();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [permissionsChecked, setPermissionsChecked] = useState(false);
  const [accessLost, setAccessLost] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [formalOpen, setFormalOpen] = useState(false);
  const [editor, setEditor] = useState<Defect | 'new'>();
  const [suppliers, setSuppliers] = useState<components['schemas']['SupplierProfileDto'][]>([]);
  const [supplierError, setSupplierError] = useState<unknown>();
  const [boardTarget, setBoardTarget] = useState<MaintenanceTarget>();
  const [boardDenied, setBoardDenied] = useState(false);
  const [capabilities, setCapabilities] = useState<{ revision: number; value: BoardCapabilities }>();
  const [capabilityError, setCapabilityError] = useState<unknown>();
  const [deletionTargets, setDeletionTargets] = useState<Defect[]>();
  const [deletionOpen, setDeletionOpen] = useState(false);
  const alive = useRef(true);
  const filterAnchor = useRef<HTMLElement>(undefined);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const filterControl = useRef<HTMLSelectElement>(null);
  const [filterRow, setFilterRow] = useState<number>();
  const detailRequest = useRef(0);
  const detailTarget = useRef<string>(undefined);
  const detailController = useRef<AbortController>(undefined);
  const listController = useRef<AbortController>(undefined);
  const requestedMonthStart = useRef<string>(undefined);
  const linkedTarget = useRef<string>(undefined);
  useEffect(() => { alive.current = true; return () => { alive.current = false; detailController.current?.abort(); detailRequest.current += 1; }; }, []);
  const canRead = permissions.includes('process-quality:defects:read');
  const canWrite = permissions.includes('process-quality:defects:write');
  const canDelete = canRead && permissions.includes('process-quality:defects:delete');
  const selectionLimit = canDelete ? deletionLimit : formalIssueLimit;
  const boards = capabilities?.revision === revision && Array.isArray(capabilities.value?.boards) ? capabilities.value.boards : [];
  const canRegister = canWrite && boards.includes('REGISTRATION');
  const canIssue = permissions.includes('process-quality:issues:issue');
  const canReadSuppliers = permissions.includes('supplier-quality:profiles:read');
  function revoke(cause?: unknown) {
    if (!alive.current) return;
    detailController.current?.abort(); listController.current?.abort();
    detailRequest.current += 1; setAccessLost(true); setResult(undefined); setSelected({}); setDetail(undefined); setLinked([]);
    setDetailOpen(false); setFormalOpen(false); setEditor(undefined); setBoardTarget(undefined); setSuppliers([]);
    setDeletionTargets(undefined); setDeletionOpen(false);
    if (cause instanceof ApiError && cause.status === 401) setUnauthorized(true);
  }
  useEffect(() => {
    if (unauthorized) completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
  }, [unauthorized, completeSessionNavigation, navigate]);
  const requestLeave = useNavigationGuard();

  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<components['schemas']['PermissionsResponseDto']>(scoped('/api/v1/system/my-permissions'), { signal: controller.signal }).then(value => { if (!controller.signal.aborted) { setPermissions(value.permissions ?? []); setPermissionsChecked(true); } }).catch(cause => { if (!controller.signal.aborted) { setPermissions([]); setPermissionsChecked(false); if (denied(cause)) revoke(cause); } });
    return () => controller.abort();
  }, [revision, organizationId]);
  function scoped(path: string, scopeId = organizationId) {
    return scopeId ? `${path}${path.includes('?') ? '&' : '?'}organizationId=${encodeURIComponent(scopeId)}` : path;
  }
  useEffect(() => {
    if (accessLost) return;
    const controller = new AbortController();
    setCapabilityError(undefined);
    void apiRequest<BoardCapabilities>(scoped('/api/v1/process-quality/ledger-workflow-configuration/capabilities', targetOrganizationId), { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setCapabilities({ revision, value });
    }).catch(cause => {
      if (controller.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) revoke(cause);
      else setCapabilityError(cause);
    });
    return () => controller.abort();
  }, [revision, targetOrganizationId, accessLost]);
  const serializedFilters = serializeFilters(appliedFilters);
  useEffect(() => {
    if (!canReadSuppliers || accessLost) { setSuppliers([]); return; }
    let active = true;
    setSupplierError(undefined);
    const controller = new AbortController();
    async function readSuppliers() {
      const items: components['schemas']['SupplierProfileDto'][] = [];
      let page = 1;
      while (active) {
        const value = await apiRequest<components['schemas']['SupplierProfilePageDto']>(scoped(`/api/v1/supplier-quality/profiles?page=${page}&pageSize=100`, targetOrganizationId), { signal: controller.signal });
        items.push(...value.items);
        if (items.length >= value.total) return items;
        if (!value.items.length) throw new Error('供应商资料分页不完整');
        page += 1;
      }
      return [];
    }
    void readSuppliers().then(value => { if (active) setSuppliers(value); }).catch(cause => { if (active) { setSuppliers([]); setSupplierError(cause); } });
    return () => { active = false; controller.abort(); };
  }, [canReadSuppliers, revision, accessLost, targetOrganizationId]);
  function supplierName(item: Defect['materials'][number]) {
    const profile = item.supplierProfileId
      ? suppliers.find(supplier => supplier.id === item.supplierProfileId)
      : item.supplierOrganizationId ? suppliers.find(supplier => supplier.supplierOrganizationId === item.supplierOrganizationId) : undefined;
    if (profile) return `${profile.displayName}（${profile.businessCode}）`;
    return item.supplierProfileId || item.supplierOrganizationId ? '供应商名称不可用' : '—';
  }
  function saved(record: Defect) {
    if (detail?.id === record.id) {
      setDetail({ ...detail, ...record, evidence: record.evidence ?? detail.evidence });
      void openDetail(record.id, true);
    }
    setRevision(value => value + 1);
  }
  useEffect(() => {
    if (accessLost) return;
    const month = appliedFilters.currentMonth ? monthBounds() : undefined;
    const monthChanged = month && requestedMonthStart.current && month.occurredFrom !== requestedMonthStart.current;
    requestedMonthStart.current = month?.occurredFrom;
    setLoading(true);
    setListError(undefined);
    if (monthChanged) {
      setSelected({});
      setResult(undefined);
      if (page !== 1) {
        setPage(1);
        return;
      }
    }
    const controller = new AbortController(); listController.current = controller;
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) query.set('search', search);
    if (month) for (const [key, value] of Object.entries(month)) query.set(key, value);
    if (serializedFilters) query.set('filters', serializedFilters);
    void apiRequest<DefectPage>(scoped(`/api/v1/process-quality/defects?${query}`), { signal: controller.signal }).then((value) => {
      if (controller.signal.aborted) return;
      setResult(value);
      const lastPage = Math.max(1, Math.ceil(value.total / pageSize));
      if (page > lastPage) setPage(lastPage);
      else setLoading(false);
    }).catch((cause) => {
      if (!controller.signal.aborted) { setResult(undefined); setListError(cause); setLoading(false); if (denied(cause)) revoke(cause); }
    });
    return () => controller.abort();
  }, [page, pageSize, search, revision, serializedFilters, appliedFilters.currentMonth, accessLost, organizationId]);

  async function openDetail(id: string, refresh = false) {
    detailController.current?.abort();
    const controller = new AbortController(); detailController.current = controller;
    const request = ++detailRequest.current;
    detailTarget.current = id;
    setDetailError(undefined);
    if (!refresh) {
      setDetailOpen(true);
      setDetail(undefined);
      setLinked([]);
      setDetailLoading(true);
    }
    try {
      const [record, problems] = await Promise.all([
        apiRequest<DefectDetail>(scoped(`/api/v1/process-quality/defects/${id}`), { signal: controller.signal }),
        apiRequest<LinkedProblem[]>(scoped(`/api/v1/process-quality/defects/${id}/issues`), { signal: controller.signal }),
      ]);
      if (!controller.signal.aborted && alive.current && request === detailRequest.current) {
        setDetail(current => refresh && current?.id === record.id && current.version > record.version ? current : record);
        setLinked(problems);
      }
    } catch (cause) { if (!controller.signal.aborted && alive.current && request === detailRequest.current) { setDetailError(cause); if (denied(cause)) revoke(cause); } }
    finally { if (!controller.signal.aborted && alive.current && request === detailRequest.current) setDetailLoading(false); }
  }

  useEffect(() => {
    if (!initialDefectId) {
      if (linkedTarget.current) { detailController.current?.abort(); detailRequest.current += 1; setDetailOpen(false); setDetail(undefined); setLinked([]); linkedTarget.current = undefined; }
      return;
    }
    if (!permissionsChecked || accessLost) return;
    if (!canRead) { revoke(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, 403)); return; }
    linkedTarget.current = initialDefectId;
    void openDetail(initialDefectId);
    return () => { detailController.current?.abort(); detailRequest.current += 1; };
  }, [initialDefectId, permissionsChecked, canRead, accessLost]);

  function toggle(record: Defect, checked: boolean) {
    setSelected((current) => {
      if (checked) return current[record.id] || Object.keys(current).length >= selectionLimit ? current : { ...current, [record.id]: record };
      const next = { ...current };
      delete next[record.id];
      return next;
    });
  }

  const selectedCount = Object.keys(selected).length;
  const exceedsFormalIssueLimit = selectedCount > formalIssueLimit;
  const staleSelected = (result?.items ?? []).filter(item => selected[item.id] && selected[item.id].version !== item.version);
  const locked = formalOpen || deletionOpen || !!boardTarget;
  const selectablePage = (result?.items ?? []).filter(record => !record.archivedAt);
  const selectedOnPage = selectablePage.filter(record => selected[record.id]);
  const selectedRecords = Object.values(selected);
  const selectedArchived = result?.items.some(record => selected[record.id] && record.archivedAt);
  const exceedsMaintenanceLimit = selectedCount > maintenanceLimit;
  const boardBatchDisabled = locked || filterOpen || !!deletionTargets || loading || !!listError || !!staleSelected.length || !!selectedArchived || exceedsMaintenanceLimit;
  const canReviewMaterial = (item: Defect['materials'][number]) => !!sessionUserId && !!item.id && item.sqeUserId === sessionUserId;
  function openBoard(board: MaintenanceBoard, records: Defect[], materialId?: string) {
    if (!boards.includes(board) || !targetOrganizationId || !records.length || records.length > maintenanceLimit || records.some(record => record.archivedAt || record.organizationId !== targetOrganizationId)) return;
    requestLeave(() => { setBoardDenied(false); setBoardTarget({ board, records, materialId }); });
  }
  function saveBoard(items: Defect[]) {
    const updated = new Map(items.map(item => [item.id, item]));
    setSelected(current => Object.fromEntries(Object.entries(current).map(([id, record]) => [id, updated.get(id) ?? record])));
    setDetail(current => {
      if (!current) return current;
      const next = updated.get(current.id);
      return next ? { ...current, ...next, evidence: next.evidence ?? current.evidence } : current;
    });
    if (detail && updated.has(detail.id)) void openDetail(detail.id, true);
    setBoardTarget(undefined);
    setRevision(value => value + 1);
  }
  function denyBoard(cause?: unknown) {
    if (cause instanceof ApiError && cause.status === 403) {
      setBoardTarget(undefined);
      setEditor(undefined);
      setBoardDenied(true);
      setRevision(value => value + 1);
      if (detailOpen && detail) void openDetail(detail.id, true);
    } else revoke(cause);
  }
  function openDeletion(records: Defect[]) { requestLeave(() => { setDeletionTargets(records); setDeletionOpen(true); }); }
  function refreshAfterDeletion(ids: string[]) {
    const retired = new Set(ids);
    setSelected(current => Object.fromEntries(Object.entries(current).filter(([id]) => !retired.has(id))));
    if (detail && retired.has(detail.id)) {
      detailController.current?.abort(); detailRequest.current += 1;
      setDetailOpen(false); setDetail(undefined); setLinked([]);
    }
    setDeletionOpen(false); setDeletionTargets(undefined); setRevision(value => value + 1);
  }
  function togglePage(checked: boolean) {
    requestLeave(() => {
      setSelected(current => {
        const next = { ...current };
        let remaining = selectionLimit - Object.keys(current).length;
        for (const record of selectablePage) {
          if (!checked) delete next[record.id];
          else if (!next[record.id] && remaining > 0) { next[record.id] = record; remaining -= 1; }
        }
        return next;
      });
    });
  }
  useEffect(() => { if (filterOpen) filterControl.current?.focus(); }, [filterOpen, filterRow]);
  const completeDraft = { ...draftFilters, items: draftFilters.items.filter(item => emptyOperator(item.operator) || filterValue(item) !== undefined) };
  const draftTooLong = filtersTooLong(serializeFilters(completeDraft));
  const changesSelection = filterOpen && !draftTooLong && (completeDraft.currentMonth !== appliedFilters.currentMonth || serializeFilters(completeDraft) !== serializedFilters);
  function saveAppliedFilters(next: FilterState, submittedSearch?: string, reset = false, restoreFocus = true) {
    const nextSearch = submittedSearch ?? search;
    const nextFilters = serializeFilters(next);
    if (locked || deletionTargets || filtersTooLong(nextFilters)) return false;
    const changed = nextSearch !== search || next.currentMonth !== appliedFilters.currentMonth || nextFilters !== serializedFilters;
    if (changed) { setSelected({}); setPage(1); setResult(undefined); setLoading(true); }
    if (submittedSearch !== undefined) setSearchInput(nextSearch);
    if (reset || changed || next.logic !== appliedFilters.logic) saveFilterPreference(reset ? undefined : { search: nextSearch, filters: next });
    setFilterOpen(false);
    setDraftFilters(next);
    if (filterOpen && restoreFocus) filterAnchor.current?.focus();
    return true;
  }
  function openFilters(anchor: HTMLElement, field?: FilterField) {
    filterAnchor.current = anchor;
    const items = filterOpen ? draftFilters.items : appliedFilters.items;
    const found = field ? items.findIndex(item => item.field === field) : -1;
    const append = !!field && found < 0 && items.length < 10;
    setFilterRow(found >= 0 ? found : append ? items.length : undefined);
    setDraftFilters({ ...(filterOpen ? draftFilters : appliedFilters), items: append ? [...items, filterItem(field)] : items });
    setFilterOpen(true);
  }
  function filterTitle(field: FilterField, label: string) {
    const triggerLabel = english && field === 'factoryCode' ? 'Filter by factory' : `按${label}筛选`;
    return <span aria-label={label} className="process-quality-filter-title"><span>{label}</span><button type="button" aria-label={triggerLabel} aria-haspopup="dialog" aria-expanded={filterOpen && filterAnchor.current?.getAttribute('aria-label') === triggerLabel} aria-pressed={appliedFilters.items.some(item => item.field === field) || field === 'occurredAt' && appliedFilters.currentMonth} disabled={locked || !!deletionTargets} onClick={event => { event.stopPropagation(); openFilters(event.currentTarget, field); }}><Filter size={13} aria-hidden="true" /></button></span>;
  }
  function updateFilterItem(index: number, next: FilterItem) {
    setDraftFilters(current => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? next : item) }));
  }
  const filterPanel = <div role="dialog" className="process-quality-filter-panel" aria-label="筛选面板"
    onBlur={event => {
      const next = event.relatedTarget;
      if (next && next !== filterTrigger.current && next !== filterAnchor.current && !event.currentTarget.contains(next)) {
        saveAppliedFilters(completeDraft, undefined, false, false);
      }
    }}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); saveAppliedFilters(completeDraft); } }}>
    <div className="process-quality-filter-heading"><strong>筛选条件</strong><Button type="text" aria-label="关闭筛选" icon={<X size={14} />} onClick={() => saveAppliedFilters(completeDraft)} /></div>
    <Checkbox checked={draftFilters.currentMonth} onChange={event => setDraftFilters(current => ({ ...current, currentMonth: event.target.checked }))}>仅当前自然月（北京时间）</Checkbox>
    <div className="process-quality-filter-logic"><span>满足条件</span>
      <select ref={filterRow === undefined ? filterControl : undefined} aria-label="筛选逻辑" value={draftFilters.logic} onChange={event => setDraftFilters(current => ({ ...current, logic: event.target.value as FilterLogic }))}><option value="ALL">全部条件</option><option value="ANY">任一条件</option></select>
    </div>
    <div className="process-quality-filter-rows">
      {draftFilters.items.map((item, index) => <div className="process-quality-filter-row" key={index}>
        <select ref={filterRow === index ? filterControl : undefined} aria-label={`筛选字段 ${index + 1}`} value={item.field} onChange={event => updateFilterItem(index, filterItem(event.target.value as FilterField))}>{filterFields.map(([field, label]) => <option key={field} value={field}>{field === 'factoryCode' ? factoryTitle : label}</option>)}</select>
        <select aria-label={`筛选运算符 ${index + 1}`} value={item.operator} onChange={event => updateFilterItem(index, { ...item, operator: event.target.value })}>{operatorsFor(item.field).map(([operator, zh, en]) => <option key={operator} value={operator}>{english && item.field === 'factoryCode' ? en : zh}</option>)}</select>
        {emptyOperator(item.operator) ? <span /> : filterChoices[item.field] ? <select aria-label={`筛选值 ${index + 1}`} value={item.value ?? ''} onChange={event => updateFilterItem(index, { ...item, value: event.target.value })}><option value="">{english && item.field === 'factoryCode' ? 'Select' : '请选择'}</option>{filterChoices[item.field]!.map(([value, zh, en]) => <option key={value} value={value}>{english && item.field === 'factoryCode' ? en : zh}</option>)}</select> : <input aria-label={`筛选值 ${index + 1}`} type={dateField(item.field) ? 'date' : item.field === 'defectQuantity' ? 'number' : 'text'} maxLength={200} value={item.value ?? ''} onChange={event => updateFilterItem(index, { ...item, value: event.target.value })} />}
        <Button type="text" aria-label={`删除筛选条件 ${index + 1}`} icon={<X size={13} />} onClick={() => { setFilterRow(undefined); setDraftFilters(current => ({ ...current, items: current.items.filter((_, entryIndex) => entryIndex !== index) })); }} />
      </div>)}
    </div>
    {draftTooLong ? <Alert type="warning" showIcon title="筛选内容过长，请缩短文字或减少条件。" /> : null}
    <Space wrap>
      <Button disabled={draftFilters.items.length >= 10} onClick={() => { setFilterRow(draftFilters.items.length); setDraftFilters(current => ({ ...current, items: [...current.items, filterItem('description')] })); }}>添加筛选条件</Button>
      <Button onClick={() => saveAppliedFilters(defaultFilters, '', true)}>恢复系统默认筛选</Button>
      <Button aria-label="清空" onClick={() => setDraftFilters({ currentMonth: false, logic: 'ALL', items: [] })}>清空</Button>
      <Button type="primary" disabled={draftTooLong} onClick={() => saveAppliedFilters(completeDraft)}>应用筛选</Button>
    </Space>
  </div>;
  if (accessLost) return <main className="process-quality-page"><Alert type="warning" showIcon title="暂无制程不良访问权限" description="当前会话或权限已变化，已清除来源、选择与草稿；请重新进入。" /></main>;

  const columns: TableColumnsType<Defect> = ([
    { title: <span aria-label="选择"><Checkbox aria-label="选择当前页制程不良" checked={!!selectablePage.length && selectedOnPage.length === selectablePage.length} indeterminate={!!selectedOnPage.length && selectedOnPage.length < selectablePage.length} disabled={locked || loading || !selectablePage.length || (!selectedOnPage.length && selectedCount >= selectionLimit)} onChange={event => togglePage(event.target.checked && selectedCount < selectionLimit)} /></span>, onHeaderCell: () => ({ 'aria-label': '选择' }), key: 'select', width: 40, align: 'center', fixed: 'left', render: (_, record) => <label className="process-quality-row-checkbox"><input type="checkbox" aria-label={`选择制程不良 ${record.description}`} disabled={locked || loading || (!selected[record.id] && selectedCount >= selectionLimit) || !!record.archivedAt} checked={Boolean(selected[record.id])} onChange={event => toggle(record, event.target.checked)} /></label> },
    { title: filterTitle('occurredAt', '发生时间'), key: 'occurredAt', dataIndex: 'occurredAt', width: 104, className: 'process-quality-compact-column', align: 'center', ellipsis: { showTitle: false }, onCell: record => ({ title: record.occurredAt ? listTimestamp.format(new Date(record.occurredAt)) : undefined }), render: (value: string | null) => value ? occurrenceDate.format(new Date(value)) : '—' },
    { title: filterTitle('factoryCode', factoryTitle), key: 'factoryCode', dataIndex: 'factoryCode', width: 100, className: 'process-quality-compact-column', align: 'center', render: (_, record) => factoryLabel(record.factoryCode, english) },
    { title: filterTitle('shift', '班次'), key: 'shift', dataIndex: 'shift', width: 88, className: 'process-quality-compact-column', align: 'center', render: value => value === 'DAY' ? '白班' : value === 'NIGHT' ? '夜班' : '未知' },
    { title: filterTitle('projectCode', '项目号'), key: 'project', width: 108, className: 'process-quality-compact-column', align: 'center', ellipsis: true, render: (_, record) => record.componentProject?.project?.code ?? '未确认' },
    { title: filterTitle('productCategory', '产品类型'), key: 'productCategory', width: 84, className: 'process-quality-compact-column', align: 'center', ellipsis: true, render: (_, record) => record.productCategory ?? '未确认' },
    { title: filterTitle('productSubcategory', '细分类型'), key: 'productSubcategory', dataIndex: 'productSubcategory', width: 112, className: 'process-quality-compact-column', align: 'center', ellipsis: true, render: value => value ?? '/' },
    { title: filterTitle('projectStage', '项目状态'), key: 'projectStage', dataIndex: 'projectStage', width: 100, className: 'process-quality-compact-column', align: 'center', render: value => value === 'NEW_PRODUCT' ? '新品' : value === 'MASS_PRODUCTION' ? '量产' : '未确认' },
    { title: filterTitle('description', '不良描述'), key: 'description', dataIndex: 'description', width: 260, align: 'left', ellipsis: true, render: (value: string, record) => <div className="process-quality-description-heading"><button type="button" title={value || '查看待完善记录'} className="process-quality-detail-link" onClick={() => void openDetail(record.id)}>{value || '查看待完善记录'}</button><MappingHint record={record} /></div> },
    { title: filterTitle('traceCode', '追溯码'), key: 'traceCode', dataIndex: 'traceCode', width: 180, align: 'center', ellipsis: true },
    { title: filterTitle('lineName', '生产线名称'), key: 'lineName', dataIndex: 'lineName', width: 144, align: 'center', ellipsis: true },
    { title: filterTitle('operationName', '工序名称'), key: 'operationName', dataIndex: 'operationName', width: 144, align: 'center', ellipsis: true },
    { title: filterTitle('operationSector', '板块'), key: 'operationSector', dataIndex: 'operationSector', width: 76, className: 'process-quality-compact-column', align: 'center', ellipsis: true, render: value => value ?? '未确认' },
    { title: filterTitle('defectTypeCode', '类型'), key: 'defectTypeCode', dataIndex: 'defectTypeCode', width: 115, align: 'center' },
    { title: filterTitle('defectQuantity', '不良数量'), key: 'defectQuantity', dataIndex: 'defectQuantity', width: 80, className: 'process-quality-compact-column', align: 'center' },
    { title: filterTitle('productCode', '成品编码'), key: 'productCode', dataIndex: 'productCode', width: 150 },
    { title: filterTitle('workOrderCode', '工单号'), key: 'workOrderCode', dataIndex: 'workOrderCode', width: 150 },
    { title: filterTitle('lineCode', '生产线编码'), key: 'lineCode', dataIndex: 'lineCode', width: 130 },
    { title: filterTitle('operationCode', '工序编码'), key: 'operationCode', dataIndex: 'operationCode', width: 130 },
    { title: filterTitle('registeredByName', '登记人'), key: 'registeredByName', width: 120, render: (_, record) => record.sourceKind === 'IMS' ? '自动' : record.registeredByName ?? '—' },
    { title: filterTitle('pendingCompletion', '完善情况'), key: 'completion', width: 170, render: (_, record) => <><span>{record.pendingCompletion ? '待完善' : '已完善'}</span><CompletionStatus record={record} /></> },
    { title: filterTitle('responsibilityCategory', '责任类别'), key: 'responsibilityCategory', dataIndex: 'responsibilityCategory', width: 105, render: responsibility },
    { title: filterTitle('ledgerStatus', '状态'), key: 'ledgerStatus', dataIndex: 'ledgerStatus', width: 100, render: value => <Tag>{value === 'CLOSED' ? '已关闭' : '跟进中'}</Tag> },
    { title: filterTitle('firstMaterialCode', '首条物料 / 供应商'), key: 'material', width: 190, render: (_, record) => record.materials?.length ? <span>{record.materials[0].materialCode ?? '—'} / {supplierName(record.materials[0])}{record.materials.length > 1 ? `（共${record.materials.length}项）` : ''}</span> : '—' },
    { title: filterTitle('manualProjectCode', '人工项目 / 映射'), key: 'mapping', width: 150, render: (_, record) => record.projectCode ?? '—' },
    { title: filterTitle('batchOrWorkOrder', '批次 / 工单'), key: 'source', width: 175, render: (_, record) => `${record.batchCode ?? '—'} / ${record.workOrderCode ?? '—'}` },
    { title: filterTitle('analysisProgress', '分析进度'), key: 'analysisProgress', dataIndex: 'analysisProgress', width: 150, ellipsis: true, render: value => value ?? '—' },
    { title: filterTitle('dispositionPlan', '处置方案'), key: 'dispositionPlan', width: 100, render: (_, record) => record.dispositionPlan ? dispositionLabels[record.dispositionPlan] : '—' },
    { title: filterTitle('dispositionProgress', '处置进度'), key: 'dispositionProgress', dataIndex: 'dispositionProgress', width: 150, ellipsis: true, render: value => value ?? '—' },
    { title: filterTitle('dispositionCompletedAt', '处置完成时间'), key: 'dispositionCompletedAt', width: 130, ellipsis: { showTitle: false }, onCell: record => ({ title: record.dispositionCompletedAt ? listTimestamp.format(new Date(record.dispositionCompletedAt)) : undefined }), render: (_, record) => record.dispositionCompletedAt ? occurrenceDate.format(new Date(record.dispositionCompletedAt)) : '—' },
    { title: '操作', key: 'actions', width: canDelete ? 112 : 64, align: 'center', render: (_, record) => <div className="process-quality-row-actions">
      <button type="button" aria-label="查看详情" title="查看详情" onClick={() => void openDetail(record.id)}><Eye size={16} aria-hidden="true" /></button>
      {canDelete && !record.archivedAt ? <button type="button" className="process-quality-delete-action" aria-label="删除台账" title="删除台账" disabled={locked || !!deletionTargets} onClick={() => openDeletion([record])}><Trash2 size={16} aria-hidden="true" /></button> : null}
    </div> },
  ] satisfies TableColumnsType<Defect>).map(column => 'onHeaderCell' in column ? column : { ...column, onHeaderCell: () => ({ 'aria-label': typeof column.title === 'string' ? column.title : column.title.props['aria-label'] }) });

  const toolbar = <div className="process-quality-toolbar-main" role="group" aria-label="台账工具栏">
    <Input.Search aria-label="搜索制程不良" placeholder="搜索追溯码、成品编码、工单、不良描述或批次" value={searchInput} allowClear maxLength={200} disabled={locked || !!deletionTargets} onChange={event => setSearchInput(event.target.value)} onSearch={value => requestLeave(() => saveAppliedFilters(filterOpen ? completeDraft : appliedFilters, value.trim()))} />
    {canRegister ? <Button type="primary" disabled={locked} onClick={() => requestLeave(() => setEditor('new'))}>登记不良</Button> : null}
    <Popover open={filterOpen} onOpenChange={open => { if (open && filterTrigger.current) openFilters(filterTrigger.current); else if (!open && filterOpen) saveAppliedFilters(completeDraft, undefined, false, false); }} afterOpenChange={open => { if (open) filterControl.current?.focus(); }} content={filterPanel} trigger="click" placement="bottomLeft" align={{ overflow: { shiftX: true } }} destroyOnHidden><Button ref={filterTrigger} aria-label="筛选条件" aria-haspopup="dialog" aria-expanded={filterOpen} disabled={locked || !!deletionTargets} icon={<Filter size={14} />}>筛选条件{appliedFilters.items.length || appliedFilters.currentMonth ? ` ${appliedFilters.items.length + Number(appliedFilters.currentMonth)}` : ''}</Button></Popover>
    {canIssue ? <Button aria-label="发起 8D" disabled={locked || filterOpen || !selectedCount || exceedsFormalIssueLimit || !!listError || loading || !!staleSelected.length} onClick={() => requestLeave(() => setFormalOpen(true))}>发起 8D</Button> : null}
    <Button aria-label="刷新" disabled={locked} onClick={() => requestLeave(() => { if (!filterOpen || saveAppliedFilters(completeDraft, undefined, false, false)) setRevision(value => value + 1); })} loading={loading}>刷新</Button>
  </div>;

  return <main className="process-quality-page">
    <h1 className="sr-only">不良品台账</h1>
    {issued ? <Alert type="success" showIcon title={`问题 ${issued.problem.reportNumber} 已发起`} action={<Link to={`/app/problem-workspace/${issued.problem.id}`}>查看问题</Link>} /> : null}
    <section className="process-quality-card process-quality-compact-ledger">
      {selectedCount ? <div className="process-quality-selection-bar" role="toolbar" aria-label="台账批量操作">
        <span aria-live="polite">已选择 {selectedCount} 条来源</span>
        {canIssue && exceedsFormalIssueLimit ? <span>发起 8D 最多选择 {formalIssueLimit} 条</span> : null}
        <Button disabled={locked || !!deletionTargets} onClick={() => requestLeave(() => setSelected({}))}>取消选择</Button>
        {boards.some(board => board !== 'REGISTRATION') && exceedsMaintenanceLimit ? <span>板块维护最多选择 {maintenanceLimit} 条</span> : null}
        {(Object.keys(boardLabels) as MaintenanceBoard[]).filter(board => boards.includes(board) && (board !== 'MATERIAL_REVIEW' || selectedRecords.some(record => record.materials?.some(canReviewMaterial)))).map(board =>
          <Button key={board} disabled={boardBatchDisabled} onClick={() => openBoard(board, selectedRecords)}>{boardLabels[board]}</Button>)}
        {canDelete ? <Button danger disabled={locked || filterOpen || !!deletionTargets || loading || !!listError || !!staleSelected.length} onClick={() => openDeletion(Object.values(selected))}>删除所选</Button> : null}
      </div> : <span className="sr-only" role="status">已选择 0 条来源</span>}
      {deletionTargets && !deletionOpen ? <Alert type="warning" title="删除结果尚待确认" action={<Button onClick={() => setDeletionOpen(true)}>恢复删除操作</Button>} /> : null}
      {staleSelected.length ? <Alert type="warning" title="所选来源版本已更新。" action={<Button disabled={locked} onClick={() => requestLeave(() => setSelected(current => ({ ...current, ...Object.fromEntries(staleSelected.map(item => [item.id, item])) })))}>更新所选版本</Button>} /> : null}
      <ProcessError cause={supplierError} fallback="供应商名称加载失败，请刷新重试。" />
      {boardDenied && !detailOpen ? <Alert showIcon type="warning" title="当前板块操作已被拒绝，正在刷新台账与操作权限。" /> : null}
      <ProcessError cause={capabilityError} fallback="维护权限加载失败，请刷新重试。" />
      <LedgerTable<Defect> pinnedHorizontalScroll actionBar={toolbar} bodyFallback={listError ? <Alert type={isDenied(listError) ? 'warning' : 'error'} showIcon title={isDenied(listError) ? '暂无制程不良访问权限' : errorText(listError, '台账加载失败，请重试。')} action={!isDenied(listError) ? <Button onClick={() => setRevision((value) => value + 1)}>重试</Button> : undefined} /> : undefined} compactHeaders compactLayout ledgerId="process-defects" organizationId={targetOrganizationId} viewId={viewId} className="process-quality-ledger" requiredColumnKeys={['select', 'description', 'actions']} defaultVisibleColumnKeys={['select', 'occurredAt', 'factoryCode', 'shift', 'project', 'productCategory', 'productSubcategory', 'projectStage', 'description', 'traceCode', 'lineName', 'operationName', 'operationSector', 'defectQuantity', 'actions']} insertNewColumnsBefore={[['factoryCode', 'shift', true], ['productCategory', 'productSubcategory'], ...maintenanceColumnKeys.map(key => [key, 'actions', false, true] as const)]} resetColumnsLabel="恢复录单默认列" rowKey="id" columns={columns} dataSource={result?.items ?? []} loading={loading} locale={{ emptyText: <Empty description={search || appliedFilters.currentMonth || appliedFilters.items.length ? '没有匹配的不良记录' : '暂无不良记录'} /> }} pagination={{ current: page, pageSize, total: result?.total ?? 0, showSizeChanger: true, pageSizeOptions, onChange: (next, size) => { if (!locked) requestLeave(() => { if (filterOpen && !saveAppliedFilters(completeDraft, undefined, false, false)) return; setPage(size === pageSize && !changesSelection ? next : 1); setPageSize(size); }); } }} />
    </section>
    <Drawer title="不良品详情" open={detailOpen} onClose={() => { detailController.current?.abort(); detailRequest.current += 1; setDetailOpen(false); setDetail(undefined); setLinked([]); }} size="min(760px, 100vw)" destroyOnHidden
      classNames={{ header: 'process-quality-drawer-header' }}
      extra={!detailLoading && detail && !detail.archivedAt ? <Space wrap>
        {canRegister ? <Button disabled={locked} onClick={() => requestLeave(() => setEditor(detail))}>维护登记信息</Button> : null}
        {canDelete ? <Button danger disabled={locked || !!deletionTargets} onClick={() => openDeletion([detail])}>删除台账</Button> : null}
        {canIssue ? <Button disabled={locked || (!selected[detail.id] && selectedCount >= formalIssueLimit)} onClick={() => requestLeave(() => { toggle(detail, true); setDetailOpen(false); })}>选择此条并返回台账</Button> : null}
      </Space> : null}>
      {boardDenied ? <Alert showIcon type="warning" title="当前板块操作已被拒绝，正在刷新台账与操作权限。" /> : null}
      {detailError ? <Alert type={isDenied(detailError) ? 'warning' : 'error'} showIcon title={isDenied(detailError) ? '暂无该来源访问权限' : errorText(detailError, '详情加载失败，请重试。')}
        action={!isDenied(detailError) ? <Button size="small" aria-label="重试" onClick={() => { if (detailTarget.current) void openDetail(detailTarget.current, !!detail); }}>重试</Button> : undefined} /> : null}
      {detailLoading ? <div className="process-quality-loading"><Spin /></div> : detail ? <>
        <div className="process-quality-detail-sections">
        <section className="process-quality-detail-section">
        <Descriptions title="表单登记" bordered size="small" column={{ xs: 1, sm: 2, lg: 3 }} items={[
          { key: 'description', label: '不良描述', span: 'filled', children: <span className="process-quality-description">{detail.description || '待完善'}</span> },
          { key: 'type', label: '失效类型', children: detail.defectTypeCode ?? '—' },
          { key: 'quantity', label: '数量', children: detail.defectQuantity },
          { key: 'occurredAt', label: '发生时间', children: detail.occurredAt ? new Date(detail.occurredAt).toLocaleString('zh-CN') : '未知' },
          { key: 'factoryCode', label: factoryTitle, children: factoryLabel(detail.factoryCode, english) },
          { key: 'shift', label: '班次', children: detail.shift === 'DAY' ? '白班' : detail.shift === 'NIGHT' ? '夜班' : '未知' },
          { key: 'project', label: '项目号', children: detail.componentProject?.project?.code ?? '未确认' },
          { key: 'stage', label: '项目状态', children: detail.projectStage === 'NEW_PRODUCT' ? '新品' : detail.projectStage === 'MASS_PRODUCTION' ? '量产' : '未确认' },
          { key: 'subcategory', label: '细分类型', children: detail.productSubcategory ?? '未确认' },
          { key: 'sector', label: '板块', children: detail.operationSector ?? '未确认' },
          { key: 'lineName', label: '生产线名称', children: detail.lineName ?? '—' },
          { key: 'operationName', label: '工序名称', children: detail.operationName ?? '—' },
          { key: 'registrant', label: '登记人', children: detail.sourceKind === 'IMS' ? '自动' : detail.registeredByName ?? '—' },
          { key: 'completion', label: '完善情况', children: <CompletionStatus record={detail} detail /> },
          { key: 'trace', label: '条码', children: detail.traceCode ?? '—' },
          { key: 'mapping', label: '人工项目 / 映射建议', children: `${detail.projectCode ?? '—'} / ${detail.componentProject?.project?.code ?? '—'}` },
          { key: 'batch', label: '批次 / 工单', children: `${detail.batchCode ?? '—'} / ${detail.workOrderCode ?? '—'}` },
          { key: 'operation', label: '工序 / 产线', children: `${detail.operationCode ?? '—'} / ${detail.lineCode ?? '—'}` },
          { key: 'product', label: '产品 / 物料', children: `${detail.productCode ?? '—'} / ${detail.materialCode ?? '—'}` },
          { key: 'source', label: '来源', children: <Space><Tag>{detail.sourceKind === 'IMS' ? '自动' : '人工录入'}</Tag>{detail.externalSourceSystem ? <Tag>{detail.externalSourceSystem}</Tag> : null}</Space> },
        ]} />
        <ProcessAiDescription key={detail.id} record={detail} permissions={permissions} canRegister={canRegister} onSaved={saved} onDenied={revoke} onAdoptDenied={denyBoard} />
        </section>
        <section className="process-quality-detail-section">
        <Descriptions title="分析" bordered size="small" column={1}
          extra={!detail.archivedAt && boards.includes('ANALYSIS') ? <Button size="small" disabled={locked || !!deletionTargets} onClick={() => openBoard('ANALYSIS', [detail])}>{boardLabels.ANALYSIS}</Button> : null}
          items={[{ key: 'progress', label: '分析进展', children: detail.analysisProgress ?? '—' }]} />
        </section>
        <section className="process-quality-detail-section">
          <Descriptions title="责任" bordered size="small" column={1}
            extra={!detail.archivedAt && boards.includes('RESPONSIBILITY') ? <Button size="small" disabled={locked || !!deletionTargets} onClick={() => openBoard('RESPONSIBILITY', [detail])}>{boardLabels.RESPONSIBILITY}</Button> : null}
            items={[{ key: 'responsibility', label: '责任类别', children: responsibility(detail.responsibilityCategory) }]} />
          {detail.responsibilityCategory === 'MATERIAL' || detail.materials?.length ? <>
            <Typography.Title level={5}>异常物料信息登记</Typography.Title>
            <MaterialDetails record={detail} supplierName={supplierName}
              canEdit={!detail.archivedAt && boards.includes('RESPONSIBILITY')}
              canReview={!detail.archivedAt && boards.includes('MATERIAL_REVIEW') ? canReviewMaterial : undefined}
              onEdit={(board, materialId) => openBoard(board, [detail], materialId)} disabled={locked || !!deletionTargets} />
          </> : null}
        </section>
        <section className="process-quality-detail-section">
        <Descriptions title="处置" bordered size="small" column={{ xs: 1, sm: 2 }}
          extra={!detail.archivedAt && boards.includes('DISPOSITION') ? <Button size="small" disabled={locked || !!deletionTargets} onClick={() => openBoard('DISPOSITION', [detail])}>{boardLabels.DISPOSITION}</Button> : null}
          items={[
            { key: 'dispositionPlan', label: '处置方案', children: detail.dispositionPlan ? dispositionLabels[detail.dispositionPlan] : '—' },
            { key: 'dispositionCompletedAt', label: '处置完成时间', children: detail.dispositionCompletedAt ? occurrenceTimestamp.format(new Date(detail.dispositionCompletedAt)) : '—' },
            { key: 'dispositionProgress', label: '处置进度', span: 'filled', children: detail.dispositionProgress ?? '—' },
          ]} />
        </section>
        <section className="process-quality-detail-section">
        <Descriptions title="台账关闭判定" bordered size="small" column={1}
          extra={!detail.archivedAt && boards.includes('CLOSURE') ? <Button size="small" disabled={locked || !!deletionTargets} onClick={() => openBoard('CLOSURE', [detail])}>{detail.ledgerStatus === 'CLOSED' ? '恢复跟进' : '关闭台账'}</Button> : null}
          items={[{ key: 'ledgerStatus', label: '台账状态', children: detail.ledgerStatus === 'CLOSED' ? '已关闭' : '跟进中' }]} />
        </section>
        <AttachmentPanel variant="standard" resource={{ resourceType: 'process-defect', resourceId: detail.id }} fileIds={detail.attachmentIds ?? (detail.evidence ?? []).map(evidence => evidence.id)} readOnly={!canWrite || !!detail.archivedAt}
          onUploadCompleted={() => { void openDetail(detail.id, true); }} onRemoved={() => { void openDetail(detail.id, true); }} onAccessDenied={revoke} onWriteAccessDenied={denyBoard} />
        <section className="process-quality-detail-section">
          <Typography.Title level={5}>已关联问题</Typography.Title>
          <RecordList items={linked} itemKey={problem => problem.id} renderItem={problem => <Link to={`/app/problem-workspace/${problem.id}`}>{problem.reportNumber}</Link>} empty={<Typography.Text type="secondary">尚未关联正式问题</Typography.Text>} />
        </section>
        <section className="process-quality-detail-section">
          <Typography.Title level={5}>更新记录</Typography.Title>
          {detail.updateRecords?.length === 100 ? <Typography.Text type="secondary">显示最近 100 条</Typography.Text> : null}
          <table className="process-quality-update-records" aria-label="更新记录">
            <thead><tr><th scope="col">时间</th><th scope="col">更新内容</th><th scope="col">更新人</th></tr></thead>
            <tbody>{detail.updateRecords?.length ? detail.updateRecords.map(entry => <tr key={entry.id}>
              <td><time dateTime={entry.occurredAt}>{occurrenceTimestamp.format(new Date(entry.occurredAt))}</time></td>
              <td>{entry.content}</td><td>{entry.actorName}</td>
            </tr>) : <tr><td colSpan={3}>暂无更新记录</td></tr>}</tbody>
          </table>
        </section>
        </div>
        {canIssue && !selected[detail.id] && selectedCount >= formalIssueLimit ? <Alert type="warning" showIcon title={`已选满${formalIssueLimit}条来源，请先取消一条已选来源，再选择此条。`} /> : null}
      </> : null}
    </Drawer>
    {deletionTargets ? <ProcessDefectDeletionDialog sources={deletionTargets} organizationId={organizationId} open={deletionOpen} onClose={uncertain => { setDeletionOpen(false); if (!uncertain) setDeletionTargets(undefined); }} onDenied={revoke} onRefresh={() => refreshAfterDeletion(deletionTargets.map(record => record.id))} onDeleted={response => refreshAfterDeletion(response.deletedIds)} /> : null}
    {formalOpen ? <ProcessEightDIssueDrawer sources={Object.values(selected)} onClose={() => setFormalOpen(false)} onDenied={revoke} onIssued={response => { setIssued(response); setFormalOpen(false); setSelected({}); setRevision(value => value + 1); }} /> : null}
    {editor ? <ProcessDefectEditor key={editor === 'new' ? 'new' : editor.id} record={editor === 'new' ? undefined : editor} organizationId={organizationId} onClose={() => setEditor(undefined)} onSaved={saved} onDenied={revoke} onWriteDenied={denyBoard} /> : null}
    {boardTarget && targetOrganizationId ? <ProcessDefectBoardDialog {...boardTarget} organizationId={targetOrganizationId} userId={sessionUserId} suppliers={suppliers} canReadSuppliers={canReadSuppliers}
      onClose={() => setBoardTarget(undefined)} onSaved={result => saveBoard(result.items)} onDenied={denyBoard} /> : null}
  </main>;
}

type Material = Defect['materials'][number];

function MaterialDetails({ record, supplierName, canEdit, canReview, onEdit, disabled }: {
  record: Defect; supplierName: (item: Material) => string; canEdit: boolean; canReview?: (item: Material) => boolean;
  onEdit: (board: 'RESPONSIBILITY' | 'MATERIAL_REVIEW', id: string) => void; disabled: boolean;
}) {
  function editBoard(item: Material) {
    if (canEdit) return 'RESPONSIBILITY';
    if (canReview?.(item)) return 'MATERIAL_REVIEW';
    return undefined;
  }
  return <Table<Material> rowKey={item => item.id ?? String(item.position)} dataSource={record.materials ?? []} size="small" pagination={false} scroll={{ x: 540 }} locale={{ emptyText: '暂无物料明细' }}
    onRow={item => {
      const board = editBoard(item);
      const id = item.id;
      return id && board && !disabled ? { className: 'process-quality-editable-material', onClick: () => onEdit(board, id) } : {};
    }} columns={[
    { title: '物料编码', render: (_, item) => {
      const board = editBoard(item);
      const id = item.id;
      const code = item.materialCode ?? '—';
      return id && board ? <button type="button" className="process-quality-material-link" aria-label={`编辑异常物料 ${code}`} disabled={disabled}
        onClick={event => { event.stopPropagation(); onEdit(board, id); }}>{code}</button> : code;
    } },
    { title: '物料名称', render: (_, item) => item.materialName || (item.materialCode ? '未匹配' : '—') },
    { title: '供应商', render: (_, item) => supplierName(item) }, { title: '物料批次', dataIndex: 'materialBatch', render: value => value ?? '—' },
    { title: 'SQE', dataIndex: 'sqeUserId', render: value => value ? '已人工分配' : '未分配' },
    { title: '复核状态', render: (_, item) => {
      const label = verificationLabels[item.verification] ?? '未复核';
      const id = item.id;
      return id && canEdit && canReview?.(item) ? <button type="button" className="process-quality-material-link" aria-label={`复核异常物料 ${item.materialCode ?? '—'}`} disabled={disabled}
        onClick={event => { event.stopPropagation(); onEdit('MATERIAL_REVIEW', id); }}>{label}</button> : label;
    } },
  ]} />;
}
