import { beforeEach, expect, it, vi } from 'vitest';
import {
  createProblemView,
  deleteProblemView,
  getProblemIndex,
  getProblemViews,
  updateProblemView,
  type ProblemViewConfiguration,
} from './problem-center-api';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

const configuration: ProblemViewConfiguration = {
  schemaVersion: 1,
  filters: { status: 'OPEN', overdueAt: '2026-09-19T12:00:00.000Z' },
  sort: { sortBy: 'dueAt', sortDirection: 'asc' },
  visibleColumns: ['reportNumber', 'status', 'dueAt'],
  columnOrder: ['reportNumber', 'status', 'dueAt'],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

it('serializes bounded problem paging, filters, sorting, and the selected organization', async () => {
  globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(json({ items: [], total: 0, page: 10001, pageSize: 100, statusCounts: [] }));

  await getProblemIndex({
    organizationId: 'organization-b',
    page: 10001,
    pageSize: 100,
    search: 'QMS-2026',
    dueFrom: '2026-09-01T00:00:00.000Z',
    overdueAt: '2026-09-19T12:00:00.000Z',
    sortBy: 'reportNumber',
    sortDirection: 'desc',
  });

  expect(fetch).toHaveBeenCalledWith(
    '/api/v1/problem-index?organizationId=organization-b&page=10001&pageSize=100&search=QMS-2026&dueFrom=2026-09-01T00%3A00%3A00.000Z&overdueAt=2026-09-19T12%3A00%3A00.000Z&sortBy=reportNumber&sortDirection=desc',
    expect.objectContaining({ credentials: 'include' }),
  );
});

it('lists saved views in the selected organization with offset pagination', async () => {
  globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(json({ items: [], total: 0 }));

  await getProblemViews({ organizationId: 'organization-b', pageSize: 100, offset: 200 });

  expect(fetch).toHaveBeenCalledWith(
    '/api/v1/problem-views?organizationId=organization-b&pageSize=100&offset=200',
    expect.objectContaining({ credentials: 'include' }),
  );
});

it('sends CSRF-protected create, update, and delete bodies with CAS versions', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = vi.fn<typeof fetch>().mockImplementation((input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith('/csrf')) return Promise.resolve(json({ csrfToken: 'csrf-token' }));
    if (init?.method === 'DELETE') return Promise.resolve(json({ id: 'view-1', deleted: true }));
    return Promise.resolve(json({ id: 'view-1', organizationId: 'organization-b', name: '逾期问题', configuration, version: 4, createdAt: '', updatedAt: '' }, init?.method === 'POST' ? 201 : 200));
  });

  await createProblemView('organization-b', { name: '逾期问题', configuration });
  await updateProblemView('organization-b', 'view-1', { name: '逾期问题（更新）', configuration, expectedVersion: 3 });
  await deleteProblemView('organization-b', 'view-1', { expectedVersion: 4 });

  const writes = requests.filter(({ url }) => !url.endsWith('/csrf'));
  expect(writes.map(({ url, init }) => [url, init?.method, init?.headers, JSON.parse(String(init?.body))])).toEqual([
    ['/api/v1/problem-views?organizationId=organization-b', 'POST', { 'content-type': 'application/json', 'x-csrf-token': 'csrf-token' }, { name: '逾期问题', configuration }],
    ['/api/v1/problem-views/view-1?organizationId=organization-b', 'PATCH', { 'content-type': 'application/json', 'x-csrf-token': 'csrf-token' }, { name: '逾期问题（更新）', configuration, expectedVersion: 3 }],
    ['/api/v1/problem-views/view-1?organizationId=organization-b', 'DELETE', { 'content-type': 'application/json', 'x-csrf-token': 'csrf-token' }, { expectedVersion: 4 }],
  ]);
});
