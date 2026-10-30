import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { ConsoleLayout } from '../../console/ConsoleLayout';
import { ConsoleManagementPage } from '../../console/ConsoleManagementPage';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

const organization = { id: '11111111-1111-4111-8111-111111111111', code: 'ORG', name: '组织', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
const permissions = ['account:roles:read', 'organization:structure:read', 'account:users:read', 'organization:structure:manage', 'organization:positions:assign', 'account:roles:assign', 'account:roles:delete', 'account:roles:update', 'account:roles:create'];
const role: components['schemas']['LegacyAuthorizationRoleDto'] = { id: '22222222-2222-4222-8222-222222222222', organizationId: organization.id, name: '旧管理员', code: 'OLD_ADMIN', mfaRequired: true, permissionCodes: ['organization:read'], platformMarker: false };
const userId = '33333333-3333-4333-8333-333333333333';
const context: components['schemas']['ConsoleContextDto'] = { actor: { id: 'actor', accountType: 'INTERNAL', homeOrganization: organization }, targetOrganization: organization, organizations: [organization], hasPlatformAdministrator: true, modules: [{ key: 'organizations', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: organization.id, permissions }] };
const management: components['schemas']['AdminOrganizationContextDto'] = { hasPlatformAdministrator: true, homeOrganizationId: organization.id, targetOrganizationId: organization.id, accessKind: 'PLATFORM', targetOrganizationStatus: 'ACTIVE', targetConfigurationRequired: false, permissions, authorizationSources: [] };
const preview: components['schemas']['LegacyAuthorizationPreviewDto'] = { authorizationBaseline: 'baseline', role, directSources: [{ userId, organizationId: organization.id, roleId: role.id, selected: false, initialization: true }], mappedSources: [], target: null, workflowReferences: [], affectedUsers: [], impactUserIds: [], retainedSourceCount: 1, labels: { users: [{ id: userId, organizationId: organization.id, username: 'zhang', fullName: '张工', status: 'ACTIVE', unavailable: false }], positions: [], organizations: [organization] } };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
// jsdom has no native top layer; the actual gate and soft authorization reads still run.
beforeAll(() => Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, writable: true, value(this: HTMLDialogElement) { this.setAttribute('open', ''); } },
  close: { configurable: true, writable: true, value(this: HTMLDialogElement) { this.removeAttribute('open'); } },
}));
afterAll(() => { if (showModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', showModal); else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); if (close) Object.defineProperty(HTMLDialogElement.prototype, 'close', close); else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close'); });
afterEach(() => {
  console.info('legacy-console-focus-api-sequence', JSON.stringify(vi.mocked(fetch).mock.calls.map(([path, init]) => ({ path: String(path), method: init?.method ?? 'GET' }))));
  vi.unstubAllGlobals(); useWorkTabsStore.getState().reset(); localStorage.clear();
});

it.each([false, true])('restores focus through the actual console parent after a successful legacy command and equal-capability verification (removed %s)', async removed => {
  let committed = false;
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path.includes('/admin/console/context')) return json(structuredClone(context));
    if (path === '/api/v1/admin/organizations') return json([{ ...organization, permissions }]);
    if (path.includes('/admin/organizations/context?')) return json(management);
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/commit')) { committed = true; return json({ roleId: role.id, targetPositionId: null, archived: removed, deleted: false, selfSessionRevoked: false }); }
    if (path.endsWith('/preview')) { const body = JSON.parse(String(init?.body)); return json({ ...preview, directSources: preview.directSources.map(source => ({ ...source, selected: body.directUserIds.includes(userId) })) }); }
    if (path.endsWith('/legacy-authorizations')) return json(committed && removed ? [] : [role]);
    return json([]);
  }));
  useWorkTabsStore.getState().bindSession(`INTERNAL:${organization.id}:actor`);
  render(<MemoryRouter initialEntries={['/console/organizations']}><ConsoleLayout><ConsoleManagementPage /></ConsoleLayout></MemoryRouter>);
  const user = userEvent.setup(); const panel = await screen.findByRole('region', { name: '兼容授权迁移/清理' });
  const original = await within(panel).findByRole('button', { name: '旧管理员 · 查看兼容来源' });
  original.focus();
  expect(original).toHaveFocus(); await user.keyboard('{Enter}');
  fireEvent.click(await within(panel).findByRole('checkbox', { name: /zhang/ })); fireEvent.click(within(panel).getByRole('button', { name: '预览处置' }));
  const confirm = await within(panel).findByRole('button', { name: '确认执行' });
  const verifications = calls.filter(call => call.path.includes('/admin/console/context')).length;
  fireEvent.click(confirm);
  await waitFor(() => expect(calls.some(call => call.path.endsWith('/commit'))).toBe(true));
  await waitFor(() => expect(calls.filter(call => call.path.includes('/admin/console/context')).length).toBeGreaterThan(verifications));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '会话安全验证' })).not.toBeInTheDocument());
  const currentPanel = await screen.findByRole('region', { name: '兼容授权迁移/清理' });
  const restored = removed ? within(currentPanel).getByRole('heading', { name: '兼容授权迁移/清理' }) : await within(currentPanel).findByRole('button', { name: '旧管理员 · 查看兼容来源' });
  if (removed) await within(currentPanel).findByText('暂无兼容授权');
  expect(original.isConnected).toBe(false);
  expect(document.activeElement === restored).toBe(true);
});
