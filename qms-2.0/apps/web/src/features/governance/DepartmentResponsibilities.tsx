import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select, Space, Table, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, createAdminMutation } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useCompletedSessionNavigation, useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import type { AdminOrganization } from '../admin/admin';
import { allStructurePages, organizationPath, type Department, type Position } from './governance';
import { GovernanceFeedback } from './GovernanceFeedback';

type Scope = components['schemas']['MinisterScopeDto'];
type Assignment = components['schemas']['ResponsibilityAssignmentDto'];
type Assignments = components['schemas']['ResponsibilityAssignmentsDto'];
type Leaders = components['schemas']['ResponsibleAppointmentsDto'];
type UpdateLeaders = components['schemas']['UpdateResponsibleAppointmentsDto'];
type CreateScope = components['schemas']['CreateMinisterScopeDto'];
type UpdateScope = components['schemas']['UpdateMinisterScopeDto'];
type Props = { organization: AdminOrganization; departmentId: string; departments: Department[]; positions: Position[] };
type Editor = { kind: 'leaders' } | { kind: 'scope'; record?: Scope };
type Values = { assignmentIds?: string[]; primaryAssignmentId?: string; sectionDepartmentId: string; ministerAssignmentId: string; status: Scope['status']; validFrom?: string; validTo?: string; endMode: 'DEFAULT' | 'DATE' | 'UNBOUNDED' };
type Attempt = { path: string; method: 'POST' | 'PATCH' | 'PUT'; body: UpdateLeaders | CreateScope | UpdateScope };

const english: Record<string, string> = {
  '管理职责': 'Management responsibility', '本部门职责': 'Department responsibilities', '下级部门分管': 'Subordinate department coverage',
  '本部门负责人': 'Department lead', '分管负责人': 'Assigned lead',
  '配置部门负责人': 'Configure department leads', '新增分管': 'Add coverage', '编辑分管': 'Edit coverage',
  '无组织职责读取权限': 'You cannot read organization responsibilities.', '分管部门': 'Covered department', '负责人': 'Responsible person', '主负责人': 'Primary lead',
  '仅一位负责人，自动设为主负责人。': 'The sole lead is automatically primary.', '请选择一位主负责人。': 'Select one primary lead.',
  '请补配有效的主负责人。': 'Configure an active primary lead.', '请先配置本部门负责人。': 'Configure department leads first.',
  '同一人员仅可选择一个任职。': 'Choose only one appointment per person.',
  '开始时间': 'Start time', '结束时间': 'End time', '结束方式': 'End mode', '默认任职结束时间': 'Default to appointment end', '指定结束时间': 'Specify end time', '无结束时间': 'No end time',
  '已选任职失效，请重新选择。': 'The selected appointment is invalid. Choose another.',
  '分管时间重叠或配置版本冲突，输入已保留，请核对后重试。': 'Scope overlap or version conflict. Inputs are retained; check and retry.',
  '保存结果尚未确认，请使用原请求重试。': 'Save result is unknown. Retry the original request.', '重试原请求': 'Retry original request', '放弃并刷新': 'Discard and refresh',
  '已保存': 'Saved', '服务器当前时间': 'Server current time',
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
  const [leaders, setLeaders] = useState<Leaders>();
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
  const pending = useRef(false);
  const alive = useRef(false);
  const ending = useRef(false);
  const [session] = useState(() => useWorkTabsStore.getState().sessionScope);
  const lifetime = useRef<AbortController | undefined>(undefined);
  const [mutate] = useState(createAdminMutation);
  const [form] = Form.useForm<Values>();
  const selectedAppointment = Form.useWatch('ministerAssignmentId', form);
  const selectedLeaders = Form.useWatch('assignmentIds', form) ?? [];
  const endMode = Form.useWatch('endMode', form);
  const status = Form.useWatch('status', form);
  const read = organization.permissions.includes('organization:structure:read');
  const manage = read && organization.permissions.includes('organization:structure:manage');
  const department = departments.find(item => item.id === departmentId && item.organizationId === organization.id);
  const active = department?.status === 'ACTIVE';
  const current = useCallback(() => alive.current && !ending.current && session === useWorkTabsStore.getState().sessionScope, [session]);
  const reportError = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) {
      ending.current = true; lifetime.current?.abort(); setEditor(undefined); setDirty(false); setUnknownAttempt(undefined);
      setLeaders(undefined); setScopes([]); setAssignments([]); form.resetFields();
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
  const hasDescendants = departments.some(item => item.organizationId === organization.id && item.parentId === departmentId);
  const effective = assignments.filter(item => item.departmentId === departmentId && eligiblePositions.some(position => position.id === item.positionId)
    && new Date(item.startedAt).getTime() <= Date.now() && (!item.endedAt || new Date(item.endedAt).getTime() > Date.now()));
  const candidates = effective.filter(item => leaders?.assignmentIds.includes(item.assignmentId));
  const invalidAppointment = !!selectedAppointment && !candidatesLoading && !candidatesError && !candidates.some(item => item.assignmentId === selectedAppointment);
  const labelDepartment = (id: string) => departments.find(item => item.id === id && item.organizationId === organization.id)?.name ?? id;
  const assignmentLabel = (item: Assignment) => `${item.fullName ? `${item.fullName} (${item.username})` : item.username} · ${item.positionName} / ${labelDepartment(item.departmentId)}`;
  const leadersPath = organizationPath(organization.id, `/departments/${encodeURIComponent(departmentId)}/responsible-appointments`);

  useUnsavedChanges(!!editor && (dirty || !!unknownAttempt));
  useNavigationBusy(saving);
  useEffect(() => {
    alive.current = true; lifetime.current = new AbortController();
    return () => { alive.current = false; lifetime.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!read) return;
    let live = true;
    const controller = new AbortController();
    const query = `?departmentId=${encodeURIComponent(departmentId)}`;
    setLoading(true); setError(undefined); setLeaders(undefined); setScopes([]);
    void Promise.all([
      apiRequest<Leaders>(leadersPath, { signal: controller.signal }),
      hasDescendants ? allStructurePages<Scope>(organizationPath(organization.id, `/minister-scopes${query}`), controller.signal) : [],
    ]).then(([nextLeaders, nextScopes]) => {
      if (!live || !current()) return;
      setLeaders(nextLeaders);
      setScopes(nextScopes.filter(item => item.organizationId === organization.id && item.departmentId === departmentId && item.departmentLeadership === true));
    }).catch(cause => { if (live && current()) reportError(cause); }).finally(() => { if (live && current()) setLoading(false); });
    return () => { live = false; controller.abort(); };
  }, [organization.id, departmentId, hasDescendants, leadersPath, read, revision, current, reportError]);
  const needsAssignments = read && (!!editor || !!leaders?.assignmentIds.length || scopes.length > 0);
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
      if (next.kind === 'leaders') form.setFieldsValue({ assignmentIds: leaders?.assignmentIds ?? [], primaryAssignmentId: leaders?.primaryAssignmentId ?? undefined });
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
    if (editor.kind === 'leaders') {
      if (!leaders || candidatesLoading || candidatesError) return;
      const assignmentIds = values.assignmentIds ?? [];
      if (assignmentIds.some(id => !effective.some(item => item.assignmentId === id))) {
        setError(new ApiError({ code: 'STRUCTURE_REFERENCE_INVALID', message: '' }, 422)); return;
      }
      const body: UpdateLeaders = { expectedVersion: leaders.version, assignmentIds,
        ...(assignmentIds.length > 1 ? { primaryAssignmentId: values.primaryAssignmentId } : {}) };
      void submit({ path: leadersPath, method: 'PUT', body });
    } else {
      const path = organizationPath(organization.id, '/minister-scopes');
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
        const body: CreateScope = { departmentId, sectionDepartmentId: values.sectionDepartmentId, ministerAssignmentId: values.ministerAssignmentId, departmentLeadership: true, ...dates };
        void submit({ path, method: 'POST', body });
      }
    }
  }
  if (!read) return <Alert type="warning" showIcon title={t('无组织职责读取权限')} />;
  const frozen = saving || !!unknownAttempt;
  const invalidSelection = editor?.kind === 'leaders' ? candidatesLoading || !!candidatesError
    : editor?.kind === 'scope' && status !== 'DISABLED' && (candidatesLoading || !!candidatesError || invalidAppointment);
  const displayAssignment = (id: string) => {
    const item = effective.find(entry => entry.assignmentId === id);
    return item ? assignmentLabel(item) : `${id} · ${t(candidatesLoading ? '加载中' : '任职已失效或不可见')}`;
  };
  const disabled = saving || loading || !!error || !active;
  const scopeTable = <Table<Scope> rowKey="id" loading={loading} pagination={false} scroll={{ x: 900 }} dataSource={scopes} columns={[
    { title: t('分管部门'), dataIndex: 'sectionDepartmentId', render: labelDepartment },
    { title: t('分管负责人'), dataIndex: 'ministerAssignmentId', render: displayAssignment },
    { title: t('开始时间'), dataIndex: 'validFrom' }, { title: t('结束时间'), dataIndex: 'validTo', render: (value: string | null) => value ?? t('无结束时间') },
    { title: t('状态'), dataIndex: 'status', render: (value: string) => t(value === 'ACTIVE' ? '启用' : '停用') }, { title: t('版本'), dataIndex: 'version' },
    { title: t('操作'), render: (_value, record) => manage ? <Button aria-label={`${t('编辑分管')} · ${labelDepartment(record.sectionDepartmentId)}`} disabled={saving || loading || !!error} onClick={() => edit({ kind: 'scope', record })}>{t('编辑')}</Button> : t('只读') },
  ]} />;
  return <section className="governance-panel" aria-label={t('管理职责')}>
    {!editor && <GovernanceFeedback error={error} retry={() => { if (!pending.current) closeEditor(true); }} />}
    {saved && <Alert type="success" showIcon title={t('已保存')} />}
    <Space wrap>
      <Button disabled={saving || loading} onClick={() => closeEditor(true)}>{t('刷新')}</Button>
    </Space>
    <Typography.Title level={5}>{t('本部门职责')}</Typography.Title>
    {manage && <Button disabled={saving || loading || !!error || !active} onClick={() => edit({ kind: 'leaders' })}>{t('配置部门负责人')}</Button>}
    {!!leaders?.assignmentIds.length && !candidatesLoading && !candidatesError && !effective.some(item => item.assignmentId === leaders.primaryAssignmentId) && <Alert type="warning" showIcon title={t('请补配有效的主负责人。')} />}
    {!editor && <GovernanceFeedback error={candidatesError} retry={() => { if (!pending.current) reload(); }} />}
    <Table<{ id: string }> rowKey="id" loading={loading || candidatesLoading} pagination={false} dataSource={leaders?.assignmentIds.map(id => ({ id })) ?? []} columns={[
      { title: t('负责人'), dataIndex: 'id', render: displayAssignment },
      { title: t('主负责人'), render: (_value, record) => record.id === leaders?.primaryAssignmentId ? t('是') : '—' },
    ]} />
    {hasDescendants && <section className="governance-panel" aria-label={t('下级部门分管')}>
    <Typography.Title level={5}>{t('下级部门分管')}</Typography.Title>
    {manage && <><Button disabled={disabled || !descendants.length || !leaders?.assignmentIds.length} onClick={() => edit({ kind: 'scope' })}>{t('新增分管')}</Button>
      {!loading && !leaders?.assignmentIds.length && <Typography.Text type="warning">{t('请先配置本部门负责人。')}</Typography.Text>}</>}
    {scopeTable}
    </section>}
    {editor && <Modal open title={t(editor.kind === 'leaders' ? '配置部门负责人' : editor.record ? '编辑分管' : '新增分管')} onOk={() => { if (!pending.current) form.submit(); }} onCancel={() => closeEditor()} okText={t('保存')} cancelText={t('取消')} confirmLoading={saving} okButtonProps={{ disabled: !!unknownAttempt || !!invalidSelection }} cancelButtonProps={{ disabled: saving }} closable={!saving} keyboard={!saving} mask={{ closable: !saving }}>
      <GovernanceFeedback error={error} />
      {error instanceof ApiError && error.status === 409 && <Alert type="warning" showIcon title={t('分管时间重叠或配置版本冲突，输入已保留，请核对后重试。')} />}
      {error instanceof ApiError && error.status === 422 && <Alert type="warning" showIcon title={t('请检查有效期及任职范围，输入已保留。')} />}
      {unknownAttempt && <Alert type="warning" showIcon title={t('保存结果尚未确认，请使用原请求重试。')} action={<Space wrap><Button disabled={saving} onClick={() => void submit(unknownAttempt)}>{t('重试原请求')}</Button><Button disabled={saving} onClick={() => closeEditor(true)}>{t('放弃并刷新')}</Button></Space>} />}
      <Form<Values> name="department-responsibilities-editor" form={form} layout="vertical" disabled={frozen} onValuesChange={() => { setDirty(true); setSaved(false); }} onFinish={save}>
        {editor.kind === 'leaders' ? <>
          <GovernanceFeedback error={candidatesError} retry={frozen ? undefined : reload} />
          <Form.Item name="assignmentIds" label={t('负责人')} rules={[{ validator: (_rule, ids: string[] = []) => {
            const users = ids.map(id => effective.find(item => item.assignmentId === id)?.userId).filter(Boolean);
            return new Set(users).size === users.length ? Promise.resolve() : Promise.reject(new Error(t('同一人员仅可选择一个任职。')));
          } }]}><Select mode="multiple" aria-label={t('负责人')} aria-busy={candidatesLoading} loading={candidatesLoading} disabled={frozen || candidatesLoading || !!candidatesError} virtual={false} showSearch={{ optionFilterProp: 'label' }} options={[
            ...effective.map(item => ({ value: item.assignmentId, label: assignmentLabel(item) })),
            ...selectedLeaders.filter(id => !effective.some(item => item.assignmentId === id)).map(id => ({ value: id, label: displayAssignment(id) })),
          ]} onChange={ids => { if (ids.length < 2 || !ids.includes(form.getFieldValue('primaryAssignmentId'))) form.setFieldValue('primaryAssignmentId', undefined); }} /></Form.Item>
          {selectedLeaders.length === 1 && <Typography.Text type="secondary">{t('仅一位负责人，自动设为主负责人。')}</Typography.Text>}
          {selectedLeaders.length > 1 && <Form.Item name="primaryAssignmentId" label={t('主负责人')} preserve={false} rules={[{ required: true, message: t('请选择一位主负责人。') }]}>
            <Select aria-label={t('主负责人')} virtual={false} options={effective.filter(item => selectedLeaders.includes(item.assignmentId)).map(item => ({ value: item.assignmentId, label: assignmentLabel(item) }))} />
          </Form.Item>}
        </> : <>
          <Form.Item name="sectionDepartmentId" label={t('分管部门')} rules={[{ required: true }]}><Select aria-label={t('分管部门')} virtual={false} showSearch={{ optionFilterProp: 'label' }} options={[
            ...descendants.map(item => ({ value: item.id, label: item.name })),
            ...(editor.record && !descendants.some(item => item.id === editor.record?.sectionDepartmentId) ? [{ value: editor.record.sectionDepartmentId, label: `${labelDepartment(editor.record.sectionDepartmentId)} · ${t('停用')}`, disabled: true }] : []),
          ]} /></Form.Item>
          <GovernanceFeedback error={candidatesError} retry={frozen ? undefined : reload} />
          <Form.Item name="ministerAssignmentId" label={t('分管负责人')} rules={[{ required: true }]}><Select aria-label={t('分管负责人')} aria-busy={candidatesLoading} virtual={false} loading={candidatesLoading} disabled={frozen || candidatesLoading || !!candidatesError} showSearch={{ optionFilterProp: 'label' }} options={[
            ...candidates.map(item => ({ value: item.assignmentId, label: assignmentLabel(item) })),
            ...(selectedAppointment && !candidates.some(item => item.assignmentId === selectedAppointment) ? [{ value: selectedAppointment, label: `${selectedAppointment} · ${t('停用')}`, disabled: true }] : []),
          ]} /></Form.Item>
          {invalidAppointment && <Alert type="warning" showIcon title={t('已选任职失效，请重新选择。')} />}
          <Form.Item name="validFrom" label={t('开始时间')} rules={[{ required: !!editor.record }, { validator: (_rule, value: string | undefined) => !value || Number.isFinite(new Date(value).getTime()) ? Promise.resolve() : Promise.reject(new Error(t('请检查填写内容'))) }]}><Input type="datetime-local" step="1" placeholder={t('服务器当前时间')} /></Form.Item>
          <Form.Item name="endMode" label={t('结束方式')}><Select aria-label={t('结束方式')} virtual={false} options={[
            ...(!editor.record ? [{ value: 'DEFAULT', label: t('默认任职结束时间') }] : []), { value: 'DATE', label: t('指定结束时间') }, { value: 'UNBOUNDED', label: t('无结束时间') },
          ]} /></Form.Item>
          {endMode === 'DATE' && <Form.Item name="validTo" label={t('结束时间')} rules={[{ required: true }, { validator: (_rule, value: string | undefined) => !value || Number.isFinite(new Date(value).getTime()) ? Promise.resolve() : Promise.reject(new Error(t('请检查填写内容'))) }]}><Input type="datetime-local" step="1" /></Form.Item>}
          {!editor.record && <Typography.Text type="secondary">{t('状态')}：{t('启用')}</Typography.Text>}
        </>}
        {editor.kind !== 'leaders' && editor.record && <Form.Item name="status" label={t('状态')} rules={[{ required: true }]}><Select aria-label={t('状态')} virtual={false} options={[{ value: 'ACTIVE', label: t('启用') }, { value: 'DISABLED', label: t('停用') }]} /></Form.Item>}
      </Form>
    </Modal>}
  </section>;
}
