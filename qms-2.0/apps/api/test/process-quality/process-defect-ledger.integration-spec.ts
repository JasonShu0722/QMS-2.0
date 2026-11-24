import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { ProcessDefectLedgerService } from '../../src/modules/process-quality/process-defect-ledger.service.js';
import { ProcessDefectFileResourceAdapter } from '../../src/modules/process-quality/process-defect-file-resource.adapter.js';
import { FileResourceAccess } from '../../src/modules/file-management/file-resource-access.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') {
  throw new Error('An independent disposable PostgreSQL database is required');
}

describe('process defect ledger on PostgreSQL', () => {
  const prisma = new PrismaService(databaseUrl);
  const audit = new AuditLogService(prisma);
  const mutations = new AdminMutationService(prisma, audit);
  const service = new ProcessDefectLedgerService(prisma, mutations, audit);
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
      await prisma.organization.create({ data: { id, code: `PD-${suffix}-${id.slice(0, 8)}`, name: suffix, type: 'INTERNAL' } });
    }
    await prisma.user.create({ data: { id: userId, organizationId, username: `pqe-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.user.create({ data: { id: otherUserId, organizationId: otherOrganizationId, username: `pqe-${otherUserId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.session.create({ data: { id: sessionId, userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    await prisma.role.create({ data: { id: roleId, organizationId, code: 'PQE', name: 'Process QE' } });
    for (const code of ['process-quality:defects:read', 'process-quality:defects:write', 'process-quality:defects:delete']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId, organizationId, roleId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const facts = () => ({
    defectTypeCode: 'OXIDATION', description: '端子表面氧化', defectQuantity: 12,
    occurredAt: new Date('2026-09-24T02:00:00Z'), batchCode: 'B-001', workOrderCode: 'WO-001',
    operationCode: 'ASSEMBLY', lineCode: 'L-01',
    productCode: 'PD-00001', traceCode: 'PD-TRACE', factoryCode: 'FACTORY_1' as const,
    responsibilityCategory: 'MATERIAL' as const,
  });

  async function create(key = randomUUID()) {
    return service.create(actor, facts(), randomUUID(), key);
  }

  it('creates an independently queryable manual defect and replays the same idempotency key', async () => {
    await service.createDefectType(actor, { code: 'OXIDATION', name: '氧化' }, randomUUID(), randomUUID());
    const key = randomUUID();
    const first = await create(key);
    const replay = await create(key);
    expect(replay.id).toBe(first.id);
    expect(first.version).toBe(1);
    expect(first.sourceKind).toBe('MANUAL');
    expect((await service.list(actor, { page: 1, pageSize: 20, batchCode: 'B-001' })).items.some((item) => item.id === first.id)).toBe(true);
    expect((await service.list(actor, { page: 1, pageSize: 20, batchCode: 'OTHER' })).items.some((item) => item.id === first.id)).toBe(false);
    expect((await service.detail(actor, first.id)).defectTypeCode).toBe('OXIDATION');
  });

  it('rejects stale CAS update and retains historical version', async () => {
    const record = await create();
    const updated = await service.update(actor, record.id, { expectedVersion: 1, description: '复测氧化' }, randomUUID(), randomUUID());
    expect(updated.version).toBe(2);
    expect(updated.factoryCode).toBe('FACTORY_1');
    await expect(service.update(actor, record.id, { expectedVersion: 1, description: '过期写入' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect((await service.detail(actor, record.id)).description).toBe('复测氧化');
  });

  it('requires a factory when saving historical manual records and keeps their prior null in history', async () => {
    const legacy = await prisma.processDefect.create({ data: { organizationId, description: '历史不良', createdById: userId, updatedById: userId } });
    const save = (factoryCode?: 'FACTORY_2') => service.update(actor, legacy.id, { expectedVersion: 1, description: '历史不良补充', factoryCode }, randomUUID(), randomUUID());
    await expect(save()).rejects.toMatchObject({ status: 400, fields: { factoryCode: expect.any(Array) } });
    await expect(service.detail(actor, legacy.id)).resolves.toMatchObject({ factoryCode: null, description: '历史不良', version: 1, pendingCompletion: false });
    await expect(save('FACTORY_2')).resolves.toMatchObject({ factoryCode: 'FACTORY_2', description: '历史不良补充', version: 2 });
    const history = await prisma.$queryRaw<Array<{ before: string | null; after: string | null }>>`SELECT before_facts ->> 'factoryCode' AS "before", after_facts ->> 'factoryCode' AS "after" FROM process_defect_registration_history WHERE defect_id = ${legacy.id}::uuid AND defect_version = 2`;
    expect(history).toEqual([{ before: null, after: 'FACTORY_2' }]);
  });

  it.each([null, 'FACTORY_1'] as const)('prevents a routine IMS update from changing factory %p without blocking other edits', async factoryCode => {
    const ims = await prisma.processDefect.create({ data: { organizationId, sourceKind: 'IMS', externalSourceSystem: 'IMS', sourceReceiptId: randomUUID(), sourceRowIndex: 0, factoryCode, description: 'IMS 来料', createdById: userId, updatedById: userId } });
    await expect(service.update(actor, ims.id, { expectedVersion: 1, factoryCode: 'FACTORY_2' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    await expect(service.update(actor, ims.id, { expectedVersion: 1, description: '复测结果' }, randomUUID(), randomUUID())).resolves.toMatchObject({ factoryCode, description: '复测结果', version: 2 });
  });

  it('rejects invalid factory codes at the database boundary', async () => {
    const record = await create();
    await expect(prisma.$executeRaw`UPDATE process_defects SET factory_code = 'FACTORY_3' WHERE id = ${record.id}::uuid`)
      .rejects.toMatchObject({ code: 'P2010', meta: { driverAdapterError: { message: expect.stringContaining('process_defects_factory_code_check') } } });
    await expect(prisma.processDefect.findUnique({ where: { id: record.id } })).resolves.toMatchObject({ factoryCode: 'FACTORY_1' });
  });

  it('rejects an unassigned organization scope with 403', async () => {
    await expect(service.list({ ...actor, scopeOrganizationId: otherOrganizationId }, { page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 403 });
  });

  it('locks a source with a stable snapshot and exposes archived status without deleting history', async () => {
    const record = await create();
    const locked = await prisma.$transaction((tx) => service.lockAndResolve(tx, { sourceDomain: 'process-quality', sourceType: 'process-defect', sourceId: record.id, sourceVersion: 1, sourceSnapshot: {}, createdBy: userId }));
    expect(locked?.organizationId).toBe(organizationId);
    expect(locked?.sourceVersion).toBe(1);
    expect(locked?.sourceSnapshot).toMatchObject({ defectTypeCode: 'OXIDATION', defectQuantity: 12 });
    const archived = await service.archive(actor, record.id, 1, randomUUID(), randomUUID());
    expect(archived.archivedAt).toBeTruthy();
    const lockedArchive = await prisma.$transaction((tx) => service.lockAndResolve(tx, { sourceDomain: 'process-quality', sourceType: 'process-defect', sourceId: record.id, sourceVersion: 2, sourceSnapshot: {}, createdBy: userId }));
    expect(lockedArchive?.archivedAt).toBeTruthy();
    expect((await service.list(actor, { page: 1, pageSize: 20, includeArchived: false })).items.some((item) => item.id === record.id)).toBe(false);
    expect((await service.list(actor, { page: 1, pageSize: 20, includeArchived: true })).items.some((item) => item.id === record.id)).toBe(false);
  });

  it('stores external identity once without declaring an unverified integration successful', async () => {
    const input = { ...facts(), externalSourceSystem: 'MES', externalRecordKey: 'MES-CASE-1', sourceObservedAt: new Date('2026-09-24T01:00:00Z') };
    const first = await service.create(actor, input, randomUUID(), randomUUID());
    expect(first.ingestionStatus).toBe('PENDING_VERIFICATION');
    await expect(service.create(actor, input, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect(await prisma.processDefect.count({ where: { organizationId, externalSourceSystem: 'MES', externalRecordKey: 'MES-CASE-1' } })).toBe(1);
    expect(await prisma.processDefectIngestionAudit.count({ where: { defectId: first.id, status: 'PENDING_VERIFICATION' } })).toBe(1);
  });

  it('refuses to delete a formal problem source and preserves its source snapshot', async () => {
    const record = await create();
    const problem = await prisma.problemIndex.create({ data: { organizationId, reportNumber: `PD-${randomUUID()}`, domainCode: 'process-quality', problemType: 'PROCESS', sourceType: 'process-defect', sourceId: record.id, severity: 'HIGH', createdById: userId } });
    const source = await prisma.$transaction((tx) => service.lockAndResolve(tx, { sourceDomain: 'process-quality', sourceType: 'process-defect', sourceId: record.id, sourceVersion: 1, sourceSnapshot: {}, createdBy: userId }));
    await prisma.domainSourceIssueLink.create({ data: { organizationId, problemIndexId: problem.id, sourceDomain: 'process-quality', sourceType: 'process-defect', sourceId: record.id, sourceVersion: 1, sourceSnapshot: source!.sourceSnapshot, createdBy: userId } });
    await expect(service.archive(actor, record.id, 1, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect((await service.detail(actor, record.id)).archivedAt).toBeNull();
    expect(await prisma.problemIndex.findUnique({ where: { id: problem.id } })).toMatchObject({ sourceId: record.id });
    expect((await prisma.domainSourceIssueLink.findFirstOrThrow({ where: { problemIndexId: problem.id } })).sourceSnapshot).toMatchObject({ description: '端子表面氧化' });
  });

  it('deactivates a defect type with CAS while keeping existing ledger entries readable', async () => {
    const code = `TYPE-${randomUUID().slice(0, 8)}`.toUpperCase();
    const type = await service.createDefectType(actor, { code, name: '临时失效' }, randomUUID(), randomUUID());
    const record = await service.create(actor, { ...facts(), defectTypeCode: code }, randomUUID(), randomUUID());
    const disabled = await service.updateDefectType(actor, type.id, { expectedVersion: 1, name: '已停用失效', active: false }, randomUUID(), randomUUID());
    expect(disabled.version).toBe(2);
    await expect(service.create(actor, { ...facts(), defectTypeCode: code }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    expect((await service.detail(actor, record.id)).defectTypeCode).toBe(code);
  });

  it('grants scanned evidence access only inside the live defect organization and prevents upload after archive', async () => {
    const record = await create();
    const resources = new FileResourceAccess([]);
    new ProcessDefectFileResourceAdapter(resources, audit).onModuleInit();
    const grant = await prisma.$transaction((tx) => resources.authorizeAndLock(tx, actor, { resourceType: 'process-defect', resourceId: record.id }, 'upload'));
    expect(grant).toMatchObject({ organizationId, version: 1 });
    await expect(prisma.$transaction((tx) => resources.authorizeAndLock(tx, { ...actor, organizationId: otherOrganizationId }, { resourceType: 'process-defect', resourceId: record.id }, 'read'))).rejects.toMatchObject({ status: 403 });
    await service.archive(actor, record.id, 1, randomUUID(), randomUUID());
    await expect(prisma.$transaction((tx) => resources.authorizeAndLock(tx, actor, { resourceType: 'process-defect', resourceId: record.id }, 'upload'))).rejects.toMatchObject({ status: 403 });
    expect((await prisma.$transaction((tx) => resources.authorizeAndLock(tx, actor, { resourceType: 'process-defect', resourceId: record.id }, 'read'))).version).toBe(2);
  });
});
