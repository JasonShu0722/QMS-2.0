import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Empty, Space, Spin, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken } from '../../api/client';
import { useCompletedSessionNavigation, useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import type { AdminOrganization } from '../admin/admin';
import { allStructurePages, configurationPath, organizationPath, type Department, type Position, type PositionCategory } from './governance';
import { AuthorizationHistoryFacts, AuthorizationLabel, AuthorizationPager, AuthorizationRoleFacts, canReadAuthorizationSources, useAuthorizationLanguage } from './AuthorizationSources';
import { GovernanceFeedback } from './GovernanceFeedback';
import './legacy-authorization.css';

export type LegacyAuthorizationAdministrationProps = { organization: AdminOrganization; onDenied?: (error: ApiError) => void; onChanged?: () => void };
type Preview = components['schemas']['LegacyAuthorizationPreviewDto'];
type Intent = components['schemas']['LegacyAuthorizationPreviewInputDto'];
type Role = components['schemas']['LegacyAuthorizationRoleDto'];
type History = components['schemas']['LegacyAuthorizationHistoryPageDto'];
type Result = components['schemas']['LegacyAuthorizationResultDto'];
type Attempt = { path: string; body: string; key: string; roleId: string; targetPositionId: string | null; operation: Intent['operation'] };

function WorkflowReferenceFacts({ preview }: { preview: Preview }) {
  const { t } = useAuthorizationLanguage();
  return <section aria-label={t('流程引用与稳定资格')}><Typography.Title level={5}>{t('流程引用与稳定资格')}</Typography.Title>
    {!preview.workflowReferences.length && <span>{t('无')}</span>}
    {preview.workflowReferences.map((reference, index) => <article className="authorization-record" key={index}>
      <strong>{reference.roleCode} · {reference.status}</strong><AuthorizationLabel labels={preview.labels} kind="organizations" id={reference.organizationId} />
      <span>{t('流程版本')}：{reference.versionId}</span><span>{t('节点')}：{reference.nodeId}</span>
    </article>)}
  </section>;
}

export function LegacyAuthorizationAdministration(props: LegacyAuthorizationAdministrationProps) {
  const session = useWorkTabsStore(state => state.sessionScope);
  return <LegacyScope key={JSON.stringify([session, props.organization.id, [...props.organization.permissions].sort()])} {...props} />;
}

function LegacyScope({ organization, onDenied, onChanged }: LegacyAuthorizationAdministrationProps) {
  const { t } = useAuthorizationLanguage(); const formId = useId(); const navigate = useNavigate(); const completeSessionNavigation = useCompletedSessionNavigation(); const requestLeave = useNavigationGuard();
  const [roles, setRoles] = useState<Role[]>(); const [history, setHistory] = useState<History>(); const [historyOffset, setHistoryOffset] = useState(0); const [historyOpen, setHistoryOpen] = useState(false);
  const [positions, setPositions] = useState<Position[]>(); const [departments, setDepartments] = useState<Department[]>(); const [categories, setCategories] = useState<PositionCategory[]>();
  const [loading, setLoading] = useState(false); const [readError, setReadError] = useState<unknown>(); const [historyError, setHistoryError] = useState<unknown>(); const [targetError, setTargetError] = useState<unknown>();
  const [error, setError] = useState<unknown>(); const [denied, setDenied] = useState(false); const [revision, setRevision] = useState(0);
  const [role, setRole] = useState<Role>(); const [facts, setFacts] = useState<Preview>(); const [review, setReview] = useState<Preview>();
  const [intent, setIntent] = useState<Intent>({ operation: 'REMOVE', directUserIds: [], sourcePositionIds: [] });
  const [mode, setMode] = useState<'REMOVE' | 'EXISTING' | 'NEW'>('REMOVE'); const [impactIds, setImpactIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [unknown, setUnknown] = useState(false); const [conflict, setConflict] = useState(false); const [success, setSuccess] = useState(false);
  const alive = useRef(false); const generation = useRef(0); const previewController = useRef<AbortController | undefined>(undefined); const pending = useRef(false); const attempt = useRef<Attempt | undefined>(undefined);
  const roleTriggers = useRef(new Map<string, HTMLElement>()); const listHeading = useRef<HTMLElement>(null); const reviewHeading = useRef<HTMLHeadingElement>(null);
  const [restoreFocus, setRestoreFocus] = useState<{ roleId: string; revision?: number }>(); const readRevision = useRef(-1);
  const callbacks = useRef({ onDenied, onChanged }); callbacks.current = { onDenied, onChanged };
  const scope = useRef(useWorkTabsStore.getState().sessionScope);
  const revoked = useRef(false);
  const authorized = canReadAuthorizationSources(organization); const has = (codes: string[]) => codes.every(code => organization.permissions.includes(code));
  const organizationLabels: Preview['labels'] = { users: [], positions: [], organizations: [{ id: organization.id, code: organization.code, name: organization.name }] };
  const commonWrite = ['organization:structure:manage', 'organization:positions:assign', 'account:roles:assign'];
  const remove = has([...commonWrite, 'account:roles:delete']); const migrate = has([...commonWrite, 'account:roles:update']); const create = migrate && has(['account:roles:create']);
  const canWrite = mode === 'REMOVE' ? remove : mode === 'NEW' ? create : migrate;
  const locked = busy || unknown; const dirty = !!role && (!!intent.directUserIds.length || !!intent.sourcePositionIds.length || mode !== 'REMOVE' || !!review);
  useUnsavedChanges(dirty); useNavigationBusy(locked);
  const current = (epoch: number) => alive.current && !revoked.current && generation.current === epoch && useWorkTabsStore.getState().sessionScope === scope.current;
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; previewController.current?.abort(); }; }, []);
  useLayoutEffect(() => {
    if (!restoreFocus || role || locked || denied || !authorized || (restoreFocus.revision !== undefined && readRevision.current !== restoreFocus.revision)) return;
    const trigger = roleTriggers.current.get(restoreFocus.roleId);
    (trigger?.isConnected && !readError ? trigger : listHeading.current)?.focus();
    setRestoreFocus(undefined);
  }, [restoreFocus, role, locked, denied, authorized, roles, loading, readError]);

  function refusal(cause: unknown) {
    if (!(cause instanceof ApiError) || ![401, 403].includes(cause.status ?? 0)) return false;
    revoked.current = true; generation.current++; previewController.current?.abort(); attempt.current = undefined; setDenied(true); setRoles(undefined); setHistory(undefined); setPositions(undefined); setDepartments(undefined); setCategories(undefined); setFacts(undefined); setReview(undefined); setRole(undefined); setIntent({ operation: 'REMOVE', directUserIds: [], sourcePositionIds: [] }); setImpactIds([]); setUnknown(false); setBusy(false); callbacks.current.onDenied?.(cause);
    if (cause.status === 401) completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
    return true;
  }
  useEffect(() => {
    if (!authorized || denied) return;
    const controller = new AbortController(); let active = true; const session = useWorkTabsStore.getState().sessionScope;
    const valid = () => active && alive.current && !revoked.current && useWorkTabsStore.getState().sessionScope === session;
    setLoading(true); setReadError(undefined); setTargetError(undefined);
    const read = <T,>(task: Promise<T>, setter: (value: T) => void, fail: (value: unknown) => void) => task.then(value => { if (valid()) setter(value); }).catch(cause => { if (valid() && !refusal(cause)) fail(cause); });
    void Promise.all([
      read(apiRequest<Role[]>(organizationPath(organization.id, '/legacy-authorizations'), { signal: controller.signal }), setRoles, setReadError),
      read(Promise.all([allStructurePages<Position>(organizationPath(organization.id, '/positions'), controller.signal), allStructurePages<Department>(organizationPath(organization.id, '/departments'), controller.signal), organization.permissions.includes('configuration:read') ? apiRequest<PositionCategory[]>(configurationPath(organization.id, 'position-categories'), { signal: controller.signal }) : Promise.resolve([])]), ([p, d, c]) => { setPositions(p.filter(item => item.organizationId === organization.id)); setDepartments(d.filter(item => item.organizationId === organization.id)); setCategories(c); }, setTargetError),
    ]).finally(() => { if (valid()) { readRevision.current = revision; setLoading(false); } });
    return () => { active = false; controller.abort(); };
  }, [authorized, denied, organization.id, revision]);
  useEffect(() => {
    if (!authorized || denied || !historyOpen) return;
    const controller = new AbortController(); let active = true; const session = useWorkTabsStore.getState().sessionScope;
    setHistoryError(undefined); setHistory(undefined);
    void apiRequest<History>(organizationPath(organization.id, `/legacy-authorizations/history?pageSize=20&offset=${historyOffset}`), { signal: controller.signal }).then(value => { if (active && !revoked.current && useWorkTabsStore.getState().sessionScope === session) setHistory(value); }).catch(cause => { if (active && !revoked.current && useWorkTabsStore.getState().sessionScope === session && !refusal(cause)) setHistoryError(cause); });
    return () => { active = false; controller.abort(); };
  }, [authorized, denied, organization.id, historyOpen, historyOffset, revision]);

  function edit(next: Intent) {
    if (pending.current || unknown) return;
    generation.current++; previewController.current?.abort(); setIntent(next); setReview(undefined); setImpactIds([]); setConflict(false); setError(undefined); attempt.current = undefined;
  }
  async function preview(nextRole: Role, input: Intent, discovery = false) {
    if (pending.current || unknown || !authorized || denied) return;
    const epoch = ++generation.current; previewController.current?.abort(); const controller = new AbortController(); previewController.current = controller;
    pending.current = true; setBusy(true); setError(undefined); setReview(undefined); setImpactIds([]);
    if (discovery) { setRole(nextRole); setFacts(undefined); setIntent(input); setMode('REMOVE'); setSuccess(false); }
    try {
      const token = await csrfToken(controller.signal);
      const value = await apiRequest<Preview>(organizationPath(organization.id, `/legacy-authorizations/${encodeURIComponent(nextRole.id)}/preview`), { method: 'POST', signal: controller.signal, headers: { 'x-csrf-token': token }, body: JSON.stringify(input) }, { replayAfterReauthentication: false });
      if (!current(epoch)) return;
      if (value.role.id !== nextRole.id || !value.authorizationBaseline || !Array.isArray(value.impactUserIds)) throw new ApiError({ code: 'CLIENT_INVALID_RESPONSE', message: 'Invalid preview' });
      setFacts(value); setConflict(false);
      if (!discovery) { setReview(value); queueMicrotask(() => reviewHeading.current?.focus()); }
    } catch (cause) { if (current(epoch) && !refusal(cause)) { setError(cause); if (cause instanceof ApiError && cause.status === 409) setConflict(true); } }
    finally { pending.current = false; if (current(epoch)) setBusy(false); }
  }
  function changeMode(value: 'REMOVE' | 'EXISTING' | 'NEW') {
    setMode(value); edit({ operation: value === 'REMOVE' ? 'REMOVE' : 'MIGRATE', directUserIds: intent.directUserIds, sourcePositionIds: intent.sourcePositionIds,
      ...(value === 'NEW' ? { newPosition: { code: '', name: '', departmentId: null, categoryId: null }, preserveRoleCode: false } : value === 'EXISTING' ? { preserveRoleCode: false } : {}) });
  }
  function close() {
    if (pending.current || unknown) return;
    requestLeave(() => { generation.current++; previewController.current?.abort(); if (role) setRestoreFocus({ roleId: role.id }); setRole(undefined); setFacts(undefined); setReview(undefined); setIntent({ operation: 'REMOVE', directUserIds: [], sourcePositionIds: [] }); setError(undefined); setConflict(false); setImpactIds([]); });
  }
  async function commit(retry = false) {
    if (pending.current || denied || !authorized || !canWrite || (!retry && (unknown || !review || !role || JSON.stringify([...impactIds].sort()) !== JSON.stringify([...review.impactUserIds].sort())))) return;
    if (!retry) {
      const body: components['schemas']['LegacyAuthorizationCommitDto'] = { ...intent, authorizationBaseline: review!.authorizationBaseline, confirmedImpactUserIds: [...impactIds] };
      attempt.current = { path: organizationPath(organization.id, `/legacy-authorizations/${encodeURIComponent(role!.id)}/commit`), body: JSON.stringify(body), key: crypto.randomUUID(), roleId: role!.id, targetPositionId: review!.target?.positionId ?? null, operation: intent.operation };
    }
    const command = attempt.current; if (!command) return;
    const epoch = generation.current; pending.current = true; setBusy(true); setError(undefined);
    try {
      const token = await csrfToken(); if (!current(epoch)) return;
      const result = await apiRequest<Result>(command.path, { method: 'POST', headers: { 'x-csrf-token': token, 'Idempotency-Key': command.key }, body: command.body }, { replayAfterReauthentication: false });
      if (!current(epoch)) return;
      if (!result || result.roleId !== command.roleId || result.targetPositionId !== command.targetPositionId || typeof result.archived !== 'boolean' || typeof result.deleted !== 'boolean' || typeof result.selfSessionRevoked !== 'boolean' || (result.archived && result.deleted) || (result.deleted && command.operation !== 'REMOVE')) throw new ApiError({ code: 'CLIENT_INVALID_RESPONSE', message: 'Invalid result' });
      attempt.current = undefined; setUnknown(false); setFacts(undefined); setReview(undefined); setRole(undefined); setIntent({ operation: 'REMOVE', directUserIds: [], sourcePositionIds: [] }); setImpactIds([]); setSuccess(true);
      if (result.selfSessionRevoked) { revoked.current = true; setRoles(undefined); setHistory(undefined); setPositions(undefined); setDepartments(undefined); setCategories(undefined); completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); }); return; }
      setRestoreFocus({ roleId: command.roleId, revision: revision + 1 }); setRevision(value => value + 1); callbacks.current.onChanged?.();
    } catch (cause) {
      if (!current(epoch) || refusal(cause)) return;
      setError(cause);
      if (cause instanceof ApiError && cause.status === 409) { setConflict(true); setReview(undefined); setUnknown(false); setImpactIds([]); attempt.current = undefined; }
      else if (cause instanceof ApiError && cause.status && cause.status < 500) { setReview(undefined); setUnknown(false); attempt.current = undefined; }
      else setUnknown(true);
    } finally { pending.current = false; if (current(epoch)) setBusy(false); }
  }
  const validIntent = mode === 'REMOVE' || (mode === 'EXISTING' ? !!intent.targetPositionId && !!positions?.some(p => p.id === intent.targetPositionId && p.status === 'ACTIVE') : !!intent.newPosition?.code.trim() && !!intent.newPosition.name.trim() && (intent.newPosition.departmentId === null || !!departments?.some(d => d.id === intent.newPosition?.departmentId && d.status === 'ACTIVE')));
  const toggle = (field: 'directUserIds' | 'sourcePositionIds', id: string, checked: boolean) => edit({ ...intent, [field]: checked ? [...intent[field], id] : intent[field].filter(value => value !== id) });
  if (!authorized || denied) return <Alert role="alert" type="warning" title={t('无兼容授权读取权限')} />;
  return <section className="legacy-authorization" aria-label={t('兼容授权迁移/清理')}><Typography.Title level={4} ref={listHeading} tabIndex={-1}>{t('兼容授权迁移/清理')}</Typography.Title>
    <Alert type="info" showIcon title={t('只处置明确选择的来源；权限与稳定角色资格分别核对，不自动转换。')} />
    <Space wrap><Button disabled={locked || dirty} onClick={() => setRevision(value => value + 1)}>{t('刷新兼容来源')}</Button><Button disabled={locked} onClick={() => setHistoryOpen(value => !value)}>{t(historyOpen ? '收起已解除历史' : '查看已解除历史')}</Button></Space>
    <GovernanceFeedback error={readError} retry={() => setRevision(value => value + 1)} />{loading && <Spin />}{success && <Alert type="success" title={t('兼容授权处置完成，历史事实已保留。')} />}
    {!readError && roles && !role && <>{!roles.length && <Empty description={t('暂无兼容授权')} />}{roles.map(item => <article className="authorization-record" key={item.id}><AuthorizationRoleFacts role={item} labels={organizationLabels} /><Button ref={element => { if (element) roleTriggers.current.set(item.id, element); else roleTriggers.current.delete(item.id); }} aria-label={`${item.name} · ${t('查看兼容来源')}`} disabled={locked} onClick={() => void preview(item, { operation: 'REMOVE', directUserIds: [], sourcePositionIds: [] }, true)}>{t('查看兼容来源')}</Button></article>)}</>}
    {historyOpen && <section aria-label={t('解除历史')}><Typography.Title level={5}>{t('历史已解除')}</Typography.Title><GovernanceFeedback error={historyError} retry={() => setRevision(value => value + 1)} />{!history && !historyError && <Spin />}{history && <><AuthorizationHistoryFacts page={history} /><AuthorizationPager {...history} label="解除历史" loading={false} onPage={setHistoryOffset} /></>}</section>}
    {role && <section aria-label={`${role.name} · ${t('处置草稿')}`}><AuthorizationRoleFacts role={role} labels={facts?.labels ?? organizationLabels} />
      {conflict && <Alert type="warning" title={t('处置基线已变化，请保留草稿并重新预览。')} />}<GovernanceFeedback error={error} />
      {unknown && <Alert type="warning" showIcon title={t('执行结果未知，已锁定原请求。只能原样重试，不可变更来源或目标。')} />}
      {facts && <><WorkflowReferenceFacts preview={review ?? facts} /><Typography.Title level={5}>{t('精确来源选择')}</Typography.Title>
        {facts.directSources.map(source => <article key={`${source.organizationId}:${source.userId}`} className="authorization-record"><Checkbox disabled={locked || !canWrite || source.organizationId !== organization.id} checked={intent.directUserIds.includes(source.userId)} onChange={event => toggle('directUserIds', source.userId, event.target.checked)}><AuthorizationLabel labels={facts.labels} kind="users" id={source.userId} /></Checkbox><span>{t(source.initialization ? '系统初始化来源' : '兼容直接授权')}</span><AuthorizationLabel labels={facts.labels} kind="organizations" id={source.organizationId} /></article>)}
        {facts.mappedSources.map(source => <article key={`${source.organizationId}:${source.positionId}`} className="authorization-record"><Checkbox disabled={locked || !canWrite || source.organizationId !== organization.id} checked={intent.sourcePositionIds.includes(source.positionId)} onChange={event => toggle('sourcePositionIds', source.positionId, event.target.checked)}><AuthorizationLabel labels={facts.labels} kind="positions" id={source.positionId} /></Checkbox><span>{t(source.isCanonical ? '岗位自有权限' : '兼容岗位映射')}</span><AuthorizationLabel labels={facts.labels} kind="organizations" id={source.organizationId} />{source.assignments.map(assignment => <p key={assignment.id}><AuthorizationLabel labels={facts.labels} kind="users" id={assignment.userId} />{assignment.temporalState} · {assignment.startedAt} → {assignment.endedAt ?? t('未结束')}</p>)}</article>)}
        <div className="authorization-intent"><label htmlFor={`${formId}-operation`}>{t('处置方式')}<select id={`${formId}-operation`} value={mode} disabled={locked} onChange={event => changeMode(event.target.value as typeof mode)}><option value="REMOVE" disabled={!remove}>{t('解除并移除')}</option><option value="EXISTING" disabled={!migrate}>{t('迁入已有岗位')}</option><option value="NEW" disabled={!create}>{t('迁入新岗位')}</option></select></label>
          {mode === 'EXISTING' && <label htmlFor={`${formId}-target`}>{t('目标岗位')}<select id={`${formId}-target`} value={intent.targetPositionId ?? ''} disabled={locked || !!targetError} onChange={event => edit({ ...intent, targetPositionId: event.target.value || undefined })}><option value="">{t('请选择目标岗位')}</option>{positions?.filter(p => p.status === 'ACTIVE').map(p => <option key={p.id} value={p.id}>{p.name} · {p.code} · {p.departmentId === null ? t('组织直属') : departments?.find(d => d.id === p.departmentId)?.name ?? t('部门不可用')}</option>)}</select></label>}
          {mode === 'NEW' && intent.newPosition && <>
            <label htmlFor={`${formId}-code`}>{t('岗位代码')}<input id={`${formId}-code`} value={intent.newPosition.code} disabled={locked} onChange={event => edit({ ...intent, newPosition: { ...intent.newPosition!, code: event.target.value } })} /></label>
            <label htmlFor={`${formId}-name`}>{t('岗位名称')}<input id={`${formId}-name`} value={intent.newPosition.name} disabled={locked} onChange={event => edit({ ...intent, newPosition: { ...intent.newPosition!, name: event.target.value } })} /></label>
            <label htmlFor={`${formId}-department`}>{t('部门')}<select id={`${formId}-department`} disabled={locked || !!targetError} value={intent.newPosition.departmentId ?? '__direct__'} onChange={event => edit({ ...intent, newPosition: { ...intent.newPosition!, departmentId: event.target.value === '__direct__' ? null : event.target.value } })}><option value="__direct__">{t('组织直属')}</option>{departments?.filter(d => d.status === 'ACTIVE').map(d => <option value={d.id} key={d.id}>{d.name} · {d.code}</option>)}</select></label>
            <label htmlFor={`${formId}-category`}>{t('岗位类别')}<select id={`${formId}-category`} disabled={locked || !!targetError} value={intent.newPosition.categoryId ?? ''} onChange={event => edit({ ...intent, newPosition: { ...intent.newPosition!, categoryId: event.target.value || null } })}><option value="">{t('无')}</option>{categories?.filter(c => c.status === 'ACTIVE').map(c => <option key={c.id} value={c.id}>{c.name} · {c.code}</option>)}</select></label>
          </>}
          {mode !== 'REMOVE' && <Checkbox checked={intent.preserveRoleCode === true} disabled={locked} onChange={event => edit({ ...intent, preserveRoleCode: event.target.checked })}>{t('明确保留稳定角色代码资格（可能保留兼容映射）')}</Checkbox>}
        </div><GovernanceFeedback error={targetError} retry={() => setRevision(value => value + 1)} />
        {!canWrite && <Alert type="info" title={t('仅可读取来源，没有本处置所需的完整权限。')} />}
        {canWrite && <Button disabled={locked || !validIntent} onClick={() => void preview(role, intent)}>{t('预览处置')}</Button>}
        {review && <section aria-label={t('处置预览')}><h5 tabIndex={-1} ref={reviewHeading}>{t('处置预览')}</h5><AuthorizationRoleFacts role={review.role} labels={review.labels} />
          <span>{t('保留来源数')}：{review.retainedSourceCount}</span><Alert type="warning" title={t('未选来源保持不变；资格兼容映射仍是保留来源，不代表已全部清理。')} />
          {review.target && <article className="authorization-record"><strong>{t('目标岗位')}：{review.target.name} · {review.target.code}</strong><small>ID: {review.target.positionId}</small><span>{t('处置策略')}：{review.target.strategy}</span><span>{t('稳定角色代码')}：{review.target.roleCode}</span><span>{t('部门')}：{review.target.departmentId === null ? t('组织直属') : departments?.find(d => d.id === review.target?.departmentId)?.name ?? t('部门不可用')}</span><span>{t('权限')}：{review.target.permissionCodes.join(' · ')}</span><span>MFA: {String(review.target.mfaRequired)}</span><strong>{t('目标原岗位自有授权')}</strong>{review.target.originalCanonical ? <AuthorizationRoleFacts role={review.target.originalCanonical} /> : <span>{t('无')}</span>}</article>}
          <Typography.Title level={5}>{t('全部受影响人员与扩散确认')}</Typography.Title>{review.affectedUsers.map(user => <article className="authorization-record" key={`${user.organizationId}:${user.userId}`}><AuthorizationLabel labels={review.labels} kind="users" id={user.userId} /><AuthorizationLabel labels={review.labels} kind="organizations" id={user.organizationId} /><span>{user.status} · {user.accountType} · MFA {t('已绑定')}：{String(user.mfaEnabled)}</span><span>{t('权限前后')}：{user.beforePermissionCodes.join(' · ') || t('无')} → {user.afterPermissionCodes.join(' · ') || t('无')}</span><span>{t('角色代码前后')}：{user.beforeRoleCodes.join(' · ') || t('无')} → {user.afterRoleCodes.join(' · ') || t('无')}</span><span>{t('MFA 要求')}：{String(user.beforeMfaRequired)} → {String(user.afterMfaRequired)}</span><span>{t('平台管理标记')}：{String(user.beforePlatformAdministrator)} → {String(user.afterPlatformAdministrator)}</span>{user.appointments.map(assignment => <p key={assignment.id}><AuthorizationLabel labels={review.labels} kind="positions" id={assignment.positionId} />{assignment.temporalState} · {assignment.startedAt} → {assignment.endedAt ?? t('未结束')}</p>)}</article>)}
          {review.impactUserIds.map(id => <Checkbox key={id} disabled={locked} checked={impactIds.includes(id)} onChange={event => setImpactIds(ids => event.target.checked ? [...ids, id] : ids.filter(value => value !== id))}>{t('确认该人员全部扩散影响')} · <AuthorizationLabel labels={review.labels} kind="users" id={id} /></Checkbox>)}
          <Button danger={mode === 'REMOVE'} disabled={locked || !canWrite || JSON.stringify([...impactIds].sort()) !== JSON.stringify([...review.impactUserIds].sort())} loading={busy} onClick={() => void commit()}>{t('确认执行')}</Button>
        </section>}
      </>}
      {unknown && <Button disabled={busy} onClick={() => void commit(true)}>{t('原样重试确认结果')}</Button>}
      <Button disabled={locked} onClick={close}>{t('取消处置')}</Button>
      {!facts && !busy && <Button onClick={() => void preview(role, { operation: 'REMOVE', directUserIds: [], sourcePositionIds: [] }, true)}>{t('重新读取兼容来源')}</Button>}
    </section>}
  </section>;
}
