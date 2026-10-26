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
});
