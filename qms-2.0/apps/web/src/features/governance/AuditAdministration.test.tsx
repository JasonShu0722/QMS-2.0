import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { AuditAdministration } from './AuditAdministration';
import type { AdminOrganization } from '../admin/admin';

const organization: AdminOrganization = { id: '10000000-0000-4000-8000-000000000001', code: 'A', name: '组织 A', type: 'INTERNAL', permissions: ['audit:read'] };
const userId = '20000000-0000-4000-8000-000000000001';
const event = { id: 'event', organizationId: organization.id, actorUserId: userId, action: 'USER_UPDATED', actionLabel: '更新用户', actorSummary: { username: 'current-alice', accountType: 'INTERNAL', organizationName: organization.name }, resourceType: 'User', resourceId: userId, outcome: 'DENIED', metadata: {}, traceId: 'trace', createdAt: '2026-10-18T00:00:00Z' };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

it('applies an audit resource target to the first query and export, then resets it on a new target', async () => {
  const fetch = vi.fn(async (path: string, _init?: RequestInit) => path.endsWith('/csrf') ? json({ csrfToken: 'csrf' }) : path.endsWith('/audit-exports') ? json({ id: 'artifact', downloadPath: '/private-export', expiresAt: '2026-10-30', rowCount: 0 }) : json({ items: [], total: 0, nextCursor: null }));
  vi.stubGlobal('fetch', fetch);
  const scope = { ...organization, permissions: ['audit:read', 'audit:export'] };
  const view = render(<AuditAdministration organization={scope} target={{ resourceType: 'Organization', resourceId: userId }} />);
  await waitFor(() => expect(screen.getByRole('button', { name: /查\s*询/ })).toBeEnabled());
  expect(new URL(fetch.mock.calls[0]![0], 'http://localhost').searchParams.get('resourceId')).toBe(userId);
  expect(screen.getByLabelText('资源 ID')).toHaveValue(userId);
  await userEvent.click(screen.getByRole('button', { name: '导出筛选结果' }));
  await waitFor(() => expect(fetch.mock.calls.some(([path]) => path.endsWith('/audit-exports'))).toBe(true));
  expect(JSON.parse(fetch.mock.calls.find(([path]) => path.endsWith('/audit-exports'))![1]!.body as string)).toEqual({ organizationId: organization.id, resourceType: 'Organization', resourceId: userId });
  view.rerender(<AuditAdministration organization={scope} target={{ resourceType: 'Department', resourceId: 'new-target' }} />);
  await waitFor(() => expect(fetch.mock.calls.some(([path]) => path.includes('resourceId=new-target'))).toBe(true));
  expect(screen.getByLabelText('资源 ID')).toHaveValue('new-target');
  expect(screen.queryByRole('button', { name: '下载 CSV' })).not.toBeInTheDocument();
});

it('shows safe actor summary and Chinese action with original code, without requesting the account directory', async () => {
  const fetch = vi.fn(async (_path: string) => json({ items: [event, { ...event, id: 'missing', actorUserId: null, actorSummary: null, action: 'NEW_ACTION', actionLabel: 'NEW_ACTION' }], total: 2, nextCursor: null }));
  vi.stubGlobal('fetch', fetch);
  render(<AuditAdministration organization={organization} />);
  expect(screen.getByLabelText('动作')).toHaveAttribute('placeholder', '支持中文名称或英文关键词');
  expect(screen.getByText(`当前查询组织：${organization.name} · ${organization.code}`)).toBeVisible();
  expect(await screen.findByText('current-alice')).toBeVisible();
  expect(screen.getByText('更新用户')).toBeVisible();
  expect(screen.getByText('USER_UPDATED')).toBeVisible();
  expect(screen.getByText('未记录操作人')).toBeVisible();
  expect(screen.getAllByText('NEW_ACTION')).toHaveLength(1);
  expect(screen.queryByRole('link', { name: 'current-alice' })).not.toBeInTheDocument();
  expect(fetch.mock.calls.every(([path]) => !String(path).includes('/admin/users'))).toBe(true);
  expect(screen.queryByLabelText('资源 ID')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '更多筛选' }));
  expect(screen.getByLabelText('资源 ID')).toBeVisible();
});

it('links a summary only with account read permission in the event organization', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ items: [event], total: 1, nextCursor: null })));
  render(<AuditAdministration organization={{ ...organization, permissions: ['audit:read', 'account:users:read'] }} />);
  expect(await screen.findByRole('link', { name: 'current-alice' })).toHaveAttribute('href', `/app/admin?organizationId=${organization.id}&section=users&userId=${userId}`);
});

it('shows explicit denial without making requests when audit read permission is absent', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(<AuditAdministration organization={{ ...organization, permissions: [] }} />);
  expect(screen.getByText('无权执行此操作')).toBeVisible();
  expect(fetch).not.toHaveBeenCalled();
});

it('retains collapsed advanced filters and exports the applied query without pagination or unsubmitted edits', async () => {
  const fetch = vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'csrf' }) : path.endsWith('/audit-exports') ? json({ id: 'artifact', downloadPath: '/private-export', expiresAt: '2026-10-19', rowCount: 0 }) : json({ items: [], total: 0, nextCursor: null }));
  vi.stubGlobal('fetch', fetch);
  render(<AuditAdministration organization={{ ...organization, permissions: ['audit:read', 'audit:export'] }} />);
  await waitFor(() => expect(screen.getByRole('button', { name: /查\s*询/ })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: '更多筛选' }));
  await userEvent.type(screen.getByLabelText('资源 ID'), 'target-resource');
  await userEvent.click(screen.getByRole('button', { name: '更多筛选' }));
  await userEvent.click(screen.getByRole('button', { name: /查\s*询/ }));
  await waitFor(() => expect(fetch.mock.calls.some(([path]) => String(path).includes('resourceId=target-resource'))).toBe(true));
  await userEvent.type(screen.getByLabelText('动作'), 'UNSUBMITTED');
  await userEvent.click(screen.getByRole('button', { name: '导出筛选结果' }));
  const exported = fetch.mock.calls.find(([path]) => path.endsWith('/audit-exports'));
  expect(JSON.parse((exported as unknown as [string, RequestInit])[1].body as string)).toEqual({ organizationId: organization.id, resourceId: 'target-resource' });
});

it('clears open actor details and a late export after organization permission changes', async () => {
  let resolveExport: (value: Response) => void = () => {};
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/audit-exports')) return new Promise<Response>((resolve) => { resolveExport = resolve; });
    return json({ items: [event], total: 1, nextCursor: null });
  }));
  const view = render(<AuditAdministration organization={{ ...organization, permissions: ['audit:read', 'audit:export'] }} />);
  await userEvent.click(await screen.findByRole('button', { name: /详\s*情/ }));
  expect(within(screen.getByRole('dialog')).getAllByText(userId).length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole('button', { name: '导出筛选结果' }));
  view.rerender(<AuditAdministration organization={{ ...organization, id: 'foreign', permissions: [] }} />);
  await act(async () => resolveExport(json({ id: 'artifact', downloadPath: '/private-export', expiresAt: '2026-10-19', rowCount: 1 })));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: '下载 CSV' })).not.toBeInTheDocument();
  expect(screen.queryByText('current-alice')).not.toBeInTheDocument();
});
