import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { UserAdministration } from './UserAdministration';
import type { AdminOrganization } from './admin';
import { openUserManagement } from './user-management-test-helpers';

afterEach(() => vi.unstubAllGlobals());
it('lets a structure reader see complete appointments without directory, role or mutation calls', async () => {
  const organization: AdminOrganization = { id: 'org', code: 'O', name: 'Organization', type: 'INTERNAL', permissions: ['account:users:read', 'organization:structure:read'] };
  const reads: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    reads.push(path);
    const value = path.includes('/users/u1/positions?') ? [{ id: 'a1', positionId: 'p1', startedAt: '2020-01-01', endedAt: null, position: { name: 'Full appointment' } }] : [{ id: 'u1', username: 'alice', accountType: 'INTERNAL', status: 'ACTIVE', organizationId: 'org', organization: { name: 'Organization' } }];
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  }));
  render(<MemoryRouter><UserAdministration organization={organization} organizations={[organization]} /></MemoryRouter>);
  const manager = await openUserManagement('任职与授权', (await screen.findByText('管理用户', { selector: 'button > span' })).closest('button')!);
  fireEvent.click(manager.getByRole('button', { name: '查看任职' }));
  const detail = within(await screen.findByRole('dialog', { name: 'alice · 用户任职' }));
  expect(await detail.findByText('Full appointment')).toBeInTheDocument();
  expect(detail.queryByRole('button', { name: '保存任职' })).not.toBeInTheDocument();
  expect(reads.filter(path => path.includes('/roles') || path.includes('/departments') || path.includes('/organizations/org/positions'))).toEqual([]);
});
