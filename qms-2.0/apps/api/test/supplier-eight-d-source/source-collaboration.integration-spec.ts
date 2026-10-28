import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import type { SupplierCollaborationProjectionPort } from '../../src/common/eight-d/supplier-collaboration.types.js';
import { ProcessDefectLedgerService } from '../../src/modules/process-quality/process-defect-ledger.service.js';
import { CustomerComplaintLedgerService } from '../../src/modules/customer-quality/customer-complaint-ledger.service.js';
import { NewProductEightDSourceService } from '../../src/modules/new-product-quality/new-product-eight-d-source.service.js';
import type { AdminActor, AdminTransaction } from '../../src/common/security/admin-mutation.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { SupplierSourceCollaborationService } from '../../src/modules/supplier-eight-d-source/supplier-source-collaboration.service.js';
import { ProcessEightDService } from '../../src/modules/process-quality/process-eight-d.service.js';
import { domainFixture } from '../common/internal-eight-d-domains.fixture.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowClosureTemplateService } from '../../src/modules/workflow/workflow-closure-template.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SupplierSourceCollaborationReadModel } from '../../src/modules/problem-index/supplier-source-collaboration.read-model.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Disposable loopback PostgreSQL required; never preview 55440.');
}

describe('source SQE collaboration public ports', () => {
  let app: INestApplication; let db: PrismaService;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init(); db = app.get(PrismaService);
  }, 120000);
  afterAll(async () => { await app?.close(); });

  async function fixture(codes = ['process-quality:defects:read', 'process-quality:materials:review', 'customer-quality:complaints:read', 'customer-quality:analyses:supplier']) {
    const org = await db.organization.create({ data: { code: randomUUID(), name: 'Source collaboration', type: 'INTERNAL' } });
    const user = await db.user.create({ data: { organizationId: org.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'fixture-only' } });
    const session = await db.session.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), mfaVerifiedAt: new Date() } });
    const permissions = await db.permission.findMany({ where: { code: { in: codes } } });
    expect(permissions).toHaveLength(codes.length);
    const role = await db.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'SQE without COPY or ISSUE', permissions: { create: permissions.map(p => ({ permissionId: p.id })) } } });
    await db.userRole.create({ data: { organizationId: org.id, userId: user.id, roleId: role.id } });
    const department = await db.department.create({ data: { organizationId: org.id, code: randomUUID(), name: 'SQE' } });
    const position = await db.position.create({ data: { organizationId: org.id, departmentId: department.id, code: randomUUID(), name: 'SQE' } });
    const assignment = await db.userPosition.create({ data: { organizationId: org.id, userId: user.id, positionId: position.id, startedAt: new Date(Date.now() - 60000) } });
    const actor: AdminActor = { id: user.id, organizationId: org.id, sessionId: session.id, accountType: 'INTERNAL' };
    return { org, user, actor, role, department, position, assignment };
  }

  function project(service: object, actor: AdminActor, id: string) {
    const port = service as { supplierCollaborationProjection?: (tx: AdminTransaction, actor: AdminActor, id: string) => Promise<any[]> };
    expect(typeof port.supplierCollaborationProjection).toBe('function');
    return db.$transaction(tx => port.supplierCollaborationProjection!(tx, actor, id), { isolationLevel: 'ReadCommitted' });
  }

  function eligible(port: SupplierCollaborationProjectionPort, actor: AdminActor, id: string) {
    return db.$transaction(async tx => {
      const predicate = await port.supplierCollaborationPredicate(tx, actor, Prisma.sql`${id}::uuid`);
      const [row] = await tx.$queryRaw<{ eligible: boolean }[]>(Prisma.sql`SELECT ${predicate} AS eligible`);
      return row!.eligible;
    }, { isolationLevel: 'ReadCommitted' });
  }

  it('returns only assigned live material facts without COPY/issue, drops changed SQE, role and appointment without touching history', async () => {
    const f = await fixture(); const other = await fixture();
    const row = await db.processDefect.create({ data: { organizationId: f.org.id, description: 'Private internal fact', createdById: f.user.id, updatedById: f.user.id } });
    const id = randomUUID(); const secret = randomUUID();
    for (const [materialId, userId] of [[id, f.user.id], [secret, other.user.id]]) {
      await db.$executeRaw`INSERT INTO process_defect_material_items (id, organization_id, defect_id, position, material_code, sqe_user_id, verification, verified_by_id, verified_at, created_by_id, updated_by_id)
        VALUES (${materialId}::uuid, ${f.org.id}::uuid, ${row.id}::uuid, ${materialId === id ? 0 : 1}, 'PRIVATE-MATERIAL', ${userId}::uuid, 'RETURN_ANALYSIS', ${f.user.id}::uuid, CURRENT_TIMESTAMP, ${f.user.id}::uuid, ${f.user.id}::uuid)`;
    }
    const service = app.get(ProcessDefectLedgerService);
    const historyId = randomUUID();
    await db.$executeRaw`INSERT INTO process_defect_material_verifications (id, organization_id, defect_id, material_item_id, verification, actor_user_id, defect_version, material_snapshot)
      VALUES (${historyId}::uuid, ${f.org.id}::uuid, ${row.id}::uuid, ${id}::uuid, 'RETURN_ANALYSIS', ${f.user.id}::uuid, 1, '{"verification":"RETURN_ANALYSIS"}'::jsonb)`;
    const before = await db.processDefect.findUniqueOrThrow({ where: { id: row.id } });
    expect(await project(service, f.actor, row.id)).toEqual([{ sourceKind: 'PROCESS_LEDGER', sourceId: row.id,
      canonicalFactKey: `PROCESS_LEDGER:${row.id}`, materialItemId: id, verification: 'RETURN_ANALYSIS', progress: null, result: null }]);
    expect(await eligible(service, f.actor, row.id)).toBe(true);
    expect(await db.processDefect.findUniqueOrThrow({ where: { id: row.id } })).toEqual(before);
    await db.userPosition.update({ where: { id: f.assignment.id }, data: { endedAt: new Date() } });
    expect(await project(service, f.actor, row.id)).toEqual([]);
    expect(await eligible(service, f.actor, row.id)).toBe(false);
    await db.userPosition.update({ where: { id: f.assignment.id }, data: { endedAt: null } });
    await db.$executeRaw`UPDATE process_defect_material_items SET sqe_user_id = ${other.user.id}::uuid WHERE id = ${id}::uuid`;
    expect(await project(service, f.actor, row.id)).toEqual([]);
    expect(await eligible(service, f.actor, row.id)).toBe(false);
    await db.$executeRaw`UPDATE process_defect_material_items SET sqe_user_id = ${f.user.id}::uuid WHERE id = ${id}::uuid`;
    const permission = await db.permission.findUniqueOrThrow({ where: { code: 'process-quality:materials:review' } });
    await db.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: permission.id } } });
    await expect(project(service, f.actor, row.id)).rejects.toMatchObject({ status: 403 });
    expect(await eligible(service, f.actor, row.id)).toBe(false);
    const history = await db.$queryRaw<Array<{ id: string; verification: string }>>`SELECT id, verification FROM process_defect_material_verifications WHERE defect_id = ${row.id}::uuid`;
    expect(history).toEqual([{ id: historyId, verification: 'RETURN_ANALYSIS' }]);
  });

  it('reads only SUPPLIER analysis, never fills empty QE or exposes FAE/customer/VIN, and revalidates exact assignment', async () => {
    const f = await fixture();
    const row = await db.customerQualityComplaint.create({ data: { organizationId: f.org.id, complaintNumber: randomUUID(), complaintType: 'ZERO_KM',
      defectDescription: 'Private customer fact', ledgerRaw: { customerName: 'PRIVATE CUSTOMER', vin: 'PRIVATE VIN' }, ledgerStatus: 'FOLLOWING', createdById: f.user.id, updatedById: f.user.id } });
    const id = randomUUID();
    for (const section of ['SUPPLIER', 'FAE']) await db.$executeRaw`INSERT INTO customer_complaint_analyses
      (id, organization_id, complaint_id, section, assignee_user_id, assignee_assignment_id, department_id, content, updated_by_user_id)
      VALUES (${section === 'SUPPLIER' ? id : randomUUID()}::uuid, ${f.org.id}::uuid, ${row.id}::uuid, ${section}, ${f.user.id}::uuid, ${f.assignment.id}::uuid,
        ${f.department.id}::uuid, ${JSON.stringify(section === 'SUPPLIER' ? { progress: 'Ongoing', result: null } : { text: 'PRIVATE FAE', failedPart: 'SECRET' })}::jsonb, ${f.user.id}::uuid)`;
    const before = await db.customerQualityComplaint.findUniqueOrThrow({ where: { id: row.id } });
    const service = app.get(CustomerComplaintLedgerService);
    expect(await project(service, f.actor, row.id)).toEqual([{ sourceKind: 'CUSTOMER_LEDGER', sourceId: row.id,
      canonicalFactKey: `CUSTOMER_LEDGER:${row.id}`, materialItemId: id, verification: null, progress: 'Ongoing', result: null }]);
    expect(await eligible(service, f.actor, row.id)).toBe(true);
    expect(await db.customerQualityComplaint.findUniqueOrThrow({ where: { id: row.id } })).toEqual(before);
    await db.userPosition.update({ where: { id: f.assignment.id }, data: { endedAt: new Date() } });
    expect(await project(service, f.actor, row.id)).toEqual([]);
    expect(await eligible(service, f.actor, row.id)).toBe(false);
  });

  it('exposes the new-product read port independently from supplier copy', () => {
    expect(typeof (app.get(NewProductEightDSourceService) as any).supplierCollaborationProjection).toBe('function');
  });

  function collaboration() {
    return app.get(SupplierSourceCollaborationService);
  }

  async function raceFixture(domain: 'process-quality' | 'new-product-quality' = 'process-quality') {
    const f = await domainFixture(app, 'new-product-quality');
    const codes = ['process-quality:materials:review', 'process-quality:issues:issue', 'process-quality:issues:read', 'process-quality:issues:work'];
    const permissions = await db.permission.findMany({ where: { code: { in: codes } } });
    expect(permissions).toHaveLength(codes.length);
    await db.rolePermission.createMany({ data: permissions.map(p => ({ roleId: f.role.id, permissionId: p.id })), skipDuplicates: true });
    const core = app.get(ProcessEightDService);
    if (domain === 'process-quality') {
      const template = await app.get(WorkflowClosureTemplateService).initialize(f.professional.actor,
        { policy: 'INTERNAL', domainCode: domain, code: randomUUID(), name: 'Collaboration race real process 8D' }, randomUUID(), randomUUID());
      const published = await app.get(WorkflowDefinitionService).publishVersion({ organizationId: f.org.id, userId: f.professional.user.id,
        actor: f.professional.actor, definitionId: template.id, expectedRevision: template.revision, draftVersionId: template.version.id });
      await core.bind(f.professional.actor, { expectedVersion: 0, workflowDefinitionId: template.id, workflowVersionId: published.id }, randomUUID(), randomUUID());
      await core.activate(f.professional.actor, { expectedVersion: 1, enabled: true }, randomUUID(), randomUUID());
    }
    const rows = [];
    for (let i = 0; i < 2; i++) {
      const row = await f.process.create(f.manager.actor, { description: 'Two actor collaboration race', productCode: f.productCode,
        materials: [{ materialCode: 'RACE-MATERIAL', sqeUserId: f.owner.user.id }] }, randomUUID(), randomUUID());
      let sourceId = row.id;
      let problemId: string;
      if (domain === 'new-product-quality') {
        const selection = await f.quality.selectProcessDefect(f.professional.actor, f.project.id,
          { defectId: row.id, expectedVersion: row.version }, randomUUID(), randomUUID());
        sourceId = String(selection.id);
        problemId = await f.issue([{ sourceId, expectedVersion: row.version, factId: row.id }]);
      } else {
        const issued = await core.issue(f.professional.actor, { ...f.input([]), sources: [{ defectId: row.id, expectedVersion: row.version }] }, randomUUID(), randomUUID());
        problemId = String(issued.problem.id);
      }
      rows.push({ ...row, sourceId, problemId });
    }
    rows.sort((a, b) => a.problemId.localeCompare(b.problemId));
    const token = await app.get(SessionService).create(f.owner.user.id, db, { reauthenticated: true, mfaVerified: true });
    const get = () => request(app.getHttpServer()).get('/api/v1/supplier-quality/source-collaboration/tasks')
      .query({ scanLimit: 1 }).set('Cookie', `qms_session=${token}`);
    const before = (await get().expect(200)).body;
    expect(before.scannedCount).toBe(1);
    expect(before.nextCursor).toBe(rows[0]!.problemId);
    expect(before.items).toHaveLength(1);
    return { ...f, rows, get, before };
  }

  // Delegate every transaction to PG; only interleave the writer after the scan transaction has committed.
  function afterScanCommit(change: () => Promise<unknown>) {
    const transaction = db.$transaction.bind(db);
    let pending = true;
    return jest.spyOn(db, '$transaction').mockImplementation((async (work: Parameters<PrismaService['$transaction']>[0], options?: Parameters<PrismaService['$transaction']>[1]) => {
      const interleave = pending;
      pending = false;
      const result = await transaction(work, options);
      if (interleave) await change();
      return result;
    }) as typeof db.$transaction);
  }

  function atRevalidation(stage: 'scan' | 'final', change: () => Promise<unknown>, links = false) {
    if (stage === 'scan') return afterScanCommit(change);
    let scanned = false;
    let calls = 0;
    const committed = afterScanCommit(async () => { scanned = true; });
    const model = app.get(SupplierSourceCollaborationReadModel);
    const process = app.get(ProcessDefectLedgerService);
    const references = model.currentReferences.bind(model);
    const projection = process.supplierCollaborationProjection.bind(process);
    const hook = links
      ? jest.spyOn(model, 'currentReferences').mockImplementation(async (...args) => {
        if (scanned && ++calls === 2) await change();
        return references(...args);
      })
      : jest.spyOn(process, 'supplierCollaborationProjection').mockImplementation(async (...args) => {
        if (scanned && ++calls === 2) await change();
        return projection(...args);
      });
    return { mockRestore() { hook.mockRestore(); committed.mockRestore(); } };
  }

  it.each(['process-quality', 'new-product-quality'] as const)('%s rejects a committed scan after another valid actor publicly reassigns its only material', async domain => {
    const f = await raceFixture(domain);
    const row = f.rows[0]!;
    const hook = afterScanCommit(() => f.process.update(f.manager.actor, row.id, { expectedVersion: row.version,
      materials: [{ id: row.materials[0]!.id, materialCode: 'RACE-MATERIAL', sqeUserId: f.manager.user.id }] }, randomUUID(), randomUUID()));
    try {
      const response = await f.get().expect(409);
      expect(response.body.code).toBe('CONCURRENCY_CONFLICT');
      expect(JSON.stringify(response.body)).not.toContain(row.problemId);
      expect(response.body).not.toHaveProperty('scannedCount');
      expect(response.body).not.toHaveProperty('nextCursor');
    } finally { hook.mockRestore(); }
    const assigned = await project(f.process, f.manager.actor, row.id);
    expect(assigned).toHaveLength(1);
    expect(await project(f.process, f.owner.actor, row.id)).toEqual([]);
    const refreshed = (await f.get().expect(200)).body;
    expect(refreshed).toMatchObject({ scannedCount: 1, nextCursor: null });
    expect(refreshed.items).toHaveLength(1);
    expect(JSON.stringify(refreshed)).not.toContain(row.materials[0]!.id);
  }, 120000);

  it.each([['scan', 'remove'], ['final', 'remove'], ['scan', 'replace'], ['final', 'replace']] as const)('rejects current-link %s/%s revalidation rather than returning its old page', async (stage, action) => {
    const f = await raceFixture();
    const row = f.rows[0]!;
    const unlink = () => db.domainSourceIssueLink.updateMany({ where: { organizationId: f.org.id, problemIndexId: row.problemId },
      data: action === 'remove' ? { removedAt: new Date() } : { sourceId: randomUUID() } });
    const hook = atRevalidation(stage, unlink, true);
    try {
      await expect(collaboration().tasks(f.owner.actor, { scanLimit: 1 })).rejects.toMatchObject({ status: 409,
        response: { code: 'CONCURRENCY_CONFLICT' } });
    } finally { hook.mockRestore(); }
  }, 120000);

  it.each(['scan', 'final'] as const)('rejects real empty and 403 source projections at %s revalidation', async stage => {
    const f = await raceFixture();
    const row = f.rows[0]!;
    const read = await db.permission.findUniqueOrThrow({ where: { code: 'process-quality:defects:read' } });
    for (const change of ['reassign', 'permission'] as const) {
      const mutate = async () => {
        if (change === 'reassign') await f.process.update(f.manager.actor, row.id, { expectedVersion: row.version,
          materials: [{ id: row.materials[0]!.id, materialCode: 'RACE-MATERIAL', sqeUserId: f.manager.user.id }] }, randomUUID(), randomUUID());
        else await db.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: read.id } } });
      };
      const hook = atRevalidation(stage, mutate);
      try {
        await expect(collaboration().tasks(f.owner.actor, { scanLimit: 1 })).rejects.toMatchObject({ status: 409,
          response: { code: 'CONCURRENCY_CONFLICT' } });
      } finally { hook.mockRestore(); }
      if (change === 'reassign') {
        const current = await db.processDefect.findUniqueOrThrow({ where: { id: row.id } });
        const restored = await f.process.update(f.manager.actor, row.id, { expectedVersion: current.version,
          materials: [{ id: row.materials[0]!.id, materialCode: 'RACE-MATERIAL', sqeUserId: f.owner.user.id }] }, randomUUID(), randomUUID());
        row.version = restored.version;
      } else if (change === 'permission') await db.rolePermission.create({ data: { roleId: f.role.id, permissionId: read.id } });
    }
  }, 120000);

  it('projects actual issued customer 8D only, deduplicates current sources and removes closed/removed/archived cases without writing source versions', async () => {
    const f = await domainFixture(app, 'customer-quality');
    const source = await f.source();
    const permission = await db.permission.findUniqueOrThrow({ where: { code: 'customer-quality:analyses:supplier' } });
    await db.rolePermission.create({ data: { roleId: f.role.id, permissionId: permission.id } });
    const analysisId = randomUUID();
    await db.$executeRaw`INSERT INTO customer_complaint_analyses (id, organization_id, complaint_id, section, assignee_user_id, assignee_assignment_id, department_id, content, updated_by_user_id)
      VALUES (${analysisId}::uuid, ${f.org.id}::uuid, ${source.sourceId}::uuid, 'SUPPLIER', ${f.owner.user.id}::uuid, ${f.owner.assignment.id}::uuid,
        ${f.section.id}::uuid, '{"progress":"Awaiting analysis","result":null}'::jsonb, ${f.owner.user.id}::uuid)`;
    const service = collaboration();
    expect((await service.tasks(f.owner.actor)).items).toEqual([]);
    const issued = await f.service.issue(f.professional.actor, f.input([source]), randomUUID(), randomUUID());
    await db.customerQualityComplaint.update({ where: { id: source.sourceId }, data: {
      qualityEngineerId: null, qualityEngineerAssignmentId: null, qualityEngineerSource: null } });
    const before = await db.customerQualityComplaint.findUniqueOrThrow({ where: { id: source.sourceId } });
    const page = await service.tasks(f.owner.actor);
    expect(page.items).toEqual([{ id: `SOURCE_SQE:CUSTOMER_LEDGER:${source.sourceId}:${analysisId}`, kind: 'SOURCE_SQE_COLLABORATION', title: '8D协作跟进',
      sourceKind: 'CUSTOMER_LEDGER', sourceId: source.sourceId, materialItemId: analysisId, verification: null, progress: 'Awaiting analysis', result: null,
      link: `/app/customer-quality?organizationId=${f.org.id}&complaintId=${source.sourceId}` }]);
    expect(page.scannedCount).toBeGreaterThan(0);
    expect(page.nextCursor).toBeNull();
    expect(JSON.stringify(page)).not.toContain(issued.problem.reportNumber);
    const token = await app.get(SessionService).create(f.owner.user.id, db, { reauthenticated: true, mfaVerified: true });
    const http = await request(app.getHttpServer()).get('/api/v1/supplier-quality/source-collaboration/tasks').set('Cookie', `qms_session=${token}`).expect(200);
    expect(http.body).toEqual(page);
    expect(await db.customerQualityComplaint.findUniqueOrThrow({ where: { id: source.sourceId } })).toEqual(before);
    const [preview] = await f.service.previewSources(f.professional.actor, { sources: [{ sourceId: source.sourceId, expectedVersion: source.expectedVersion }] });
    const second = await f.service.issue(f.professional.actor, { ...f.input([source]), sourceConfirmations: [{ sourceId: source.sourceId,
      relatedProblemIds: preview!.relatedProblems.map(p => p.problemId), relatedSetToken: preview!.relatedSetToken, recurrence: 'NOT_RECURRENCE', reason: 'Explicit independent duplicate-source evidence' }] }, randomUUID(), randomUUID());
    expect((await service.tasks(f.owner.actor)).items).toHaveLength(1);
    const firstPage = await service.tasks(f.owner.actor, { scanLimit: 1 });
    expect(firstPage.scannedCount).toBe(1);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await service.tasks(f.owner.actor, { cursor: firstPage.nextCursor!, scanLimit: 1 });
    expect(secondPage.scannedCount).toBe(1);
    expect(secondPage.nextCursor).toBeNull();
    expect(new Set([...firstPage.items, ...secondPage.items].map(item => item.id)).size).toBe(1);
    await db.rolePermission.deleteMany({ where: { roleId: f.role.id, permission: { code: { in: ['customer-quality:issues:issue', 'customer-quality:issues:read', 'supplier-quality:issues:copy'] } } } });
    expect((await service.tasks(f.owner.actor)).items).toHaveLength(1);
    await db.$executeRaw`UPDATE customer_complaint_analyses SET content = '{"progress":"Recorded","result":"Recorded conclusion, not task completion"}'::jsonb WHERE id = ${analysisId}::uuid`;
    expect((await service.tasks(f.owner.actor)).items).toHaveLength(1);
    await db.problemIndex.update({ where: { id: String(second.problem.id) }, data: { status: 'CLOSED', closedAt: new Date() } });
    await db.domainSourceIssueLink.updateMany({ where: { problemIndexId: String(issued.problem.id) }, data: { removedAt: new Date() } });
    expect((await service.tasks(f.owner.actor)).items).toEqual([]);
    await db.domainSourceIssueLink.updateMany({ where: { problemIndexId: String(issued.problem.id) }, data: { removedAt: null } });
    await db.problemIndex.update({ where: { id: String(issued.problem.id) }, data: { status: 'CLOSED', closedAt: new Date() } });
    expect((await service.tasks(f.owner.actor)).items).toEqual([]);
    await db.problemIndex.update({ where: { id: String(issued.problem.id) }, data: { status: 'OPEN', closedAt: null, archivedAt: new Date() } });
    expect((await service.tasks(f.owner.actor)).items).toEqual([]);
  }, 120000);

  it('follows actual issued new-product and process 8D using one canonical material identity, never BRIEF/draft, and removes revoked rights', async () => {
    const f = await domainFixture(app, 'new-product-quality');
    const codes = ['process-quality:materials:review', 'process-quality:issues:issue', 'process-quality:issues:read', 'process-quality:issues:work'];
    const permissions = await db.permission.findMany({ where: { code: { in: codes } } });
    expect(permissions).toHaveLength(codes.length);
    await db.rolePermission.createMany({ data: permissions.map(p => ({ roleId: f.role.id, permissionId: p.id })), skipDuplicates: true });
    const source = await f.source(); const materialId = randomUUID();
    await db.$executeRaw`INSERT INTO process_defect_material_items (id, organization_id, defect_id, position, material_code, sqe_user_id, created_by_id, updated_by_id)
      VALUES (${materialId}::uuid, ${f.org.id}::uuid, ${source.factId}::uuid, 0, 'ONE-REAL-MATERIAL', ${f.owner.user.id}::uuid, ${f.owner.user.id}::uuid, ${f.owner.user.id}::uuid)`;
    const before = await db.processDefect.findUniqueOrThrow({ where: { id: source.factId } });
    const service = collaboration();
    const phantom = await db.problemIndex.create({ data: { organizationId: f.org.id, reportNumber: randomUUID(), domainCode: 'process-quality',
      problemType: 'EIGHT_D', sourceType: 'process-defect', sourceId: source.factId, severity: 'LOW' } });
    await db.domainSourceIssueLink.create({ data: { organizationId: f.org.id, problemIndexId: phantom.id, sourceDomain: 'process-quality', sourceType: 'process-defect',
      sourceId: source.factId, sourceVersion: source.expectedVersion, sourceSnapshot: {}, createdBy: f.professional.user.id } });
    expect((await service.tasks(f.owner.actor)).items).toEqual([]);
    await db.problemIndex.update({ where: { id: phantom.id }, data: { problemType: 'BRIEF' } });
    expect((await service.tasks(f.owner.actor)).items).toEqual([]);
    await f.issue([source]);
    const newProductTask = (await service.tasks(f.owner.actor)).items;
    expect(newProductTask).toHaveLength(1);
    expect(newProductTask[0]).toMatchObject({ id: `SOURCE_SQE:PROCESS_LEDGER:${source.factId}:${materialId}`, sourceKind: 'NEW_PRODUCT_SELECTION',
      sourceId: source.sourceId, materialItemId: materialId, verification: 'UNREVIEWED',
      link: `/app/process-quality?organizationId=${f.org.id}&defectId=${source.factId}` });
    const selectionPort = app.get(NewProductEightDSourceService);
    const selectedFacts = await project(selectionPort, f.owner.actor, source.sourceId);
    expect(selectedFacts).toEqual([{ sourceKind: 'NEW_PRODUCT_SELECTION', sourceId: source.sourceId,
      canonicalFactKey: `PROCESS_LEDGER:${source.factId}`, materialItemId: materialId, verification: 'UNREVIEWED', progress: null, result: null,
      reviewSource: { kind: 'PROCESS_LEDGER', id: source.factId } }]);
    expect(await project(selectionPort, f.owner.actor, source.sourceId)).toEqual(selectedFacts);
    expect(await eligible(selectionPort, f.owner.actor, source.sourceId)).toBe(true);
    expect(await service.tasks(f.manager.actor, { scanLimit: 1 })).toEqual({ items: [], scannedCount: 0, nextCursor: null });
    const token = await app.get(SessionService).create(f.owner.user.id, db, { reauthenticated: true, mfaVerified: true });
    const http = await request(app.getHttpServer()).get('/api/v1/supplier-quality/source-collaboration/tasks')
      .set('Cookie', `qms_session=${token}`).expect(200);
    expect(http.body.items).toEqual(newProductTask);

    const template = await app.get(WorkflowClosureTemplateService).initialize(f.professional.actor,
      { policy: 'INTERNAL', domainCode: 'process-quality', code: randomUUID(), name: 'Source collaboration actual process 8D' }, randomUUID(), randomUUID());
    const published = await app.get(WorkflowDefinitionService).publishVersion({ organizationId: f.org.id, userId: f.professional.user.id,
      actor: f.professional.actor, definitionId: template.id, expectedRevision: template.revision, draftVersionId: template.version.id });
    const core = app.get(ProcessEightDService);
    await core.bind(f.professional.actor, { expectedVersion: 0, workflowDefinitionId: template.id, workflowVersionId: published.id }, randomUUID(), randomUUID());
    await core.activate(f.professional.actor, { expectedVersion: 1, enabled: true }, randomUUID(), randomUUID());
    const [preview] = await core.previewSources(f.professional.actor, { sources: [{ defectId: source.factId, expectedVersion: source.expectedVersion }] });
    const issued = await core.issue(f.professional.actor, { ...f.input([]), sources: [{ defectId: source.factId, expectedVersion: source.expectedVersion }],
      sourceConfirmations: [{ defectId: source.factId, relatedProblemIds: preview!.relatedProblems.map(p => p.problemId), relatedSetToken: preview!.relatedSetToken,
        recurrence: 'NOT_RECURRENCE', reason: 'Actual process copy of an independent formal issue' }] }, randomUUID(), randomUUID());
    expect((await service.tasks(f.owner.actor)).items).toHaveLength(1);
    expect(await db.processDefect.findUniqueOrThrow({ where: { id: source.factId } })).toEqual(before);
    for (const verification of ['CONFIRMED_DEFECT', 'NOT_MATERIAL', 'NEGOTIATED', 'RETURN_ANALYSIS']) {
      await db.$executeRaw`UPDATE process_defect_material_items SET verification = ${verification}, verified_by_id = ${f.owner.user.id}::uuid, verified_at = CURRENT_TIMESTAMP WHERE id = ${materialId}::uuid`;
      const tasks = (await service.tasks(f.owner.actor)).items;
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.verification).toBe(verification);
    }
    await db.problemIndex.update({ where: { id: String(issued.problem.id) }, data: { status: 'CLOSED', closedAt: new Date() } });
    expect((await service.tasks(f.owner.actor)).items).toHaveLength(1);
    await db.$executeRaw`UPDATE process_defect_material_items SET removed_at = CURRENT_TIMESTAMP WHERE id = ${materialId}::uuid`;
    expect((await service.tasks(f.owner.actor)).items).toEqual([]);
    await db.$executeRaw`UPDATE process_defect_material_items SET removed_at = NULL WHERE id = ${materialId}::uuid`;
    const permission = permissions.find(p => p.code === 'process-quality:materials:review')!;
    await db.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: permission.id } } });
    expect(await service.tasks(f.owner.actor, { scanLimit: 1 })).toEqual({ items: [], scannedCount: 0, nextCursor: null });
    expect(await eligible(selectionPort, f.owner.actor, source.sourceId)).toBe(false);
  }, 120000);

  it('validates UUID cursor and bound, rejects supplier/cross-organization and never manufactures a total', async () => {
    const f = await fixture(); const other = await fixture(); const service = collaboration();
    for (const query of [{ cursor: 'not-a-uuid' }, { scanLimit: 0 }, { scanLimit: 101 }, { scanLimit: 1.5 }]) {
      await expect(service.tasks(f.actor, query)).rejects.toMatchObject({ status: 400 });
    }
    await expect(service.tasks(f.actor, { organizationId: other.org.id })).rejects.toMatchObject({ status: 403 });
    await expect(service.tasks({ ...f.actor, accountType: 'SUPPLIER' })).rejects.toMatchObject({ status: 403 });
    expect(await service.tasks(f.actor, { scanLimit: 1 })).toEqual({ items: [], scannedCount: 0, nextCursor: null });
  });

  it('serves authenticated read-only GET, rejects malformed pagination and outside scope without a write action', async () => {
    const f = await fixture();
    const token = await app.get(SessionService).create(f.user.id, db, { reauthenticated: true, mfaVerified: true });
    const endpoint = '/api/v1/supplier-quality/source-collaboration/tasks';
    const get = (query: object = {}) => request(app.getHttpServer()).get(endpoint).set('Cookie', `qms_session=${token}`).query(query);
    await request(app.getHttpServer()).get(endpoint).expect(401);
    const before = await db.user.findUniqueOrThrow({ where: { id: f.user.id } });
    expect((await get().expect(200)).body).toEqual({ items: [], scannedCount: 0, nextCursor: null });
    await get({ scanLimit: '0' }).expect(400);
    await get({ cursor: 'not-uuid' }).expect(400);
    await get({ organizationId: (await fixture()).org.id }).expect(403);
    expect(await db.user.findUniqueOrThrow({ where: { id: f.user.id } })).toEqual(before);
  });

  it('scopes count and UUID cursor before pagination: no source READ or no assignment sees zero, while the actual SQE pages normally', async () => {
    const f = await domainFixture(app, 'customer-quality');
    const permission = await db.permission.findUniqueOrThrow({ where: { code: 'customer-quality:analyses:supplier' } });
    await db.rolePermission.create({ data: { roleId: f.role.id, permissionId: permission.id } });
    for (const person of [f.owner, f.owner, f.ungranted]) {
      const source = await f.source();
      await db.$executeRaw`INSERT INTO customer_complaint_analyses (id, organization_id, complaint_id, section, assignee_user_id, assignee_assignment_id, department_id, content, updated_by_user_id)
        VALUES (${randomUUID()}::uuid, ${f.org.id}::uuid, ${source.sourceId}::uuid, 'SUPPLIER', ${person.user.id}::uuid, ${person.assignment.id}::uuid,
          ${f.section.id}::uuid, '{}'::jsonb, ${f.professional.user.id}::uuid)`;
      await f.issue([source]);
    }
    const service = collaboration();
    const empty = { items: [], scannedCount: 0, nextCursor: null };
    for (const actor of [f.ungranted.actor, f.manager.actor]) {
      expect(await service.tasks(actor, { scanLimit: 1 })).toEqual(empty);
      const token = await app.get(SessionService).create(actor.id, db, { reauthenticated: true, mfaVerified: true });
      const response = await request(app.getHttpServer()).get('/api/v1/supplier-quality/source-collaboration/tasks')
        .query({ scanLimit: 1 }).set('Cookie', `qms_session=${token}`).expect(200);
      expect(response.body).toEqual(empty);
    }
    const first = await service.tasks(f.owner.actor, { scanLimit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.scannedCount).toBe(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await service.tasks(f.owner.actor, { cursor: first.nextCursor!, scanLimit: 1 });
    expect(second.items).toHaveLength(1);
    expect(second.scannedCount).toBe(1);
    expect(second.nextCursor).toBeNull();
    const token = await app.get(SessionService).create(f.owner.user.id, db, { reauthenticated: true, mfaVerified: true });
    const get = (query: object = {}) => request(app.getHttpServer()).get('/api/v1/supplier-quality/source-collaboration/tasks')
      .set('Cookie', `qms_session=${token}`).query({ scanLimit: 1, ...query });
    expect((await get().expect(200)).body).toEqual(first);
    expect((await get({ cursor: first.nextCursor }).expect(200)).body).toEqual(second);
    const readPermission = await db.permission.findUniqueOrThrow({ where: { code: 'customer-quality:complaints:read' } });
    await db.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: readPermission.id } } });
    expect(await service.tasks(f.owner.actor, { scanLimit: 1 })).toEqual(empty);
    expect((await get().expect(200)).body).toEqual(empty);
    await db.rolePermission.create({ data: { roleId: f.role.id, permissionId: readPermission.id } });
    const before = await db.customerQualityComplaint.findMany({ where: { organizationId: f.org.id } });
    await db.userPosition.update({ where: { id: f.owner.assignment.id }, data: { endedAt: new Date() } });
    expect(await service.tasks(f.owner.actor, { scanLimit: 1 })).toEqual(empty);
    expect(await db.customerQualityComplaint.findMany({ where: { organizationId: f.org.id } })).toEqual(before);
  }, 120000);
});
