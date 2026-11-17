import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { UserPositionsEditor } from './UserPositionsEditor';
import type { AdminUser } from './admin';
import type { AuthorizationPreview } from './position-authorization';

vi.mock('./PositionSelector', () => ({ PositionSelector: ({ disabled, onChange, onPreviewChange }: { disabled: boolean; onChange: (value: string[]) => void; onPreviewChange: (preview: AuthorizationPreview) => void }) => <fieldset disabled={disabled}><button onClick={() => onChange(['p1'])}>恢复原任职</button><button onClick={() => onChange([])}>清空任职</button><button onClick={() => onPreviewChange({ authorizationBaseline: 'baseline-1', positions: [], effectivePermissionCodes: [], effectiveMfaRequired: false, retainedSources: [] })}>预览授权</button></fieldset> }));
const user = { id: 'user', username: 'alice' } as AdminUser;
const position = { id: 'p1', name: 'Quality engineer', status: 'ACTIVE', departmentId: null };
const assignments = [{ id: 'a1', positionId: 'p1', position, startedAt: '2020-01-01', endedAt: null }];
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

function server() {
  const writes: { path: string; body: string; key: string }[] = [];
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init.method === 'PUT') {
      writes.push({ path, body: String(init.body), key: (init.headers as Record<string, string>)['Idempotency-Key']! });
      if (writes.length === 1) throw new TypeError('response lost');
      return json(assignments);
    }
    reads++;
    return json(path.includes('/users/user/positions?') ? assignments : path.includes('/departments?') ? [] : path.includes('/roles?') ? { permissions: [] } : [position]);
  }));
  return { writes, reads: () => reads };
}
async function failSave() {
  fireEvent.click(await screen.findByRole('button', { name: '预览授权' }));
  fireEvent.click(screen.getByRole('button', { name: '保存任职' }));
  await screen.findByText('请求失败，请重试');
}

it('retains the exact unknown appointment command and locks selection until the same request succeeds', async () => {
  const state = server(); const saved = vi.fn();
  render(<MemoryRouter><UserPositionsEditor organizationId="org" user={user} onClose={vi.fn()} onSaved={saved} onSessionEnding={vi.fn()} /></MemoryRouter>);
  await failSave();
  expect(screen.getByRole('button', { name: '恢复原任职' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '保存任职' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重试确认结果' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(state.writes).toHaveLength(2);
  expect(state.writes[1]).toEqual(state.writes[0]);
  expect(JSON.parse(state.writes[1]!.body)).toEqual({ positionIds: ['p1'], expectedPositionIds: ['p1'], authorizationBaseline: 'baseline-1' });
});

it('requires explicit abandonment before refreshing a zero-difference unknown appointment command', async () => {
  const state = server();
  render(<MemoryRouter><UnsavedChangesProvider><UserPositionsEditor organizationId="org" user={user} onClose={vi.fn()} onSaved={vi.fn()} onSessionEnding={vi.fn()} /></UnsavedChangesProvider></MemoryRouter>);
  await failSave();
  const reads = state.reads();
  fireEvent.click(screen.getByRole('button', { name: '读取最新任职基线' }));
  const guard = within(await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' }));
  expect(state.reads()).toBe(reads);
  fireEvent.click(guard.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByRole('button', { name: '重试确认结果' })).toBeEnabled();
  expect(state.writes).toHaveLength(1);
});

it('protects closing even when an unknown appointment command has no selection difference', async () => {
  server(); const close = vi.fn();
  render(<MemoryRouter><UnsavedChangesProvider><UserPositionsEditor organizationId="org" user={user} onClose={close} onSaved={vi.fn()} onSessionEnding={vi.fn()} /></UnsavedChangesProvider></MemoryRouter>);
  await failSave();
  fireEvent.click(within(screen.getByRole('dialog', { name: 'alice · 用户任职' })).getByRole('button', { name: 'Close' }));
  const guard = within(await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' }));
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(guard.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByRole('button', { name: '重试确认结果' })).toBeEnabled();
});

it('releases the appointment command only after confirming abandonment and refreshing its baseline', async () => {
  const state = server(); const saved = vi.fn();
  render(<MemoryRouter><UnsavedChangesProvider><UserPositionsEditor organizationId="org" user={user} onClose={vi.fn()} onSaved={saved} onSessionEnding={vi.fn()} /></UnsavedChangesProvider></MemoryRouter>);
  await failSave();
  const reads = state.reads();
  fireEvent.click(screen.getByRole('button', { name: '读取最新任职基线' }));
  const guard = within(await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' }));
  expect(state.reads()).toBe(reads);
  fireEvent.click(guard.getByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(state.reads()).toBeGreaterThan(reads));
  fireEvent.click(await screen.findByRole('button', { name: '预览授权' }));
  fireEvent.click(screen.getByRole('button', { name: '保存任职' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(state.writes).toHaveLength(2);
  expect(state.writes[1]!.body).toBe(state.writes[0]!.body);
  expect(state.writes[1]!.key).not.toBe(state.writes[0]!.key);
});

it('preserves a known 409 draft through baseline reload and requires a fresh preview without an abandonment prompt', async () => {
  const writes: { body: string; key: string }[] = [];
  const saved = vi.fn();
  let assignmentReads = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init.method === 'PUT') {
      writes.push({ body: String(init.body), key: (init.headers as Record<string, string>)['Idempotency-Key']! });
      return writes.length === 1 ? new Response(JSON.stringify({ code: 'CONCURRENCY_CONFLICT' }), { status: 409, headers: { 'content-type': 'application/json' } }) : json(assignments);
    }
    if (path.includes('/users/user/positions?')) { assignmentReads++; return json(assignments); }
    return json(path.includes('/departments?') ? [] : path.includes('/roles?') ? { permissions: [] } : [position]);
  }));
  render(<MemoryRouter><UnsavedChangesProvider><UserPositionsEditor organizationId="org" user={user} onClose={vi.fn()} onSaved={saved} onSessionEnding={vi.fn()} /></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '清空任职' }));
  fireEvent.click(screen.getByRole('button', { name: '预览授权' }));
  fireEvent.click(screen.getByRole('button', { name: '保存任职' }));
  await screen.findByText('记录已被其他用户更新，请刷新后重试');
  expect(screen.getByRole('button', { name: '保存任职' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '读取最新任职基线' }));
  expect(screen.queryByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' })).not.toBeInTheDocument();
  await waitFor(() => expect(assignmentReads).toBe(2));
  expect(screen.getByRole('button', { name: '保存任职' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '预览授权' }));
  fireEvent.click(screen.getByRole('button', { name: '保存任职' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(writes).toHaveLength(2);
  expect(JSON.parse(writes[1]!.body)).toEqual({ positionIds: [], expectedPositionIds: ['p1'], authorizationBaseline: 'baseline-1' });
  expect(writes[1]!.key).not.toBe(writes[0]!.key);
});
