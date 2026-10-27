import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService, type AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { PositionOnboardingService } from '../../src/modules/organization/position-onboarding.service.js';
import { ComponentProjectService } from '../../src/modules/platform-configuration/component-project.service.js';
import { CustomerQualityService } from '../../src/modules/customer-quality/customer-quality.service.js';
import { CustomerComplaintProcessingService } from '../../src/modules/customer-quality/customer-complaint-processing.service.js';
import { CustomerComplaintLedgerService } from '../../src/modules/customer-quality/customer-complaint-ledger.service.js';
import { CustomerComplaintAnalysisService } from '../../src/modules/customer-quality/customer-complaint-analysis.service.js';
import { ANALYSIS_PERMISSIONS, ANALYSIS_RESOURCE_TYPE } from '../../src/modules/customer-quality/customer-complaint-analysis.types.js';
import { CustomerComplaintAnalysisFileAdapter } from '../../src/modules/customer-quality/customer-complaint-analysis-file.adapter.js';
import { CustomerComplaintFileResourceAdapter } from '../../src/modules/customer-quality/customer-complaint-file-resource.adapter.js';
import { LEDGER_PERMISSIONS, type LedgerOperation } from '../../src/modules/customer-quality/customer-complaint-ledger.types.js';
import { CustomerLedgerListDto } from '../../src/modules/customer-quality/customer-complaint-ledger.dto.js';
import { FileResourceAccess, type FileResourceAction } from '../../src/modules/file-management/file-resource-access.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FilePolicyService } from '../../src/modules/file-management/file-policy.service.js';
import { createObjectStorage } from '../../src/modules/file-management/object-storage.service.js';

if (!process.env.DATABASE_URL || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(process.env.DATABASE_URL).port === '55440') {
  throw new Error('An exclusively leased disposable PostgreSQL database is required');
}

describe('N4 genuine archive boundary and accepted engineer handoff on PostgreSQL', () => {
  const prisma = new PrismaService(process.env.DATABASE_URL);
  const audit = new AuditLogService(prisma);
  const mutations = new AdminMutationService(prisma, audit);
  const organizations = new OrganizationService(prisma, mutations, audit, new PositionOnboardingService(prisma, audit));
  const components = new ComponentProjectService(prisma, mutations, audit, organizations);
  const ledger = new CustomerComplaintLedgerService(prisma, mutations, audit, components, organizations);
  const legacy = new CustomerQualityService(prisma, mutations, audit);
  const resources = new FileResourceAccess([]);
  const files = new FileLifecycleService(prisma, new FilePolicyService(), createObjectStorage(), audit, resources);
  const processing = new CustomerComplaintProcessingService(prisma, mutations, audit, files, organizations);
  const analysis = new CustomerComplaintAnalysisService(prisma, mutations, audit, files, organizations, ledger);
  const organizationId = randomUUID();
  const archivedError = { status: 409, response: { code: 'CUSTOMER_LEDGER_ARCHIVED' } };
  let registrar: AdminActor, engineer: AdminActor, reviewer: AdminActor, cqe: AdminActor;
  let assignmentId: string, cqeAssignmentId: string, departmentId: string, customerId: string;

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

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.organization.create({ data: { id: organizationId, code: randomUUID(), name: 'Archive and handoff repair', type: 'INTERNAL' } });
    registrar = await person([LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write]);
    engineer = await person([...Object.values(LEDGER_PERMISSIONS), 'component-project:manage', ANALYSIS_PERMISSIONS.FAE]);
    reviewer = await person([LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write]);
    cqe = await person([LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write, LEDGER_PERMISSIONS.close, LEDGER_PERMISSIONS.closedEdit]);
    const department = await prisma.department.create({ data: { organizationId, code: randomUUID(), name: 'Quality' } });
    departmentId = department.id;
    const position = await prisma.position.create({ data: { organizationId, departmentId, code: randomUUID(), name: 'Not an authorization rule' } });
    assignmentId = (await prisma.userPosition.create({ data: { organizationId, userId: engineer.id, positionId: position.id, startedAt: new Date('2026-01-01') } })).id;
    cqeAssignmentId = (await prisma.userPosition.create({ data: { organizationId, userId: cqe.id, positionId: position.id, startedAt: new Date('2026-01-01') } })).id;
    customerId = (await legacy.createCustomer(registrar, { code: randomUUID(), name: 'Legacy customer' }, randomUUID(), randomUUID())).id;
    new CustomerComplaintFileResourceAdapter(resources, ledger).onModuleInit();
    new CustomerComplaintAnalysisFileAdapter(resources, analysis).onModuleInit();
  });
  afterAll(() => prisma.$disconnect());

  async function legacyRow(productCode?: string, assigned = true) {
    const row = await legacy.createComplaint(registrar, { customerId, complaintType: 'ZERO_KM', productCode,
      defectDescription: 'Original archive facts', severity: 'LOW', severityPolicyVersion: 'archive-fixture', severitySnapshot: { level: 'LOW' } }, randomUUID(), randomUUID());
    if (assigned) await prisma.customerQualityComplaint.update({ where: { id: row.id }, data: {
      qualityEngineerId: engineer.id, qualityEngineerAssignmentId: assignmentId, qualityEngineerSource: 'MANUAL', registeredStage: 'MASS_PRODUCTION',
    } });
    return row;
  }

  async function archive(id: string) {
    const row = await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id } });
    const triaged = await processing.triage(engineer, id, { expectedVersion: row.version, category: 'PRODUCT_QUALITY', responsibleDepartmentId: departmentId, ownerUserId: engineer.id, note: 'Triage' }, randomUUID(), randomUUID());
    const resolved = await processing.resolve(engineer, id, { expectedVersion: triaged.version, resolutionSummary: 'Resolved' }, randomUUID(), randomUUID());
    const closed = await processing.close(reviewer, id, { expectedVersion: resolved.version, note: 'Independent review' }, randomUUID(), randomUUID());
    const archived = await legacy.archiveComplaint(registrar, id, closed.version, randomUUID(), randomUUID());
    expect(archived).toMatchObject({ status: 'ARCHIVED', archived_at: expect.any(String) });
    expect((await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id } })).archivedAt).not.toBeNull();
    expect((await processing.events(registrar, id)).slice(-4).map(event => event.event_type)).toEqual(['TRIAGED', 'RESOLVED', 'CLOSED', 'ARCHIVED']);
    return archived;
  }

  async function snapshot(id: string) {
    const row = await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id } });
    const events = await prisma.$queryRaw`SELECT * FROM customer_quality_complaint_events WHERE complaint_id = ${id}::uuid ORDER BY seq`;
    const success = await prisma.auditEvent.count({ where: { resourceId: id, outcome: 'SUCCESS' } });
    return { row, events, success };
  }

  it.each(['update', 'engineer receiving', 'registrar receiving', 'close', 'reopen'] as const)('keeps an actual archive immutable through %s', async operation => {
    const archived = await archive((await legacyRow()).id);
    const before = await snapshot(archived.id);
    const input = { expectedVersion: archived.version, note: 'Must not reopen the archive' };
    const write = operation === 'update' ? ledger.update(engineer, archived.id, { expectedVersion: archived.version, fields: { investigation: 'Denied supplement' } }, randomUUID(), randomUUID())
      : operation.endsWith('receiving') ? ledger.receiving(operation === 'registrar receiving' ? registrar : engineer, archived.id, { expectedVersion: archived.version, courierNumber: 'Denied' }, randomUUID(), randomUUID())
      : operation === 'close' ? ledger.close(engineer, archived.id, input, randomUUID(), randomUUID()) : ledger.reopen(engineer, archived.id, input, randomUUID(), randomUUID());
    await expect(write).rejects.toMatchObject(archivedError);
    expect(await snapshot(archived.id)).toEqual(before);
    expect(await ledger.detail(registrar, archived.id)).toMatchObject({ status: 'CLOSED', legacyStatus: 'ARCHIVED', archived: true });
  });

  it('rejects archive SUPPLEMENT in preview and commit without adopting or changing its history', async () => {
    const archived = await archive((await legacyRow()).id);
    const before = await snapshot(archived.id);
    const input = { mode: 'CONTINUE' as const, rows: [{ rowNumber: 1, action: 'SUPPLEMENT' as const, targetId: archived.id, expectedVersion: archived.version, fields: { barcode: 'Denied' } }] };
    const preview = await ledger.preview(engineer, input);
    expect(preview.items[0]).toMatchObject({ outcome: 'FAILED', errorCode: 'CUSTOMER_LEDGER_ARCHIVED' });
    const key = randomUUID();
    const result = await ledger.commit(engineer, input, randomUUID(), key);
    expect(result).toMatchObject({ supplemented: 0, failed: 1, items: [{ outcome: 'FAILED', errorCode: 'CUSTOMER_LEDGER_ARCHIVED' }] });
    expect(await ledger.commit(engineer, input, randomUUID(), key)).toEqual(result);
    expect(await snapshot(archived.id)).toEqual(before);
  });

  it.each<LedgerOperation>(['update', 'analysis', 'receiving', 'close', 'reopen', 'closed-edit'])('enforces the archive at the public %s lock, while reads remain available', async operation => {
    const archived = await archive((await legacyRow()).id);
    const before = await snapshot(archived.id);
    await expect(prisma.$transaction(tx => ledger.lockCase(tx, engineer, archived.id, archived.version, operation), { isolationLevel: 'ReadCommitted' })).rejects.toMatchObject(archivedError);
    await expect(prisma.$transaction(tx => ledger.assertReadCase(tx, registrar, archived.id), { isolationLevel: 'ReadCommitted' })).resolves.toMatchObject({ id: archived.id, status: 'CLOSED' });
    expect(await snapshot(archived.id)).toEqual(before);
  });

  it('retains analysis reads but rejects archived dispatch, save, transfer and section-file writes', async () => {
    const row = await legacyRow();
    const assigned = await analysis.assign(engineer, row.id, 'FAE', { expectedVersion: 0, assigneeUserId: engineer.id, assigneeAssignmentId: assignmentId }, randomUUID(), randomUUID());
    const saveInput = { expectedVersion: assigned.version, text: 'Retained analysis' };
    const saveKey = randomUUID();
    const saved = await analysis.save(engineer, assigned.id, saveInput, randomUUID(), saveKey);
    const archived = await archive(row.id);
    const before = await snapshot(row.id);
    const history = await analysis.history(engineer, assigned.id);
    const writes = await Promise.allSettled([
      analysis.assign(engineer, row.id, 'SUPPLIER', { expectedVersion: 0, assigneeUserId: engineer.id, assigneeAssignmentId: assignmentId }, randomUUID(), randomUUID()),
      analysis.save(engineer, assigned.id, { expectedVersion: saved.version, text: 'Denied analysis' }, randomUUID(), randomUUID()),
      analysis.save(engineer, assigned.id, saveInput, randomUUID(), saveKey),
      analysis.transfer(engineer, assigned.id, { expectedVersion: saved.version, assigneeUserId: engineer.id, assigneeAssignmentId: assignmentId }, randomUUID(), randomUUID()),
      ...(['upload', 'complete', 'attach', 'delete'] as const).map(action => prisma.$transaction(tx => resources.authorizeAndLock(tx, engineer, { resourceType: ANALYSIS_RESOURCE_TYPE, resourceId: assigned.id }, action), { isolationLevel: 'ReadCommitted' })),
    ]);
    for (const write of writes) expect(write).toMatchObject({ status: 'rejected', reason: archivedError });
    expect(await analysis.history(engineer, assigned.id)).toEqual(history);
    expect((await analysis.summary(registrar, archived.id)).fae).toMatchObject({ id: assigned.id });
    expect(await snapshot(row.id)).toEqual(before);
  });

  it.each<FileResourceAction>(['upload', 'complete', 'attach', 'delete'])('blocks %s for a genuinely archived row even with a stale formal ledger projection', async action => {
    const archived = await archive((await legacyRow()).id);
    // Simulate a retained ledger projection; the genuine archive timestamp remains authoritative.
    await prisma.customerQualityComplaint.update({ where: { id: archived.id }, data: { ledgerStatus: 'CLOSED' } });
    const before = await snapshot(archived.id);
    const resource = { resourceType: 'CustomerComplaint', resourceId: archived.id };
    await expect(prisma.$transaction(tx => resources.authorizeAndLock(tx, engineer, resource, action), { isolationLevel: 'ReadCommitted' })).rejects.toMatchObject(archivedError);
    await expect(prisma.$transaction(tx => resources.authorizeAndLock(tx, registrar, resource, 'read'), { isolationLevel: 'ReadCommitted' })).resolves.toMatchObject({ version: archived.version });
    expect(await snapshot(archived.id)).toEqual(before);
  });

  it('never autofills an archived empty engineer during detail, list or import similarities, even with a stale FOLLOWING projection', async () => {
    const code = randomUUID();
    const row = await legacyRow(code, false);
    await archive(row.id);
    const project = await components.createProject(engineer, organizationId, { code, name: 'Late archive mapping', stage: 'MASS_PRODUCTION', customerEngineerAssignmentId: cqeAssignmentId }, randomUUID(), randomUUID());
    await components.createMapping(engineer, organizationId, { componentCode: code, projectRecordId: project.id, productCategory: 'controller' }, randomUUID(), randomUUID());
    await prisma.customerQualityComplaint.update({ where: { id: row.id }, data: { ledgerStatus: 'FOLLOWING', vin: code } });
    const before = await snapshot(row.id);
    expect(await ledger.detail(registrar, row.id)).toMatchObject({ qualityEngineerId: null });
    const page = await ledger.list(registrar, Object.assign(new CustomerLedgerListDto(), { componentCode: code }));
    expect(page.items).toEqual([expect.objectContaining({ id: row.id, qualityEngineerId: null })]);
    const mine = await ledger.list(cqe, Object.assign(new CustomerLedgerListDto(), { componentCode: code, mine: 'true' }));
    expect(mine.total).toBe(0);
    const preview = await ledger.preview(registrar, { mode: 'CONTINUE', rows: [{ rowNumber: 1, action: 'ADD', fields: { vin: code } }] });
    expect(preview.items[0]!.similarities).toEqual([expect.objectContaining({ id: row.id, qualityEngineerId: null })]);
    expect(await snapshot(row.id)).toEqual(before);
  });

  it.each(['update', 'receiving', 'close', 'reopen', 'SUPPLEMENT'] as const)('revalidates the archive before returning a previously successful %s receipt', async operation => {
    const row = await legacyRow();
    const key = randomUUID();
    let replay: () => Promise<unknown>;
    if (operation === 'SUPPLEMENT') {
      const input = { mode: 'CONTINUE' as const, rows: [{ rowNumber: 1, action: 'SUPPLEMENT' as const, targetId: row.id, expectedVersion: row.version, fields: { barcode: 'Retained receipt' } }] };
      replay = () => ledger.commit(engineer, input, randomUUID(), key);
      expect(await replay()).toMatchObject({ supplemented: 1 });
    } else if (operation === 'receiving') {
      const input = { expectedVersion: row.version, courierNumber: 'Retained receipt' };
      replay = () => ledger.receiving(registrar, row.id, input, randomUUID(), key);
      await replay();
    } else if (operation === 'update') {
      const input = { expectedVersion: row.version, fields: { investigation: 'Retained receipt' } };
      replay = () => ledger.update(engineer, row.id, input, randomUUID(), key);
      await replay();
    } else {
      const closed = await ledger.close(engineer, row.id, { expectedVersion: row.version, note: 'Close' }, randomUUID(), operation === 'close' ? key : randomUUID());
      const input = { expectedVersion: operation === 'close' ? row.version : closed.version, note: operation === 'close' ? 'Close' : 'Resume' };
      replay = () => operation === 'close' ? ledger.close(engineer, row.id, input, randomUUID(), key) : ledger.reopen(engineer, row.id, input, randomUUID(), key);
      await replay();
    }
    // Keep real receipts, restore only the legacy classification required by its archive API.
    await prisma.customerQualityComplaint.update({ where: { id: row.id }, data: { ledgerStatus: null } });
    await archive(row.id);
    const before = await snapshot(row.id);
    await expect(replay()).rejects.toMatchObject(archivedError);
    expect(await snapshot(row.id)).toEqual(before);
  });

  it.each(['CLOSED', 'ARCHIVED'] as const)('keeps legacy %s without archived_at eligible for closed edit and receiving', async status => {
    const row = await legacyRow();
    await prisma.customerQualityComplaint.update({ where: { id: row.id }, data: { status } });
    const edited = await ledger.update(engineer, row.id, { expectedVersion: row.version, fields: { investigation: 'Allowed supplement' } }, randomUUID(), randomUUID());
    expect(edited).toMatchObject({ status: 'CLOSED', legacyStatus: status, normalized: { investigation: 'Allowed supplement' } });
    const received = await ledger.receiving(registrar, row.id, { expectedVersion: edited.version, courierNumber: 'Allowed' }, randomUUID(), randomUUID());
    expect(received.courierNumber).toBe('Allowed');
    expect((await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: row.id } })).archivedAt).toBeNull();
  });

  it.each(['detail', 'list'] as const)('accepts the current MASS basis on first %s autofill of an empty NEW engineer without replacing registration history', async read => {
    const code = randomUUID();
    const project = await components.createProject(engineer, organizationId, { code, name: 'Late first CQE', stage: 'NEW_PRODUCT' }, randomUUID(), randomUUID());
    await components.createMapping(engineer, organizationId, { componentCode: code, projectRecordId: project.id, productCategory: 'controller' }, randomUUID(), randomUUID());
    const row = await ledger.create(registrar, { fields: { complaintType: 'ZERO_KM', componentCode: code } }, randomUUID(), randomUUID());
    const original = await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: row.id } });
    expect(original).toMatchObject({ registeredStage: 'NEW_PRODUCT', qualityEngineerId: null, qualityEngineerAssignmentId: null });
    expect(original.ledgerMappingSnapshot).toMatchObject({ project: { stage: 'NEW_PRODUCT' } });
    const mass = await components.updateProject(engineer, organizationId, project.id, { expectedVersion: project.version, stage: 'MASS_PRODUCTION', customerEngineerAssignmentId: cqeAssignmentId }, randomUUID(), randomUUID());
    const recovered = read === 'detail' ? await ledger.detail(cqe, row.id)
      : (await ledger.list(cqe, Object.assign(new CustomerLedgerListDto(), { componentCode: code, mine: 'true' }))).items[0]!;
    expect(recovered).toMatchObject({ id: row.id, version: row.version + 1, qualityEngineerId: cqe.id, qualityEngineerAssignmentId: cqeAssignmentId, qualityEngineerSource: 'MAPPING', stage: 'MASS_PRODUCTION' });
    // This actor's real fixture grants exclude project write; the accepted MASS basis must authorize the next write.
    const updated = await ledger.update(cqe, row.id, { expectedVersion: recovered.version, fields: { investigation: 'First CQE continues' } }, randomUUID(), randomUUID());
    expect(updated.normalized.investigation).toBe('First CQE continues');
    const received = await ledger.receiving(cqe, row.id, { expectedVersion: updated.version, courierNumber: 'Late CQE receipt' }, randomUUID(), randomUUID());
    expect(received.courierNumber).toBe('Late CQE receipt');
    const saved = await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: row.id } });
    expect(saved.registeredStage).toBe('MASS_PRODUCTION');
    expect(saved.ledgerMappingSnapshot).toEqual(original.ledgerMappingSnapshot);
    const detail = await ledger.detail(cqe, row.id);
    const recoveries = detail.history.filter(event => event.eventType === 'REASSIGNED');
    expect(recoveries).toHaveLength(1);
    expect(JSON.parse(recoveries[0]!.note)).toMatchObject({ operation: 'MAPPING_ENGINEER_FILLED',
      previousAssignmentBasis: { stage: 'NEW_PRODUCT', userId: null, assignmentId: null, source: null },
      assignmentBasis: { stage: 'MASS_PRODUCTION', userId: cqe.id, assignmentId: cqeAssignmentId, source: 'MAPPING' } });
    await components.updateProject(engineer, organizationId, project.id, { expectedVersion: mass.version, stage: 'NEW_PRODUCT', projectEngineerAssignmentId: assignmentId }, randomUUID(), randomUUID());
    expect(await ledger.detail(cqe, row.id)).toMatchObject({ version: received.version, qualityEngineerId: cqe.id, qualityEngineerAssignmentId: cqeAssignmentId, qualityEngineerSource: 'MAPPING' });
    expect((await ledger.list(cqe, Object.assign(new CustomerLedgerListDto(), { componentCode: code, mine: 'true' }))).items).toEqual([expect.objectContaining({ id: row.id, version: received.version, qualityEngineerId: cqe.id })]);
    const closed = await ledger.close(cqe, row.id, { expectedVersion: received.version, note: 'First accepted CQE completes' }, randomUUID(), randomUUID());
    expect(closed.status).toBe('CLOSED');
    const final = await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: row.id } });
    expect(final).toMatchObject({ registeredStage: 'MASS_PRODUCTION', qualityEngineerId: cqe.id, qualityEngineerAssignmentId: cqeAssignmentId });
    expect(final.ledgerMappingSnapshot).toEqual(original.ledgerMappingSnapshot);
    expect((await ledger.detail(cqe, row.id)).history.filter(event => event.eventType === 'REASSIGNED')).toEqual(recoveries);
  }, 30000);

  it('retains the original owner on mapping flip, then accepts a MASS CQE handoff with usable saved authorization and immutable registration mapping', async () => {
    const code = randomUUID();
    const project = await components.createProject(engineer, organizationId, { code, name: 'Handoff', stage: 'NEW_PRODUCT', projectEngineerAssignmentId: assignmentId }, randomUUID(), randomUUID());
    await components.createMapping(engineer, organizationId, { componentCode: code, projectRecordId: project.id, productCategory: 'controller' }, randomUUID(), randomUUID());
    const row = await ledger.create(registrar, { fields: { complaintType: 'ZERO_KM', componentCode: code } }, randomUUID(), randomUUID());
    const original = await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: row.id } });
    expect(original.registeredStage).toBe('NEW_PRODUCT');
    await expect(ledger.update(engineer, row.id, { expectedVersion: row.version, fields: {}, qualityEngineerAssignmentId: cqeAssignmentId }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409, response: { code: 'CUSTOMER_LEDGER_ENGINEER_UNAVAILABLE' } });
    await components.updateProject(engineer, organizationId, project.id, { expectedVersion: project.version, stage: 'MASS_PRODUCTION', customerEngineerAssignmentId: cqeAssignmentId }, randomUUID(), randomUUID());
    const retained = await ledger.detail(registrar, row.id);
    expect(retained).toMatchObject({ version: row.version, qualityEngineerId: engineer.id, qualityEngineerSource: 'MAPPING' });
    expect(retained.warnings.map(w => w.code)).toEqual(expect.arrayContaining(['PROJECT_STAGE_CHANGED', 'ENGINEER_HANDOVER_REQUIRED']));
    const beforeHandoff = await ledger.update(engineer, row.id, { expectedVersion: retained.version, fields: { investigation: 'Original engineer can continue' } }, randomUUID(), randomUUID());
    const handed = await ledger.update(engineer, row.id, { expectedVersion: beforeHandoff.version, fields: {}, qualityEngineerAssignmentId: cqeAssignmentId }, randomUUID(), randomUUID());
    expect(handed).toMatchObject({ qualityEngineerId: cqe.id, qualityEngineerSource: 'MANUAL' });
    const updated = await ledger.update(cqe, row.id, { expectedVersion: handed.version, fields: { investigation: 'New CQE continues' } }, randomUUID(), randomUUID());
    const saved = await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: row.id } });
    expect(saved.registeredStage).toBe('MASS_PRODUCTION');
    expect(saved.ledgerMappingSnapshot).toEqual(original.ledgerMappingSnapshot);
    expect(handed.warnings.map(w => w.code)).not.toContain('ENGINEER_NO_LONGER_ELIGIBLE');
    const detail = await ledger.detail(cqe, row.id);
    const handoff = JSON.parse([...detail.history].reverse().find(event => event.eventType === 'REASSIGNED')!.note);
    expect(handoff).toMatchObject({ previousAssignmentBasis: { stage: 'NEW_PRODUCT', assignmentId, userId: engineer.id, source: 'MAPPING' },
      assignmentBasis: { stage: 'MASS_PRODUCTION', assignmentId: cqeAssignmentId, userId: cqe.id, source: 'MANUAL' } });
    const received = await ledger.receiving(cqe, row.id, { expectedVersion: updated.version, courierNumber: 'New CQE' }, randomUUID(), randomUUID());
    const closed = await ledger.close(cqe, row.id, { expectedVersion: received.version, note: 'Complete' }, randomUUID(), randomUUID());
    const supplemented = await ledger.update(cqe, row.id, { expectedVersion: closed.version, fields: { investigation: 'Closed supplement' } }, randomUUID(), randomUUID());
    expect((await ledger.reopen(cqe, row.id, { expectedVersion: supplemented.version, note: 'Continue' }, randomUUID(), randomUUID())).status).toBe('FOLLOWING');
    await expect(ledger.update(engineer, row.id, { expectedVersion: supplemented.version + 1, fields: { investigation: 'Old owner denied' } }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    expect((await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: row.id } })).ledgerMappingSnapshot).toEqual(original.ledgerMappingSnapshot);
  }, 30000);
});
