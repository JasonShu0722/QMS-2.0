import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { jest } from '@jest/globals';
import { Client } from 'pg';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService, type AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AdminRoleService } from '../../src/modules/authorization/admin-role.service.js';

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl ? new URL(databaseUrl) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || connection.port === '55440'
  || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) || connection.search || connection.hash) {
  throw new Error('An independent disposable PostgreSQL database is required');
}
jest.setTimeout(60_000);

const migrations = new URL('../../prisma/migrations/', import.meta.url);
const originalMigration = '20261018030000_material_master';
const repairSql = readFileSync(new URL('20261018050000_material_global_governance/migration.sql', migrations), 'utf8');
const materialCodes = ['material-master:import', 'material-master:read', 'material-master:write'];
const governanceCodes = ['organization:manage', 'account:roles:assign'];

describe('global material governance forward migration with real PostgreSQL', () => {
  const databaseName = `qms_material_grant_${randomUUID().replaceAll('-', '')}`;
  const control = new Client({ connectionString: databaseUrl });
  let client: Client;
  let prisma: PrismaService;
  let roles: AdminRoleService;
  let actor: AdminActor;
  let databaseCreated = false;
  const internal = randomUUID();
  const supplier = randomUUID();
  const internalUser = randomUUID();
  const supplierUser = randomUUID();
  const supplierInInternal = randomUUID();
  const internalInSupplier = randomUUID();
  const roleIds: Record<string, string> = {};

  async function grants(roleId: string) {
    const result = await client.query('SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1 AND p.code = ANY($2::text[]) ORDER BY p.code', [roleId, materialCodes]);
    return result.rows.map((row: { code: string }) => row.code);
  }

  beforeAll(async () => {
    await control.connect();
    // The migration may grant many roles: never replay it against the supplied test database.
    await control.query(`CREATE DATABASE ${databaseName}`);
    databaseCreated = true;
    const url = new URL(databaseUrl!);
    url.pathname = `/${databaseName}`;
    client = new Client({ connectionString: url.toString() });
    await client.connect();
    for (const migration of readdirSync(migrations).filter((entry) => entry < originalMigration).sort()) {
      if (/^\d{14}_/.test(migration)) await client.query(readFileSync(new URL(`${migration}/migration.sql`, migrations), 'utf8'));
    }
    prisma = new PrismaService(url.toString());
    await prisma.organization.createMany({ data: [
      { id: internal, code: 'MATERIAL_INTERNAL', name: 'Internal', type: 'INTERNAL' },
      { id: supplier, code: 'MATERIAL_SUPPLIER', name: 'Supplier', type: 'SUPPLIER' },
    ] });
    // Seed only historical columns: the current Prisma client supplies profile_version.
    for (const [id, organizationId, accountType, username] of [
      [internalUser, internal, 'INTERNAL', 'internal'],
      [supplierUser, supplier, 'SUPPLIER', 'supplier'],
      [supplierInInternal, internal, 'SUPPLIER', 'supplier-account'],
      [internalInSupplier, supplier, 'INTERNAL', 'supplier-home'],
    ]) {
      await client.query('INSERT INTO users (id, organization_id, account_type, username, password_hash, updated_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)', [id, organizationId, accountType, username, 'test-only']);
    }
    for (const code of [...governanceCodes, 'account:roles:read', 'account:roles:create', 'account:roles:update']) {
      await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
    }
    const fixtures = [
      { name: 'globalGovernance', codes: [...governanceCodes, 'account:roles:read', 'account:roles:create', 'account:roles:update'], assignments: [[internalUser, internal]] },
      { name: 'manageOnly', codes: [governanceCodes[0]!], assignments: [[internalUser, internal]] },
      { name: 'assignOnly', codes: [governanceCodes[1]!], assignments: [[internalUser, internal]] },
      { name: 'ordinary', codes: [], assignments: [[internalUser, internal]] },
      { name: 'unassigned', codes: governanceCodes, assignments: [] },
      { name: 'supplierOnly', codes: governanceCodes, assignments: [[supplierUser, supplier]] },
      { name: 'mixedSupplier', codes: governanceCodes, assignments: [[internalUser, internal], [supplierUser, supplier]] },
      { name: 'supplierAccount', codes: governanceCodes, assignments: [[internalUser, internal], [supplierInInternal, internal]] },
      { name: 'supplierScope', codes: governanceCodes, assignments: [[internalUser, internal], [internalUser, supplier]] },
      { name: 'supplierHome', codes: governanceCodes, assignments: [[internalUser, internal], [internalInSupplier, internal]] },
      { name: 'scopedGovernance', organizationId: internal, codes: governanceCodes, assignments: [] },
      { name: 'scopedOrdinary', organizationId: internal, codes: [], assignments: [] },
      { name: 'scopedSupplier', organizationId: supplier, codes: governanceCodes, assignments: [] },
    ];
    for (const fixture of fixtures) {
      const role = await prisma.role.create({ data: { code: fixture.name, name: fixture.name, organizationId: fixture.organizationId ?? null } });
      roleIds[fixture.name] = role.id;
      for (const code of fixture.codes) {
        const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
        await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
      }
      for (const [userId, organizationId] of fixture.assignments) {
        await prisma.userRole.create({ data: { roleId: role.id, userId: userId!, organizationId: organizationId! } });
      }
    }
    await client.query(readFileSync(new URL(`${originalMigration}/migration.sql`, migrations), 'utf8'));
    for (const fixture of fixtures) {
      expect(await grants(roleIds[fixture.name]!)).toEqual(fixture.name === 'scopedGovernance' ? materialCodes : []);
    }
    expect((await client.query("SELECT to_regclass('public.position_roles') AS relation")).rows).toEqual([{ relation: null }]);
    expect((await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'profile_version'")).rows).toEqual([]);
    const userRoles = await client.query('SELECT * FROM user_roles ORDER BY user_id, role_id, organization_id');
    const rolePermissions = await client.query('SELECT * FROM role_permissions ORDER BY role_id, permission_id');
    // Only add service-required schema; repairSql must first run in the forward-repair hook below.
    for (const migration of ['20261020010000_position_roles', '20261020020000_account_profile']) {
      await client.query(readFileSync(new URL(`${migration}/migration.sql`, migrations), 'utf8'));
      expect((await client.query('SELECT * FROM user_roles ORDER BY user_id, role_id, organization_id')).rows).toEqual(userRoles.rows);
      expect((await client.query('SELECT * FROM role_permissions ORDER BY role_id, permission_id')).rows).toEqual(rolePermissions.rows);
      expect((await client.query('SELECT * FROM position_roles')).rows).toEqual([]);
    }
    const audit = new AuditLogService(prisma);
    roles = new AdminRoleService(prisma, audit, new AdminMutationService(prisma, audit));
    const session = await prisma.session.create({ data: { userId: internalUser, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000), reauthenticatedAt: new Date(), mfaVerifiedAt: new Date() } });
    actor = { id: internalUser, organizationId: internal, sessionId: session.id, accountType: 'INTERNAL' };
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await client?.end();
    try {
      if (databaseCreated) {
        if (!/^qms_material_grant_[0-9a-f]{32}$/.test(databaseName) || databaseName === connection!.pathname.slice(1)) {
          throw new Error('Refusing to drop a database other than this suite\'s random database');
        }
        await control.query(`DROP DATABASE "${databaseName}"`);
      }
    } finally { await control.end(); }
  });

  it('reproduces the old global grant gap and real administrator self-grant denials', async () => {
    expect(await grants(roleIds.globalGovernance!)).toEqual([]);
    expect(await grants(roleIds.scopedGovernance!)).toEqual(materialCodes);
    const catalog = await roles.catalog(actor);
    expect(catalog[0]!.modules.find((module) => module.key === 'material-master')!.operations.every((operation) => !operation.grantable)).toBe(true);
    await expect(roles.create(actor, { organizationId: internal, code: 'SELF_GRANT', name: 'Self grant', permissionCodes: materialCodes }, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ status: 403, response: { code: 'FEATURE_PERMISSION_DENIED' } });
    await expect(roles.assign(actor, internalUser, { roleIds: [roleIds.scopedGovernance!] }, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ status: 403, response: { code: 'FEATURE_PERMISSION_DENIED' } });
    await expect(roles.update(actor, roleIds.globalGovernance!, { permissionCodes: materialCodes, expectedPermissionCodes: [] }, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ status: 404, response: { code: 'ADMIN_ROLE_NOT_FOUND' } });
  });

  describe('forward repair', () => {
    beforeAll(async () => { await client.query(repairSql); });

    it('grants all three material permissions to assigned internal-only global governance roles', async () => {
      expect(await grants(roleIds.globalGovernance!)).toEqual(materialCodes);
    });

    it.each(['manageOnly', 'assignOnly', 'ordinary', 'unassigned', 'supplierOnly', 'mixedSupplier', 'supplierAccount', 'supplierScope', 'supplierHome'])('does not auto-grant material permissions to %s', async (name) => {
      expect(await grants(roleIds[name]!)).toEqual([]);
    });

    it('preserves the original scoped-role policy without expanding scoped ordinary or supplier roles', async () => {
      expect(await grants(roleIds.scopedGovernance!)).toEqual(materialCodes);
      expect(await grants(roleIds.scopedOrdinary!)).toEqual([]);
      expect(await grants(roleIds.scopedSupplier!)).toEqual([]);
    });

    it('makes material permissions grantable through the real role service without changing global-role immutability', async () => {
      const catalog = await roles.catalog(actor);
      expect(catalog[0]!.modules.find((module) => module.key === 'material-master')!.operations.every((operation) => operation.grantable)).toBe(true);
      const created = await roles.create(actor, { organizationId: internal, code: 'MATERIAL_DELEGATED', name: 'Material delegated', permissionCodes: materialCodes }, randomUUID(), randomUUID());
      expect(created.permissions.map((permission) => permission.code)).toEqual(materialCodes);
      await expect(roles.assign(actor, internalUser, { roleIds: [created.id] }, randomUUID(), randomUUID()))
        .rejects.toMatchObject({ status: 409, response: { code: 'ADMIN_GLOBAL_ROLE_IMMUTABLE' } });
    });

    it('replays idempotently without changing any existing role grant or creating new permission definitions', async () => {
      const before = await client.query('SELECT role_id, permission_id FROM role_permissions ORDER BY role_id, permission_id');
      const permissions = await client.query('SELECT id, code, name FROM permissions ORDER BY id');
      await client.query(repairSql);
      expect((await client.query('SELECT role_id, permission_id FROM role_permissions ORDER BY role_id, permission_id')).rows).toEqual(before.rows);
      expect((await client.query('SELECT id, code, name FROM permissions ORDER BY id')).rows).toEqual(permissions.rows);
    });
  });
});
