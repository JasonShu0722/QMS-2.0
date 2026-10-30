import type { components } from '@qms/contracts';
import { apiRequest } from '../api/client';

export function getConsoleContext(organizationId?: string, signal?: AbortSignal) {
  const query = organizationId === undefined ? '' : `?${new URLSearchParams({ organizationId })}`;
  return apiRequest<components['schemas']['ConsoleContextDto']>(`/api/v1/admin/console/context${query}`, { signal });
}
