import 'reflect-metadata';
import assert from 'node:assert/strict';
import { PrismaService } from '../../src/database/prisma.service.js';
import { PasswordHasherService } from '../../src/common/security/password-hasher.service.js';
import { ACTIVE_PERMISSION_CODES } from '../../src/modules/authorization/permission-catalog.js';

function requireDisposableDatabase(value: string | undefined, disposable: string | undefined): string {
  if (disposable !== 'true' || !value) throw new Error('Disposable browser fixture environment required.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid disposable database endpoint; value redacted.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.port !== '57624' || url.pathname === '/' || url.search || url.hash) {
    throw new Error('Browser fixture requires its loopback 57624 database without query/hash; preview 55440 is forbidden.');
  }
  return value;
}

// Pure guard checks run before a Prisma client is constructed; no candidate URL is connected.
const safe = 'postgresql://fixture:fixture@127.0.0.1:57624/fixture';
assert.equal(requireDisposableDatabase(safe, 'true'), safe);
assert.throws(() => requireDisposableDatabase(safe, undefined));
for (const value of [undefined, 'not-a-url', safe.replace('postgresql:', 'http:'), safe.replace('127.0.0.1', 'db.example.com'), safe.replace('57624', '55440'), `${safe}?host=remote`, `${safe}?port=55440`, `${safe}#override`]) {
  assert.throws(() => requireDisposableDatabase(value, 'true'));
}

async function prepare() {
  const connection = requireDisposableDatabase(process.env.DATABASE_URL, process.env.QMS_DISPOSABLE_TEST_DB);
  const password = process.env.QMS_SEED_INTERNAL_PASSWORD;
  const supplierPassword = process.env.QMS_SEED_SUPPLIER_PASSWORD;
  if (!password || !supplierPassword || password === supplierPassword || [password, supplierPassword].some(value => value.length < 16 || value.startsWith('replace-'))) throw new Error('Distinct generated seed passwords are required.');
  const passwordHash = await new PasswordHasherService().hash(password);
  const supplierPasswordHash = await new PasswordHasherService().hash(supplierPassword);
  const prisma = new PrismaService(connection);
  try {
    await prisma.$transaction(async tx => {
      const organization = await tx.organization.findUnique({ where: { code: 'LOCAL-INTERNAL' } });
      if (!organization || organization.type !== 'INTERNAL' || organization.status !== 'ACTIVE') throw new Error('Seed LOCAL-INTERNAL first.');
      const user = await tx.user.findUnique({ where: { organizationId_username: { organizationId: organization.id, username: 'local.internal' } } });
      const role = await tx.role.findUnique({ where: { organizationId_code: { organizationId: organization.id, code: 'LOCAL_MEMBER' } } });
      if (!user || user.accountType !== 'INTERNAL' || user.status !== 'ACTIVE' || user.mfaRequirementOverride !== null || !role) {
        throw new Error('Expected active disposable seed account and default MFA policy.');
      }
      const permissions = await tx.permission.findMany({ where: { code: { in: ACTIVE_PERMISSION_CODES } }, select: { id: true } });
      if (permissions.length !== new Set(ACTIVE_PERMISSION_CODES).size) throw new Error('Seeded permission catalogue is incomplete; no global data changed.');
      await tx.rolePermission.createMany({ data: permissions.map(permission => ({ roleId: role.id, permissionId: permission.id })), skipDuplicates: true });
      const assignment = { userId: user.id, roleId: role.id, organizationId: organization.id };
      await tx.userRole.upsert({ where: { userId_roleId_organizationId: assignment }, create: assignment, update: {} });
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, securityVersion: { increment: 1 }, credentialVersion: { increment: 1 } } });
      const supplierOrganization = await tx.organization.findUnique({ where: { code: 'LOCAL-SUPPLIER' } });
      const supplier = supplierOrganization?.type === 'SUPPLIER' ? await tx.user.findUnique({ where: { organizationId_username: { organizationId: supplierOrganization.id, username: 'local.supplier' } } }) : null;
      if (!supplier || supplier.accountType !== 'SUPPLIER' || supplier.status !== 'ACTIVE') throw new Error('Seed the isolated supplier account first.');
      await tx.user.update({ where: { id: supplier.id }, data: { passwordHash: supplierPasswordHash, securityVersion: { increment: 1 }, credentialVersion: { increment: 1 } } });
      // Preserve MFA enrollment, overrides and sessions: login/enrollment must traverse the real UI.
    }, { timeout: 15_000 });
    console.info('fixture ready');
  } finally {
    await prisma.$disconnect();
  }
}

prepare().catch(() => {
  console.error('Browser fixture failed; verify the isolated database, migrated seed and process environment. Details redacted.');
  process.exitCode = 1;
});
