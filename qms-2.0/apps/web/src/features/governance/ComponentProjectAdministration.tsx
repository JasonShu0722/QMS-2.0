import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Empty, Form, Input, Modal, Pagination, Select, Space, Spin, Table, Tooltip, Typography } from 'antd';
import { CircleAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, createAdminMutation } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useCompletedSessionNavigation, useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import type { AdminOrganization } from '../admin/admin';
import { configurationPath } from './governance';
import { GovernanceFeedback } from './GovernanceFeedback';
import { ComponentProjectImport } from './ComponentProjectImport';

type Project = components['schemas']['ComponentProjectRecordDto'];
type ProjectDisplay = Pick<Project, 'id' | 'code' | 'name' | 'stage' | 'status'>;
type ProjectsPage = components['schemas']['ComponentProjectRecordsPageDto'];
type Mapping = components['schemas']['ComponentProjectMappingListItemDto'];
type MappingsPage = components['schemas']['ComponentProjectMappingsPageDto'];
type CreateProject = components['schemas']['CreateComponentProjectRecordDto'];
type UpdateProject = components['schemas']['UpdateComponentProjectRecordDto'];
type CreateMapping = components['schemas']['CreateComponentProjectMappingDto'];
type UpdateMapping = components['schemas']['UpdateComponentProjectMappingDto'];
type Assignment = components['schemas']['ComponentEngineerAssignmentDto'];
type AssignmentsPage = components['schemas']['ComponentEngineerAssignmentsPageDto'];
type BulkChanges = components['schemas']['ComponentProjectBulkChangesDto'];
type BulkPreviewInput = components['schemas']['ComponentProjectBulkPreviewDto'];
type BulkApplyInput = components['schemas']['ComponentProjectBulkApplyDto'];
type BulkPreviewResult = components['schemas']['ComponentProjectBulkPreviewResultDto'];
type BulkApplyResult = components['schemas']['ComponentProjectBulkApplyResultDto'];
type Editor = { kind: 'project'; record?: Project } | { kind: 'mapping'; record?: Mapping } | { kind: 'projects' };
type Attempt = { path: string; method: 'POST' | 'PATCH'; body: CreateProject | UpdateProject | CreateMapping | UpdateMapping };
type PickerProps = { organizationId: string; id?: string; value?: string | null; onChange?: (value: string | null) => void; disabled?: boolean; onReady: (ready: boolean) => void; onUnauthorized: (error: unknown) => void };

const english: Record<string, string> = {
  '组件项目映射': 'Component project mapping', '项目资料': 'Project records', '组件映射': 'Component mappings',
  '无组件项目映射读取权限': 'You cannot read component project mappings.', '新增项目': 'Add project', '新增组件映射': 'Add component mapping',
  '编辑项目': 'Edit project', '编辑组件': 'Edit component', '项目编码': 'Project code', '项目名称': 'Project name', '项目阶段': 'Project stage',
  '新品': 'New product', '量产': 'Mass production', '客户质量工程师': 'Customer quality engineer', '项目质量工程师': 'Project quality engineer',
  '组件编码': 'Component code', '关联项目': 'Project', '产品大类': 'Product category', '产品细分': 'Product subcategory',
  '搜索项目': 'Search projects', '搜索组件': 'Search components', '请选择项目阶段': 'Select a project stage',
  '请选择关联项目': 'Select a project', '请填写必填内容': 'Complete this required field', '无匹配结果': 'No matching records',
  '加载失败': 'Failed to load', '加载中': 'Loading', '清空': 'Clear', '未配置': 'Not configured',
  '工程师候选分页': 'Appointment pages', '项目候选分页': 'Project option pages', '已选任职待确认': 'Checking selected appointment',
  '已选任职失效，请重新选择或清空': 'The selected appointment is invalid. Choose another or clear it.',
  '已选项目待确认': 'Checking selected project', '已选项目不可用，请重试或重新选择': 'The selected project is unavailable. Retry or choose another.',
  '项目已停用，请重新选择': 'The project is disabled. Choose another.', '保存结果尚未确认，请使用原请求重试。': 'The save result is unknown. Retry the original request.',
  '重试原请求': 'Retry original request', '放弃并刷新': 'Discard and refresh',
  '阶段与两类工程师在项目资料中集中维护，同项目组件共用。': 'Stage and both engineers are maintained on the project and shared by its components.',
  '仅维护映射资料，不自动转派、取消审批或改写历史问题。': 'Maintains mapping data only; does not reassign work, cancel approvals or rewrite historical issues.',
  '新增组件': 'Add component', '组件名称': 'Component name', '选择项目': 'Select project', '编辑项目资料': 'Edit project details',
  '未映射': 'Unmapped', '尚未关联项目，可稍后完善映射。': 'No project is linked. Complete the mapping later.',
  '产品大类未配置': 'Product category not configured', '产品大类未配置，可稍后完善。': 'No product category is configured. Complete it later.',
  '已选择 {count} / 100': 'Selected {count} / 100', '清除选择': 'Clear selection',
  '查看项目': 'View project', '关闭编辑器': 'Close editor',
  '批量设置': 'Bulk changes', '预览影响': 'Preview impact', '确认应用': 'Confirm and apply', '请至少选择一个批量字段': 'Enable at least one field',
  '设置关联项目': 'Set project', '设置项目阶段': 'Set project stage', '设置客户质量工程师': 'Set customer quality engineer', '设置项目质量工程师': 'Set project quality engineer',
  '设置产品大类': 'Set product category', '设置产品细分': 'Set product subcategory', '清空客户质量工程师': 'Clear customer quality engineer', '清空项目质量工程师': 'Clear project quality engineer', '清空产品细分': 'Clear product subcategory',
  '仅勾选的字段会修改；空白不代表清空。共享项目修改会影响该项目的全部组件。': 'Only enabled fields change. Blank does not mean clear. Shared project changes affect all its components.',
  '同项目另有 {count} 条未选组件': '{count} additional unselected components share this project',
  '未映射组件调整阶段或工程师时，必须同时选择关联项目。': 'To change stage or engineers for unmapped components, also select a project.',
  '共享字段发生变化时，同项目未选组件也会受影响；实际影响数以预览结果为准。': 'Shared-field changes also affect unselected components of that project. The preview gives the actual affected count.',
  '查看项目资料': 'View project details',
  '选中 {selected} 条，影响 {affected} 条组件': '{selected} selected; {affected} components affected',
  '已更新 {mappings} 条组件资料、{projects} 个项目；影响 {affected} 条组件。': 'Updated {mappings} component records and {projects} projects; affected {affected} components.',
  '任职已失效': ' appointment is invalid', '任职资料不可用': 'Appointment details unavailable',
  '请在项目资料中重新选择或清空该任职。': 'Select another appointment or clear it in project details.',
  '原任职不存在或不可读': 'The original appointment is missing or unavailable', '用户已停用': 'The user is disabled',
  '任职尚未生效': 'The appointment has not started', '任职已结束': 'The appointment has ended',
  '岗位已停用': 'The position is disabled', '部门已停用': 'The department is disabled',
  '需要有效的内部任职': 'A valid internal appointment is required', '任职组织不一致': 'The appointment organization does not match',
};
const assignmentIssues: Record<string, string> = {
  ASSIGNMENT_NOT_FOUND: '原任职不存在或不可读', ORGANIZATION_DISABLED: '组织已停用', INTERNAL_USER_REQUIRED: '需要有效的内部任职',
  ASSIGNMENT_ORGANIZATION_MISMATCH: '任职组织不一致', USER_DISABLED: '用户已停用', ASSIGNMENT_NOT_STARTED: '任职尚未生效',
  ASSIGNMENT_ENDED: '任职已结束', POSITION_DISABLED: '岗位已停用', DEPARTMENT_DISABLED: '部门已停用',
};
function useCopy() {
  const { t, locale } = useLanguage();
  return (text: string) => locale === 'en-US' ? english[text] ?? t(text) : t(text);
}
function projectLabel(project: ProjectDisplay, t: (text: string) => string) {
  return `${project.code} · ${project.name} · ${t(project.stage === 'NEW_PRODUCT' ? '新品' : '量产')}${project.status === 'DISABLED' ? ` · ${t('停用')}` : ''}`;
}
function assignmentLabel(assignment: Assignment, t: (text: string) => string) {
  const unavailable = t(assignment.assignmentId ? '任职资料不可用' : '未配置');
  const name = assignment.fullName && assignment.username ? `${assignment.fullName}（${assignment.username}）` : assignment.fullName || assignment.username || unavailable;
  return `${name} · ${assignment.positionName || unavailable} / ${assignment.departmentName || unavailable}`;
}

function EngineerCell({ assignment, label }: { assignment: Assignment; label: string }) {
  const t = useCopy();
  if (!assignment.assignmentId) return <Typography.Text type="secondary">{t('未配置')}</Typography.Text>;
  const identity = assignmentLabel(assignment, t);
  const reason = assignment.issues.map(issue => t(assignmentIssues[issue] ?? '任职资料不可用')).join('；');
  return <span style={{ display: 'flex', alignItems: 'center', minWidth: 0, gap: 4 }}>
    <Typography.Text ellipsis={{ tooltip: identity }} style={{ flex: 1, minWidth: 0 }}>{identity}</Typography.Text>
    {!assignment.valid && <Tooltip trigger={['hover', 'focus', 'click']} title={`${reason} ${t('请在项目资料中重新选择或清空该任职。')}`}>
      <Button type="text" size="small" aria-label={`${label}${t('任职已失效')}`} style={{ flexShrink: 0 }} icon={<CircleAlert size={16} aria-hidden="true" />} />
    </Tooltip>}
  </span>;
}

function EngineerPicker({ organizationId, id, value, onChange, disabled, onReady, onUnauthorized, label }: PickerProps & { label: string }) {
  const t = useCopy();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<AssignmentsPage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const session = useWorkTabsStore.getState().sessionScope;
    const current = () => active && session === useWorkTabsStore.getState().sessionScope;
    setLoading(true); setError(undefined); onReady(!value);
    const query = new URLSearchParams({ page: String(page), pageSize: '20', search });
    if (value) query.set('selectedAssignmentId', value);
    void apiRequest<AssignmentsPage>(`${configurationPath(organizationId, 'component-project-mappings/engineer-assignments')}&${query}`, { signal: controller.signal })
      .then(next => { if (current()) { setResult(next); onReady(!value || !!next.selected?.valid && next.selected.assignmentId === value); } })
      .catch(cause => { if (current()) { setError(cause); if (cause instanceof ApiError && cause.status === 401) onUnauthorized(cause); } })
      .finally(() => { if (current()) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [organizationId, value, page, search, revision, onReady, onUnauthorized]);
  const selected = result?.selected && result.selected.assignmentId === value ? result.selected : result?.items.find(item => item.assignmentId === value);
  const choices = (result?.items ?? []).filter(item => item.assignmentId && item.valid);
  if (selected?.assignmentId && !choices.some(item => item.assignmentId === selected.assignmentId)) choices.unshift(selected);
  const invalid = !!value && !loading && !error && !selected?.valid;
  const change = (next: string | null) => { onReady(!next || !!choices.find(item => item.assignmentId === next)?.valid); onChange?.(next); };
  return <div className="governance-panel">
    <Select id={id} aria-label={label} value={value ?? undefined} disabled={disabled} loading={loading} virtual={false}
      showSearch={{ filterOption: false, onSearch: next => { setSearch(next); setPage(1); } }}
      onChange={change} placeholder={t('未配置')}
      options={[
        ...choices.map(item => ({ value: item.assignmentId!, label: assignmentLabel(item, t), disabled: !item.valid })),
        ...(value && !choices.some(item => item.assignmentId === value) ? [{ value, label: t('已选任职待确认'), disabled: true }] : []),
      ]} notFoundContent={loading ? t('加载中') : error ? t('加载失败') : t('无匹配结果')} />
    {value && <Button disabled={disabled} aria-label={`${t('清空')}${label}`} onClick={() => change(null)}>{t('清空')}</Button>}
    {invalid && <Typography.Text type="warning">{t('已选任职失效，请重新选择或清空')} <Tooltip trigger={['hover', 'focus', 'click']} title={t('已选任职失效，请重新选择或清空')}><Button type="text" size="small" aria-label={t('已选任职失效，请重新选择或清空')} icon={<CircleAlert size={16} aria-hidden="true" />} /></Tooltip></Typography.Text>}
    <GovernanceFeedback error={error} retry={disabled ? undefined : () => setRevision(next => next + 1)} />
    {(result?.total ?? 0) > 20 && <Pagination aria-label={t('工程师候选分页')} size="small" current={page} pageSize={20} total={result?.total} showSizeChanger={false} disabled={disabled || loading} onChange={setPage} />}
  </div>;
}

function ProjectPicker({ organizationId, id, value, onChange, disabled, onReady, onUnauthorized, initialProject, includeDisabled = true, allowClear = false, onRecord }: PickerProps & { initialProject?: ProjectDisplay | null; includeDisabled?: boolean; allowClear?: boolean; onRecord?: (record: Project | undefined) => void }) {
  const t = useCopy();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<ProjectsPage>();
  const [selected, setSelected] = useState<ProjectDisplay | undefined>(initialProject ?? undefined);
  const [loading, setLoading] = useState(true);
  const [selectedLoading, setSelectedLoading] = useState(!!value);
  const [error, setError] = useState<unknown>();
  const [selectedError, setSelectedError] = useState<unknown>();
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const session = useWorkTabsStore.getState().sessionScope;
    const current = () => active && session === useWorkTabsStore.getState().sessionScope;
    setLoading(true); setError(undefined); setResult(undefined);
    const query = new URLSearchParams({ search, page: String(page), pageSize: '20' });
    if (!includeDisabled) query.set('status', 'ACTIVE');
    void apiRequest<ProjectsPage>(`${configurationPath(organizationId, 'component-project-records')}&${query}`, { signal: controller.signal })
      .then(next => { if (current()) setResult(next); })
      .catch(cause => { if (current()) { setError(cause); if (cause instanceof ApiError && cause.status === 401) onUnauthorized(cause); } })
      .finally(() => { if (current()) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [organizationId, search, page, revision, onUnauthorized, includeDisabled]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const session = useWorkTabsStore.getState().sessionScope;
    const current = () => active && session === useWorkTabsStore.getState().sessionScope;
    onReady(false); onRecord?.(undefined); setSelectedError(undefined); setSelectedLoading(!!value);
    if (value) void apiRequest<Project>(configurationPath(organizationId, `component-project-records/${encodeURIComponent(value)}`), { signal: controller.signal })
      .then(next => {
        if (!current()) return;
        if (next.id !== value || next.organizationId !== organizationId) throw new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: '' }, 403);
        setSelected(next); onReady(includeDisabled || next.status === 'ACTIVE'); onRecord?.(next);
      })
      .catch(cause => { if (current()) { setSelectedError(cause); if (cause instanceof ApiError && cause.status === 401) onUnauthorized(cause); } })
      .finally(() => { if (current()) setSelectedLoading(false); });
    else setSelected(undefined);
    return () => { active = false; controller.abort(); };
  }, [organizationId, value, revision, onReady, onUnauthorized, includeDisabled, onRecord]);
  const choices: ProjectDisplay[] = (result?.items ?? []).filter(item => item.organizationId === organizationId);
  if (selected && selected.id === value && !choices.some(item => item.id === value)) choices.unshift(selected);
  return <div className="governance-panel">
    <Select id={id} aria-label={t('关联项目')} value={value ?? undefined} disabled={disabled} loading={loading || selectedLoading} virtual={false}
      showSearch={{ filterOption: false, onSearch: next => { setSearch(next); setPage(1); } }}
      allowClear={allowClear} onClear={() => { onReady(false); onRecord?.(undefined); onChange?.(null); }}
      onChange={next => { const choice = choices.find(item => item.id === next); setSelected(choice); onReady(false); onChange?.(next ?? null); }}
      placeholder={t('请选择关联项目')} options={[
        ...choices.map(item => ({ value: item.id, label: projectLabel(item, t), disabled: !includeDisabled && item.status !== 'ACTIVE' })),
        ...(value && !choices.some(item => item.id === value) ? [{ value, label: t('已选项目待确认'), disabled: true }] : []),
      ]} notFoundContent={loading ? t('加载中') : error ? t('加载失败') : t('无匹配结果')} />
    {!!selectedError && <Typography.Text type="warning">{t('已选项目不可用，请重试或重新选择')}</Typography.Text>}
    {!includeDisabled && !selectedError && selected && selected.id === value && selected.status !== 'ACTIVE' && <Typography.Text type="warning">{t('项目已停用，请重新选择')}</Typography.Text>}
    <GovernanceFeedback error={selectedError || error} retry={disabled ? undefined : () => setRevision(next => next + 1)} />
    {(result?.total ?? 0) > 20 && <Pagination aria-label={t('项目候选分页')} size="small" current={page} pageSize={20} total={result?.total} showSizeChanger={false} disabled={disabled || loading} onChange={setPage} />}
  </div>;
}

export function ComponentProjectAdministration({ organization }: { organization: AdminOrganization }) {
  const session = useWorkTabsStore(state => state.sessionScope);
  const wasBound = useRef(!!session);
  if (session) wasBound.current = true;
  // Session reset can render before the login navigation commits; do not remount readers in that gap.
  if (wasBound.current && !session) return null;
  return <ComponentProjectScope key={JSON.stringify([session, organization.id, [...organization.permissions].sort()])} organization={organization} />;
}

function BulkEditor({ organizationId, selection, onClose, onSaved, onBusyChange, onUnauthorized }: {
  organizationId: string; selection: BulkPreviewInput['selection']; onClose: () => void;
  onSaved: (result: BulkApplyResult) => void; onBusyChange: (busy: boolean) => void; onUnauthorized: (error: unknown) => void;
}) {
  const t = useCopy();
  const leave = useNavigationGuard();
  const session = useWorkTabsStore.getState().sessionScope;
  const [form] = Form.useForm<BulkChanges>();
  const [enabled, setEnabled] = useState<Set<keyof BulkChanges>>(() => new Set());
  const [cleared, setCleared] = useState<Set<keyof BulkChanges>>(() => new Set());
  const [preview, setPreview] = useState<{ input: BulkPreviewInput; result: BulkPreviewResult }>();
  const [uncertain, setUncertain] = useState<BulkApplyInput>();
  const [error, setError] = useState<unknown>();
  const [validation, setValidation] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [projectReady, setProjectReady] = useState(false);
  const [customerReady, setCustomerReady] = useState(false);
  const [engineerReady, setEngineerReady] = useState(false);
  const [previewMutation] = useState(createAdminMutation);
  const [applyMutation] = useState(createAdminMutation);
  const alive = useRef(false);
  const lifetime = useRef<AbortController | undefined>(undefined);
  const pending = useRef(false);
  const signature = JSON.stringify(selection);
  const selectionIdentity = useRef(signature); selectionIdentity.current = signature;
  const current = () => alive.current && session === useWorkTabsStore.getState().sessionScope && selectionIdentity.current === signature;
  useUnsavedChanges(dirty);
  useNavigationBusy(busy);
  useEffect(() => {
    alive.current = true; lifetime.current = new AbortController();
    return () => { alive.current = false; lifetime.current?.abort(); };
  }, []);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  useEffect(() => { setPreview(undefined); }, [signature]);
  function invalidate() { setDirty(true); setPreview(undefined); setValidation(undefined); setError(undefined); }
  function toggle(key: keyof BulkChanges, checked: boolean) {
    setEnabled(previous => { const next = new Set(previous); if (checked) next.add(key); else next.delete(key); return next; }); invalidate();
  }
  function clear(key: keyof BulkChanges, checked: boolean) {
    setCleared(previous => { const next = new Set(previous); if (checked) next.add(key); else next.delete(key); return next; });
    form.setFieldValue(key, checked ? null : undefined); invalidate();
  }
  async function loadPreview(values: BulkChanges) {
    if (pending.current || uncertain) return;
    if (!enabled.size) { setValidation(t('请至少选择一个批量字段')); return; }
    if (enabled.has('projectRecordId') && !projectReady || enabled.has('customerEngineerAssignmentId') && !cleared.has('customerEngineerAssignmentId') && !customerReady || enabled.has('projectEngineerAssignmentId') && !cleared.has('projectEngineerAssignmentId') && !engineerReady) return;
    const changes: BulkChanges = {};
    if (enabled.has('projectRecordId')) changes.projectRecordId = values.projectRecordId;
    if (enabled.has('stage')) changes.stage = values.stage;
    if (enabled.has('customerEngineerAssignmentId')) changes.customerEngineerAssignmentId = cleared.has('customerEngineerAssignmentId') ? null : values.customerEngineerAssignmentId;
    if (enabled.has('projectEngineerAssignmentId')) changes.projectEngineerAssignmentId = cleared.has('projectEngineerAssignmentId') ? null : values.projectEngineerAssignmentId;
    if (enabled.has('productCategory')) changes.productCategory = values.productCategory?.trim();
    if (enabled.has('productSubcategory')) changes.productSubcategory = cleared.has('productSubcategory') ? null : values.productSubcategory?.trim();
    const input: BulkPreviewInput = { selection, changes };
    pending.current = true; setBusy(true); setError(undefined); setPreview(undefined); setValidation(undefined);
    try {
      const result = await previewMutation<BulkPreviewResult>(configurationPath(organizationId, 'component-project-mappings/bulk-preview'), 'POST', input, lifetime.current?.signal);
      if (current()) setPreview({ input, result });
    } catch (cause) { if (current()) { setError(cause); if (cause instanceof ApiError && cause.status === 401) onUnauthorized(cause); } }
    finally { pending.current = false; if (current()) setBusy(false); }
  }
  async function apply(input: BulkApplyInput) {
    if (pending.current || !current()) return;
    pending.current = true; setBusy(true); setError(undefined);
    try {
      const result = await applyMutation<BulkApplyResult>(configurationPath(organizationId, 'component-project-mappings/bulk-apply'), 'POST', input, lifetime.current?.signal);
      if (current()) { setDirty(false); setUncertain(undefined); onSaved(result); }
    } catch (cause) {
      if (!current()) return;
      setError(cause);
      if (!(cause instanceof ApiError) || cause.status !== undefined && cause.status >= 500) setUncertain(input);
      else { setPreview(undefined); setUncertain(undefined); }
      if (cause instanceof ApiError && cause.status === 401) onUnauthorized(cause);
    } finally { pending.current = false; if (current()) setBusy(false); }
  }
  function close() { if (!pending.current) leave(() => { if (current()) onClose(); }, true); }
  const frozen = busy || !!uncertain;
  const required = [{ required: true, message: t('请填写必填内容') }];
  const fields: Array<{ key: keyof BulkChanges; label: string }> = [
    { key: 'projectRecordId', label: '关联项目' }, { key: 'stage', label: '项目阶段' },
    { key: 'customerEngineerAssignmentId', label: '客户质量工程师' }, { key: 'projectEngineerAssignmentId', label: '项目质量工程师' },
    { key: 'productCategory', label: '产品大类' }, { key: 'productSubcategory', label: '产品细分' },
  ];
  return <Modal title={t('批量设置')} open onCancel={close} closable={!busy} keyboard={!busy} mask={{ closable: !busy }} footer={null} width={640}>
    <Typography.Paragraph>{t('仅勾选的字段会修改；空白不代表清空。共享项目修改会影响该项目的全部组件。')}</Typography.Paragraph>
    <Typography.Paragraph type="secondary">{t('未映射组件调整阶段或工程师时，必须同时选择关联项目。')}</Typography.Paragraph>
    <Form form={form} name="component-project-bulk" layout="vertical" disabled={frozen} onValuesChange={invalidate} onFinish={loadPreview}>
      <GovernanceFeedback error={error} />
      {validation && <Typography.Paragraph role="alert">{validation}</Typography.Paragraph>}
      {fields.map(({ key, label }) => <div key={key} className="governance-panel">
        <Checkbox checked={enabled.has(key)} onChange={event => toggle(key, event.target.checked)}>{t(`设置${label}`)}</Checkbox>
        {enabled.has(key) && <>
          {(key === 'customerEngineerAssignmentId' || key === 'projectEngineerAssignmentId' || key === 'productSubcategory') && <Checkbox checked={cleared.has(key)} onChange={event => clear(key, event.target.checked)}>{t(`清空${label}`)}</Checkbox>}
          <Form.Item name={key} label={t(label)} rules={cleared.has(key) ? [] : [...required, ...(key === 'productCategory' || key === 'productSubcategory' ? [{ whitespace: true, message: t('请填写必填内容') }] : [])]}>
            {key === 'projectRecordId' ? <ProjectPicker organizationId={organizationId} disabled={frozen} onReady={setProjectReady} onUnauthorized={onUnauthorized} />
              : key === 'stage' ? <Select aria-label={t(label)} virtual={false} options={[{ value: 'NEW_PRODUCT', label: t('新品') }, { value: 'MASS_PRODUCTION', label: t('量产') }]} />
                : key === 'customerEngineerAssignmentId' || key === 'projectEngineerAssignmentId' ? <EngineerPicker organizationId={organizationId} label={t(label)} disabled={frozen || cleared.has(key)} onReady={key === 'customerEngineerAssignmentId' ? setCustomerReady : setEngineerReady} onUnauthorized={onUnauthorized} />
                  : <Input maxLength={100} disabled={frozen || cleared.has(key)} />}
          </Form.Item>
        </>}
      </div>)}
      {uncertain ? <><Typography.Paragraph role="status">{t('保存结果尚未确认，请使用原请求重试。')}</Typography.Paragraph><Button disabled={busy} loading={busy} onClick={() => void apply(uncertain)}>{t('重试原请求')}</Button></> : <Button htmlType="submit" loading={busy}>{t('预览影响')}</Button>}
      {preview && !uncertain && <section aria-label={t('预览影响')} className="governance-panel">
        <Typography.Text strong>{t('选中 {selected} 条，影响 {affected} 条组件').replace('{selected}', String(preview.result.selectedCount)).replace('{affected}', String(preview.result.affectedMappingsCount))}</Typography.Text>
        <Typography.Text type="secondary">{t('共享字段发生变化时，同项目未选组件也会受影响；实际影响数以预览结果为准。')}</Typography.Text>
        <ul>{preview.result.affectedProjects.map(project => <li key={project.id} style={{ overflowWrap: 'anywhere' }}>
          <Typography.Text strong>{project.code} · {project.name} · {t(project.stage === 'NEW_PRODUCT' ? '新品' : '量产')}</Typography.Text>
          <Typography.Text type={project.status === 'DISABLED' ? 'warning' : 'secondary'}> · <span>{t(project.status === 'DISABLED' ? '停用' : '启用')}</span></Typography.Text>
          <Typography.Paragraph>{t('同项目另有 {count} 条未选组件').replace('{count}', String(project.otherComponentCount))}</Typography.Paragraph>
        </li>)}</ul>
        <Button type="primary" disabled={busy} loading={busy} onClick={() => void apply({ ...preview.input, previewToken: preview.result.previewToken })}>{t('确认应用')}</Button>
      </section>}
      <div className="qms-dialog-actions"><Button disabled={busy} aria-label={t('关闭编辑器')} onClick={close}>{t('关闭')}</Button></div>
    </Form>
  </Modal>;
}

function ComponentProjectScope({ organization }: { organization: AdminOrganization }) {
  const t = useCopy();
  const navigate = useNavigate();
  const requestLeave = useNavigationGuard();
  const completeSessionNavigation = useCompletedSessionNavigation();
  const session = useWorkTabsStore.getState().sessionScope;
  const [query, setQuery] = useState({ search: '', page: 1, pageSize: 20 });
  const [searchInput, setSearchInput] = useState('');
  const [revision, setRevision] = useState(0);
  const [mappings, setMappings] = useState<MappingsPage>();
  const [selection, setSelection] = useState<Record<string, Pick<Mapping, 'id' | 'version'>>>({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [notice, setNotice] = useState<BulkApplyResult>();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project>();
  const [projectLoading, setProjectLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const [editor, setEditor] = useState<Editor>();
  const [dirty, setDirty] = useState(false);
  const [uncertain, setUncertain] = useState<Attempt>();
  const [customerReady, setCustomerReady] = useState(true);
  const [engineerReady, setEngineerReady] = useState(true);
  const [projectReady, setProjectReady] = useState(false);
  const [form] = Form.useForm<CreateProject & CreateMapping>();
  const [mutate] = useState(createAdminMutation);
  const alive = useRef(false);
  const lifetime = useRef<AbortController | undefined>(undefined);
  const pending = useRef(false);
  const ending = useRef(false);
  const editorGeneration = useRef(0);
  const trigger = useRef<HTMLElement | null>(null);
  const projectController = useRef<AbortController | undefined>(undefined);
  const read = organization.permissions.includes('component-project:read');
  const manage = read && organization.permissions.includes('component-project:manage');
  const current = () => alive.current && !ending.current && session === useWorkTabsStore.getState().sessionScope;
  useUnsavedChanges(!!editor && (dirty || !!uncertain));
  const busy = saving || projectLoading || bulkBusy;
  useNavigationBusy(busy);
  useEffect(() => {
    alive.current = true; lifetime.current = new AbortController();
    return () => { alive.current = false; editorGeneration.current++; lifetime.current?.abort(); projectController.current?.abort(); };
  }, []);
  const reportError = useCallback((cause: unknown) => {
    if (!alive.current || ending.current || session !== useWorkTabsStore.getState().sessionScope) return;
    if (cause instanceof ApiError && cause.status === 401) {
      ending.current = true; editorGeneration.current++;
      setEditor(undefined); setDirty(false); setUncertain(undefined); form.resetFields(); setMappings(undefined); setSelection({}); setSelectedProject(undefined);
      completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
    } else setError(cause);
  }, [session, form, completeSessionNavigation, navigate]);
  useEffect(() => {
    if (!read) { setLoading(false); return; }
    let active = true;
    const controller = new AbortController();
    const valid = () => active && alive.current && !ending.current && session === useWorkTabsStore.getState().sessionScope;
    setLoading(true); setError(undefined); setMappings(undefined);
    const params = new URLSearchParams({ search: query.search, page: String(query.page), pageSize: String(query.pageSize) });
    const path = configurationPath(organization.id, 'component-project-mappings');
    const request = apiRequest<MappingsPage>(`${path}&${params}`, { signal: controller.signal }).then(next => { if (valid()) setMappings({ ...next, items: next.items.filter(item => item.organizationId === organization.id) }); });
    void request.catch(cause => { if (valid()) reportError(cause); }).finally(() => { if (valid()) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [organization.id, read, query, revision, session, reportError]);

  function clearEditor() { editorGeneration.current++; setEditor(undefined); setDirty(false); setUncertain(undefined); form.resetFields(); setError(undefined); }
  function leave(action: () => void, closing = false) {
    if (pending.current || projectLoading) return;
    const generation = editorGeneration.current;
    requestLeave(() => { if (current() && generation === editorGeneration.current) { clearEditor(); action(); } }, closing);
  }
  function refresh() { if (!pending.current && !loading) leave(() => setRevision(next => next + 1)); }
  function open(next: Editor, target: HTMLElement) {
    if (!read || pending.current || projectLoading) return;
    leave(() => {
      if (!target.closest('[role="dialog"]')) trigger.current = target;
      setCustomerReady(next.kind !== 'project' || !next.record?.customerEngineerAssignmentId);
      setEngineerReady(next.kind !== 'project' || !next.record?.projectEngineerAssignmentId);
      setProjectReady(false);
      setProjectId(null); setSelectedProject(undefined);
      if (next.kind === 'project') form.setFieldsValue(next.record ?? { status: 'ACTIVE' });
      if (next.kind === 'mapping') form.setFieldsValue(next.record
        ? { ...next.record, projectRecordId: next.record.projectRecordId ?? undefined, productCategory: next.record.productCategory ?? undefined }
        : { status: 'ACTIVE' });
      setEditor(next);
    });
  }
  function editProject(id: string, target: HTMLElement) {
    leave(() => {
      trigger.current = target; setEditor({ kind: 'projects' }); setProjectLoading(true);
      const generation = editorGeneration.current;
      projectController.current?.abort(); const controller = new AbortController(); projectController.current = controller;
      void apiRequest<Project>(configurationPath(organization.id, `component-project-records/${encodeURIComponent(id)}`), { signal: controller.signal }).then(record => {
        if (!current() || generation !== editorGeneration.current) return;
        if (record.organizationId !== organization.id || record.id !== id) throw new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: '' }, 403);
        setCustomerReady(!record.customerEngineerAssignmentId); setEngineerReady(!record.projectEngineerAssignmentId);
        form.setFieldsValue(record); setEditor({ kind: 'project', record });
      }).catch(cause => { if (current() && generation === editorGeneration.current) reportError(cause); })
        .finally(() => { if (current() && generation === editorGeneration.current) setProjectLoading(false); });
    });
  }
  async function send(attempt: Attempt) {
    if (!current() || !manage || pending.current || !editor) return;
    pending.current = true; setSaving(true); setError(undefined);
    try {
      await mutate(attempt.path, attempt.method, attempt.body, lifetime.current?.signal);
      if (current()) { clearEditor(); setRevision(next => next + 1); }
    } catch (cause) {
      if (!current()) return;
      if (!(cause instanceof ApiError) || (cause.status !== undefined && cause.status >= 500)) setUncertain(attempt);
      else setUncertain(undefined);
      reportError(cause);
    } finally { pending.current = false; if (current()) setSaving(false); }
  }
  function save(values: CreateProject & CreateMapping) {
    if (!editor || editor.kind === 'projects' || !manage || pending.current || uncertain) return;
    if (editor.kind === 'project') {
      if (!customerReady || !engineerReady) return;
      const body: CreateProject = { code: values.code.trim(), name: values.name.trim(), stage: values.stage, customerEngineerAssignmentId: values.customerEngineerAssignmentId ?? null, projectEngineerAssignmentId: values.projectEngineerAssignmentId ?? null, status: values.status };
      void send({ path: configurationPath(organization.id, `component-project-records${editor.record ? `/${encodeURIComponent(editor.record.id)}` : ''}`), method: editor.record ? 'PATCH' : 'POST', body: editor.record ? { ...body, expectedVersion: editor.record.version } : body });
    } else {
      const record = editor.record;
      const nextProject = values.projectRecordId ?? null;
      if (nextProject && nextProject !== record?.projectRecordId && !projectReady) return;
      if (record) {
        const body: UpdateMapping = { expectedVersion: record.version };
        const code = values.componentCode.trim();
        const name = values.componentName?.trim() || null;
        if (code !== record.componentCode) body.componentCode = code;
        if (name !== record.componentName) body.componentName = name;
        if (values.status && values.status !== record.status) body.status = values.status;
        if (nextProject && nextProject !== record.projectRecordId) body.projectRecordId = nextProject;
        const category = values.productCategory?.trim() || null;
        if (category && category !== record.productCategory) body.productCategory = category;
        const subcategory = values.productSubcategory?.trim() || null;
        if (subcategory !== record.productSubcategory) body.productSubcategory = subcategory;
        if (Object.keys(body).length === 1) { clearEditor(); return; }
        void send({ path: configurationPath(organization.id, `component-project-mappings/${encodeURIComponent(record.id)}`), method: 'PATCH', body });
      } else {
        if (!projectReady) return;
        const body: CreateMapping = { componentCode: values.componentCode.trim(), componentName: values.componentName?.trim() || null, projectRecordId: values.projectRecordId, productCategory: values.productCategory.trim(), productSubcategory: values.productSubcategory?.trim() || null, status: values.status };
        void send({ path: configurationPath(organization.id, 'component-project-mappings'), method: 'POST', body });
      }
    }
  }
  if (!read) return <Alert type="info" showIcon title={t('无组件项目映射读取权限')} />;
  const statusOptions = [{ value: 'ACTIVE', label: t('启用') }, { value: 'DISABLED', label: t('停用') }];
  const empty = error ? t('加载失败') : query.search ? t('无匹配结果') : t('暂无数据');
  const pagination = { current: query.page, pageSize: query.pageSize, total: mappings?.total ?? 0, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], disabled: busy || loading, onChange: (page: number, pageSize: number) => leave(() => setQuery(previous => ({ ...previous, page: pageSize === previous.pageSize ? page : 1, pageSize }))) };
  const text = (value: string) => <Typography.Text ellipsis={{ tooltip: value }} style={{ maxWidth: '100%' }}>{value}</Typography.Text>;
  const required = [{ required: true, whitespace: true, message: t('请填写必填内容') }];
  const frozen = busy || !!uncertain;
  return <section className="governance-panel" aria-label={t('组件项目映射')} style={{ minWidth: 0 }}>
    {notice && <Typography.Paragraph role="status">{t('已更新 {mappings} 条组件资料、{projects} 个项目；影响 {affected} 条组件。').replace('{mappings}', String(notice.updatedMappingCount)).replace('{projects}', String(notice.updatedProjectCount)).replace('{affected}', String(notice.affectedComponentCount))}</Typography.Paragraph>}
    {!editor && <GovernanceFeedback error={error} retry={loading || busy ? undefined : refresh} />}
    <div className="governance-toolbar">
      {manage && <Button type="primary" disabled={loading || busy} onClick={event => open({ kind: 'mapping' }, event.currentTarget)}>{t('新增组件')}</Button>}
      <Button disabled={busy} onClick={event => open({ kind: 'projects' }, event.currentTarget)}>{t('项目资料')}</Button>
      {manage && <Form component={false} disabled={busy || !!editor}><ComponentProjectImport organizationId={organization.id} onUnauthorized={reportError} onImported={() => { if (current()) setRevision(next => next + 1); }} /></Form>}
      <Button disabled={loading || busy} onClick={refresh}>{t('刷新')}</Button>
      <Input.Search aria-label={t('搜索组件')} maxLength={200} value={searchInput} disabled={busy} allowClear style={{ width: 'min(100%, 320px)' }}
        onChange={event => setSearchInput(event.target.value)} onSearch={search => leave(() => setQuery({ ...query, search: search.trim(), page: 1 }))} />
      {!manage && <Typography.Text>{t('只读')}</Typography.Text>}
    </div>
    {manage && <Space wrap><Typography.Text aria-live="polite">{t('已选择 {count} / 100').replace('{count}', String(Object.keys(selection).length))}</Typography.Text><Button disabled={busy || bulkOpen || !Object.keys(selection).length} onClick={() => leave(() => setBulkOpen(true))}>{t('批量设置')}</Button><Button disabled={busy || bulkOpen || !Object.keys(selection).length} onClick={() => setSelection({})}>{t('清除选择')}</Button></Space>}
    <Table<Mapping> rowKey="id" loading={loading} dataSource={mappings?.items ?? []} scroll={{ x: 1550 }} pagination={pagination}
      rowSelection={manage ? { selectedRowKeys: Object.keys(selection), preserveSelectedRowKeys: true,
        getCheckboxProps: record => ({ disabled: busy || bulkOpen || !selection[record.id] && Object.keys(selection).length >= 100 }),
        onChange: keys => {
          if (busy || bulkOpen || keys.length > 100) return;
          const next: typeof selection = {};
          for (const key of keys) {
            const id = String(key); const record = mappings?.items.find(item => item.id === id);
            const captured = selection[id] ?? (record ? { id: record.id, version: record.version } : undefined);
            if (captured) next[id] = captured;
          }
          setSelection(next);
        },
      } : undefined}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} /> }} columns={[
        { title: t('组件编码'), dataIndex: 'componentCode', width: 160, render: text },
        { title: t('组件名称'), dataIndex: 'componentName', width: 200, render: value => value ? text(value) : '—' },
        { title: t('关联项目'), width: 230, render: (_, record) => record.project ? text(`${record.project.code} · ${record.project.name}`) : <Space>—<Tooltip trigger={['hover', 'focus', 'click']} title={t('尚未关联项目，可稍后完善映射。')}><Button type="text" size="small" aria-label={t('未映射')} icon={<CircleAlert size={16} aria-hidden="true" />} /></Tooltip></Space> },
        { title: t('产品大类'), dataIndex: 'productCategory', width: 140, render: value => value ? text(value) : <Space>—<Tooltip trigger={['hover', 'focus', 'click']} title={t('产品大类未配置，可稍后完善。')}><Button type="text" size="small" aria-label={t('产品大类未配置')} icon={<CircleAlert size={16} aria-hidden="true" />} /></Tooltip></Space> }, { title: t('产品细分'), dataIndex: 'productSubcategory', width: 140, render: value => value ? text(value) : '—' },
        { title: t('项目阶段'), width: 100, render: (_, record) => record.project ? t(record.project.stage === 'NEW_PRODUCT' ? '新品' : '量产') : '—' },
        { title: t('客户质量工程师'), width: 160, render: (_, record) => record.project ? <EngineerCell assignment={record.project.customerEngineer} label={t('客户质量工程师')} /> : '—' },
        { title: t('项目质量工程师'), width: 160, render: (_, record) => record.project ? <EngineerCell assignment={record.project.projectEngineer} label={t('项目质量工程师')} /> : '—' },
        { title: t('状态'), dataIndex: 'status', width: 100, render: status => t(status === 'ACTIVE' ? '启用' : '停用') },
        { title: t('操作'), width: 200, render: (_, record) => <Space wrap>{manage ? <Button disabled={busy} aria-label={`${t('编辑组件')} ${record.componentCode}`} onClick={event => open({ kind: 'mapping', record }, event.currentTarget)}>{t('编辑')}</Button> : t('只读')}{record.project && <Button disabled={busy} aria-label={`${t(manage ? '编辑项目' : '查看项目')} ${record.project.code}`} onClick={event => editProject(record.project!.id, event.currentTarget)}>{t('项目资料')}</Button>}</Space> },
      ]} />
    {bulkOpen && manage && <BulkEditor organizationId={organization.id} selection={Object.values(selection).map(record => ({ id: record.id, expectedVersion: record.version }))}
      onClose={() => { if (current()) setBulkOpen(false); }} onBusyChange={setBulkBusy} onUnauthorized={reportError}
      onSaved={result => { if (current()) { setBulkOpen(false); setSelection({}); setNotice(result); setRevision(next => next + 1); } }} />}
    <Modal title={t(editor?.kind === 'mapping' ? '组件映射' : '项目资料')} open={!!editor} forceRender closable={!busy} mask={{ closable: !busy }} keyboard={!busy}
      onCancel={() => leave(() => {}, true)} afterClose={() => { if (current()) trigger.current?.focus(); }} footer={null}>
      <Form form={form} name="component-project-editor" layout="vertical" onValuesChange={() => setDirty(true)} onFinish={save} disabled={!manage || frozen}>
        {editor && <>
        <GovernanceFeedback error={error} />
        {uncertain && <><Typography.Paragraph role="status">{t('保存结果尚未确认，请使用原请求重试。')}</Typography.Paragraph><Button disabled={saving} loading={saving} onClick={() => void send(uncertain)}>{t('重试原请求')}</Button></>}
        {error instanceof ApiError && error.status === 409 && <Button disabled={saving} onClick={refresh}>{t('放弃并刷新')}</Button>}
        {projectLoading ? <Spin aria-label={t('加载中')} /> : editor.kind === 'projects' ? <div className="governance-panel">
          <label>{t('选择项目')}</label><ProjectPicker organizationId={organization.id} allowClear disabled={busy} value={projectId} onChange={setProjectId} onReady={setProjectReady} onRecord={setSelectedProject} onUnauthorized={reportError} />
          <Space wrap>{selectedProject && <Button disabled={!projectReady} onClick={event => open({ kind: 'project', record: selectedProject }, event.currentTarget)}>{t(manage ? '编辑项目资料' : '查看项目资料')}</Button>}{manage && <Button onClick={event => open({ kind: 'project' }, event.currentTarget)}>{t('新增项目')}</Button>}</Space>
        </div> : editor.kind === 'project' ? <>
          <Form.Item name="code" label={t('项目编码')} rules={required}><Input maxLength={100} autoFocus /></Form.Item>
          <Form.Item name="name" label={t('项目名称')} rules={required}><Input maxLength={200} /></Form.Item>
          <Form.Item name="stage" label={t('项目阶段')} rules={[{ required: true, message: t('请选择项目阶段') }]}><Select aria-label={t('项目阶段')} virtual={false} options={[{ value: 'NEW_PRODUCT', label: t('新品') }, { value: 'MASS_PRODUCTION', label: t('量产') }]} /></Form.Item>
          <Form.Item name="customerEngineerAssignmentId" label={t('客户质量工程师')}><EngineerPicker label={t('客户质量工程师')} organizationId={organization.id} disabled={!manage || frozen} onReady={setCustomerReady} onUnauthorized={reportError} /></Form.Item>
          <Form.Item name="projectEngineerAssignmentId" label={t('项目质量工程师')}><EngineerPicker label={t('项目质量工程师')} organizationId={organization.id} disabled={!manage || frozen} onReady={setEngineerReady} onUnauthorized={reportError} /></Form.Item>
        </> : <>
          <Form.Item name="componentCode" label={t('组件编码')} rules={required}><Input maxLength={100} autoFocus /></Form.Item>
          <Form.Item name="componentName" label={t('组件名称')}><Input maxLength={200} /></Form.Item>
          <Form.Item name="projectRecordId" label={t('关联项目')} rules={editor.record ? [] : [{ required: true, message: t('请选择关联项目') }]}><ProjectPicker organizationId={organization.id} initialProject={editor.record?.project} disabled={frozen} onReady={setProjectReady} onUnauthorized={reportError} /></Form.Item>
          <Form.Item name="productCategory" label={t('产品大类')} rules={!editor.record || editor.record.productCategory ? required : []}><Input maxLength={100} /></Form.Item>
          <Form.Item name="productSubcategory" label={t('产品细分')}><Input maxLength={100} /></Form.Item>
        </>}
        {editor.kind !== 'projects' && !projectLoading && <Form.Item name="status" label={t('状态')} rules={[{ required: true }]}><Select virtual={false} options={statusOptions} /></Form.Item>}
        {editor.kind === 'project' && editor.record && manage && !projectLoading && <Typography.Paragraph>{t('修改将影响同项目的全部组件。')}</Typography.Paragraph>}
        <div className="qms-dialog-actions">
          <Button aria-label={t('关闭编辑器')} disabled={busy} onClick={() => leave(() => {}, true)}>{t('关闭')}</Button>
          {editor.kind !== 'projects' && !projectLoading && <Button type="primary" htmlType="submit" loading={saving} disabled={!manage || frozen || (editor.kind === 'project' ? !customerReady || !engineerReady : !editor.record && !projectReady)}>{t('保存')}</Button>}
        </div>
        </>}
      </Form>
    </Modal>
  </section>;
}
