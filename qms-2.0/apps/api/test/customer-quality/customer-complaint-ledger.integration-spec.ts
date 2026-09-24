import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { CustomerQualityService } from '../../src/modules/customer-quality/customer-quality.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') {
  throw new Error('An independent disposable PostgreSQL database is required');
}

describe('customer complaint ledger on PostgreSQL', () => {
  const prisma = new PrismaService(databaseUrl);
  const audit = new AuditLogService(prisma);
  const mutations = new AdminMutationService(prisma, audit);
  const service = new CustomerQualityService(prisma, mutations, audit);
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const sessionId = randomUUID();
  const roleId = randomUUID();
  const actor = { id: userId, organizationId, accountType: 'INTERNAL' as const, sessionId };

  beforeAll(async () => {
    await prisma.$connect();
    const [server] = await prisma.$queryRaw<{ server_version_num: string }[]>`SHOW server_version_num`;
    expect(Number(server!.server_version_num)).toBeGreaterThanOrEqual(180000);
    for (const [id, suffix] of [[organizationId, 'owner'], [otherOrganizationId, 'other']]) {
      await prisma.organization.create({ data: { id, code: `CQ-${suffix}-${id.slice(0, 8)}`, name: suffix, type: 'INTERNAL' } });
    }
    await prisma.user.create({ data: { id: userId, organizationId, username: `cqe-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.user.create({ data: { id: otherUserId, organizationId: otherOrganizationId, username: `cqe-${otherUserId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.session.create({ data: { id: sessionId, userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    await prisma.role.create({ data: { id: roleId, organizationId, code: 'CQE', name: 'Customer QE' } });
    for (const code of ['customer-quality:complaints:read', 'customer-quality:complaints:write']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId, organizationId, roleId } });
  });

  afterAll(async () => prisma.$disconnect());

  async function customer(code = `C-${randomUUID().slice(0, 8)}`) {
    return service.createCustomer(actor, { code, name: '客户甲' }, randomUUID(), randomUUID());
  }

  it('creates customer master data, replays idempotency, and rejects duplicate code', async () => {
    const key = randomUUID();
    const first = await service.createCustomer(actor, { code: 'C-001', name: '客户甲' }, randomUUID(), key);
    const replay = await service.createCustomer(actor, { code: 'C-001', name: '客户甲' }, randomUUID(), key);
    expect(replay.id).toBe(first.id);
    await expect(service.createCustomer(actor, { code: 'C-001', name: '客户乙' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it('prevents new complaints for inactive customers but preserves existing history', async () => {
    const record = await customer();
    const disabled = await service.updateCustomer(actor, record.id, { expectedVersion: 1, active: false }, randomUUID(), randomUUID());
    expect(disabled.active).toBe(false);
    await expect(service.createComplaint(actor, { customerId: record.id, complaintType: 'ZERO_KM', defectDescription: '停用客户投诉', severity: 'MEDIUM', severityPolicyVersion: 'policy-1', severitySnapshot: { level: 'MEDIUM' } }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it('validates 0KM and after-sales facts and supports physical branches', async () => {
    const record = await customer();
    await expect(service.createComplaint(actor, { customerId: record.id, complaintType: 'AFTER_SALES', defectDescription: '缺少 VIN', severity: 'HIGH', severityPolicyVersion: 'policy-1', severitySnapshot: { level: 'HIGH' } }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    const complaint = await service.createComplaint(actor, {
      customerId: record.id, complaintType: 'AFTER_SALES', terminalCustomerName: '终端用户', productCode: 'P-1', defectDescription: '异响', vin: 'VIN-001', mileage: 1200,
      purchaseDate: new Date('2026-01-01'), returnRequired: true, physicalAnalysisRequired: true, severity: 'HIGH', severityPolicyVersion: 'policy-1', severitySnapshot: { level: 'HIGH', escalation: 'manual' },
    }, randomUUID(), randomUUID());
    expect(complaint.physical_analysis_required).toBe(true);
    const disposition = await service.recordPhysicalDisposition(actor, complaint.id, { action: 'REPAIR', status: 'RECEIVED', responsibility: 'Customer QE' }, randomUUID(), randomUUID());
    expect(disposition.status).toBe('RECEIVED');
    const analysis = await service.recordPhysicalAnalysis(actor, complaint.id, { summary: '端子松动', status: 'COMPLETED', evidenceSummary: '照片已归档' }, randomUUID(), randomUUID());
    expect(analysis.status).toBe('COMPLETED');
    expect((await service.detailComplaint(actor, complaint.id)).physical_analysis_required).toBe(true);
  });

  it('enforces CAS, organization scope, and external source pending verification', async () => {
    const record = await customer();
    const complaint = await service.createComplaint(actor, { customerId: record.id, complaintType: 'ZERO_KM', defectDescription: '外部追溯', severity: 'LOW', severityPolicyVersion: 'policy-1', severitySnapshot: { level: 'LOW' }, externalSourceSystem: 'IMS', externalRecordKey: 'IMS-001', sourceObservedAt: new Date('2026-09-24T02:00:00Z') }, randomUUID(), randomUUID());
    expect(complaint.ingestion_status).toBe('PENDING_VERIFICATION');
    await expect(service.updateComplaint(actor, complaint.id, { expectedVersion: 1, defectDescription: '更新' }, randomUUID(), randomUUID())).resolves.toMatchObject({ version: 2 });
    await expect(service.updateComplaint(actor, complaint.id, { expectedVersion: 1, defectDescription: '过期' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(service.detailComplaint({ ...actor, scopeOrganizationId: otherOrganizationId }, complaint.id)).rejects.toMatchObject({ status: 403 });
  });

  it('does not create a formal problem as a side effect of complaint registration', async () => {
    const record = await customer();
    const complaint = await service.createComplaint(actor, { customerId: record.id, complaintType: 'ZERO_KM', defectDescription: '仅台账处置', severity: 'LOW', severityPolicyVersion: 'policy-1', severitySnapshot: { level: 'LOW' }, physicalAnalysisRequired: false }, randomUUID(), randomUUID());
    expect(complaint.problem_index_id).toBeNull();
    const count = await prisma.problemIndex.count({ where: { organizationId, sourceType: 'customer-complaint', sourceId: complaint.id } });
    expect(count).toBe(0);
  });

  it('keeps disposition history, exposes the current record, and rejects changes after closure', async () => {
    const record = await customer();
    const complaint = await service.createComplaint(actor, { customerId: record.id, complaintType: 'ZERO_KM', defectDescription: '退件维修', returnRequired: true, severity: 'L2', severityPolicyVersion: 'policy-2', severitySnapshot: { level: 'L2' } }, randomUUID(), randomUUID());
    const received = await service.recordPhysicalDisposition(actor, complaint.id, { action: 'REPAIR', status: 'RECEIVED' }, randomUUID(), randomUUID());
    const closed = await service.recordPhysicalDisposition(actor, complaint.id, { action: 'REPAIR', status: 'CLOSED', notes: '维修完成' }, randomUUID(), randomUUID());
    const detail = await service.detailComplaint(actor, complaint.id);
    expect(detail.currentDisposition.id).toBe(closed.id);
    expect(detail.version).toBe(3);
    expect((await service.dispositionHistory(actor, complaint.id)).map((item: { id: string }) => item.id)).toEqual([received.id, closed.id]);
    await expect(service.recordPhysicalDisposition(actor, complaint.id, { action: 'REPAIR', status: 'PENDING' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it('tracks received returns through repair or scrap with consistent action and status', async () => {
    const record = await customer();
    const complaint = await service.createComplaint(actor, { customerId: record.id, complaintType: 'ZERO_KM', defectDescription: '退件后返修', returnRequired: true, severity: 'L2', severityPolicyVersion: 'policy-2', severitySnapshot: { level: 'L2' } }, randomUUID(), randomUUID());
    await service.recordPhysicalDisposition(actor, complaint.id, { action: 'RETURN', status: 'RECEIVED' }, randomUUID(), randomUUID());
    await expect(service.recordPhysicalDisposition(actor, complaint.id, { action: 'SCRAP', status: 'REPAIRED' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    const repaired = await service.recordPhysicalDisposition(actor, complaint.id, { action: 'REPAIR', status: 'REPAIRED', responsibility: '返修责任人' }, randomUUID(), randomUUID());
    expect(repaired.version).toBe(2);
    expect((await service.detailComplaint(actor, complaint.id)).currentDisposition.action).toBe('REPAIR');
  });

  it('routes analysis only when required and preserves current and historical states', async () => {
    const record = await customer();
    const complaint = await service.createComplaint(actor, { customerId: record.id, complaintType: 'ZERO_KM', defectDescription: '需实物解析', physicalAnalysisRequired: true, severity: 'L2', severityPolicyVersion: 'policy-2', severitySnapshot: { level: 'L2' } }, randomUUID(), randomUUID());
    const pending = await service.recordPhysicalAnalysis(actor, complaint.id, { summary: '待收到退件', status: 'MISSING' }, randomUUID(), randomUUID());
    const completed = await service.recordPhysicalAnalysis(actor, complaint.id, { summary: '焊点开裂', status: 'COMPLETED', evidenceSummary: '显微照片' }, randomUUID(), randomUUID());
    const detail = await service.detailComplaint(actor, complaint.id);
    expect(detail.currentAnalysis.id).toBe(completed.id);
    expect(detail.version).toBe(3);
    expect((await service.analysisHistory(actor, complaint.id)).map((item: { id: string }) => item.id)).toEqual([pending.id, completed.id]);
    await expect(service.recordPhysicalAnalysis(actor, complaint.id, { summary: '再次待件', status: 'MISSING' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const direct = await service.createComplaint(actor, { customerId: record.id, complaintType: 'ZERO_KM', defectDescription: '无需解析', severity: 'L2', severityPolicyVersion: 'policy-2', severitySnapshot: { level: 'L2' } }, randomUUID(), randomUUID());
    await expect(service.recordPhysicalAnalysis(actor, direct.id, { summary: '不应进入解析', status: 'IN_PROGRESS' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it('binds severity and policy version into the snapshot and rejects contradictions', async () => {
    const record = await customer();
    await expect(service.createComplaint(actor, { customerId: record.id, complaintType: 'ZERO_KM', defectDescription: '错误等级', severity: 'L2', severityPolicyVersion: 'policy-2', severitySnapshot: { level: 'L3' } }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    const complaint = await service.createComplaint(actor, { customerId: record.id, complaintType: 'ZERO_KM', defectDescription: '等级快照', severity: 'L2', severityPolicyVersion: 'policy-2', severitySnapshot: { level: 'L2' } }, randomUUID(), randomUUID());
    expect(complaint.severity_snapshot).toMatchObject({ level: 'L2', policyVersion: 'policy-2' });
    await expect(service.updateComplaint(actor, complaint.id, { expectedVersion: 1, severity: 'L1', severityPolicyVersion: 'policy-3', severitySnapshot: { level: 'L1', policyVersion: 'policy-2' } }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    expect((await service.detailComplaint(actor, complaint.id)).version).toBe(1);
  });

  it('denies reads after permission revocation and retains archived history', async () => {
    const record = await customer();
    const complaint = await service.createComplaint(actor, { customerId: record.id, complaintType: 'ZERO_KM', defectDescription: '归档历史', severity: 'LOW', severityPolicyVersion: 'policy-1', severitySnapshot: { level: 'LOW' } }, randomUUID(), randomUUID());
    const archived = await service.archiveComplaint(actor, complaint.id, 1, randomUUID(), randomUUID());
    expect(archived.archived_at).toBeTruthy();
    expect((await service.detailComplaint(actor, complaint.id)).id).toBe(complaint.id);
    await expect(service.updateComplaint(actor, complaint.id, { expectedVersion: 2, defectDescription: '非法修改' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'customer-quality:complaints:read' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: permission.id } } });
    await expect(service.detailComplaint(actor, complaint.id)).rejects.toMatchObject({ status: 403 });
  });
});
