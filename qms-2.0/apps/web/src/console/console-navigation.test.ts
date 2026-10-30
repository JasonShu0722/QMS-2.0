import { expect, it, vi } from 'vitest';
import { getConsoleContext } from './console-api';
import { consoleNavigation, consoleRoute, type ConsoleContext, type ConsoleModule } from './console-navigation';

const organization = { id: 'a', code: 'A', name: '组织A', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
const module = (key: ConsoleModule['key'], permissions: string[] = []): ConsoleModule => ({ key, permissions, scope: key === 'workflows' ? 'SESSION_HOME' : 'TARGET', coverage: 'ORGANIZATION', organizationId: 'a' });
const context = (...modules: ConsoleModule[]): ConsoleContext => ({ actor: { id: 'actor', accountType: 'INTERNAL', homeOrganization: organization }, targetOrganization: organization, organizations: [organization], hasPlatformAdministrator: false, modules });

it('allows workflow-only home and design routes without user administration', () => {
  const value = context(module('workflows', ['workflow:manage']));
  expect(consoleNavigation(value).map(item => item.path)).toEqual(['/console', '/console/workflows']);
  expect(consoleRoute('/console', value).status).toBe('allowed');
  expect(consoleRoute('/console/users', value).status).toBe('forbidden');
  const route = consoleRoute('/console/workflows/12345678-1234-4234-8234-123456789abc/87654321-4321-4321-8321-123456789abc', value);
  expect(route.module?.scope).toBe('SESSION_HOME');
});
it('allows an explicitly assigned API monitoring specialist without user administration', () => {
  const value = context(module('api-monitoring', ['console:api:read']));
  expect(consoleNavigation(value).map(item => item.path)).toEqual(['/console', '/console/api-monitoring']);
  expect(consoleRoute('/console/api-monitoring', value)).toMatchObject({ status: 'allowed', module: value.modules[0] });
  expect(consoleRoute('/console/users', value).status).toBe('forbidden');
  expect(consoleNavigation(context(module('api-monitoring')))).toEqual([]);
});
it('allows an explicitly assigned exchange specialist without widening other monitoring access', () => {
  const value = context(module('data-exchanges', ['console:exchanges:read']));
  expect(consoleNavigation(value).map(item => item.path)).toEqual(['/console', '/console/data-exchanges']);
  expect(consoleRoute('/console/data-exchanges', value).status).toBe('allowed');
  expect(consoleRoute('/console/api-monitoring', value).status).toBe('forbidden');
});
it('allows an explicitly assigned service specialist without exposing queue management', () => {
  const value = context(module('services', ['console:services:read']));
  expect(consoleNavigation(value).map(item => item.path)).toEqual(['/console', '/console/services']);
  expect(consoleRoute('/console/services', value).status).toBe('allowed');
  expect(consoleRoute('/console/outbox', value).status).toBe('forbidden');
});
it('filters every master-data child using its own concrete permission', () => {
  const value = context(module('master-data', ['material-master:write']));
  expect(consoleNavigation(value).map(item => item.path)).toEqual(['/console', '/console/master-data/materials']);
  expect(consoleRoute('/console/master-data/suppliers', value).status).toBe('forbidden');
  expect(consoleRoute('/console/master-data/materials', value).status).toBe('allowed');
});
it('maps all delivered modules but rejects unknown, malformed, and future routes', () => {
  const value = context(...(['users', 'organizations', 'configuration', 'workflows', 'audit', 'outbox', 'reconfiguration', 'problem-reconfiguration', 'supplier-accounts'] as const).map(key => module(key)));
  expect(consoleNavigation(value).map(item => item.path)).toContain('/console/audit-log');
  for (const path of ['/console/users/another', '/console/workflows/not-a-uuid/not-a-uuid', '/console-evil']) expect(consoleRoute(path, value).status).toBe('not-found');
  for (const path of ['/console/api-monitoring', '/console/data-exchanges', '/console/services']) expect(consoleRoute(path, value).status).toBe('forbidden');
  expect(consoleRoute('/console', context()).status).toBe('forbidden');
});
it('does not treat an unknown capability as console access', () => {
  const unknown = context({ ...module('users'), key: 'future-module' as ConsoleModule['key'] });
  expect(consoleNavigation(unknown)).toEqual([]);
  expect(consoleRoute('/console', unknown).status).toBe('forbidden');
});
it.each([
  ['users', '/console/users'], ['organizations', '/console/organizations'], ['configuration', '/console/configuration'],
  ['workflows', '/console/workflows'], ['audit', '/console/audit-log'], ['outbox', '/console/outbox'],
  ['reconfiguration', '/console/reconfiguration'], ['problem-reconfiguration', '/console/problem-reconfiguration'], ['supplier-accounts', '/console/supplier-accounts'],
] as const)('keeps the exact module and resource scope for %s', (key, path) => {
  const capability = { ...module(key), scope: 'SESSION_HOME' as const, coverage: 'PLATFORM' as const };
  const value = context(capability);
  expect(consoleNavigation(value).map(item => item.path)).toEqual(['/console', path]);
  expect(consoleRoute(path, value)).toMatchObject({ status: 'allowed', module: capability });
});
it('uses the existing credentialed request layer, optional encoded target and abort signal', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(context(module('workflows'))), { headers: { 'content-type': 'application/json' } }));
  try {
    const controller = new AbortController();
    await getConsoleContext(undefined, controller.signal);
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/admin/console/context', expect.objectContaining({ credentials: 'include', signal: controller.signal }));
    await getConsoleContext('target & other', controller.signal);
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/admin/console/context?organizationId=target+%26+other', expect.objectContaining({ signal: controller.signal }));
  } finally { fetch.mockRestore(); }
});
