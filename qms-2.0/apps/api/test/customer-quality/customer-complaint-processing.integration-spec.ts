import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { CustomerQualityService } from '../../src/modules/customer-quality/customer-quality.service.js';
import { CustomerComplaintProcessingService } from '../../src/modules/customer-quality/customer-complaint-processing.service.js';
import { FileResourceAccess } from '../../src/modules/file-management/file-resource-access.js';
import { CustomerComplaintFileResourceAdapter } from '../../src/modules/customer-quality/customer-complaint-file-resource.adapter.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FilePolicyService } from '../../src/modules/file-management/file-policy.service.js';
import { createObjectStorage } from '../../src/modules/file-management/object-storage.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') {
  throw new Error('An independent disposable PostgreSQL database is required');
}

describe('customer complaint processing schema on PostgreSQL', () => {
  const prisma = new PrismaService(databaseUrl);

  beforeAll(async () => prisma.$connect());
  afterAll(async () => prisma.$disconnect());

  it('has nullable processing projection and immutable event storage', async () => {
    const columns = await prisma.$queryRaw<{ column_name: string; is_nullable: string }[]>`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'customer_quality_complaints'
        AND column_name IN ('category', 'responsible_department_id', 'owner_user_id', 'resolved_at', 'closed_at')`;
    expect(columns).toHaveLength(5);
    expect(columns.every((column) => column.is_nullable === 'YES')).toBe(true);
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'customer_quality_complaint_events'`;
    expect(tables).toHaveLength(1);
  });

  it('stores the 8D revision and approval gate on the complaint aggregate', async () => {
    const columns = await prisma.$queryRaw<{ column_name: string; column_default: string | null }[]>`
      SELECT column_name, column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'customer_quality_complaints'
        AND column_name IN ('eight_d_content', 'eight_d_version', 'eight_d_status', 'eight_d_approval_level', 'eight_d_submitted_at', 'eight_d_approved_at')`;
    expect(columns.map((column) => column.column_name).sort()).toEqual(['eight_d_approval_level', 'eight_d_approved_at', 'eight_d_content', 'eight_d_status', 'eight_d_submitted_at', 'eight_d_version']);
    expect(columns.find((column) => column.column_name === 'eight_d_content')?.column_default).toContain('{}');
  });
});

describe('customer complaint processing on PostgreSQL', () => {
  const prisma = new PrismaService(databaseUrl);
  const audit = new AuditLogService(prisma);
  const mutations = new AdminMutationService(prisma, audit);
  const ledger = new CustomerQualityService(prisma, mutations, audit);
  const resources = new FileResourceAccess([]);
  new CustomerComplaintFileResourceAdapter(resources).onModuleInit();
  const files = new FileLifecycleService(prisma, new FilePolicyService(), createObjectStorage(), audit, resources);
  const service = new CustomerComplaintProcessingService(prisma, mutations, audit, files);
  const organizationId = randomUUID();
  const userId = randomUUID();
  const reviewerId = randomUUID();
  const departmentId = randomUUID();
  const roleId = randomUUID();
  const actor = { id: userId, organizationId, accountType: 'INTERNAL' as const, sessionId: randomUUID() };
  const reviewer = { ...actor, id: reviewerId, sessionId: randomUUID() };

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.organization.create({ data: { id: organizationId, code: `D2-${organizationId.slice(0, 8)}`, name: 'D2', type: 'INTERNAL' } });
    for (const current of [actor, reviewer]) {
      await prisma.user.create({ data: { id: current.id, organizationId, username: current.id, accountType: 'INTERNAL', passwordHash: 'test-only' } });
      await prisma.session.create({ data: { id: current.sessionId, userId: current.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    }
    await prisma.department.create({ data: { id: departmentId, organizationId, code: 'QE', name: '质量部' } });
    await prisma.role.create({ data: { id: roleId, organizationId, code: 'D2', name: 'D2' } });
    for (const code of ['customer-quality:complaints:read', 'customer-quality:complaints:write']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    for (const current of [actor, reviewer]) await prisma.userRole.create({ data: { userId: current.id, organizationId, roleId } });
  });
  afterAll(async () => prisma.$disconnect());

  async function complaint() {
    const customer = await ledger.createCustomer(actor, { code: randomUUID(), name: '客户' }, randomUUID(), randomUUID());
    return ledger.createComplaint(actor, { customerId: customer.id, complaintType: 'ZERO_KM', defectDescription: '壳体裂纹', severity: 'LOW', severityPolicyVersion: 'v1', severitySnapshot: { level: 'LOW' } }, randomUUID(), randomUUID());
  }
  const triageInput = (expectedVersion: number) => ({ expectedVersion, category: 'PRODUCT_QUALITY' as const, responsibleDepartmentId: departmentId, ownerUserId: userId, note: '质量部接收' });

  it('requires triage before resolution and produces an ordered immutable event history', async () => {
    const created = await complaint();
    await expect(service.resolve(actor, created.id, { expectedVersion: 1, resolutionSummary: '完成处理' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const key = randomUUID();
    const triaged = await service.triage(actor, created.id, triageInput(1), randomUUID(), key);
    expect(triaged.status).toBe('IN_ANALYSIS');
    expect(triaged.version).toBe(2);
    expect((await service.triage(actor, created.id, triageInput(1), randomUUID(), key)).version).toBe(2);
    await expect(service.triage(actor, created.id, triageInput(1), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const progressed = await service.progress(actor, created.id, { expectedVersion: 2, note: '缺陷样件已确认' }, randomUUID(), randomUUID());
    expect(progressed.version).toBe(3);
    const events = await service.events(actor, created.id);
    expect(events.map((event: { event_type: string; seq: number }) => [event.event_type, event.seq])).toEqual([['TRIAGED', 1], ['PROGRESS_RECORDED', 2]]);
    await expect(prisma.$executeRaw`UPDATE customer_quality_complaint_events SET note = 'tampered' WHERE complaint_id = ${created.id}::uuid`).rejects.toThrow();
  });

  it('requires an independent reviewer and preserves the history after reopen', async () => {
    const created = await complaint();
    await expect(ledger.archiveComplaint(actor, created.id, 1, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const triaged = await service.triage(actor, created.id, triageInput(1), randomUUID(), randomUUID());
    const resolved = await service.resolve(actor, created.id, { expectedVersion: triaged.version, resolutionSummary: '换件并确认' }, randomUUID(), randomUUID());
    await expect(service.close(actor, created.id, { expectedVersion: resolved.version, note: '复核通过' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    const closed = await service.close(reviewer, created.id, { expectedVersion: resolved.version, note: '复核通过' }, randomUUID(), randomUUID());
    expect(closed.status).toBe('CLOSED');
    const reopened = await service.reopen(actor, created.id, { expectedVersion: closed.version, note: '客户反馈复发' }, randomUUID(), randomUUID());
    expect(reopened.status).toBe('IN_ANALYSIS');
    expect(reopened.resolution_summary).toBeNull();
    expect(reopened.closed_at).toBeNull();
    expect((await service.events(actor, created.id)).map((event: { event_type: string }) => event.event_type)).toEqual(['TRIAGED', 'RESOLVED', 'CLOSED', 'REOPENED']);
  });

  it('authorizes complaint files by organization, permission, and lifecycle', async () => {
    const created = await complaint();
    const resource = { resourceType: 'CustomerComplaint', resourceId: created.id };
    await expect(prisma.$transaction((tx) => resources.authorizeAndLock(tx, actor, resource, 'upload'))).resolves.toMatchObject({ organizationId, version: 1 });
    await expect(prisma.$transaction((tx) => resources.authorizeAndLock(tx, { ...actor, organizationId: randomUUID() }, resource, 'read'))).rejects.toMatchObject({ status: 403 });
    await expect(prisma.$transaction((tx) => resources.authorizeAndLock(tx, actor, { ...resource, resourceType: 'supplier-quality' }, 'upload'))).rejects.toMatchObject({ status: 403 });
    const triaged = await service.triage(actor, created.id, triageInput(1), randomUUID(), randomUUID());
    const resolved = await service.resolve(actor, created.id, { expectedVersion: triaged.version, resolutionSummary: '现场处理完成' }, randomUUID(), randomUUID());
    const closed = await service.close(reviewer, created.id, { expectedVersion: resolved.version, note: '独立复核' }, randomUUID(), randomUUID());
    await expect(prisma.$transaction((tx) => resources.authorizeAndLock(tx, actor, resource, 'read'))).resolves.toMatchObject({ version: closed.version });
    await expect(prisma.$transaction((tx) => resources.authorizeAndLock(tx, actor, resource, 'upload'))).rejects.toMatchObject({ status: 403 });
  });

  it('rejects unscanned evidence without changing the complaint version', async () => {
    const created = await complaint();
    await service.triage(actor, created.id, triageInput(1), randomUUID(), randomUUID());
    const file = await prisma.fileObject.create({ data: { organizationId, objectKey: randomUUID(), originalName: 'evidence.txt', contentType: 'text/plain', sizeBytes: 12, sha256: 'a'.repeat(64), uploadExpiresAt: new Date(Date.now() + 60_000), retainUntil: new Date(Date.now() + 86_400_000), uploadedById: actor.id, resourceType: 'CustomerComplaint', resourceId: created.id, resourceVersion: 2 } });
    await expect(service.progress(actor, created.id, { expectedVersion: 2, note: '证据待扫描', evidenceFileObjectId: file.id }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect((await ledger.detailComplaint(actor, created.id)).version).toBe(2);
    expect(await service.events(actor, created.id)).toHaveLength(1);
  });

  it('records a verified complaint file once and rejects a file bound to another complaint', async () => {
    const created = await complaint();
    await service.triage(actor, created.id, triageInput(1), randomUUID(), randomUUID());
    const sha256 = 'b'.repeat(64);
    const file = await prisma.fileObject.create({ data: {
      organizationId, objectKey: randomUUID(), originalName: 'evidence.txt', contentType: 'text/plain', sizeBytes: 12, sha256,
      verifiedSha256: sha256, verifiedContentType: 'text/plain', verifiedSizeBytes: 12, objectVersionId: 'evidence-test-version',
      uploadCompletedAt: new Date(), uploadExpiresAt: new Date(Date.now() + 60_000), scannedAt: new Date(), scannerEngine: 'ClamAV test',
      scanStatus: 'CLEAN', status: 'AVAILABLE', uploadedById: actor.id, resourceType: 'CustomerComplaint', resourceId: created.id,
      resourceVersion: 2, retainUntil: new Date(Date.now() + 86_400_000),
    } });
    const progressed = await service.progress(actor, created.id, { expectedVersion: 2, note: '扫描通过的照片', evidenceFileObjectId: file.id }, randomUUID(), randomUUID());
    expect(progressed.version).toBe(3);
    expect((await service.events(actor, created.id))[1]).toMatchObject({ evidence_file_object_id: file.id, note: '扫描通过的照片' });
    const another = await complaint();
    await service.triage(actor, another.id, triageInput(1), randomUUID(), randomUUID());
    await expect(service.progress(actor, another.id, { expectedVersion: 2, note: '错误附件', evidenceFileObjectId: file.id }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    expect((await ledger.detailComplaint(actor, another.id)).version).toBe(2);
  });
});
