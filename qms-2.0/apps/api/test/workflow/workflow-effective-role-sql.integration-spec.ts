import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { Client } from 'pg';
import { PrismaService } from '../../src/database/prisma.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { effectiveRoleGrants } from '../../src/common/security/effective-role-grants.js';
import { effectiveRoleMembershipSql } from '../../src/common/security/effective-role-membership.sql.js';
import {
  assertWorkflowFeature, assignmentPredicate, canProcessWorkflowNode, featurePredicate, workflowAccessPredicate,
} from '../../src/modules/workflow/workflow-access-policy.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)
  || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('REQ22 SQL tests require explicitly disposable loopback PostgreSQL; preview 55440 is forbidden.');
}
jest.setTimeout(30_000);

describe('workflow SQL effective roles on disposable PostgreSQL', () => {
  const prisma = new PrismaService();
  const organizations: string[] = [];
  const roles: string[] = [];
  let actPermissionId: string;
  let extraPermissionId: string;
  let f: Awaited<ReturnType<typeof fixture>>;

  beforeAll(async () => {
    await prisma.$connect();
    actPermissionId = (await prisma.permission.findUniqueOrThrow({ where: { code: 'workflow:act' } })).id;
    extraPermissionId = (await prisma.permission.findUniqueOrThrow({ where: { code: 'workflow:start' } })).id;
  });
  afterAll(async () => prisma.$disconnect());
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => {
    await prisma.userRole.deleteMany({ where: { organizationId: { in: organizations } } });
    await prisma.positionRole.deleteMany({ where: { organizationId: { in: organizations } } });
    await prisma.userPosition.deleteMany({ where: { organizationId: { in: organizations } } });
    await prisma.position.deleteMany({ where: { organizationId: { in: organizations } } });
    await prisma.department.updateMany({ where: { organizationId: { in: organizations } }, data: { parentId: null } });
    await prisma.department.deleteMany({ where: { organizationId: { in: organizations } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: organizations } } });
    await prisma.role.deleteMany({ where: { id: { in: roles } } });
    await prisma.organization.updateMany({ where: { id: { in: organizations } }, data: { parentId: null } });
    await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
    organizations.length = 0;
    roles.length = 0;
  });

  async function role(organizationId: string | null, permissionIds: string[] = [actPermissionId, extraPermissionId]) {
    const result = await prisma.role.create({ data: {
      organizationId, code: randomUUID(), name: 'REQ22 SQL role',
      permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
    } });
    roles.push(result.id);
    return result;
  }

  async function fixture() {
    const home = await prisma.organization.create({ data: { code: randomUUID(), name: 'REQ22 SQL home', type: 'INTERNAL' } });
    organizations.push(home.id);
    const other = await prisma.organization.create({ data: { code: randomUUID(), name: 'REQ22 SQL other', type: 'INTERNAL' } });
    organizations.push(other.id);
    const user = await prisma.user.create({ data: { organizationId: home.id, username: randomUUID(), passwordHash: 'not-a-login-fixture', accountType: 'INTERNAL' } });
    const department = await prisma.department.create({ data: { organizationId: home.id, code: randomUUID(), name: 'Direct department' } });
    const mainRole = await role(home.id);
    const positions = [];
    const assignments = [];
    for (let index = 0; index < 2; index++) {
      const position = await prisma.position.create({ data: { organizationId: home.id, departmentId: department.id, code: randomUUID(), name: 'SQL position' } });
      positions.push(position);
      assignments.push(await prisma.userPosition.create({ data: {
        organizationId: home.id, userId: user.id, positionId: position.id, startedAt: new Date(Date.now() - 60_000),
      } }));
      await prisma.positionRole.create({ data: { organizationId: home.id, positionId: position.id, roleId: mainRole.id } });
    }
    const actor = { id: user.id, organizationId: home.id, accountType: 'INTERNAL' as const };
    const assignment = { roleCode: mainRole.code, permission: 'workflow:start', assigneeUserId: user.id };
    return { home, other, user, department, mainRole, positions, assignments, actor, assignment };
  }

  const sqlUser = () => Prisma.sql`${f.user.id}::uuid`;
  const sqlHome = () => Prisma.sql`${f.home.id}::uuid`;
  async function feature(organizationId = f.home.id, code = 'workflow:act', tx: Prisma.TransactionClient = prisma) {
    const [result] = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`SELECT ${featurePredicate(sqlUser(), Prisma.sql`${organizationId}::uuid`, Prisma.sql`${code}`)} AS allowed`);
    return result!.allowed;
  }
  async function matches(assignment: unknown, tx: Prisma.TransactionClient = prisma) {
    const [result] = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`SELECT ${assignmentPredicate(sqlUser(), sqlHome(), Prisma.sql`${JSON.stringify(assignment)}::jsonb`)} AS allowed`);
    return result!.allowed;
  }
  async function parity(allowed: boolean, tx: Prisma.TransactionClient = prisma, organizationId = f.home.id) {
    const grants = await roleIdsAgree(tx, organizationId);
    expect(grants.some((grant) => grant.role.permissions.some(({ permission }) => permission.code === 'workflow:act'))).toBe(allowed);
    expect(await feature(organizationId, 'workflow:act', tx)).toBe(allowed);
    expect(await canProcessWorkflowNode(tx, f.user.id, organizationId, f.assignment)).toBe(allowed);
  }
  async function roleIdsAgree(tx: Prisma.TransactionClient = prisma, organizationId = f.home.id, at?: Date) {
    const grants = await effectiveRoleGrants(tx, f.user.id, organizationId, at);
    const memberships = await tx.$queryRaw<{ role_id: string }[]>(effectiveRoleMembershipSql(
      sqlUser(), Prisma.sql`${organizationId}::uuid`, at === undefined ? undefined : Prisma.sql`${at}::timestamptz`,
    ));
    expect(memberships.map((entry) => entry.role_id).sort()).toEqual(grants.map((grant) => grant.role.id).sort());
    return grants;
  }
  async function removePositions(tx: Prisma.TransactionClient = prisma) {
    await tx.positionRole.deleteMany({ where: { organizationId: f.home.id } });
  }
  async function direct(roleId = f.mainRole.id, organizationId = f.home.id) {
    await prisma.userRole.create({ data: { userId: f.user.id, roleId, organizationId } });
  }

  it('authorizes position-only feature checks used by workflow and attachment adapters', async () => {
    expect(await prisma.userRole.count({ where: { userId: f.user.id } })).toBe(0);
    expect((await effectiveRoleGrants(prisma, f.user.id, f.home.id))[0]!.sources).toHaveLength(2);
    await expect(assertWorkflowFeature(prisma, f.actor, f.home.id, 'workflow:act')).resolves.toBeUndefined();
    await parity(true);
  });

  it('authorizes a position-only roleCode node with permission and exact assignee constraints', async () => {
    expect(await matches(f.assignment)).toBe(true);
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.home.id, f.assignment)).toBe(true);
    expect(await matches(f.mainRole.code)).toBe(true);
  });

  it('keeps direct grants and multiple positions until the final source is withdrawn', async () => {
    await direct();
    await parity(true);
    await prisma.userRole.deleteMany({ where: { userId: f.user.id } });
    await parity(true);
    await prisma.positionRole.deleteMany({ where: { positionId: f.positions[0]!.id } });
    await parity(true);
    await prisma.userPosition.update({ where: { id: f.assignments[1]!.id }, data: { endedAt: new Date() } });
    await parity(false);
    expect(await prisma.userRole.count({ where: { userId: f.user.id } })).toBe(0);
    await expect(assertWorkflowFeature(prisma, f.actor, f.home.id, 'workflow:act')).rejects.toMatchObject({ response: { code: 'FEATURE_PERMISSION_DENIED' } });
  });

  it('preserves direct-only roles when all position mappings are absent', async () => {
    await removePositions();
    await direct();
    await parity(true);
    await prisma.userRole.deleteMany({ where: { userId: f.user.id } });
    await parity(false);
  });

  it.each(['permission', 'roleCode', 'assigneeUserId'] as const)('requires the %s constraint as well as the other node constraints', async (key) => {
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.home.id, f.assignment)).toBe(true);
    const invalid = { ...f.assignment, [key]: key === 'assigneeUserId' ? randomUUID() : 'missing:req22' };
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.home.id, invalid)).toBe(false);
  });

  it('unions permission and roleCode eligibility independently across different effective roles', async () => {
    const handler = await role(f.home.id, []);
    await prisma.positionRole.deleteMany({ where: { positionId: f.positions[1]!.id } });
    await prisma.positionRole.create({ data: { organizationId: f.home.id, positionId: f.positions[1]!.id, roleId: handler.id } });
    const assignment = { ...f.assignment, roleCode: handler.code };
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.home.id, assignment)).toBe(true);
    await prisma.positionRole.deleteMany({ where: { roleId: f.mainRole.id } });
    expect(await matches(handler.code)).toBe(true);
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.home.id, assignment)).toBe(false);
    await direct();
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.home.id, assignment)).toBe(true);
  });

  it.each([null, [], 12, {}, '', ' ', { roleCode: 12 }, { permission: null }, { assigneeUserId: [] },
    { roleCode: ' ' }, { permission: '' }, { assigneeUserId: '' }])('retains fail-closed assignment JSON validation: %j', async (assignment) => {
    await direct();
    expect(await matches(assignment)).toBe(false);
  });

  it.each(['future', 'ended'] as const)('excludes %s appointments consistently with the existing helper', async (state) => {
    await prisma.userPosition.updateMany({ where: { userId: f.user.id }, data: state === 'future'
      ? { startedAt: new Date(Date.now() + 60_000) } : { endedAt: new Date(Date.now() - 1_000) } });
    await parity(false);
  });

  it.each([
    ['start at judgment time', 0, null, true],
    ['start after judgment time', 1, null, false],
    ['end at judgment time', -1, 0, false],
    ['end before judgment time', -2, -1, false],
    ['end after judgment time', 0, 1, true],
  ] as const)('matches helper role IDs at the exact millisecond boundary: %s', async (_label, startOffset, endOffset, allowed) => {
    const at = new Date('2026-10-20T00:00:00.000Z');
    await prisma.userPosition.updateMany({ where: { userId: f.user.id }, data: {
      startedAt: new Date(at.getTime() + startOffset), endedAt: endOffset === null ? null : new Date(at.getTime() + endOffset),
    } });
    expect(await roleIdsAgree(prisma, f.home.id, at)).toHaveLength(allowed ? 1 : 0);
  });

  it.each(['position', 'department', 'organization'] as const)('excludes disabled %s inheritance while retaining explicit direct membership', async (target) => {
    if (target === 'position') await prisma.position.updateMany({ where: { organizationId: f.home.id }, data: { status: 'DISABLED' } });
    if (target === 'department') await prisma.department.update({ where: { id: f.department.id }, data: { status: 'DISABLED' } });
    if (target === 'organization') await prisma.organization.update({ where: { id: f.home.id }, data: { status: 'DISABLED' } });
    await parity(false);
    await direct();
    await roleIdsAgree();
    expect(await feature()).toBe(true);
    expect(await matches(f.assignment)).toBe(true);
    expect((await effectiveRoleGrants(prisma, f.user.id, f.home.id))[0]!.sources).toEqual([{ kind: 'DIRECT' }]);
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.home.id, f.assignment)).toBe(target !== 'organization');
  });

  it('checks only the direct department and does not propagate ancestor organization or department state', async () => {
    const ancestor = await prisma.department.create({ data: { organizationId: f.home.id, code: randomUUID(), name: 'Disabled ancestor', status: 'DISABLED' } });
    await prisma.department.update({ where: { id: f.department.id }, data: { parentId: ancestor.id } });
    await prisma.organization.update({ where: { id: f.home.id }, data: { parentId: f.other.id } });
    await prisma.organization.update({ where: { id: f.other.id }, data: { status: 'DISABLED' } });
    await parity(true);
  });

  it('retains global and internal cross-organization direct roles without inheriting home positions into the target', async () => {
    expect(await feature(f.other.id)).toBe(false);
    const foreignRole = await role(f.other.id);
    await direct(foreignRole.id, f.other.id);
    await roleIdsAgree(prisma, f.other.id);
    expect(await feature(f.other.id)).toBe(true);
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.other.id, { roleCode: foreignRole.code })).toBe(true);
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.other.id, f.assignment)).toBe(false);
    const global = await role(null);
    await direct(global.id, f.other.id);
    await prisma.userRole.deleteMany({ where: { userId: f.user.id, roleId: foreignRole.id } });
    await roleIdsAgree(prisma, f.other.id);
    expect(await feature(f.other.id)).toBe(true);
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.other.id, global.code)).toBe(true);
    // Legacy mismatched direct role scopes must not become valid SQL authorization.
    await prisma.userRole.deleteMany({ where: { userId: f.user.id } });
    await direct(f.mainRole.id, f.other.id);
    await roleIdsAgree(prisma, f.other.id);
    expect(await feature(f.other.id)).toBe(false);
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.other.id, f.mainRole.code)).toBe(false);
  });

  it('rejects supplier cross-organization access even with a direct role there', async () => {
    await prisma.organization.update({ where: { id: f.home.id }, data: { type: 'SUPPLIER' } });
    await prisma.user.update({ where: { id: f.user.id }, data: { accountType: 'SUPPLIER' } });
    const actor = { ...f.actor, accountType: 'SUPPLIER' as const };
    const foreignRole = await role(f.other.id);
    await direct(foreignRole.id, f.other.id);
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.home.id, f.assignment)).toBe(true);
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.other.id, foreignRole.code)).toBe(false);
    await expect(assertWorkflowFeature(prisma, actor, f.other.id, 'workflow:act')).rejects.toMatchObject({ response: { code: 'ORGANIZATION_SCOPE_DENIED' } });
  });

  it('retains active actor and live home/target organization checks', async () => {
    await prisma.user.update({ where: { id: f.user.id }, data: { status: 'DISABLED' } });
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.home.id, f.assignment)).toBe(false);
    await expect(assertWorkflowFeature(prisma, f.actor, f.home.id, 'workflow:act')).rejects.toMatchObject({ response: { code: 'AUTH_SESSION_REQUIRED' } });
    await prisma.user.update({ where: { id: f.user.id }, data: { status: 'ACTIVE' } });
    const foreign = await role(f.other.id);
    await direct(foreign.id, f.other.id);
    await prisma.organization.update({ where: { id: f.other.id }, data: { status: 'DISABLED' } });
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.other.id, foreign.code)).toBe(false);
    await expect(assertWorkflowFeature(prisma, f.actor, f.other.id, 'workflow:act')).rejects.toMatchObject({ response: { code: 'ORGANIZATION_DISABLED' } });
    await prisma.organization.update({ where: { id: f.other.id }, data: { status: 'ACTIVE' } });
    await prisma.organization.update({ where: { id: f.home.id }, data: { status: 'DISABLED' } });
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.other.id, foreign.code)).toBe(false);
  });

  it('supports correlated SQL authorization before pagination', async () => {
    await prisma.user.create({ data: {
      organizationId: f.home.id, username: randomUUID(), passwordHash: 'not-a-login-fixture', accountType: 'INTERNAL',
    } });
    const result = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT actor.id FROM users actor
      WHERE actor.organization_id = ${f.home.id}::uuid
        AND ${workflowAccessPredicate(Prisma.sql`actor.id`, Prisma.sql`actor.organization_id`, Prisma.sql`${JSON.stringify(f.assignment)}::jsonb`)}
      ORDER BY (actor.id = ${f.user.id}::uuid), actor.id LIMIT 1`);
    expect(result).toEqual([{ id: f.user.id }]);
    expect(await feature(f.home.id, "workflow:act' OR true --")).toBe(false);
    expect(await matches({ roleCode: `${f.mainRole.code}' OR true --` })).toBe(false);
  });

  it('sees mapping and permission revocation within a real transaction and restores rolled-back grants', async () => {
    const rollback = new Error('REQ22 SQL rollback');
    await expect(prisma.$transaction(async (tx) => {
      await parity(true, tx);
      await removePositions(tx);
      await parity(false, tx);
      throw rollback;
    })).rejects.toBe(rollback);
    await parity(true);
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: f.mainRole.id, permissionId: actPermissionId } });
      expect(await matches(f.assignment, tx)).toBe(true);
      expect(await feature(f.home.id, 'workflow:act', tx)).toBe(false);
      expect(await canProcessWorkflowNode(tx, f.user.id, f.home.id, f.assignment)).toBe(false);
    });
    expect(await feature()).toBe(false);
  });

  it('rechecks appointment expiry after a real row-lock wait inside the same transaction', async () => {
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM users WHERE id = $1::uuid FOR UPDATE', [f.user.id]);
      await prisma.$executeRaw`UPDATE user_positions SET ended_at = statement_timestamp() + interval '2 seconds' WHERE user_id = ${f.user.id}::uuid`;
      await prisma.$transaction(async (tx) => {
        await parity(true, tx);
        const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        const waiting = tx.$queryRaw`SELECT id FROM users WHERE id = ${f.user.id}::uuid FOR UPDATE`;
        const locked = Promise.resolve(waiting);
        let observedWait = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const result = await blocker.query<{ blocked: boolean }>('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [backend!.pid]);
          if (result.rows[0]!.blocked) { observedWait = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await blocker.query('SELECT pg_sleep(2.1)');
        await blocker.query('ROLLBACK');
        await locked;
        expect(observedWait).toBe(true);
        const [clock] = await tx.$queryRaw<{ transaction_active: boolean; statement_active: boolean }[]>(Prisma.sql`SELECT
          ended_at > transaction_timestamp() AS transaction_active, ended_at > statement_timestamp() AS statement_active
          FROM user_positions WHERE id = ${f.assignments[0]!.id}::uuid`);
        expect(clock).toEqual({ transaction_active: true, statement_active: false });
        await parity(false, tx);
      }, { timeout: 15_000 });
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
    }
  });
});
