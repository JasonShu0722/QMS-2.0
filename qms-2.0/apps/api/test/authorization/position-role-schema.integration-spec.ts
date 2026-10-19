import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { jest } from '@jest/globals';
import { Client } from 'pg';
import { PrismaService } from '../../src/database/prisma.service.js';
import { effectiveRoleGrants, type EffectiveRoleGrantClient } from '../../src/common/security/effective-role-grants.js';

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl ? new URL(databaseUrl) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)
  || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('Position roles require explicitly disposable loopback PostgreSQL; preview 55440 is forbidden.');
}
jest.setTimeout(120_000);

const migrationName = '20261020010000_position_roles';
const migrations = new URL('../../prisma/migrations/', import.meta.url);
const now = new Date('2026-10-20T00:00:00.000Z');

describe('position role migration and effective grants with real PostgreSQL', () => {
  const databaseName = `qms_position_role_${randomUUID().replaceAll('-', '')}`;
  const control = new Client({ connectionString: databaseUrl });
  let client: Client;
  let prisma: PrismaService;
  let databaseCreated = false;
  const legacy = { organization: randomUUID(), user: randomUUID(), department: randomUUID(), position: randomUUID(), role: randomUUID() };
  let directSnapshot: unknown;

  beforeAll(async () => {
    await control.connect();
    await control.query(`CREATE DATABASE ${databaseName}`);
    databaseCreated = true;
    const url = new URL(databaseUrl!);
    url.pathname = `/${databaseName}`;
    client = new Client({ connectionString: url.toString() });
    await client.connect();
    for (const migration of readdirSync(migrations).filter((entry) => /^\d{14}_/.test(entry) && entry < migrationName).sort()) {
      await client.query(readFileSync(new URL(`${migration}/migration.sql`, migrations), 'utf8'));
    }
    await client.query('INSERT INTO organizations (id, code, name, type, updated_at) VALUES ($1::uuid, $1::text, $1::text, \'INTERNAL\', now())', [legacy.organization]);
    await client.query('INSERT INTO users (id, organization_id, username, password_hash, account_type, updated_at) VALUES ($1::uuid, $2, $1::text, \'test-only\', \'INTERNAL\', now())', [legacy.user, legacy.organization]);
    await client.query('INSERT INTO departments (id, organization_id, code, name, updated_at) VALUES ($1::uuid, $2, $1::text, $1::text, now())', [legacy.department, legacy.organization]);
    await client.query('INSERT INTO positions (id, organization_id, department_id, code, name, version, updated_at) VALUES ($1::uuid, $2, $3, $1::text, $1::text, 7, now())', [legacy.position, legacy.organization, legacy.department]);
    await client.query('INSERT INTO user_positions (id, organization_id, user_id, position_id, started_at) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), legacy.organization, legacy.user, legacy.position, now]);
    await client.query('INSERT INTO roles (id, organization_id, code, name) VALUES ($1::uuid, $2, $1::text, $1::text)', [legacy.role, legacy.organization]);
    await client.query('INSERT INTO user_roles (user_id, role_id, organization_id) VALUES ($1, $2, $3)', [legacy.user, legacy.role, legacy.organization]);
    directSnapshot = (await client.query('SELECT to_jsonb(r) AS fact FROM user_roles r ORDER BY user_id, role_id, organization_id')).rows;
    await client.query('BEGIN');
    try {
      await client.query(readFileSync(new URL(`${migrationName}/migration.sql`, migrations), 'utf8'));
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    prisma = new PrismaService(url.toString());
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await client?.end();
    try {
      if (databaseCreated) {
        if (!/^qms_position_role_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Unsafe position-role test cleanup target.');
        await control.query(`DROP DATABASE ${databaseName}`);
      }
    } finally { await control.end(); }
  });

  async function fixture() {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Home', type: 'INTERNAL' } });
    const other = await prisma.organization.create({ data: { code: randomUUID(), name: 'Other', type: 'INTERNAL' } });
    const department = await prisma.department.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Direct department' } });
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'test-only', accountType: 'INTERNAL' } });
    const role = await prisma.role.create({ data: {
      organizationId: organization.id, code: randomUUID(), name: 'R', mfaRequired: true,
      permissions: { create: { permission: { create: { code: `position-role:${randomUUID()}:read`, name: 'Read' } } } },
    } });
    const p = await prisma.position.create({ data: { organizationId: organization.id, departmentId: department.id, code: randomUUID(), name: 'P' } });
    const q = await prisma.position.create({ data: { organizationId: organization.id, departmentId: department.id, code: randomUUID(), name: 'Q' } });
    const assignmentP = await prisma.userPosition.create({ data: { organizationId: organization.id, userId: user.id, positionId: p.id, startedAt: now } });
    const assignmentQ = await prisma.userPosition.create({ data: { organizationId: organization.id, userId: user.id, positionId: q.id, startedAt: now } });
    await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: role.id } });
    await prisma.positionRole.createMany({ data: [p, q].map((position) => ({ organizationId: organization.id, positionId: position.id, roleId: role.id })) });
    const read = (scope?: string, at = now) => effectiveRoleGrants(prisma, user.id, scope, at);
    return { organization, other, department, user, role, p, q, assignmentP, assignmentQ, read };
  }

  it('upgrades populated legacy data with empty mappings, independent roleVersion=1 and unchanged direct grants', async () => {
    expect((await client.query('SELECT to_jsonb(r) AS fact FROM user_roles r ORDER BY user_id, role_id, organization_id')).rows).toEqual(directSnapshot);
    expect(await prisma.positionRole.count()).toBe(0);
    expect(await prisma.position.findUniqueOrThrow({ where: { id: legacy.position } })).toMatchObject({ version: 7, roleVersion: 1 });
    expect(await effectiveRoleGrants(prisma, legacy.user, undefined, now)).toEqual([{
      organizationId: legacy.organization,
      role: { id: legacy.role, organizationId: legacy.organization, code: legacy.role, name: legacy.role, mfaRequired: false, permissions: [] },
      sources: [{ kind: 'DIRECT' }],
    }]);
  });

  it.each(['global', 'foreign', 'missing'] as const)('rejects a %s role in a home position', async (kind) => {
    const f = await fixture();
    const roleId = kind === 'missing' ? randomUUID() : (await prisma.role.create({ data: {
      organizationId: kind === 'global' ? null : f.other.id, code: randomUUID(), name: kind,
    } })).id;
    await expect(prisma.positionRole.create({ data: { organizationId: f.organization.id, positionId: f.p.id, roleId } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects a foreign or missing position and a null organization at the database boundary', async () => {
    const f = await fixture();
    const otherRole = await prisma.role.create({ data: { organizationId: f.other.id, code: randomUUID(), name: 'Other' } });
    await expect(prisma.positionRole.create({ data: { organizationId: f.other.id, positionId: f.p.id, roleId: otherRole.id } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.positionRole.create({ data: { organizationId: f.organization.id, positionId: randomUUID(), roleId: f.role.id } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(client.query('INSERT INTO position_roles (organization_id, position_id, role_id) VALUES (NULL, $1, $2)', [f.p.id, f.role.id])).rejects.toMatchObject({ code: '23502' });
    await expect(prisma.userPosition.create({ data: { organizationId: f.other.id, userId: f.user.id, positionId: f.p.id, startedAt: now } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects duplicate associations and restricts deletion or organization moves of referenced roles', async () => {
    const f = await fixture();
    await expect(prisma.positionRole.create({ data: { organizationId: f.organization.id, positionId: f.p.id, roleId: f.role.id } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.role.delete({ where: { id: f.role.id } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.role.update({ where: { id: f.role.id }, data: { organizationId: f.other.id } })).rejects.toMatchObject({ code: 'P2003' });
    expect(await prisma.userRole.count({ where: { userId: f.user.id, roleId: f.role.id } })).toBe(1);
  });

  it('merges three sources and withdraws them dynamically through committed mapping, direct-role and assignment changes', async () => {
    const f = await fixture();
    const grants = await f.read();
    expect(grants).toHaveLength(1);
    expect(grants[0]!.sources).toHaveLength(3);
    expect(grants[0]!.role).toMatchObject({ id: f.role.id, mfaRequired: true, permissions: [{ permission: { name: 'Read' } }] });
    await prisma.$transaction(async (transaction) => {
      await transaction.positionRole.delete({ where: { organizationId_positionId_roleId: { organizationId: f.organization.id, positionId: f.p.id, roleId: f.role.id } } });
      expect((await effectiveRoleGrants(transaction, f.user.id, undefined, now))[0]!.sources).toHaveLength(2);
    });
    expect((await f.read())[0]!.sources).toHaveLength(2);
    await prisma.userRole.deleteMany({ where: { userId: f.user.id } });
    expect((await f.read())[0]!.sources).toEqual([{ kind: 'POSITION', positionId: f.q.id, assignmentId: f.assignmentQ.id }]);
    await prisma.userPosition.update({ where: { id: f.assignmentQ.id }, data: { endedAt: now } });
    expect(await f.read()).toEqual([]);
    expect(await prisma.userRole.count({ where: { userId: f.user.id } })).toBe(0);
  });

  it('keeps every real assignment source and rolls back uncommitted mapping removal', async () => {
    const f = await fixture();
    const another = await prisma.userPosition.create({ data: { organizationId: f.organization.id, userId: f.user.id, positionId: f.p.id, startedAt: now, endedAt: new Date(now.getTime() + 1) } });
    expect((await f.read())[0]!.sources).toContainEqual({ kind: 'POSITION', positionId: f.p.id, assignmentId: another.id });
    expect((await f.read())[0]!.sources).toHaveLength(4);
    const rollback = new Error('test rollback');
    await expect(prisma.$transaction(async (transaction) => {
      await transaction.positionRole.deleteMany({ where: { organizationId: f.organization.id } });
      expect((await effectiveRoleGrants(transaction, f.user.id, undefined, now))[0]!.sources).toEqual([{ kind: 'DIRECT' }]);
      throw rollback;
    })).rejects.toBe(rollback);
    expect((await f.read())[0]!.sources).toHaveLength(4);
  });

  it.each([
    ['future start', new Date(now.getTime() + 1), null, false],
    ['start at now', now, null, true],
    ['past end', new Date(now.getTime() - 2), new Date(now.getTime() - 1), false],
    ['end at now', new Date(now.getTime() - 1), now, false],
    ['future end', now, new Date(now.getTime() + 1), true],
  ] as const)('applies the exact time window: %s', async (_label, startedAt, endedAt, active) => {
    const f = await fixture();
    await prisma.userRole.deleteMany({ where: { userId: f.user.id } });
    await prisma.userPosition.delete({ where: { id: f.assignmentQ.id } });
    await prisma.userPosition.update({ where: { id: f.assignmentP.id }, data: { startedAt, endedAt } });
    expect((await f.read()).length).toBe(active ? 1 : 0);
  });

  it.each(['position', 'department', 'organization'] as const)('excludes disabled %s sources while preserving explicit direct grants', async (target) => {
    const f = await fixture();
    if (target === 'position') await prisma.position.updateMany({ where: { organizationId: f.organization.id }, data: { status: 'DISABLED' } });
    if (target === 'department') await prisma.department.update({ where: { id: f.department.id }, data: { status: 'DISABLED' } });
    if (target === 'organization') await prisma.organization.update({ where: { id: f.organization.id }, data: { status: 'DISABLED' } });
    expect((await f.read())[0]!.sources).toEqual([{ kind: 'DIRECT' }]);
    await prisma.userRole.deleteMany({ where: { userId: f.user.id } });
    expect(await f.read()).toEqual([]);
  });

  it('does not propagate disabled ancestor departments or organization grants', async () => {
    const f = await fixture();
    const parent = await prisma.department.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Disabled ancestor', status: 'DISABLED' } });
    await prisma.department.update({ where: { id: f.department.id }, data: { parentId: parent.id } });
    await prisma.organization.update({ where: { id: f.organization.id }, data: { parentId: f.other.id } });
    const ancestorRole = await prisma.role.create({ data: { organizationId: f.other.id, code: randomUUID(), name: 'Ancestor' } });
    const parentDepartment = await prisma.department.create({ data: { organizationId: f.other.id, code: randomUUID(), name: 'Parent organization' } });
    const parentPosition = await prisma.position.create({ data: { organizationId: f.other.id, departmentId: parentDepartment.id, code: randomUUID(), name: 'Parent position' } });
    await prisma.positionRole.create({ data: { organizationId: f.other.id, positionId: parentPosition.id, roleId: ancestorRole.id } });
    expect((await f.read())[0]!.sources).toHaveLength(3);
    expect(await f.read(f.other.id)).toEqual([]);
  });

  it('filters independent organizations without leaking home positions and preserves cross-organization direct global roles', async () => {
    const f = await fixture();
    const globalRole = await prisma.role.create({ data: { code: randomUUID(), name: 'Global direct template' } });
    await prisma.userRole.createMany({ data: [f.organization, f.other].map((organization) => ({ userId: f.user.id, organizationId: organization.id, roleId: globalRole.id })) });
    const all = await f.read();
    expect(all).toHaveLength(3);
    for (const scope of [f.organization.id, f.other.id]) {
      const filtered = await f.read(scope);
      expect(filtered).toEqual(all.filter((grant) => grant.organizationId === scope));
    }
    expect((await f.read(f.other.id))[0]!.sources).toEqual([{ kind: 'DIRECT' }]);
    expect(await f.read(randomUUID())).toEqual([]);
    const narrowed: EffectiveRoleGrantClient = prisma;
    expect(await effectiveRoleGrants(narrowed, f.user.id, f.other.id, now)).toEqual(await f.read(f.other.id));
  });
});
