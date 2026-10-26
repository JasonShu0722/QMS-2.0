import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import baseUserEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { UserAdministration } from './UserAdministration';
import type { AdminOrganization, AdminUser } from './admin';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { LanguageProvider } from '../../i18n/Language';
import { UserMfaPolicy } from './UserMfaPolicy';

const organization: AdminOrganization = { id: 'org', code: 'org', name: 'Organization', type: 'INTERNAL', permissions: ['account:users:read', 'account:users:reset'] };
const user: AdminUser = { fullName: null, phone: null, profileVersion: 1, emailVerifiedAt: null, id: 'u', username: 'alice', email: null, accountType: 'INTERNAL', status: 'ACTIVE', organizationId: 'org', organization: { id: 'org', code: 'org', name: 'Organization' }, mfaEnabled: false, createdAt: '', updatedAt: '' };
const policy = { userId: 'u', required: false, bound: true, override: null, roleRequired: false, securityVersion: 4 };
const userEvent = baseUserEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function page(org = organization) { return <MemoryRouter initialEntries={['/admin']}><Routes><Route path="/admin" element={<UserAdministration organization={org} organizations={[org]} />} /><Route path="/login" element={<p>Login destination</p>} /></Routes></MemoryRouter>; }
async function confirmSave() {
  await userEvent.click(screen.getByRole('button', { name: '保存 MFA 设置' }));
  await userEvent.click(await screen.findByRole('button', { name: '确认保存' }));
}
beforeEach(() => { localStorage.clear(); useWorkTabsStore.getState().reset(); });
afterEach(() => vi.unstubAllGlobals());

it('translates the policy state, security confirmation and conflict recovery', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init.method === 'PUT') return json({ code: 'CONCURRENCY_CONFLICT' }, 409);
    return json(path.includes('mfa-policy') ? policy : [user]);
  }));
  render(<LanguageProvider><MemoryRouter><UserMfaPolicy user={user} organizationId={organization.id} canWrite onSaved={vi.fn()} onClose={vi.fn()} /></MemoryRouter></LanguageProvider>);
  await screen.findByRole('dialog', { name: 'alice · MFA settings' });
  expect(await screen.findByText('Default policy')).toBeInTheDocument();
  expect(screen.getByText('Authenticator binding')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('switch', { name: 'Require MFA' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save MFA settings' }));
  expect(await screen.findByText('Saving revokes all sessions and pending verification for this account and retains the authenticator. Changing your own account requires signing in again.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm save' }));
  expect(await screen.findByText('Settings have changed. Reload before saving again. Your current selection is retained.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reload MFA settings' })).toBeInTheDocument();
});

it('loads target MFA policy only after opening the user action and shows actual binding and policy source', async () => {
  const fetcher = vi.fn(async (path: string) => json(path.includes('mfa-policy') ? policy : [user]));
  vi.stubGlobal('fetch', fetcher);
  render(page());
  const action = await screen.findByRole('button', { name: 'MFA 设置' });
  expect(fetcher.mock.calls.some(([path]) => path.includes('mfa-policy'))).toBe(false);
  await userEvent.click(action);
  expect(await screen.findByText('默认策略')).toBeInTheDocument();
  expect(screen.getByText('已绑定')).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: '要求 MFA' })).not.toBeChecked();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

it('permits read-only policy inspection without exposing mutation or factor controls', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => json(path.includes('mfa-policy') ? { ...policy, required: true, override: true } : [user])));
  render(page({ ...organization, permissions: ['account:users:read'] }));
  await userEvent.click(await screen.findByRole('button', { name: 'MFA 设置' }));
  expect(await screen.findByText('账号配置')).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: '要求 MFA' })).toBeDisabled();
  expect(screen.getByText('没有重置用户权限，仅可查看 MFA 设置。')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '保存 MFA 设置' })).not.toBeInTheDocument();
  expect(screen.queryByText('解绑验证器')).not.toBeInTheDocument();
});

it('retries a failed initial policy read without displaying backend details', async () => {
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.includes('mfa-policy') ? ++reads === 1 ? json({ code: 'UNAVAILABLE', message: 'backend secret' }, 500) : json(policy) : json([user])));
  render(page());
  await userEvent.click(await screen.findByRole('button', { name: 'MFA 设置' }));
  expect(await screen.findByText('请求被拒绝，请检查权限和填写内容后重试')).toBeInTheDocument();
  expect(screen.queryByText('backend secret')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '重新加载 MFA 设置' }));
  expect(await screen.findByRole('switch', { name: '要求 MFA' })).toBeEnabled();
});

it('preserves failed draft and reuses its idempotency key until content changes', async () => {
  const writes: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init.method === 'PUT') { writes.push(init); return json({ code: 'VALIDATION_FAILED' }, 400); }
    return json(path.includes('mfa-policy') ? policy : [user]);
  }));
  render(page());
  await userEvent.click(await screen.findByRole('button', { name: 'MFA 设置' }));
  await userEvent.click(await screen.findByRole('switch', { name: '要求 MFA' }));
  await confirmSave();
  expect(await screen.findByText('请检查填写内容')).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: '要求 MFA' })).toBeChecked();
  await confirmSave();
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[0].headers).toEqual(writes[1].headers);
  expect(JSON.parse(String(writes[0].body))).toEqual({ required: true, expectedSecurityVersion: 4 });
  await userEvent.click(screen.getByRole('switch', { name: '要求 MFA' }));
  await confirmSave();
  await waitFor(() => expect(writes).toHaveLength(3));
  expect((writes[2].headers as Record<string, string>)['Idempotency-Key']).not.toBe((writes[0].headers as Record<string, string>)['Idempotency-Key']);
}, 30_000);

it('requires explicit concurrency refresh and retains the draft with the latest version', async () => {
  const writes: RequestInit[] = [];
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init.method === 'PUT') { writes.push(init); return json({ code: 'CONCURRENCY_CONFLICT' }, 409); }
    return json(path.includes('mfa-policy') ? { ...policy, securityVersion: ++reads === 1 ? 4 : 6 } : [user]);
  }));
  render(page());
  await userEvent.click(await screen.findByRole('button', { name: 'MFA 设置' }));
  await userEvent.click(await screen.findByRole('switch', { name: '要求 MFA' }));
  await confirmSave();
  expect(await screen.findByText('设置已更新，请重新加载后再保存。当前选择会保留。')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '保存 MFA 设置' })).toBeDisabled();
  expect(reads).toBe(1);
  await userEvent.click(screen.getByRole('button', { name: '重新加载 MFA 设置' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存 MFA 设置' })).toBeEnabled());
  expect(screen.getByRole('switch', { name: '要求 MFA' })).toBeChecked();
  await confirmSave();
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(JSON.parse(String(writes[1].body)).expectedSecurityVersion).toBe(6);
}, 30_000);

it('isolates a pending read when organization changes and ignores its late response', async () => {
  let resolveRead: (response: Response) => void = () => {};
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.includes('mfa-policy') ? new Promise<Response>((resolve) => { resolveRead = resolve; }) : json([user])));
  const view = render(page());
  await userEvent.click(await screen.findByRole('button', { name: 'MFA 设置' }));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  view.rerender(page({ ...organization, id: 'other-org' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  resolveRead(json(policy));
  expect(screen.queryByRole('switch', { name: '要求 MFA' })).not.toBeInTheDocument();
});

it('allows closing a pending policy read and ignores the late response', async () => {
  let resolveRead: (response: Response) => void = () => {};
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.includes('mfa-policy') ? new Promise<Response>((resolve) => { resolveRead = resolve; }) : json([user])));
  render(page());
  await userEvent.click(await screen.findByRole('button', { name: 'MFA 设置' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  resolveRead(json(policy));
  expect(screen.queryByRole('switch', { name: '要求 MFA' })).not.toBeInTheDocument();
});

// Multi-dialog confirmation and navigation can exceed 10 seconds in JSDOM on Windows.
it('clears work tabs and replaces the route when changing the current account revokes its session', async () => {
  const store = useWorkTabsStore.getState();
  store.bindSession('INTERNAL:org:u'); store.openTab({ id: 'private', path: '/app/account', title: 'Private' });
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    return json(path.includes('mfa-policy') ? { ...policy, ...(init.method === 'PUT' ? { selfSessionRevoked: true, required: true } : {}) } : [user]);
  }));
  render(page());
  await userEvent.click(await screen.findByRole('button', { name: 'MFA 设置' }));
  await userEvent.click(await screen.findByRole('switch', { name: '要求 MFA' }));
  await confirmSave();
  expect(await screen.findByText('Login destination')).toBeInTheDocument();
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
}, 30_000);

it('refreshes policy and user list after saving another account and keeps the dialog busy until complete', async () => {
  let policyReads = 0;
  let userReads = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.includes('mfa-policy')) { if (init.method !== 'PUT') policyReads++; return json({ ...policy, ...(policyReads > 1 || init.method === 'PUT' ? { required: true, override: true, securityVersion: 5 } : {}) }); }
    userReads++; return json([user]);
  }));
  render(page());
  await userEvent.click((await screen.findByText('MFA 设置', { selector: 'button > span' })).closest('button')!);
  const dialog = within(await screen.findByRole('dialog'));
  const required = await dialog.findByLabelText('要求 MFA', { selector: 'button[role="switch"]' });
  await waitFor(() => expect(required).toBeEnabled());
  await userEvent.click(required);
  await userEvent.click(dialog.getByRole('button', { name: '保存 MFA 设置' }));
  await userEvent.click((await screen.findByText('确认保存', { selector: 'button > span' })).closest('button')!);
  expect(await screen.findByText('MFA 设置已保存')).toBeInTheDocument();
  await waitFor(() => expect(policyReads).toBe(2));
  expect(userReads).toBe(2);
  expect(within(screen.getByRole('dialog')).getByText('账号配置')).toBeInTheDocument();
});
