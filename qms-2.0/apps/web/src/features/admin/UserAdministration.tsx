import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLanguage } from '../../i18n/Language';
import { QmsLoading } from '../../components/QmsLoading';
import { Alert, Button, Descriptions, Form, Input, Modal, Select, Space, Tabs, Tag, Typography } from 'antd';
import { LedgerTable, useLedgerPageSize } from '../../ui/ledger';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, createAdminMutation, getAdminUser, safeAccountError } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { allows, randomResetCode, scopePath, type AdminOrganization, type AdminUser, type UserRoles } from './admin';
import { UserBatchCreate } from './UserBatchCreate';
import { UserTemporaryPassword } from './UserTemporaryPassword';
import { UserMfaPolicy } from './UserMfaPolicy';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { accountAvatarEpoch } from '../account/account-avatar-state';
import { PositionSelector } from './PositionSelector';
import { UserPositionsEditor } from './UserPositionsEditor';
import { AuthorizationSources, canReadAuthorizationSources } from '../governance/AuthorizationSources';
import { organizationPath, type UserPosition } from '../governance/governance';
import { UserForceDelete } from './UserForceDelete';
import { canPreviewPositions, loadPositionDirectory, previewPositions, type AuthorizationPreview, type PositionDirectory } from './position-authorization';
import './user-administration.css';

type CreateUser = components['schemas']['CreateAdminUserDto'];
type UpdateUser = components['schemas']['UpdateAdminUserDto'];
type UserForm = CreateUser & Pick<AdminUser, 'status'>;
type ResetIssued = components['schemas']['PasswordResetIssuedDto'];
type UserMutation = ReturnType<typeof createAdminMutation>;
type BulkOperation = 'positions' | 'disable' | 'delete' | 'forceDelete';
type BulkOutcome = { message: string; traceId?: string; unknown?: boolean };
type BulkWrite = (signal: AbortSignal) => Promise<unknown>;
type BulkEntry = { user: AdminUser; outcome?: BulkOutcome; retry?: BulkWrite };
type BulkRun = { operation: BulkOperation; entries: BulkEntry[]; started?: boolean; reauthenticated?: 'confirm' | 'retry' };
type DeleteResult = components['schemas']['AdminUserForceDeleteResultDto'];
type DeleteUser = components['schemas']['DeleteInternalAdminUserDto'];
type AppendPositions = components['schemas']['AppendUserPositionsDto'];

const bulkLabels: Record<BulkOperation, readonly [string, string]> = {
  positions: ['批量配置任职', 'Assign positions'], disable: ['批量停用', 'Disable selected accounts'],
  delete: ['批量删除', 'Delete selected accounts'], forceDelete: ['批量强制删除', 'Permanently delete selected accounts'],
};

function preparePositionAppend(organizationId: string, user: AdminUser, additions: string[]): BulkWrite {
  if (user.accountType !== 'INTERNAL') throw new ApiError({ code: 'STRUCTURE_DISABLED', message: '' }, 409);
  const path = organizationPath(organizationId, `/users/${encodeURIComponent(user.id)}/positions`);
  const body: AppendPositions = { positionIds: [...additions] };
  const mutate = createAdminMutation();
  return signal => mutate<UserPosition[]>(path, 'POST', body, signal, result => {
    if (!Array.isArray(result) || result.some(entry => typeof entry?.positionId !== 'string')) throw new Error('Invalid position result');
  });
}

export function UserAdministration({ organization, organizations, targetUserId, onDenied, onOpenPendingUsers }: {
  organization: AdminOrganization; organizations: AdminOrganization[]; targetUserId?: string;
  onDenied?: (error: ApiError) => void; onOpenPendingUsers?: () => void;
}) {
  const [pageSize, setPageSize] = useLedgerPageSize('admin-users', organization.id);
  const [page, setPage] = useState(1);
  const { t, locale } = useLanguage();
  const sessionScope = useWorkTabsStore(state => state.sessionScope);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AdminUser['status']>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [traceId, setTraceId] = useState<string>();
  function setFailure(cause: unknown) { setError(safeAccountError(cause)); setTraceId(cause instanceof ApiError ? cause.traceId : undefined); }
  const errorDescription = traceId ? <span>{t('追踪标识')}: <code>{traceId}</code></span> : undefined;
  const [success, setSuccess] = useState<string>();
  const [lifecycleDenied, setLifecycleDenied] = useState(false);
  const [editing, setEditing] = useState<AdminUser | 'new'>();
  const [managementTab, setManagementTab] = useState('profile');
  const [assignment, setAssignment] = useState<{ user: AdminUser; authorization: UserRoles }>();
  const [sourceUser, setSourceUser] = useState<AdminUser>();
  const [positionUser, setPositionUser] = useState<AdminUser>();
  const [createPositions, setCreatePositions] = useState<string[]>([]);
  const [createPreview, setCreatePreview] = useState<AuthorizationPreview>();
  const [reset, setReset] = useState<{ user: AdminUser; code: string; issued?: ResetIssued }>();
  const [mutationUnknown, setMutationUnknown] = useState(false);
  const [abandonMutation, setAbandonMutation] = useState(false);
  const [temporary, setTemporary] = useState<AdminUser>();
  const [temporaryBusy, setTemporaryBusy] = useState(false);
  const [commandPending, setCommandPending] = useState(false);
  const [mfa, setMfa] = useState<{ user: AdminUser; organizationId: string }>();
  const [batch, setBatch] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [bulk, setBulk] = useState<BulkRun>();
  const [bulkPositions, setBulkPositions] = useState<string[]>([]);
  const [bulkDirectory, setBulkDirectory] = useState<PositionDirectory>();
  const [bulkDirectoryError, setBulkDirectoryError] = useState<string>();
  const bulkScope = useRef<AbortController | undefined>(undefined);
  const batchPending = useRef(false);
  const reportBatchBusy = useCallback((value: boolean) => { batchPending.current = value; setBatchBusy(value); }, []);
  const [form] = Form.useForm<UserForm>();
  const createOrganizationId = Form.useWatch('organizationId', form) ?? organization.id;
  const createAccountType = Form.useWatch('accountType', form) ?? organization.type;
  const createOrganization = organizations.find(entry => entry.id === createOrganizationId);
  const canAuthorizeCreation = !!createOrganization && canPreviewPositions(createOrganization);
  useEffect(() => { setCreatePreview(undefined); }, [canAuthorizeCreation]);
  const [dirty, setDirty] = useState(false);
  const [profileConflict, setProfileConflict] = useState(false);
  const actionLock = useRef(false);
  const sessionEnding = useRef(false);
  const scopeGeneration = useRef(0);
  const bulkUnknown = !!bulk?.entries.some(entry => entry.outcome?.unknown);
  useUnsavedChanges((!!editing && dirty) || mutationUnknown || bulkUnknown || (!!bulk && !bulk.started && bulkPositions.length > 0));
  useNavigationBusy(busy);
  const requestLeave = useNavigationGuard();
  const [target, setTarget] = useState<{ organizationId: string; userId: string; user?: AdminUser; error?: string }>();
  const editor = useRef(editing);
  editor.current = editing;
  const mutate = useRef(createAdminMutation());
  const pendingMutation = useRef<{ action: (mutation: UserMutation) => Promise<void>; message: string; mutation: UserMutation } | undefined>(undefined);
  const alive = useRef(true);
  const scope = useRef(organization.id);
  scope.current = organization.id;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const canRead = allows(organization, 'users:read');
  const canCreate = allows(organization, 'users:create');
  const canUpdate = allows(organization, 'users:update');
  const canStatus = allows(organization, 'users:status');
  const canTransfer = allows(organization, 'users:transfer');
  const canReset = allows(organization, 'users:reset');
  const canDelete = allows(organization, 'users:delete');
  const canReadRoles = canRead && allows(organization, 'roles:read');
  const canReadSources = canReadRoles && canReadAuthorizationSources(organization);
  const sourceScopeKey = JSON.stringify([sessionScope, organization.id, [...organization.permissions].sort()]);
  useEffect(() => { setSourceUser(undefined); }, [sourceScopeKey]);
  const canAssignPositions = canRead && canPreviewPositions(organization);
  const canReadPositions = canRead && organization.permissions.includes('organization:structure:read');
  const canBulkPositions = canAssignPositions && organization.type === 'INTERNAL';
  const canBulkDelete = canRead && canDelete && organization.type === 'INTERNAL';
  const bulkOperation = bulk?.operation;
  useLayoutEffect(() => {
    const controller = new AbortController();
    bulkScope.current = controller;
    setSelectedUserIds([]); setBulk(undefined); setBulkPositions([]);
    return () => controller.abort();
  }, [sourceScopeKey, organization.type]);
  useEffect(() => {
    if (bulkOperation !== 'positions') return;
    const controller = new AbortController();
    setBulkDirectory(undefined); setBulkDirectoryError(undefined);
    void loadPositionDirectory(organization.id, controller.signal).then(directory => {
      if (!controller.signal.aborted) setBulkDirectory(directory);
    }).catch(cause => { if (!controller.signal.aborted) setBulkDirectoryError(safeAccountError(cause)); });
    return () => controller.abort();
  }, [bulkOperation, sourceScopeKey, organization.id]);
  useEffect(() => { setPage(1); scopeGeneration.current += 1; setLifecycleDenied(false); setProfileConflict(false); setEditing(undefined); setAssignment(undefined); setPositionUser(undefined); setCreatePositions([]); setCreatePreview(undefined); setReset(undefined); setMutationUnknown(false); setAbandonMutation(false); pendingMutation.current = undefined; setTemporary(undefined); setTemporaryBusy(false); setCommandPending(false); setMfa(undefined); setBatch(false); setSuccess(undefined); setBusy(false); setDirty(false); form.resetFields(); mutate.current = createAdminMutation(); }, [organization.id, canRead, canReadRoles, canAssignPositions, canCreate, sessionScope, sourceScopeKey, form]);
  useLayoutEffect(() => {
    let retired = false;
    return useWorkTabsStore.subscribe(state => {
      if (retired || state.sessionScope === sessionScope) return;
      retired = true; scopeGeneration.current += 1;
      bulkScope.current?.abort(); setSelectedUserIds([]); setBulk(undefined); setBulkPositions([]);
      setLifecycleDenied(true); setUsers([]); setTarget(undefined); setEditing(undefined); setAssignment(undefined); setSourceUser(undefined); setPositionUser(undefined); setReset(undefined); setMutationUnknown(false); setAbandonMutation(false); pendingMutation.current = undefined; setTemporary(undefined); setMfa(undefined); setBatch(false); setDirty(false); setBusy(false); setTemporaryBusy(false); setCommandPending(false); setSuccess(undefined); setError(undefined); form.resetFields(); mutate.current = createAdminMutation();
    });
  }, [sessionScope, form]);

  useEffect(() => {
    let current = true;
    setTarget(undefined);
    if (targetUserId === undefined || !canRead || sessionEnding.current) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUserId)) {
      setTarget({ organizationId: organization.id, userId: targetUserId, error: '目标账号标识无效' });
      return;
    }
    function load() {
      if (!current) return;
      setEditing(undefined); setDirty(false); form.resetFields();
      setTarget({ organizationId: organization.id, userId: targetUserId! });
      void getAdminUser(organization.id, targetUserId!).then((user) => {
        if (current) setTarget(user.id === targetUserId && user.organizationId === organization.id
          ? { organizationId: organization.id, userId: targetUserId!, user }
          : { organizationId: organization.id, userId: targetUserId!, error: '目标账号不存在或不在当前组织' });
      }).catch((cause) => {
        if (current) setTarget({ organizationId: organization.id, userId: targetUserId!, error: cause instanceof ApiError && cause.status === 403 ? '无权查看目标账号' : cause instanceof ApiError && cause.status === 404 ? '目标账号不存在或不在当前组织' : safeAccountError(cause) });
      });
    }
    if (editor.current) requestLeave(load); else load();
    return () => { current = false; };
  }, [organization.id, targetUserId, canRead, revision, requestLeave, form, sessionScope]);

  useEffect(() => {
    let current = true;
    if (!canRead || sessionEnding.current) { setUsers([]); setLoading(false); return; }
    setLoading(true); setError(undefined); setUsers([]);
    const query = new URLSearchParams({ organizationId: organization.id, search, ...(status ? { status } : {}) });
    void apiRequest<AdminUser[]>(`/api/v1/admin/users?${query}`).then((result) => { if (current) setUsers(result); }).catch((cause) => { if (current) setFailure(cause); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [organization.id, search, status, revision, canRead, sessionScope]);

  async function perform(action: (mutation: UserMutation) => Promise<void>, message: string, retry = false) {
    const organizationId = organization.id;
    const operationGeneration = scopeGeneration.current;
    const operationEpoch = accountAvatarEpoch();
    if (actionLock.current || (mutationUnknown && !retry) || (retry && !pendingMutation.current)) return;
    const command = retry ? pendingMutation.current! : { action, message, mutation: mutate.current };
    pendingMutation.current = command;
    actionLock.current = true;
    setBusy(true); setError(undefined); setSuccess(undefined);
    try { await command.action(command.mutation); if (alive.current && scope.current === organizationId && operationGeneration === scopeGeneration.current && operationEpoch === accountAvatarEpoch()) { pendingMutation.current = undefined; setMutationUnknown(false); setSuccess(command.message); setRevision((value) => value + 1); } }
    catch (cause) { if (alive.current && scope.current === organizationId && operationGeneration === scopeGeneration.current && operationEpoch === accountAvatarEpoch()) { setFailure(cause); if (mutationUnknown || !(cause instanceof ApiError) || !cause.status || cause.status >= 500 || cause.status === 408 || cause.status === 425) setMutationUnknown(true); else { pendingMutation.current = undefined; if (editor.current === 'new' && cause instanceof ApiError && cause.status === 409) setCreatePreview(undefined); if (editor.current && editor.current !== 'new' && cause instanceof ApiError && cause.code === 'CONCURRENCY_CONFLICT') setProfileConflict(true); } } }
    finally { actionLock.current = false; if (alive.current && scope.current === organizationId && operationGeneration === scopeGeneration.current && operationEpoch === accountAvatarEpoch()) setBusy(false); }
  }

  function edit(user: AdminUser | 'new') {
    if (busy || actionLock.current || mutationUnknown) return;
    mutate.current = createAdminMutation(); setError(undefined); setProfileConflict(false); setEditing(user); setManagementTab('profile'); setDirty(false); setCreatePositions([]); setCreatePreview(undefined); form.resetFields();
    form.setFieldsValue(user === 'new' ? { organizationId: organization.id, accountType: organization.type } : { ...user, fullName: user.fullName ?? '', phone: user.phone ?? '', email: user.email ?? '' });
  }

  async function save(values: UserForm) {
    if (busy || actionLock.current || mutationUnknown || profileConflict || (editing === 'new' && (!canCreate || (values.accountType === 'INTERNAL' && (!canAuthorizeCreation || !createPositions.length || !createPreview))))) return;
    const organizationId = organization.id;
    const operationGeneration = scopeGeneration.current;
    const operationEpoch = accountAvatarEpoch();
    let command: { path: string; method: 'POST' | 'PATCH'; body: CreateUser | UpdateUser } | undefined;
      if (editing === 'new') {
        const body: CreateUser = { username: values.username, fullName: values.fullName?.trim() || null, phone: values.phone?.trim() || null, email: values.email || null, initialPassword: values.initialPassword, accountType: values.accountType, organizationId: values.organizationId, ...(values.accountType === 'INTERNAL' ? { positionIds: [...createPositions], authorizationBaseline: createPreview!.authorizationBaseline } : {}) };
        command = { path: '/api/v1/admin/users', method: 'POST', body };
      } else if (editing) {
        const body: UpdateUser = {};
        if (canUpdate && managementTab === 'profile') {
          for (const field of ['fullName', 'phone', 'email'] as const) {
            const value = values[field]?.trim() || null;
            if (value !== (editing[field] ?? null)) body[field] = value;
          }
          if ('fullName' in body || 'phone' in body || 'email' in body) body.expectedProfileVersion = editing.profileVersion;
        }
        if (managementTab === 'positions' && canTransfer && values.accountType !== editing.accountType) body.accountType = values.accountType;
        if (managementTab === 'positions' && canTransfer && values.organizationId !== editing.organizationId) body.organizationId = values.organizationId;
        if (Object.keys(body).length) command = { path: scopePath(`users/${editing.id}`, organization.id), method: 'PATCH', body };
      }
    await perform(async mutation => {
      if (command) await mutation<AdminUser>(command.path, command.method, command.body);
      if (alive.current && scope.current === organizationId && operationGeneration === scopeGeneration.current && operationEpoch === accountAvatarEpoch()) { form.resetFields(); setDirty(false); setEditing(undefined); }
    }, '用户已保存');
  }

  async function openRoles(user: AdminUser) {
    if (!canReadRoles || busy || actionLock.current) return;
    if (user.accountType === 'INTERNAL' && canReadSources) {
      setSourceUser(user);
      return;
    }
    actionLock.current = true;
    const organizationId = organization.id;
    const operationGeneration = scopeGeneration.current;
    const operationEpoch = accountAvatarEpoch();
    setError(undefined); setBusy(true);
    try {
      const assigned = await apiRequest<UserRoles>(scopePath(`users/${user.id}/roles`, organization.id));
      if (alive.current && scope.current === organizationId && operationGeneration === scopeGeneration.current && operationEpoch === accountAvatarEpoch()) setAssignment({ user, authorization: assigned });
    } catch (cause) { if (alive.current && scope.current === organizationId && operationGeneration === scopeGeneration.current && operationEpoch === accountAvatarEpoch()) { setFailure(cause); if (editor.current && editor.current !== 'new' && cause instanceof ApiError && cause.code === 'CONCURRENCY_CONFLICT') setProfileConflict(true); } }
    finally { actionLock.current = false; if (alive.current && scope.current === organizationId && operationGeneration === scopeGeneration.current && operationEpoch === accountAvatarEpoch()) setBusy(false); }
  }

  async function reloadProfileBaseline() {
    if (!editing || editing === 'new' || busy || actionLock.current || mutationUnknown) return;
    const draft = form.getFieldsValue();
    const previous = editing;
    const userId = editing.id;
    const organizationId = organization.id;
    const operationEpoch = accountAvatarEpoch();
    const generation = scopeGeneration.current;
    setBusy(true); actionLock.current = true;
    try {
      const next = await getAdminUser(organizationId, userId);
      if (!alive.current || scope.current !== organizationId || operationEpoch !== accountAvatarEpoch() || generation !== scopeGeneration.current || next.id !== userId || next.organizationId !== organizationId || !editor.current || editor.current === 'new' || editor.current.id !== userId) return;
      const merged = { ...draft };
      for (const field of ['fullName', 'phone', 'email'] as const) {
        if ((draft[field]?.trim() || null) === (previous[field]?.trim() || null)) merged[field] = next[field] ?? '';
      }
      form.setFieldsValue(merged);
      setDirty(managementTab === 'profile' ? (['fullName', 'phone', 'email'] as const).some(field => (merged[field]?.trim() || null) !== (next[field]?.trim() || null)) : managementTab === 'positions' && canTransfer && (merged.accountType !== previous.accountType || merged.organizationId !== previous.organizationId));
      setEditing(previous => previous && previous !== 'new' ? { ...previous, fullName: next.fullName, phone: next.phone, email: next.email, profileVersion: next.profileVersion } : previous);
      setProfileConflict(false); setError(undefined); mutate.current = createAdminMutation();
    } catch (cause) { if (alive.current && generation === scopeGeneration.current) setFailure(cause); }
    finally { actionLock.current = false; if (alive.current && generation === scopeGeneration.current) setBusy(false); }
  }

  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const selectedUsers = users.filter(user => user.organizationId === organization.id && selectedUserIds.includes(user.id));
  const canSelectUsers = canRead && (canStatus || canBulkPositions || canBulkDelete);
  const bulkBlocked = busy || batchBusy || commandPending || mutationUnknown || !!editing || batch;
  const selectedCount = (count: number) => text(`已选择 ${count} 个账号`, `${count} accounts selected`);

  function openBulk(operation: BulkOperation) {
    if (bulkBlocked || loading || actionLock.current || bulk || !selectedUsers.length) return;
    setBulkPositions([]); setBulkDirectory(undefined); setBulkDirectoryError(undefined);
    setBulk({ operation, entries: selectedUsers.map(user => ({ user })) });
  }

  async function runBulk(retryOnly = false) {
    const signal = bulkScope.current?.signal;
    if (!bulk || !signal || signal.aborted || actionLock.current || bulkBlocked) return;
    const { operation } = bulk;
    const deleting = operation === 'delete' || operation === 'forceDelete';
    if ((deleting && !canBulkDelete) || (operation === 'disable' && !canStatus)
      || (operation === 'positions' && (!canBulkPositions || !bulkPositions.length))) return;
    if (bulk.started && !bulk.reauthenticated && !retryOnly) return;

    actionLock.current = true;
    setBusy(true);
    setSelectedUserIds([]);
    const entries = [...bulk.entries];
    const publish = (reauthenticated?: BulkRun['reauthenticated']) => setBulk({ operation, started: true, entries: [...entries], reauthenticated });
    publish();
    let refresh = false;
    try {
      for (const [index, entry] of entries.entries()) {
        if (signal.aborted || scope.current !== organization.id) return;
        if (retryOnly ? !entry.retry : !!entry.outcome) continue;
        const { user } = entry;
        let write = entry.retry;
        const path = scopePath(`users/${encodeURIComponent(user.id)}`, organization.id);
        try {
          if (!write && operation === 'positions') write = preparePositionAppend(organization.id, user, bulkPositions);
          if (!write && operation === 'disable' && user.status !== 'DISABLED') {
            const mutation = createAdminMutation();
            write = requestSignal => mutation<AdminUser>(path, 'PATCH', { status: 'DISABLED' }, requestSignal, result => {
              if (result?.id !== user.id || result.organizationId !== organization.id || result.status !== 'DISABLED') throw new Error('Invalid status result');
            });
          }
          if (!write && deleting) {
            const expectedSecurityVersion = user.securityVersion;
            if (!Number.isInteger(expectedSecurityVersion) || expectedSecurityVersion < 1 || expectedSecurityVersion > 2147483647) throw new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409);
            const body: DeleteUser = { expectedSecurityVersion, mode: operation === 'forceDelete' ? 'FORCE' : 'STANDARD' };
            const mutation = createAdminMutation({ replayAfterReauthentication: false });
            write = requestSignal => mutation<DeleteResult>(path, 'DELETE', body, requestSignal, result => {
              if (result?.userId !== user.id || result.deleted !== true || !Array.isArray(result.effects)) throw new Error('Invalid deletion result');
            });
          }
          signal.throwIfAborted();
          if (write) { refresh = true; await write(signal); }
          if (signal.aborted) return;
          const message = !write ? text('无需变更', 'No change needed')
            : operation === 'positions' ? text('任职配置已处理', 'Position assignments processed')
            : operation === 'disable' ? text('已停用', 'Disabled')
            : operation === 'delete' ? text('已删除', 'Deleted') : text('已永久删除', 'Permanently deleted');
          entries[index] = { user, outcome: { message } };
        } catch (cause) {
          if (signal.aborted) return;
          const error = cause instanceof ApiError ? cause : undefined;
          if (error?.code === 'CLIENT_REAUTHENTICATION_COMPLETED') {
            entries[index] = { ...entry, retry: write };
            publish(retryOnly ? 'retry' : 'confirm');
            return;
          }
          const interrupted = error?.status === 401 || error?.code === 'AUTH_REAUTHENTICATION_REQUIRED' || error?.code === 'CLIENT_REAUTHENTICATION_CANCELLED';
          const deniedOrConflict = error?.status === 401 || error?.status === 409 || (error?.status === 403 && error.code !== 'AUTH_REAUTHENTICATION_REQUIRED');
          const unknown = !!write && !deniedOrConflict && (entry.outcome?.unknown || (!interrupted && (!error?.status || error.status >= 500 || error.status === 408 || error.status === 425)));
          const message = unknown ? text('请求结果尚未确认', 'Request result is unconfirmed')
            : operation === 'delete' && error?.code === 'ADMIN_USER_ACTIVE_REFERENCES'
              ? text('账号存在当前引用，无法删除', 'The account has active references and cannot be deleted')
              : t(safeAccountError(cause));
          entries[index] = { user, outcome: { message, traceId: error?.traceId, unknown }, retry: unknown ? write : undefined };
          if (interrupted) {
            for (const [remainingIndex, remaining] of entries.entries()) {
              if (!remaining.outcome) entries[remainingIndex] = { ...remaining, outcome: { message: text('未处理', 'Not processed') } };
            }
            publish();
            break;
          }
        }
        publish();
      }
    } finally {
      actionLock.current = false;
      if (!signal.aborted && scope.current === organization.id) {
        setBusy(false);
        if (refresh) setRevision(value => value + 1);
      }
    }
  }

  const clearBulk = () => { if (!actionLock.current) { setBulk(undefined); setBulkPositions([]); } };
  const bulkLabel = bulk ? text(...bulkLabels[bulk.operation]) : undefined;
  const bulkCloseLabel = bulkUnknown ? text('放弃确认并关闭', 'Discard unconfirmed requests and close') : text('关闭', 'Close');
  const bulkConfirm = bulk?.operation === 'positions' ? text('确认追加任职', 'Add positions')
    : bulk?.operation === 'disable' ? text('确认停用', 'Confirm disable')
    : bulk?.operation === 'delete' ? (bulk.reauthenticated ? text('重新确认删除', 'Reconfirm deletion') : text('确认删除', 'Confirm deletion'))
    : bulk?.reauthenticated ? text('重新确认永久删除', 'Reconfirm permanent deletion') : text('确认永久删除', 'Confirm permanent deletion');
  const bulkFinished = !!bulk?.started && !bulk.reauthenticated;
  const availablePositions = bulkDirectory?.positions.filter(position => position.status === 'ACTIVE' && (position.departmentId === null || bulkDirectory.departments.some(department => department.id === position.departmentId && department.status === 'ACTIVE')));
  const mutationRecovery = mutationUnknown && <><Alert type="warning" showIcon title={t('原请求结果尚未确认，请重试原请求或明确放弃。')} /><Space wrap><Button loading={busy} disabled={busy} onClick={() => { const command = pendingMutation.current; if (command) void perform(command.action, command.message, true); }}>{t('重试确认结果')}</Button><Button disabled={busy} onClick={() => setAbandonMutation(true)}>{t('放弃修改')}</Button></Space></>;
  const organizationOptions = organizations.filter((entry) => allows(entry, editing === 'new' ? 'users:create' : 'users:transfer')).map((entry) => ({ value: entry.id, label: entry.name }));
  if (lifecycleDenied) return <Alert type="error" showIcon title={t('管理权限或会话已失效，已清除用户内容')} description={<>{error && t(error)}{errorDescription}</>} />;
  const actionBar = <div className="admin-toolbar"><Space wrap>
    {canRead && <><Input.Search aria-label={t('搜索用户')} placeholder={t('用户名或邮箱')} allowClear disabled={!!bulk} onSearch={value => { if (value !== search) setSelectedUserIds([]); setSearch(value); }} />
      <Select aria-label={t('用户状态')} placeholder={t('全部状态')} allowClear disabled={!!bulk} value={status} onChange={value => { setSelectedUserIds([]); setStatus(value); }} options={[{ value: 'ACTIVE', label: t('启用') }, { value: 'DISABLED', label: t('停用') }]} /></>}
    {canCreate && <Button type="primary" disabled={busy || commandPending || mutationUnknown || !!bulk} onClick={() => edit('new')}>{t('创建用户')}</Button>}
    {canCreate && organization.type === 'INTERNAL' && <Button disabled={busy || commandPending || mutationUnknown || !!bulk} onClick={() => setBatch(true)}>{t('批量创建账号')}</Button>}
    {onOpenPendingUsers && <Button disabled={busy || batchBusy || commandPending || mutationUnknown || !!bulk} onClick={() => requestLeave(onOpenPendingUsers)}>{text('待配置用户', 'Pending users')}</Button>}
    {canSelectUsers && !!selectedUsers.length && <Space wrap role="group" aria-label={text('批量操作', 'Bulk actions')}>
      <Typography.Text role="status">{selectedCount(selectedUsers.length)}</Typography.Text>
      <Button disabled={bulkBlocked || !!bulk} onClick={() => setSelectedUserIds([])}>{text('取消选择', 'Clear selection')}</Button>
      {canBulkPositions && <Button disabled={bulkBlocked || !!bulk} onClick={() => openBulk('positions')}>{text(...bulkLabels.positions)}</Button>}
      {canStatus && <Button disabled={bulkBlocked || !!bulk} onClick={() => openBulk('disable')}>{text(...bulkLabels.disable)}</Button>}
      {canBulkDelete && <>
        <Button disabled={bulkBlocked || !!bulk} onClick={() => openBulk('delete')}>{text(...bulkLabels.delete)}</Button>
        <Button danger disabled={bulkBlocked || !!bulk} onClick={() => openBulk('forceDelete')}>{text(...bulkLabels.forceDelete)}</Button>
      </>}
    </Space>}
  </Space></div>;
  return <>
    {targetUserId !== undefined && (!canRead ? <Alert type="error" title={t('无权查看目标账号')} showIcon /> : target?.organizationId === organization.id && target.userId === targetUserId && target.error ? <Alert type="error" title={t(target.error)} showIcon /> : target?.organizationId === organization.id && target.userId === targetUserId && target.user ? <section aria-label={t('目标账号')}>
      <Typography.Title level={4}>{t('目标账号')}</Typography.Title>
      <Descriptions column={1} items={[{ key: 'username', label: t('用户名'), children: target.user.username }, { key: 'name', label: t('姓名'), children: target.user.fullName || t('未填写') }, { key: 'phone', label: t('电话'), children: target.user.phone || t('未填写') }, { key: 'email', label: t('邮箱'), children: target.user.email ?? '—' }, { key: 'type', label: t('账号类型'), children: target.user.accountType === 'INTERNAL' ? t('内部账号') : t('供应商账号') }, { key: 'organization', label: t('主组织'), children: target.user.organization.name }, { key: 'status', label: t('状态'), children: target.user.status === 'ACTIVE' ? t('启用') : t('停用') }]} />
      <Button disabled={busy || mutationUnknown || !!bulk} onClick={() => edit(target.user!)}>{t('管理用户')}</Button>
    </section> : <QmsLoading label={t('正在加载目标账号')} />)}
    {error && !editing && !assignment && !reset && <Alert type="error" title={t(error)} description={errorDescription} showIcon />}
    {success && <Alert type="success" title={t(success)} showIcon />}
    {!canRead && actionBar}
    {canRead && <LedgerTable<AdminUser> actionBar={actionBar} ledgerId="admin-users" organizationId={organization.id} requiredColumnKeys={['username', 'actions']} rowKey="id" loading={loading} dataSource={users} scroll={{ x: 850 }} rowSelection={canSelectUsers ? {
      fixed: true, selectedRowKeys: selectedUserIds, preserveSelectedRowKeys: true,
      onChange: keys => { if (!bulkBlocked && !loading && !bulk && !actionLock.current) setSelectedUserIds(keys.map(String)); },
      getTitleCheckboxProps: () => ({ disabled: bulkBlocked || loading || !!bulk || !users.length, 'aria-label': text('选择当前页账号', 'Select accounts on this page') }),
      getCheckboxProps: user => ({ disabled: bulkBlocked || loading || !!bulk || user.organizationId !== organization.id, 'aria-label': user.username }),
    } : undefined} pagination={{ current: page, pageSize, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], disabled: busy || batchBusy || !!bulk, onChange: (nextPage, size) => requestLeave(() => { setPage(size === pageSize ? nextPage : 1); setPageSize(size); }) }} columns={[
      { key: 'username', title: t('用户名'), dataIndex: 'username' }, { key: 'fullName', title: t('姓名'), render: (_, user) => user.fullName || t('未填写') }, { key: 'phone', title: t('电话'), render: (_, user) => user.phone || t('未填写') }, { key: 'email', title: t('邮箱'), dataIndex: 'email' },
      { key: 'accountType', title: t('账号类型'), render: (_, user) => user.accountType === 'INTERNAL' ? t('内部') : t('供应商') },
      { key: 'organization', title: t('主组织'), render: (_, user) => user.organization.name },
      { key: 'positions', title: t('任职摘要'), width: 240, render: (_, user) => user.positions?.length ? <Typography.Paragraph className="admin-user-positions-summary" ellipsis={{ rows: 2, tooltip: user.positions.map(position => `${position.department?.name ?? t('组织直属')} · ${position.name}`).join('；') }}>{user.positions.map(position => `${position.department?.name ?? t('组织直属')} · ${position.name}`).join('；')}{(user.totalPositions ?? 0) > user.positions.length && `；${t('更多任职请查看详情')}`}</Typography.Paragraph> : '—' },
      { key: 'status', title: t('状态'), render: (_, user) => <Tag color={user.status === 'ACTIVE' ? 'green' : 'default'}>{user.status === 'ACTIVE' ? t('启用') : t('停用')}</Tag> },
      { key: 'actions', title: t('操作'), width: 128, fixed: 'right', render: (_, user) => <Button className="admin-user-manage-action" size="small" disabled={busy || batchBusy || commandPending || mutationUnknown || !!bulk} onClick={() => requestLeave(() => edit(user))}>{t('管理用户')}</Button> },
    ]} />}
    {bulk && <Modal title={bulkLabel} open onCancel={clearBulk} closable={!busy && !bulkUnknown} keyboard={!busy && !bulkUnknown} mask={{ closable: !busy && !bulkUnknown }}
      styles={{ body: { maxHeight: 'min(60vh, 480px)', overflowY: 'auto' } }}
      footer={bulkFinished ? <Space wrap>
        {bulkUnknown && <Button loading={busy} disabled={bulkBlocked} onClick={() => void runBulk(true)}>{t('重试确认结果')}</Button>}
        <Button aria-label={bulkCloseLabel} disabled={busy} onClick={clearBulk}>{bulkCloseLabel}</Button>
      </Space> : undefined}
      okText={bulkConfirm} onOk={() => void runBulk(bulk.reauthenticated === 'retry')} confirmLoading={busy}
      okButtonProps={{ 'aria-label': bulkConfirm, danger: bulk.operation === 'forceDelete', disabled: bulkBlocked || (bulk.operation === 'positions' && !bulkPositions.length) }}
      cancelButtonProps={{ disabled: busy }} cancelText={bulkUnknown ? bulkCloseLabel : t('取消')}>
      <Typography.Paragraph>{selectedCount(bulk.entries.length)}</Typography.Paragraph>
      {!bulk.started && bulk.operation === 'positions' && <>
        <Select aria-label={t('任职岗位')} mode="multiple" maxCount={100} style={{ width: '100%' }} optionFilterProp="label"
          value={bulkPositions} onChange={setBulkPositions} loading={!bulkDirectory && !bulkDirectoryError} disabled={busy || !availablePositions?.length}
          options={availablePositions?.map(position => ({ value: position.id, label: `${position.name} · ${position.code}`, title: position.departmentId === null ? t('组织直属') : bulkDirectory?.departments.find(department => department.id === position.departmentId)?.name }))} />
        {bulkDirectoryError && <Alert type="error" showIcon title={t(bulkDirectoryError)} />}
        {availablePositions?.length === 0 && <Alert type="warning" showIcon title={t('当前组织没有可用岗位')} />}
      </>}
      {bulk.operation === 'delete' && !bulkFinished && <Alert type="warning" showIcon
        title={text('删除后，所选账号不可通过启用恢复。', 'Deleted accounts cannot be restored by enabling them.')}
        description={text('存在当前引用的账号将跳过，历史业务及审计记录保留。', 'Accounts with active references will be skipped. Historical business and audit records are preserved.')} />}
      {bulk.operation === 'forceDelete' && !bulkFinished && <Alert type="warning" showIcon title={t('永久删除当前账号，不可通过启用恢复。')} description={t('撤销当前凭证和有效任职，解除当前配置；保留历史签章、审批、业务及审计记录，不改写原签署人。')} />}
      {bulk.operation === 'disable' && !bulk.started && <Alert type="warning" showIcon title={text('停用后，所选账号将无法登录。', 'Selected accounts will no longer be able to sign in.')} />}
      {bulk.reauthenticated && <Alert type="info" showIcon title={text('身份验证已完成，请重新确认删除。', 'Identity verified. Please reconfirm deletion.')} />}
      <ul aria-live="polite">{bulk.entries.map(({ user, outcome }) => <li key={user.id}>
        {user.username}{outcome && `${text('：', ': ')}${outcome.message}`}{outcome?.traceId && <> · <code>{outcome.traceId}</code></>}
      </li>)}</ul>
    </Modal>}
    {positionUser && canReadPositions && <UserPositionsEditor key={`${sessionScope}:${organization.id}:${positionUser.id}`} organizationId={organization.id} user={positionUser} readOnly={!canAssignPositions || positionUser.status !== 'ACTIVE'} onClose={() => setPositionUser(undefined)} onSessionEnding={() => { sessionEnding.current = true; }} onSaved={() => { setPositionUser(undefined); setSuccess('任职已保存'); setRevision(value => value + 1); }} />}
    {mfa && canRead && mfa.organizationId === organization.id && <UserMfaPolicy key={`${organization.id}:${mfa.user.id}`} user={mfa.user} organizationId={organization.id} canWrite={canReset} onClose={() => setMfa(undefined)} onSaved={() => { setRevision((value) => value + 1); setSuccess('MFA 设置已保存'); }} />}
    <Modal title={t('批量创建账号')} open={batch && canCreate} closable={!batchBusy} keyboard={!batchBusy} mask={{ closable: !batchBusy }} onCancel={() => { if (batchPending.current) return; requestLeave(() => setBatch(false)); }} footer={null} destroyOnHidden width={950}>
      {batch && canCreate && <UserBatchCreate organizationId={organization.id} canReadPasswords={canReset} canAuthorize={canPreviewPositions(organization)} busyChanged={reportBatchBusy} />}
    </Modal>
    <Modal zIndex={1100} title={temporary ? `${temporary.username} · ${t('临时密码')}` : t('临时密码')} open={!!temporary && canReset} closable={!temporaryBusy} keyboard={!temporaryBusy} mask={{ closable: !temporaryBusy }} onCancel={() => { if (!temporaryBusy) requestLeave(() => setTemporary(undefined)); }} footer={null} destroyOnHidden>
      {temporary && canReset && <UserTemporaryPassword key={`${sessionScope}:${organization.id}:${temporary.id}`} user={temporary} organizationId={organization.id} busyChanged={setTemporaryBusy} />}
    </Modal>
    <Modal title={editing === 'new' ? t('创建用户') : t('管理用户')} open={!!editing} width={editing === 'new' ? 520 : 800} keyboard={!busy && !actionLock.current && !commandPending && !mutationUnknown} closable={!busy && !actionLock.current && !commandPending && !mutationUnknown} mask={{ closable: !busy && !actionLock.current && !commandPending && !mutationUnknown }} onCancel={() => { if (busy || actionLock.current ||commandPending || mutationUnknown) return; requestLeave(() => { setEditing(undefined); setDirty(false); form.resetFields(); mutate.current = createAdminMutation(); }, true); }} footer={null} destroyOnHidden>
      {editing && editing !== 'new' && <>
        <Descriptions className="admin-user-identity" column={{ xs: 1, sm: 2 }} size="small" items={[
          { key: 'name', label: t('姓名'), children: editing.fullName || t('未填写') }, { key: 'username', label: t('用户名'), children: editing.username },
          { key: 'organization', label: t('主组织'), children: editing.organization.name }, { key: 'type', label: t('账号类型'), children: t(editing.accountType === 'INTERNAL' ? '内部账号' : '供应商账号') },
          { key: 'status', label: t('状态'), children: t(editing.status === 'ACTIVE' ? '启用' : '停用') },
        ]} />
        <Tabs activeKey={managementTab} onChange={next => { if (busy || actionLock.current || commandPending || mutationUnknown) return; requestLeave(() => { form.setFieldsValue({ ...editing, fullName: editing.fullName ?? '', phone: editing.phone ?? '', email: editing.email ?? '' }); setDirty(false); setProfileConflict(false); setManagementTab(next); }); }} items={[
          { key: 'profile', label: t('基本资料'), disabled: busy || commandPending || mutationUnknown }, { key: 'positions', label: t('任职与授权'), disabled: busy || commandPending || mutationUnknown }, { key: 'security', label: t('账号安全'), disabled: busy || commandPending || mutationUnknown }, { key: 'lifecycle', label: t('状态与删除'), disabled: busy || commandPending || mutationUnknown },
        ]} />
      </>}
      {error && <Alert type="error" title={t(error)} description={errorDescription} showIcon />}
      {!reset && mutationRecovery}
      {profileConflict && <Button disabled={busy || mutationUnknown} onClick={() => void reloadProfileBaseline()}>{t('读取最新资料基线')}</Button>}
      <Form name="admin-user-editor" form={form} layout="vertical" disabled={busy || actionLock.current || mutationUnknown} onValuesChange={(changed) => { if (mutationUnknown) return; setDirty(true); if ('organizationId' in changed || 'accountType' in changed) { setCreatePositions([]); setCreatePreview(undefined); } }} onFinish={save} autoComplete="off">
        {editing === 'new' && <Form.Item name="username" label={t('用户名')} rules={[{ required: true }, { pattern: /^[a-zA-Z0-9._-]+$/, message: t('仅支持字母、数字、点、下划线和连字符') }]}><Input /></Form.Item>}
        {(editing === 'new' || managementTab === 'profile') && <>
        {(editing === 'new' || canUpdate) && <><Form.Item name="fullName" label={t('姓名')} rules={[{ max: 100 }]}><Input /></Form.Item><Form.Item name="phone" label={t('电话')} rules={[{ max: 40 }]}><Input /></Form.Item></>}
        {(editing === 'new' || canUpdate) && <Form.Item name="email" label={t('邮箱')} rules={[{ type: 'email' }]}><Input /></Form.Item>}
        {editing && editing !== 'new' && !canUpdate && <Descriptions column={1} items={[{ key: 'phone', label: t('电话'), children: editing.phone || t('未填写') }, { key: 'email', label: t('邮箱'), children: editing.email || t('未填写') }]} />}
        </>}
        {editing === 'new' && <Form.Item name="initialPassword" label={t('初始密码')} rules={[{ required: true }, { min: 12, max: 256 }]}><Input.Password autoComplete="new-password" /></Form.Item>}
        {(editing === 'new' || managementTab === 'positions') && <>
        {(editing === 'new' || canTransfer) && <><Form.Item name="accountType" label={t('账号类型')} rules={[{ required: true }]}><Select options={[{ value: 'INTERNAL', label: t('内部账号') }, { value: 'SUPPLIER', label: t('供应商账号') }]} /></Form.Item>
        <Form.Item name="organizationId" label={t('主组织')} rules={[{ required: true }]}><Select options={organizationOptions} /></Form.Item></>}
        {editing && editing !== 'new' && <Space wrap>
          {canAssignPositions && editing.accountType === 'INTERNAL' && editing.status === 'ACTIVE' && <Button disabled={busy || mutationUnknown} onClick={() => requestLeave(() => { setDirty(false); form.setFieldsValue(editing); setPositionUser(editing); })}>{t('调岗')}</Button>}
          {canReadPositions && (!canAssignPositions || editing.status !== 'ACTIVE') && editing.accountType === 'INTERNAL' && <Button disabled={busy || mutationUnknown} onClick={() => setPositionUser(editing)}>{t('查看任职')}</Button>}
          {canReadRoles && <Button disabled={busy || mutationUnknown} onClick={() => void openRoles(editing)}>{t('查看授权来源')}</Button>}
        </Space>}
        </>}
        {editing === 'new' && createAccountType === 'INTERNAL' && <Form.Item label={t('组织任职与权限')} required>
          {canAuthorizeCreation ? <PositionSelector key={createOrganizationId} organizationId={createOrganizationId} value={createPositions} onChange={selected => { setCreatePositions(selected); setDirty(true); }} preview={createPreview} onPreviewChange={setCreatePreview} disabled={busy || mutationUnknown} /> : <Alert showIcon type="warning" title={t('缺少岗位授权所需权限，无法创建内部账号')} />}
        </Form.Item>}
        {(editing === 'new' || (managementTab === 'profile' && canUpdate) || (managementTab === 'positions' && canTransfer)) && <div className="qms-dialog-actions" role="group" aria-label={editing === 'new' ? t('创建用户') : t('管理用户')}><Button htmlType="submit" type="primary" disabled={mutationUnknown || profileConflict || (editing === 'new' && createAccountType === 'INTERNAL' && (!canAuthorizeCreation || !createPositions.length || !createPreview))} loading={busy}>{t('保存用户')}</Button></div>}
      </Form>
      {editing && editing !== 'new' && <>
        {managementTab === 'security' && <Space wrap>
          <Button disabled={busy || mutationUnknown} onClick={() => setMfa({ user: editing, organizationId: organization.id })}>{t('MFA 设置')}</Button>
          {canReset && <><Button disabled={busy || mutationUnknown} onClick={() => { mutate.current = createAdminMutation(); setReset({ user: editing, code: randomResetCode() }); }}>{t('签发重置凭证')}</Button><Button disabled={busy || mutationUnknown} onClick={() => setTemporary(editing)}>{t('临时密码')}</Button></>}
        </Space>}
        <div hidden={managementTab !== 'lifecycle'}><Space wrap>
          {canStatus && <Button disabled={busy || mutationUnknown} onClick={() => { const path = scopePath(`users/${editing.id}`, organization.id); const body: UpdateUser = { status: editing.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }; void perform(async mutation => { const updated = await mutation<AdminUser>(path, 'PATCH', body); if (editor.current === editing) setEditing(updated); }, editing.status === 'ACTIVE' ? '用户已停用' : '用户已启用'); }}>{t(editing.status === 'ACTIVE' ? '停用' : '启用')}</Button>}
          <UserForceDelete key={`${sessionScope}:${organization.id}:${editing.id}`} target={editing} canDelete={canDelete} disabled={busy || batchBusy || mutationUnknown} onPendingChanged={setCommandPending} onDenied={cause => {
            setFailure(cause); setUsers([]); setTarget(undefined); setEditing(undefined); setAssignment(undefined); setPositionUser(undefined);
            setReset(undefined); setTemporary(undefined); setMfa(undefined); setBatch(false); setLifecycleDenied(true); onDenied?.(cause);
          }} onRefresh={() => { setEditing(undefined); setDirty(false); setRevision(value => value + 1); }} onDeleted={() => { setEditing(undefined); setDirty(false); setSuccess('用户已永久删除'); setRevision(value => value + 1); }} />
        </Space></div>
      </>}
    </Modal>
    <Modal zIndex={1100} title={sourceUser ? `${sourceUser.username} · ${t('授权来源')}` : t('授权来源')} open={!!sourceUser && canReadSources && sourceUser.accountType === 'INTERNAL' && sourceUser.organizationId === organization.id} onCancel={() => setSourceUser(undefined)} footer={null} destroyOnHidden>
      {sourceUser && canReadSources && sourceUser.accountType === 'INTERNAL' && sourceUser.organizationId === organization.id && <AuthorizationSources organization={organization} userId={sourceUser.id} onDenied={cause => {
        if (cause.status === 401) sessionEnding.current = true;
        setSourceUser(undefined); setEditing(undefined); setAssignment(undefined); setPositionUser(undefined); setTarget(undefined); setUsers([]); setLifecycleDenied(true); setFailure(cause); onDenied?.(cause);
      }} />}
    </Modal>
    <Modal zIndex={1100} title={assignment ? `${assignment.user.username} · ${t('授权来源')}` : t('授权来源')} open={!!assignment} closable={!busy} keyboard={!busy} mask={{ closable: !busy }} onCancel={() => { if (actionLock.current) return; setAssignment(undefined); }} footer={null} destroyOnHidden>
      {error && <Alert type="error" title={t(error)} description={errorDescription} showIcon />}
      {assignment && canReadRoles && <Space orientation="vertical" className="admin-form-stack">
        {assignment.authorization.effectiveRoles?.map(role => <div key={role.id}><Typography.Text strong>{role.name}</Typography.Text>{role.sources.map((source, index) => <p key={index}>{source.kind === 'DIRECT' ? t('历史直接分配（只读）') : `${t('岗位继承')} · ${source.positionId ?? t('未知岗位')}`}</p>)}</div>)}
        {assignment.authorization.roles.filter(role => role.organizationId === null).map(role => <Tag key={role.id}>{role.name} · {t('全局只读')}</Tag>)}
        <Typography.Paragraph>{t('有效权限')}：{assignment.authorization.permissions?.map(code => <Tag key={code}>{code}</Tag>)}</Typography.Paragraph>
      </Space>}
    </Modal>
    <Modal zIndex={1200} title={t('放弃未确认的请求？')} open={abandonMutation} onCancel={() => setAbandonMutation(false)} okText={t('放弃修改')} cancelText={t('取消')} onOk={() => { if (busy || actionLock.current) return; pendingMutation.current = undefined; mutate.current = createAdminMutation(); setMutationUnknown(false); setAbandonMutation(false); setError(undefined); setReset(undefined); }}>{t('原请求结果尚未确认，放弃后无法继续重试原请求。')}</Modal>
    <Modal zIndex={1100} title={t('一次性重置凭证')} open={!!reset} closable={!busy && !mutationUnknown} keyboard={!busy && !mutationUnknown} mask={{ closable: !busy && !mutationUnknown }} onCancel={() => { if (busy || actionLock.current || mutationUnknown) return; setReset(undefined); mutate.current = createAdminMutation(); }} footer={null} destroyOnHidden>
      {mutationRecovery}
      {error && <Alert type="error" title={t(error)} description={errorDescription} showIcon />}
      {reset?.issued ? <Space orientation="vertical" className="admin-form-stack">
        <Typography.Paragraph>{t('请安全交给账号持有人，在重置密码页面兑换。关闭后不再显示。')}</Typography.Paragraph>
        <Input.TextArea aria-label={t('一次性重置凭证')} readOnly value={`${reset.issued.resetId}.${reset.code}`} />
        <Typography.Text>{t('有效期至')} {new Date(reset.issued.expiresAt).toLocaleString(locale)}</Typography.Text>
        <Button onClick={() => { setReset(undefined); mutate.current = createAdminMutation(); }}>{t('关闭并清除')}</Button>
      </Space> : reset && <Button type="primary" loading={busy} disabled={mutationUnknown} onClick={() => { const path = scopePath(`users/${reset.user.id}/password-reset`, organization.id); const body = { temporaryCode: reset.code }; void perform(async mutation => { const organizationId = organization.id;
    const operationGeneration = scopeGeneration.current;
    const operationEpoch = accountAvatarEpoch(); const issued = await mutation<ResetIssued>(path, 'POST', body); if (alive.current && scope.current === organizationId && operationGeneration === scopeGeneration.current && operationEpoch === accountAvatarEpoch()) setReset((current) => current === reset ? { ...reset, issued } : current); }, '重置凭证已签发'); }}>{t('确认签发')}</Button>}
    </Modal>
  </>;
}
