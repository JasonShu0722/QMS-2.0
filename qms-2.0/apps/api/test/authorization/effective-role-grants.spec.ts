import { jest } from '@jest/globals';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { effectiveRoleGrants } from '../../src/common/security/effective-role-grants.js';

const now = new Date('2026-10-20T00:00:00.000Z');
const role = (id = 'role-r', organizationId: string | null = 'org-home') => ({
  id, organizationId, code: id, name: id, mfaRequired: true,
  permissions: [
    { permission: { id: 'permission-z', code: 'z:read', name: 'Z' } },
    { permission: { id: 'permission-a', code: 'a:read', name: 'A' } },
  ],
});
const source = (positionId: string, assignmentId: string) => ({ kind: 'POSITION', positionId, assignmentId });

function fixture() {
  const direct = [{ organizationId: 'org-home', role: role() }];
  const positions = ['q', 'p'].map((id) => ({
    id: `assignment-${id}`, organizationId: 'org-home', positionId: `position-${id}`,
    position: { roles: [{ role: role() }] },
  }));
  const prisma = {
    userRole: { findMany: jest.fn(async () => direct) },
    user: { findUnique: jest.fn(async (): Promise<{ organizationId: string } | null> => ({ organizationId: 'org-home' })) },
    userPosition: { findMany: jest.fn(async () => positions) },
  };
  return { direct, positions, prisma, transaction: prisma as unknown as Prisma.TransactionClient };
}

describe('effectiveRoleGrants', () => {
  it('merges direct R and two positions into one role with all three ordered sources', async () => {
    const { transaction } = fixture();
    const grants = await effectiveRoleGrants(transaction, 'user', undefined, now);
    expect(grants).toEqual([{
      organizationId: 'org-home',
      role: { ...role(), permissions: [...role().permissions].reverse() },
      sources: [{ kind: 'DIRECT' }, source('position-p', 'assignment-p'), source('position-q', 'assignment-q')],
    }]);
  });

  it('retains the remaining sources until the final source is withdrawn', async () => {
    const { transaction, positions, direct } = fixture();
    positions.splice(1, 1);
    expect((await effectiveRoleGrants(transaction, 'user', undefined, now))[0]!.sources)
      .toEqual([{ kind: 'DIRECT' }, source('position-q', 'assignment-q')]);
    direct.length = 0;
    expect((await effectiveRoleGrants(transaction, 'user', undefined, now))[0]!.sources)
      .toEqual([source('position-q', 'assignment-q')]);
    positions.length = 0;
    expect(await effectiveRoleGrants(transaction, 'user', undefined, now)).toEqual([]);
  });

  it('keeps multiple real assignments to the same position as distinct sorted sources', async () => {
    const { transaction, positions, direct } = fixture();
    direct.length = 0;
    positions.push({ ...positions[1]!, id: 'assignment-a' });
    expect((await effectiveRoleGrants(transaction, 'user', undefined, now))[0]!.sources).toEqual([
      source('position-p', 'assignment-a'), source('position-p', 'assignment-p'), source('position-q', 'assignment-q'),
    ]);
  });

  it('preserves all explicit organizations including global-role assignments and sorts by organization then role id', async () => {
    const { transaction, direct, positions } = fixture();
    positions.length = 0;
    direct.unshift({ organizationId: 'org-z', role: role('role-r', null) });
    direct.push({ organizationId: 'org-home', role: role('role-a') });
    const grants = await effectiveRoleGrants(transaction, 'user', undefined, now);
    expect(grants.map((grant) => [grant.organizationId, grant.role.id])).toEqual([
      ['org-home', 'role-a'], ['org-home', 'role-r'], ['org-z', 'role-r'],
    ]);
    expect(grants[2]!.role.organizationId).toBeNull();
    expect(grants.every((grant) => grant.sources.length === 1 && grant.sources[0]!.kind === 'DIRECT')).toBe(true);
  });

  it('filters direct grants by the requested organization and never reads home positions for another organization', async () => {
    const { transaction, prisma, positions } = fixture();
    prisma.userRole.findMany.mockResolvedValue([{ organizationId: 'org-other', role: role('role-other', 'org-other') }]);
    const grants = await effectiveRoleGrants(transaction, 'user', 'org-other', now);
    expect(grants.map((grant) => grant.organizationId)).toEqual(['org-other']);
    expect(prisma.userRole.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user', OR: expect.arrayContaining([{ organizationId: 'org-other' }]) } }));
    expect(prisma.userPosition.findMany).not.toHaveBeenCalled();
    expect(positions).toHaveLength(2);
  });

  it('requires active home organization, position and direct department and exact temporal boundaries in the real Prisma query', async () => {
    const { transaction, prisma } = fixture();
    await effectiveRoleGrants(transaction, 'user', 'org-home', now);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user' }, select: { organizationId: true, status: true, accountType: true, organization: { select: { status: true, type: true } } } });
    expect(prisma.userPosition.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: 'user', organizationId: 'org-home',
        organization: { status: 'ACTIVE' },
        startedAt: { lte: now }, OR: [{ endedAt: null }, { endedAt: { gt: now } }],
        position: { status: 'ACTIVE', department: { status: 'ACTIVE' } },
      },
    }));
  });

  it('uses the current time by default', async () => {
    const { transaction, prisma } = fixture();
    const before = Date.now();
    await effectiveRoleGrants(transaction, 'user');
    const args = prisma.userPosition.findMany.mock.calls[0] as unknown as [{ where: { startedAt: { lte: Date } } }];
    expect(args[0].where.startedAt.lte.getTime()).toBeGreaterThanOrEqual(before);
    expect(args[0].where.startedAt.lte.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('keeps original direct authorization when the position mapping is empty without writing UserRole', async () => {
    const { transaction, positions, prisma } = fixture();
    positions.forEach((assignment) => { assignment.position.roles = []; });
    expect(await effectiveRoleGrants(transaction, 'user', undefined, now)).toEqual([{
      organizationId: 'org-home', role: { ...role(), permissions: [...role().permissions].reverse() }, sources: [{ kind: 'DIRECT' }],
    }]);
    expect(Object.keys(prisma.userRole)).toEqual(['findMany']);
  });

  it('returns no grants for a missing user with no direct assignments', async () => {
    const { transaction, direct, prisma } = fixture();
    direct.length = 0;
    prisma.user.findUnique.mockResolvedValue(null);
    expect(await effectiveRoleGrants(transaction, 'missing', undefined, now)).toEqual([]);
    expect(prisma.userPosition.findMany).not.toHaveBeenCalled();
  });

  it('does not hide real position query failures behind a direct-only fallback', async () => {
    const { transaction, prisma } = fixture();
    const failure = new Error('database unavailable');
    prisma.userPosition.findMany.mockRejectedValue(failure);
    await expect(effectiveRoleGrants(transaction, 'user', undefined, now)).rejects.toBe(failure);
  });
});
