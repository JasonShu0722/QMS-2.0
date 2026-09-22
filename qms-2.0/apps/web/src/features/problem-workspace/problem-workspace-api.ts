import type { components } from '@qms/contracts';
import { apiRequest, csrfToken } from '../../api/client';

export type ProblemWorkspace = components['schemas']['ProblemWorkspaceDto'];
export type ProblemReport = components['schemas']['ProblemReportDto'];
export type ProblemAuditPage = components['schemas']['ProblemAuditPageDto'];
export type UpgradePreview = components['schemas']['WorkflowUpgradePreviewDto'];
export type UpgradeRequest = components['schemas']['WorkflowUpgradeRequestDto'];

export function problemScope(organizationId?: string, instanceId?: string) {
  const query = new URLSearchParams();
  if (organizationId) query.set('organizationId', organizationId);
  if (instanceId) query.set('instanceId', instanceId);
  return query;
}
export const readWorkspace = (id: string, organizationId?: string, instanceId?: string, signal?: AbortSignal) =>
  apiRequest<ProblemWorkspace>(`/api/v1/problem-index/${id}/workspace?${problemScope(organizationId, instanceId)}`, { signal });
export const readReport = (id: string, organizationId?: string, instanceId?: string, signal?: AbortSignal) =>
  apiRequest<ProblemReport>(`/api/v1/reports/problems/${id}?${problemScope(organizationId, instanceId)}`, { signal });
export function readProblemAudit(id: string, organizationId?: string, cursor?: string, signal?: AbortSignal) {
  const query = problemScope(organizationId);
  query.set('pageSize', '25');
  if (cursor) query.set('cursor', cursor);
  return apiRequest<ProblemAuditPage>(`/api/v1/problems/${id}/audit-trail?${query}`, { signal });
}
export const previewUpgrade = (id: string, organizationId?: string, signal?: AbortSignal) =>
  apiRequest<UpgradePreview>(`/api/v1/problem-index/${id}/upgrade-preview?${problemScope(organizationId)}`, { signal });
export async function submitUpgrade(id: string, body: UpgradeRequest, key: string) {
  const token = await csrfToken();
  return apiRequest<components['schemas']['WorkflowUpgradeResultDto']>(`/api/v1/problem-index/${id}/upgrade`, {
    method: 'POST', headers: { 'x-csrf-token': token, 'Idempotency-Key': key }, body: JSON.stringify(body),
  });
}
