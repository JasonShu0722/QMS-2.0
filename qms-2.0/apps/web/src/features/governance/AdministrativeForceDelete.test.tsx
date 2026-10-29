import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import type { AdminOrganization } from '../admin/admin';
import { OrganizationAdministration } from './OrganizationAdministration';
import { StructureAdministration } from './StructureAdministration';
import { AdministrativeForceDeleteDialog } from './AdministrativeForceDeleteDialog';
import { registerReauthentication } from '../../api/client';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

const organization: AdminOrganization = { id: 'org-a', code: 'A', name: '甲组织', type: 'INTERNAL', permissions: ['organization:read', 'organization:manage', 'organization:structure:read', 'organization:structure:manage', 'organization:force-delete', 'organization:departments:force-delete'] };
const record: components['schemas']['OrganizationDto'] = { id: organization.id, name: organization.name, code: organization.code, type: 'INTERNAL', status: 'ACTIVE', version: 2, parentId: null };
const department: components['schemas']['DepartmentDto'] = { id: 'dept-a', organizationId: organization.id, name: '质量科', code: 'QA', status: 'ACTIVE', version: 3, parentId: null };
const preview: components['schemas']['OrganizationForceDeletePreviewDto'] = { kind: 'ORGANIZATION', id: record.id, name: record.name, code: record.code, version: 4, previewToken: 'live-impact-token', counts: { users: 2, departments: 3, positions: 4, organizations: 1, assignments: 5, managementBindings: 6, ministerScopes: 7 }, retainedHistory: ['原租户归属', '审批及签署历史'] };
const result = (value = preview): components['schemas']['OrganizationForceDeleteResultDto'] => ({ ...value, deletedAt: '2026-10-28T12:00:00.000Z', effects: [{ module: 'workflow', changed: 2, pendingConfiguration: 1 }] });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const path = '/api/v1/organizations/org-a/force-delete';
const changed = vi.fn();
const denied = vi.fn();
function Location() { return <span data-testid="location">{useLocation().pathname}</span>; }
function view(org = organization, item = record) {
  return <MemoryRouter><ConfigProvider theme={{ token: { motion: false } }}><UnsavedChangesProvider><Location /><OrganizationAdministration organization={org} organizations={[org]} items={[item]} onChanged={changed} onDenied={denied} /></UnsavedChangesProvider></ConfigProvider></MemoryRouter>;
}
function api(handler?: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (handler) return handler(url, init);
    return json(init.method === 'POST' ? result() : preview);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const posts = (mock: ReturnType<typeof api>) => mock.mock.calls.filter(([, init]) => init?.method === 'POST');
async function open() {
  await userEvent.click(await screen.findByRole('button', { name: '强制删除' }));
  const dialog = within(await screen.findByRole('dialog'));
  await waitFor(() => expect(dialog.getByRole('button', { name: '确认强制删除' })).toBeEnabled());
  return dialog;
}
beforeEach(() => { vi.stubEnv('NODE_ENV', 'development'); useWorkTabsStore.getState().bindSession('INTERNAL:actor:home'); changed.mockClear(); denied.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); localStorage.clear(); useWorkTabsStore.getState().reset(); });

it('uses one live impact confirmation and the preview version/token, not the old dependency delete', async () => {
  const fetchMock = api(); render(view());
  const dialog = await open();
  expect(fetchMock.mock.calls.some(([url]) => url === path)).toBe(true);
  expect(dialog.getByText(/不连带删除下级组织、子部门、岗位或账号/)).toBeInTheDocument();
  expect(dialog.getByText(/业务、审批、签署和审计历史保留/)).toBeInTheDocument();
  expect(dialog.getByText('审批及签署历史')).toBeInTheDocument();
  for (const label of ['账号', '部门/科室', '岗位', '组织（含目标）', '任职', '管理职责', '分管范围']) expect(dialog.getByText(label)).toBeInTheDocument();
  expect(dialog.queryByRole('textbox')).not.toBeInTheDocument();
  expect(posts(fetchMock)).toHaveLength(0);
  await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(posts(fetchMock)).toHaveLength(1);
  expect(posts(fetchMock)[0]).toMatchObject([path, { method: 'POST', body: JSON.stringify({ expectedVersion: 4, confirmed: true, previewToken: preview.previewToken }), headers: { 'x-csrf-token': 'csrf', 'Idempotency-Key': expect.any(String) } }]);
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/lifecycle'))).toBe(false);
});

it('does not infer force capability from ordinary manage, another marker, or an admin-looking organization name', () => {
  api();
  render(view({ ...organization, name: 'admin', permissions: ['organization:manage', 'platform:admin', 'organization:departments:force-delete'] }));
  expect(screen.queryByRole('button', { name: '强制删除' })).not.toBeInTheDocument();
});

it('exposes the explicit organization force capability independently of ordinary manage', async () => {
  api(); render(view({ ...organization, permissions: ['organization:read', 'organization:force-delete'] }));
  await open();
});

it.each([true, false])('uses one organization deletion entry while preserving status actions (force=%s)', force => {
  const fetchMock = api();
  render(view({ ...organization, permissions: ['organization:read', 'organization:manage', ...(force ? ['organization:force-delete'] : [])] }));
  expect(screen.getByRole('button', { name: /^停\s*用$/ })).toBeEnabled();
  if (force) {
    expect(screen.getByRole('button', { name: '强制删除' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^删\s*除$/ })).not.toBeInTheDocument();
  } else {
    expect(screen.getByRole('button', { name: /^删\s*除$/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '强制删除' })).not.toBeInTheDocument();
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([200, 403])('irreversibly invalidates a preview across batched session ABA before its late %s', async status => {
  const read = deferred<Response>(); let signal: AbortSignal | null | undefined;
  const fetchMock = api((_url, init) => { signal = init.signal; return read.promise; });
  render(view());
  await userEvent.click(screen.getByRole('button', { name: '强制删除' }));
  act(() => { useWorkTabsStore.getState().bindSession('INTERNAL:other:home'); useWorkTabsStore.getState().bindSession('INTERNAL:actor:home'); });
  await act(async () => read.resolve(status === 200 ? json(preview) : json({ code: 'FEATURE_PERMISSION_DENIED' }, status)));
  expect(signal?.aborted).toBe(true);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText('审批及签署历史')).not.toBeInTheDocument();
  expect(posts(fetchMock)).toHaveLength(0);
  expect(denied).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
});

it.each([200, 403])('irreversibly invalidates a submitted command across batched session ABA before its late %s', async status => {
  const command = deferred<Response>(); let signal: AbortSignal | null | undefined;
  const fetchMock = api((_url, init) => { if (init.method === 'POST') { signal = init.signal; return command.promise; } return json(preview); });
  render(view()); const dialog = await open();
  await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
  await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
  act(() => { useWorkTabsStore.getState().bindSession('INTERNAL:other:home'); useWorkTabsStore.getState().bindSession('INTERNAL:actor:home'); });
  await act(async () => command.resolve(status === 200 ? json(result()) : json({ code: 'FEATURE_PERMISSION_DENIED' }, status)));
  expect(signal?.aborted).toBe(true);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
  expect(denied).not.toHaveBeenCalled();
  expect(posts(fetchMock)).toHaveLength(1);
});

it('cannot send a late POST after batched session ABA while waiting for CSRF', async () => {
  const token = deferred<Response>(); let signal: AbortSignal | null | undefined;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (String(input).endsWith('/csrf')) { signal = init.signal; return token.promise; }
    return json(init.method === 'POST' ? result() : preview);
  });
  vi.stubGlobal('fetch', fetchMock); render(view()); const dialog = await open();
  await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
  await waitFor(() => expect(signal).toBeDefined());
  act(() => { useWorkTabsStore.getState().bindSession('INTERNAL:other:home'); useWorkTabsStore.getState().bindSession('INTERNAL:actor:home'); });
  await act(async () => token.resolve(json({ csrfToken: 'old-token' })));
  expect(signal?.aborted).toBe(true);
  expect(posts(fetchMock)).toHaveLength(0);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
});

it.each([401, 403])('bubbles a current organization preview %s through onDenied to invalidate parent management', async status => {
  const fetchMock = api(() => json({ code: 'FEATURE_PERMISSION_DENIED' }, status));
  render(view());
  await userEvent.click(screen.getByRole('button', { name: '强制删除' }));
  await waitFor(() => expect(denied).toHaveBeenCalledOnce());
  expect(denied).toHaveBeenCalledWith(expect.objectContaining({ status, code: 'FEATURE_PERMISSION_DENIED' }));
  expect(posts(fetchMock)).toHaveLength(0);
  expect(screen.queryByText('审批及签署历史')).not.toBeInTheDocument();
});

it.each([401, 403])('clears impact and bubbles a current organization command %s through onDenied', async status => {
  api((_url, init) => init.method === 'POST' ? json({ code: 'FEATURE_PERMISSION_DENIED' }, status) : json(preview));
  render(view()); const dialog = await open();
  await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
  await waitFor(() => expect(denied).toHaveBeenCalledOnce());
  expect(denied).toHaveBeenCalledWith(expect.objectContaining({ status }));
  expect(screen.queryByText('审批及签署历史')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '重试确认结果' })).not.toBeInTheDocument();
});

it('bubbles a CSRF 403 refusal instead of keeping the parent authorization context alive', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/csrf') ? json({ code: 'FEATURE_PERMISSION_DENIED' }, 403) : json(preview));
  vi.stubGlobal('fetch', fetchMock); render(view()); const dialog = await open();
  await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
  await waitFor(() => expect(denied).toHaveBeenCalledOnce());
  expect(denied).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  expect(screen.queryByText('审批及签署历史')).not.toBeInTheDocument();
  expect(posts(fetchMock)).toHaveLength(0);
});

it('bubbles a department denial through StructureAdministration onDenied', async () => {
  api((url) => url.includes('/force-delete') ? json({ code: 'FEATURE_PERMISSION_DENIED' }, 403) : json([]));
  render(<MemoryRouter><ConfigProvider theme={{ token: { motion: false } }}><StructureAdministration organization={organization} workspace={{ departments: [department], departmentId: department.id, onRefresh: vi.fn(), onChanged: changed }} onDenied={denied} /></ConfigProvider></MemoryRouter>);
  await userEvent.click(await screen.findByRole('button', { name: '强制删除' }));
  await waitFor(() => expect(denied).toHaveBeenCalledOnce());
  expect(denied).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
});

it('performs the selected department GET/POST with its own marker and no cascading child deletion', async () => {
  const value = { ...preview, kind: 'DEPARTMENT' as const, id: department.id, name: department.name, code: department.code };
  const fetchMock = api((url, init) => json(url.includes('/force-delete') ? init.method === 'POST' ? result(value) : value : []));
  render(<MemoryRouter><ConfigProvider theme={{ token: { motion: false } }}><StructureAdministration organization={organization} workspace={{ departments: [department], departmentId: department.id, onRefresh: vi.fn(), onChanged: changed }} /></ConfigProvider></MemoryRouter>);
  const dialog = await open();
  await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(posts(fetchMock)[0][0]).toBe('/api/v1/organizations/org-a/departments/dept-a/force-delete');
});

it('replays exactly the original unknown command/key without another preview or silent submission', async () => {
  let count = 0;
  const fetchMock = api((_url, init) => {
    if (init.method === 'POST' && ++count === 1) throw new TypeError('response lost');
    return json(init.method === 'POST' ? result() : preview);
  });
  render(view()); const dialog = await open();
  await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
  const retry = await dialog.findByRole('button', { name: '重试确认结果' });
  expect(posts(fetchMock)).toHaveLength(1);
  expect(dialog.getByRole('button', { name: '确认强制删除' })).toBeDisabled();
  await userEvent.click(retry);
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(posts(fetchMock)).toHaveLength(2);
  expect(posts(fetchMock)[0][1]?.body).toBe(posts(fetchMock)[1][1]?.body);
  expect(posts(fetchMock)[0][1]?.headers).toEqual(posts(fetchMock)[1][1]?.headers);
  expect(fetchMock.mock.calls.filter(([url]) => url === path)).toHaveLength(3);
});

it('refreshes a 409 preview and waits for explicit reconfirmation with the new version and token', async () => {
  let reads = 0; let writes = 0;
  const fresh = { ...preview, version: 8, previewToken: 'new-impact-token', counts: { ...preview.counts, users: 9 } };
  const fetchMock = api((_url, init) => init.method === 'POST' ? ++writes === 1 ? json({ code: 'CONCURRENCY_CONFLICT' }, 409) : json(result(fresh)) : json(++reads === 1 ? preview : fresh));
  render(view()); const dialog = await open();
  await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
  await dialog.findByText(/影响已变化/);
  await waitFor(() => expect(reads).toBe(2));
  await waitFor(() => expect(dialog.getByRole('button', { name: '确认强制删除' })).toBeEnabled());
  expect(posts(fetchMock)).toHaveLength(1);
  await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(JSON.parse(posts(fetchMock)[1][1]!.body as string)).toEqual({ expectedVersion: 8, confirmed: true, previewToken: fresh.previewToken });
  expect((posts(fetchMock)[0][1]!.headers as Record<string, string>)['Idempotency-Key']).not.toBe((posts(fetchMock)[1][1]!.headers as Record<string, string>)['Idempotency-Key']);
});

it.each((['transport', 503] as const).flatMap(initialFailure => ([400, 422, 429, 'reauth'] as const).map(recoveryFailure => ({ initialFailure, recoveryFailure }))))('preserves an original $initialFailure-unknown command through recovery $recoveryFailure and subsequent explicit retry', async ({ initialFailure, recoveryFailure }) => {
  let tokens = 0; let writes = 0;
  const unregister = registerReauthentication(vi.fn(async () => {}));
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (String(input).endsWith('/csrf')) {
      tokens++;
      if (tokens === 2 && recoveryFailure !== 'reauth') return json({ code: 'RECOVERY_CSRF_REFUSED' }, recoveryFailure);
      return json({ csrfToken: 'csrf' });
    }
    if (init.method !== 'POST') return json(preview);
    if (++writes === 1) {
      if (initialFailure === 'transport') throw new TypeError('first response lost');
      return json({ code: 'UNKNOWN_SERVER_OUTCOME' }, initialFailure);
    }
    if (writes === 2 && recoveryFailure === 'reauth') return json({ code: 'AUTH_REAUTHENTICATION_REQUIRED' }, 403);
    return json(result());
  });
  vi.stubGlobal('fetch', fetchMock);
  try {
    render(view()); const dialog = await open();
    await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
    await userEvent.click(await dialog.findByRole('button', { name: '重试确认结果' }));
    await waitFor(() => expect(dialog.getByRole('button', { name: '重试确认结果' })).toBeEnabled());
    expect(changed).not.toHaveBeenCalled();
    expect(denied).not.toHaveBeenCalled();
    expect(posts(fetchMock)).toHaveLength(recoveryFailure === 'reauth' ? 2 : 1);
    await userEvent.click(dialog.getByRole('button', { name: '重试确认结果' }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    const commands = posts(fetchMock);
    expect(commands).toHaveLength(recoveryFailure === 'reauth' ? 3 : 2);
    for (const [, init] of commands) {
      expect(init?.body).toBe(commands[0][1]?.body);
      expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBe((commands[0][1]?.headers as Record<string, string>)['Idempotency-Key']);
    }
    expect(JSON.parse(commands[0][1]!.body as string)).toEqual({ expectedVersion: preview.version, confirmed: true, previewToken: preview.previewToken });
    expect(fetchMock.mock.calls.filter(([url, init]) => url === path && init?.method !== 'POST')).toHaveLength(1);
  } finally { unregister(); }
});

it('treats the first 400 as a validation refusal, not an unknown committed command', async () => {
  const fetchMock = api((_url, init) => init.method === 'POST' ? json({ code: 'VALIDATION_FAILED' }, 400) : json(preview));
  render(view()); const dialog = await open();
  await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
  await dialog.findByText('请检查填写内容');
  expect(dialog.queryByRole('button', { name: '重试确认结果' })).not.toBeInTheDocument();
  expect(dialog.getByRole('button', { name: '确认强制删除' })).toBeDisabled();
  expect(posts(fetchMock)).toHaveLength(1);
});

it.each([false, true])('requires explicit reconciliation after a malformed 2xx result (recovering=%s), never a new command', async recovering => {
  let writes = 0;
  const fetchMock = api((_url, init) => {
    if (init.method !== 'POST') return json(preview);
    if (++writes === 1 && recovering) throw new TypeError('first response lost');
    return json(preview);
  });
  render(view()); const dialog = await open();
  await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
  if (recovering) await userEvent.click(await dialog.findByRole('button', { name: '重试确认结果' }));
  await dialog.findByText('删除响应无法核对，请刷新管理目录核对实际状态，勿重新提交。');
  expect(changed).not.toHaveBeenCalled();
  expect(dialog.queryByRole('button', { name: '重试确认结果' })).not.toBeInTheDocument();
  expect(dialog.getByRole('button', { name: '重新读取影响' })).toBeDisabled();
  expect(dialog.getByRole('button', { name: '确认强制删除' })).toBeDisabled();
  await userEvent.click(dialog.getByRole('button', { name: /取\s*消/ }));
  expect(screen.getByRole('button', { name: '强制删除' })).toBeDisabled();
  expect(posts(fetchMock)).toHaveLength(recovering ? 2 : 1);
});

it.each([401, 403])('clears sensitive impact details after a %s mutation refusal', async status => {
  const fetchMock = api((_url, init) => init.method === 'POST' ? json({ code: status === 401 ? 'AUTH_SESSION_REQUIRED' : 'FEATURE_PERMISSION_DENIED' }, status) : json(preview));
  render(view()); const dialog = await open();
  await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
  await waitFor(() => expect(screen.queryByText('审批及签署历史')).not.toBeInTheDocument());
  expect(posts(fetchMock)).toHaveLength(1);
  expect(screen.queryByRole('button', { name: '重试确认结果' })).not.toBeInTheDocument();
  if (status === 401) await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
  else expect(dialog.getByRole('button', { name: '确认强制删除' })).toBeDisabled();
});

it('never automatically replays a force command after reauthentication and requires a fresh preview', async () => {
  const reauthenticate = vi.fn(async () => {});
  const unregister = registerReauthentication(reauthenticate);
  try {
    const fetchMock = api((_url, init) => init.method === 'POST' ? json({ code: 'AUTH_REAUTHENTICATION_REQUIRED' }, 403) : json(preview));
    render(view()); const dialog = await open();
    await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
    await waitFor(() => expect(reauthenticate).toHaveBeenCalledOnce());
    await waitFor(() => expect(dialog.getByRole('button', { name: '确认强制删除' })).toBeDisabled());
    expect(posts(fetchMock)).toHaveLength(1);
    expect(dialog.queryByRole('button', { name: '重试确认结果' })).not.toBeInTheDocument();
    expect(dialog.queryByText('审批及签署历史')).not.toBeInTheDocument();
  } finally { unregister(); }
});

it('drops old scope previews and commands, even when the late preview ignores abort', async () => {
  const read = deferred<Response>(); const fetchMock = api(() => read.promise);
  const mounted = render(view());
  await userEvent.click(screen.getByRole('button', { name: '强制删除' }));
  mounted.rerender(view({ ...organization, id: 'org-b', name: '乙组织' }, { ...record, id: 'org-b', name: '乙组织' }));
  await act(async () => read.resolve(json(preview)));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(posts(fetchMock)).toHaveLength(0);
});

it('aborts an old scope command during its CSRF read so no late POST is sent', async () => {
  const token = deferred<Response>();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => String(input).endsWith('/csrf') ? token.promise : json(init.method === 'POST' ? result() : preview));
  vi.stubGlobal('fetch', fetchMock);
  const mounted = render(view()); const dialog = await open();
  await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/csrf'))).toBe(true));
  mounted.rerender(view({ ...organization, id: 'org-b' }, { ...record, id: 'org-b' }));
  await act(async () => token.resolve(json({ csrfToken: 'old-token' })));
  expect(posts(fetchMock)).toHaveLength(0);
});

it('clears an unknown attempt on session change, without allowing it to be replayed by the next actor', async () => {
  const fetchMock = api((_url, init) => { if (init.method === 'POST') throw new TypeError('lost'); return json(preview); });
  render(view()); const dialog = await open();
  await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
  await dialog.findByRole('button', { name: '重试确认结果' });
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:another-actor:home'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(posts(fetchMock)).toHaveLength(1);
});

it('freezes duplicate submissions, cancellation and navigation while the mutation is busy', async () => {
  const command = deferred<Response>(); const fetchMock = api((_url, init) => init.method === 'POST' ? command.promise : json(preview));
  render(view()); const dialog = await open();
  const confirm = dialog.getByRole('button', { name: '确认强制删除' });
  fireEvent.click(confirm); fireEvent.click(confirm);
  await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
  expect(confirm).toBeDisabled();
  expect(dialog.getByRole('button', { name: /取\s*消/ })).toBeDisabled();
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  await act(async () => command.resolve(json(result())));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
});

it('guards a dirty editor before reading a force preview and cancelling leaves the draft intact', async () => {
  const fetchMock = api(); render(view());
  await userEvent.click(screen.getByRole('button', { name: /^编\s*辑$/ }));
  const editor = within(await screen.findByRole('dialog'));
  fireEvent.change(editor.getByRole('textbox', { name: '名称' }), { target: { value: '未保存名称' } });
  await userEvent.click(screen.getByRole('button', { name: '强制删除' }));
  const guard = await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' });
  await userEvent.click(within(guard).getByRole('button', { name: '继续编辑' }));
  expect(editor.getByRole('textbox', { name: '名称' })).toHaveValue('未保存名称');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('closes a live preview when the parent true-context filter withdraws the exact force capability', async () => {
  const fetchMock = api();
  const mounted = render(view());
  await open();
  mounted.rerender(view({ ...organization, permissions: organization.permissions.filter(code => code !== 'organization:force-delete') }));
  expect(screen.queryByRole('button', { name: '强制删除' })).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText('审批及签署历史')).not.toBeInTheDocument();
  expect(posts(fetchMock)).toHaveLength(0);
});

it('does not reuse the organization permission for a department action', async () => {
  api(() => json([]));
  render(<MemoryRouter><StructureAdministration organization={{ ...organization, permissions: ['organization:structure:read', 'organization:structure:manage', 'organization:force-delete'] }} workspace={{ departments: [department], departmentId: department.id, onRefresh: vi.fn(), onChanged: changed }} /></MemoryRouter>);
  await screen.findAllByText(department.name);
  expect(screen.queryByRole('button', { name: '强制删除' })).not.toBeInTheDocument();
});

it('offers department force deletion from the unselected department list without requiring ordinary manage', async () => {
  const value = { ...preview, kind: 'DEPARTMENT' as const, id: department.id, name: department.name, code: department.code };
  const fetchMock = api((url, init) => json(url.includes('/force-delete') ? init.method === 'POST' ? result(value) : value : url.includes('/departments?') ? [department] : []));
  render(<MemoryRouter><ConfigProvider theme={{ token: { motion: false } }}><StructureAdministration organization={{ ...organization, permissions: ['organization:structure:read', 'organization:departments:force-delete'] }} /></ConfigProvider></MemoryRouter>);
  const dialog = await open();
  await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
  await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
  expect(posts(fetchMock)[0][0]).toBe('/api/v1/organizations/org-a/departments/dept-a/force-delete');
});

it.each([401, 403])('does not expose sensitive impact or permit a write after a %s preview refusal', async status => {
  const fetchMock = api(() => json({ code: 'FEATURE_PERMISSION_DENIED' }, status));
  render(view());
  await userEvent.click(screen.getByRole('button', { name: '强制删除' }));
  if (status === 401) await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
  else {
    const dialog = within(await screen.findByRole('dialog'));
    await dialog.findAllByRole('alert');
    expect(dialog.getByRole('button', { name: '确认强制删除' })).toBeDisabled();
  }
  expect(screen.queryByText('审批及签署历史')).not.toBeInTheDocument();
  expect(posts(fetchMock)).toHaveLength(0);
});

it.each(['id', 'kind'] as const)('rejects a preview from the wrong %s instead of preparing a command', async field => {
  const fetchMock = api(() => json({ ...preview, [field]: field === 'id' ? 'org-b' : 'DEPARTMENT' }));
  render(view());
  await userEvent.click(screen.getByRole('button', { name: '强制删除' }));
  const dialog = within(await screen.findByRole('dialog'));
  await dialog.findAllByRole('alert');
  expect(dialog.getByRole('button', { name: '确认强制删除' })).toBeDisabled();
  expect(dialog.queryByText('审批及签署历史')).not.toBeInTheDocument();
  expect(posts(fetchMock)).toHaveLength(0);
});

it('does not keep a stale preview when the 409 refresh fails', async () => {
  let read = 0;
  const fetchMock = api((_url, init) => init.method === 'POST' ? json({ code: 'CONCURRENCY_CONFLICT' }, 409) : ++read === 1 ? json(preview) : json({ code: 'UNAVAILABLE' }, 503));
  render(view()); const dialog = await open();
  await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
  await waitFor(() => expect(read).toBe(2));
  await dialog.findAllByRole('alert');
  expect(dialog.getByRole('button', { name: '确认强制删除' })).toBeDisabled();
  expect(dialog.queryByText('审批及签署历史')).not.toBeInTheDocument();
  expect(posts(fetchMock)).toHaveLength(1);
});

it('clears sensitive impact and the original unknown attempt when its exact permission is revoked', async () => {
  const fetchMock = api((_url, init) => { if (init.method === 'POST') throw new TypeError('lost'); return json(preview); });
  const mounted = render(view()); const dialog = await open();
  await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
  await dialog.findByRole('button', { name: '重试确认结果' });
  mounted.rerender(view({ ...organization, permissions: ['organization:manage'] }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '强制删除' })).not.toBeInTheDocument();
  expect(posts(fetchMock)).toHaveLength(1);
});

it('ignores a late successful result after switching scope instead of refreshing the new target', async () => {
  const command = deferred<Response>(); const fetchMock = api((_url, init) => init.method === 'POST' ? command.promise : json(preview));
  const mounted = render(view()); const dialog = await open();
  await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
  await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
  mounted.rerender(view({ ...organization, id: 'org-b' }, { ...record, id: 'org-b' }));
  await act(async () => command.resolve(json(result())));
  expect(changed).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('the reusable dialog returns the generated effects result and cancelling or Escape never writes', async () => {
  const fetchMock = api(); const deleted = vi.fn();
  render(<MemoryRouter><ConfigProvider theme={{ token: { motion: false } }}><AdministrativeForceDeleteDialog path={path} kind="ORGANIZATION" target={record} scopeKey={organization.id} allowed onDeleted={deleted} /></ConfigProvider></MemoryRouter>);
  const dialog = await open();
  await userEvent.click(dialog.getByRole('button', { name: /取\s*消/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const next = await open();
  fireEvent.keyDown(next.getByRole('button', { name: '确认强制删除' }), { key: 'Escape', code: 'Escape', keyCode: 27 });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(posts(fetchMock)).toHaveLength(0);
  const confirmed = await open();
  await userEvent.click(confirmed.getByRole('button', { name: '确认强制删除' }));
  await waitFor(() => expect(deleted).toHaveBeenCalledWith(result()));
});

it('discards a confirmed dirty editor before opening a single force preview, then releases the dirty guard', async () => {
  const fetchMock = api(); render(view());
  const panel = within(screen.getByRole('region', { name: '组织基本信息' }));
  const trigger = panel.getByRole('button', { name: '强制删除' });
  await userEvent.click(panel.getByRole('button', { name: /^编\s*辑$/ }));
  const editor = await screen.findByRole('dialog');
  fireEvent.change(within(editor).getByLabelText('名称'), { target: { value: '未保存名称' } });
  await userEvent.click(trigger);
  const guard = await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' });
  await userEvent.click(within(guard).getByRole('button', { name: /^放弃修改$/ }));
  const dialog = await screen.findByRole('dialog', { name: /强制删除/ });
  await waitFor(() => expect(within(dialog).getByRole('button', { name: '确认强制删除' })).toBeEnabled());
  expect(editor).not.toBeVisible();
  await userEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
  await waitFor(() => expect(dialog).not.toBeVisible());
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
  expect(posts(fetchMock)).toHaveLength(0);
  expect(fetchMock.mock.calls.filter(([url]) => url === path)).toHaveLength(1);
});

it('can reopen after cancelling a pending preview, and ignores the cancelled late response', async () => {
  const first = deferred<Response>(); let reads = 0;
  const fetchMock = api((_url, init) => init.method === 'POST' ? json(result()) : ++reads === 1 ? first.promise : json(preview));
  render(view());
  await userEvent.click(screen.getByRole('button', { name: '强制删除' }));
  const dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByRole('button', { name: '确认强制删除' })).toBeDisabled();
  await userEvent.click(dialog.getByRole('button', { name: /取\s*消/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: '强制删除' })).toBeEnabled();
  const reopened = await open();
  await act(async () => first.resolve(json({ ...preview, name: 'OLD_RESPONSE', previewToken: 'old-token' })));
  expect(reopened.queryByText('OLD_RESPONSE')).not.toBeInTheDocument();
  await userEvent.click(reopened.getByRole('button', { name: '确认强制删除' }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(JSON.parse(posts(fetchMock)[0][1]!.body as string).previewToken).toBe(preview.previewToken);
});
