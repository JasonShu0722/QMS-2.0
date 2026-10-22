import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';

type Schema = components['schemas'];
export type PositionGrant = { department: Schema['DepartmentDto']; position: Schema['PositionDto']; role: Schema['AdminRoleDto'] };

const endpoint = process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
const database = process.env.DATABASE_URL;
if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !endpoint || !database) throw new Error('Position fixtures require an explicitly disposable gateway and PostgreSQL.');
for (const [value, isDatabase] of [[endpoint, false], [database, true]] as const) {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash
    || !(isDatabase ? ['postgres:', 'postgresql:'] : ['http:', 'https:']).includes(url.protocol)
    || (!isDatabase && (url.username || url.password || url.pathname !== '/'))) throw new Error('Only loopback position fixtures without URL overrides are allowed.');
}

export async function positionRead<T>(client: APIRequestContext, path: string): Promise<T> {
  const response = await client.get(path, { timeout: 15_000 });
  expect(response.status(), `GET ${path}`).toBe(200);
  return await response.json() as T;
}

export async function positionWrite<T>(client: APIRequestContext, path: string, method: string, data: object, status = 200): Promise<T> {
  const csrf = await positionRead<Schema['CsrfResponseDto']>(client, '/api/v1/auth/csrf');
  const response = await client.fetch(path, { method, timeout: 15_000, headers: { 'x-csrf-token': csrf.csrfToken, 'Idempotency-Key': randomUUID() }, data });
  expect(response.status(), `${method} ${path}`).toBe(status);
  return await response.json() as T;
}

export async function createPositionGrant(client: APIRequestContext, organizationId: string, input: { name: string; permissionCodes: string[]; mfaRequired?: boolean; code?: string }): Promise<PositionGrant> {
  const path = `/api/v1/organizations/${organizationId}`;
  const department = await positionWrite<Schema['DepartmentDto']>(client, `${path}/departments`, 'POST', { name: `${input.name} department`, code: `DEP_${randomUUID()}` }, 201);
  const position = await positionWrite<Schema['PositionDto']>(client, `${path}/positions`, 'POST', { name: input.name, code: input.code ?? `POS_${randomUUID()}`, departmentId: department.id }, 201);
  await changePositionPermissions(client, organizationId, position.id, input.permissionCodes, input.mfaRequired ?? false);
  const roles = await positionRead<Schema['PositionRolesDto']>(client, `${path}/positions/${position.id}/roles`);
  expect(roles.roles).toHaveLength(1);
  return { department, position, role: roles.roles[0]! };
}

export async function changePositionPermissions(client: APIRequestContext, organizationId: string, positionId: string, permissionCodes: string[], mfaRequired?: boolean) {
  const path = `/api/v1/organizations/${organizationId}/positions/${positionId}/permissions`;
  const baseline = await positionRead<Schema['PositionPermissionsDto']>(client, path);
  return positionWrite<Schema['PositionPermissionsDto']>(client, path, 'PUT', {
    permissionCodes, mfaRequired: mfaRequired ?? baseline.mfaRequired,
    expectedPermissionCodes: baseline.permissionCodes, expectedMfaRequired: baseline.mfaRequired, expectedRoleVersion: baseline.roleVersion,
  });
}

export async function createPositionUser(client: APIRequestContext, organizationId: string, positionIds: string[], input: Pick<Schema['CreateAdminUserDto'], 'username' | 'initialPassword'> & Partial<Pick<Schema['CreateAdminUserDto'], 'email' | 'fullName' | 'phone'>>) {
  const preview = await positionWrite<Schema['PositionAuthorizationPreviewDto']>(client, `/api/v1/organizations/${organizationId}/position-authorization/preview`, 'POST', { positionIds });
  return positionWrite<Schema['AdminUserDto']>(client, '/api/v1/admin/users', 'POST', { ...input, accountType: 'INTERNAL', organizationId, positionIds, authorizationBaseline: preview.authorizationBaseline }, 201);
}

async function pages<T>(client: APIRequestContext, path: string) {
  const entries: T[] = [];
  for (let offset = 0; offset <= 10000; offset += 100) {
    const page = await positionRead<T[]>(client, `${path}?limit=100&offset=${offset}`);
    entries.push(...page);
    if (page.length < 100) return entries;
  }
  throw new Error('Disposable position fixture exceeds its bounded directory window.');
}

export async function replacePositionAppointments(client: APIRequestContext, organizationId: string, userId: string, positionIds: string[]) {
  const path = `/api/v1/organizations/${organizationId}`;
  const [assignments, departments] = await Promise.all([
    pages<Schema['UserPositionDto']>(client, `${path}/users/${userId}/positions`),
    pages<Schema['DepartmentDto']>(client, `${path}/departments`),
  ]);
  const now = Date.now();
  const expectedPositionIds = [...new Set(assignments.filter(item => new Date(item.startedAt).getTime() <= now && (!item.endedAt || new Date(item.endedAt).getTime() > now)
    && item.position.status === 'ACTIVE' && departments.some(department => department.id === item.position.departmentId && department.status === 'ACTIVE')).map(item => item.positionId))];
  const preview = await positionWrite<Schema['PositionAuthorizationPreviewDto']>(client, `${path}/position-authorization/preview`, 'POST', { positionIds, targetUserId: userId });
  return positionWrite<Schema['UserPositionDto'][]>(client, `${path}/users/${userId}/positions`, 'PUT', { positionIds, expectedPositionIds, authorizationBaseline: preview.authorizationBaseline });
}

export async function retirePositionGrant(client: APIRequestContext, organizationId: string, grant: PositionGrant) {
  const path = `/api/v1/organizations/${organizationId}`;
  const positions = await pages<Schema['PositionDto']>(client, `${path}/positions`);
  const position = positions.find(item => item.id === grant.position.id);
  if (position?.status === 'ACTIVE') await positionWrite(client, `${path}/positions/${position.id}`, 'PATCH', { status: 'DISABLED', expectedVersion: position.version });
  const departments = await pages<Schema['DepartmentDto']>(client, `${path}/departments`);
  const department = departments.find(item => item.id === grant.department.id);
  if (department?.status === 'ACTIVE') await positionWrite(client, `${path}/departments/${department.id}`, 'PATCH', { status: 'DISABLED', expectedVersion: department.version });
}

export async function choosePosition(page: Page, scope: Locator, position: Schema['PositionDto']) {
  const selector = scope.getByRole('combobox', { name: '任职岗位', exact: true });
  await selector.fill(position.code, { timeout: 10_000 });
  await page.getByText(`${position.name} · ${position.code}`, { exact: true }).click({ timeout: 10_000 });
  await scope.locator('.ant-modal-title').click({ timeout: 10_000 });
}

export async function confirmPositionPreview(page: Page, scope: Locator, organizationId: string) {
  const response = page.waitForResponse(entry => new URL(entry.url()).pathname === `/api/v1/organizations/${organizationId}/position-authorization/preview` && entry.request().method() === 'POST', { timeout: 15_000 });
  await scope.getByRole('button', { name: '预览授权', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(scope.getByRole('region', { name: '权限预览', exact: true })).toBeVisible();
}
