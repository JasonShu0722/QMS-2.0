import { render, screen, waitFor } from '@testing-library/react';
import baseUserEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RoleAdministration } from './RoleAdministration';
import type { AdminOrganization, AdminRole } from './admin';

const organization: AdminOrganization = { id: 'org-a', code: 'a', name: 'Organization A', type: 'INTERNAL', permissions: ['account:roles:read', 'account:roles:delete'] };
const role: AdminRole = { id: 'role-a', code: 'READER', name: 'Reader Role', organizationId: organization.id, mfaRequired: false, permissions: [] };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

it('requires confirmation for the named role and sends no delete when cancelled', async () => {
  const user = baseUserEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
  const deletes: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init.method === 'DELETE') { deletes.push(path); return new Response(null, { status: 204 }); }
    return json(path.includes('/permission-catalog') ? [] : [role]);
  }));
  render(<RoleAdministration organization={organization} />);

  await user.click(await screen.findByRole('button', { name: '删除角色' }));
  expect(deletes).toEqual([]);
  const cancel = await screen.findByRole('button', { name: /^取\s*消$/ });
  expect(screen.getAllByText(/Reader Role/).length).toBeGreaterThan(1);
  await user.click(cancel);
  expect(deletes).toEqual([]);

  await user.click(screen.getByRole('button', { name: '删除角色' }));
  await user.click(await screen.findByRole('button', { name: /^删\s*除$/ }));
  await waitFor(() => expect(deletes).toEqual(['/api/v1/admin/roles/role-a?organizationId=org-a']));
});
