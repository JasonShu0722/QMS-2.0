import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { CustomerQualityService } from '../../src/modules/customer-quality/customer-quality.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') throw new Error('An independent disposable PostgreSQL database is required');

describe('customer master relationships on PostgreSQL', () => {
  const prisma = new PrismaService(databaseUrl);
  const audit = new AuditLogService(prisma);
  const mutations = new AdminMutationService(prisma, audit);
  const service = new CustomerQualityService(prisma, mutations, audit);
  const organizationId = randomUUID(); const otherOrganizationId = randomUUID(); const userId = randomUUID(); const otherUserId = randomUUID(); const sessionId = randomUUID(); const roleId = randomUUID();
  const actor = { id: userId, organizationId, accountType: 'INTERNAL' as const, sessionId };

  beforeAll(async () => {
    await prisma.$connect();
    const [server] = await prisma.$queryRaw<{ server_version_num: string }[]>`SHOW server_version_num`;
    expect(Number(server!.server_version_num)).toBeGreaterThanOrEqual(180000);
    await prisma.organization.createMany({ data: [{ id: organizationId, code: `CM-${organizationId.slice(0, 8)}`, name: '客户主数据组织', type: 'INTERNAL' }, { id: otherOrganizationId, code: `CM-${otherOrganizationId.slice(0, 8)}`, name: '其他组织', type: 'INTERNAL' }] });
    await prisma.user.createMany({ data: [{ id: userId, organizationId, username: `cm-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' }, { id: otherUserId, organizationId: otherOrganizationId, username: `cm-${otherUserId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' }] });
    await prisma.session.create({ data: { id: sessionId, userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    await prisma.role.create({ data: { id: roleId, organizationId, code: 'CM', name: 'Customer Master' } });
    for (const code of ['customer-quality:complaints:read', 'customer-quality:complaints:write']) { const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} }); await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } }); }
    await prisma.userRole.create({ data: { userId, organizationId, roleId } });
  });
  afterAll(async () => prisma.$disconnect());

  it('maintains hierarchy and vehicle/project/product relations with idempotent replay and CAS', async () => {
    const parent = await service.createCustomer(actor, { code: `P-${randomUUID().slice(0, 8)}`, name: '集团客户' }, randomUUID(), randomUUID());
    const child = await service.createCustomer(actor, { code: `C-${randomUUID().slice(0, 8)}`, name: '子客户' }, randomUUID(), randomUUID());
    const parentKey = randomUUID();
    const relation = await service.createCustomerRelation(actor, child.id, { relationType: 'CUSTOMER_PARENT', relatedCustomerId: parent.id }, randomUUID(), parentKey);
    expect(relation.related_customer_id).toBe(parent.id);
    expect((await service.createCustomerRelation(actor, child.id, { relationType: 'CUSTOMER_PARENT', relatedCustomerId: parent.id }, randomUUID(), parentKey)).id).toBe(relation.id);
    await expect(service.createCustomerRelation(actor, child.id, { relationType: 'CUSTOMER_PARENT', relatedCustomerId: parent.id }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(service.createCustomerRelation(actor, parent.id, { relationType: 'CUSTOMER_PARENT', relatedCustomerId: child.id }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const vehicle = await service.createCustomerRelation(actor, child.id, { relationType: 'VEHICLE_MODEL', relatedCode: 'MODEL-X', relatedName: '车型 X' }, randomUUID(), randomUUID());
    await expect(service.createCustomerRelation(actor, child.id, { relationType: 'VEHICLE_MODEL', relatedCode: 'MODEL-X', relatedName: '重复车型' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const project = await service.createCustomerRelation(actor, child.id, { relationType: 'PROJECT', relatedCode: 'PRJ-1', relatedName: '项目一' }, randomUUID(), randomUUID());
    const product = await service.createCustomerRelation(actor, child.id, { relationType: 'PRODUCT', relatedCode: 'P-1', relatedName: '产品一' }, randomUUID(), randomUUID());
    expect((await service.listCustomerRelations(actor, child.id)).map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([relation.id, vehicle.id, project.id, product.id]));
    const updated = await service.updateCustomerRelation(actor, vehicle.id, { expectedVersion: 1, relatedName: '车型 X（改）' }, randomUUID(), randomUUID());
    expect(updated.version).toBe(2);
    await expect(service.updateCustomerRelation(actor, vehicle.id, { expectedVersion: 1, relatedName: '过期' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(service.createCustomerRelation({ ...actor, scopeOrganizationId: otherOrganizationId }, child.id, { relationType: 'PRODUCT', relatedCode: 'P-X', relatedName: '越权' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    const deleteKey = randomUUID();
    const deleted = await service.deleteCustomerRelation(actor, product.id, 1, randomUUID(), deleteKey);
    expect(deleted).toEqual({ id: product.id, deleted: true });
    expect(await service.deleteCustomerRelation(actor, product.id, 1, randomUUID(), deleteKey)).toEqual(deleted);
    await expect(service.deleteCustomerRelation(actor, product.id, 1, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });
});
