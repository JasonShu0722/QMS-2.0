import type { components } from '@qms/contracts';
import { apiRequest } from '../../api/client';
export type Organization = components['schemas']['OrganizationDto'];
export type Department = components['schemas']['DepartmentDto'];
export type Position = components['schemas']['PositionDto'];
export type PositionCategory = components['schemas']['PositionCategoryDto'];
export type UserPosition = components['schemas']['UserPositionDto'];
export type PositionRoles = components['schemas']['PositionRolesDto'];
export type Settings = components['schemas']['PlatformSettingsDto'];
export type NotificationRule = components['schemas']['NotificationRuleDto'];
export type AuditPage = components['schemas']['AuditPageDto'];
export type FailurePage = components['schemas']['OutboxFailurePageDto'];
export type GovernanceBody = components['schemas']['CreateOrganizationDto'] | components['schemas']['UpdateOrganizationDto'] |
  components['schemas']['CreateDepartmentDto'] | components['schemas']['UpdateDepartmentDto'] | components['schemas']['CreatePositionDto'] |
  components['schemas']['UpdatePositionDto'] | components['schemas']['UpdatePlatformSettingsDto'] |
  components['schemas']['UpdateNotificationRuleDto'] | components['schemas']['CreatePositionCategoryDto'] | components['schemas']['UpdatePositionCategoryDto'] |
  components['schemas']['ReplacePositionRolesDto'] | components['schemas']['UpdatePositionPermissionsDto'] |
  components['schemas']['ReplaceUserPositionsWithPreviewDto'] | components['schemas']['DeleteStructureDto'];

export async function allStructurePages<Entry>(path: string, signal?: AbortSignal) {
  const result: Entry[] = [];
  for (let offset = 0; offset <= 10000; offset += 100) {
    signal?.throwIfAborted();
    const separator = path.includes('?') ? '&' : '?';
    const page = await apiRequest<Entry[]>(`${path}${separator}limit=100&offset=${offset}`, { signal });
    result.push(...page);
    if (page.length < 100) return result;
  }
  throw new Error('Structure exceeds supported page window');
}

export const organizationPath = (organizationId: string, path = '') => `/api/v1/organizations/${encodeURIComponent(organizationId)}${path}`;
export const configurationPath = (organizationId: string, path: string) => `/api/v1/admin/configuration/${path}?organizationId=${encodeURIComponent(organizationId)}`;
