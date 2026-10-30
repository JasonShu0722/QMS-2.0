import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { AuthorizationSources } from './AuthorizationSources';
import type { AdminOrganization } from '../admin/admin';

const organization: AdminOrganization = { id: 'org', name: '组织', code: 'ORG', type: 'INTERNAL', permissions: ['account:roles:read', 'organization:structure:read', 'account:users:read'] };
const role: components['schemas']['LegacyAuthorizationRoleDto'] = { id: 'role', organizationId: 'org', name: '旧授权', code: 'OLD', mfaRequired: true, permissionCodes: ['organization:read'], platformMarker: false };
const kinds = ['POSITION_CANONICAL', 'LEGACY_MAPPING', 'LEGACY_DIRECT', 'SYSTEM_INITIALIZATION'] as const;
const result: components['schemas']['LegacyAuthorizationSourcesDto'] = {
  currentSources: { items: kinds.map((kind, index) => ({ organizationId: 'org', userId: 'user', positionId: index < 2 ? 'position' : null, assignmentId: `a-${index}`, startedAt: null, endedAt: null, temporalState: 'CURRENT', kind, active: true, role })), total: 21, offset: 0, pageSize: 20 },
  history: { items: [], total: 0, offset: 0, pageSize: 20 },
  labels: { users: [{ id: 'user', organizationId: 'org', username: 'zhang', fullName: '张工', status: 'ACTIVE', unavailable: false }], positions: [{ id: 'position', organizationId: 'org', departmentId: null, department: null, code: 'ADMIN', name: '直属岗', status: 'ACTIVE', version: 1, roleVersion: 1, unavailable: false }], organizations: [{ id: 'org', code: 'ORG', name: '组织' }] },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

it('reads an exact user scope and distinguishes all four actual sources without inferring initialization from role names', async () => {
  const fetcher = vi.fn(async (_path: string) => json(result)); vi.stubGlobal('fetch', fetcher);
  render(<MemoryRouter><AuthorizationSources organization={organization} userId="user" /></MemoryRouter>);
  expect(await screen.findByText('岗位自有权限')).toBeVisible();
  expect(screen.getByText('兼容岗位映射')).toBeVisible(); expect(screen.getByText('兼容直接授权')).toBeVisible(); expect(screen.getByText('系统初始化来源')).toBeVisible();
  expect(screen.getAllByText(/zhang/).length).toBeGreaterThan(0); expect(screen.getAllByText(/直属岗/).length).toBeGreaterThan(0);
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/organizations/org/authorization-sources?userId=user&pageSize=20&offset=0');
});

it('paginates current sources independently of history and never presents a failed page as zero', async () => {
  const fetcher = vi.fn(async (path: string) => path.includes('offset=20') ? json({ code: 'FAILED', message: 'failed' }, 500) : json(result)); vi.stubGlobal('fetch', fetcher);
  render(<MemoryRouter><AuthorizationSources organization={organization} positionId="position" /></MemoryRouter>);
  await screen.findByText('岗位自有权限'); fireEvent.click(screen.getByRole('button', { name: '当前来源下一页' }));
  await waitFor(() => expect(fetcher.mock.calls.some(([path]) => path.includes('positionId=position') && path.includes('offset=20'))).toBe(true));
  expect(await screen.findByText('请求被拒绝，请检查权限和填写内容后重试')).toBeVisible(); expect(screen.queryByText('暂无授权来源')).not.toBeInTheDocument();
});

it.each([{ ...organization, permissions: [] }, organization])('does not issue a read without permission or with both subject selectors (%j)', async org => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  render(<MemoryRouter><AuthorizationSources organization={org} userId="user" positionId={org.permissions.length ? 'position' : undefined} /></MemoryRouter>);
  expect(await screen.findByRole('alert')).toBeVisible(); expect(fetcher).not.toHaveBeenCalled();
});

it('aborts obsolete subject reads and does not render a late response after switching subjects', async () => {
  let resolve!: (response: Response) => void; let signal: AbortSignal | null | undefined;
  vi.stubGlobal('fetch', vi.fn((path: string, init?: RequestInit) => path.includes('userId=user&') ? (signal = init?.signal, new Promise<Response>(r => { resolve = r; })) : Promise.resolve(json({ ...result, currentSources: { ...result.currentSources, items: [], total: 0 } }))));
  const view = render(<MemoryRouter><AuthorizationSources organization={organization} userId="user" /></MemoryRouter>);
  await waitFor(() => expect(signal).toBeDefined());
  view.rerender(<MemoryRouter><AuthorizationSources organization={organization} userId="other" /></MemoryRouter>);
  expect(signal?.aborted).toBe(true); await act(async () => resolve(json(result)));
  expect(await screen.findByText('暂无授权来源')).toBeVisible(); expect(screen.queryByText('旧授权')).not.toBeInTheDocument();
});

it('shows unavailable historical labels without substituting current names and pages history separately', async () => {
  const history: components['schemas']['LegacyAuthorizationHistoryDto'] = { archiveId: 'archive', organizationId: 'org', roleId: 'role', actorUserId: 'user', operation: 'REMOVE', createdAt: '2026-10-01T00:00:00Z', state: 'HISTORICAL', role, directSources: [], mappedSources: [], target: null, retainedSourceCount: null, labels: null, labelsUnavailable: true };
  const fetcher = vi.fn(async (_path: string) => json({ ...result, history: { items: [history], total: 21, offset: 0, pageSize: 20 } })); vi.stubGlobal('fetch', fetcher);
  render(<MemoryRouter><AuthorizationSources organization={organization} userId="user" /></MemoryRouter>);
  expect(await screen.findByText('历史标签不可用，不以当前名称替代历史事实。')).toBeVisible();
  const historical = screen.getByText('历史标签不可用，不以当前名称替代历史事实。').closest('article')!;
  expect(historical.textContent).not.toContain('zhang'); expect(historical.textContent).toContain('名称不可用');
  fireEvent.click(screen.getByRole('button', { name: '解除历史下一页' }));
  await waitFor(() => expect(fetcher.mock.calls.some(([path]) => path.endsWith('offset=20'))).toBe(true));
});

it('clears sensitive source facts on 403 and invokes the current parent refusal callback', async () => {
  const onDenied = vi.fn(); const fetcher = vi.fn(async () => json({ code: 'DENIED', message: 'denied' }, 403)); vi.stubGlobal('fetch', fetcher);
  render(<MemoryRouter><AuthorizationSources organization={organization} userId="user" onDenied={onDenied} /></MemoryRouter>);
  expect(await screen.findByText('无授权来源读取权限或对象范围无效')).toBeVisible(); expect(onDenied).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('旧授权')).not.toBeInTheDocument();
});
