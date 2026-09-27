import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { CoordinateInspectionService } from '../../src/modules/coordinate-inspection/coordinate-inspection.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') {
  throw new Error('Coordinate inspection requires an independent disposable PostgreSQL database');
}

describe('coordinate inspection workflow on PostgreSQL', () => {
  const prisma = new PrismaService(databaseUrl);
  const audit = new AuditLogService(prisma);
  const mutations = new AdminMutationService(prisma, audit);
  const service = new CoordinateInspectionService(prisma, mutations, audit);
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const sessionId = randomUUID();
  const roleId = randomUUID();
  const actor = { id: userId, organizationId, sessionId, accountType: 'INTERNAL' as const };

  beforeAll(async () => {
    await prisma.$connect();
    for (const id of [organizationId, otherOrganizationId]) {
      await prisma.organization.create({ data: { id, code: `CMM-${id.slice(0, 8)}`, name: '三坐标测试组织', type: 'INTERNAL' } });
    }
    await prisma.user.create({ data: { id: userId, organizationId, username: `cmm-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.user.create({ data: { id: otherUserId, organizationId: otherOrganizationId, username: `cmm-${otherUserId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.session.create({ data: { id: sessionId, userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    await prisma.role.create({ data: { id: roleId, organizationId, code: 'COORDINATE_TEST', name: 'Coordinate test' } });
    for (const code of ['coordinate-inspection:read', 'coordinate-inspection:write', 'coordinate-inspection:approve', 'coordinate-inspection:schedule']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId, organizationId, roleId } });
  }, 30_000);

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM coordinate_inspection_requests WHERE owner_organization_id = ${organizationId}::uuid`;
    await prisma.adminMutation.deleteMany({ where: { organizationId } });
    await prisma.auditEvent.deleteMany({ where: { organizationId } });
    await prisma.userRole.deleteMany({ where: { roleId } });
    await prisma.role.deleteMany({ where: { id: roleId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
    await prisma.$disconnect();
  }, 30_000);

  it('moves a request through submission, approval, scheduling and completion with CAS', async () => {
    const created = await service.create(actor, { partNumber: 'PN-01', partName: '壳体', sampleQuantity: 2, purpose: 'PROCESS', priority: 'NORMAL' }, randomUUID(), randomUUID());
    expect(created.status).toBe('DRAFT');
    const submitted = await service.submit(actor, created.id, { expectedVersion: created.version }, randomUUID(), randomUUID());
    await expect(service.submit(actor, created.id, { expectedVersion: created.version }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const approved = await service.approve(actor, created.id, { expectedVersion: submitted.version, decision: 'APPROVE' }, randomUUID(), randomUUID());
    const scheduled = await service.schedule(actor, created.id, { expectedVersion: approved.version, assignedToId: userId, scheduledAt: new Date('2026-09-25T09:00:00Z') }, randomUUID(), randomUUID());
    const started = await service.progress(actor, created.id, { expectedVersion: scheduled.version, status: 'IN_PROGRESS', progressPercent: 40 }, randomUUID(), randomUUID());
    await expect(service.progress(actor, created.id, { expectedVersion: started.version, status: 'COMPLETED', progressPercent: 90 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    const completed = await service.progress(actor, created.id, { expectedVersion: started.version, status: 'COMPLETED', progressPercent: 100 }, randomUUID(), randomUUID());
    expect(completed).toMatchObject({ status: 'COMPLETED', progressPercent: 100, version: 6 });
    expect((await service.list(actor, { page: 1, pageSize: 20 })).items).toContainEqual(expect.objectContaining({ id: created.id, status: 'COMPLETED' }));
    expect(await prisma.auditEvent.count({ where: { resourceId: created.id } })).toBe(6);
  });

  it('lets the requester revise a rejected request before submitting a new version', async () => {
    const created = await service.create(actor, { partNumber: 'PN-03', partName: '支架', sampleQuantity: 1, purpose: 'NEW_PRODUCT', priority: 'HIGH' }, randomUUID(), randomUUID());
    const submitted = await service.submit(actor, created.id, { expectedVersion: created.version }, randomUUID(), randomUUID());
    const rejected = await service.approve(actor, created.id, { expectedVersion: submitted.version, decision: 'REJECT', note: '样品数不足' }, randomUUID(), randomUUID());
    await expect(service.submit(actor, created.id, { expectedVersion: rejected.version }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const revised = await service.revise(actor, created.id, { expectedVersion: rejected.version, sampleQuantity: 3 }, randomUUID(), randomUUID());
    expect(revised).toMatchObject({ status: 'DRAFT', sampleQuantity: 3, approvalNote: null, version: rejected.version + 1 });
    const resubmitted = await service.submit(actor, created.id, { expectedVersion: revised.version }, randomUUID(), randomUUID());
    expect(resubmitted.status).toBe('SUBMITTED');
  });

  it('rejects foreign organization access and a revoked permission', async () => {
    const created = await service.create(actor, { partNumber: 'PN-02', partName: '端盖', sampleQuantity: 1, purpose: 'PROCESS', priority: 'NORMAL' }, randomUUID(), randomUUID());
    await expect(service.detail({ ...actor, scopeOrganizationId: otherOrganizationId }, created.id)).rejects.toMatchObject({ status: 403 });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'coordinate-inspection:read' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: permission.id } } });
    await expect(service.detail(actor, created.id)).rejects.toMatchObject({ status: 403 });
  });
});
