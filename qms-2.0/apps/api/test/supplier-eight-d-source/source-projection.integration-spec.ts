import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import type { AdminActor } from '../../src/common/security/admin-mutation.service.js';
import type { SupplierCopyProjectionPort, SupplierCopySource } from '../../src/common/eight-d/supplier-copy.types.js';
import { ProcessDefectLedgerService } from '../../src/modules/process-quality/process-defect-ledger.service.js';
import { CustomerComplaintLedgerService } from '../../src/modules/customer-quality/customer-complaint-ledger.service.js';
import { NewProductEightDSourceService } from '../../src/modules/new-product-quality/new-product-eight-d-source.service.js';
import { SupplierQualityService } from '../../src/modules/supplier-quality/supplier-quality.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Exclusive disposable PostgreSQL required, never preview 55440');

describe('supplier copy public owned factual projections', () => {
  let app: INestApplication; let db: PrismaService;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init(); db = app.get(PrismaService);
    await db.$queryRaw`SELECT 1 FROM process_defect_material_items LIMIT 1`;
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  async function fixture(codes = ['process-quality:defects:read', 'customer-quality:complaints:read', 'new-product-quality:projects:read', 'supplier-quality:issues:copy']) {
    const org = await db.organization.create({ data: { code: randomUUID(), name: 'Copy scope', type: 'INTERNAL' } });
    const user = await db.user.create({ data: { organizationId: org.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'fixture-only' } });
    const session = await db.session.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), reauthenticatedAt: new Date(), mfaVerifiedAt: new Date() } });
    const permissions = await db.permission.findMany({ where: { code: { in: codes } } });
    expect(permissions).toHaveLength(codes.length);
    const role = await db.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Actual source reader and supplier copier', permissions: { create: permissions.map(p => ({ permissionId: p.id })) } } });
    await db.userRole.create({ data: { organizationId: org.id, userId: user.id, roleId: role.id } });
    const actor: AdminActor = { id: user.id, sessionId: session.id, organizationId: org.id, accountType: 'INTERNAL' };
    const defect = await db.processDefect.create({ data: { organizationId: org.id, description: 'Factual crack', productCode: 'FINISHED-NOT-BAD-MATERIAL', defectQuantity: null, createdById: user.id, updatedById: user.id } });
    return { actor, org, user, session, role, defect };
  }

  function project(service: object, actor: AdminActor, source: SupplierCopySource) {
    const port = service as Partial<SupplierCopyProjectionPort>;
    expect(typeof port.supplierCopyProjection).toBe('function');
    return db.$transaction(tx => port.supplierCopyProjection!(tx, actor, source), { isolationLevel: 'ReadCommitted' });
  }

  it('provides a read-only batch project-lock preparation port before taking process source locks', () => {
    const port = app.get(NewProductEightDSourceService) as unknown as { prepareSupplierCopyProjection?: unknown };
    expect(typeof port.prepareSupplierCopyProjection).toBe('function');
  });

  it('preserves incoming draft authorization and errors on the neutral transaction port, including rollback', async () => {
    const f = await fixture(['supplier-quality:problems:write']);
    const profile = await db.supplierBusinessProfile.create({ data: { ownerOrganizationId: f.org.id, businessCode: randomUUID(), displayName: 'No portal bound' } });
    const dto = { profileId: profile.id, title: 'Explicit draft', materialCode: 'MATERIAL', defectDescription: 'Reviewed fact', defectQuantity: 5,
      severity: 'MEDIUM' as const, responseForm: 'EIGHT_D' as const, replyMode: 'SUPPLIER' as const };
    const supplier = app.get(SupplierQualityService);
    const neutral = await db.$transaction(tx => supplier.createDraftInTransaction(tx, f.actor, dto, randomUUID()));
    const incoming = await db.$transaction(tx => supplier.createDraftFromIncoming(tx, f.actor, dto, randomUUID()));
    for (const receipt of [neutral, incoming]) expect(await db.supplierQualityProblem.findUniqueOrThrow({ where: { id: receipt.id } })).toMatchObject({ ...dto, problemIndexId: null, releasedToSupplierAt: null });
    const before = await db.supplierQualityProblem.count({ where: { ownerOrganizationId: f.org.id } });
    const traceId = randomUUID();
    await expect(db.$transaction(async tx => {
      await supplier.createDraftInTransaction(tx, f.actor, dto, traceId);
      throw new Error('Caller failure must roll back draft and audit');
    })).rejects.toThrow('Caller failure');
    expect(await db.supplierQualityProblem.count({ where: { ownerOrganizationId: f.org.id } })).toBe(before);
    expect(await db.auditEvent.count({ where: { traceId } })).toBe(0);
    for (const method of [supplier.createDraftInTransaction.bind(supplier), supplier.createDraftFromIncoming.bind(supplier)]) {
      await expect(db.$transaction(tx => method(tx, f.actor, { ...dto, organizationId: randomUUID() }, randomUUID()))).rejects.toMatchObject({ status: 403 });
      await expect(db.$transaction(tx => method(tx, f.actor, { ...dto, defectQuantity: 0 }, randomUUID()))).rejects.toMatchObject({ status: 400, response: { code: 'SUPPLIER_INPUT_INVALID' } });
    }
  });

  it('allows actual READ + supplier COPY without PQE issue, excludes finished code and keeps unknown quantity', async () => {
    const f = await fixture();
    const source: SupplierCopySource = { kind: 'PROCESS_LEDGER', sourceId: f.defect.id, sourceVersion: f.defect.version };
    await db.processDefect.update({ where: { id: f.defect.id }, data: { ledgerStatus: 'CLOSED', closedById: f.actor.id, closedAt: new Date() } });
    const before = await db.processDefect.findUniqueOrThrow({ where: { id: f.defect.id } });
    expect(await project(app.get(ProcessDefectLedgerService), f.actor, source)).toEqual({ organizationId: f.org.id, source,
      facts: [{ factKey: `PROCESS_LEDGER:${f.defect.id}`, defectDescription: 'Factual crack', defectQuantity: null, materials: [] }] });
    expect(await db.processDefect.findUniqueOrThrow({ where: { id: f.defect.id } })).toEqual(before);
  });

  it('projects customer defect text only; no customer/VIN/component/analysis and no silent engineer reconciliation', async () => {
    const f = await fixture();
    const row = await db.customerQualityComplaint.create({ data: { organizationId: f.org.id, complaintNumber: randomUUID(), complaintType: 'ZERO_KM',
      defectDescription: 'Actual complaint', ledgerRaw: { defectDescription: 'Actual complaint', componentCode: 'FINISHED-ONLY', customerName: 'PRIVATE CUSTOMER', vin: 'PRIVATE VIN' },
      ledgerNormalized: { defectDescription: 'Actual complaint', componentCode: 'FINISHED-ONLY', quantity: null }, ledgerStatus: 'CLOSED',
      createdById: f.actor.id, updatedById: f.actor.id } });
    const source: SupplierCopySource = { kind: 'CUSTOMER_LEDGER', sourceId: row.id, sourceVersion: row.version };
    expect(await project(app.get(CustomerComplaintLedgerService), f.actor, source)).toEqual({ organizationId: f.org.id, source,
      facts: [{ factKey: `CUSTOMER_LEDGER:${row.id}`, defectDescription: 'Actual complaint', defectQuantity: null, materials: [] }] });
    expect(await db.customerQualityComplaint.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
  });

  it('projects only actual saved FAE failed material facts without requiring analysis completion or a risk grade', async () => {
    const f = await fixture();
    const department = await db.department.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'Actual source department' } });
    const position = await db.position.create({ data: { organizationId: f.org.id, departmentId: department.id, code: randomUUID(), name: 'Source recorder' } });
    const assignment = await db.userPosition.create({ data: { organizationId: f.org.id, userId: f.actor.id, positionId: position.id, startedAt: new Date(Date.now() - 60000) } });
    const row = await db.customerQualityComplaint.create({ data: { organizationId: f.org.id, complaintNumber: randomUUID(), complaintType: 'ZERO_KM',
      defectDescription: 'Failed output', severity: null, ledgerStatus: 'FOLLOWING', createdById: f.actor.id, updatedById: f.actor.id } });
    const analysisId = randomUUID();
    await db.$executeRaw`INSERT INTO customer_complaint_analyses(id, organization_id, complaint_id, section, assignee_user_id, assignee_assignment_id, department_id, content, updated_by_user_id)
      VALUES (${analysisId}::uuid, ${f.org.id}::uuid, ${row.id}::uuid, 'FAE', ${f.actor.id}::uuid, ${assignment.id}::uuid, ${department.id}::uuid,
        ${JSON.stringify({ failedMaterialCode: 'KNOWN-FAILED-MATERIAL', failedPart: 'Failed capacitor', text: null, completedOn: null, fileIds: [randomUUID()], result: 'PRIVATE ANALYSIS' })}::jsonb, ${f.actor.id}::uuid)`;
    const source: SupplierCopySource = { kind: 'CUSTOMER_LEDGER', sourceId: row.id, sourceVersion: row.version };
    expect((await project(app.get(CustomerComplaintLedgerService), f.actor, source)).facts).toEqual([{ factKey: `CUSTOMER_LEDGER:${row.id}`, defectDescription: 'Failed output', defectQuantity: null,
      materials: [{ id: analysisId, materialCode: 'KNOWN-FAILED-MATERIAL', materialName: 'Failed capacitor', materialBatch: null, supplierProfileId: null, supplierOrganizationId: null }] }]);
    expect(await db.customerQualityComplaint.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
  });

  it.each(['PROCESS_LEDGER', 'CUSTOMER_LEDGER'] as const)('rejects stale, missing COPY, supplier and outside sources for %s', async kind => {
    const f = await fixture();
    const row = kind === 'PROCESS_LEDGER' ? f.defect : await db.customerQualityComplaint.create({ data: { organizationId: f.org.id, complaintNumber: randomUUID(), complaintType: 'ZERO_KM', defectDescription: 'Observed', createdById: f.actor.id, updatedById: f.actor.id } });
    const service = kind === 'PROCESS_LEDGER' ? app.get(ProcessDefectLedgerService) : app.get(CustomerComplaintLedgerService);
    const source = { kind, sourceId: row.id, sourceVersion: row.version };
    await expect(project(service, f.actor, { ...source, sourceVersion: row.version + 1 })).rejects.toMatchObject({ status: 409 });
    const other = await fixture();
    await expect(project(service, other.actor, source)).rejects.toMatchObject({ status: 404 });
    await expect(project(service, { ...f.actor, accountType: 'SUPPLIER' }, source)).rejects.toMatchObject({ status: 403 });
    const permission = await db.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:issues:copy' } });
    await db.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: permission.id } } });
    await expect(project(service, f.actor, source)).rejects.toMatchObject({ status: 403 });
    await db.rolePermission.create({ data: { roleId: f.role.id, permissionId: permission.id } });
    if (kind === 'PROCESS_LEDGER') await db.processDefect.update({ where: { id: row.id }, data: { archivedAt: new Date() } });
    else await db.customerQualityComplaint.update({ where: { id: row.id }, data: { archivedAt: new Date() } });
    await expect(project(service, f.actor, source)).rejects.toMatchObject({ status: 409 });
  });

  it('uses immutable project selection facts/version, never counts the process fact twice or rewrites current process', async () => {
    const f = await fixture();
    const projectId = randomUUID(), selectionId = randomUUID();
    await db.$executeRaw`INSERT INTO new_product_projects(id, organization_id, code, name, product_code, created_by_id)
      VALUES (${projectId}::uuid, ${f.org.id}::uuid, ${randomUUID()}, 'Actual project', 'COMPONENT', ${f.actor.id}::uuid)`;
    await db.$executeRaw`INSERT INTO new_product_defect_selections(id, organization_id, project_id, defect_id, source_version, source_snapshot, selected_by_id)
      VALUES (${selectionId}::uuid, ${f.org.id}::uuid, ${projectId}::uuid, ${f.defect.id}::uuid, ${f.defect.version},
        ${JSON.stringify({ description: 'Saved selection fact', defectQuantity: null, productCode: 'NOT-A-MATERIAL', materials: [], inclusion: { observedProjectStage: 'NEW_PRODUCT' } })}::jsonb, ${f.actor.id}::uuid)`;
    await db.processDefect.update({ where: { id: f.defect.id }, data: { description: 'Current changed', defectQuantity: 99, version: { increment: 1 } } });
    const source: SupplierCopySource = { kind: 'NEW_PRODUCT_SELECTION', sourceId: selectionId, sourceVersion: f.defect.version };
    const before = await db.$queryRaw`SELECT * FROM new_product_projects WHERE id = ${projectId}::uuid`;
    await db.$transaction(tx => app.get(NewProductEightDSourceService).prepareSupplierCopyProjection(tx, f.actor, [source]), { isolationLevel: 'ReadCommitted' });
    expect(await db.$queryRaw`SELECT * FROM new_product_projects WHERE id = ${projectId}::uuid`).toEqual(before);
    expect(await project(app.get(NewProductEightDSourceService), f.actor, source)).toEqual({ organizationId: f.org.id, source,
      facts: [{ factKey: `PROCESS_LEDGER:${f.defect.id}`, defectDescription: 'Saved selection fact', defectQuantity: null, materials: [] }] });
    await expect(project(app.get(NewProductEightDSourceService), f.actor, { ...source, sourceVersion: source.sourceVersion + 1 })).rejects.toMatchObject({ status: 409 });
    const outsider = await fixture();
    await expect(project(app.get(NewProductEightDSourceService), outsider.actor, source)).rejects.toMatchObject({ status: 404 });
    await expect(project(app.get(NewProductEightDSourceService), { ...f.actor, accountType: 'SUPPLIER' }, source)).rejects.toMatchObject({ status: 403 });
    await db.processDefect.update({ where: { id: f.defect.id }, data: { archivedAt: new Date() } });
    await expect(project(app.get(NewProductEightDSourceService), f.actor, source)).rejects.toMatchObject({ status: 409 });
  });
});
