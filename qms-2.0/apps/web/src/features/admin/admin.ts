import type { components } from '@qms/contracts';
import { apiRequest } from '../../api/client';

export type AdminOrganization = components['schemas']['AdminOrganizationDto'];
export type AdminUser = components['schemas']['AdminUserDto'];
export type AdminRole = components['schemas']['AdminRoleDto'];
export type AdminPermission = components['schemas']['AdminPermissionDto'];
export type UserRoles = components['schemas']['AdminUserRolesDto'];
export const scopePath = (path: string, organizationId: string) => `/api/v1/admin/${path}?organizationId=${encodeURIComponent(organizationId)}`;
export const getAdminOrganizations = () => apiRequest<AdminOrganization[]>('/api/v1/admin/organizations');
export const allows = (organization: AdminOrganization, permission: string) => organization.permissions.includes(`account:${permission}`);

export function randomResetCode() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
