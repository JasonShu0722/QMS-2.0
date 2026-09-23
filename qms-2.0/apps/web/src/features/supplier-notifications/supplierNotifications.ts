import type { components, operations } from '@qms/contracts';
import { apiRequest, csrfToken } from '../../api/client';

export type SupplierNotification = components['schemas']['SupplierPortalNotificationDto'];
export type SupplierNotificationPage = components['schemas']['SupplierPortalNotificationPageDto'];
export type SupplierNotificationQuery = NonNullable<operations['SupplierPortalNotificationController_list']['parameters']['query']>;

export function supplierNotificationPath(query: SupplierNotificationQuery) {
  return `/api/v1/supplier-portal/notifications?${new URLSearchParams({
    pageSize: String(query.pageSize ?? 25), offset: String(query.offset ?? 0),
  })}`;
}

export function listSupplierNotifications(query: SupplierNotificationQuery, signal: AbortSignal) {
  return apiRequest<SupplierNotificationPage>(supplierNotificationPath(query), { signal });
}

export async function readSupplierNotification(id: string, expectedVersion: SupplierNotification['version']) {
  const body: components['schemas']['InboxMutationDto'] = { expectedVersion };
  const token = await csrfToken();
  return apiRequest<SupplierNotification>(`/api/v1/supplier-portal/notifications/${encodeURIComponent(id)}/read`, {
    method: 'POST', headers: { 'x-csrf-token': token }, body: JSON.stringify(body),
  });
}
