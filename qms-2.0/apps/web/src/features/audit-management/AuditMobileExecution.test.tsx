import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, csrfToken } from '../../api/client';
import { AuditMobileExecution } from './AuditMobileExecution';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn() };
});

const snapshot = {
  execution: { id: 'exec-1', plan_id: 'plan-1', template_version_id: 'version-1', status: 'OPEN', version: 1 },
  items: [{ key: 'P1', text: '过程受控' }, { key: 'P2', text: '记录完整' }],
  checklist: [],
};

beforeEach(() => { vi.mocked(apiRequest).mockReset(); vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf'); localStorage.clear(); useWorkTabsStore.getState().bindSession('INTERNAL:org-1:user-1'); });

it('saves checklist values locally while offline and restores them on reload', async () => {
  vi.mocked(apiRequest).mockResolvedValue(snapshot as never);
  render(<AuditMobileExecution initialExecutionId="exec-1" />);
  expect(await screen.findByText(/P1 · 过程受控/)).toBeVisible();
  fireEvent.click(screen.getByLabelText('P1 结果').querySelector('input[value="NG"]')!);
  fireEvent.change(screen.getByLabelText('P1 备注'), { target: { value: '现场记录缺失' } });
  expect(JSON.parse(localStorage.getItem('qms.audit.mobile-draft.INTERNAL:org-1:user-1.exec-1')!)).toMatchObject({ P1: { result: 'NG', note: '现场记录缺失' } });
});

it('keeps the local draft and shows a conflict when sync races another session', async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce(snapshot as never)
    .mockRejectedValueOnce(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409));
  render(<AuditMobileExecution initialExecutionId="exec-1" />);
  await screen.findByText(/P1 · 过程受控/);
  fireEvent.click(screen.getByLabelText('P1 结果').querySelector('input[value="OK"]')!);
  fireEvent.click(screen.getByRole('button', { name: '同步草稿' }));
  expect(await screen.findByText('审核已在其他会话中更新')).toBeVisible();
  expect(localStorage.getItem('qms.audit.mobile-draft.INTERNAL:org-1:user-1.exec-1')).toContain('P1');
  await waitFor(() => expect(csrfToken).toHaveBeenCalled());
});

it('disables mobile execution inputs and actions while sync is pending', async () => {
  let complete!: (value: unknown) => void;
  const pending = new Promise((resolve) => { complete = resolve; });
  vi.mocked(apiRequest).mockResolvedValueOnce(snapshot as never)
    .mockReturnValueOnce(pending as never)
    .mockResolvedValue(snapshot as never);
  render(<AuditMobileExecution initialExecutionId="exec-1" />);
  await screen.findByText(/P1 · 过程受控/);
  fireEvent.change(screen.getByLabelText('P1 备注'), { target: { value: '待同步' } });
  fireEvent.click(screen.getByRole('button', { name: '同步草稿' }));

  await waitFor(() => expect(screen.getByRole('button', { name: '同步草稿' })).toBeDisabled());
  expect(screen.getByLabelText('审核执行 ID')).toBeDisabled();
  expect(screen.getByRole('button', { name: '打开执行' })).toBeDisabled();
  for (const radio of screen.getByLabelText('P1 结果').querySelectorAll('input')) expect(radio).toBeDisabled();
  expect(screen.getByLabelText('P1 备注')).toBeDisabled();
  expect(screen.getByRole('button', { name: '提交审核' })).toBeDisabled();

  complete({ id: 'saved' });
  await waitFor(() => expect(screen.getByRole('button', { name: '同步草稿' })).not.toBeDisabled());
});

it('does not let an older sync response replace a newly loaded execution draft', async () => {
  let completeRefresh!: (value: unknown) => void;
  const pendingRefresh = new Promise((resolve) => { completeRefresh = resolve; });
  const nextSnapshot = {
    ...snapshot,
    execution: { ...snapshot.execution, id: 'exec-2', version: 2 },
    items: [{ key: 'P1', text: '新执行项' }],
  };
  const nextDraft = { P1: { result: 'NG', note: '新执行草稿', expectedVersion: 2, idempotencyKey: 'new-key' } };
  vi.mocked(apiRequest).mockResolvedValueOnce(snapshot as never)
    .mockResolvedValueOnce({ id: 'saved-p1' } as never)
    .mockReturnValueOnce(pendingRefresh as never)
    .mockResolvedValueOnce(nextSnapshot as never);
  const view = render(<AuditMobileExecution initialExecutionId="exec-1" />);
  await view.findByText(/P1 · 过程受控/);
  fireEvent.change(view.getByLabelText('P1 备注'), { target: { value: '旧执行草稿' } });
  localStorage.setItem('qms.audit.mobile-draft.INTERNAL:org-1:user-1.exec-2', JSON.stringify(nextDraft));
  fireEvent.click(view.getByRole('button', { name: '同步草稿' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(3));

  view.rerender(<AuditMobileExecution initialExecutionId="exec-2" />);
  expect(await view.findByText(/P1 · 新执行项/)).toBeVisible();
  expect(view.getByLabelText('P1 备注')).toHaveValue('新执行草稿');
  completeRefresh(snapshot);

  await waitFor(() => expect(view.getByText(/P1 · 新执行项/)).toBeVisible());
  expect(view.getByLabelText('P1 备注')).toHaveValue('新执行草稿');
  expect(localStorage.getItem('qms.audit.mobile-draft.INTERNAL:org-1:user-1.exec-2')).toContain('新执行草稿');
});

it('keeps only unfinished rows in the local draft after a partial sync failure', async () => {
  const threeItems = { ...snapshot, items: [...snapshot.items, { key: 'P3', text: '第三项' }] };
  vi.mocked(apiRequest).mockResolvedValueOnce(threeItems as never)
    .mockResolvedValueOnce({ id: 'saved-p1', item_key: 'P1', result: 'OK', note: '已同步备注', version: 1 })
    .mockResolvedValueOnce({ id: 'saved-p2', item_key: 'P2', result: 'OK', version: 1 })
    .mockRejectedValueOnce(new Error('offline'));
  render(<AuditMobileExecution initialExecutionId="exec-1" />);
  await screen.findByText(/P1 · 过程受控/);
  for (const key of ['P1', 'P2', 'P3']) {
    fireEvent.click(screen.getByLabelText(`${key} 结果`).querySelector('input[value="OK"]')!);
  }
  fireEvent.click(screen.getByRole('button', { name: '同步草稿' }));
  await screen.findByText('审核执行加载失败，请重试。');
  const remaining = JSON.parse(localStorage.getItem('qms.audit.mobile-draft.INTERNAL:org-1:user-1.exec-1')!);
  expect(remaining).toHaveProperty('P3');
  expect(remaining).not.toHaveProperty('P1');
  expect(remaining).not.toHaveProperty('P2');
  expect(screen.getByLabelText('P1 备注')).toHaveValue('已同步备注');
  fireEvent.change(screen.getByLabelText('P1 备注'), { target: { value: '再次修改' } });
  const updated = JSON.parse(localStorage.getItem('qms.audit.mobile-draft.INTERNAL:org-1:user-1.exec-1')!);
  expect(updated.P1.expectedVersion).toBe(1);
});

it('protects refresh and route departure during synchronization and releases after failure', async () => {
  let fail!: (cause: unknown) => void;
  vi.mocked(apiRequest).mockResolvedValueOnce(snapshot as never).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  render(<MemoryRouter><UnsavedChangesProvider><AuditMobileExecution initialExecutionId="exec-1" /><Link to="/elsewhere">离开审核</Link></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText('P1 备注'), { target: { value: '待同步' } });
  const sync = screen.getByRole('button', { name: '同步草稿' });
  await act(async () => { sync.click(); sync.click(); });
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole('link', { name: '离开审核' }));
  expect(screen.getByLabelText('P1 备注')).toBeInTheDocument();
  await act(async () => fail(new Error('offline')));
  await waitFor(() => expect(sync).toBeEnabled());
});
