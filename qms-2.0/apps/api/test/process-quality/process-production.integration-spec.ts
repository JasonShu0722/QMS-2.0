import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { ProcessProductionService } from '../../src/modules/process-quality/process-production.service.js';
import { ProcessDefectLedgerService } from '../../src/modules/process-quality/process-defect-ledger.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') throw new Error('Disposable PostgreSQL is required');

describe('process production facts on PostgreSQL', () => {
  const prisma = new PrismaService(databaseUrl);
  const audit = new AuditLogService(prisma);
  const mutations = new AdminMutationService(prisma, audit);
  const production = new ProcessProductionService(prisma, mutations, audit);
  const defects = new ProcessDefectLedgerService(prisma, mutations, audit);
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
      await prisma.organization.create({ data: { id, code: `PP-${suffix}-${id.slice(0, 8)}`, name: suffix, type: 'INTERNAL' } });
    }
    await prisma.user.create({ data: { id: userId, organizationId, username: `pp-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.session.create({ data: { id: sessionId, userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    await prisma.role.create({ data: { id: roleId, organizationId, code: 'PP-QE', name: 'Process QE' } });
    for (const code of ['process-quality:defects:read', 'process-quality:defects:write']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId, organizationId, roleId } });
  });

  afterAll(async () => prisma.$disconnect());

  const input = () => ({
    batchCode: `B-${randomUUID().slice(0, 8)}`, workOrderCode: 'WO-01', operationCode: 'ASSEMBLY', productCode: 'P-01',
    lineCode: 'L-01', periodStart, periodEnd, totalQuantity: 100, goodQuantity: 90, firstPassQuantity: 80,
  });

  it('creates an idempotent manual fact and calculates yield from recorded output counts', async () => {
    const facts = input();
    const key = randomUUID();
    const first = await production.create(actor, facts, randomUUID(), key);
    const replay = await production.create(actor, facts, randomUUID(), key);
    expect(replay.id).toBe(first.id);
    expect(first.sourceKind).toBe('MANUAL');
    expect(first.version).toBe(1);
    const summary = await production.summary(actor, { periodStart, periodEnd, productCode: 'P-01' });
    expect(summary.totalQuantity).toBeGreaterThanOrEqual(100);
    expect(summary.goodQuantity).toBeGreaterThanOrEqual(90);
    expect(summary.firstPassQuantity).toBeGreaterThanOrEqual(80);
    const page = await production.list(actor, { periodStart, periodEnd, batchCode: facts.batchCode, page: 1, pageSize: 10 });
    expect(page).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(page.items.map((item) => item.id)).toEqual([first.id]);
    const detail = await production.detail(actor, first.id);
    expect(detail.yieldRate).toBe(0.9);
    expect(detail.firstPassRate).toBe(0.8);
    expect(detail.revisions).toHaveLength(1);
  });

  it('requires consistent quantities and period boundaries', async () => {
    await expect(production.create(actor, { ...input(), firstPassQuantity: 91 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    await expect(production.create(actor, { ...input(), periodEnd: periodStart }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    await expect(production.list(actor, { periodStart, periodEnd, page: 0, pageSize: 10 })).rejects.toMatchObject({ status: 400 });
  });

  it('rejects overlapping production windows for the same batch and operation', async () => {
    const facts = input();
    await production.create(actor, facts, randomUUID(), randomUUID());
    await expect(production.create(actor, { ...facts, periodStart: new Date('2026-09-24T12:00:00Z'), periodEnd: new Date('2026-09-25T12:00:00Z') }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it('keeps immutable revisions and rejects stale compare-and-set writes', async () => {
    const record = await production.create(actor, input(), randomUUID(), randomUUID());
    const corrected = await production.correct(actor, record.id, { expectedVersion: 1, goodQuantity: 95, firstPassQuantity: 85, reason: '复核记录' }, randomUUID(), randomUUID());
    expect(corrected.version).toBe(2);
    await expect(production.correct(actor, record.id, { expectedVersion: 1, goodQuantity: 94, firstPassQuantity: 84, reason: '过期' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const detail = await production.detail(actor, record.id);
    expect(detail.revisions.map((revision: { version: number }) => revision.version)).toEqual([1, 2]);
    expect(detail.revisions[0]).toMatchObject({ good_quantity: 90, first_pass_quantity: 80 });
    await expect(prisma.$executeRaw`UPDATE process_production_revisions SET good_quantity = 70 WHERE organization_id = ${organizationId}::uuid AND production_batch_id = ${record.id}::uuid AND version = 1`).rejects.toThrow();
  });

  it('keeps organization isolation for reads and writes', async () => {
    const record = await production.create(actor, input(), randomUUID(), randomUUID());
    await expect(production.detail({ ...actor, scopeOrganizationId: otherOrganizationId }, record.id)).rejects.toMatchObject({ status: 403 });
    await expect(production.correct({ ...actor, scopeOrganizationId: otherOrganizationId }, record.id, { expectedVersion: 1, goodQuantity: 90, firstPassQuantity: 80, reason: '跨组织' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
  });

  it('drills into matching defects and their formal problem references only', async () => {
    const facts = input();
    const record = await production.create(actor, facts, randomUUID(), randomUUID());
    await defects.createDefectType(actor, { code: 'PROCESS-PP', name: '制程不良' }, randomUUID(), randomUUID());
    const defect = await defects.create(actor, { defectTypeCode: 'PROCESS-PP', description: '装配毛刺', defectQuantity: 2, occurredAt: new Date('2026-09-24T08:00:00Z'), batchCode: facts.batchCode, workOrderCode: facts.workOrderCode, operationCode: facts.operationCode, responsibilityCategory: 'PROCESS' }, randomUUID(), randomUUID());
    const detail = await production.detail(actor, record.id);
    expect(detail.defects.map((item: { id: string }) => item.id)).toContain(defect.id);
    expect(detail.defectQuantity).toBe(2);
  });
});
