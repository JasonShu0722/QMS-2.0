import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { ProcessDefectLedgerService } from '../../src/modules/process-quality/process-defect-ledger.service.js';
import { NewProductQualityService } from '../../src/modules/new-product-quality/new-product-quality.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') throw new Error('Disposable PostgreSQL is required');

describe('new product source selection contract', () => {
  it('requires the source selection and issue lifecycle methods', () => {
    expect(typeof NewProductQualityService.prototype.selectProcessDefect).toBe('function');
    expect(typeof NewProductQualityService.prototype.issueSelectedDefects).toBe('function');
    expect(typeof NewProductQualityService.prototype.escalateIssue).toBe('function');
    expect(typeof NewProductQualityService.prototype.createLegacyIssue).toBe('function');
    expect(typeof NewProductQualityService.prototype.approveMassProduction).toBe('function');
  });
});

describe('new product process source snapshots on PostgreSQL', () => {
  const prisma = new PrismaService(databaseUrl);
  const audit = new AuditLogService(prisma);
  const mutations = new AdminMutationService(prisma, audit);
  const service = new NewProductQualityService(prisma, mutations, audit);
  const defects = new ProcessDefectLedgerService(prisma, mutations, audit);
  const organizationId = randomUUID();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const roleId = randomUUID();
  const actor = { id: userId, organizationId, accountType: 'INTERNAL' as const, sessionId };

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.organization.create({ data: { id: organizationId, code: `NPS-${organizationId.slice(0, 8)}`, name: 'Source snapshots', type: 'INTERNAL' } });
    await prisma.user.create({ data: { id: userId, organizationId, username: `nps-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.session.create({ data: { id: sessionId, userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    await prisma.role.create({ data: { id: roleId, organizationId, code: 'NPS', name: 'Source selection' } });
    for (const code of ['new-product-quality:projects:read', 'new-product-quality:projects:write', 'process-quality:defects:read', 'process-quality:defects:write']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId, organizationId, roleId } });
  });

  afterAll(async () => prisma.$disconnect());

  it.each([
    { occurredAt: null, defectQuantity: null },
    { occurredAt: new Date('2026-09-24T08:00:00Z'), defectQuantity: 2 },
  ])('persists the original source time and quantity: %j', async ({ occurredAt, defectQuantity }) => {
    const code = `NP-${randomUUID().slice(0, 8)}`;
    const project = await service.createProject(actor, { code, name: 'Source regression', productCode: code }, randomUUID(), randomUUID());
    const defect = await defects.create(actor, { description: 'Source regression', projectCode: code, occurredAt, defectQuantity }, randomUUID(), randomUUID());
    const selection = await service.selectProcessDefect(actor, project.id, { defectId: defect.id, expectedVersion: defect.version }, randomUUID(), randomUUID());
    const expected = { id: defect.id, occurredAt: occurredAt?.toISOString() ?? null, defectQuantity, version: defect.version };
    expect(selection.source_snapshot).toMatchObject(expected);
    const saved = await service.selectedDefects(actor, project.id);
    expect(saved).toHaveLength(1);
    expect(saved[0].source_snapshot).toMatchObject(expected);
  });

  it('keeps source-free project metadata readable without process source permission', async () => {
    const code = `NP-${randomUUID().slice(0, 8)}`;
    const project = await service.createProject(actor, { code, name: 'Metadata only', productCode: code }, randomUUID(), randomUUID());
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'process-quality:defects:read' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: permission.id } } });
    try {
      expect(await service.projectDetail(actor, project.id)).toMatchObject({ id: project.id, name: 'Metadata only', selected_defects: [] });
      await expect(service.selectedDefects(actor, project.id)).rejects.toMatchObject({ status: 403, response: { code: 'FEATURE_PERMISSION_DENIED' } });
    } finally {
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
  });

  it.each([
    { occurredAt: null, defectQuantity: null },
    { occurredAt: new Date('2026-09-24T08:00:00Z'), defectQuantity: 2 },
  ])('denies source-bearing project detail after process read revocation: %j', async ({ occurredAt, defectQuantity }) => {
    const code = `NP-${randomUUID().slice(0, 8)}`;
    const project = await service.createProject(actor, { code, name: 'Source read scope', productCode: code }, randomUUID(), randomUUID());
    const defect = await defects.create(actor, { description: 'Protected source', projectCode: code, occurredAt, defectQuantity }, randomUUID(), randomUUID());
    const selection = await service.selectProcessDefect(actor, project.id, { defectId: defect.id, expectedVersion: defect.version }, randomUUID(), randomUUID());
    const expected = [{ id: selection.id, source_version: selection.source_version, source_snapshot: selection.source_snapshot }];
    expect((await service.projectDetail(actor, project.id)).selected_defects).toMatchObject(expected);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'process-quality:defects:read' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: permission.id } } });
    try {
      await expect(service.selectedDefects(actor, project.id)).rejects.toMatchObject({ status: 403, response: { code: 'FEATURE_PERMISSION_DENIED' } });
      await expect(service.projectDetail(actor, project.id)).rejects.toMatchObject({ status: 403, response: { code: 'FEATURE_PERMISSION_DENIED' } });
    } finally {
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    expect((await service.projectDetail(actor, project.id)).selected_defects).toMatchObject(expected);
    expect(await service.selectedDefects(actor, project.id)).toMatchObject(expected);
  });

  it('denies another real organization even when the actor has both read permissions at home', async () => {
    const code = `NP-${randomUUID().slice(0, 8)}`;
    const project = await service.createProject(actor, { code, name: 'Organization scope', productCode: code }, randomUUID(), randomUUID());
    const defect = await defects.create(actor, { description: 'Organization source', projectCode: code }, randomUUID(), randomUUID());
    await service.selectProcessDefect(actor, project.id, { defectId: defect.id, expectedVersion: defect.version }, randomUUID(), randomUUID());
    const otherOrganizationId = randomUUID();
    const otherUserId = randomUUID();
    const otherSessionId = randomUUID();
    await prisma.organization.create({ data: { id: otherOrganizationId, code: `NPS-${otherOrganizationId.slice(0, 8)}`, name: 'Other source scope', type: 'INTERNAL' } });
    await prisma.user.create({ data: { id: otherUserId, organizationId: otherOrganizationId, username: `nps-${otherUserId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.session.create({ data: { id: otherSessionId, userId: otherUserId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    const otherRole = await prisma.role.create({ data: { organizationId: otherOrganizationId, code: 'NPS', name: 'Other source reader' } });
    for (const code of ['new-product-quality:projects:read', 'process-quality:defects:read']) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
      await prisma.rolePermission.create({ data: { roleId: otherRole.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId: otherUserId, organizationId: otherOrganizationId, roleId: otherRole.id } });
    const otherActor = { id: otherUserId, organizationId: otherOrganizationId, accountType: 'INTERNAL' as const, sessionId: otherSessionId };
    const otherCode = `NP-${randomUUID().slice(0, 8)}`;
    const otherProject = await prisma.$queryRaw<{ id: string }[]>`INSERT INTO new_product_projects(id, organization_id, code, name, product_code, created_by_id) VALUES (${randomUUID()}::uuid, ${otherOrganizationId}::uuid, ${otherCode}, 'Other metadata', ${otherCode}, ${otherUserId}::uuid) RETURNING id`;
    expect(await service.projectDetail(otherActor, otherProject[0]!.id)).toMatchObject({ id: otherProject[0]!.id, selected_defects: [] });
    expect(await service.selectedDefects(otherActor, otherProject[0]!.id)).toEqual([]);
    await expect(service.projectDetail(otherActor, project.id)).rejects.toMatchObject({ status: 404, response: { code: 'NEW_PRODUCT_PROJECT_NOT_FOUND' } });
    const crossScope = { ...otherActor, scopeOrganizationId: organizationId };
    await expect(service.projectDetail(crossScope, project.id)).rejects.toMatchObject({ status: 403, response: { code: 'FEATURE_PERMISSION_DENIED' } });
    await expect(service.selectedDefects(crossScope, project.id)).rejects.toMatchObject({ status: 403, response: { code: 'FEATURE_PERMISSION_DENIED' } });
  });
});
