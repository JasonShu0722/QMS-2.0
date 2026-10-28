import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { SupplierEightDIssueButton } from './SupplierEightDIssueButton';

vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
const assignment = { assignmentId: '11111111-1111-4111-8111-111111111111', userId: 'sqe', username: 'sqe-user', fullName: 'SQE', departmentId: 'section', departmentName: '供应商质量室', positionName: '工程师' };
const issued = vi.fn(), denied = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  useWorkTabsStore.getState().bindSession('INTERNAL:org:actor');
  vi.mocked(getSession).mockResolvedValue({ accountType: 'INTERNAL', organizationId: 'org', userId: 'actor', landingPath: '/app/workbench' });
  vi.mocked(csrfToken).mockResolvedValue('csrf-real-session');
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path === '/api/v1/system/my-permissions') return { permissions: ['supplier-quality:issues:issue'] } as never;
    if (String(path).includes('assignment-options')) return { items: [assignment], total: 1 } as never;
    if (init?.method === 'POST') return { supplierProblemId: 'draft' } as never;
    throw new Error(`Unexpected request: ${path}`);
  });
});
function scene() { return render(<SupplierEightDIssueButton id="draft" version={7} onIssued={issued} onDenied={denied} />); }

it('issues only with an actual appointment through the complete route, without inventing deadlines', async () => {
  scene();
  await screen.findByRole('option', { name: /供应商质量室/ });
  fireEvent.change(await screen.findByLabelText('SQE责任任职'), { target: { value: assignment.assignmentId } });
  fireEvent.click(screen.getByRole('button', { name: '正式发起8D' }));
  await waitFor(() => expect(issued).toHaveBeenCalledTimes(1));
  const write = vi.mocked(apiRequest).mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(write[0]).toBe('/api/v1/supplier-quality/eight-d/drafts/draft/issue');
  expect(JSON.parse(String(write[1]?.body))).toEqual({ expectedVersion: 7, sqeAssignmentId: assignment.assignmentId });
  expect(denied).not.toHaveBeenCalled();
});

it('freezes an unknown issue attempt and explicitly retries the same body/key', async () => {
  const regular = vi.mocked(apiRequest).getMockImplementation()!;
  let posts = 0;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method === 'POST' && posts++ === 0) throw new TypeError('response lost');
    return regular(path, init);
  });
  scene();
  await screen.findByRole('option', { name: /供应商质量室/ });
  fireEvent.change(await screen.findByLabelText('SQE责任任职'), { target: { value: assignment.assignmentId } });
  fireEvent.click(screen.getByRole('button', { name: '正式发起8D' }));
  await screen.findByText(/发单结果未知/);
  expect(screen.getByLabelText('SQE责任任职')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重试原发单' }));
  await waitFor(() => expect(issued).toHaveBeenCalledTimes(1));
  const writes = vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(writes).toHaveLength(2);
  expect(writes[1]![1]?.body).toBe(writes[0]![1]?.body);
  expect(writes[1]![1]?.headers).toEqual(writes[0]![1]?.headers);
});

it('does not request the appointment directory without real issue permission', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ permissions: ['supplier-quality:problems:write'] } as never);
  scene();
  await act(async () => {});
  expect(screen.queryByLabelText('SQE责任任职')).not.toBeInTheDocument();
  expect(vi.mocked(apiRequest).mock.calls).toHaveLength(1);
  expect(denied).not.toHaveBeenCalled();
});

it('clears the embedded issuer and propagates a current directory denial', async () => {
  const regular = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (String(path).includes('assignment-options')) throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'denied' }, 403);
    return regular(path, init);
  });
  scene();
  await waitFor(() => expect(denied).toHaveBeenCalledTimes(1));
  expect(screen.queryByLabelText('SQE责任任职')).not.toBeInTheDocument();
  expect(issued).not.toHaveBeenCalled();
});
