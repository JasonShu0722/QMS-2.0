import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken, getSession } from '../../api/client';
import { AuditNcClosurePanel } from './AuditNcClosurePanel';

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
