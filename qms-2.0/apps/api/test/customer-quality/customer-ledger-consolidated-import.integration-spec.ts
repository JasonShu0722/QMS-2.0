import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService, type AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { PositionOnboardingService } from '../../src/modules/organization/position-onboarding.service.js';
import { ComponentProjectService } from '../../src/modules/platform-configuration/component-project.service.js';
import { CustomerComplaintLedgerService } from '../../src/modules/customer-quality/customer-complaint-ledger.service.js';
import type { CustomerLedgerImportDto, CustomerLedgerImportRowDto } from '../../src/modules/customer-quality/customer-complaint-ledger.dto.js';
import { LEDGER_PERMISSIONS as P } from '../../src/modules/customer-quality/customer-complaint-ledger.types.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') {
  throw new Error('An exclusively leased disposable PostgreSQL database is required');
}

describe('Consolidated ledger creation and supplement import on real PostgreSQL', () => {
  const prisma = new PrismaService(process.env.DATABASE_URL);
  const audit = new AuditLogService(prisma);
  const mutations = new AdminMutationService(prisma, audit);
  const organizations = new OrganizationService(prisma, mutations, audit, new PositionOnboardingService(prisma, audit));
  const components = new ComponentProjectService(prisma, mutations, audit, organizations);
  const ledger = new CustomerComplaintLedgerService(prisma, mutations, audit, components, organizations);
  const organizationId = randomUUID();
  let registrar: AdminActor, engineer: AdminActor, cqe: AdminActor, assignmentId: string, cqeAssignmentId: string;
  const create = (fields: object = {}, extra = {}) => ledger.create(registrar, { fields, ...extra }, randomUUID(), randomUUID());
  const commit = (input: CustomerLedgerImportDto, key = randomUUID(), actor = registrar) => ledger.commit(actor, input, randomUUID(), key);
  const supplement = (id: string, expectedVersion: number, fields: object, extra = {}): CustomerLedgerImportRowDto =>
    ({ rowNumber: 1, action: 'SUPPLEMENT', targetId: id, expectedVersion, fields, ...extra });

  async function person(permissions: string[]) {
    const user = await prisma.user.create({ data: { organizationId, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    const session = await prisma.session.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), reauthenticatedAt: new Date() } });
    const role = await prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'Explicit fixture grants' } });
    for (const code of permissions) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId: user.id, organizationId, roleId: role.id } });
    return { id: user.id, organizationId, sessionId: session.id, accountType: 'INTERNAL' as const };
  }

  async function facts(id: string) {
    return {
      row: await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id } }),
      events: await prisma.customerQualityComplaintEvent.findMany({ where: { complaintId: id }, orderBy: { seq: 'asc' } }),
      audits: await prisma.auditEvent.count({ where: { organizationId, resourceId: id, outcome: 'SUCCESS' } }),
    };
  }

  async function batchFacts() {
    return {
      rows: await prisma.customerQualityComplaint.count({ where: { organizationId } }),
      events: await prisma.customerQualityComplaintEvent.count({ where: { organizationId } }),
      audits: await prisma.auditEvent.count({ where: { organizationId, outcome: 'SUCCESS' } }),
      receipts: await prisma.adminMutation.count({ where: { organizationId } }),
    };
  }

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.organization.create({ data: { id: organizationId, code: randomUUID(), name: 'Consolidated import repair', type: 'INTERNAL' } });
    registrar = await person([P.read, P.write]);
    engineer = await person([...Object.values(P), 'component-project:manage']);
    cqe = await person([P.read, P.write]);
    const department = await prisma.department.create({ data: { organizationId, code: randomUUID(), name: 'Quality' } });
    for (const actor of [engineer, cqe]) {
      const position = await prisma.position.create({ data: { organizationId, departmentId: department.id, code: randomUUID(), name: 'Not an identity rule' } });
      const assignment = await prisma.userPosition.create({ data: { organizationId, userId: actor.id, positionId: position.id, startedAt: new Date('2026-01-01') } });
      if (actor === engineer) assignmentId = assignment.id;
      else cqeAssignmentId = assignment.id;
    }
  });
  afterAll(async () => prisma.$disconnect());

  it.each(['mapping', 'project'] as const)('never auto-assigns from a disabled %s on create/ADD, then fills only empty responsibility on restoration', async disabled => {
    const componentCode = randomUUID();
    const project = await components.createProject(engineer, organizationId, { code: componentCode, name: 'NEW and CQE differ', stage: 'NEW_PRODUCT',
      projectEngineerAssignmentId: assignmentId, customerEngineerAssignmentId: cqeAssignmentId,
      status: disabled === 'project' ? 'DISABLED' : 'ACTIVE' }, randomUUID(), randomUUID());
    const mapping = await components.createMapping(engineer, organizationId, { componentCode, projectRecordId: project.id, productCategory: 'controller',
      status: disabled === 'mapping' ? 'DISABLED' : 'ACTIVE' }, randomUUID(), randomUUID());
    const before = await batchFacts();
    const deniedInput: CustomerLedgerImportDto = { mode: 'CONTINUE', rows: [{ rowNumber: 1, action: 'ADD', fields: { componentCode, investigation: 'CQE is not automatic while disabled' } }] };
    const preview = await ledger.preview(cqe, deniedInput);
    expect(preview.items[0]).toMatchObject({ outcome: 'FAILED', errorCode: 'CUSTOMER_LEDGER_RESPONSIBILITY_DENIED' });
    expect(await batchFacts()).toEqual(before);
    const direct = await create({ componentCode });
    expect(direct).toMatchObject({ qualityEngineerId: null, qualityEngineerAssignmentId: null, qualityEngineerSource: null, stage: null });
    const input: CustomerLedgerImportDto = { mode: 'CONTINUE', rows: [{ rowNumber: 1, action: 'ADD', fields: { componentCode, quantity: 2 } }] };
    expect((await ledger.preview(registrar, input)).items[0]!.outcome).toBe('PREVIEW');
    const imported = (await commit(input)).items[0]!.record!;
    expect(imported).toMatchObject({ qualityEngineerId: null, qualityEngineerSource: null, normalized: { quantity: 2 } });
    expect((await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: imported.id } })).qualityEngineerId).toBeNull();
    const manual = await create({ componentCode }, { qualityEngineerAssignmentId: cqeAssignmentId });
    expect(manual).toMatchObject({ qualityEngineerId: cqe.id, qualityEngineerSource: 'MANUAL' });
    if (disabled === 'mapping') await components.updateMapping(engineer, organizationId, mapping.id, { expectedVersion: mapping.version, status: 'ACTIVE' }, randomUUID(), randomUUID());
    else await components.updateProject(engineer, organizationId, project.id, { expectedVersion: project.version, status: 'ACTIVE' }, randomUUID(), randomUUID());
    for (const row of [direct, imported]) {
      const restored = await ledger.detail(registrar, row.id);
      expect(restored).toMatchObject({ qualityEngineerId: engineer.id, qualityEngineerAssignmentId: assignmentId, qualityEngineerSource: 'MAPPING', stage: 'NEW_PRODUCT', version: row.version + 1 });
      expect(restored.history).toHaveLength(1);
      expect((await ledger.detail(registrar, row.id)).version).toBe(restored.version);
    }
    expect(await ledger.detail(registrar, manual.id)).toMatchObject({ qualityEngineerId: cqe.id, qualityEngineerSource: 'MANUAL', version: manual.version });
    expect(await create({ componentCode })).toMatchObject({ qualityEngineerId: engineer.id, stage: 'NEW_PRODUCT' });
  });

  it('keeps explicit manual assignment without mapping and rejects an unavailable override', async () => {
    const row = await create({ componentCode: randomUUID() }, { qualityEngineerAssignmentId: assignmentId });
    expect(row).toMatchObject({ qualityEngineerId: engineer.id, qualityEngineerAssignmentId: assignmentId, qualityEngineerSource: 'MANUAL', stage: null });
    const input: CustomerLedgerImportDto = { mode: 'CONTINUE', rows: [
      { rowNumber: 1, action: 'ADD', qualityEngineerAssignmentId: assignmentId, fields: { quantity: 1 } },
      { rowNumber: 2, action: 'ADD', qualityEngineerAssignmentId: randomUUID(), fields: {} },
    ] };
    const preview = await ledger.preview(registrar, input);
    const result = await commit(input);
    expect(result).toMatchObject({ created: 1, failed: 1, items: [
      { record: { qualityEngineerId: engineer.id, qualityEngineerSource: 'MANUAL' } },
      { errorCode: 'CUSTOMER_LEDGER_ENGINEER_UNAVAILABLE' },
    ] });
    expect(preview.items[1]!.errorCode).toBe(result.items[1]!.errorCode);
  });

  it('rolls back recovered engineer facts when a supplement is skipped or fails CAS, including replay', async () => {
    const code = randomUUID();
    const target = await create({ componentCode: code, productionOn: '2026-01-01', occurredOn: '2026-02-01' });
    const project = await components.createProject(engineer, organizationId, { code, name: 'Recovered mapping', stage: 'MASS_PRODUCTION', customerEngineerAssignmentId: cqeAssignmentId }, randomUUID(), randomUUID());
    await components.createMapping(engineer, organizationId, { componentCode: code, projectRecordId: project.id, productCategory: 'controller' }, randomUUID(), randomUUID());
    const before = await facts(target.id);
    expect(before.row.qualityEngineerId).toBeNull();
    for (const expectedVersion of [target.version + 1, target.version]) {
      const input: CustomerLedgerImportDto = { mode: 'SKIP_ERRORS', rows: [supplement(target.id, expectedVersion, { productionOn: '2026-03-01' })] };
      const key = randomUUID();
      const result = await commit(input, key, cqe);
      expect(result.items[0]).toMatchObject(expectedVersion === target.version + 1 ? { outcome: 'SKIPPED' } : { outcome: 'FAILED', errorCode: 'CONCURRENCY_CONFLICT' });
      expect(await facts(target.id)).toEqual(before);
      expect(await commit(input, key, cqe)).toEqual(result);
      expect(await facts(target.id)).toEqual(before);
    }
  });

  it('uses all merged facts for preview and SKIP_ERRORS, preserves skipped facts and CONTINUE originals/warnings', async () => {
    const target = await create({ complaintType: 'AFTER_SALES', customerName: 'Original', quantity: 1, productionOn: '2026-01-01', occurredOn: '2026-02-01' });
    const rows = [supplement(target.id, target.version, { productionOn: '2026-03-01', occurredOn: '', quantity: null })];
    const before = await facts(target.id);
    const continued: CustomerLedgerImportDto = { mode: 'CONTINUE', rows };
    const preview = await ledger.preview(registrar, continued);
    expect(preview.items[0]!.warnings).toContainEqual({ field: 'occurredOn', code: 'BEFORE_PRODUCTION' });
    expect(preview.items[0]!.warnings).not.toContainEqual({ field: 'quantity', code: 'QUANTITY_NOT_RECORDED' });
    expect(await facts(target.id)).toEqual(before);
    const skipped: CustomerLedgerImportDto = { mode: 'SKIP_ERRORS', rows };
    const skipPreview = await ledger.preview(registrar, skipped);
    expect(skipPreview.items[0]).toMatchObject({ outcome: 'SKIPPED', warnings: expect.arrayContaining([{ field: 'occurredOn', code: 'BEFORE_PRODUCTION' }]) });
    const key = randomUUID();
    const skipResult = await commit(skipped, key);
    expect(skipResult).toMatchObject({ skipped: 1, supplemented: 0, items: [{ record: null, warnings: skipPreview.items[0]!.warnings }] });
    expect(await facts(target.id)).toEqual(before);
    expect(await commit(skipped, key)).toEqual(skipResult);
    expect(await facts(target.id)).toEqual(before);
    const result = await commit(continued);
    expect(result).toMatchObject({ supplemented: 1, pendingCorrection: 1, items: [{ record: { version: target.version + 1,
      raw: { quantity: 1, productionOn: '2026-03-01', occurredOn: '2026-02-01' }, serviceMonths: null, misTag: null } }] });
    expect(result.items[0]!.warnings).toContainEqual({ field: 'occurredOn', code: 'BEFORE_PRODUCTION' });
    const invalid = await create({ quantity: 'original invalid quantity' });
    const invalidRows = [supplement(invalid.id, invalid.version, { defectDescription: 'Still invalid after merge' })];
    const invalidBefore = await facts(invalid.id);
    expect((await commit({ mode: 'SKIP_ERRORS', rows: invalidRows })).skipped).toBe(1);
    expect(await facts(invalid.id)).toEqual(invalidBefore);
    const repaired = await commit({ mode: 'SKIP_ERRORS', rows: [supplement(invalid.id, invalid.version, { quantity: 2 })] });
    expect(repaired).toMatchObject({ supplemented: 1, skipped: 0, items: [{ record: { normalized: { quantity: 2 } } }] });
  });

  it.each([
    ['investigation', { fields: { investigation: 'Supplement must not author investigation' } }, 'CUSTOMER_LEDGER_RESPONSIBILITY_DENIED'],
    ['assignment', { qualityEngineerAssignmentId: null }, 'CUSTOMER_LEDGER_SUPPLEMENT_SCOPE_INVALID'],
    ['customer', { customerId: randomUUID() }, 'CUSTOMER_LEDGER_CUSTOMER_UNAVAILABLE'],
  ] as const)('rejects supplement %s consistently in preview/commit, permits another ADD and replays without rewriting', async (_name, patch, errorCode) => {
    const target = await create({ quantity: 2, investigation: null });
    const input: CustomerLedgerImportDto = { mode: 'SKIP_ERRORS', rows: [
      { ...supplement(target.id, target.version, { quantity: 'bad' }), ...patch },
      { rowNumber: 2, action: 'ADD', fields: { quantity: 2, customerName: 'Allowed mixed row' } },
    ] };
    const before = await batchFacts();
    const targetBefore = await facts(target.id);
    const preview = await ledger.preview(registrar, input);
    expect(preview.items[0]).toMatchObject({ outcome: 'FAILED', errorCode });
    expect(preview.items[1]!.outcome).toBe('PREVIEW');
    expect(await batchFacts()).toEqual(before);
    const key = randomUUID();
    const result = await commit(input, key);
    expect(result).toMatchObject({ created: 1, failed: 1, skipped: 0, items: [{ outcome: 'FAILED', errorCode, record: null }, { outcome: 'CREATED' }] });
    expect(await facts(target.id)).toEqual(targetBefore);
    const after = await batchFacts();
    expect(after).toEqual({ rows: before.rows + 1, events: before.events, audits: before.audits + 1, receipts: before.receipts + 3 });
    expect(await commit(input, key)).toEqual(result);
    expect(await batchFacts()).toEqual(after);
  });

  it('checks target, responsibility, archive and CAS before skipping erroneous supplement facts', async () => {
    const unassigned = await create({ quantity: 2 });
    const assigned = await create({ quantity: 2 }, { qualityEngineerAssignmentId: assignmentId });
    const archived = await create({ quantity: 2 });
    await prisma.customerQualityComplaint.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    const foreignOrganization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Foreign', type: 'INTERNAL' } });
    const foreignCustomer = await prisma.customerQualityCustomer.create({ data: { organizationId: foreignOrganization.id, code: randomUUID(), name: 'Foreign customer', createdById: registrar.id, updatedById: registrar.id } });
    const checks = [
      [supplement(randomUUID(), 1, { quantity: 'bad' }), 'CUSTOMER_COMPLAINT_NOT_FOUND'],
      [supplement(unassigned.id, unassigned.version + 1, { quantity: 'bad' }), 'CONCURRENCY_CONFLICT'],
      [supplement(assigned.id, assigned.version, { quantity: 'bad' }), 'CUSTOMER_LEDGER_RESPONSIBILITY_DENIED'],
      [supplement(archived.id, archived.version, { quantity: 'bad' }), 'CUSTOMER_LEDGER_ARCHIVED'],
      [supplement(unassigned.id, unassigned.version, { quantity: 'bad' }, { customerId: foreignCustomer.id }), 'CUSTOMER_LEDGER_CUSTOMER_UNAVAILABLE'],
    ] as const;
    const before = await Promise.all([unassigned, assigned, archived].map(row => facts(row.id)));
    const input: CustomerLedgerImportDto = { mode: 'SKIP_ERRORS', rows: checks.map(([row], index) => ({ ...row, rowNumber: index + 1 })) };
    const preview = await ledger.preview(registrar, input);
    const result = await commit(input);
    expect(result.failed).toBe(checks.length);
    checks.forEach(([, code], index) => {
      expect(preview.items[index]).toMatchObject({ outcome: 'FAILED', errorCode: code });
      expect(result.items[index]).toMatchObject({ outcome: 'FAILED', errorCode: code });
    });
    expect(await Promise.all([unassigned, assigned, archived].map(row => facts(row.id)))).toEqual(before);
  });
});
