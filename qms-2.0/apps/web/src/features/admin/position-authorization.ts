import type { components } from '@qms/contracts';
import { apiRequest, csrfToken } from '../../api/client';
import { organizationPath, type Department, type Position } from '../governance/governance';
import type { AdminOrganization } from './admin';

export type AuthorizationPreview = components['schemas']['PositionAuthorizationPreviewDto'];
export type PositionDirectory = { departments: Department[]; positions: Position[] };
export const canPreviewPositions = (organization: AdminOrganization) => ['organization:structure:read', 'organization:positions:assign', 'account:roles:read', 'account:roles:assign'].every(permission => organization.permissions.includes(permission));

export async function positionPages<Entry>(path: string, signal?: AbortSignal) {
  const result: Entry[] = [];
  for (let offset = 0; offset <= 10000; offset += 100) {
    signal?.throwIfAborted();
    const page = await apiRequest<Entry[]>(`${path}?limit=100&offset=${offset}`, { signal });
    result.push(...page);
    if (page.length < 100) return result;
  }
  throw new Error('Structure exceeds supported page window');
}

export async function loadPositionDirectory(organizationId: string, signal?: AbortSignal): Promise<PositionDirectory> {
  const [departments, positions] = await Promise.all([
    positionPages<Department>(organizationPath(organizationId, '/departments'), signal),
    positionPages<Position>(organizationPath(organizationId, '/positions'), signal),
  ]);
  return { departments, positions };
}

export async function previewPositions(organizationId: string, positionIds: string[], targetUserId?: string, signal?: AbortSignal) {
  const body: components['schemas']['PositionAuthorizationPreviewInputDto'] = { positionIds, ...(targetUserId ? { targetUserId } : {}) };
  return apiRequest<AuthorizationPreview>(organizationPath(organizationId, '/position-authorization/preview'), {
    method: 'POST', signal, headers: { 'x-csrf-token': await csrfToken() }, body: JSON.stringify(body),
  });
}
