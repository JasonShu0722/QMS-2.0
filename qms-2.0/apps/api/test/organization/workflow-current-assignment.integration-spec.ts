import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { OrganizationResponsibilityService } from '../../src/modules/organization/organization-responsibility.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Disposable loopback PostgreSQL required, never 55440.');

describe('public current appointment reference, not an authorization grant', () => {
  const db = new PrismaService();
  const audit = new AuditLogService(db);
  const service = new OrganizationResponsibilityService(db, new AdminMutationService(db, audit), audit);
  beforeAll(() => db.$connect());
  afterAll(() => db.$disconnect());
  async function fixture() {
    const org = await db.organization.create({ data: { code: randomUUID(), name: 'Current appointment', type: 'INTERNAL' } });
    const user = await db.user.create({ data: { organizationId: org.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    const department = await db.department.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Department' } });
    const position = await db.position.create({ data: { organizationId: org.id, departmentId: department.id, code: randomUUID(), name: 'Position' } });
    const assignment = await db.userPosition.create({ data: { organizationId: org.id, userId: user.id, positionId: position.id, startedAt: new Date(Date.now() - 60_000) } });
    return { org, user, department, position, assignment };
  }
  it('resolves exact appointment or user without inventing a permission grant', async () => {
    const f = await fixture();
    await db.$transaction(async tx => {
      const expected = { assignmentId: f.assignment.id, userId: f.user.id, departmentId: f.department.id };
      expect(await service.workflowCurrentAssignment(tx, f.org.id, { assignmentId: f.assignment.id }, true)).toEqual(expected);
      expect(await service.workflowCurrentAssignment(tx, f.org.id, { userId: f.user.id, departmentId: f.department.id })).toEqual(expected);
      expect(await tx.userRole.count({ where: { userId: f.user.id } })).toBe(0);
      expect(await service.workflowCurrentAssignment(tx, randomUUID(), { assignmentId: f.assignment.id })).toBeNull();
      expect(await service.workflowCurrentAssignment(tx, f.org.id, { userId: f.user.id, departmentId: randomUUID() })).toBeNull();
    });
  });
  it('does not resolve expired, pending, deleted or external identities', async () => {
    const f = await fixture();
    const resolve = () => db.$transaction(tx => service.workflowCurrentAssignment(tx, f.org.id, { assignmentId: f.assignment.id }, true));
    await db.userPosition.update({ where: { id: f.assignment.id }, data: { endedAt: new Date(Date.now() - 1000) } });
    expect(await resolve()).toBeNull();
    await db.userPosition.update({ where: { id: f.assignment.id }, data: { endedAt: null } });
    await db.position.update({ where: { id: f.position.id }, data: { status: 'DISABLED', configurationRequired: true } });
    expect(await resolve()).toBeNull();
    await db.position.update({ where: { id: f.position.id }, data: { configurationRequired: false, status: 'ACTIVE' } });
    await db.department.update({ where: { id: f.department.id }, data: { status: 'DISABLED', deletedAt: new Date() } });
    expect(await resolve()).toBeNull();
    const external = await fixture();
    await db.user.update({ where: { id: external.user.id }, data: { accountType: 'SUPPLIER' } });
    expect(await db.$transaction(tx => service.workflowCurrentAssignment(tx, external.org.id, { userId: external.user.id }))).toBeNull();
  });
  it('rejects an unbounded or ambiguous reference instead of returning an arbitrary person', async () => {
    await expect(db.$transaction(tx => service.workflowCurrentAssignment(tx, randomUUID(), {}))).rejects.toMatchObject({ status: 400 });
    await expect(db.$transaction(tx => service.workflowCurrentAssignment(tx, randomUUID(), { userId: randomUUID(), assignmentId: randomUUID() }))).rejects.toMatchObject({ status: 400 });
  });
});
