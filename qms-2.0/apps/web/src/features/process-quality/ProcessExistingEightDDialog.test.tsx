import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { ProcessExistingEightDDialog } from './ProcessExistingEightDDialog';
import type { Defect } from './process-ledger';

vi.mock('../../api/client', async importOriginal => ({ ...await importOriginal<typeof import('../../api/client')>(), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));

const sources = [
  { id: 'first', organizationId: 'org', description: '划伤', version: 4 },
  { id: 'second', organizationId: 'org', description: '凹陷', version: 7 },
] as Defect[];
const target = { problemId: 'problem', reportNumber: 'PQ-123', title: '压合异常' };
const report = { ...target, organizationId: 'org', version: 10, status: 'PROCESSING', allowedActions: ['read', 'sources'], sources: [{ defectId: 'first' }] };
const updated = { ...report, version: 11, sources: [...report.sources, { defectId: 'second' }] };

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
  vi.mocked(csrfToken).mockResolvedValue('csrf');
  vi.mocked(getSession).mockResolvedValue({ userId: 'user', organizationId: 'org', accountType: 'INTERNAL', landingPath: '/app/workbench' });
});

function mount() {
  const loadTargets = vi.fn().mockResolvedValue([target]);
  const onLinked = vi.fn();
  render(<ProcessExistingEightDDialog sources={sources} organizationId="org" loadTargets={loadTargets} onLinked={onLinked} onClose={vi.fn()} onRefreshSources={vi.fn()} onSessionExpired={vi.fn()} />);
  return { loadTargets, onLinked };
}

async function chooseTarget() {
  fireEvent.change(screen.getByLabelText('搜索已有 8D'), { target: { value: 'PQ-123' } });
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
  fireEvent.click(await screen.findByRole('radio', { name: /PQ-123/ }));
}

it('previews and links only the missing records and requires hidden relationship confirmation', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce(report)
    .mockResolvedValueOnce([{ defectId: 'second', relatedProblems: [], relatedSetToken: 'proof', hasHiddenRelations: true }])
    .mockResolvedValueOnce(updated);
  const { loadTargets, onLinked } = mount();
  expect(loadTargets).not.toHaveBeenCalled();
  await chooseTarget();
  await screen.findByText(/只补充其余 1 条/);
  const submit = screen.getByRole('button', { name: '确认关联' });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText('复发关联结论 second'), { target: { value: 'RECURRENCE' } });
  fireEvent.click(submit);
  await waitFor(() => expect(onLinked).toHaveBeenCalledWith(updated, ['first', 'second']));
  const [path, options] = vi.mocked(apiRequest).mock.calls.at(-1)!;
  expect(path).toMatch(/problem\/sources$/);
  expect(JSON.parse(String(options?.body))).toEqual({ organizationId: 'org', expectedVersion: 10, add: [{ defectId: 'second', expectedVersion: 7 }], removeDefectIds: [], sourceConfirmations: [{ defectId: 'second', relatedProblemIds: [], relatedSetToken: 'proof', recurrence: 'RECURRENCE' }] });
});

it('clears the selected report and its confirmations when a new search returns no results', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce(report)
    .mockResolvedValueOnce([{ defectId: 'second', relatedProblems: [], relatedSetToken: 'proof', hasHiddenRelations: true }]);
  const { loadTargets, onLinked } = mount();
  await chooseTarget();
  fireEvent.change(await screen.findByLabelText('复发关联结论 second'), { target: { value: 'RECURRENCE' } });
  const submit = screen.getByRole('button', { name: '确认关联' });
  expect(submit).toBeEnabled();

  loadTargets.mockResolvedValueOnce([]);
  fireEvent.change(screen.getByLabelText('搜索已有 8D'), { target: { value: 'PQ-999' } });
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
  await screen.findByText('未找到可关联的 8D');

  expect(submit).toBeDisabled();
  expect(screen.queryByText(/目标 8D：/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('复发关联结论 second')).not.toBeInTheDocument();
  fireEvent.click(submit);
  expect(apiRequest).toHaveBeenCalledTimes(2);
  expect(onLinked).not.toHaveBeenCalled();
});

it('rechecks a conflict and blocks submission when the target is no longer editable', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce(report)
    .mockResolvedValueOnce([{ defectId: 'second', relatedProblems: [], hasHiddenRelations: false }])
    .mockRejectedValueOnce(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409))
    .mockResolvedValueOnce({ ...report, version: 11, allowedActions: ['read'] });
  const { onLinked } = mount();
  await chooseTarget();
  const submit = screen.getByRole('button', { name: '确认关联' });
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.click(submit);
  fireEvent.click(await screen.findByRole('button', { name: '重新核对目标和来源' }));
  await screen.findByText('此 8D 当前不可补充来源。');
  expect(submit).toBeDisabled();
  expect(onLinked).not.toHaveBeenCalled();
});

it('retries an uncertain write with the same body and idempotency key', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce(report)
    .mockResolvedValueOnce([{ defectId: 'second', relatedProblems: [], hasHiddenRelations: false }])
    .mockRejectedValueOnce(new TypeError('Connection dropped'))
    .mockResolvedValueOnce(updated);
  const { onLinked } = mount();
  await chooseTarget();
  const submit = screen.getByRole('button', { name: '确认关联' });
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.click(submit);
  const retry = await screen.findByRole('button', { name: '重试关联' });
  expect(screen.getByLabelText('搜索已有 8D')).toBeDisabled();
  fireEvent.click(retry);
  await waitFor(() => expect(onLinked).toHaveBeenCalledOnce());
  const writes = vi.mocked(apiRequest).mock.calls.filter(([, options]) => options?.method === 'PUT');
  expect(writes).toHaveLength(2);
  expect(writes[1][1]?.body).toBe(writes[0][1]?.body);
  expect(new Headers(writes[1][1]?.headers).get('Idempotency-Key')).toBe(new Headers(writes[0][1]?.headers).get('Idempotency-Key'));
});
