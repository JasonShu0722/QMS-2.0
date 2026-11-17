import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AI_CONFIGURATION_PERMISSIONS, INTERNAL_PLATFORM_PERMISSION_CODES, PERMISSION_CATALOG, PROCESS_CONFIGURATION_PERMISSIONS } from '../../src/modules/authorization/permission-catalog.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Function permission migration requires disposable PostgreSQL');

describe('functional permission migration with real PostgreSQL', () => {
  const prisma = new PrismaService();
  beforeAll(async () => prisma.$connect());
  afterAll(async () => prisma.$disconnect());

  it('copies only old read or manage duties, remains idempotent and never grants deletion to writers', async () => {
    const sql = await readFile(new URL('../../prisma/migrations/20261117030000_function_permissions/migration.sql', import.meta.url), 'utf8');
    const reads = ['ai:connections:read', 'ai:applications:read', 'process-quality:configuration:read'];
    const manages = [...AI_CONFIGURATION_PERMISSIONS, ...PROCESS_CONFIGURATION_PERMISSIONS].filter(code => !reads.includes(code));
    await expect(prisma.$transaction(async tx => {
      const organization = await tx.organization.create({ data: { code: randomUUID(), name: '权限迁移事务', type: 'INTERNAL' } });
      const roles = [];
      for (const original of ['configuration:read', 'configuration:manage', 'process-quality:defects:write']) {
        const permission = await tx.permission.findUniqueOrThrow({ where: { code: original } });
        const role = await tx.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: original } });
        await tx.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
        roles.push({ role, original });
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
        for (const { role, original } of roles) {
          const assigned = await tx.rolePermission.findMany({ where: { roleId: role.id }, include: { permission: true } });
          expect(assigned.map(entry => entry.permission.code).sort()).toEqual([original, ...(original === 'configuration:read' ? reads : original === 'configuration:manage' ? manages : [])].sort());
        }
      }
      throw new Error('FUNCTION_PERMISSION_TEST_ROLLBACK');
    })).rejects.toThrow('FUNCTION_PERMISSION_TEST_ROLLBACK');
  });

  it('makes every new internal action grantable through the catalog and administrator projection', async () => {
    const expected = [...AI_CONFIGURATION_PERMISSIONS, ...PROCESS_CONFIGURATION_PERMISSIONS, 'process-quality:defects:delete'];
    const records = await prisma.permission.findMany({ where: { code: { in: expected } } });
    expect(records.map(record => record.code).sort()).toEqual([...expected].sort());
    expect(INTERNAL_PLATFORM_PERMISSION_CODES).toEqual(expect.arrayContaining(expected));
    expect(PERMISSION_CATALOG.find(group => group.key === 'ai')?.modules.map(module => module.key)).toEqual(['ai-connections', 'ai-applications']);
  });
});
