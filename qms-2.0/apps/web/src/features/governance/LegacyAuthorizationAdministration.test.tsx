import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { ApiError } from '../../api/client';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { LegacyAuthorizationAdministration } from './LegacyAuthorizationAdministration';
import type { AdminOrganization } from '../admin/admin';

const organization: AdminOrganization = { id: 'org', name: '组织', code: 'ORG', type: 'INTERNAL', permissions: ['account:roles:read', 'organization:structure:read', 'account:users:read', 'organization:structure:manage', 'organization:positions:assign', 'account:roles:assign', 'account:roles:delete', 'account:roles:update', 'account:roles:create'] };
const role: components['schemas']['LegacyAuthorizationRoleDto'] = { id: 'role', organizationId: 'org', name: '旧管理员', code: 'OLD_ADMIN', mfaRequired: true, permissionCodes: ['organization:read'], platformMarker: false };
const preview: components['schemas']['LegacyAuthorizationPreviewDto'] = { authorizationBaseline: 'baseline', role, directSources: [{ userId: 'user', organizationId: 'org', roleId: 'role', selected: false, initialization: true }], mappedSources: [], target: null, workflowReferences: [], affectedUsers: [], impactUserIds: [], retainedSourceCount: 1, labels: { users: [{ id: 'user', organizationId: 'org', username: 'zhang', fullName: '张工', status: 'ACTIVE', unavailable: false }], positions: [], organizations: [{ id: 'org', name: '组织', code: 'ORG' }] } };
type Call = { path: string; init?: RequestInit };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function setup(commit: (call: Call) => Response | Promise<Response> = () => json({ roleId: 'role', targetPositionId: null, archived: false, deleted: false, selfSessionRevoked: false }), org = organization, response: (input: components['schemas']['LegacyAuthorizationPreviewInputDto']) => components['schemas']['LegacyAuthorizationPreviewDto'] = body => ({ ...preview, retainedSourceCount: body.directUserIds.length ? 0 : 1, directSources: preview.directSources.map(source => ({ ...source, selected: body.directUserIds.includes(source.userId) })) }), options: { guard?: boolean; removeAfterCommit?: boolean } = {}) {
  const calls: Call[] = [];
  let committed = false;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/commit')) { const result = await commit({ path, init }); committed = result.ok; return result; }
    if (path.endsWith('/preview')) return json(response(JSON.parse(String(init?.body))));
    if (path.includes('/history?')) return json({ items: [], total: 0, pageSize: 20, offset: 0 });
    if (path.includes('/legacy-authorizations')) return json(options.removeAfterCommit && committed ? [] : [role]);
    if (path.includes('/positions?')) return json([{ id: 'target', organizationId: 'org', departmentId: null, categoryId: null, code: 'TARGET', name: '目标原岗位', status: 'ACTIVE', version: 1 }]);
    return json([]);
  }));
  const panel = <LegacyAuthorizationAdministration organization={org} />;
  render(<MemoryRouter>{options.guard ? <UnsavedChangesProvider>{panel}</UnsavedChangesProvider> : panel}</MemoryRouter>); return calls;
}
async function open() { fireEvent.click(await screen.findByRole('button', { name: '旧管理员 · 查看兼容来源' })); await screen.findByRole('checkbox', { name: /zhang/ }); }
async function previewRemoval() { await open(); fireEvent.click(screen.getByRole('checkbox', { name: /zhang/ })); fireEvent.click(screen.getByRole('button', { name: '预览处置' })); await waitFor(() => expect(screen.getByRole('button', { name: '确认执行' })).toBeEnabled()); }
afterEach(() => vi.unstubAllGlobals());

it('requires exact explicit source selection, uses the dedicated preview, and cancellation never commits', async () => {
  const calls = setup(); await open(); expect(screen.getByRole('checkbox', { name: /zhang/ })).not.toBeChecked();
  expect(screen.getByText('系统初始化来源')).toBeVisible(); fireEvent.click(screen.getByRole('checkbox', { name: /zhang/ }));
  fireEvent.click(screen.getByRole('button', { name: '预览处置' })); await screen.findByRole('button', { name: '确认执行' });
  expect(JSON.parse(String(calls.filter(call => call.path.endsWith('/preview')).at(-1)?.init?.body))).toEqual({ operation: 'REMOVE', directUserIds: ['user'], sourcePositionIds: [] });
  fireEvent.click(screen.getByRole('button', { name: '取消处置' })); expect(calls.some(call => call.path.endsWith('/commit'))).toBe(false);
});

it('invalidates a reviewed baseline on every intention change', async () => {
  const calls = setup(); await previewRemoval(); fireEvent.click(screen.getByRole('checkbox', { name: /zhang/ }));
  expect(screen.queryByRole('button', { name: '确认执行' })).not.toBeInTheDocument(); expect(calls.some(call => call.path.endsWith('/commit'))).toBe(false);
});

it('preserves the exact body and idempotency key for explicit unknown-result retries and locks changes', async () => {
  let count = 0; const calls = setup(() => ++count === 1 ? Promise.reject(new TypeError('network')) : json({ roleId: 'role', targetPositionId: null, archived: false, deleted: false, selfSessionRevoked: false }));
  await previewRemoval(); fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
  const retry = await screen.findByRole('button', { name: '原样重试确认结果' }); expect(screen.getByRole('checkbox', { name: /zhang/ })).toBeDisabled();
  fireEvent.click(retry); await waitFor(() => expect(calls.filter(call => call.path.endsWith('/commit'))).toHaveLength(2));
  const commits = calls.filter(call => call.path.endsWith('/commit'));
  expect(commits[1].init?.body).toBe(commits[0].init?.body); expect(commits[1].init?.headers).toEqual(commits[0].init?.headers);
  expect(JSON.parse(String(commits[0].init?.body))).toMatchObject({ authorizationBaseline: 'baseline', confirmedImpactUserIds: [], directUserIds: ['user'] });
});

it('keeps the selected draft on 409 but requires a fresh preview', async () => {
  setup(() => json({ code: 'CONFLICT', message: 'conflict' }, 409)); await previewRemoval(); fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
  expect(await screen.findByText('处置基线已变化，请保留草稿并重新预览。')).toBeVisible(); expect(screen.getByRole('checkbox', { name: /zhang/ })).toBeChecked();
  expect(screen.queryByRole('button', { name: '确认执行' })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: '预览处置' })).toBeEnabled();
});

it('does not read or offer actions without the exact read authorization', async () => {
  const calls = setup(undefined, { ...organization, permissions: [] }); expect(await screen.findByRole('alert')).toBeVisible(); expect(calls).toHaveLength(0);
});

it('migrates to an existing position only after all exact diffusion users are explicitly confirmed', async () => {
  const expanded: components['schemas']['LegacyAuthorizationPreviewDto'] = { ...preview, target: { positionId: 'target', canonicalRoleId: 'canonical', roleCode: 'POS_TARGET', departmentId: null, code: 'TARGET', name: '目标原岗位', originalCanonical: { ...role, id: 'canonical', code: 'POS_TARGET', name: '目标原授权' }, strategy: 'MERGE_WITH_QUALIFICATION', permissionCodes: ['organization:read'], mfaRequired: true }, impactUserIds: ['user', 'diffused'], retainedSourceCount: 1, affectedUsers: [{ userId: 'diffused', organizationId: 'org', securityVersion: 1, status: 'ACTIVE', accountType: 'INTERNAL', mfaEnabled: false, beforePermissionCodes: [], afterPermissionCodes: ['organization:read'], beforeRoleCodes: ['POS_TARGET'], afterRoleCodes: ['POS_TARGET', 'OLD_ADMIN'], beforeMfaRequired: false, afterMfaRequired: true, beforePlatformAdministrator: false, afterPlatformAdministrator: false, appointments: [] }], labels: { ...preview.labels, users: [...preview.labels.users, { id: 'diffused', organizationId: 'org', username: 'li', fullName: '李工', status: 'ACTIVE', unavailable: false }] } };
  const calls = setup(() => json({ roleId: 'role', targetPositionId: 'target', archived: false, deleted: false, selfSessionRevoked: false }), organization, body => body.operation === 'MIGRATE' ? expanded : preview);
  await open(); fireEvent.change(screen.getByLabelText('处置方式'), { target: { value: 'EXISTING' } });
  fireEvent.change(screen.getByLabelText('目标岗位'), { target: { value: 'target' } }); fireEvent.click(screen.getByRole('checkbox', { name: /zhang/ }));
  fireEvent.click(screen.getByRole('button', { name: '预览处置' })); const confirm = await screen.findByRole('button', { name: '确认执行' });
  expect(confirm).toBeDisabled(); expect(screen.getByText('目标原授权 · POS_TARGET')).toBeVisible(); expect(screen.getByText('MERGE_WITH_QUALIFICATION', { exact: false })).toBeVisible();
  const checks = screen.getAllByRole('checkbox', { name: /确认该人员全部扩散影响/ }); fireEvent.click(checks[0]); expect(confirm).toBeDisabled(); fireEvent.click(checks[1]);
  expect(confirm).toBeEnabled(); fireEvent.click(confirm);
  await waitFor(() => expect(calls.some(call => call.path.endsWith('/commit'))).toBe(true));
  expect(JSON.parse(String(calls.find(call => call.path.endsWith('/commit'))?.init?.body))).toMatchObject({ operation: 'MIGRATE', targetPositionId: 'target', directUserIds: ['user'], sourcePositionIds: [], preserveRoleCode: false, confirmedImpactUserIds: ['user', 'diffused'] });
});

it('submits an explicitly selected new direct position as literal null, with a user-chosen stable role-code option', async () => {
  const calls = setup(); await open(); fireEvent.change(screen.getByLabelText('处置方式'), { target: { value: 'NEW' } });
  fireEvent.change(screen.getByLabelText('岗位代码'), { target: { value: 'ADMIN' } }); fireEvent.change(screen.getByLabelText('岗位名称'), { target: { value: '组织直属管理员' } });
  fireEvent.change(screen.getByLabelText('部门'), { target: { value: '__direct__' } }); fireEvent.click(screen.getByRole('checkbox', { name: '明确保留稳定角色代码资格（可能保留兼容映射）' }));
  fireEvent.click(screen.getByRole('button', { name: '预览处置' }));
  await waitFor(() => expect(calls.filter(call => call.path.endsWith('/preview'))).toHaveLength(2));
  expect(JSON.parse(String(calls.filter(call => call.path.endsWith('/preview')).at(-1)?.init?.body))).toMatchObject({ operation: 'MIGRATE', newPosition: { code: 'ADMIN', name: '组织直属管理员', departmentId: null, categoryId: null }, preserveRoleCode: true });
});

it('locks a malformed successful commit response to the original request rather than allowing a fresh command', async () => {
  setup(() => json({ roleId: 'different', archived: true })); await previewRemoval(); fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
  expect(await screen.findByRole('button', { name: '原样重试确认结果' })).toBeEnabled(); expect(screen.getByRole('button', { name: '取消处置' })).toBeDisabled();
});

it('clears the draft and all source facts after a denied commit', async () => {
  setup(() => json({ code: 'DENIED', message: 'denied' }, 403)); await previewRemoval(); fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
  expect(await screen.findByText('无兼容授权读取权限')).toBeVisible(); expect(screen.queryByText(/张工/)).not.toBeInTheDocument();
});

it('offers read-only source inspection without clickable ungranted write paths', async () => {
  const calls = setup(undefined, { ...organization, permissions: ['account:roles:read', 'organization:structure:read', 'account:users:read'] }); await open();
  expect(screen.getByRole('checkbox', { name: /zhang/ })).toBeDisabled(); expect(screen.queryByRole('button', { name: '预览处置' })).not.toBeInTheDocument();
  expect(calls.some(call => call.path.endsWith('/commit'))).toBe(false);
});

it('shows fixed workflow role-code references to a full-read-only actor without creating a committable preview', async () => {
  const calls = setup(undefined, { ...organization, permissions: ['account:roles:read', 'organization:structure:read', 'account:users:read'] }, () => ({ ...preview, workflowReferences: [{ organizationId: 'org', versionId: 'fixed-version', nodeId: 'fixed-node', status: 'PUBLISHED', roleCode: 'FIXED_APPROVER' }] }));
  await open();
  expect(screen.getByText('FIXED_APPROVER', { exact: false })).toBeVisible();
  const reference = screen.getByText('FIXED_APPROVER', { exact: false }).closest('article')!;
  expect(reference).toHaveTextContent('PUBLISHED'); expect(reference).toHaveTextContent('fixed-version'); expect(reference).toHaveTextContent('fixed-node'); expect(reference).toHaveTextContent('组织 · ORG');
  expect(screen.queryByRole('region', { name: '处置预览' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: '确认执行' })).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /zhang/ })).not.toBeChecked();
  expect(JSON.parse(String(calls.find(call => call.path.endsWith('/preview'))?.init?.body))).toEqual({ operation: 'REMOVE', directUserIds: [], sourcePositionIds: [] });
  expect(calls.some(call => call.path.endsWith('/commit'))).toBe(false);
});

it('uses explicit identical-request retry after completed recent authentication instead of automatic replay', async () => {
  const calls = setup(() => Promise.reject(new ApiError({ code: 'CLIENT_REAUTHENTICATION_COMPLETED', message: 'reauthenticated' })));
  await previewRemoval(); fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
  expect(await screen.findByRole('button', { name: '原样重试确认结果' })).toBeEnabled();
  expect(calls.filter(call => call.path.endsWith('/commit'))).toHaveLength(1);
});

it('retains the selected draft when parent metadata changes without actor, scope, or permission changes', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'csrf' }) : path.endsWith('/preview') ? json(preview) : path.includes('/legacy-authorizations') ? json([role]) : json([])));
  const view = render(<MemoryRouter><LegacyAuthorizationAdministration organization={organization} /></MemoryRouter>); await open(); fireEvent.click(screen.getByRole('checkbox', { name: /zhang/ }));
  view.rerender(<MemoryRouter><LegacyAuthorizationAdministration organization={{ ...organization, name: '新组织显示名', permissions: [...organization.permissions].reverse() }} /></MemoryRouter>);
  expect(screen.getByRole('checkbox', { name: /zhang/ })).toBeChecked();
});

async function keyboardActivate(user: ReturnType<typeof userEvent.setup>, element: HTMLElement) {
  for (let index = 0; document.activeElement !== element && index < 40; index++) await user.tab();
  expect(element).toHaveFocus();
  await user.keyboard('{Enter}');
}

it.each([false, true])('restores focus to the newly mounted role entry after keyboard cancellation (dirty %s)', async dirty => {
  const calls = setup(undefined, organization, undefined, { guard: true }); const user = userEvent.setup();
  const original = await screen.findByRole('button', { name: '旧管理员 · 查看兼容来源' }); await keyboardActivate(user, original);
  await screen.findByRole('checkbox', { name: /zhang/ });
  if (dirty) await user.click(screen.getByRole('checkbox', { name: /zhang/ }));
  await keyboardActivate(user, screen.getByRole('button', { name: '取消处置' }));
  if (dirty) { await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' }); await keyboardActivate(user, screen.getByRole('button', { name: '放弃修改' })); }
  const restored = await screen.findByRole('button', { name: '旧管理员 · 查看兼容来源' });
  expect(original.isConnected).toBe(false); expect(restored).not.toBe(original);
  await waitFor(() => expect(restored).toHaveFocus()); expect(calls.some(call => call.path.endsWith('/commit'))).toBe(false);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it.each([false, true])('restores keyboard focus after commit to the retained role or stable heading (removed %s)', async removed => {
  setup(() => json({ roleId: 'role', targetPositionId: null, archived: removed, deleted: false, selfSessionRevoked: false }), organization, undefined, { removeAfterCommit: removed });
  const user = userEvent.setup(); const original = await screen.findByRole('button', { name: '旧管理员 · 查看兼容来源' }); await keyboardActivate(user, original);
  await screen.findByRole('checkbox', { name: /zhang/ }); await user.click(screen.getByRole('checkbox', { name: /zhang/ }));
  await keyboardActivate(user, screen.getByRole('button', { name: '预览处置' }));
  await keyboardActivate(user, await screen.findByRole('button', { name: '确认执行' }));
  await screen.findByText('兼容授权处置完成，历史事实已保留。');
  if (removed) { await screen.findByText('暂无兼容授权'); await waitFor(() => expect(screen.getByRole('heading', { name: '兼容授权迁移/清理' })).toHaveFocus()); }
  else { const restored = await screen.findByRole('button', { name: '旧管理员 · 查看兼容来源' }); expect(restored).not.toBe(original); await waitFor(() => expect(restored).toHaveFocus()); }
  expect(original.isConnected).toBe(false);
});
