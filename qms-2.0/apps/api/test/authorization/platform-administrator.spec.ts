import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { Prisma } from '../../src/generated/prisma/client.js';
import * as grantsApi from '../../src/common/security/effective-role-grants.js';
import * as catalog from '../../src/modules/authorization/permission-catalog.js';
import { assertPositionRoleCeiling } from '../../src/common/security/position-role-policy.js';
import { featurePredicate, assignmentPredicate } from '../../src/modules/workflow/workflow-access-policy.js';
import { effectiveRoleMembershipSql } from '../../src/common/security/effective-role-membership.sql.js';
import { isGovernancePermission } from '../../src/common/security/session-security.js';

const marker = 'platform:admin';
const now = new Date('2026-10-26T12:00:00Z');
const permission = (code: string) => ({ id: code, code, name: code });
const role = (codes = [marker]) => ({ id: 'role', organizationId: 'home', code: 'REAL_ADMIN', name: 'Explicit administrator', mfaRequired: false, permissions: codes.map(code => ({ permission: permission(code) })) });

function fixture() {
  const user = { organizationId: 'home', status: 'ACTIVE', accountType: 'INTERNAL', organization: { status: 'ACTIVE', type: 'INTERNAL' } };
  const direct = [{ organizationId: 'home', role: role() }];
  const positions = [{ id: 'appointment', organizationId: 'home', positionId: 'position', position: { roles: [{ role: role() }] } }];
  const organizations = [{ id: 'home', status: 'ACTIVE' }, { id: 'other', status: 'ACTIVE' }];
  const prisma = {
    user: { findUnique: jest.fn(async () => user) },
    userRole: { findMany: jest.fn(async () => direct) },
    userPosition: { findMany: jest.fn(async () => positions) },
    organization: { findMany: jest.fn(async () => organizations) },
    permission: { findMany: jest.fn(async () => [marker, 'workflow:act', 'audit:read', 'process-quality:issues:read', 'supplier-quality:responses:write', 'workbench:read', 'quality-data:metrics:read', 'unknown:permission'].map(permission)) },
  };
  return { user, direct, positions, organizations, prisma, tx: prisma as unknown as Prisma.TransactionClient };
}

describe('explicit platform administrator', () => {
  it('expands only registered usable INTERNAL permissions across active internal targets and retains real sources', async () => {
    const f = fixture();
    const result = await grantsApi.effectiveRoleGrants(f.tx, 'user', 'other', now);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ organizationId: 'other', role: { id: 'role', code: 'REAL_ADMIN', organizationId: 'home' }, sources: [{ kind: 'DIRECT' }, { kind: 'POSITION', positionId: 'position', assignmentId: 'appointment' }] });
    expect(result[0]!.role.permissions.map(({ permission }) => permission.code)).toEqual([marker, 'workflow:act', 'audit:read', 'process-quality:issues:read'].sort());
    expect(f.prisma.organization.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { type: 'INTERNAL' } }));
  });

  it('includes future active internal organizations without writing assignments', async () => {
    const f = fixture();
    f.organizations.push({ id: 'future', status: 'ACTIVE' });
    expect((await grantsApi.effectiveRoleGrants(f.tx, 'user', undefined, now)).map(grant => grant.organizationId)).toEqual(['future', 'home', 'other']);
    expect(Object.keys(f.prisma.userRole)).toEqual(['findMany']);
  });

  it('does not infer administrator from the five historic management permissions or query the catalogue/organizations for ordinary users', async () => {
    const f = fixture();
    f.direct[0]!.role = role(['organization:read', 'organization:manage', 'account:users:read', 'account:roles:read', 'audit:export']);
    f.positions.length = 0;
    expect((await grantsApi.effectiveRoleGrants(f.tx, 'user', 'home', now))[0]!.role.permissions).toHaveLength(5);
    expect(f.prisma.organization.findMany).not.toHaveBeenCalled();
    expect(f.prisma.permission.findMany).not.toHaveBeenCalled();
  });

  it.each(['supplier', 'disabled-user', 'disabled-home', 'supplier-home'])('does not expand %s even with an explicit marker', async condition => {
    const f = fixture();
    if (condition === 'supplier') f.user.accountType = 'SUPPLIER';
    if (condition === 'disabled-user') f.user.status = 'DISABLED';
    if (condition === 'disabled-home') f.user.organization.status = 'DISABLED';
    if (condition === 'supplier-home') f.user.organization.type = 'SUPPLIER';
    const result = await grantsApi.effectiveRoleGrants(f.tx, 'user', 'other', now);
    expect(result).toEqual([]);
    expect(f.prisma.permission.findMany).not.toHaveBeenCalled();
  });

  it('does not expand into a supplier/disabled/missing target or from an inactive source organization', async () => {
    const f = fixture();
    f.organizations.splice(1);
    expect(await grantsApi.effectiveRoleGrants(f.tx, 'user', 'other', now)).toEqual([]);
    f.organizations.splice(0);
    expect(await grantsApi.effectiveRoleGrants(f.tx, 'user', undefined, now)).toEqual([]);
  });

  it('exports the D seam, keeps independent sources and stops after the last revocation/expiry', async () => {
    const f = fixture();
    const check = (grantsApi as unknown as { hasPlatformAdministrator?: (tx: Prisma.TransactionClient, userId: string, now?: Date) => Promise<boolean> }).hasPlatformAdministrator;
    expect(typeof check).toBe('function');
    expect(await check!(f.tx, 'user', now)).toBe(true);
    f.direct.length = 0;
    expect(await check!(f.tx, 'user', now)).toBe(true);
    expect(f.prisma.userPosition.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ startedAt: { lte: now }, OR: [{ endedAt: null }, { endedAt: { gt: now } }] }) }));
    f.positions.length = 0;
    expect(await check!(f.tx, 'user', now)).toBe(false);
    expect(f.prisma.permission.findMany).not.toHaveBeenCalled();
  });

  it('registers the marker without giving it to ordinary admin defaults or allowing an ordinary position permission ceiling to grant it', () => {
    expect(catalog.ACTIVE_PERMISSION_CODES.filter(code => code === marker)).toHaveLength(1);
    expect(catalog.ADMIN_PERMISSIONS).not.toContain(marker);
    const requested = [{ ...role(), permissions: [permission(marker)] }];
    expect(() => assertPositionRoleCeiling(requested, catalog.ADMIN_PERMISSIONS, 'INTERNAL')).toThrow();
    expect(() => assertPositionRoleCeiling(requested, [marker], 'SUPPLIER')).toThrow();
  });

  it('retains only registered organization read/manage for a disabled internal target, never marker or business permissions', async () => {
    const f = fixture();
    f.organizations[1]!.status = 'DISABLED';
    f.prisma.permission.findMany.mockResolvedValue([marker, 'workflow:act', 'organization:read', 'organization:manage'].map(permission));
    const result = await grantsApi.effectiveRoleGrants(f.tx, 'user', 'other', now);
    expect(result.flatMap(grant => grant.role.permissions.map(({ permission }) => permission.code))).toEqual(['organization:manage', 'organization:read']);
    f.organizations[0]!.status = 'DISABLED';
    expect(await grantsApi.effectiveRoleGrants(f.tx, 'user', 'other', now)).toEqual([]);
  });

  it('treats the explicit marker as governance for existing MFA/session lifetime policy', () => {
    expect(isGovernancePermission(marker)).toBe(true);
  });

  it('uses the same usable INTERNAL directory in the SQL marker branch, not role membership or assignee bypasses', () => {
    const predicate = featurePredicate(Prisma.sql`actor.id`, Prisma.sql`target.id`, Prisma.sql`requested.code`);
    expect(predicate.values).toContain(marker);
    expect(predicate.values).toContain('workflow:act');
    expect(predicate.values).not.toContain('supplier-quality:responses:write');
    expect(predicate.values).not.toContain('quality-data:metrics:read');
    expect(predicate.text).toContain("'INTERNAL'");
    expect(predicate.text).toContain('statement_timestamp()');
    expect(effectiveRoleMembershipSql(Prisma.sql`actor.id`, Prisma.sql`target.id`).values).not.toContain(marker);
    expect(assignmentPredicate(Prisma.sql`actor.id`, Prisma.sql`target.id`, Prisma.sql`node.assignment`).text).toContain("->>'assigneeUserId'");
  });

  it('adds a new permission-only migration, without granting any account or changing the schema', () => {
    const sql = readFileSync(new URL('../../prisma/migrations/20261026120000_platform_administrator_permission/migration.sql', import.meta.url), 'utf8');
    expect(sql).toContain(marker);
    expect(sql).toMatch(/INSERT INTO\s+"?permissions/i);
    expect(sql).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+"?(?:users|roles|role_permissions|user_roles|user_positions)/i);
  });
});
