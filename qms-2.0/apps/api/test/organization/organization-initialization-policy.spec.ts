import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import type { AdminActor, AdminTransaction } from '../../src/common/security/admin-mutation.service.js';

const codes = ['organization:read', 'organization:manage', 'organization:structure:read', 'organization:structure:manage', 'organization:positions:assign'];

// Policy-only fixtures: these are not PostgreSQL acceptance evidence.
function fixture(legacy = false) {
  const creator = 'creator';
  const createdAt = new Date('2026-10-01T00:00:00.000Z');
  const organization = { id: 'child', parentId: 'parent', type: 'INTERNAL', createdAt };
  const value = { id: 'child', parentId: 'parent', code: 'CHILD', name: 'Child', type: 'INTERNAL', status: 'ACTIVE', version: 1 };
  const grant = { id: 'grant', organizationId: 'child', userId: creator, roleId: 'governor' };
  const role = { id: 'governor', code: 'ORGANIZATION_GOVERNOR', createdAt, mfaRequired: false, permissions: codes.map(code => ({ permission: { code } })), userRoles: [grant], positions: [] as object[] };
  const events = [{ id: 'created', createdAt, actorUserId: creator, resourceId: 'child', resourceType: 'Organization', action: 'ORGANIZATION_CREATED', outcome: 'SUCCESS', metadata: legacy ? { resourceVersion: 1 } : { resourceVersion: 1, organizationId: 'child', structureCode: 'CHILD', structureName: 'Child', structureGovernorRoleId: 'governor', permissionCode: [...codes].sort().join(',') } }];
  const receipts = [{ id: 'receipt', createdAt, actorUserId: creator, organizationId: 'parent', action: 'ORGANIZATION_CREATED', response: { value } }];
  const mutations: typeof receipts = [];
  const roles = [role];
  const grants = [grant];
  const platform = { enabled: false };
  const transaction = {
    $queryRaw: async () => [],
    auditEvent: { findMany: async ({ where }: { where: { action?: string } }) => events.filter(event => !where.action || event.action === where.action) },
    role: { findMany: async () => roles },
    userRole: { findMany: async ({ where }: { where: { userId?: string } }) => where.userId ? platform.enabled ? [{ organizationId: 'parent', role: { id: 'platform', organizationId: 'parent', permissions: [{ permission: { id: 'marker', code: 'platform:admin' } }] } }] : [] : grants },
    user: { findUnique: async () => ({ organizationId: 'parent', accountType: 'INTERNAL', status: 'ACTIVE', organization: { status: 'ACTIVE', type: 'INTERNAL' } }) },
    userPosition: { findMany: async () => [] },
    organization: { findMany: async () => [{ id: 'parent' }] },
    adminMutation: { findMany: async ({ where }: { where: { organizationId: string; actorUserId?: string } }) => where.organizationId === 'parent'
      ? receipts.filter(receipt => !where.actorUserId || receipt.actorUserId === where.actorUserId) : mutations },
  } as unknown as AdminTransaction;
  const service = new OrganizationService(undefined!, undefined!, undefined!, undefined!);
  const inspect = (actorId = creator) => service['initializationAttachments'](transaction, { id: actorId } as AdminActor, organization);
  return { inspect, events, receipts, mutations, roles, grants, role, platform };
}

describe('REQ0030 initialization provenance classification', () => {
  it('keeps the current exact initialization valid', async () => {
    expect(await fixture().inspect()).toMatchObject({ blocked: false, roleId: 'governor' });
  });

  it('accepts original resourceVersion-only audit only with the original exact parent receipt and governance grant', async () => {
    expect(await fixture(true).inspect()).toMatchObject({ blocked: false, roleId: 'governor', creatorUserId: 'creator' });
  });

  it('reports missing provenance separately from extra grants', async () => {
    const f = fixture(true);
    f.receipts.length = 0;
    expect(await f.inspect()).toMatchObject({ blocked: true, details: expect.arrayContaining([expect.objectContaining({ code: 'NON_INITIALIZATION_ROLES', count: 1 })]) });
  });

  it('does not treat a partial modern metadata record as legacy', async () => {
    const f = fixture(true);
    Object.assign(f.events[0]!.metadata, { organizationId: 'child' });
    expect(await f.inspect()).toMatchObject({ blocked: true });
  });

  it('rejects an original receipt attributed to another creator', async () => {
    const f = fixture(true);
    f.receipts[0]!.actorUserId = 'other';
    expect(await f.inspect()).toMatchObject({ blocked: true });
  });

  it('does not identify a replacement same-code role as the legacy bootstrap role', async () => {
    const f = fixture(true);
    f.role.createdAt = new Date('2026-10-02T00:00:00.000Z');
    expect(await f.inspect()).toMatchObject({ blocked: true, details: expect.arrayContaining([
      expect.objectContaining({ code: 'NON_INITIALIZATION_ROLES', count: 1 }),
    ]) });
  });

  it.each(['extra', 'removed', 'business'] as const)('rejects %s permissions rather than repairing history', async kind => {
    const f = fixture(true);
    if (kind === 'removed') f.role.permissions.pop();
    else f.role.permissions.push({ permission: { code: kind === 'business' ? 'audit:read' : 'organization:other' } });
    expect(await f.inspect()).toMatchObject({ blocked: true, details: expect.arrayContaining([expect.objectContaining({ code: 'INITIALIZATION_PERMISSIONS_CHANGED' })]) });
    expect(f.events[0]!.metadata).toEqual({ resourceVersion: 1 });
  });

  it('counts extra grants and never nominates them for cleanup', async () => {
    const f = fixture();
    f.grants.push({ ...f.grants[0]!, id: 'extra', userId: 'other' });
    expect(await f.inspect()).toMatchObject({ blocked: true, roleId: undefined, details: expect.arrayContaining([expect.objectContaining({ code: 'NON_INITIALIZATION_GRANTS', count: 1 })]) });
  });

  it('retains unrelated management events without making them deletion dependencies', async () => {
    const f = fixture();
    f.events.push({ ...f.events[0]!, id: 'used', action: 'ROLE_UPDATED', resourceType: 'Role', resourceId: 'governor' });
    expect(await f.inspect()).toMatchObject({ blocked: false, roleId: 'governor' });
    expect(f.events).toHaveLength(2);
  });

  it('allows a different explicitly authorized platform administrator without changing the initializer grant owner', async () => {
    const f = fixture();
    f.platform.enabled = true;
    expect(await f.inspect('platform-admin')).toMatchObject({ blocked: false, creatorUserId: 'creator', roleId: 'governor' });
  });

  it('does not add creator identity as a blocker; target and parent authorization are checked by the mutation service', async () => {
    expect(await fixture().inspect('other-manager')).toMatchObject({ blocked: false, roleId: 'governor', creatorUserId: 'creator' });
  });
});
