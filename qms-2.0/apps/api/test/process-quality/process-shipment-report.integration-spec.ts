import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { ProcessProductionService } from '../../src/modules/process-quality/process-production.service.js';
import { ProcessShipmentReportService } from '../../src/modules/process-quality/process-shipment-report.service.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FilePolicyService } from '../../src/modules/file-management/file-policy.service.js';
import { FileResourceAccess } from '../../src/modules/file-management/file-resource-access.js';
import { S3CompatibleObjectStorage } from '../../src/modules/file-management/object-storage.service.js';
import { ProcessShipmentReportFileResourceAdapter } from '../../src/modules/process-quality/process-shipment-report-file-resource.adapter.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') throw new Error('Disposable PostgreSQL is required');

describe('process shipment report snapshots on PostgreSQL', () => {
  const prisma = new PrismaService(databaseUrl);
  const audit = new AuditLogService(prisma);
  const mutations = new AdminMutationService(prisma, audit);
  const production = new ProcessProductionService(prisma, mutations, audit);
  const resources = new FileResourceAccess([]);
  new ProcessShipmentReportFileResourceAdapter(resources).onModuleInit();
  const files = new FileLifecycleService(prisma, new FilePolicyService(), new S3CompatibleObjectStorage(), audit, resources);
  const reports = new ProcessShipmentReportService(prisma, mutations, audit, production, files);
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const roleId = randomUUID();
  const actor = { id: userId, organizationId, accountType: 'INTERNAL' as const, sessionId };
  const periodStart = new Date('2026-09-24T00:00:00Z');
  const periodEnd = new Date('2026-09-25T00:00:00Z');

  beforeAll(async () => {
    await prisma.$connect();
    for (const [id, suffix] of [[organizationId, 'owner'], [otherOrganizationId, 'other']]) {
      await prisma.organization.create({ data: { id, code: `PSR-${suffix}-${id.slice(0, 8)}`, name: suffix, type: 'INTERNAL' } });
    }
    await prisma.user.create({ data: { id: userId, organizationId, username: `psr-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.session.create({ data: { id: sessionId, userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    await prisma.role.create({ data: { id: roleId, organizationId, code: 'PSR-QE', name: 'Shipment QE' } });
    for (const code of ['process-quality:defects:read', 'process-quality:defects:write', 'customer-quality:complaints:read']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId, organizationId, roleId } });
  });

  afterAll(async () => prisma.$disconnect());

  const input = (batchCode = `B-${randomUUID().slice(0, 8)}`) => ({ batchCode, workOrderCode: `WO-${batchCode}`, operationCode: 'ASSEMBLY', productCode: 'P-01', lineCode: 'L-01', periodStart, periodEnd, totalQuantity: 100, goodQuantity: 90, firstPassQuantity: 80 });

  it('freezes production yield and defect quantities in a report snapshot', async () => {
    const batch = await production.create(actor, input(), randomUUID(), randomUUID());
    const report = await reports.create(actor, { reportNumber: `SHIP-${randomUUID().slice(0, 8)}`, periodStart, periodEnd, productCode: 'P-01', batchIds: [batch.id] }, randomUUID(), randomUUID());
    expect(report).toMatchObject({ status: 'DRAFT', batchCount: 1, totalQuantity: 100, goodQuantity: 90, firstPassQuantity: 80, defectQuantity: 0, version: 1 });
    expect(report.snapshot).toMatchObject({ batchCount: 1, yieldRate: 0.9, firstPassRate: 0.8 });
    const detail = await reports.detail(actor, report.id);
    expect(detail.snapshot).toMatchObject({ batches: [{ id: batch.id, totalQuantity: 100 }] });
  });

  it('supports idempotent create, list, archive CAS and replay', async () => {
    const batch = await production.create(actor, input(), randomUUID(), randomUUID());
    const key = randomUUID();
    const first = await reports.create(actor, { periodStart, periodEnd, batchIds: [batch.id] }, randomUUID(), key);
    const replay = await reports.create(actor, { periodStart, periodEnd, batchIds: [batch.id] }, randomUUID(), key);
    expect(replay.id).toBe(first.id);
    expect((await reports.list(actor, { page: 1, pageSize: 10 })).items.map((item) => item.id)).toContain(first.id);
    const archiveKey = randomUUID();
    const archived = await reports.archive(actor, first.id, 1, randomUUID(), archiveKey);
    expect(archived).toMatchObject({ status: 'ARCHIVED', version: 2 });
    const archiveReplay = await reports.archive(actor, first.id, 1, randomUUID(), archiveKey);
    expect(archiveReplay.id).toBe(first.id);
    await expect(reports.archive(actor, first.id, 1, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it('rejects cross-product and cross-organization source access', async () => {
    const batch = await production.create(actor, input(), randomUUID(), randomUUID());
    await expect(reports.create(actor, { periodStart, periodEnd, productCode: 'P-02', batchIds: [batch.id] }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(reports.detail({ ...actor, scopeOrganizationId: otherOrganizationId }, batch.id)).rejects.toMatchObject({ status: 403 });
  });

  it('links an active customer snapshot with CAS and reads it with the report', async () => {
    const batch = await production.create(actor, input(), randomUUID(), randomUUID());
    const report = await reports.create(actor, { periodStart, periodEnd, batchIds: [batch.id] }, randomUUID(), randomUUID());
    const customerId = randomUUID();
    await prisma.$executeRaw`INSERT INTO customer_quality_customers (id, organization_id, code, name, active, version, created_by_id, updated_by_id, updated_at) VALUES (${customerId}::uuid, ${organizationId}::uuid, ${`D7-${customerId.slice(0, 8)}`}, '出货客户', true, 1, ${userId}::uuid, ${userId}::uuid, CURRENT_TIMESTAMP)`;
    const linked = await reports.associateCustomer(actor, report.id, { customerId, expectedVersion: 1 }, randomUUID(), randomUUID());
    expect(linked.customers).toEqual([expect.objectContaining({ customerId, customerVersion: 1, customerCode: `D7-${customerId.slice(0, 8)}`, customerName: '出货客户' })]);
    expect((await reports.detail(actor, report.id)).customers).toHaveLength(1);
    await expect(reports.associateCustomer(actor, report.id, { customerId, expectedVersion: 1 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it('rejects unavailable scan evidence and invalid formal issues', async () => {
    const batch = await production.create(actor, input(), randomUUID(), randomUUID());
    const report = await reports.create(actor, { periodStart, periodEnd, batchIds: [batch.id] }, randomUUID(), randomUUID());
    await expect(reports.updateEvidence(actor, report.id, { expectedVersion: 1, fileIds: [randomUUID()] }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await expect(reports.linkIssue(actor, report.id, { problemId: randomUUID(), expectedVersion: 1, expectedProblemVersion: 1 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404 });
    expect((await reports.detail(actor, report.id)).version).toBe(1);
  });
});
