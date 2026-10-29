import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Descriptions, Empty, Form, Pagination, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, createAdminMutation } from '../../api/client';
import type { AdminOrganization } from '../admin/admin';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { allStructurePages, organizationPath, type Department, type Organization } from './governance';
import { GovernanceFeedback } from './GovernanceFeedback';
import './AdministrativeReconfiguration.css';

type Item = components['schemas']['AdministrativeReconfigurationItemDto'];
type Page = components['schemas']['AdministrativeReconfigurationPageDto'];
type Body = components['schemas']['AdministrativeReconfigurationDto'];
type Result = components['schemas']['AdministrativeReconfigurationResultDto'];
type Props = {
  organization: AdminOrganization;
  onChanged?: () => void;
  onDenied?: (error: ApiError) => void;
  renderAdditionalActions?: (item: Item, onCompleted: () => void) => ReactNode;
};
const names: Record<Item['kind'], string> = { ORGANIZATION: '组织', DEPARTMENT: '部门/科室', POSITION: '岗位', USER: '用户' };
const pageSize = 20;

export function AdministrativeReconfiguration(props: Props) {
  const principal = useWorkTabsStore(state => state.sessionScope);
  return <ReconfigurationScope key={JSON.stringify([principal, props.organization.id, [...props.organization.permissions].sort()])} {...props} />;
}

function ReconfigurationScope({ organization, onChanged, onDenied, renderAdditionalActions }: Props) {
  const { t } = useLanguage();
  const requestLeave = useNavigationGuard();
  const [principal] = useState(() => useWorkTabsStore.getState().sessionScope);
  const [kind, setKind] = useState<Item['kind']>('ORGANIZATION');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<Page>();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selected, setSelected] = useState<Item>();
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const [targetOrganizationId, setTargetOrganizationId] = useState<string>();
  const [targetDepartmentId, setTargetDepartmentId] = useState<string>();
  const [parentId, setParentId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [departmentsLoading, setDepartmentsLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [directoryError, setDirectoryError] = useState<unknown>();
  const [directoryRevision, setDirectoryRevision] = useState(0);
  const [success, setSuccess] = useState<Result>();
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [conflict, setConflict] = useState<'version' | 'receipt'>();
  const [denied, setDenied] = useState(false);
  const alive = useRef(false);
  const invalid = useRef(false);
  const pending = useRef(false);
  const lifetime = useRef<AbortController | undefined>(undefined);
  const mutate = useRef(createAdminMutation({ replayAfterReauthentication: false }));
  const attempt = useRef<{ path: string; body: Body; item: Item } | undefined>(undefined);
  const callbacks = useRef({ onChanged, onDenied }); callbacks.current = { onChanged, onDenied };
  const current = () => alive.current && !invalid.current && principal === useWorkTabsStore.getState().sessionScope;
  useUnsavedChanges(dirty || unknown);
  useNavigationBusy(busy);

  useEffect(() => {
    alive.current = true; lifetime.current = new AbortController();
    const unsubscribe = useWorkTabsStore.subscribe(state => {
      // Abort CSRF as well as POST before React commits the new principal's tree.
      if (state.sessionScope !== principal) { invalid.current = true; lifetime.current?.abort(); }
    });
    return () => { alive.current = false; lifetime.current?.abort(); unsubscribe(); };
  }, [principal]);

  function fail(cause: unknown) {
    if (!current()) return;
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
      invalid.current = true; lifetime.current?.abort(); attempt.current = undefined;
      mutate.current = createAdminMutation({ replayAfterReauthentication: false });
      setPage(undefined); setOrganizations([]); setDepartments([]); setSelected(undefined);
      setTargetOrganizationId(undefined); setTargetDepartmentId(undefined); setParentId(null);
      setDirty(false); setUnknown(false); setBusy(false); setSuccess(undefined); setError(undefined); setDirectoryError(undefined); setDenied(true);
      callbacks.current.onDenied?.(cause);
    } else setError(cause);
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    lifetime.current?.signal.addEventListener('abort', abort);
    const valid = () => active && current();
    const observeDenial = (cause: unknown): never => {
      if (valid() && cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) fail(cause);
      throw cause;
    };
    setLoading(true); setPage(undefined); setError(undefined);
    void Promise.all([
      apiRequest<Page>(`/api/v1/admin/reconfiguration?kind=${kind}&pageSize=${pageSize}&offset=${offset}`, { signal: controller.signal }).catch(observeDenial),
      allStructurePages<Organization>(`/api/v1/organizations/tree?organizationId=${encodeURIComponent(organization.id)}`, controller.signal).catch(observeDenial),
    ]).then(([result, tree]) => {
      if (!valid()) return;
      setPage(result); setOrganizations(tree.filter(entry => entry.type === 'INTERNAL' && entry.status === 'ACTIVE'));
      const previous = selectedRef.current;
      if (previous) {
        const latest = result.items.find(entry => entry.id === previous.id && entry.kind === previous.kind);
        if (latest) { setSelected(latest); setConflict(undefined); }
        else { setConflict('version'); setError(new Error('Pending object no longer in this page')); }
      }
    }).catch(cause => { if (valid()) { setOrganizations([]); fail(cause); } })
      .finally(() => { if (valid()) setLoading(false); });
    return () => { active = false; controller.abort(); lifetime.current?.signal.removeEventListener('abort', abort); };
  }, [kind, offset, revision, organization.id]);

  const requirements = selected?.requiredConfiguration ?? [];
  const needsOrganization = requirements.includes('targetOrganizationId');
  const needsDepartment = requirements.includes('targetDepartmentId');
  const needsParent = requirements.includes('parentId');
  const departmentOrganizationId = needsOrganization ? targetOrganizationId : selected?.originalOrganizationId;
  const supported = !!selected && ({
    ORGANIZATION: ['parentId'],
    DEPARTMENT: ['parentId', 'targetDepartmentId,targetOrganizationId'],
    POSITION: ['targetDepartmentId', 'targetDepartmentId,targetOrganizationId'],
    USER: ['targetOrganizationId', 'appointmentAfterReconfiguration'],
  }[selected.kind].includes([...requirements].sort().join(',')));

  useEffect(() => {
    if (!selected || selected.kind === 'ORGANIZATION' || selected.kind === 'USER' || !departmentOrganizationId) {
      setDepartments([]); setDirectoryError(undefined); setDepartmentsLoading(false); return;
    }
    let active = true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    lifetime.current?.signal.addEventListener('abort', abort);
    setDepartmentsLoading(true); setDepartments([]); setDirectoryError(undefined);
    void allStructurePages<Department>(organizationPath(departmentOrganizationId, '/departments'), controller.signal)
      .then(result => { if (active && current()) setDepartments(result.filter(entry => entry.organizationId === departmentOrganizationId && entry.status === 'ACTIVE')); })
      .catch(cause => {
        if (!active || !current()) return;
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) fail(cause);
        else setDirectoryError(cause);
      }).finally(() => { if (active && current()) setDepartmentsLoading(false); });
    return () => { active = false; controller.abort(); lifetime.current?.signal.removeEventListener('abort', abort); };
  }, [selected?.id, selected?.kind, departmentOrganizationId, directoryRevision, revision]);

  function canParent(id: string, entries: { id: string; parentId: string | null }[]) {
    const visited = new Set<string>();
    let cursor: string | null | undefined = id;
    while (cursor) {
      if (cursor === selected?.id || visited.has(cursor)) return false;
      visited.add(cursor); cursor = entries.find(entry => entry.id === cursor)?.parentId;
    }
    return true;
  }
  const organizationCandidates = organizations.filter(entry => !selected || selected.kind !== 'ORGANIZATION' || canParent(entry.id, organizations));
  const departmentCandidates = departments.filter(entry => !selected || selected.kind !== 'DEPARTMENT' || !needsParent || canParent(entry.id, departments));
  const organizationValid = !needsOrganization || organizationCandidates.some(entry => entry.id === targetOrganizationId);
  const departmentValid = !needsDepartment || departmentCandidates.some(entry => entry.id === targetDepartmentId);
  const parentValid = !needsParent || (selected?.kind === 'DEPARTMENT' && parentId === null) ||
    (selected?.kind === 'ORGANIZATION' ? organizationCandidates : departmentCandidates).some(entry => entry.id === parentId);
  const locked = busy || unknown;
  const canSave = !!selected && supported && !locked && !loading && !departmentsLoading && !directoryError && !conflict && organizationValid && departmentValid && parentValid;

  function closeEditor() {
    setSelected(undefined); setDirty(false); setConflict(undefined); setUnknown(false); setError(undefined); attempt.current = undefined;
    mutate.current = createAdminMutation({ replayAfterReauthentication: false });
  }
  function refreshCurrentKind() {
    if (!current()) return;
    closeEditor(); setOffset(0); setRevision(value => value + 1);
  }
  function edit(item: Item) {
    if (pending.current || unknown || !current()) return;
    requestLeave(() => {
      closeEditor(); setSelected(item); setTargetOrganizationId(undefined); setTargetDepartmentId(undefined); setParentId(null); setSuccess(undefined);
    });
  }
  async function submit(retry = false) {
    if (pending.current || !current() || (!retry && !canSave) || (retry && (!unknown || !attempt.current))) return;
    if (!retry && selected) {
      const body: Body = { expectedVersion: selected.version };
      if (needsOrganization) body.targetOrganizationId = targetOrganizationId;
      if (needsDepartment) body.targetDepartmentId = targetDepartmentId;
      if (needsParent) body.parentId = parentId;
      attempt.current = { path: `/api/v1/admin/reconfiguration/${selected.kind}/${encodeURIComponent(selected.id)}`, body: Object.freeze(body), item: selected };
    }
    const frozen = attempt.current;
    if (!frozen) return;
    pending.current = true; setBusy(true); setError(undefined);
    let received = false;
    let changed = false;
    try {
      const result = await mutate.current<Result>(frozen.path, 'POST', frozen.body, lifetime.current?.signal);
      received = true;
      if (!current()) return;
      if (result.id !== frozen.item.id || result.kind !== frozen.item.kind || result.originalOrganizationId !== frozen.item.originalOrganizationId || result.configurationRequired !== false ||
        ((result.kind === 'POSITION' || result.kind === 'USER') && result.status !== 'DISABLED')) throw new Error('Unexpected reconfiguration receipt');
      closeEditor(); setSuccess(result); setRevision(value => value + 1); changed = true;
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) { fail(cause); return; }
      // A 2xx receipt already released the helper's key: reconcile by GET, never replay with a fresh key.
      if (received || (cause instanceof ApiError && cause.status === 409)) { setUnknown(false); setConflict(received ? 'receipt' : 'version'); }
      else {
        const unresolved = retry || !(cause instanceof ApiError) || !cause.status || cause.status >= 500 || cause.status === 408;
        setUnknown(unresolved);
        if (!unresolved) attempt.current = undefined;
      }
      fail(cause);
    } finally { pending.current = false; if (current()) setBusy(false); }
    if (changed && current()) callbacks.current.onChanged?.();
  }

  if (denied) return <Alert type="error" showIcon title={t('管理权限或会话已失效，已清除待配置内容')} />;
  return <section className="administrative-reconfiguration" aria-label={t('待配置管理')}>
    <Alert type="info" showIcon title={t('删除不可撤销；此处仅补充存续对象的当前配置，不恢复已删除对象。')} />
    <Space wrap className="administrative-reconfiguration-toolbar">
      <Typography.Text strong>{t('待配置管理')}</Typography.Text>
      <Select aria-label={t('对象类型')} value={kind} disabled={locked} options={Object.entries(names).map(([value, label]) => ({ value, label: t(label) }))}
        onChange={value => requestLeave(() => { closeEditor(); setKind(value); setOffset(0); setSuccess(undefined); })} />
      <Button disabled={locked || loading} onClick={() => requestLeave(refreshCurrentKind)}>{t('刷新待配置')}</Button>
    </Space>
    <GovernanceFeedback error={error} />
    {!!error && !selected && !loading && <Button onClick={() => setRevision(value => value + 1)}>{t('重试读取')}</Button>}
    {success && <Alert type="success" showIcon title={t('补配成功，仅更新当前配置；历史归属保持不变。')} description={<Space wrap>
      <span>{t('状态')}：{t(success.status === 'DISABLED' ? '保持停用' : '启用')}</span>
      {success.replacementId && <span>{t('替代对象')}：<code>{success.replacementId}</code></span>}
    </Space>} />}
    {loading ? <div role="status" aria-label={t('读取待配置')}><Spin /></div> : page && <>
      {!page.items.length ? <Empty description={t('暂无待配置对象')} /> : <Table<Item> className="administrative-reconfiguration-table" size="small" rowKey={item => `${item.kind}:${item.id}`} dataSource={page.items} pagination={false} scroll={{ x: 660 }} columns={[
        { key: 'label', title: t('待配置对象'), width: 220, render: (_, item) => <><Typography.Text strong>{item.label}</Typography.Text> <Tag>{t(names[item.kind])}</Tag></> },
        { key: 'scope', title: t('原归属（历史范围）'), width: 260, render: (_, item) => organizations.find(entry => entry.id === item.originalOrganizationId)?.name ?? item.originalOrganizationId },
        { key: 'actions', title: t('操作'), width: 180, render: (_, item) => <fieldset className="administrative-reconfiguration-actions" disabled={locked}><Space wrap>
          <Button disabled={locked} aria-label={`${t('配置')} · ${item.label}`} onClick={() => edit(item)}>{t('配置')}</Button>
          {renderAdditionalActions?.(item, refreshCurrentKind)}
        </Space></fieldset> },
      ]} />}
      <Pagination size="small" current={Math.floor(offset / pageSize) + 1} pageSize={pageSize} total={page.total} showSizeChanger={false} disabled={locked} onChange={value => requestLeave(() => { closeEditor(); setOffset((value - 1) * pageSize); })} />
    </>}
    {selected && <section className="administrative-reconfiguration-editor" aria-label={`${t('配置')} · ${selected.label}`}>
      <Typography.Title level={5}>{t('补配当前配置')} · {selected.label}</Typography.Title>
      <Descriptions size="small" column={1} items={[
        { key: 'scope', label: t('原归属（历史范围）'), children: organizations.find(entry => entry.id === selected.originalOrganizationId)?.name ?? selected.originalOrganizationId },
        { key: 'version', label: t('当前版本'), children: selected.version },
      ]} />
      <p>{t('原归属仅为历史范围，不迁移历史业务。补配不继承旧角色、任职或审批资格，也不自动授予权限。')}</p>
      {(selected.kind === 'POSITION' || selected.kind === 'USER') && <Alert type="warning" showIcon title={t('补配后保持停用，需另行完成任职、授权与启用。')} />}
      {selected.kind === 'USER' && <p>{t('补配后请另在用户或岗位管理中显式配置任职并启用；本次仅补当前主组织，不配置部门或默认授予权限。')}</p>}
      {selected.kind === 'POSITION' && needsOrganization && <p>{t('原组织已删除：创建新 UUID 的替代岗位，不继承旧岗位角色或授权；原岗位和历史归属保留。')}</p>}
      {selected.kind === 'DEPARTMENT' && needsOrganization && <p>{t('原组织已删除：选择替代组织与部门建立当前替代关联，原部门历史不搬迁。')}</p>}
      {!supported && <Alert type="warning" showIcon title={t('配置要求暂不支持，请刷新或联系管理员核对服务端版本。')} />}
      <GovernanceFeedback error={directoryError} />
      {!!directoryError && <Button disabled={locked} onClick={() => setDirectoryRevision(value => value + 1)}>{t('重试部门目录')}</Button>}
      <Form layout="vertical" onFinish={() => void submit()}>
        {needsOrganization && <Form.Item label={t('目标组织')} htmlFor="reconfiguration-target-organization" required>
          <Select id="reconfiguration-target-organization" value={targetOrganizationId} disabled={locked || loading} showSearch optionFilterProp="label" options={organizationCandidates.map(entry => ({ value: entry.id, label: `${entry.name} · ${entry.code}` }))}
            onChange={value => { setTargetOrganizationId(value); setTargetDepartmentId(undefined); setDirty(true); }} />
        </Form.Item>}
        {needsParent && <Form.Item label={t(selected.kind === 'ORGANIZATION' ? '父组织' : '父部门/科室')} htmlFor="reconfiguration-parent" required={selected.kind === 'ORGANIZATION'}>
          <Select id="reconfiguration-parent" value={parentId ?? (selected.kind === 'DEPARTMENT' ? '__root__' : undefined)} disabled={locked || loading || (selected.kind === 'DEPARTMENT' && departmentsLoading)} showSearch optionFilterProp="label"
            options={[...(selected.kind === 'DEPARTMENT' ? [{ value: '__root__', label: t('根部门（无上级）') }] : []), ...(selected.kind === 'ORGANIZATION' ? organizationCandidates : departmentCandidates).map(entry => ({ value: entry.id, label: `${entry.name} · ${entry.code}` }))]}
            onChange={value => { setParentId(value === '__root__' ? null : value); setDirty(true); }} />
        </Form.Item>}
        {needsDepartment && <Form.Item label={t('目标部门/科室')} htmlFor="reconfiguration-department" required>
          <Select id="reconfiguration-department" value={targetDepartmentId} disabled={locked || loading || departmentsLoading || !departmentOrganizationId || !!directoryError} loading={departmentsLoading} showSearch optionFilterProp="label"
            options={departmentCandidates.map(entry => ({ value: entry.id, label: `${entry.name} · ${entry.code}` }))} onChange={value => { setTargetDepartmentId(value); setDirty(true); }} />
        </Form.Item>}
        {conflict && <Alert type="warning" showIcon title={t(conflict === 'receipt' ? '补配响应无法核对，草稿已保留；请显式刷新并核对当前配置，不自动重放。' : '版本已变化，草稿已保留；请显式刷新版本后重新确认。')} />}
        {unknown && <Alert type="warning" showIcon title={t('补配结果尚未确认，原请求及幂等键已冻结；仅可显式重试，不自动执行新配置。')} />}
        <Space wrap>
          <Button type="primary" htmlType="submit" disabled={!canSave} loading={busy}>{t('确认补配')}</Button>
          {unknown && <Button disabled={busy} onClick={() => void submit(true)}>{t('重试原补配请求')}</Button>}
          {conflict && <Button disabled={locked || loading} onClick={() => { attempt.current = undefined; mutate.current = createAdminMutation({ replayAfterReauthentication: false }); setRevision(value => value + 1); }}>{t('刷新版本并保留草稿')}</Button>}
          <Button disabled={locked} onClick={() => requestLeave(closeEditor)}>{t('关闭编辑')}</Button>
        </Space>
      </Form>
    </section>}
  </section>;
}
