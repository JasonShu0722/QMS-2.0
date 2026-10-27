import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { LanguageProvider } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { MyTasksPage } from './MyTasksPage';

type Task = components['schemas']['CustomerFaeAnalysisTaskDto'];
const task: Task = { kind: 'CUSTOMER_COMPLAINT_FAE', analysis: {
  id: 'analysis-1', organizationId: 'organization-1', complaintId: 'complaint-1', section: 'FAE', version: 1,
  assigneeUserId: 'fae-1', assigneeAssignmentId: 'appointment-1', departmentId: 'department-1',
  text: null, progress: null, result: null, completedOn: null, failedPart: null, failedMaterialCode: null,
  supplierAnalysisRequired: null, fileIds: [], faeStatus: 'NOT_ANALYSED', updatedByUserId: 'qe-1',
  updatedAt: '2026-10-26T08:00:00Z',
} };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Request = { path: string; init?: RequestInit };
function mockApi(intercept?: (request: Request) => Response | Promise<Response> | undefined) {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const request = { path: String(input), init }; requests.push(request);
    const response = intercept?.(request);
    if (response !== undefined) return Promise.resolve(response);
    return Promise.resolve(json(request.path.startsWith('/api/v1/customer-quality/analysis/fae-tasks') ? [task] : { items: [], total: 0 }));
  }));
  return requests;
}
function mount(search = '') {
  return render(<MemoryRouter initialEntries={[`/app/my-tasks${search}`]}><LanguageProvider><MyTasksPage /></LanguageProvider></MemoryRouter>);
}
const faeRequests = (requests: Request[]) => requests.filter(request => request.path.startsWith('/api/v1/customer-quality/analysis/fae-tasks'));
beforeEach(() => { sessionStorage.clear(); useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession('INTERNAL:user:one'); });
afterEach(() => { vi.unstubAllGlobals(); useWorkTabsStore.getState().reset(); sessionStorage.clear(); });

it('loads FAE analysis duties only in the active tab and links the real complaint organization', async () => {
  const requests = mockApi(); mount('?organizationId=organization-1');
  expect(faeRequests(requests)).toHaveLength(0);
  fireEvent.click(screen.getByRole('tab', { name: '客诉FAE解析' }));
  const link = await screen.findByRole('link', { name: '查看客诉并解析' });
  expect(link).toHaveAttribute('href', '/app/customer-quality?complaintId=complaint-1&organizationId=organization-1');
  expect(faeRequests(requests)).toHaveLength(1);
  expect(new URL(faeRequests(requests)[0].path, 'https://qms.test').searchParams.get('organizationId')).toBe('organization-1');
  expect(screen.getByText('未解析')).toBeVisible();
  expect(requests.every(request => !request.init?.method || request.init.method === 'GET')).toBe(true);
});

it('clears previous duties after an authorization failure instead of retaining sensitive rows', async () => {
  let denied = false;
  mockApi(({ path }) => denied && path.includes('/fae-tasks') ? json({ error_code: 'FEATURE_PERMISSION_DENIED', message: 'denied' }, 403) : undefined);
  mount(); fireEvent.click(screen.getByRole('tab', { name: '客诉FAE解析' }));
  await screen.findByRole('link', { name: '查看客诉并解析' });
  denied = true; fireEvent.click(screen.getByRole('button', { name: '刷新解析待办' }));
  await waitFor(() => expect(screen.queryByRole('link', { name: '查看客诉并解析' })).not.toBeInTheDocument());
  expect(await screen.findByRole('alert')).toBeVisible();
});

it('aborts a departing session and ignores its late successful response', async () => {
  let resolve!: (response: Response) => void;
  const requests = mockApi(({ path }) => path.includes('/fae-tasks') ? new Promise<Response>(done => { resolve = done; }) : undefined);
  mount(); fireEvent.click(screen.getByRole('tab', { name: '客诉FAE解析' }));
  await waitFor(() => expect(faeRequests(requests)).toHaveLength(1));
  const oldResolve = resolve;
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:user:two'));
  expect(faeRequests(requests)[0].init?.signal?.aborted).toBe(true);
  await act(async () => { oldResolve(json([task])); });
  expect(screen.queryByRole('link', { name: '查看客诉并解析' })).not.toBeInTheDocument();
});

it('unmounts FAE projections and aborts their read when switching away', async () => {
  const requests = mockApi(); mount(); fireEvent.click(screen.getByRole('tab', { name: '客诉FAE解析' }));
  await screen.findByRole('link', { name: '查看客诉并解析' });
  fireEvent.click(screen.getByRole('tab', { name: '我的待办' }));
  await waitFor(() => expect(faeRequests(requests)[0].init?.signal?.aborted).toBe(true));
  expect(screen.queryByRole('link', { name: '查看客诉并解析' })).not.toBeInTheDocument();
});
