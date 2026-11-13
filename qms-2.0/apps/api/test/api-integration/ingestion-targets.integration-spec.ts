import 'reflect-metadata';
import { jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import type { AdminActor } from '../../src/common/security/admin-mutation.service.js';
import type { IntegrationFields, IntegrationTarget } from '../../src/common/integration-master-data.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { MaterialMasterIngestionAdapter } from '../../src/modules/material-master/material-master-ingestion.adapter.js';
import { SupplierProfileIngestionAdapter } from '../../src/modules/supplier-quality/supplier-profile-ingestion.adapter.js';
import { CustomerMasterIngestionAdapter } from '../../src/modules/customer-quality/customer-master-ingestion.adapter.js';
import { ComponentProjectIngestionAdapter } from '../../src/modules/platform-configuration/component-project-ingestion.adapter.js';
import { IngestionTargetsService } from '../../src/modules/api-integration/ingestion-targets.service.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)
  || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('Ingress targets require disposable loopback PostgreSQL, never preview 55440.');
}
jest.setTimeout(90_000);

const targetPermissions: Record<IntegrationTarget, string> = {
  SUPPLIER: 'supplier-quality:profiles:write', CUSTOMER: 'customer-quality:complaints:write',
  MATERIAL: 'material-master:write', COMPONENT: 'component-project:manage',
};
const targetNames = Object.keys(targetPermissions) as IntegrationTarget[];

describe('target-owned transactional ingress with real PostgreSQL', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let targets: IngestionTargetsService;
  const organizationIds: string[] = [];

  beforeAll(async () => {
    module = await Test.createTestingModule({ providers: [PrismaService, AuditLogService, MaterialMasterIngestionAdapter,
      SupplierProfileIngestionAdapter, CustomerMasterIngestionAdapter, ComponentProjectIngestionAdapter, IngestionTargetsService] }).compile();
    await module.init();
    prisma = module.get(PrismaService);
    targets = module.get(IngestionTargetsService);
  });

  afterAll(async () => {
    if (prisma && organizationIds.length) {
      const organizations = Prisma.join(organizationIds.map(id => Prisma.sql`${id}::uuid`));
      await prisma.$executeRaw(Prisma.sql`DELETE FROM component_project_mappings WHERE organization_id IN (${organizations})`);
      await prisma.$executeRaw(Prisma.sql`DELETE FROM component_project_records WHERE organization_id IN (${organizations})`);
      await prisma.$executeRaw(Prisma.sql`DELETE FROM customer_quality_customers WHERE organization_id IN (${organizations})`);
      await prisma.$executeRaw(Prisma.sql`DELETE FROM material_masters WHERE organization_id IN (${organizations})`);
      await prisma.supplierBusinessProfile.deleteMany({ where: { ownerOrganizationId: { in: organizationIds } } });
      await prisma.auditEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.userPosition.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.position.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.department.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.userRole.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.user.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.role.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    }
    await module?.close();
  });

  async function fixture(type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Ingress target fixture', type } });
    organizationIds.push(organization.id);
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), accountType: type, passwordHash: 'unused-test-password' } });
    const permissions = await Promise.all(Object.values(targetPermissions).map(code => prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} })));
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Ingress writer', permissions: { create: permissions.map(permission => ({ permissionId: permission.id })) } } });
    await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: role.id } });
    const actor: AdminActor = { id: user.id, organizationId: organization.id, accountType: type, sessionId: randomUUID() };
    return { actor, organization, user, role };
  }

  const inspect = (actor: AdminActor, target: IntegrationTarget, fields: IntegrationFields) => prisma.$transaction(tx => targets.inspect(tx, actor, target, fields));
  const write = (actor: AdminActor, target: IntegrationTarget, fields: IntegrationFields, expected: { id: string; version: number } | null, traceId = randomUUID()) => prisma.$transaction(tx => targets.write(tx, actor, target, fields, expected, traceId));

  it.each(targetNames)('%s creates, compares without changes, updates with CAS, and audits the actual configuring actor', async target => {
    const { actor } = await fixture();
    const fields = { code: '  ab.0001-A ', name: ' 来源档案 ' };
    expect(await inspect(actor, target, fields)).toBeNull();
    const traceId = randomUUID();
    const created = await write(actor, target, fields, null, traceId);
    expect(created).toEqual({ id: expect.any(String), version: 1, values: { code: target === 'CUSTOMER' ? 'AB.0001-A' : 'ab.0001-A', name: '来源档案' } });
    expect(await inspect(actor, target, fields)).toEqual(created);
    expect(await write(actor, target, fields, created)).toEqual(created);
    expect(await prisma.auditEvent.count({ where: { resourceId: created.id } })).toBe(1);
    expect(await prisma.auditEvent.findFirst({ where: { resourceId: created.id } })).toMatchObject({ actorUserId: actor.id, organizationId: actor.organizationId, traceId, outcome: 'SUCCESS' });
    const updated = await write(actor, target, { ...fields, name: '后续名称' }, created);
    expect(updated).toEqual({ ...created, version: 2, values: { ...created.values, name: '后续名称' } });
    await expect(write(actor, target, { ...fields, name: '过期更新' }, created)).rejects.toMatchObject({ response: { code: 'CONCURRENCY_CONFLICT' } });
    await expect(write(actor, target, fields, null)).rejects.toMatchObject({ response: { code: 'CONCURRENCY_CONFLICT' } });
    await expect(write(actor, target, fields, { id: randomUUID(), version: updated.version })).rejects.toMatchObject({ response: { code: 'CONCURRENCY_CONFLICT' } });
    expect(await inspect(actor, target, fields)).toEqual(updated);
    expect(await prisma.auditEvent.count({ where: { resourceId: created.id } })).toBe(2);
  });

  it.each(targetNames)('%s admits exactly one concurrent insert and one concurrent update from the same version', async target => {
    const { actor } = await fixture();
    const fields = { code: 'RACE', name: '初始' };
    const results = await Promise.allSettled([write(actor, target, fields, null), write(actor, target, fields, null)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toEqual([expect.objectContaining({ reason: expect.objectContaining({ response: expect.objectContaining({ code: 'CONCURRENCY_CONFLICT' }) }) })]);
    const current = (await inspect(actor, target, fields))!;
    const updates = await Promise.allSettled([write(actor, target, { ...fields, name: '并发甲' }, current), write(actor, target, { ...fields, name: '并发乙' }, current)]);
    expect(updates.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(updates.filter(result => result.status === 'rejected')).toEqual([expect.objectContaining({ reason: expect.objectContaining({ response: expect.objectContaining({ code: 'CONCURRENCY_CONFLICT' }) }) })]);
    expect((await inspect(actor, target, fields))?.version).toBe(2);
    expect(await prisma.auditEvent.count({ where: { resourceId: current.id } })).toBe(2);
  });

  it.each(targetNames)('%s rechecks revoked permissions, disabled identities, and internal target scope', async target => {
    const current = await fixture();
    const fields = { code: 'ACCESS', name: '权限复核' };
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: targetPermissions[target] } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: current.role.id, permissionId: permission.id } } });
    await expect(inspect(current.actor, target, fields)).rejects.toMatchObject({ response: { code: 'FEATURE_PERMISSION_DENIED' } });
    await expect(write(current.actor, target, fields, null)).rejects.toMatchObject({ response: { code: 'FEATURE_PERMISSION_DENIED' } });
    await prisma.rolePermission.create({ data: { roleId: current.role.id, permissionId: permission.id } });
    await prisma.user.update({ where: { id: current.user.id }, data: { status: 'DISABLED' } });
    await expect(write(current.actor, target, fields, null)).rejects.toMatchObject({ response: { code: 'AUTH_SESSION_REQUIRED' } });
    await prisma.user.update({ where: { id: current.user.id }, data: { status: 'ACTIVE' } });
    const supplier = await fixture('SUPPLIER');
    await expect(write(supplier.actor, target, fields, null)).rejects.toMatchObject({ response: { code: 'ORGANIZATION_SCOPE_DENIED' } });
    await prisma.userRole.create({ data: { userId: current.user.id, organizationId: supplier.organization.id, roleId: supplier.role.id } });
    await expect(write({ ...current.actor, scopeOrganizationId: supplier.organization.id }, target, fields, null)).rejects.toMatchObject({ response: { code: 'ORGANIZATION_SCOPE_DENIED' } });
    await prisma.organization.update({ where: { id: current.organization.id }, data: { status: 'DISABLED' } });
    await expect(write(current.actor, target, fields, null)).rejects.toMatchObject({ response: { code: 'ORGANIZATION_DISABLED' } });
  });

  it.each(targetNames)('%s isolates identical codes by organization and rolls back business data together with audit', async target => {
    const first = await fixture(); const second = await fixture();
    const fields = { code: 'SAME-CODE', name: '第一组织' };
    const created = await write(first.actor, target, fields, null);
    expect(await inspect(second.actor, target, fields)).toBeNull();
    await expect(write({ ...first.actor, scopeOrganizationId: second.organization.id }, target, fields, null)).rejects.toMatchObject({ response: { code: 'FEATURE_PERMISSION_DENIED' } });
    const other = await write(second.actor, target, { ...fields, name: '第二组织' }, null);
    expect(other.id).not.toBe(created.id);
    const rollbackTrace = randomUUID();
    await expect(prisma.$transaction(async transaction => {
      await targets.write(transaction, first.actor, target, { code: 'ROLLBACK', name: '不得留存' }, null, rollbackTrace);
      throw new Error('Rollback ingress owner transaction');
    })).rejects.toThrow('Rollback ingress owner transaction');
    expect(await inspect(first.actor, target, { code: 'ROLLBACK', name: '不得留存' })).toBeNull();
    expect(await prisma.auditEvent.count({ where: { traceId: rollbackTrace } })).toBe(0);
  });

  it('updates only supplied supplier contacts, preserves absent/null/blank values, and never creates a supplier organization', async () => {
    const { actor } = await fixture();
    const fields = { code: 'SUPPLIER-CONTACT', name: '供应商', contactName: '联系人', contactEmail: 'kept@example.com' };
    const created = await write(actor, 'SUPPLIER', fields, null);
    const renamed = await write(actor, 'SUPPLIER', { code: fields.code, name: '名称已改' }, created);
    expect(renamed.values).toEqual({ ...fields, name: '名称已改' });
    const noChange = await write(actor, 'SUPPLIER', { code: fields.code, name: '名称已改', contactName: null, contactEmail: ' ' } as unknown as IntegrationFields, renamed);
    expect(noChange).toEqual(renamed);
    const contactChanged = await write(actor, 'SUPPLIER', { code: fields.code, name: '名称已改', contactName: '新联系人' }, renamed);
    expect(contactChanged.values).toEqual({ ...renamed.values, contactName: '新联系人' });
    expect((await prisma.supplierBusinessProfile.findUniqueOrThrow({ where: { id: created.id } })).supplierOrganizationId).toBeNull();
  });

  it('creates pending components and protects existing project, engineer, stage, product classification and status', async () => {
    const { actor } = await fixture();
    const created = await write(actor, 'COMPONENT', { code: 'COMPONENT-MANUAL', name: '来源组件' }, null);
    const [pending] = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM component_project_mappings WHERE id = ${created.id}::uuid`;
    expect(pending).toMatchObject({ project_record_id: null, product_category: null, product_subcategory: null, status: 'ACTIVE', version: 1 });
    const department = await prisma.department.create({ data: { organizationId: actor.organizationId, code: 'ENGINEERING', name: '工程部' } });
    const position = await prisma.position.create({ data: { organizationId: actor.organizationId, departmentId: department.id, code: 'QE', name: '工程师' } });
    const assignment = await prisma.userPosition.create({ data: { organizationId: actor.organizationId, userId: actor.id, positionId: position.id } });
    const projectId = randomUUID();
    await prisma.$executeRaw`INSERT INTO component_project_records (id, organization_id, code, name, stage, customer_engineer_assignment_id, project_engineer_assignment_id, created_by_user_id, updated_by_user_id) VALUES (${projectId}::uuid, ${actor.organizationId}::uuid, 'MANUAL-PROJECT', '人工项目', 'MASS_PRODUCTION', ${assignment.id}::uuid, ${assignment.id}::uuid, ${actor.id}::uuid, ${actor.id}::uuid)`;
    await prisma.$executeRaw`UPDATE component_project_mappings SET project_record_id = ${projectId}::uuid, product_category = '电控', product_subcategory = '手动分类', status = 'DISABLED', version = version + 1 WHERE id = ${created.id}::uuid`;
    const [beforeProject] = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM component_project_records WHERE id = ${projectId}::uuid`;
    const updated = await write(actor, 'COMPONENT', { code: 'COMPONENT-MANUAL', name: '新来源组件' }, { id: created.id, version: 2 });
    expect(updated.version).toBe(3);
    const [mapping] = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM component_project_mappings WHERE id = ${created.id}::uuid`;
    expect(mapping).toMatchObject({ component_name: '新来源组件', project_record_id: projectId, product_category: '电控', product_subcategory: '手动分类', status: 'DISABLED' });
    expect((await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM component_project_records WHERE id = ${projectId}::uuid`)[0]).toEqual(beforeProject);
  });
});
