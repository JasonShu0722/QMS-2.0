import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { AuditNcClosurePanel } from './AuditNcClosurePanel';
import { Link, MemoryRouter } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() };
});

const openNc = { id: 'nc-1', checklist_result_id: 'result-1', severity: 'MAJOR', status: 'OPEN', due_at: '2026-10-30T00:00:00Z', assignee_user_id: null, response: null, verification_note: null, verified_by_id: null, closed_by_id: null, problem_index_id: null, version: 1 };

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
  vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf');
  vi.mocked(getSession).mockReset().mockResolvedValue({ userId: 'reviewer-1', organizationId: 'org-1', accountType: 'INTERNAL' } as never);
});

it('loads execution NCs and submits a versioned verification record', async () => {
  const responded = { ...openNc, status: 'RESPONDED', assignee_user_id: 'handler-1', response: '已整改', version: 3 };
  vi.mocked(apiRequest).mockImplementation((path) => Promise.resolve(String(path).endsWith('/ncs') ? [responded] : { organizationId: 'org-1', permissions: ['audit-management:write'] }) as never);
  render(<AuditNcClosurePanel />);
  fireEvent.change(screen.getByLabelText('整改审核执行 ID'), { target: { value: 'execution-1' } });
  fireEvent.click(screen.getByRole('button', { name: '查看整改记录' }));
  expect(await screen.findByText('整改回复：已整改')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '验证整改' }));
  fireEvent.change(screen.getByLabelText('验证结论'), { target: { value: '复测符合要求' } });
  fireEvent.click(screen.getByRole('button', { name: '验证通过' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/audit-management/ncs/nc-1/verify', expect.objectContaining({
    method: 'PUT', body: JSON.stringify({ expectedVersion: 3, accepted: true, verificationNote: '复测符合要求' }),
  })));
});

it('keeps the closure action unavailable before independent verification', async () => {
  vi.mocked(apiRequest).mockImplementation((path) => Promise.resolve(String(path).endsWith('/ncs') ? [openNc] : { organizationId: 'org-1', permissions: ['audit-management:write'] }) as never);
  render(<AuditNcClosurePanel />);
  fireEvent.change(screen.getByLabelText('整改审核执行 ID'), { target: { value: 'execution-1' } });
  fireEvent.click(screen.getByRole('button', { name: '查看整改记录' }));
  expect(await screen.findByText('待分派')).toBeVisible();
  expect(screen.queryByRole('button', { name: '关闭整改' })).not.toBeInTheDocument();
});

it.each(['response', 'verify'] as const)('keeps the %s draft visible after 409 until refresh is explicitly confirmed', async (action) => {
  const item = { ...openNc, status: action === 'response' ? 'ASSIGNED' : 'RESPONDED', assignee_user_id: action === 'response' ? 'reviewer-1' : 'handler-1', version: 3 };
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method === 'PUT') throw new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409);
    return String(path).endsWith('/ncs') ? [item] : { organizationId: 'org-1', permissions: ['audit-management:write'] };
  });
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><AuditNcClosurePanel /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  fireEvent.change(screen.getByLabelText('整改审核执行 ID'), { target: { value: 'execution-1' } });
  fireEvent.click(screen.getByRole('button', { name: '查看整改记录' }));
  fireEvent.click(await screen.findByRole('button', { name: action === 'response' ? '提交整改' : '验证整改' }));
  const label = action === 'response' ? '整改回复' : '验证结论';
  fireEvent.change(screen.getByLabelText(label), { target: { value: '冲突后仍需保留的长说明' } });
  fireEvent.click(screen.getByRole('button', { name: action === 'response' ? '确认提交' : '验证通过' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`/api/v1/audit-management/ncs/nc-1/${action}`, expect.objectContaining({ method: 'PUT' })));
  const dialog = await screen.findByRole('dialog', { name: action === 'response' ? '提交整改回复' : '独立验证整改' });
  await waitFor(() => expect(within(dialog).getByLabelText(label)).toBeEnabled());
  expect(within(dialog).getByLabelText(label)).toHaveValue('冲突后仍需保留的长说明');
  await waitFor(() => expect(within(dialog).getByText(/版本.*输入已保留/)).toBeVisible());
  expect(within(dialog).getByRole('button', { name: action === 'response' ? '确认提交' : '验证通过' })).toBeDisabled();
  expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path.endsWith('/ncs'))).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole('button', { name: '放弃输入并刷新记录' }));
  fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText(label)).toHaveValue('冲突后仍需保留的长说明');
  fireEvent.click(within(dialog).getByRole('button', { name: '放弃输入并刷新记录' }));
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path.endsWith('/ncs'))).toHaveLength(2));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: action === 'response' ? '提交整改回复' : '独立验证整改' })).not.toBeInTheDocument());
});

it('protects an unfinished independent verification when navigating away', async () => {
  const responded = { ...openNc, status: 'RESPONDED', assignee_user_id: 'handler-1', response: '已整改', version: 3 };
  vi.mocked(apiRequest).mockImplementation((path) => Promise.resolve(String(path).endsWith('/ncs') ? [responded] : { organizationId: 'org-1', permissions: ['audit-management:write'] }) as never);
  render(<MemoryRouter><UnsavedChangesProvider><AuditNcClosurePanel /><Link to="/app/workbench">返回工作台</Link></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('整改审核执行 ID'), { target: { value: 'execution-1' } });
  fireEvent.click(screen.getByRole('button', { name: '查看整改记录' }));
  fireEvent.click(await screen.findByRole('button', { name: '验证整改' }));
  fireEvent.change(screen.getByLabelText('验证结论'), { target: { value: '尚未提交的验证' } });
  fireEvent.click(screen.getByRole('link', { name: '返回工作台' }));
  await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible());
  await waitFor(() => expect(screen.getByRole('button', { name: '继续编辑' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('验证结论')).toHaveValue('尚未提交的验证');
});
