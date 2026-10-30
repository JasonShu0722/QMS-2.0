import 'reflect-metadata';
import { jest } from '@jest/globals';
import { ConsoleContextService } from '../../src/modules/identity/console-context.service.js';
import { INTERNAL_PLATFORM_PERMISSION_CODES } from '../../src/modules/authorization/permission-catalog.js';

// The authorization projection is real; only its database boundary is in memory.
function fixture(codes: string[] = [], accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
  const home = { id: 'home', code: 'A', name: 'Home', type: accountType, status: 'ACTIVE', configurationRequired: false, deletedAt: null };
  const target = { ...home, id: 'target', code: 'B', name: 'Target' };
  const hidden = { ...home, id: 'hidden', code: 'C', name: 'Hidden' };
  const organizations = [home, target, hidden];
  const actor = { id: 'actor', organizationId: home.id, accountType };
  const user = { ...actor, status: 'ACTIVE', deletedAt: null, configurationRequired: false, organization: home };
  const permission = (code: string) => ({ id: code, code, name: code });
  const role = (scope: string, permissions: string[]) => ({ id: `role-${scope}`, organizationId: scope, code: 'ordinary', name: 'Not an authority signal', mfaRequired: false, permissions: permissions.map(code => ({ permission: permission(code) })) });
  const grants = [{ organizationId: home.id, role: role(home.id, codes) }];
  const prisma = {
    user: { findUnique: jest.fn(async () => user) },
    userRole: { findMany: jest.fn(async () => grants) },
    userPosition: { findMany: jest.fn(async () => []) },
    permission: { findMany: jest.fn(async () => INTERNAL_PLATFORM_PERMISSION_CODES.map(permission)) },
    organization: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => organizations.find(item => item.id === where.id) ?? null),
      findMany: jest.fn(async ({ where }: { where: { type?: string; id?: { in: string[] }; status?: string } }) => organizations.filter(item => (!where.type || item.type === where.type) && (!where.status || item.status === where.status) && (!where.id || where.id.in.includes(item.id)))),
    },
  };
  return { home, target, hidden, actor, user, grants, prisma, role, service: new ConsoleContextService(prisma as never) };
}

describe('console context management capability projection', () => {
  it.each([
    ['console:api:read', 'api-monitoring'],
    ['console:exchanges:read', 'data-exchanges'],
    ['console:services:read', 'services'],
  ])('exposes only the explicitly assigned observation capability %s', async (permission, key) => {
    const f = fixture([permission]);
    expect((await f.service.context(f.actor)).modules).toEqual([
      { key, scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: 'home', permissions: [permission] },
    ]);
    await expect(f.service.context(f.actor, 'target')).rejects.toMatchObject({ status: 403 });
  });
  it('does not derive observation reads from a platform marker alone', async () => {
    const f = fixture(['platform:admin']);
    const context = await f.service.context(f.actor);
    expect(context.modules.map(item => item.key)).not.toEqual(expect.arrayContaining(['api-monitoring', 'data-exchanges', 'services']));
  });
  it('allows only workflow management without leaking the user module or unrelated directory', async () => {
    const f = fixture(['workflow:manage', 'workflow:act', 'account:users:read-unknown']);
    const context = await f.service.context(f.actor);
    expect(context.actor).toEqual({ id: f.actor.id, accountType: 'INTERNAL', homeOrganization: expect.objectContaining({ id: 'home' }) });
    expect(context.targetOrganization.id).toBe('home');
    expect(context.organizations.map(item => item.id)).toEqual(['home']);
    expect(context.modules).toEqual([{ key: 'workflows', scope: 'SESSION_HOME', coverage: 'ORGANIZATION', organizationId: 'home', permissions: ['workflow:manage'] }]);
  });
  it.each([[], ['workflow:act', 'problem-index:read'], ['material-master:read', 'supplier-quality:profiles:read', 'customer-quality:complaints:read', 'component-project:read']].map(codes => ({ codes })))('rejects ordinary internal business permissions $codes before listing organizations', async ({ codes }) => {
    const f = fixture(codes);
    await expect(f.service.context(f.actor)).rejects.toMatchObject({ status: 403 });
    expect(f.prisma.organization.findMany).not.toHaveBeenCalled();
  });
  it.each(['account:users:read', 'configuration:read', 'outbox:read', 'audit:read', 'organization:structure:read'])('allows actual management capability %s', async code => {
    const f = fixture([code]);
    expect((await f.service.context(f.actor)).modules).toEqual([expect.objectContaining({ scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: 'home', permissions: [code] })]);
  });
  it.each(['material-master:write', 'material-master:import', 'supplier-quality:profiles:write', 'customer-quality:complaints:write', 'component-project:manage'])('preserves existing master maintenance %s without platform identity', async code => {
    const f = fixture([code]);
    expect((await f.service.context(f.actor)).modules).toEqual([{ key: 'master-data', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: 'home', permissions: [code] }]);
  });
  it('rejects supplier identities even with explicit internal management permissions', async () => {
    const f = fixture(['platform:admin', 'account:users:read', 'workflow:manage'], 'SUPPLIER');
    await expect(f.service.context(f.actor)).rejects.toMatchObject({ status: 403 });
    expect(f.prisma.userRole.findMany).not.toHaveBeenCalled();
    expect(f.prisma.organization.findMany).not.toHaveBeenCalled();
  });
  it.each(['DISABLED', 'configuration-required', 'deleted'])('rejects an invalid current subject: %s', async state => {
    const f = fixture(['account:users:read']);
    if (state === 'DISABLED') f.user.status = 'DISABLED';
    if (state === 'configuration-required') f.user.configurationRequired = true;
    if (state === 'deleted') f.user.deletedAt = new Date() as never;
    await expect(f.service.context(f.actor)).rejects.toMatchObject({ status: 401 });
  });
  it('uses explicit organization scope and preserves actor home while locking workflow to home', async () => {
    const f = fixture(['workflow:manage']);
    f.grants.push({ organizationId: 'target', role: f.role('target', ['account:users:read', 'workflow:manage']) });
    const context = await f.service.context(f.actor, 'target');
    expect(context.actor.homeOrganization.id).toBe('home');
    expect(context.targetOrganization.id).toBe('target');
    expect(context.organizations.map(item => item.id)).toEqual(['home', 'target']);
    expect(context.modules).toEqual(expect.arrayContaining([
      { key: 'users', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: 'target', permissions: ['account:users:read'] },
      { key: 'workflows', scope: 'SESSION_HOME', coverage: 'ORGANIZATION', organizationId: 'home', permissions: ['workflow:manage'] },
    ]));
  });
  it('defaults to the first manageable target when home has no management capabilities', async () => {
    const f = fixture();
    f.grants.push({ organizationId: 'target', role: f.role('target', ['organization:manage']) });
    const result = await f.service.context(f.actor);
    expect(result.actor.homeOrganization.id).toBe('home');
    expect(result.targetOrganization.id).toBe('target');
    expect(result.organizations.map(item => item.id)).toEqual(['target']);
    await expect(f.service.context(f.actor, 'hidden')).rejects.toMatchObject({ status: 403 });
  });
  it.each(['target', 'unknown'])('denies unmanageable target %s before metadata lookup even with cross-target workflow grants', async id => {
    const f = fixture(['workflow:manage']);
    f.grants.push({ organizationId: 'target', role: f.role('target', ['workflow:manage', 'problem-index:read']) });
    await expect(f.service.context(f.actor, id)).rejects.toMatchObject({ status: 403 });
    expect(f.prisma.organization.findUnique).not.toHaveBeenCalled();
    expect(f.prisma.organization.findMany).not.toHaveBeenCalled();
  });
  it('projects platform administration into internal targets, not a fabricated business permission set', async () => {
    const f = fixture(['platform:admin']);
    const context = await f.service.context(f.actor, 'target');
    expect(context.hasPlatformAdministrator).toBe(true);
    expect(context.organizations.map(item => item.id)).toEqual(['home', 'target', 'hidden']);
    expect(context.modules.map(item => item.key)).toEqual(expect.arrayContaining(['users', 'organizations', 'master-data', 'configuration', 'workflows', 'audit', 'outbox', 'reconfiguration', 'problem-reconfiguration', 'supplier-accounts']));
    expect(context.modules.flatMap(item => item.permissions)).not.toEqual(expect.arrayContaining(['workflow:act', 'platform:admin']));
    expect(context.modules.flatMap(item => item.permissions).every(code => INTERNAL_PLATFORM_PERMISSION_CODES.includes(code))).toBe(true);
    for (const key of ['supplier-accounts', 'reconfiguration', 'problem-reconfiguration']) {
      expect(context.modules.find(item => item.key === key)).toMatchObject({ scope: 'SESSION_HOME', coverage: 'PLATFORM', organizationId: 'home' });
    }
  });
  it.each([false, true])('keeps disabled or pending target governance-only (pending=%s)', async pending => {
    const f = fixture(['platform:admin']);
    f.target.status = 'DISABLED'; f.target.configurationRequired = pending;
    const context = await f.service.context(f.actor, 'target');
    expect(context.targetOrganization).toMatchObject({ status: 'DISABLED', configurationRequired: pending });
    const targetModules = context.modules.filter(item => item.scope === 'TARGET');
    expect(targetModules.map(item => item.key)).not.toEqual(expect.arrayContaining(['master-data', 'configuration', 'outbox']));
    expect(targetModules.flatMap(item => item.permissions)).not.toContain('account:users:update');
  });
  it('does not advertise platform-only lifecycle capabilities assigned to an ordinary user', async () => {
    const f = fixture(['account:users:read', 'organization:reconfigure', 'account:users:delete']);
    expect((await f.service.context(f.actor)).modules).toEqual([{ key: 'users', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: 'home', permissions: ['account:users:read'] }]);
  });
  it('rechecks grants on each snapshot and does not reuse revoked capabilities', async () => {
    const f = fixture(['workflow:manage']);
    await f.service.context(f.actor);
    f.grants.length = 0;
    await expect(f.service.context(f.actor)).rejects.toMatchObject({ status: 403 });
  });
});
