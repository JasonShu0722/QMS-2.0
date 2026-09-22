import type { components } from '@qms/contracts';
import { apiRequest, csrfToken } from '../../api/client';

export type Task = components['schemas']['TaskDto'];
export type Notification = components['schemas']['NotificationDto'];
export type TaskPage = components['schemas']['TaskPageDto'];
export type NotificationPage = components['schemas']['NotificationPageDto'];

export async function mutateInbox(path: string, expectedVersion: number) {
  const body: components['schemas']['InboxMutationDto'] = { expectedVersion };
  const token = await csrfToken();
  await apiRequest(path, { method: 'POST', headers: { 'x-csrf-token': token }, body: JSON.stringify(body) });
}
