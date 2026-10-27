import 'reflect-metadata';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { createHash, randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { DatabaseModule } from '../../src/database/database.module.js';
import { AdminMutationModule } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogModule } from '../../src/modules/audit-log/audit-log.module.js';
import { OrganizationModule } from '../../src/modules/organization/organization.module.js';
import { PlatformConfigurationModule } from '../../src/modules/platform-configuration/platform-configuration.module.js';
import { FileManagementModule } from '../../src/modules/file-management/file-management.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { adminPermissions, type AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { CustomerComplaintAnalysisService } from '../../src/modules/customer-quality/customer-complaint-analysis.service.js';
import { CustomerComplaintLedgerService } from '../../src/modules/customer-quality/customer-complaint-ledger.service.js';
import { CustomerComplaintAnalysisFileAdapter } from '../../src/modules/customer-quality/customer-complaint-analysis-file.adapter.js';
import { ANALYSIS_RESOURCE_TYPE } from '../../src/modules/customer-quality/customer-complaint-analysis.types.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FileScanWorkerService } from '../../src/modules/file-management/file-scan-worker.service.js';
import { FileVerificationService } from '../../src/modules/file-management/file-verification.service.js';
import { FileResourceAccess } from '../../src/modules/file-management/file-resource-access.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';

const url = process.env.DATABASE_URL;
if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(url)) throw new Error('Customer analysis requires an explicitly disposable loopback PostgreSQL database');
for (const key of ['QMS_OBJECT_STORAGE_ENDPOINT', 'QMS_OBJECT_STORAGE_BUCKET', 'QMS_FILE_SCANNER_HOST', 'QMS_FILE_SCANNER_PORT']) if (!process.env[key]) throw new Error(`Real file integration requires ${key}`);

type Person = { actor: AdminActor; assignmentId: string; roleId: string; departmentId: string };
describe('customer complaint FAE/SQE collaboration on real PostgreSQL and file services', () => {
  let module: TestingModule; let prisma: PrismaService; let service: CustomerComplaintAnalysisService; let files: FileLifecycleService; let ledger: CustomerComplaintLedgerService;
  let qe: Person; let fae: Person; let nextFae: Person; let crossDepartment: Person; let sqe: Person; let reader: Person; let outsider: Person;
  const organizationId = randomUUID(); const departmentId = randomUUID();
  const read = 'customer-quality:complaints:read'; const write = 'customer-quality:complaints:write';
  const faePermission = 'customer-quality:analyses:fae'; const supplierPermission = 'customer-quality:analyses:supplier';

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [DatabaseModule, AdminMutationModule, AuditLogModule, OrganizationModule, PlatformConfigurationModule, FileManagementModule],
      providers: [CustomerComplaintLedgerService, CustomerComplaintAnalysisService, CustomerComplaintAnalysisFileAdapter] }).compile();
    await module.init();
    prisma = module.get(PrismaService); service = module.get(CustomerComplaintAnalysisService); files = module.get(FileLifecycleService); ledger = module.get(CustomerComplaintLedgerService);
    await prisma.organization.create({ data: { id: organizationId, code: `D-${organizationId}`, name: 'D analysis fixture', type: 'INTERNAL' } });
    await prisma.department.create({ data: { id: departmentId, organizationId, code: 'analysis', name: 'Analysis' } });
    qe = await person([read, write]); fae = await person([read, write, faePermission]); nextFae = await person([read, write, faePermission]); sqe = await person([read, write, supplierPermission]); reader = await person([read]);
    const otherDepartmentId = randomUUID();
    await prisma.department.create({ data: { id: otherDepartmentId, organizationId, code: 'other', name: 'Other department' } });
    crossDepartment = await person([read, write, faePermission], organizationId, otherDepartmentId);
    const otherOrganizationId = randomUUID(); const outsideDepartmentId = randomUUID();
    await prisma.organization.create({ data: { id: otherOrganizationId, code: `D-${otherOrganizationId}`, name: 'Outside fixture', type: 'INTERNAL' } });
    await prisma.department.create({ data: { id: outsideDepartmentId, organizationId: otherOrganizationId, code: 'outside', name: 'Outside' } });
    outsider = await person([read, write, faePermission, supplierPermission], otherOrganizationId, outsideDepartmentId);
  });
  afterAll(async () => { await module?.close(); });

  async function person(codes: string[], org = organizationId, department = departmentId): Promise<Person> {
    const id = randomUUID(); const roleId = randomUUID(); const positionId = randomUUID();
    const actor: AdminActor = { id, sessionId: randomUUID(), organizationId: org, accountType: 'INTERNAL' };
    await prisma.user.create({ data: { id, organizationId: org, username: id, accountType: 'INTERNAL', passwordHash: 'fixture-only' } });
    await prisma.session.create({ data: { id: actor.sessionId, userId: id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), reauthenticatedAt: new Date() } });
    // Position names are deliberately not FAE/SQE. Effective permission membership is the business qualification.
    await prisma.role.create({ data: { id: roleId, organizationId: org, code: id, name: 'Arbitrary fixture role' } });
    await prisma.position.create({ data: { id: positionId, organizationId: org, departmentId: department, code: id, name: 'Arbitrary fixture position' } });
    await prisma.positionRole.create({ data: { organizationId: org, positionId, roleId } });
    const assignment = await prisma.userPosition.create({ data: { organizationId: org, userId: id, positionId, startedAt: new Date(Date.now() - 60000) } });
    for (const code of codes) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    return { actor, assignmentId: assignment.id, roleId, departmentId: department };
  }

  async function complaint() {
    const id = randomUUID();
    // Source fixture only: production analysis code is forbidden from querying these private facts.
    await prisma.customerQualityComplaint.create({ data: { id, organizationId, complaintNumber: `D-${id}`, createdById: qe.actor.id, updatedById: qe.actor.id,
      qualityEngineerId: qe.actor.id, qualityEngineerAssignmentId: qe.assignmentId, qualityEngineerSource: 'MANUAL', registeredStage: 'MASS_PRODUCTION', ledgerStatus: 'FOLLOWING' } });
    return id;
  }
  const target = (person: Person, expectedVersion = 0) => ({ expectedVersion, assigneeUserId: person.actor.id, assigneeAssignmentId: person.assignmentId });
  const assign = (id: string, section = 'FAE', assignee = fae) => service.assign(qe.actor, id, section, target(assignee), randomUUID(), randomUUID());
  const save = (person: Person, id: string, expectedVersion: number, text: string) => service.save(person.actor, id, { expectedVersion, text }, randomUUID(), randomUUID());
  const resource = (id: string) => ({ resourceType: ANALYSIS_RESOURCE_TYPE, resourceId: id });

  async function departmentDrift(moving: Person, operation: () => Promise<unknown>) {
    const organizations = module.get(OrganizationService);
    const manager = await person([read, write, faePermission, supplierPermission, 'organization:structure:manage', 'account:roles:read', 'account:roles:assign']);
    await prisma.session.update({ where: { id: manager.actor.sessionId }, data: { mfaVerifiedAt: new Date() } });
    const appointment = await prisma.userPosition.findUniqueOrThrow({ where: { id: moving.assignmentId }, include: { position: true } });
    const permissionsBefore = await adminPermissions(prisma, moving.actor.id, organizationId);
    const currentAssignments = organizations.currentAssignments.bind(organizations);
    const observed: string[] = []; let checks = 0;
    // Only schedule a real public mutation; both candidate reads and their returned values stay real.
    const probe = jest.spyOn(organizations, 'currentAssignments').mockImplementation(async (...args) => {
      const actual = await currentAssignments(...args);
      if (args[0] === moving.actor.id) observed.push(actual.find(item => item.id === moving.assignmentId)!.department.id);
      if (args[0] === moving.actor.id && ++checks === 1) {
        const changed = await organizations.updatePosition(manager.actor, organizationId, appointment.positionId,
          { expectedVersion: appointment.position.version, departmentId: crossDepartment.departmentId }, randomUUID(), randomUUID());
        expect(changed.departmentId).toBe(crossDepartment.departmentId);
        expect(await prisma.position.findUniqueOrThrow({ where: { id: appointment.positionId } })).toMatchObject({ departmentId: crossDepartment.departmentId });
      }
      return actual;
    });
    let result: PromiseSettledResult<unknown>;
    try { [result] = await Promise.allSettled([operation()]); }
    finally { probe.mockRestore(); }
    expect(observed).toEqual([departmentId, crossDepartment.departmentId]);
    expect(await organizations.currentAssignments(moving.actor.id, organizationId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: moving.assignmentId, department: expect.objectContaining({ id: crossDepartment.departmentId }) }),
    ]));
    expect(await adminPermissions(prisma, moving.actor.id, organizationId)).toEqual(permissionsBefore);
    return result;
  }

  async function analysisState(complaintId: string) {
    const analyses = await prisma.$queryRaw`SELECT * FROM customer_complaint_analyses WHERE complaint_id = ${complaintId}::uuid ORDER BY id`;
    const history = await prisma.$queryRaw`SELECT * FROM customer_complaint_analysis_history WHERE analysis_id IN
      (SELECT id FROM customer_complaint_analyses WHERE complaint_id = ${complaintId}::uuid) ORDER BY analysis_id, version`;
    const audit = await prisma.auditEvent.findMany({ where: { organizationId, resourceType: ANALYSIS_RESOURCE_TYPE }, orderBy: { id: 'asc' } });
    const receipts = await prisma.adminMutation.findMany({ where: { organizationId, action: { startsWith: 'CUSTOMER_ANALYSIS_' } }, orderBy: { id: 'asc' } });
    return { analyses, history, audit, receipts };
  }

  async function cleanFile(person: Person, id: string) {
    const bytes = Buffer.from('D concurrent source-read file evidence');
    const upload = await files.initializeUpload(person.actor, { ...resource(id), originalName: 'parallel.txt', contentType: 'text/plain', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, randomUUID(), randomUUID());
    expect((await fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body: bytes })).status).toBe(200);
    await files.complete(person.actor, upload.file.id, 1, randomUUID(), randomUUID());
    const [{ now }] = await prisma.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
    const offset = now.getTime() - Date.now() + 1000;
    await new FileScanWorkerService(prisma, module.get(FileVerificationService), module.get(AuditLogService), () => new Date(Date.now() + offset)).processDue(100);
    expect(await files.get(person.actor, upload.file.id)).toMatchObject({ status: 'AVAILABLE', scanStatus: 'CLEAN' });
    return upload.file.id;
  }

  it('directly dispatches only the corresponding current QE, derives a FAE task before any 8D and never creates SQE formal tasks', async () => {
    const id = await complaint();
    await expect(service.assign(fae.actor, id, 'FAE', target(nextFae), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await expect(service.assign(qe.actor, id, 'FAE', target(reader), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    const initialTasks = await prisma.workflowTask.count({ where: { organizationId } });
    const assigned = await assign(id);
    expect(assigned).toMatchObject({ complaintId: id, section: 'FAE', version: 1, faeStatus: 'NOT_ANALYSED', assigneeUserId: fae.actor.id });
    const supplier = await assign(id, 'SUPPLIER', sqe);
    expect(supplier.faeStatus).toBeNull();
    expect((await service.listFAETasks(fae.actor)).some(task => task.analysis.id === assigned.id)).toBe(true);
    expect((await service.listFAETasks(nextFae.actor)).some(task => task.analysis.id === assigned.id)).toBe(false);
    expect(await prisma.workflowTask.count({ where: { organizationId } })).toBe(initialTasks);
    expect(await prisma.domainSourceIssueLink.count({ where: { organizationId, sourceId: id } })).toBe(0);
    const source = await prisma.$transaction(tx => ledger.readCase(tx, qe.actor, id, 'read'), { isolationLevel: 'ReadCommitted' });
    expect(source.status).toBe('FOLLOWING'); expect(source.version).toBe(1);
  });

  it('saves FAE whitespace as unanalysed, text alone as analysed, and never invents required metadata or completion date', async () => {
    const assigned = await assign(await complaint());
    const empty = await save(fae, assigned.id, 1, ' \n\t'); expect(empty.faeStatus).toBe('NOT_ANALYSED');
    const analysed = await save(fae, assigned.id, 2, ' observed failure ');
    expect(analysed).toMatchObject({ text: 'observed failure', faeStatus: 'ANALYSED', completedOn: null, failedPart: null, failedMaterialCode: null });
    expect((await service.summary(reader.actor, assigned.complaintId)).fae).toMatchObject({ id: assigned.id, version: 3 });
    await expect(save(reader, assigned.id, 3, 'not assigned')).rejects.toMatchObject({ status: 403 });
  });

  it('has body-sensitive idempotency, CAS, and atomic rollback if audit fails', async () => {
    const assigned = await assign(await complaint()); const key = randomUUID(); const input = { expectedVersion: 1, text: 'once' };
    const saved = await service.save(fae.actor, assigned.id, input, randomUUID(), key);
    expect(await service.save(fae.actor, assigned.id, input, randomUUID(), key)).toEqual(saved);
    await expect(service.save(fae.actor, assigned.id, { ...input, text: 'changed' }, randomUUID(), key)).rejects.toMatchObject({ status: 409 });
    await expect(save(fae, assigned.id, 1, 'stale')).rejects.toMatchObject({ status: 409 });
    const results = await Promise.allSettled([save(fae, assigned.id, 2, 'concurrent one'), save(fae, assigned.id, 2, 'concurrent two')]);
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1); expect(results.filter(item => item.status === 'rejected')).toHaveLength(1);
    const before = await service.summary(qe.actor, assigned.complaintId);
    // Real database failure at the audit boundary proves rollback, not a mock service success.
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION d_analysis_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource_type = 'customer-complaint-analysis' AND NEW.resource_id = '${assigned.id}' THEN RAISE EXCEPTION 'D audit fixture failure'; END IF; RETURN NEW; END; $$`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER d_analysis_fail_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION d_analysis_fail_audit()');
    try { await expect(save(fae, assigned.id, 3, 'must rollback')).rejects.toThrow(); }
    finally { await prisma.$executeRawUnsafe('DROP TRIGGER d_analysis_fail_audit ON audit_events'); await prisma.$executeRawUnsafe('DROP FUNCTION d_analysis_fail_audit()'); }
    expect(await service.summary(qe.actor, assigned.complaintId)).toEqual(before);
    expect(await service.history(qe.actor, assigned.id)).toHaveLength(3);
  });

  it('transfers only by current FAE within its department, preserves history/results and revokes the former writer including replay', async () => {
    const assigned = await assign(await complaint()); const key = randomUUID(); const input = { expectedVersion: 1, text: 'retained findings' };
    await service.save(fae.actor, assigned.id, input, randomUUID(), key);
    await expect(service.transfer(qe.actor, assigned.id, target(nextFae, 2), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await expect(service.transfer(fae.actor, assigned.id, target(crossDepartment, 2), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    const transferred = await service.transfer(fae.actor, assigned.id, target(nextFae, 2), randomUUID(), randomUUID());
    expect(transferred).toMatchObject({ id: assigned.id, text: 'retained findings', assigneeUserId: nextFae.actor.id, version: 3 });
    await expect(service.save(fae.actor, assigned.id, input, randomUUID(), key)).rejects.toMatchObject({ status: 403 });
    await expect(save(fae, assigned.id, 3, 'former')).rejects.toMatchObject({ status: 403 });
    await expect(files.initializeUpload(fae.actor, { ...resource(assigned.id), originalName: 'old.txt', contentType: 'text/plain', sizeBytes: 5, sha256: 'a'.repeat(64) }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    expect((await service.listFAETasks(fae.actor)).some(task => task.analysis.id === assigned.id)).toBe(false);
    expect((await service.listFAETasks(nextFae.actor)).some(task => task.analysis.id === assigned.id)).toBe(true);
    const history = await service.history(reader.actor, assigned.id);
    expect(history.map(item => item.action)).toEqual(['ASSIGNED', 'SAVED', 'TRANSFERRED']);
    expect(history[1].snapshot.assigneeUserId).toBe(fae.actor.id);
    await expect(prisma.$executeRaw`UPDATE customer_complaint_analysis_history SET action = 'SAVED' WHERE analysis_id = ${assigned.id}::uuid`).rejects.toThrow();
    await save(nextFae, assigned.id, 3, 'new findings');
  });

  it.each(['FAE', 'SUPPLIER'] as const)('rolls back %s assignment when a normal position update changes the final candidate department', async section => {
    const moving = await person([read, write, section === 'FAE' ? faePermission : supplierPermission]);
    const id = await complaint();
    const previous = section === 'SUPPLIER' ? await assign(id, section, sqe) : null;
    if (previous) await service.save(sqe.actor, previous.id, { expectedVersion: 1, progress: 'retained progress', result: 'retained result' }, randomUUID(), randomUUID());
    const before = await analysisState(id); const snapshot = await service.summary(qe.actor, id);
    const traceId = randomUUID(); const key = randomUUID();
    const result = await departmentDrift(moving, () => service.assign(qe.actor, id, section, target(moving, previous ? 2 : 0), traceId, key));
    expect(await analysisState(id)).toEqual(before);
    expect(await service.summary(qe.actor, id)).toEqual(snapshot);
    expect(result).toMatchObject({ status: 'rejected', reason: { status: 409, response: { code: 'CONCURRENCY_CONFLICT' } } });
    expect(await prisma.auditEvent.findMany({ where: { traceId } })).toEqual([
      expect.objectContaining({ action: 'ACTION_REJECTED', outcome: 'DENIED', metadata: expect.objectContaining({ reasonCode: 'CONCURRENCY_CONFLICT' }) }),
    ]);
    expect(await prisma.adminMutation.count({ where: { organizationId, key } })).toBe(0);
    if (previous) {
      expect(await service.save(sqe.actor, previous.id, { expectedVersion: 2, progress: 'old owner still works' }, randomUUID(), randomUUID())).toMatchObject({ version: 3, assigneeUserId: sqe.actor.id });
    } else {
      expect((await service.listFAETasks(moving.actor)).some(task => task.analysis.complaintId === id)).toBe(false);
      expect(await service.assign(qe.actor, id, section, target(fae), randomUUID(), key)).toMatchObject({ version: 1, assigneeUserId: fae.actor.id });
    }
  });

  it('rolls back FAE transfer when a normal position update moves the final candidate outside the source department', async () => {
    const moving = await person([read, write, faePermission]);
    const assigned = await assign(await complaint());
    const saved = await save(fae, assigned.id, 1, 'retained transfer findings');
    const before = await analysisState(assigned.complaintId); const traceId = randomUUID(); const key = randomUUID();
    const result = await departmentDrift(moving, () => service.transfer(fae.actor, assigned.id, target(moving, 2), traceId, key));
    expect(await analysisState(assigned.complaintId)).toEqual(before);
    expect((await service.summary(qe.actor, assigned.complaintId)).fae).toEqual(saved);
    expect(result).toMatchObject({ status: 'rejected', reason: { status: 409, response: { code: 'CONCURRENCY_CONFLICT' } } });
    expect(await prisma.auditEvent.findMany({ where: { traceId } })).toEqual([
      expect.objectContaining({ action: 'ACTION_REJECTED', outcome: 'DENIED', metadata: expect.objectContaining({ reasonCode: 'CONCURRENCY_CONFLICT' }) }),
    ]);
    expect(await prisma.adminMutation.count({ where: { organizationId, key } })).toBe(0);
    expect((await service.listFAETasks(fae.actor)).some(task => task.analysis.id === assigned.id)).toBe(true);
    expect((await service.listFAETasks(moving.actor)).some(task => task.analysis.id === assigned.id)).toBe(false);
    expect(await save(fae, assigned.id, 2, 'old owner still works')).toMatchObject({ version: 3, assigneeUserId: fae.actor.id });
  });

  it('enforces effective appointment, cross-organization isolation and permission/session revocation on every write', async () => {
    const assigned = await assign(await complaint());
    await expect(service.summary(outsider.actor, assigned.complaintId)).rejects.toMatchObject({ status: 404 });
    await expect(service.assign(qe.actor, await complaint(), 'FAE', target(outsider), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await prisma.userPosition.update({ where: { id: fae.assignmentId }, data: { endedAt: new Date(Date.now() - 1000) } });
    try { await expect(save(fae, assigned.id, 1, 'ended')).rejects.toMatchObject({ status: 403 }); await expect(service.listFAETasks(fae.actor)).rejects.toMatchObject({ status: 403 }); }
    finally { await prisma.userPosition.update({ where: { id: fae.assignmentId }, data: { endedAt: null } }); }
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: faePermission } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: fae.roleId, permissionId: permission.id } } });
    try { await expect(save(fae, assigned.id, 1, 'revoked')).rejects.toMatchObject({ status: 403 }); }
    finally { await prisma.rolePermission.create({ data: { roleId: fae.roleId, permissionId: permission.id } }); }
    await prisma.session.update({ where: { id: fae.actor.sessionId }, data: { revokedAt: new Date() } });
    try { await expect(save(fae, assigned.id, 1, 'session revoked')).rejects.toMatchObject({ status: 401 }); }
    finally { await prisma.session.update({ where: { id: fae.actor.sessionId }, data: { revokedAt: null } }); }
    expect((await service.summary(qe.actor, assigned.complaintId)).fae?.version).toBe(1);
  });

  it('rejects a revoked session even when the FAE task list would be empty', async () => {
    const unusedFae = await person([read, write, faePermission]);
    expect(await service.listFAETasks(unusedFae.actor)).toEqual([]);
    await prisma.session.update({ where: { id: unusedFae.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(service.listFAETasks(unusedFae.actor)).rejects.toMatchObject({ status: 401 });
  });

  it('uses the public source read qualification for scoped readers without granting cross-organization writes', async () => {
    const assigned = await assign(await complaint());
    const scopedReader = { ...outsider.actor, scopeOrganizationId: organizationId };
    const grant = { userId: outsider.actor.id, organizationId, roleId: reader.roleId };
    await prisma.userRole.create({ data: grant });
    try {
      expect(await prisma.$transaction(tx => ledger.readCase(tx, scopedReader, assigned.complaintId, 'read'), { isolationLevel: 'ReadCommitted' })).toMatchObject({ id: assigned.complaintId });
      expect((await service.summary(scopedReader, assigned.complaintId)).fae?.id).toBe(assigned.id);
      expect(await prisma.$transaction(tx => module.get(FileResourceAccess).authorizeAndLock(tx, outsider.actor, resource(assigned.id), 'read'), { isolationLevel: 'ReadCommitted' })).toMatchObject({ organizationId });
      await expect(service.save(scopedReader, assigned.id, { expectedVersion: 1, text: 'cross-scope edit' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    } finally { await prisma.userRole.delete({ where: { userId_roleId_organizationId: grant } }); }
    await expect(service.summary(scopedReader, assigned.complaintId)).rejects.toMatchObject({ status: 403 });
    await expect(prisma.$transaction(tx => module.get(FileResourceAccess).authorizeAndLock(tx, outsider.actor, resource(assigned.id), 'read'), { isolationLevel: 'ReadCommitted' })).rejects.toMatchObject({ status: 403 });
  });

  it('keeps SQE progress/results independent, without inferred completion, formal tasks, supplier responsibility or source closure', async () => {
    const id = await complaint(); const f = await assign(id); const s = await assign(id, 'SUPPLIER', sqe);
    await save(fae, f.id, 1, 'FAE retained');
    await expect(service.save(fae.actor, s.id, { expectedVersion: 1, progress: 'wrong writer' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await expect(service.save(sqe.actor, s.id, { expectedVersion: 1, text: 'cross section' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    const updated = await service.save(sqe.actor, s.id, { expectedVersion: 1, progress: 'sample in transit', result: 'not yet determined' }, randomUUID(), randomUUID());
    expect(updated).toMatchObject({ faeStatus: null, progress: 'sample in transit', result: 'not yet determined', text: null });
    expect((await service.summary(qe.actor, id)).fae?.text).toBe('FAE retained');
    const source = await prisma.$transaction(tx => ledger.readCase(tx, qe.actor, id, 'read'), { isolationLevel: 'ReadCommitted' });
    expect(source).toMatchObject({ status: 'FOLLOWING', version: 1 });
    expect(await prisma.workflowTask.count({ where: { organizationId } })).toBe(0);
  });

  describe('CLEAN AVAILABLE section evidence', () => {
    let assigned: Awaited<ReturnType<typeof assign>>; let fileId: string;
    const bytes = Buffer.from('D analysis real versioned file evidence');
    beforeAll(async () => {
      assigned = await assign(await complaint());
      const upload = await files.initializeUpload(fae.actor, { ...resource(assigned.id), originalName: 'analysis.txt', contentType: 'text/plain', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, randomUUID(), randomUUID());
      fileId = upload.file.id;
      await expect(service.save(fae.actor, assigned.id, { expectedVersion: 1, fileIds: [fileId] }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
      expect((await fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body: bytes })).status).toBe(200);
      await files.complete(fae.actor, fileId, 1, randomUUID(), randomUUID());
      const [{ now }] = await prisma.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
      const offset = now.getTime() - Date.now() + 1000;
      await new FileScanWorkerService(prisma, module.get(FileVerificationService), module.get(AuditLogService), () => new Date(Date.now() + offset)).processDue(100);
      expect(await files.get(fae.actor, fileId)).toMatchObject({ scanStatus: 'CLEAN', status: 'AVAILABLE' });
    });
    it('requires bound CLEAN evidence, supports file-only analysis, and revokes former-assignee file writes after transfer', async () => {
    const saved = await service.save(fae.actor, assigned.id, { expectedVersion: 1, fileIds: [fileId] }, randomUUID(), randomUUID());
    expect(saved).toMatchObject({ text: null, completedOn: null, faeStatus: 'ANALYSED', fileIds: [fileId] });
    const other = await assign(await complaint());
    await expect(service.save(fae.actor, other.id, { expectedVersion: 1, fileIds: [fileId] }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    const sqeSection = await assign(assigned.complaintId, 'SUPPLIER', sqe);
    await expect(service.save(sqe.actor, sqeSection.id, { expectedVersion: 1, fileIds: [fileId] }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await service.transfer(fae.actor, assigned.id, target(nextFae, 2), randomUUID(), randomUUID());
    expect((await service.summary(reader.actor, assigned.complaintId)).fae?.faeStatus).toBe('ANALYSED');
    const download = await files.download(reader.actor, fileId, randomUUID());
    expect(Buffer.from(await (await fetch(download.url)).arrayBuffer())).toEqual(bytes);
    const currentFile = await files.get(nextFae.actor, fileId);
    await expect(files.deleteLogically(fae.actor, fileId, currentFile.version, randomUUID())).rejects.toMatchObject({ status: 403 });
    await files.deleteLogically(nextFae.actor, fileId, currentFile.version, randomUUID());
    expect((await service.summary(reader.actor, assigned.complaintId)).fae?.faeStatus).toBe('NOT_ANALYSED');
    });
  });

  it('denies closed-source writes and preserves old analysis and history after source read eligibility is removed', async () => {
    const assigned = await assign(await complaint()); await save(fae, assigned.id, 1, 'before closing');
    await prisma.customerQualityComplaint.update({ where: { id: assigned.complaintId }, data: { ledgerStatus: 'CLOSED', status: 'CLOSED' } });
    await expect(save(fae, assigned.id, 2, 'closed edit')).rejects.toMatchObject({ status: 409 });
    expect((await service.summary(reader.actor, assigned.complaintId)).fae?.text).toBe('before closing');
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: read } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: reader.roleId, permissionId: permission.id } } });
    try { await expect(service.summary(reader.actor, assigned.complaintId)).rejects.toMatchObject({ status: 403 }); await expect(service.history(reader.actor, assigned.id)).rejects.toMatchObject({ status: 403 }); }
    finally { await prisma.rolePermission.create({ data: { roleId: reader.roleId, permissionId: permission.id } }); }
  });

  describe('concurrent evidence reads', () => {
    let first: string; let second: string;
    const prepare = async () => {
      const row = await assign(await complaint()); const fileId = await cleanFile(fae, row.id);
      await service.save(fae.actor, row.id, { expectedVersion: 1, fileIds: [fileId] }, randomUUID(), randomUUID());
      return row.complaintId;
    };
    beforeAll(async () => { first = await prepare(); });
    beforeAll(async () => { second = await prepare(); });
    it('does not upgrade a shared actor lock after source/file locks during concurrent evidence reads', async () => {
      const results = await Promise.all([service.summary(reader.actor, first), service.summary(reader.actor, second)]);
      expect(results.map(result => result.fae?.faeStatus)).toEqual(['ANALYSED', 'ANALYSED']);
    });
  });
});
