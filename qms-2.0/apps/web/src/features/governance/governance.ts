import type { components } from '@qms/contracts';
export type Organization = components['schemas']['OrganizationDto'];
export type Department = components['schemas']['DepartmentDto'];
export type Position = components['schemas']['PositionDto'];
export type PositionCategory = components['schemas']['PositionCategoryDto'];
export type UserPosition = components['schemas']['UserPositionDto'];
export type Settings = components['schemas']['PlatformSettingsDto'];
export type NotificationRule = components['schemas']['NotificationRuleDto'];
export type AuditPage = components['schemas']['AuditPageDto'];
export type FailurePage = components['schemas']['OutboxFailurePageDto'];
export type GovernanceBody = components['schemas']['CreateOrganizationDto'] | components['schemas']['UpdateOrganizationDto'] |
  components['schemas']['CreateDepartmentDto'] | components['schemas']['UpdateDepartmentDto'] | components['schemas']['CreatePositionDto'] |
  components['schemas']['UpdatePositionDto'] | components['schemas']['ReplaceUserPositionsDto'] | components['schemas']['UpdatePlatformSettingsDto'] |
  components['schemas']['UpdateNotificationRuleDto'] | components['schemas']['CreatePositionCategoryDto'] | components['schemas']['UpdatePositionCategoryDto'];

export const organizationPath = (organizationId: string, path = '') => `/api/v1/organizations/${encodeURIComponent(organizationId)}${path}`;
export const configurationPath = (organizationId: string, path: string) => `/api/v1/admin/configuration/${path}?organizationId=${encodeURIComponent(organizationId)}`;
