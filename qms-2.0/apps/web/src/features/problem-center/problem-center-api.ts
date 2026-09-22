import type { components, paths } from '@qms/contracts';
import { apiRequest, csrfToken, getSession } from '../../api/client';

export type ProblemPage = components['schemas']['ProblemIndexPageResponseDto'];
export type ProblemView = components['schemas']['ProblemSavedViewDto'];
export type ProblemViewPage = components['schemas']['ProblemSavedViewPageDto'];
export type ProblemViewConfiguration = components['schemas']['ProblemSavedViewConfigurationDto'];
export type ProblemQuery = NonNullable<paths['/api/v1/problem-index']['get']['parameters']['query']>;
export type ProblemViewQuery = NonNullable<paths['/api/v1/problem-views']['get']['parameters']['query']>;

type CreateViewBody = components['schemas']['CreateProblemSavedViewDto'];
type UpdateViewBody = components['schemas']['UpdateProblemSavedViewDto'];
type DeleteViewBody = components['schemas']['DeleteProblemSavedViewDto'];

function queryString(query: Record<string, string | number | undefined>) {
  const parameters = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') parameters.set(key, String(value));
  });
  return parameters.toString();
}

async function write<Result>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body: CreateViewBody | UpdateViewBody | DeleteViewBody) {
  const token = await csrfToken();
  return apiRequest<Result>(path, {
    method,
    headers: { 'x-csrf-token': token },
    body: JSON.stringify(body),
  });
}

export const getProblemOrganizationId = async () => (await getSession()).organizationId;
export const getProblemIndex = (query: ProblemQuery, signal?: AbortSignal) =>
  apiRequest<ProblemPage>(`/api/v1/problem-index?${queryString(query)}`, { signal });
export const getProblemViews = (query: ProblemViewQuery, signal?: AbortSignal) =>
  apiRequest<ProblemViewPage>(`/api/v1/problem-views?${queryString(query)}`, { signal });
export const createProblemView = (organizationId: string, body: CreateViewBody) =>
  write<ProblemView>(`/api/v1/problem-views?${queryString({ organizationId })}`, 'POST', body);
export const updateProblemView = (organizationId: string, id: string, body: UpdateViewBody) =>
  write<ProblemView>(`/api/v1/problem-views/${encodeURIComponent(id)}?${queryString({ organizationId })}`, 'PATCH', body);
export const deleteProblemView = (organizationId: string, id: string, body: DeleteViewBody) =>
  write<components['schemas']['ProblemSavedViewDeletedDto']>(`/api/v1/problem-views/${encodeURIComponent(id)}?${queryString({ organizationId })}`, 'DELETE', body);
