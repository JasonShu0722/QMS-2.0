import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { SupplierProfile } from './supplierQuality';
import { SupplierUsersPanel } from './SupplierUsersPanel';
import { LanguageProvider } from '../../i18n/Language';

const profile = { id: 'profile-a', displayName: '供应商甲', supplierOrganizationId: null, businessCode: 'A', version: 1 } as SupplierProfile;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const permissions = ['supplier-quality:profiles:write', 'account:users:create'];
afterEach(() => vi.unstubAllGlobals());

it('renders English supplier password query and reset confirmation through the real LanguageProvider', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.includes('/temporary-password') ? json({ userId: 'u', status: 'AVAILABLE', temporaryPassword: 'english-test-password' }) : json({ items: [{ id: 'u', organizationId: 's', username: 'alice', email: null, status: 'ACTIVE', securityVersion: 1 }], canCreate: false, canReset: true, canSetStatus: false })));
  localStorage.setItem('qms:locale:v1', 'en-US');
  try {
    render(<LanguageProvider><SupplierUsersPanel profile={profile} organizationPermissions={permissions} onBound={vi.fn()} onClose={vi.fn()} /></LanguageProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Temporary password' }));
    const password = within(screen.getByLabelText('Supplier temporary password'));
    fireEvent.click(password.getByRole('button', { name: 'View temporary password' }));
    await password.findByText('english-test-password');
    await waitFor(() => expect(password.getByRole('button', { name: 'Reset temporary password' })).toBeEnabled());
    expect(password.getByRole('button', { name: 'Copy temporary password' })).toBeEnabled();
    expect(password.getByRole('button', { name: 'Download valid temporary password' })).toBeEnabled();
    fireEvent.click(password.getByRole('button', { name: 'Reset temporary password' }));
    expect(await screen.findByText('Reset the password and revoke sessions?')).toBeInTheDocument();
    expect(screen.getByText('The old password and all current sessions of this account will become invalid immediately.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm reset' })).toBeInTheDocument();
    expect(screen.queryByText('查询临时密码')).not.toBeInTheDocument();
  } finally { localStorage.removeItem('qms:locale:v1'); }
});

it.each([
  [undefined, 'Could not load or save. Please retry.'],
  ['SUPPLIER_INPUT_INVALID', 'Check the required information, response identity and completion time'],
  ['SUPPLIER_RECORD_NOT_FOUND', 'The record does not exist or you do not have permission to view it'],
  ['SUPPLIER_PROFILE_DUPLICATE', 'The supplier or business code already exists'],
  ['CONCURRENCY_CONFLICT', 'The content has changed. Your input is retained. Copy it before reloading to continue editing.'],
  ['IDEMPOTENCY_REPLAY', 'This submission differs from the completed request. Your input is retained. Reload and review it.'],
])('renders the supplier recovery error %s in English and retains the account input', async (code, text) => {
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (options?.method === 'POST') { if (!code) throw new TypeError('offline'); return json({ code }, code === 'CONCURRENCY_CONFLICT' ? 409 : 400); }
    return json({ items: [], canCreate: true, canReset: false, canSetStatus: false });
  }));
  localStorage.setItem('qms:locale:v1', 'en-US');
  try {
    render(<LanguageProvider><SupplierUsersPanel profile={profile} organizationPermissions={permissions} onBound={vi.fn()} onClose={vi.fn()} /></LanguageProvider>);
    await waitFor(() => expect(screen.getByLabelText('Username')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'retained' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create dedicated collaboration boundary and account' }));
    expect(await screen.findByText(text!)).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveValue('retained');
  } finally { localStorage.removeItem('qms:locale:v1'); }
});
it('creates the first collaboration boundary explicitly and preserves the key after an unknown result', async () => {
  let attempt = 0;
  const writes: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (options?.method === 'POST') { writes.push(options); if (++attempt === 1) throw new TypeError('offline'); return json({ id: 'u', organizationId: 'supplier-org', username: 'alice', email: null, status: 'ACTIVE', securityVersion: 1, temporaryPassword: { userId: 'u', status: 'AVAILABLE', temporaryPassword: 'local-only-password' } }); }
    return json({ items: [], canCreate: true, canReset: true, canSetStatus: false });
  }));
  render(<SupplierUsersPanel profile={profile} organizationId="owner" organizationPermissions={permissions} onBound={vi.fn()} onClose={vi.fn()} />);
  fireEvent.change(await screen.findByLabelText('用户名'), { target: { value: 'alice' } });
  await userEvent.click(screen.getByRole('button', { name: '创建专属协作边界并建账号' }));
  await screen.findByText('加载或保存失败，请重试');
  expect(screen.getByLabelText('用户名')).toHaveValue('alice');
  await userEvent.click(screen.getByRole('button', { name: '创建专属协作边界并建账号' }));
  expect(await screen.findByText('local-only-password')).toBeInTheDocument();
  expect(JSON.parse(writes[0]!.body as string)).toEqual({ organizationId: 'owner', username: 'alice' });
  expect((writes[0]!.headers as Record<string, string>)['Idempotency-Key']).toBe((writes[1]!.headers as Record<string, string>)['Idempotency-Key']);
  await waitFor(() => expect(writes).toHaveLength(2));
});

it.each([{ operation: 'create', status: 401 }, { operation: 'create', status: 403 }, { operation: 'status', status: 401 }, { operation: 'status', status: 403 }, { operation: 'password', status: 403 }])('clears queried passwords after $operation receives $status while retaining a create draft', async ({ operation, status }) => {
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (options?.method === 'POST' || options?.method === 'PUT') return json({ code: 'FEATURE_PERMISSION_DENIED' }, status);
    if (path.includes('/temporary-password')) return ++reads > 1 ? json({ code: 'FEATURE_PERMISSION_DENIED' }, status) : json({ userId: 'u', status: 'AVAILABLE', temporaryPassword: 'queried-password' });
    return json({ items: [{ id: 'u', organizationId: 's', username: 'alice', email: null, status: 'ACTIVE', securityVersion: 1 }], canCreate: true, canReset: true, canSetStatus: true });
  }));
  render(<SupplierUsersPanel profile={{ ...profile, supplierOrganizationId: 's' }} organizationId="owner" organizationPermissions={permissions} onBound={vi.fn()} onClose={vi.fn()} />);
  const accountRow = within((await screen.findByText('alice', { selector: 'td' })).closest('tr')!);
  fireEvent.click(accountRow.getByRole('button', { name: '临时密码' }));
  const password = within(screen.getByLabelText('供应商临时密码'));
  fireEvent.click(password.getByRole('button', { name: '查询临时密码' }));
  await password.findByText('queried-password');
  await waitFor(() => expect(password.getByRole('button', { name: '查询临时密码' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'retained-draft' } });
  if (operation === 'create') fireEvent.click(screen.getByRole('button', { name: '新增供应商账号' }));
  else if (operation === 'password') fireEvent.click(password.getByRole('button', { name: '查询临时密码' }));
  else {
    const toggle = accountRow.getByRole('button', { name: '停用账号' });
    await waitFor(() => expect(toggle).toBeEnabled());
    fireEvent.click(toggle);
    const confirmation = within(await screen.findByRole('tooltip'));
    fireEvent.click(confirmation.getByRole('button', { name: /^确\s*认$/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/v1/supplier-quality/profiles/profile-a/accounts/u/status', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ organizationId: 'owner', status: 'DISABLED', expectedSecurityVersion: 1 }),
    })));
  }
  await waitFor(() => expect(screen.queryByText('queried-password')).not.toBeInTheDocument());
  expect(screen.getByLabelText('用户名')).toHaveValue('retained-draft');
  expect(screen.queryByRole('button', { name: '临时密码' })).not.toBeInTheDocument();
});

it('clears a just-created password when the subsequent non-clearing refresh returns 403', async () => {
  let listCalls = 0; let deny!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (options?.method === 'POST') return json({ id: 'u', organizationId: 's', username: 'created', email: null, status: 'ACTIVE', securityVersion: 1, temporaryPassword: { userId: 'u', status: 'AVAILABLE', temporaryPassword: 'new-password-before-deny' } });
    if (++listCalls > 1) return new Promise<Response>((done) => { deny = done; });
    return json({ items: [], canCreate: true, canReset: true, canSetStatus: false });
  }));
  render(<SupplierUsersPanel profile={profile} organizationId="owner" organizationPermissions={permissions} onBound={vi.fn()} onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('用户名')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'created' } });
  fireEvent.click(screen.getByRole('button', { name: '创建专属协作边界并建账号' }));
  await screen.findByText('new-password-before-deny');
  await act(async () => { deny(json({ code: 'FEATURE_PERMISSION_DENIED' }, 403)); });
  await waitFor(() => expect(screen.queryByText('new-password-before-deny')).not.toBeInTheDocument());
});
it('does not offer create, reset or status actions to a read-only account', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ items: [{ id: 'u', organizationId: 's', username: 'alice', email: null, status: 'ACTIVE', securityVersion: 1 }], canCreate: false, canReset: false, canSetStatus: false })));
  render(<SupplierUsersPanel profile={profile} organizationPermissions={['supplier-quality:profiles:read']} onBound={vi.fn()} onClose={vi.fn()} />);
  expect(await screen.findByText('alice')).toBeInTheDocument();
  expect(screen.queryByLabelText('用户名')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '直接重置临时密码' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '停用账号' })).not.toBeInTheDocument();
});

it.each(['profile', 'organization'])('never shows a late temporary-password response after switching %s', async (scope) => {
  let resolve!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.includes('/temporary-password')) return new Promise<Response>((done) => { resolve = done; });
    return json({ items: [{ id: path.includes('profile-a') ? 'u-a' : 'u-b', organizationId: 's', username: path.includes('profile-a') ? 'alice' : 'bob', email: null, status: 'ACTIVE', securityVersion: 1 }], canCreate: false, canReset: true, canSetStatus: false });
  }));
  const props = { organizationId: 'owner', organizationPermissions: permissions, onBound: vi.fn(), onClose: vi.fn() };
  const view = render(<SupplierUsersPanel {...props} profile={profile} />);
  const accountRow = within((await screen.findByText('alice', { selector: 'td' })).closest('tr')!);
  await userEvent.click(accountRow.getByRole('button', { name: '临时密码' }));
  const password = within(screen.getByLabelText('供应商临时密码'));
  const query = password.getByRole('button', { name: '查询临时密码' });
  await waitFor(() => expect(query).toBeEnabled());
  await userEvent.click(query);
  await waitFor(() => expect(resolve).toBeTypeOf('function'));
  view.rerender(<SupplierUsersPanel {...props} organizationId={scope === 'organization' ? 'new-owner' : props.organizationId} profile={scope === 'profile' ? { ...profile, id: 'profile-b', displayName: '供应商乙' } : profile} />);
  await screen.findByText(scope === 'profile' ? 'bob' : 'alice', { selector: 'td' });
  if (scope === 'organization') expect(fetch).toHaveBeenCalledWith('/api/v1/supplier-quality/profiles/profile-a/accounts?organizationId=new-owner', expect.anything());
  await act(async () => { resolve(json({ userId: 'u-a', status: 'AVAILABLE', temporaryPassword: 'late-profile-a-password' })); });
  expect(screen.queryByText('late-profile-a-password')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '复制临时密码' })).not.toBeInTheDocument();
});

it('supports creation when the bound enterprise account list is not readable, without exposing its metadata', async () => {
  const writes: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (options?.method === 'POST') { writes.push(options); return json({ id: 'u', organizationId: 'supplier-org', username: 'created', email: null, status: 'ACTIVE', securityVersion: 1, temporaryPassword: { userId: 'u', status: 'UNAVAILABLE' } }); }
    return json({ code: 'FEATURE_PERMISSION_DENIED' }, 403);
  }));
  render(<SupplierUsersPanel profile={{ ...profile, supplierOrganizationId: 'supplier-org' }} organizationId="owner" organizationPermissions={permissions} onBound={vi.fn()} onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('用户名')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'created' } });
  await userEvent.click(screen.getByRole('button', { name: '新增供应商账号' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(screen.queryByRole('button', { name: '停用账号' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '查询临时密码' })).not.toBeInTheDocument();
});
