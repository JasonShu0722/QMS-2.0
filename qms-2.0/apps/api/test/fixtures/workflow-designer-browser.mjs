import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../dist/database/prisma.service.js';
import { PasswordHasherService } from '../../dist/common/security/password-hasher.service.js';

const database = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (!['127.0.0.1', 'localhost'].includes(database.hostname) || database.port === '55440' || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true') throw new Error('An explicitly disposable local database is required');
const [action, identifier] = process.argv.slice(2);
const prisma = new PrismaService();
try {
  if (action === 'setup') {
    if (!process.env.QMS_DESIGNER_FIXTURE_PASSWORD) throw new Error('Fixture password required');
    const organization = await prisma.organization.create({ data: { code: `DESIGNER_E2E_${randomUUID()}`, name: 'Designer fixture', type: 'INTERNAL' } });
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: 'DESIGNER', name: '流程设计员' } });
    const reader = await prisma.role.create({ data: { organizationId: organization.id, code: 'READER', name: '工作台查看员' } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'workflow:manage' } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    const readPermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'workbench:read' } });
    await prisma.rolePermission.create({ data: { roleId: reader.id, permissionId: readPermission.id } });
    const passwordHash = await new PasswordHasherService().hash(process.env.QMS_DESIGNER_FIXTURE_PASSWORD);
    const users = [];
    for (const position of ['first', 'peer', 'restricted']) {
      const user = await prisma.user.create({ data: { username: `designer_${position}_${randomUUID()}`, organizationId: organization.id, accountType: 'INTERNAL', passwordHash } });
      await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: position === 'restricted' ? reader.id : role.id } });
      users.push({ username: user.username });
    }
    process.stdout.write(JSON.stringify({ organizationId: organization.id, users }));
  } else if (action === 'cleanup') {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: identifier } });
    if (!organization.code.startsWith('DESIGNER_E2E_')) throw new Error('Not an owned fixture');
    await prisma.$transaction(async (transaction) => {
      await transaction.organization.update({ where: { id: identifier }, data: { status: 'DISABLED' } });
      await transaction.user.updateMany({ where: { organizationId: identifier }, data: { status: 'DISABLED' } });
    });
  } else throw new Error('Unknown fixture command');
} finally { await prisma.$disconnect(); }
