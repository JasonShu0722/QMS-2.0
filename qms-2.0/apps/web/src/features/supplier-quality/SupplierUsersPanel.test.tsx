import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { SupplierProfile } from './supplierQuality';
import { SupplierUsersPanel } from './SupplierUsersPanel';
import { LanguageProvider } from '../../i18n/Language';
import { MemoryRouter } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { SupplierProfilesPage } from './SupplierProfilesPage';

const profile = { id: 'profile-a', displayName: '供应商甲', supplierOrganizationId: null, businessCode: 'A', version: 1 } as SupplierProfile;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const permissions = ['supplier-quality:profiles:write', 'account:users:create'];
afterEach(() => { vi.unstubAllGlobals(); useWorkTabsStore.getState().reset(); });

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
    expect(screen.getByText('The old password and all current sessions will become invalid immediately. The user must change the password at first sign-in.')).toBeInTheDocument();
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

it.each([{ operation: 'create', status: 401 }, { operation: 'create', status: 403 }, { operation: 'status', status: 401 }, { operation: 'status', status: 403 }, { operation: 'password', status: 403 }])('clears passwords and account drafts after $operation receives $status', async ({ operation, status }) => {
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
  expect(screen.queryByLabelText('用户名')).not.toBeInTheDocument();
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

it('fails closed when the account permission source is denied, until explicit reload', async () => {
  const writes: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (options?.method === 'POST') { writes.push(options); return json({ id: 'u', organizationId: 'supplier-org', username: 'created', email: null, status: 'ACTIVE', securityVersion: 1, temporaryPassword: { userId: 'u', status: 'UNAVAILABLE' } }); }
    return json({ code: 'FEATURE_PERMISSION_DENIED' }, 403);
  }));
  render(<SupplierUsersPanel profile={{ ...profile, supplierOrganizationId: 'supplier-org' }} organizationId="owner" organizationPermissions={permissions} onBound={vi.fn()} onClose={vi.fn()} />);
  await screen.findByRole('alert');
  expect(screen.queryByLabelText('用户名')).not.toBeInTheDocument();
  expect(writes).toHaveLength(0);
  expect(screen.queryByRole('button', { name: '停用账号' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '查询临时密码' })).not.toBeInTheDocument();
});

const account = { id: 'u', organizationId: 'supplier-org', username: 'admin', email: null, status: 'ACTIVE', securityVersion: 7 };
const accountPage = { items: [account], canCreate: true, canReset: true, canSetStatus: true, canDelete: true };
const panelProps = { profile, organizationId: 'owner', organizationPermissions: permissions, onBound: vi.fn(), onClose: vi.fn() };

it('uses the real permanent delete with owner-profile path, target version and list refresh; trusts canDelete rather than username', async () => {
  let canDelete = true;
  const fetcher = vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (options?.method === 'DELETE') return json({ userId: 'u', deleted: true, effects: [] });
    return json({ ...accountPage, canDelete });
  });
  vi.stubGlobal('fetch', fetcher);
  const view = render(<SupplierUsersPanel {...panelProps} />);
  fireEvent.click(await screen.findByRole('button', { name: '永久删除用户' }));
  fireEvent.click(screen.getByRole('button', { name: '确认永久删除' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/v1/supplier-quality/profiles/profile-a/accounts/u?organizationId=owner', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ expectedSecurityVersion: 7 }) })));
  await waitFor(() => expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/accounts?organizationId=owner'))).toHaveLength(2));
  view.rerender(<SupplierUsersPanel {...panelProps} organizationPermissions={['supplier-quality:profiles:read']} />);
  await screen.findByText('admin', { selector: 'td' });
  expect(screen.queryByRole('button', { name: '永久删除用户' })).not.toBeInTheDocument();
  canDelete = false;
  view.rerender(<SupplierUsersPanel {...panelProps} />);
  await screen.findByText('admin', { selector: 'td' });
  expect(screen.queryByRole('button', { name: '永久删除用户' })).not.toBeInTheDocument();
});

it('propagates real delete denial through the profiles page and removes sensitive parent projections', async () => {
  const denied = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (options?.method === 'DELETE') return json({ code: 'FEATURE_PERMISSION_DENIED' }, 403);
    return json(path.includes('/accounts') ? { ...accountPage, canCreate: false, canReset: false, canSetStatus: false } : { items: [profile], total: 1 });
  }));
  render(<SupplierProfilesPage organizationId="owner" organizationPermissions={[...permissions, 'supplier-quality:profiles:read']} onDenied={denied} />);
  fireEvent.click(await screen.findByText('供应商用户账号', { selector: 'button span' }));
  fireEvent.click(await screen.findByText('永久删除用户', { selector: 'button span' }));
  fireEvent.click(screen.getByText('确认永久删除', { selector: 'button span' }));
  await waitFor(() => expect(denied).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('供应商甲')).not.toBeInTheDocument();
  expect(screen.queryByText('登记供应商资料', { selector: 'button span' })).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('respects the actual child unknown-result navigation guard when closing the outer modal', async () => {
  const onClose = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (options?.method === 'DELETE') throw new TypeError('offline');
    return json({ ...accountPage, canCreate: false, canReset: false, canSetStatus: false });
  }));
  render(<MemoryRouter><UnsavedChangesProvider><SupplierUsersPanel {...panelProps} onClose={onClose} /></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.click(await screen.findByText('永久删除用户', { selector: 'button span' }));
  fireEvent.click(screen.getByText('确认永久删除', { selector: 'button span' }));
  await screen.findByText('重试确认结果', { selector: 'button span' });
  fireEvent.click(screen.getByText(/^关\s*闭$/, { selector: 'button span' }));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByText('继续编辑', { selector: 'button span' }));
  expect(screen.getByText('重试确认结果', { selector: 'button span' })).toBeInTheDocument();
});

it('irreversibly aborts reads and CSRF-delayed writes on a synchronous principal A-B-A transition', async () => {
  useWorkTabsStore.getState().bindSession('INTERNAL:A');
  let csrf!: (response: Response) => void;
  let csrfSignal: AbortSignal | null | undefined;
  const writes: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith('/csrf')) { csrfSignal = options?.signal; return new Promise<Response>(resolve => { csrf = resolve; }); }
    if (options?.method === 'POST') { writes.push(options); return json(account); }
    return json(accountPage);
  }));
  render(<SupplierUsersPanel {...panelProps} />);
  await screen.findByText('admin', { selector: 'td' });
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'old-draft' } });
  fireEvent.click(screen.getByRole('button', { name: '创建专属协作边界并建账号' }));
  await waitFor(() => expect(csrf).toBeTypeOf('function'));
  act(() => { useWorkTabsStore.getState().bindSession('INTERNAL:B'); useWorkTabsStore.getState().bindSession('INTERNAL:A'); });
  expect(csrfSignal?.aborted).toBe(true);
  await act(async () => { csrf(json({ csrfToken: 'late' })); });
  expect(writes).toHaveLength(0);
  expect(screen.queryByLabelText('用户名')).not.toBeInTheDocument();
  expect(screen.queryByText('admin', { selector: 'td' })).not.toBeInTheDocument();
});

it('aborts an old owner-profile read and ignores its late reply after the scope changes', async () => {
  let resolve!: (response: Response) => void;
  let oldSignal: AbortSignal | null | undefined;
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    if (path.includes('profile-a')) { oldSignal = options?.signal; return new Promise<Response>(done => { resolve = done; }); }
    return json({ ...accountPage, items: [{ ...account, username: 'new-scope' }] });
  }));
  const view = render(<SupplierUsersPanel {...panelProps} />);
  await waitFor(() => expect(resolve).toBeTypeOf('function'));
  view.rerender(<SupplierUsersPanel {...panelProps} profile={{ ...profile, id: 'profile-b' }} />);
  expect(oldSignal?.aborted).toBe(true);
  await screen.findByText('new-scope', { selector: 'td' });
  await act(async () => { resolve(json(accountPage)); });
  expect(screen.queryByText('admin', { selector: 'td' })).not.toBeInTheDocument();
});
