import 'dotenv/config';
import { PrismaService } from '../src/database/prisma.service.js';
import { PasswordHasherService } from '../src/common/security/password-hasher.service.js';

async function seed(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for local seed');
  const url = new URL(databaseUrl);
  if (process.env.NODE_ENV !== 'development' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Demo seed requires NODE_ENV=development and a loopback PostgreSQL host');
  }
  const internalPassword = process.env.QMS_SEED_INTERNAL_PASSWORD;
  const supplierPassword = process.env.QMS_SEED_SUPPLIER_PASSWORD;
  if (!internalPassword || !supplierPassword ||
      [internalPassword, supplierPassword].some((value) => value.length < 16 || value.startsWith('replace-'))) {
    throw new Error('Provide distinct local seed passwords of at least 16 characters through environment variables');
  }
  if (internalPassword === supplierPassword) throw new Error('Local seed passwords must be distinct');
  const hasher = new PasswordHasherService();
  const passwordHashes = await Promise.all([hasher.hash(internalPassword), hasher.hash(supplierPassword)]);
  const prisma = new PrismaService(databaseUrl);
  try {
    await prisma.$transaction(async (tx) => {
      for (const [index, type] of (['INTERNAL', 'SUPPLIER'] as const).entries()) {
        const organization = await tx.organization.upsert({
          where: { code: `LOCAL-${type}` }, update: {},
          create: { code: `LOCAL-${type}`, name: `本地演示 ${type}`, type },
        });
        const username = type === 'INTERNAL' ? 'local.internal' : 'local.supplier';
        const user = await tx.user.upsert({
          where: { organizationId_username: { organizationId: organization.id, username } },
          update: {},
          create: { organizationId: organization.id, username, passwordHash: passwordHashes[index]!, accountType: type },
        });
        const role = await tx.role.upsert({
          where: { organizationId_code: { organizationId: organization.id, code: 'LOCAL_MEMBER' } },
          update: {}, create: { organizationId: organization.id, code: 'LOCAL_MEMBER', name: '本地演示成员' },
        });
        const permissions = [
          ['workbench:read', '查看工作台'],
          ['organization:read', '查看组织'],
          ['system:permissions:read', '查看系统权限'],
          ['problem-index:read', '查看问题索引'],
          ['workflow:manage', '管理受控流程'],
          ...(type === 'INTERNAL' ? [
            ['account:users:read', '查看用户账号'],
            ['account:users:manage', '管理用户账号'],
            ['account:roles:read', '查看角色与权限'],
            ['account:roles:manage', '管理角色与权限'],
          ] : []),
        ] as const;
        for (const [code, name] of permissions) {
          const permission = await tx.permission.upsert({
            where: { code }, update: {}, create: { code, name },
          });
          await tx.rolePermission.upsert({
            where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
            update: {}, create: { roleId: role.id, permissionId: permission.id },
          });
        }
        const assignment = { userId: user.id, roleId: role.id, organizationId: organization.id };
        await tx.userRole.upsert({ where: { userId_roleId_organizationId: assignment }, update: {}, create: assignment });
      }
    });
    console.info('Local demo seed complete; existing accounts and passwords were preserved.');
  } finally {
    await prisma.$disconnect();
  }
}

seed().catch(() => {
  console.error(process.env.DATABASE_URL
    ? 'Local seed failed. Check development mode, loopback PostgreSQL, distinct seed passwords, and deployed migrations.'
    : 'Local seed failed: DATABASE_URL is required.');
  process.exitCode = 1;
});
