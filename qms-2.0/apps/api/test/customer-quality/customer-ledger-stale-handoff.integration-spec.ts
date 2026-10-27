import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import type { AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { configureHttpBodyParser } from '../../src/http-body-parser.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { ComponentProjectService } from '../../src/modules/platform-configuration/component-project.service.js';
import { CustomerComplaintLedgerService } from '../../src/modules/customer-quality/customer-complaint-ledger.service.js';
import { CustomerComplaintAnalysisService } from '../../src/modules/customer-quality/customer-complaint-analysis.service.js';
import { CustomerQualityService } from '../../src/modules/customer-quality/customer-quality.service.js';
import { CustomerComplaintProcessingService } from '../../src/modules/customer-quality/customer-complaint-processing.service.js';
import { CustomerLedgerListDto } from '../../src/modules/customer-quality/customer-complaint-ledger.dto.js';
import { LEDGER_PERMISSIONS as P } from '../../src/modules/customer-quality/customer-complaint-ledger.types.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') throw new Error('Exclusively leased disposable PostgreSQL is required');

type Person = AdminActor & { roleId: string; positionId: string; assignmentId: string; cookie: string };
const reassignPermission = 'customer-quality:complaints:reassign';
const base = [P.read, P.write];
const qe = [...base, P.close, P.closedEdit];
const action = 'CUSTOMER_LEDGER_REASSIGNED';

describe('PR75 explicitly authorized stale-engineer handoff on real PostgreSQL', () => {
  let app: NestExpressApplication, prisma: PrismaService, ledger: CustomerComplaintLedgerService;
  let organizations: OrganizationService, components: ComponentProjectService, audit: AuditLogService;
  let registrar: Person, operator: Person, closedOperator: Person, configurer: Person, cqe: Person, newQe: Person;
  let recovery: Awaited<ReturnType<typeof fixture>>, closedSource: typeof recovery, rollbackSource: typeof recovery;
  let replaySource: typeof recovery, replayTargetSource: typeof recovery, archivedId: string;
  const organizationId = randomUUID(), csrf = randomUUID(), path = '/api/v1/customer-quality/ledger';

  async function person(permissions: string[], scope: string = organizationId, roleName = 'No authority inferred from this name') {
    const user = await prisma.user.create({ data: { organizationId: scope, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    const role = await prisma.role.create({ data: { organizationId: scope, code: randomUUID(), name: roleName } });
    for (const code of permissions) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId: user.id, organizationId: scope, roleId: role.id } });
    const department = await prisma.department.create({ data: { organizationId: scope, code: randomUUID(), name: 'Quality' } });
    const position = await prisma.position.create({ data: { organizationId: scope, departmentId: department.id, code: randomUUID(), name: 'Not an authorization rule' } });
    const assignment = await prisma.userPosition.create({ data: { organizationId: scope, userId: user.id, positionId: position.id, startedAt: new Date('2026-01-01') } });
    const token = await app.get(SessionService).create(user.id, prisma, { reauthenticated: true, mfaVerified: true });
    const session = await app.get(SessionService).resolve(token);
    return { id: user.id, organizationId: scope, accountType: 'INTERNAL' as const, sessionId: session!.id,
      roleId: role.id, positionId: position.id, assignmentId: assignment.id, cookie: `qms_session=${token}; qms_csrf=${csrf}` };
  }

  const post = (who: Person, id: string, body: object, key: string = randomUUID()) => request(app.getHttpServer()).post(`${path}/${id}/reassign`)
    .set('Cookie', who.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  const input = (version: number, target = cqe.assignmentId, reason = 'Explicit stale appointment handoff') => ({ expectedVersion: version, qualityEngineerAssignmentId: target, reason });
  const end = (who: Person) => organizations.replaceUserPositions(configurer, who.organizationId, who.id,
    { expectedPositionIds: [who.positionId], positionIds: [] }, randomUUID(), randomUUID());
  const update = (who: Person, id: string, expectedVersion: number) => ledger.update(who, id,
    { expectedVersion, fields: { investigation: 'Only the currently appointed corresponding engineer may author this' } }, randomUUID(), randomUUID());

  async function fixture(options: { stale?: boolean; closed?: boolean; facts?: boolean } = {}) {
    const owner = await person([...qe, P.project, 'customer-quality:analyses:fae', 'customer-quality:analyses:supplier']);
    const code = randomUUID();
    const project = await components.createProject(configurer, organizationId,
      { code, name: 'Accepted NEW responsibility', stage: 'NEW_PRODUCT', projectEngineerAssignmentId: owner.assignmentId }, randomUUID(), randomUUID());
    await components.createMapping(configurer, organizationId, { componentCode: code, projectRecordId: project.id, productCategory: 'controller' }, randomUUID(), randomUUID());
    let row = await ledger.create(owner, { fields: { componentCode: code, complaintType: 'AFTER_SALES', quantity: 2,
      investigation: 'Original professional conclusion', defectDescription: 'Original defect', mileage: 'invalid original cell' } }, randomUUID(), randomUUID());
    if (options.facts) {
      await prisma.customerQualityComplaint.update({ where: { id: row.id }, data: {
        eightDContent: { professionalReviewer: owner.id, evidence: 'Historical report remains untouched' }, eightDVersion: 3,
      } });
      const analyses = app.get(CustomerComplaintAnalysisService);
      for (const section of ['FAE', 'SUPPLIER'] as const) {
        const assigned = await analyses.assign(owner, row.id, section, { expectedVersion: 0, assigneeUserId: owner.id, assigneeAssignmentId: owner.assignmentId }, randomUUID(), randomUUID());
        await analyses.save(owner, assigned.id, { expectedVersion: assigned.version, ...(section === 'FAE' ? { text: 'Original FAE' } : { result: 'Original SQE' }) }, randomUUID(), randomUUID());
      }
      await request(app.getHttpServer()).post('/api/v1/files/uploads').set('Cookie', owner.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID())
        .send({ resourceType: 'CustomerComplaint', resourceId: row.id, originalName: 'retained.txt', contentType: 'text/plain', sizeBytes: 5, sha256: 'c'.repeat(64) }).expect(201);
    }
    if (options.closed) row = await ledger.close(owner, row.id, { expectedVersion: row.version, note: 'Original closure' }, randomUUID(), randomUUID());
    await components.updateProject(configurer, organizationId, project.id,
      { expectedVersion: project.version, stage: 'MASS_PRODUCTION', customerEngineerAssignmentId: cqe.assignmentId }, randomUUID(), randomUUID());
    if (options.stale !== false) await end(owner);
    return { owner, row, project, code };
  }

  async function snapshot(id: string) {
    return {
      row: await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id } }),
      events: await prisma.customerQualityComplaintEvent.findMany({ where: { complaintId: id }, orderBy: { seq: 'asc' } }),
      audits: await prisma.auditEvent.findMany({ where: { resourceId: id, outcome: 'SUCCESS' }, orderBy: { id: 'asc' } }),
      analyses: await prisma.$queryRaw`SELECT * FROM customer_complaint_analyses WHERE complaint_id = ${id}::uuid ORDER BY id`,
      analysisHistory: await prisma.$queryRaw`SELECT h.* FROM customer_complaint_analysis_history h JOIN customer_complaint_analyses a ON a.id = h.analysis_id WHERE a.complaint_id = ${id}::uuid ORDER BY h.id`,
      files: await prisma.fileObject.findMany({ where: { resourceId: id }, orderBy: { id: 'asc' } }),
      links: await prisma.domainSourceIssueLink.findMany({ where: { organizationId }, orderBy: { id: 'asc' } }),
      workflows: await prisma.workflowInstance.findMany({ where: { organizationId }, orderBy: { id: 'asc' } }),
      outbox: await prisma.outboxEvent.count({ where: { payload: { path: ['organizationId'], equals: organizationId } } }),
      receipts: await prisma.adminMutation.count({ where: { organizationId } }),
    };
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureHttpBodyParser(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService); ledger = app.get(CustomerComplaintLedgerService);
    organizations = app.get(OrganizationService); components = app.get(ComponentProjectService); audit = app.get(AuditLogService);
    await prisma.organization.create({ data: { id: organizationId, code: randomUUID(), name: 'PR75 stale handoff', type: 'INTERNAL' } });
    registrar = await person(base, organizationId, 'ADMIN');
    operator = await person([...base, reassignPermission]);
    closedOperator = await person([...base, reassignPermission, P.closedEdit]);
    configurer = await person(['organization:positions:assign', 'component-project:manage']);
    cqe = await person(qe); newQe = await person([...qe, P.project]);
  });
  beforeAll(async () => { recovery = await fixture({ facts: true }); });
  beforeAll(async () => { closedSource = await fixture({ closed: true, facts: true }); });
  beforeAll(async () => { rollbackSource = await fixture({ facts: true }); });
  beforeAll(async () => { replaySource = await fixture(); });
  beforeAll(async () => { replayTargetSource = await fixture(); });
  beforeAll(async () => {
    const legacy = app.get(CustomerQualityService), processing = app.get(CustomerComplaintProcessingService);
    const customer = await legacy.createCustomer(registrar, { code: randomUUID(), name: 'Archive fixture' }, randomUUID(), randomUUID());
    const old = await legacy.createComplaint(registrar, { customerId: customer.id, complaintType: 'ZERO_KM', defectDescription: 'Archived source', severity: 'LOW', severityPolicyVersion: 'fixture', severitySnapshot: {} }, randomUUID(), randomUUID());
    const department = await prisma.position.findUniqueOrThrow({ where: { id: newQe.positionId } });
    const triaged = await processing.triage(newQe, old.id, { expectedVersion: old.version, category: 'PRODUCT_QUALITY', responsibleDepartmentId: department.departmentId, ownerUserId: newQe.id, note: 'Triage' }, randomUUID(), randomUUID());
    const resolved = await processing.resolve(newQe, old.id, { expectedVersion: triaged.version, resolutionSummary: 'Resolved' }, randomUUID(), randomUUID());
    const closed = await processing.close(registrar, old.id, { expectedVersion: resolved.version, note: 'Independent close' }, randomUUID(), randomUUID());
    await legacy.archiveComplaint(registrar, old.id, closed.version, randomUUID(), randomUUID());
    // Retain a stale formal projection; the real archive timestamp, not the display status, governs writes.
    await prisma.customerQualityComplaint.update({ where: { id: old.id }, data: { ledgerStatus: 'FOLLOWING', qualityEngineerId: recovery.owner.id, qualityEngineerAssignmentId: recovery.owner.assignmentId, qualityEngineerSource: 'MANUAL' } });
    archivedId = old.id;
  });
  afterAll(async () => { jest.restoreAllMocks(); await app?.close(); });

  it('recovers a genuinely ended saved engineer only via the explicit capability, without altering professional facts', async () => {
    const { owner, row } = recovery;
    const before = await snapshot(row.id);
    expect(before.row.qualityEngineerId).toBe(owner.id);
    expect((await prisma.userPosition.findUniqueOrThrow({ where: { id: owner.assignmentId } })).endedAt).not.toBeNull();
    expect(await ledger.detail(registrar, row.id)).toMatchObject({ version: row.version, qualityEngineerId: owner.id });
    for (const who of [owner, registrar]) await expect(update(who, row.id, row.version)).rejects.toMatchObject({ status: 403 });
    const handed = await post(operator, row.id, input(row.version)).expect(201);
    await post(registrar, row.id, input(row.version)).expect(403);
    expect(handed.body).toMatchObject({ qualityEngineerId: cqe.id, qualityEngineerAssignmentId: cqe.assignmentId, qualityEngineerSource: 'MANUAL', version: row.version + 1 });
    const after = await snapshot(row.id);
    expect(after.row).toEqual({ ...before.row, qualityEngineerId: cqe.id, qualityEngineerAssignmentId: cqe.assignmentId,
      qualityEngineerSource: 'MANUAL', registeredStage: 'MASS_PRODUCTION', version: row.version + 1, updatedById: operator.id, updatedAt: expect.any(Date) });
    expect({ ...after, row: before.row, events: before.events, audits: before.audits, receipts: before.receipts }).toEqual(before);
    expect(after.events.slice(0, -1)).toEqual(before.events);
    expect(after.events.at(-1)).toMatchObject({ eventType: 'REASSIGNED', actorUserId: operator.id, fromStatus: 'FOLLOWING', toStatus: 'FOLLOWING' });
    expect(JSON.parse(after.events.at(-1)!.note)).toMatchObject({ operation: 'STALE_ENGINEER_HANDOFF', reason: input(row.version).reason,
      previousAssignmentBasis: { userId: owner.id, assignmentId: owner.assignmentId, source: 'MAPPING', stage: 'NEW_PRODUCT' },
      assignmentBasis: { userId: cqe.id, assignmentId: cqe.assignmentId, source: 'MANUAL', stage: 'MASS_PRODUCTION' } });
    expect(after.audits).toEqual(expect.arrayContaining([expect.objectContaining({ action, actorUserId: operator.id, metadata: expect.objectContaining({ resourceVersion: handed.body.version }) })]));
    for (const who of [owner, operator]) await expect(update(who, row.id, handed.body.version)).rejects.toMatchObject({ status: 403 });
    const edited = await update(cqe, row.id, handed.body.version);
    expect((await ledger.close(cqe, row.id, { expectedVersion: edited.version, note: 'Qualified CQE completes' }, randomUUID(), randomUUID())).status).toBe('CLOSED');
  });

  it('rejects valid responsibility and unassigned records, and requires every explicit capability rather than an ADMIN name', async () => {
    const { row } = await fixture({ stale: false });
    const before = await snapshot(row.id);
    await post(operator, row.id, input(row.version)).expect(409);
    const empty = await ledger.create(registrar, { fields: {} }, randomUUID(), randomUUID());
    await post(operator, empty.id, input(empty.version)).expect(409);
    for (const permissions of [base, [reassignPermission, P.read], [reassignPermission, P.write]]) {
      await post(await person(permissions, organizationId, 'Manager ADMIN'), row.id, input(row.version)).expect(403);
    }
    expect((await snapshot(row.id)).row).toEqual(before.row);
    expect((await snapshot(row.id)).events).toEqual(before.events);
  });

  it('rejects wrong-organization, ended, future, disabled and featureless targets without success receipts', async () => {
    const { row } = await fixture();
    const outside = await prisma.organization.create({ data: { code: randomUUID(), name: 'Outside', type: 'INTERNAL' } });
    const foreign = await person([...qe, reassignPermission], outside.id), expired = await person(qe), future = await person(qe), disabled = await person(qe), featureless = await person([P.read]);
    await end(expired);
    await prisma.userPosition.update({ where: { id: future.assignmentId }, data: { startedAt: new Date(Date.now() + 86400000) } });
    await prisma.user.update({ where: { id: disabled.id }, data: { status: 'DISABLED' } });
    const before = await snapshot(row.id);
    for (const target of [foreign.assignmentId, expired.assignmentId, future.assignmentId, disabled.assignmentId, featureless.assignmentId, randomUUID()]) {
      await post(operator, row.id, input(row.version, target)).expect(409);
    }
    expect(await snapshot(row.id)).toEqual(before);
    await post(operator, row.id, { ...input(row.version), organizationId: outside.id }).expect(403);
    await post(foreign, row.id, input(row.version, foreign.assignmentId)).expect(404);
    const supplier = await prisma.user.create({ data: { organizationId: outside.id, username: randomUUID(), accountType: 'SUPPLIER', passwordHash: 'test-only' } });
    await expect(ledger.reassign({ id: supplier.id, organizationId: outside.id, accountType: 'SUPPLIER' }, row.id,
      input(row.version, foreign.assignmentId), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    expect(await snapshot(row.id)).toEqual(before);
  });

  it('excludes an active write-only engineer from manual picks, candidates, mapping recovery and reassignment', async () => {
    const { owner, row, project, code } = await fixture({ stale: false });
    const readless = await person([P.write, P.project]);
    await expect(ledger.create(registrar, { fields: { componentCode: code }, qualityEngineerAssignmentId: readless.assignmentId },
      randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409, response: { code: 'CUSTOMER_LEDGER_ENGINEER_UNAVAILABLE' } });
    await expect(ledger.update(owner, row.id, { expectedVersion: row.version, fields: {}, qualityEngineerAssignmentId: readless.assignmentId },
      randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409, response: { code: 'CUSTOMER_LEDGER_ENGINEER_UNAVAILABLE' } });
    for (const stage of ['NEW_PRODUCT', 'MASS_PRODUCTION'] as const) {
      const candidates = await ledger.candidates(operator, Object.assign(new CustomerLedgerListDto(), { stage }));
      expect(candidates.items.map(p => p.assignmentId)).not.toContain(readless.assignmentId);
    }
    const missingCode = randomUUID();
    const empty = await ledger.create(registrar, { fields: { componentCode: missingCode } }, randomUUID(), randomUUID());
    await components.updateProject(configurer, organizationId, project.id,
      { expectedVersion: project.version + 1, customerEngineerAssignmentId: readless.assignmentId }, randomUUID(), randomUUID());
    await components.createMapping(configurer, organizationId, { componentCode: missingCode, projectRecordId: project.id, productCategory: 'controller' }, randomUUID(), randomUUID());
    const before = await snapshot(empty.id);
    expect(await ledger.detail(registrar, empty.id)).toMatchObject({ version: empty.version, qualityEngineerId: null, qualityEngineerAssignmentId: null });
    expect(await snapshot(empty.id)).toEqual(before);
    expect(await ledger.create(registrar, { fields: { componentCode: missingCode } }, randomUUID(), randomUUID()))
      .toMatchObject({ qualityEngineerId: null, qualityEngineerAssignmentId: null });
    await end(owner);
    const stale = await snapshot(row.id);
    await post(operator, row.id, input(row.version, readless.assignmentId)).expect(409);
    expect(await snapshot(row.id)).toEqual(stale);
  });

  it('allows explicit reassignment when a saved active engineer loses read but retains write', async () => {
    const { owner, row } = await fixture({ stale: false });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: P.read } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: owner.roleId, permissionId: permission.id } } });
    expect((await prisma.userPosition.findUniqueOrThrow({ where: { id: owner.assignmentId } })).endedAt).toBeNull();
    await expect(update(owner, row.id, row.version)).rejects.toMatchObject({ status: 403 });
    const before = await snapshot(row.id);
    const handed = await post(operator, row.id, input(row.version)).expect(201);
    expect(handed.body).toMatchObject({ qualityEngineerId: cqe.id, qualityEngineerAssignmentId: cqe.assignmentId, version: row.version + 1 });
    const after = await snapshot(row.id);
    expect(after.row).toEqual({ ...before.row, qualityEngineerId: cqe.id, qualityEngineerAssignmentId: cqe.assignmentId,
      qualityEngineerSource: 'MANUAL', registeredStage: 'MASS_PRODUCTION', version: row.version + 1, updatedById: operator.id, updatedAt: expect.any(Date) });
    expect(after.events.slice(0, -1)).toEqual(before.events);
    expect(after.events.at(-1)).toMatchObject({ eventType: 'REASSIGNED', actorUserId: operator.id });
    await expect(update(cqe, row.id, handed.body.version)).resolves.toMatchObject({ version: handed.body.version + 1 });
  });

  it('uses the actual mapped stage, requiring project write for NEW but accepting a MASS CQE without it', async () => {
    const { row, project } = await fixture();
    const mass = await ledger.detail(registrar, row.id);
    expect(mass.mapping?.project?.stage).toBe('MASS_PRODUCTION');
    const massCandidates = await ledger.candidates(operator, Object.assign(new CustomerLedgerListDto(), { stage: 'MASS_PRODUCTION' }));
    const newCandidates = await ledger.candidates(operator, Object.assign(new CustomerLedgerListDto(), { stage: 'NEW_PRODUCT' }));
    expect(massCandidates.items.map(p => p.assignmentId)).toContain(cqe.assignmentId);
    expect(newCandidates.items.map(p => p.assignmentId)).not.toContain(cqe.assignmentId);
    await components.updateProject(configurer, organizationId, project.id, { expectedVersion: project.version + 1, stage: 'NEW_PRODUCT' }, randomUUID(), randomUUID());
    await post(operator, row.id, input(row.version)).expect(409);
    const handed = await post(operator, row.id, input(row.version, newQe.assignmentId)).expect(201);
    expect(handed.body).toMatchObject({ qualityEngineerId: newQe.id, stage: 'NEW_PRODUCT' });
    expect((await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: row.id } })).registeredStage).toBe('NEW_PRODUCT');
  });

  it('rejects genuine archived_at and requires closed-edit while preserving closure and all professional facts', async () => {
    const { row } = closedSource;
    const before = await snapshot(row.id);
    await post(operator, row.id, input(row.version)).expect(403);
    const result = await post(closedOperator, row.id, input(row.version)).expect(201);
    expect(result.body).toMatchObject({ status: 'CLOSED', closedAt: before.row.closedAt!.toISOString(), closureNote: 'Original closure' });
    const after = await snapshot(row.id);
    expect(after.row).toEqual({ ...before.row, qualityEngineerId: cqe.id, qualityEngineerAssignmentId: cqe.assignmentId,
      qualityEngineerSource: 'MANUAL', registeredStage: 'MASS_PRODUCTION', version: row.version + 1, updatedById: closedOperator.id, updatedAt: expect.any(Date) });
    const archived = await snapshot(archivedId);
    await post(closedOperator, archivedId, input(archived.row.version)).expect(409);
    expect(await snapshot(archivedId)).toEqual(archived);
  });

  it('rejects clearing a closed engineer without side effects and keeps the same engineer able to edit and reopen', async () => {
    const { owner, row } = await fixture({ stale: false, closed: true });
    const before = await snapshot(row.id);
    await expect(ledger.update(owner, row.id, { expectedVersion: row.version, fields: {}, qualityEngineerAssignmentId: null },
      randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409, response: { code: 'CUSTOMER_LEDGER_CLOSED_ENGINEER_REQUIRED' } });
    expect(await snapshot(row.id)).toEqual(before);
    const edited = await update(owner, row.id, row.version);
    expect(edited).toMatchObject({ status: 'CLOSED', qualityEngineerId: owner.id, qualityEngineerAssignmentId: owner.assignmentId, version: row.version + 1 });
    const reopened = await ledger.reopen(owner, row.id, { expectedVersion: edited.version, note: 'Same engineer can still restore following' }, randomUUID(), randomUUID());
    expect(reopened).toMatchObject({ status: 'FOLLOWING', qualityEngineerId: owner.id, qualityEngineerAssignmentId: owner.assignmentId, version: edited.version + 1 });
  });

  it('uses exact CAS and idempotency, replays once without another event, and rejects conflicting bodies or competing writes', async () => {
    const { row } = await fixture();
    const before = await snapshot(row.id), key = randomUUID(), body = input(row.version);
    await post(operator, row.id, input(row.version + 1)).expect(409);
    const results = await Promise.all([post(operator, row.id, body, key), post(operator, row.id, body, randomUUID())]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    const receipt = results.find(r => r.status === 201)!;
    // Use the successful request's key, whichever contender acquired the row lock first.
    const replayKey = results[0]!.status === 201 ? key : (await prisma.adminMutation.findFirstOrThrow({ where: { organizationId, actorUserId: operator.id, action, response: { path: ['value', 'id'], equals: row.id } } })).key;
    const after = await snapshot(row.id);
    expect((await post(operator, row.id, body, replayKey).expect(201)).body).toEqual(receipt.body);
    await post(operator, row.id, { ...body, reason: 'A different mutation' }, replayKey).expect(409);
    expect(await snapshot(row.id)).toEqual(after);
    expect(after.events.length).toBe(before.events.length + 1);
    expect(after.receipts).toBe(before.receipts + 1);
  });

  it('revalidates permissions, closed-edit and current target eligibility before exposing a successful replay', async () => {
    const { row } = replaySource, key = randomUUID(), body = input(row.version);
    const result = await post(operator, row.id, body, key).expect(201);
    const grant = await prisma.permission.findUniqueOrThrow({ where: { code: reassignPermission } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: operator.roleId, permissionId: grant.id } } });
    await post(operator, row.id, body, key).expect(403);
    await prisma.rolePermission.create({ data: { roleId: operator.roleId, permissionId: grant.id } });
    const closed = await ledger.close(cqe, row.id, { expectedVersion: result.body.version, note: 'Closure after handoff' }, randomUUID(), randomUUID());
    await post(operator, row.id, body, key).expect(403);
    await ledger.reopen(cqe, row.id, { expectedVersion: closed.version, note: 'Restore following' }, randomUUID(), randomUUID());
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: P.write } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: cqe.roleId, permissionId: permission.id } } });
    const before = await snapshot(row.id);
    await post(operator, row.id, body, key).expect(409);
    expect(await snapshot(row.id)).toEqual(before);
    await prisma.rolePermission.create({ data: { roleId: cqe.roleId, permissionId: permission.id } });
    const { row: another } = replayTargetSource, anotherKey = randomUUID();
    const anotherBody = input(another.version, newQe.assignmentId);
    await post(operator, another.id, anotherBody, anotherKey).expect(201);
    await end(newQe);
    await post(operator, another.id, anotherBody, anotherKey).expect(409);
  });

  it('rejects unknown source fields and malformed envelopes, and enforces real HTTP authentication, CSRF and keys', async () => {
    const { row } = await fixture();
    const body = input(row.version);
    for (const extra of [{ fields: { quantity: 999 } }, { investigation: 'smuggled' }, { customerId: randomUUID() }, { source: 'MAPPING' }, { expectedVersion: 0 },
      { qualityEngineerAssignmentId: null }, { qualityEngineerAssignmentId: '' }, { qualityEngineerAssignmentId: 'not-uuid' },
      { reason: '' }, { reason: ' \t\n' }, { reason: null }, { reason: 'x'.repeat(10001) }, { reason: 'a\u0000b' }]) {
      await post(operator, row.id, { ...body, ...extra }).expect(400);
    }
    await post(operator, row.id, { expectedVersion: row.version, reason: 'Missing target' }).expect(400);
    await post(operator, row.id, { qualityEngineerAssignmentId: cqe.assignmentId, reason: 'Missing CAS' }).expect(400);
    await request(app.getHttpServer()).post(`${path}/${row.id}/reassign`).set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send(body).expect(401);
    await request(app.getHttpServer()).post(`${path}/${row.id}/reassign`).set('Cookie', operator.cookie).set('Idempotency-Key', randomUUID()).send(body).expect(403);
    await request(app.getHttpServer()).post(`${path}/${row.id}/reassign`).set('Cookie', operator.cookie).set('x-csrf-token', csrf).send(body).expect(400);
  });

  it('rolls back the real row, event and receipt together if the success audit fails', async () => {
    const { row } = rollbackSource;
    const before = await snapshot(row.id);
    const original = audit.record.bind(audit);
    const failure = jest.spyOn(audit, 'record').mockImplementation((event, tx) => {
      if (event.action === action) throw new Error('Injected handoff audit persistence failure');
      return original(event, tx);
    });
    try { await post(operator, row.id, input(row.version)).expect(500); }
    finally { failure.mockRestore(); }
    expect(await snapshot(row.id)).toEqual(before);
  });

  it('treats a replaced same-person appointment as stale, keeping full maximum-length reasons and immutable old mapping', async () => {
    const { owner, row } = await fixture();
    const assignments = await organizations.replaceUserPositions(configurer, organizationId, owner.id,
      { expectedPositionIds: [], positionIds: [owner.positionId] }, randomUUID(), randomUUID());
    const target = assignments[0]!.id;
    expect(target).not.toBe(owner.assignmentId);
    const before = await snapshot(row.id);
    expect((await ledger.detail(registrar, row.id)).qualityEngineerAssignmentId).toBe(owner.assignmentId);
    await expect(update(owner, row.id, row.version)).rejects.toMatchObject({ status: 403 });
    const reason = '"\\'.repeat(5000);
    const result = await post(operator, row.id, input(row.version, target, reason)).expect(201);
    expect(result.body).toMatchObject({ qualityEngineerId: owner.id, qualityEngineerAssignmentId: target, version: row.version + 1 });
    const after = await snapshot(row.id), changes = after.events.slice(before.events.length).map(event => JSON.parse(event.note));
    const change = changes[0].chunk === undefined ? changes[0] : JSON.parse(changes.map(part => part.chunk).join(''));
    expect(change).toMatchObject({ reason, previousAssignmentBasis: { assignmentId: owner.assignmentId }, assignmentBasis: { assignmentId: target } });
    expect(after.row.ledgerMappingSnapshot).toEqual(before.row.ledgerMappingSnapshot);
    await expect(update(owner, row.id, result.body.version)).resolves.toMatchObject({ version: result.body.version + 1 });
  });
});
