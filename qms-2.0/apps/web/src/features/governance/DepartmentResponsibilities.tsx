import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Collapse, Descriptions, Form, Input, Modal, Select, Space, Table, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, createAdminMutation } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useCompletedSessionNavigation, useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import type { AdminOrganization } from '../admin/admin';
import { allStructurePages, organizationPath, type Department, type Position } from './governance';
import { GovernanceFeedback } from './GovernanceFeedback';

type Binding = components['schemas']['ManagementBindingDto'];
type Scope = components['schemas']['MinisterScopeDto'];
type Assignment = components['schemas']['ResponsibilityAssignmentDto'];
type Assignments = components['schemas']['ResponsibilityAssignmentsDto'];
type Preview = components['schemas']['ManagementResponsibilitiesDto'];
type CreateBinding = components['schemas']['CreateManagementBindingDto'];
type UpdateBinding = components['schemas']['UpdateManagementBindingDto'];
type CreateScope = components['schemas']['CreateMinisterScopeDto'];
type UpdateScope = components['schemas']['UpdateMinisterScopeDto'];
type Props = { organization: AdminOrganization; departmentId: string; departments: Department[]; positions: Position[] };
type Editor = { kind: 'binding'; record?: Binding } | { kind: 'scope'; record?: Scope };
type Values = { responsibility: Binding['responsibility']; positionId: string; sectionDepartmentId: string; ministerAssignmentId: string; status: Binding['status']; validFrom?: string; validTo?: string; endMode: 'DEFAULT' | 'DATE' | 'UNBOUNDED' };
type Attempt = { path: string; method: 'POST' | 'PATCH'; body: CreateBinding | UpdateBinding | CreateScope | UpdateScope };

const english: Record<string, string> = {
  '管理职责': 'Management responsibility', '职责岗位': 'Responsible position', '职责绑定': 'Responsibility bindings', '部长分管': 'Minister scopes',
  '科室经理': 'Section manager', '部长': 'Minister', '职责预览': 'Preview responsibilities', '职责预览结果': 'Responsibility preview results',
  '新增职责绑定': 'Add responsibility binding', '编辑职责绑定': 'Edit responsibility binding', '新增部长分管': 'Add minister scope', '编辑部长分管': 'Edit minister scope',
  '无组织职责读取权限': 'You cannot read organization responsibilities.', '分管科室': 'Covered section', '部长任职': 'Minister appointment',
  '开始时间': 'Start time', '结束时间': 'End time', '结束方式': 'End mode', '默认任职结束时间': 'Default to appointment end', '指定结束时间': 'Specify end time', '无结束时间': 'No end time',
  '职责来源': 'Responsibility sources', '职责绑定版本': 'Binding version', '任职有效期': 'Appointment validity', '分管有效期': 'Scope validity',
  '未配置职责绑定': 'Responsibility binding is missing', '存在多个职责绑定': 'Multiple responsibility bindings', '未配置有效任职': 'Effective appointment is missing',
  '存在多个有效任职候选': 'Multiple effective appointment candidates', '未配置部长分管': 'Minister scope is missing', '存在多个有效分管': 'Multiple effective minister scopes', '组织或部门已失效': 'Organization or department is inactive',
  '已选任职失效，请重新选择；不会自动更换人员。': 'The selected appointment is invalid. Choose another; no automatic substitution.',
  '请先维护有效下级科室，再新增部长分管。': 'Maintain active descendant sections before adding minister scopes.',
  '分管维护请选择部长所属部门节点；当前节点仍可预览职责及缺项。': 'Maintain scopes on the minister department. This node can still preview responsibilities and issues.',
  '仅维护职责与分管，不修改岗位权限或用户任职。': 'Maintains responsibilities and scopes only, not permissions or appointments.',
  '分管时间重叠或配置版本冲突，输入已保留，请核对后重试。': 'Scope overlap or version conflict. Inputs are retained; check and retry.',
  '保存结果尚未确认，请使用原请求重试。': 'Save result is unknown. Retry the original request.', '重试原请求': 'Retry original request', '放弃并刷新': 'Discard and refresh',
  '已保存': 'Saved', '服务器当前时间': 'Server current time', '未获取分管来源有效期': 'Scope source validity is unavailable', '分管来源版本已变化，请重新预览': 'Scope source version changed; preview again',
  '以下缺项仅为配置提示，不阻断本页维护；不代表审批结果。': 'These configuration issues do not block maintenance and are not approval results.',
  '请检查有效期及任职范围，输入已保留。': 'Check validity bounds and appointment scope. Inputs are retained.',
  '任职已失效或不可见': 'Appointment is inactive or unavailable',
};
function localDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}

export function DepartmentResponsibilities(props: Props) {
  const session = useWorkTabsStore(state => state.sessionScope);
  return <ResponsibilitiesScope key={JSON.stringify([session, props.organization.id, props.departmentId, [...props.organization.permissions].sort()])} {...props} />;
}

function ResponsibilitiesScope({ organization, departmentId, departments, positions }: Props) {
  const { t: translate, locale } = useLanguage();
  const t = (text: string) => locale === 'en-US' ? english[text] ?? translate(text) : translate(text);
  const navigate = useNavigate();
  const completeSessionNavigation = useCompletedSessionNavigation();
  const requestLeave = useNavigationGuard();
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState<unknown>();
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<unknown>();
  const [editor, setEditor] = useState<Editor>();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [unknownAttempt, setUnknownAttempt] = useState<Attempt>();
  const [preview, setPreview] = useState<Preview>();
  const [previewScopes, setPreviewScopes] = useState<Scope[]>([]);
  const [previewError, setPreviewError] = useState<unknown>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const pending = useRef(false);
  const alive = useRef(false);
  const ending = useRef(false);
  const [session] = useState(() => useWorkTabsStore.getState().sessionScope);
  const lifetime = useRef<AbortController | undefined>(undefined);
  const previewController = useRef<AbortController | undefined>(undefined);
  const previewGeneration = useRef(0);
  const [mutate] = useState(createAdminMutation);
  const [form] = Form.useForm<Values>();
  const selectedAppointment = Form.useWatch('ministerAssignmentId', form);
  const endMode = Form.useWatch('endMode', form);
  const status = Form.useWatch('status', form);
  const read = organization.permissions.includes('organization:structure:read');
  const manage = read && organization.permissions.includes('organization:structure:manage');
  const department = departments.find(item => item.id === departmentId && item.organizationId === organization.id);
  const active = department?.status === 'ACTIVE';
  const current = useCallback(() => alive.current && !ending.current && session === useWorkTabsStore.getState().sessionScope, [session]);
  const reportError = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) {
      ending.current = true; lifetime.current?.abort(); previewController.current?.abort(); setEditor(undefined); setDirty(false); setUnknownAttempt(undefined);
      setBindings([]); setScopes([]); setAssignments([]); setPreview(undefined); setPreviewScopes([]); form.resetFields();
      completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
    } else setError(cause);
  }, [completeSessionNavigation, navigate, form]);
  const eligiblePositions = positions.filter(item => item.organizationId === organization.id && item.departmentId === departmentId && item.status === 'ACTIVE');
  const descendants = departments.filter(item => {
    if (item.id === departmentId || item.organizationId !== organization.id || item.status !== 'ACTIVE') return false;
    const seen = new Set([item.id]);
    let parent = item.parentId;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const entry = departments.find(candidate => candidate.id === parent && candidate.organizationId === organization.id && candidate.status === 'ACTIVE');
      if (!entry) return false;
      if (entry.id === departmentId) return true;
      parent = entry.parentId;
    }
    return false;
  });
  const ministerBindings = bindings.filter(item => item.responsibility === 'MINISTER' && item.status === 'ACTIVE');
  const candidates = assignments.filter(item => ministerBindings.length === 1 && item.positionId === ministerBindings[0].positionId
    && item.departmentId === departmentId && eligiblePositions.some(position => position.id === item.positionId)
    && new Date(item.startedAt).getTime() <= Date.now() && (!item.endedAt || new Date(item.endedAt).getTime() > Date.now()));
  const invalidAppointment = !!selectedAppointment && !candidatesLoading && !candidatesError && !candidates.some(item => item.assignmentId === selectedAppointment);
  const labelDepartment = (id: string) => departments.find(item => item.id === id && item.organizationId === organization.id)?.name ?? id;
  const assignmentLabel = (item: Assignment) => `${item.fullName ? `${item.fullName} (${item.username})` : item.username} · ${item.positionName} / ${labelDepartment(item.departmentId)}`;
  const role = (value: Binding['responsibility']) => t(value === 'MINISTER' ? '部长' : '科室经理');
  const interval = (start: string, end: string | null) => `${start} — ${end ?? t('无结束时间')}`;

  useUnsavedChanges(!!editor && (dirty || !!unknownAttempt));
  useNavigationBusy(saving);
  useEffect(() => {
    alive.current = true; lifetime.current = new AbortController();
    return () => { alive.current = false; lifetime.current?.abort(); previewController.current?.abort(); previewGeneration.current += 1; };
  }, []);
  useEffect(() => {
    if (!read) return;
    let live = true;
    const controller = new AbortController();
    const query = `?departmentId=${encodeURIComponent(departmentId)}`;
    setLoading(true); setError(undefined); setBindings([]); setScopes([]); setPreview(undefined); setPreviewScopes([]);
    void Promise.all([
      allStructurePages<Binding>(organizationPath(organization.id, `/management-bindings${query}`), controller.signal),
      allStructurePages<Scope>(organizationPath(organization.id, `/minister-scopes${query}`), controller.signal),
    ]).then(([nextBindings, nextScopes]) => {
      if (!live || !current()) return;
      setBindings(nextBindings.filter(item => item.organizationId === organization.id && item.departmentId === departmentId));
      setScopes(nextScopes.filter(item => item.organizationId === organization.id && item.departmentId === departmentId));
    }).catch(cause => { if (live && current()) reportError(cause); }).finally(() => { if (live && current()) setLoading(false); });
    return () => { live = false; controller.abort(); };
  }, [organization.id, departmentId, read, revision, current, reportError]);
  const needsAssignments = read && (editor?.kind === 'scope' || scopes.length > 0);
  useEffect(() => {
    if (!needsAssignments) return;
    let live = true;
    const controller = new AbortController();
    setCandidatesLoading(true); setCandidatesError(undefined); setAssignments([]);
    async function load() {
      // shortcut: bounded directory preload for local search; use server search if this window grows.
      const items: Assignment[] = [];
      for (let offset = 0; offset <= 10000; offset += 100) {
        controller.signal.throwIfAborted();
        const query = new URLSearchParams({ departmentId, search: '', limit: '100', offset: String(offset) });
        const page = await apiRequest<Assignments>(organizationPath(organization.id, `/responsibility-assignments?${query}`), { signal: controller.signal });
        items.push(...page.items);
        if (offset + page.items.length >= page.total) return items;
        if (!page.items.length) throw new Error('Incomplete appointment page');
      }
      throw new Error('Appointments exceed supported page window');
    }
    void load().then(items => { if (live && current()) setAssignments(items); }).catch(cause => {
      if (live && current()) { setCandidatesError(cause); if (cause instanceof ApiError && cause.status === 401) reportError(cause); }
    }).finally(() => { if (live && current()) setCandidatesLoading(false); });
    return () => { live = false; controller.abort(); };
  }, [organization.id, departmentId, needsAssignments, revision, current, reportError]);

  function reload() {
    previewGeneration.current += 1; previewController.current?.abort();
    setPreview(undefined); setPreviewScopes([]); setPreviewError(undefined); setPreviewLoading(false);
    setRevision(value => value + 1);
  }
  function closeEditor(refresh = false) {
    if (pending.current || !current()) return;
    requestLeave(() => {
      if (pending.current || !current()) return;
      setEditor(undefined); setDirty(false); setUnknownAttempt(undefined); setError(undefined); form.resetFields();
      if (refresh) reload();
    });
  }
  function edit(next: Editor) {
    if (pending.current || !manage || !current()) return;
    requestLeave(() => {
      if (pending.current || !current()) return;
      setError(undefined); setSaved(false); setDirty(false); setUnknownAttempt(undefined); form.resetFields();
      if (next.kind === 'binding') form.setFieldsValue(next.record ?? { responsibility: undefined, positionId: undefined });
      else form.setFieldsValue({ ...next.record, validFrom: localDate(next.record?.validFrom), validTo: localDate(next.record?.validTo), endMode: next.record ? next.record.validTo ? 'DATE' : 'UNBOUNDED' : 'DEFAULT' });
      setEditor(next);
    });
  }
  async function submit(attempt: Attempt) {
    if (pending.current || !manage || !current()) return;
    pending.current = true; setSaving(true); setError(undefined);
    try {
      await mutate(attempt.path, attempt.method, attempt.body, lifetime.current?.signal);
      if (current()) { setEditor(undefined); setDirty(false); setUnknownAttempt(undefined); form.resetFields(); setSaved(true); reload(); }
    } catch (cause) {
      if (current()) {
        reportError(cause);
        if (!(cause instanceof ApiError) || !cause.status || cause.status >= 500) setUnknownAttempt(attempt);
      }
    } finally { pending.current = false; if (current()) setSaving(false); }
  }
  function save(values: Values) {
    if (!editor || pending.current || !manage || !current()) return;
    if (unknownAttempt) { void submit(unknownAttempt); return; }
    const path = organizationPath(organization.id, editor.kind === 'binding' ? '/management-bindings' : '/minister-scopes');
    if (editor.kind === 'binding') {
      if ((!editor.record || values.status === 'ACTIVE' || values.positionId !== editor.record.positionId) && !eligiblePositions.some(item => item.id === values.positionId)) {
        setError(new ApiError({ code: 'STRUCTURE_REFERENCE_INVALID', message: '' }, 422)); return;
      }
      if (editor.record) {
        const body: UpdateBinding = { expectedVersion: editor.record.version, status: values.status, ...(values.positionId !== editor.record.positionId ? { positionId: values.positionId } : {}) };
        void submit({ path: `${path}/${encodeURIComponent(editor.record.id)}`, method: 'PATCH', body });
      } else {
        const body: CreateBinding = { departmentId, responsibility: values.responsibility, positionId: values.positionId };
        void submit({ path, method: 'POST', body });
      }
    } else {
      const record = editor.record;
      const disablingOnly = !!record && values.status === 'DISABLED' && values.ministerAssignmentId === record.ministerAssignmentId && values.sectionDepartmentId === record.sectionDepartmentId && values.validFrom === localDate(record.validFrom)
        && values.endMode === (record.validTo ? 'DATE' : 'UNBOUNDED') && values.validTo === localDate(record.validTo);
      if (!disablingOnly && (candidatesLoading || candidatesError || !candidates.some(item => item.assignmentId === values.ministerAssignmentId) || !descendants.some(item => item.id === values.sectionDepartmentId))) {
        setError(new ApiError({ code: 'STRUCTURE_REFERENCE_INVALID', message: '' }, 422)); return;
      }
      const dates: Pick<CreateScope, 'validFrom' | 'validTo'> = {};
      if (values.validFrom && (!record || values.validFrom !== localDate(record.validFrom))) dates.validFrom = new Date(values.validFrom).toISOString();
      if (values.endMode === 'UNBOUNDED' && (!record || record.validTo !== null)) dates.validTo = null;
      else if (values.endMode === 'DATE' && values.validTo && (!record || values.validTo !== localDate(record.validTo))) dates.validTo = new Date(values.validTo).toISOString();
      if (record) {
        const body: UpdateScope = { expectedVersion: record.version, status: values.status, ...dates,
          ...(values.sectionDepartmentId !== record.sectionDepartmentId ? { sectionDepartmentId: values.sectionDepartmentId } : {}),
          ...(values.ministerAssignmentId !== record.ministerAssignmentId ? { ministerAssignmentId: values.ministerAssignmentId } : {}),
        };
        void submit({ path: `${path}/${encodeURIComponent(record.id)}`, method: 'PATCH', body });
      } else {
        const body: CreateScope = { departmentId, sectionDepartmentId: values.sectionDepartmentId, ministerAssignmentId: values.ministerAssignmentId, ...dates };
        void submit({ path, method: 'POST', body });
      }
    }
  }
  async function loadPreview() {
    if (pending.current || previewLoading || !read || !current()) return;
    const generation = ++previewGeneration.current;
    previewController.current?.abort();
    const controller = new AbortController();
    previewController.current = controller;
    const isCurrent = () => current() && previewGeneration.current === generation && !controller.signal.aborted;
    setPreviewLoading(true); setPreviewError(undefined); setPreview(undefined); setPreviewScopes([]);
    try {
      const result = await apiRequest<Preview>(organizationPath(organization.id, `/management-responsibilities?sectionDepartmentId=${encodeURIComponent(departmentId)}`), { signal: controller.signal });
      if (!isCurrent()) return;
      if (result.organizationId !== organization.id || result.sectionDepartmentId !== departmentId) throw new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: '' }, 403);
      setPreview(result);
      const sourceDepartments = [...new Set(result.responsibilities.filter(item => item.scopeId).map(item => item.departmentId))];
      const sources = await Promise.all(sourceDepartments.map(id => allStructurePages<Scope>(organizationPath(organization.id, `/minister-scopes?departmentId=${encodeURIComponent(id)}`), controller.signal)));
      if (isCurrent()) setPreviewScopes(sources.flat().filter(item => item.organizationId === organization.id));
    } catch (cause) { if (isCurrent()) { setPreviewError(cause); if (cause instanceof ApiError && cause.status === 401) reportError(cause); } }
    finally { if (isCurrent()) setPreviewLoading(false); }
  }
  const issueText: Record<Preview['issues'][number]['code'], string> = { STRUCTURE_INACTIVE: '组织或部门已失效', BINDING_MISSING: '未配置职责绑定', BINDING_AMBIGUOUS: '存在多个职责绑定', ASSIGNMENT_MISSING: '未配置有效任职', ASSIGNMENT_AMBIGUOUS: '存在多个有效任职候选', SCOPE_MISSING: '未配置部长分管', SCOPE_AMBIGUOUS: '存在多个有效分管' };
  if (!read) return <Alert type="warning" showIcon title={t('无组织职责读取权限')} />;
  const frozen = saving || !!unknownAttempt;
  const invalidSelection = editor?.kind === 'scope' && status !== 'DISABLED' && (candidatesLoading || !!candidatesError || invalidAppointment);
  return <section className="governance-panel" aria-label={t('管理职责')}>
    <Typography.Text type="secondary">{t('仅维护职责与分管，不修改岗位权限或用户任职。')}</Typography.Text>
    {!editor && <GovernanceFeedback error={error} retry={() => { if (!pending.current) closeEditor(true); }} />}
    {saved && <Alert type="success" showIcon title={t('已保存')} />}
    <Space wrap>
      <Button disabled={saving || loading} onClick={() => closeEditor(true)}>{t('刷新')}</Button>
      <Button disabled={saving || loading || previewLoading} loading={previewLoading} onClick={() => void loadPreview()}>{t('职责预览')}</Button>
    </Space>
    <Typography.Title level={5}>{t('职责绑定')}</Typography.Title>
    {manage && <Button disabled={saving || loading || !!error || !active} onClick={() => edit({ kind: 'binding' })}>{t('新增职责绑定')}</Button>}
    <Table<Binding> rowKey="id" loading={loading} pagination={false} scroll={{ x: 560 }} dataSource={bindings} columns={[
      { title: t('管理职责'), dataIndex: 'responsibility', render: role },
      { title: t('职责岗位'), dataIndex: 'positionId', render: (id: string) => positions.find(item => item.id === id && item.organizationId === organization.id)?.name ?? id },
      { title: t('状态'), dataIndex: 'status', render: (value: string) => t(value === 'ACTIVE' ? '启用' : '停用') },
      { title: t('版本'), dataIndex: 'version' },
      { title: t('操作'), render: (_value, record) => manage ? <Button aria-label={`${t('编辑职责绑定')} · ${role(record.responsibility)}`} disabled={saving || loading || !!error} onClick={() => edit({ kind: 'binding', record })}>{t('编辑')}</Button> : t('只读') },
    ]} />
    <Typography.Title level={5}>{t('部长分管')}</Typography.Title>
    <Typography.Text type="secondary">{t('分管维护请选择部长所属部门节点；当前节点仍可预览职责及缺项。')}</Typography.Text>
    {manage && <><Button disabled={saving || loading || !!error || !active || !descendants.length || ministerBindings.length !== 1} onClick={() => edit({ kind: 'scope' })}>{t('新增部长分管')}</Button>
      {!descendants.length && <Typography.Text type="secondary">{t('请先维护有效下级科室，再新增部长分管。')}</Typography.Text>}
      {ministerBindings.length !== 1 && <Typography.Text type="warning">{t(ministerBindings.length ? '存在多个职责绑定' : '未配置职责绑定')} · {t('部长')}</Typography.Text>}</>}
    {editor?.kind !== 'scope' && <GovernanceFeedback error={candidatesError} retry={() => { if (!pending.current) reload(); }} />}
    <Table<Scope> rowKey="id" loading={loading} pagination={false} scroll={{ x: 900 }} dataSource={scopes} columns={[
      { title: t('分管科室'), dataIndex: 'sectionDepartmentId', render: labelDepartment },
      { title: t('部长任职'), dataIndex: 'ministerAssignmentId', render: (id: string) => { const item = candidates.find(entry => entry.assignmentId === id); return item ? assignmentLabel(item) : `${id} · ${t(candidatesLoading ? '加载中' : '任职已失效或不可见')}`; } },
      { title: t('开始时间'), dataIndex: 'validFrom' }, { title: t('结束时间'), dataIndex: 'validTo', render: (value: string | null) => value ?? t('无结束时间') },
      { title: t('状态'), dataIndex: 'status', render: (value: string) => t(value === 'ACTIVE' ? '启用' : '停用') }, { title: t('版本'), dataIndex: 'version' },
      { title: t('操作'), render: (_value, record) => manage ? <Button aria-label={`${t('编辑部长分管')} · ${labelDepartment(record.sectionDepartmentId)}`} disabled={saving || loading || !!error} onClick={() => edit({ kind: 'scope', record })}>{t('编辑')}</Button> : t('只读') },
    ]} />
    <GovernanceFeedback error={previewError} retry={() => void loadPreview()} />
    {preview && <section className="governance-panel" aria-label={t('职责预览结果')}>
      <Typography.Text>{preview.at}</Typography.Text>
      {!!preview.issues.length && <Alert type="info" showIcon title={t('以下缺项仅为配置提示，不阻断本页维护；不代表审批结果。')} description={<ul>{preview.issues.map((item, index) => <li key={`${item.responsibility}:${item.code}:${index}`}>{role(item.responsibility)}：{t(issueText[item.code])}</li>)}</ul>} />}
      <Table<Preview['responsibilities'][number]> rowKey={item => `${item.responsibility}:${item.assignmentId}:${item.bindingId}:${item.scopeId}`} pagination={false} scroll={{ x: 660 }} dataSource={preview.responsibilities} columns={[
        { title: t('管理职责'), dataIndex: 'responsibility', render: role }, { title: t('姓名'), render: (_value, item) => item.fullName || item.username },
        { title: t('岗位'), dataIndex: 'positionName' }, { title: t('部门'), dataIndex: 'departmentId', render: labelDepartment },
        { title: t('职责来源'), render: (_value, item) => { const source = previewScopes.find(entry => entry.id === item.scopeId); return <Collapse size="small" items={[{ key: 'source', label: t('职责来源'), children: <Descriptions column={1} size="small" items={[
          { key: 'binding', label: t('职责绑定版本'), children: `${item.bindingId} · v${item.bindingVersion}` },
          { key: 'position', label: t('岗位'), children: `${item.positionName} · ${item.positionId} · v${item.positionVersion}` },
          { key: 'assignment', label: t('任职有效期'), children: `${item.assignmentId} · ${interval(item.startedAt, item.endedAt)}` },
          { key: 'scope', label: t('部长分管'), children: item.scopeId ? `${item.scopeId} · v${item.scopeVersion}` : '—' },
          ...(item.scopeId ? [{ key: 'scopeDate', label: t('分管有效期'), children: source && source.version === item.scopeVersion ? interval(source.validFrom, source.validTo) : t(source ? '分管来源版本已变化，请重新预览' : '未获取分管来源有效期') }] : []),
          { key: 'versions', label: t('版本'), children: `${t('组织')} v${item.organizationVersion} / ${t('部门')} v${item.departmentVersion} / ${t('分管科室')} v${item.sectionDepartmentVersion}` },
        ]} /> }]} />; } },
      ]} />
    </section>}
    {editor && <Modal open title={t(editor.kind === 'binding' ? editor.record ? '编辑职责绑定' : '新增职责绑定' : editor.record ? '编辑部长分管' : '新增部长分管')} onOk={() => { if (!pending.current) form.submit(); }} onCancel={() => closeEditor()} okText={t('保存')} cancelText={t('取消')} confirmLoading={saving} okButtonProps={{ disabled: !!unknownAttempt || !!invalidSelection }} cancelButtonProps={{ disabled: saving }} closable={!saving} keyboard={!saving} mask={{ closable: !saving }}>
      <GovernanceFeedback error={error} />
      {error instanceof ApiError && error.status === 409 && <Alert type="warning" showIcon title={t('分管时间重叠或配置版本冲突，输入已保留，请核对后重试。')} />}
      {error instanceof ApiError && error.status === 422 && <Alert type="warning" showIcon title={t('请检查有效期及任职范围，输入已保留。')} />}
      {unknownAttempt && <Alert type="warning" showIcon title={t('保存结果尚未确认，请使用原请求重试。')} action={<Space wrap><Button disabled={saving} onClick={() => void submit(unknownAttempt)}>{t('重试原请求')}</Button><Button disabled={saving} onClick={() => closeEditor(true)}>{t('放弃并刷新')}</Button></Space>} />}
      <Form<Values> name="department-responsibilities-editor" form={form} layout="vertical" disabled={frozen} onValuesChange={() => { setDirty(true); setSaved(false); }} onFinish={save}>
        {editor.kind === 'binding' ? <>
          <Form.Item name="responsibility" label={t('管理职责')} rules={[{ required: true }]}><Select aria-label={t('管理职责')} virtual={false} disabled={frozen || !!editor.record} options={(['SECTION_MANAGER', 'MINISTER'] as const).map(value => ({ value, label: role(value) }))} /></Form.Item>
          <Form.Item name="positionId" label={t('职责岗位')} rules={[{ required: true }]}><Select aria-label={t('职责岗位')} virtual={false} options={[
            ...eligiblePositions.map(item => ({ value: item.id, label: item.name })),
            ...(editor.record && !eligiblePositions.some(item => item.id === editor.record?.positionId) ? [{ value: editor.record.positionId, label: `${editor.record.positionId} · ${t('停用')}`, disabled: true }] : []),
          ]} /></Form.Item>
          {!editor.record && <Typography.Text type="secondary">{t('状态')}：{t('启用')}</Typography.Text>}
        </> : <>
          <Form.Item name="sectionDepartmentId" label={t('分管科室')} rules={[{ required: true }]}><Select aria-label={t('分管科室')} virtual={false} showSearch={{ optionFilterProp: 'label' }} options={[
            ...descendants.map(item => ({ value: item.id, label: item.name })),
            ...(editor.record && !descendants.some(item => item.id === editor.record?.sectionDepartmentId) ? [{ value: editor.record.sectionDepartmentId, label: `${labelDepartment(editor.record.sectionDepartmentId)} · ${t('停用')}`, disabled: true }] : []),
          ]} /></Form.Item>
          <GovernanceFeedback error={candidatesError} retry={frozen ? undefined : reload} />
          <Form.Item name="ministerAssignmentId" label={t('部长任职')} rules={[{ required: true }]}><Select aria-label={t('部长任职')} aria-busy={candidatesLoading} virtual={false} loading={candidatesLoading} disabled={frozen || candidatesLoading || !!candidatesError} showSearch={{ optionFilterProp: 'label' }} options={[
            ...candidates.map(item => ({ value: item.assignmentId, label: assignmentLabel(item) })),
            ...(selectedAppointment && !candidates.some(item => item.assignmentId === selectedAppointment) ? [{ value: selectedAppointment, label: `${selectedAppointment} · ${t('停用')}`, disabled: true }] : []),
          ]} /></Form.Item>
          {invalidAppointment && <Alert type="warning" showIcon title={t('已选任职失效，请重新选择；不会自动更换人员。')} />}
          <Form.Item name="validFrom" label={t('开始时间')} rules={[{ required: !!editor.record }, { validator: (_rule, value: string | undefined) => !value || Number.isFinite(new Date(value).getTime()) ? Promise.resolve() : Promise.reject(new Error(t('请检查填写内容'))) }]}><Input type="datetime-local" step="1" placeholder={t('服务器当前时间')} /></Form.Item>
          <Form.Item name="endMode" label={t('结束方式')}><Select aria-label={t('结束方式')} virtual={false} options={[
            ...(!editor.record ? [{ value: 'DEFAULT', label: t('默认任职结束时间') }] : []), { value: 'DATE', label: t('指定结束时间') }, { value: 'UNBOUNDED', label: t('无结束时间') },
          ]} /></Form.Item>
          {endMode === 'DATE' && <Form.Item name="validTo" label={t('结束时间')} rules={[{ required: true }, { validator: (_rule, value: string | undefined) => !value || Number.isFinite(new Date(value).getTime()) ? Promise.resolve() : Promise.reject(new Error(t('请检查填写内容'))) }]}><Input type="datetime-local" step="1" /></Form.Item>}
          {!editor.record && <Typography.Text type="secondary">{t('状态')}：{t('启用')}</Typography.Text>}
        </>}
        {editor.record && <Form.Item name="status" label={t('状态')} rules={[{ required: true }]}><Select aria-label={t('状态')} virtual={false} options={[{ value: 'ACTIVE', label: t('启用') }, { value: 'DISABLED', label: t('停用') }]} /></Form.Item>}
      </Form>
    </Modal>}
  </section>;
}
