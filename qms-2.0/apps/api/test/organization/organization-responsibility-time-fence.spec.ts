import 'reflect-metadata';
import { jest } from '@jest/globals';
import type { Prisma } from '../../src/generated/prisma/client.js';
import type { PrismaService } from '../../src/database/prisma.service.js';
import type { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import type { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { OrganizationResponsibilityService } from '../../src/modules/organization/organization-responsibility.service.js';

const before = new Date('2026-10-27T00:00:00Z');
const effective = new Date('2026-10-27T00:00:01Z');

// Unit contract only; the companion integration cases exercise real time and PostgreSQL locks.
function fixture() {
  const userLocks: string[][] = [];
  const assignment = { id: 'assignment', userId: 'manager', positionId: 'position', startedAt: effective, endedAt: null,
    user: { username: 'manager', fullName: null }, position: { name: 'Manager', version: 1, departmentId: 'section' } };
  const tx = {
    $queryRaw: jest.fn(async (first: Prisma.Sql | TemplateStringsArray, ...args: unknown[]) => {
      const sql = 'strings' in first ? first.strings.join('?') : Array.from(first).join('?');
      const values = 'strings' in first ? first.values : args;
      if (sql.includes('FROM users') && sql.includes('FOR SHARE')) {
        const ids = values.filter((v): v is string => v === 'participant' || v === 'manager');
        userLocks.push(ids);
        return ids.map(id => ({ id }));
      }
      if (sql.includes('FROM department_management_bindings') && sql.includes("responsibility = 'SECTION_MANAGER'")) {
        return [{ id: 'binding', positionId: 'position', departmentId: 'section', version: 1 }];
      }
      if (sql.includes('FROM user_positions a JOIN identity_users')) {
        return values.some(value => value instanceof Date && value >= effective) ? [assignment] : [];
      }
      return [];
    }),
    organization: { findUnique: async () => ({ status: 'ACTIVE', type: 'INTERNAL', version: 1 }) },
    department: { findFirst: async () => ({ id: 'section', status: 'ACTIVE', version: 1 }) },
    userPosition: { findMany: async ({ where }: { where: { startedAt: { lte: Date } } }) => where.startedAt.lte < effective ? [] : [assignment] },
  } as unknown as Prisma.TransactionClient;
  return { tx, userLocks };
}

describe('source transaction responsibility user-lock fence (no database)', () => {
  const service = () => new OrganizationResponsibilityService({} as PrismaService, {} as AdminMutationService, {} as AuditLogService);

  it('rejects a newly effective candidate before any new user lock, even when the later call omits the fence flag', async () => {
    const resolver = service(), f = fixture();
    const initial = await resolver.resolveManagementResponsibilities(f.tx, 'org', 'section', before, ['participant'], true);
    expect(initial.at).toEqual(before);
    expect(initial.responsibilities).toEqual([]);
    const lockedBefore = f.userLocks.length;
    await expect(resolver.resolveManagementResponsibilities(f.tx, 'org', 'section', effective))
      .rejects.toMatchObject({ status: 409, response: { code: 'CONCURRENCY_CONFLICT' } });
    await expect(resolver.resolveManagementResponsibilities(f.tx, 'org', 'section', effective, [], true))
      .rejects.toMatchObject({ status: 409, response: { code: 'CONCURRENCY_CONFLICT' } });
    expect(f.userLocks).toHaveLength(lockedBefore);
    expect(f.userLocks[0]).toEqual(['participant']);
    expect(Object.keys(initial).sort()).toEqual(['at', 'issues', 'organizationId', 'responsibilities', 'sectionDepartmentId']);
    const other = fixture();
    await expect(resolver.resolveManagementResponsibilities(other.tx, 'org', 'section', effective))
      .resolves.toMatchObject({ responsibilities: [expect.objectContaining({ userId: 'manager' })] });
  });

  it('keeps the fourth at and fifth additionalUserIds compatible and unfenced callers resolving at the later time', async () => {
    const resolver = service(), f = fixture();
    await expect(resolver.resolveManagementResponsibilities(f.tx, 'org', 'section', before, ['participant']))
      .resolves.toMatchObject({ at: before, responsibilities: [] });
    expect(f.userLocks[0]).toEqual(['participant']);
    await expect(resolver.resolveManagementResponsibilities(f.tx, 'org', 'section', effective))
      .resolves.toMatchObject({ at: effective, responsibilities: [expect.objectContaining({ userId: 'manager' })] });
  });
});
