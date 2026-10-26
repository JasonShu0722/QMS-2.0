import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { ministerAssignmentReferences, positionManagementReferences, structureBusinessReferences } from '../../src/modules/organization/organization-lifecycle.read-model.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)
  || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('Management references require disposable loopback PostgreSQL, never preview 55440.');
}

describe('management configuration lifecycle references with real PostgreSQL', () => {
  const prisma = new PrismaService();
  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  async function fixture() {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Management references', type: 'INTERNAL' } });
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    const department = await prisma.department.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Department' } });
    const section = await prisma.department.create({ data: { organizationId: organization.id, parentId: department.id, code: randomUUID(), name: 'Section' } });
    const position = await prisma.position.create({ data: { organizationId: organization.id, departmentId: department.id, code: randomUUID(), name: 'Minister' } });
    const assignment = await prisma.userPosition.create({ data: { organizationId: organization.id, userId: user.id, positionId: position.id, startedAt: new Date(Date.now() - 86400000) } });
    const scopeId = randomUUID();
    return { organization, user, department, section, position, assignment, scopeId };
  }

  it('retains expired scope history without treating it as live, and keeps future scopes live', async () => {
    const f = await fixture();
    const from = new Date(Date.now() - 3600000);
    const to = new Date(Date.now() - 60000);
    await prisma.$executeRaw`
      INSERT INTO department_minister_scopes (id, organization_id, department_id, section_department_id,
        minister_assignment_id, valid_from, valid_to, created_by, updated_by)
      VALUES (${f.scopeId}::uuid, ${f.organization.id}::uuid, ${f.department.id}::uuid, ${f.section.id}::uuid,
        ${f.assignment.id}::uuid, ${from}, ${to}, ${f.user.id}::uuid, ${f.user.id}::uuid)`;
    expect(await structureBusinessReferences(prisma, f.section.id, 'department')).toEqual({ referenced: true, live: false,
      details: [{ tableName: 'department_minister_scopes', columnName: 'section_department_id', count: 1, liveCount: 0 }] });
    await prisma.$executeRaw`UPDATE department_minister_scopes SET valid_from = ${new Date(Date.now() + 60000)}, valid_to = NULL WHERE id = ${f.scopeId}::uuid`;
    expect(await structureBusinessReferences(prisma, f.section.id, 'department')).toEqual({ referenced: true, live: true,
      details: [{ tableName: 'department_minister_scopes', columnName: 'section_department_id', count: 1, liveCount: 1 }] });
    await prisma.$executeRaw`UPDATE department_minister_scopes SET status = 'DISABLED' WHERE id = ${f.scopeId}::uuid`;
    expect(await structureBusinessReferences(prisma, f.section.id, 'department')).toEqual({ referenced: true, live: false,
      details: [{ tableName: 'department_minister_scopes', columnName: 'section_department_id', count: 1, liveCount: 0 }] });
    expect(await prisma.$queryRaw`SELECT id FROM department_minister_scopes WHERE id = ${f.scopeId}::uuid`).toEqual([{ id: f.scopeId }]);
  });

  it('protects configured positions until active management bindings are disabled', async () => {
    const f = await fixture();
    expect(await positionManagementReferences(prisma, f.organization.id, f.position.id)).toBe(false);
    await prisma.$executeRaw`
      INSERT INTO department_management_bindings (id, organization_id, department_id, responsibility, position_id, created_by, updated_by)
      VALUES (${randomUUID()}::uuid, ${f.organization.id}::uuid, ${f.department.id}::uuid, 'MINISTER', ${f.position.id}::uuid, ${f.user.id}::uuid, ${f.user.id}::uuid)`;
    expect(await positionManagementReferences(prisma, f.organization.id, f.position.id)).toBe(true);
    expect(await positionManagementReferences(prisma, randomUUID(), f.position.id)).toBe(false);
    await prisma.$executeRaw`UPDATE department_management_bindings SET status = 'DISABLED' WHERE organization_id = ${f.organization.id}::uuid`;
    expect(await positionManagementReferences(prisma, f.organization.id, f.position.id)).toBe(false);
  });

  it('protects current and future minister appointments but not expired scope history', async () => {
    const f = await fixture();
    expect(await ministerAssignmentReferences(prisma, f.organization.id, [])).toBe(false);
    const from = new Date(Date.now() + 60000);
    await prisma.$executeRaw`
      INSERT INTO department_minister_scopes (id, organization_id, department_id, section_department_id,
        minister_assignment_id, valid_from, created_by, updated_by)
      VALUES (${f.scopeId}::uuid, ${f.organization.id}::uuid, ${f.department.id}::uuid, ${f.section.id}::uuid,
        ${f.assignment.id}::uuid, ${from}, ${f.user.id}::uuid, ${f.user.id}::uuid)`;
    expect(await ministerAssignmentReferences(prisma, f.organization.id, [f.assignment.id])).toBe(true);
    expect(await positionManagementReferences(prisma, f.organization.id, f.position.id)).toBe(true);
    expect(await ministerAssignmentReferences(prisma, randomUUID(), [f.assignment.id])).toBe(false);
    await prisma.$executeRaw`UPDATE department_minister_scopes SET valid_from = ${new Date(Date.now() - 3600000)}, valid_to = ${new Date(Date.now() - 60000)} WHERE id = ${f.scopeId}::uuid`;
    expect(await ministerAssignmentReferences(prisma, f.organization.id, [f.assignment.id])).toBe(false);
    expect(await positionManagementReferences(prisma, f.organization.id, f.position.id)).toBe(false);
  });
});
