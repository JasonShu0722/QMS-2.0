import 'reflect-metadata';
import { jest } from '@jest/globals';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { createHash, randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { ComponentProjectService } from '../../src/modules/platform-configuration/component-project.service.js';
import { DatabaseModule } from '../../src/database/database.module.js';
import { AdminMutationModule } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogModule } from '../../src/modules/audit-log/audit-log.module.js';
import { OrganizationModule } from '../../src/modules/organization/organization.module.js';
import { PlatformConfigurationModule } from '../../src/modules/platform-configuration/platform-configuration.module.js';
import { FileManagementModule } from '../../src/modules/file-management/file-management.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { type AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { CustomerComplaintAnalysisService } from '../../src/modules/customer-quality/customer-complaint-analysis.service.js';
import { CustomerComplaintLedgerService } from '../../src/modules/customer-quality/customer-complaint-ledger.service.js';
import { CustomerComplaintAnalysisFileAdapter } from '../../src/modules/customer-quality/customer-complaint-analysis-file.adapter.js';
import { ANALYSIS_RESOURCE_TYPE } from '../../src/modules/customer-quality/customer-complaint-analysis.types.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FileScanWorkerService } from '../../src/modules/file-management/file-scan-worker.service.js';
import { FileVerificationService } from '../../src/modules/file-management/file-verification.service.js';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AssignCustomerAnalysisDto, CustomerAnalysisCandidatesQueryDto, TransferCustomerAnalysisDto } from '../../src/modules/customer-quality/customer-complaint-analysis.dto.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';

const url = process.env.DATABASE_URL;
if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(url)) throw new Error('Customer analysis requires an explicitly disposable loopback PostgreSQL database');
for (const key of ['QMS_OBJECT_STORAGE_ENDPOINT', 'QMS_OBJECT_STORAGE_BUCKET', 'QMS_FILE_SCANNER_HOST', 'QMS_FILE_SCANNER_PORT']) if (!process.env[key]) throw new Error(`Real file integration requires ${key}`);

jest.setTimeout(30000);

type Person = { actor: AdminActor; assignmentId: string; roleId: string; departmentId: string };
describe('PR75 analysis assignment recovery and accepted responsibility on real services', () => {
  let module: TestingModule; let prisma: PrismaService; let service: CustomerComplaintAnalysisService; let files: FileLifecycleService; let ledger: CustomerComplaintLedgerService;
  let manager: Person; let qe: Person; let fae: Person; let nextFae: Person; let crossDepartment: Person; let sqe: Person; let reader: Person; let outsider: Person;
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
    manager = await person([read, write, faePermission, supplierPermission, 'customer-quality:complaints:reassign', 'new-product-quality:projects:write', 'organization:positions:assign', 'account:roles:read', 'account:roles:assign']);
    await prisma.session.update({ where: { id: manager.actor.sessionId }, data: { mfaVerifiedAt: new Date() } });
    qe = await person([read, write, 'customer-quality:complaints:reassign']); fae = await person([read, write, faePermission]); nextFae = await person([read, write, faePermission]); sqe = await person([read, write, supplierPermission]); reader = await person([read]);
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


  async function end(who: Person) {
    const appointment = await prisma.userPosition.findUniqueOrThrow({ where: { id: who.assignmentId } });
    await module.get(OrganizationService).replaceUserPositions(manager.actor, organizationId, who.actor.id,
      { expectedPositionIds: [appointment.positionId], positionIds: [] }, randomUUID(), randomUUID());
    expect((await prisma.userPosition.findUniqueOrThrow({ where: { id: who.assignmentId } })).endedAt).not.toBeNull();
    return appointment.positionId;
  }
  async function permission(who: Person, code: string, enabled: boolean) {
    const p = await prisma.permission.findUniqueOrThrow({ where: { code } });
    const identity = { roleId: who.roleId, permissionId: p.id };
    if (enabled) await prisma.rolePermission.create({ data: identity });
    else await prisma.rolePermission.delete({ where: { roleId_permissionId: identity } });
  }
  const recover = (id: string, who = crossDepartment, expectedVersion = 1, key = randomUUID(), actor = qe.actor) =>
    service.assign(actor, id, 'FAE', { ...target(who, expectedVersion), recoverStale: true }, randomUUID(), key);

  it('recovers an ended FAE appointment through explicit QE assignment without dropping findings', async () => {
    const old = await person([read, write, faePermission]);
    const assigned = await assign(await complaint(), 'FAE', old);
    const bytes = Buffer.from('PR75 recovery keeps real CLEAN evidence');
    const upload = await files.initializeUpload(old.actor, { ...resource(assigned.id), originalName: 'retained.txt', contentType: 'text/plain', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, randomUUID(), randomUUID());
    expect((await fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body: bytes })).status).toBe(200);
    await files.complete(old.actor, upload.file.id, 1, randomUUID(), randomUUID());
    const [{ now }] = await prisma.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
    const offset = now.getTime() - Date.now() + 1000;
    await new FileScanWorkerService(prisma, module.get(FileVerificationService), module.get(AuditLogService), () => new Date(Date.now() + offset)).processDue(100);
    expect(await files.get(old.actor, upload.file.id)).toMatchObject({ status: 'AVAILABLE', scanStatus: 'CLEAN' });
    const saved = await service.save(old.actor, assigned.id, { expectedVersion: 1, text: 'retained findings', completedOn: '2026-10-20', failedPart: 'original part', fileIds: [upload.file.id] }, randomUUID(), randomUUID());
    const sourceBefore = await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: assigned.complaintId } });
    const fileBefore = await prisma.fileObject.findUniqueOrThrow({ where: { id: upload.file.id } });
    await end(old);
    expect(await service.summary(qe.actor, assigned.complaintId)).toMatchObject({ canDispatch: true, canRecoverAssignment: true });
    expect(await service.candidates(qe.actor, assigned.complaintId, 'FAE', true)).toEqual(expect.arrayContaining([expect.objectContaining({ userId: crossDepartment.actor.id })]));
    const input = { ...target(crossDepartment, 2), recoverStale: true };
    await expect(service.assign(qe.actor, assigned.complaintId, 'FAE', input, randomUUID(), randomUUID())).resolves.toMatchObject({
      id: assigned.id, text: 'retained findings', version: 3, assigneeUserId: crossDepartment.actor.id,
    });
    expect((await service.summary(qe.actor, assigned.complaintId)).fae).toMatchObject({ ...saved, version: 3, assigneeUserId: crossDepartment.actor.id, assigneeAssignmentId: crossDepartment.assignmentId, departmentId: crossDepartment.departmentId, updatedByUserId: qe.actor.id, updatedAt: expect.any(String) });
    const history = await service.history(reader.actor, assigned.id);
    expect(history.map(item => item.action)).toEqual(['ASSIGNED', 'SAVED', 'ASSIGNED']);
    expect(history[1].snapshot).toEqual(saved);
    expect(history[2].snapshot).not.toHaveProperty('canRecoverAssignment');
    expect(await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: assigned.complaintId } })).toEqual(sourceBefore);
    expect(await prisma.fileObject.findUniqueOrThrow({ where: { id: upload.file.id } })).toEqual(fileBefore);
    const download = await files.download(crossDepartment.actor, upload.file.id, randomUUID());
    expect(Buffer.from(await (await fetch(download.url)).arrayBuffer())).toEqual(bytes);
  });

  it('keeps accepted MASS QE dispatch when the live mapping changes to NEW', async () => {
    const manager = await person(['component-project:manage']);
    const components = module.get(ComponentProjectService), code = randomUUID();
    const project = await components.createProject(manager.actor, organizationId,
      { code, name: 'Accepted MASS', stage: 'MASS_PRODUCTION', customerEngineerAssignmentId: qe.assignmentId }, randomUUID(), randomUUID());
    await components.createMapping(manager.actor, organizationId, { componentCode: code, projectRecordId: project.id, productCategory: 'controller' }, randomUUID(), randomUUID());
    const row = await ledger.create(qe.actor, { fields: { componentCode: code } }, randomUUID(), randomUUID());
    await components.updateProject(manager.actor, organizationId, project.id, { expectedVersion: project.version, stage: 'NEW_PRODUCT' }, randomUUID(), randomUUID());
    expect(await service.summary(qe.actor, row.id)).toMatchObject({ canDispatch: true, canRecoverAssignment: false });
    expect(await service.candidates(qe.actor, row.id, 'FAE')).toEqual(expect.arrayContaining([expect.objectContaining({ userId: fae.actor.id })]));
    await expect(assign(row.id)).resolves.toMatchObject({ version: 1, assigneeUserId: fae.actor.id });
    const changed = await ledger.update(qe.actor, row.id, { expectedVersion: row.version, fields: { investigation: 'Still accepted MASS QE' } }, randomUUID(), randomUUID());
    expect(changed.stage).toBe('NEW_PRODUCT');
    expect((await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: row.id } })).registeredStage).toBe('MASS_PRODUCTION');
    const projectQe = await person([read, write, 'new-product-quality:projects:write']);
    await ledger.update(qe.actor, row.id, { expectedVersion: changed.version, fields: {}, qualityEngineerAssignmentId: projectQe.assignmentId }, randomUUID(), randomUUID());
    expect(await service.summary(qe.actor, row.id)).toMatchObject({ canDispatch: false });
    expect(await service.summary(projectQe.actor, row.id)).toMatchObject({ canDispatch: true });
    expect((await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: row.id } })).registeredStage).toBe('NEW_PRODUCT');
  });


  it('recovers same-person replacement and department-drift appointments, never by user identity alone', async () => {
    const old = await person([read, write, faePermission]);
    const assigned = await assign(await complaint(), 'FAE', old), positionId = await end(old);
    const [replacement] = await module.get(OrganizationService).replaceUserPositions(manager.actor, organizationId, old.actor.id,
      { expectedPositionIds: [], positionIds: [positionId] }, randomUUID(), randomUUID());
    expect(replacement!.id).not.toBe(old.assignmentId);
    const newAppointment = { ...old, assignmentId: replacement!.id };
    expect(await service.summary(qe.actor, assigned.complaintId)).toMatchObject({ canRecoverAssignment: true });
    expect(await recover(assigned.complaintId, newAppointment)).toMatchObject({ assigneeUserId: old.actor.id, assigneeAssignmentId: replacement!.id, version: 2 });
    const drifted = await person([read, write, faePermission]);
    const drift = await assign(await complaint(), 'FAE', drifted);
    const position = await prisma.userPosition.findUniqueOrThrow({ where: { id: drifted.assignmentId }, include: { position: true } });
    // Real persisted department drift makes the stored writer basis invalid even though its appointment ID remains.
    await prisma.position.update({ where: { id: position.positionId }, data: { departmentId: crossDepartment.departmentId } });
    await expect(save(drifted, drift.id, 1, 'invalid department')).rejects.toMatchObject({ status: 403 });
    expect(await service.summary(qe.actor, drift.complaintId)).toMatchObject({ canRecoverAssignment: true });
    expect(await recover(drift.complaintId)).toMatchObject({ assigneeUserId: crossDepartment.actor.id });
  });

  it('never lets recovery replace a valid FAE and retains the same-department ordinary transfer rule', async () => {
    const assigned = await assign(await complaint());
    expect(await service.summary(qe.actor, assigned.complaintId)).toMatchObject({ canDispatch: true, canRecoverAssignment: false });
    await expect(recover(assigned.complaintId)).rejects.toMatchObject({ status: 409 });
    await expect(service.candidates(qe.actor, assigned.complaintId, 'FAE', true)).rejects.toMatchObject({ status: 409 });
    await expect(service.assign(qe.actor, assigned.complaintId, 'FAE', target(nextFae, 1), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect((await service.candidates(fae.actor, assigned.complaintId, 'FAE')).every(item => item.departmentId === departmentId)).toBe(true);
    await expect(service.transfer(fae.actor, assigned.id, target(crossDepartment, 1), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await permission(fae, faePermission, false);
    try {
      expect(await service.summary(qe.actor, assigned.complaintId)).toMatchObject({ canRecoverAssignment: true });
      expect(await service.candidates(qe.actor, assigned.complaintId, 'FAE', true)).toEqual(expect.arrayContaining([expect.objectContaining({ assignmentId: nextFae.assignmentId })]));
    }
    finally { await permission(fae, faePermission, true); }
    expect(await service.summary(qe.actor, assigned.complaintId)).toMatchObject({ canRecoverAssignment: false });
    expect(await service.transfer(fae.actor, assigned.id, target(nextFae, 1), randomUUID(), randomUUID())).toMatchObject({ assigneeUserId: nextFae.actor.id });
  });

  it.each([read, write, faePermission])('recovers when the saved FAE loses %s without an appointment change', async code => {
    const old = await person([read, write, faePermission]);
    const assigned = await assign(await complaint(), 'FAE', old);
    const saved = await save(old, assigned.id, 1, '原解析仍须保留');
    await permission(old, code, false);
    expect((await prisma.userPosition.findUniqueOrThrow({ where: { id: old.assignmentId } })).endedAt).toBeNull();
    await expect(save(old, assigned.id, 2, '越权修改')).rejects.toMatchObject({ status: 403 });
    expect(await service.summary(qe.actor, assigned.complaintId)).toMatchObject({ canRecoverAssignment: true });
    expect(await recover(assigned.complaintId, nextFae, 2)).toMatchObject({ id: assigned.id, assigneeUserId: nextFae.actor.id, text: saved.text, version: 3 });
    await expect(save(old, assigned.id, 3, '交接后越权')).rejects.toMatchObject({ status: 403 });
  });

  it('retains accepted NEW project qualification after mapping changes to MASS until explicit handoff', async () => {
    const projectPermission = 'new-product-quality:projects:write';
    const owner = await person([read, write, projectPermission]);
    const configurer = await person(['component-project:manage']);
    const components = module.get(ComponentProjectService), code = randomUUID();
    const project = await components.createProject(configurer.actor, organizationId, { code, name: 'Accepted NEW', stage: 'NEW_PRODUCT', projectEngineerAssignmentId: owner.assignmentId }, randomUUID(), randomUUID());
    await components.createMapping(configurer.actor, organizationId, { componentCode: code, projectRecordId: project.id, productCategory: 'controller' }, randomUUID(), randomUUID());
    const row = await ledger.create(owner.actor, { fields: { componentCode: code } }, randomUUID(), randomUUID());
    await components.updateProject(configurer.actor, organizationId, project.id, { expectedVersion: project.version, stage: 'MASS_PRODUCTION', customerEngineerAssignmentId: qe.assignmentId }, randomUUID(), randomUUID());
    await permission(owner, projectPermission, false);
    try {
      expect(await service.summary(owner.actor, row.id)).toMatchObject({ canDispatch: false, canRecoverAssignment: false });
      await expect(service.assign(owner.actor, row.id, 'FAE', target(fae), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
      await expect(service.candidates(owner.actor, row.id, 'FAE')).rejects.toMatchObject({ status: 403 });
    } finally { await permission(owner, projectPermission, true); }
    await ledger.update(owner.actor, row.id, { expectedVersion: row.version, fields: {}, qualityEngineerAssignmentId: qe.assignmentId }, randomUUID(), randomUUID());
    expect(await service.summary(qe.actor, row.id)).toMatchObject({ canDispatch: true });
    await expect(assign(row.id)).resolves.toMatchObject({ version: 1 });
  });

  it('requires independent read/write/reassign, corresponding current QE, and actual target FAE qualification', async () => {
    const old = await person([read, write, faePermission]);
    const assigned = await assign(await complaint(), 'FAE', old); await end(old);
    for (const code of [read, write, 'customer-quality:complaints:reassign']) {
      await permission(qe, code, false);
      try {
        await expect(recover(assigned.complaintId)).rejects.toMatchObject({ status: 403 });
        await expect(service.candidates(qe.actor, assigned.complaintId, 'FAE', true)).rejects.toMatchObject({ status: 403 });
        if (code !== read) expect(await service.summary(qe.actor, assigned.complaintId)).toMatchObject({ canRecoverAssignment: false });
      } finally { await permission(qe, code, true); }
    }
    await expect(recover(assigned.complaintId, crossDepartment, 1, randomUUID(), manager.actor)).rejects.toMatchObject({ status: 403 });
    expect(await service.summary(manager.actor, assigned.complaintId)).toMatchObject({ canDispatch: false, canRecoverAssignment: false });
    for (const invalid of [reader, sqe, outsider, { ...nextFae, assignmentId: randomUUID() }]) {
      await expect(recover(assigned.complaintId, invalid)).rejects.toMatchObject({ status: 403 });
    }
    const endedTarget = await person([read, write, faePermission]); await end(endedTarget);
    await expect(recover(assigned.complaintId, endedTarget)).rejects.toMatchObject({ status: 403 });
    const sourceQe = await person([read, write, 'customer-quality:complaints:reassign']);
    const id = await complaint();
    await prisma.customerQualityComplaint.update({ where: { id }, data: { qualityEngineerId: sourceQe.actor.id, qualityEngineerAssignmentId: sourceQe.assignmentId } });
    const positionId = await end(sourceQe);
    await module.get(OrganizationService).replaceUserPositions(manager.actor, organizationId, sourceQe.actor.id, { expectedPositionIds: [], positionIds: [positionId] }, randomUUID(), randomUUID());
    const user = await prisma.user.findUniqueOrThrow({ where: { id: sourceQe.actor.id } });
    sourceQe.actor.sessionId = randomUUID();
    await prisma.session.create({ data: { id: sourceQe.actor.sessionId, userId: user.id, tokenHash: randomUUID(), securityVersion: user.securityVersion, expiresAt: new Date(Date.now() + 3600000), reauthenticatedAt: new Date() } });
    expect(await service.summary(sourceQe.actor, id)).toMatchObject({ canDispatch: false });
    await expect(service.assign(sourceQe.actor, id, 'FAE', target(fae), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    expect(await service.history(reader.actor, assigned.id)).toHaveLength(1);
  });

  it('denies closed/archived/cross-organization/supplier recovery and strict invalid envelopes without touching evidence', async () => {
    const old = await person([read, write, faePermission]);
    const assigned = await assign(await complaint(), 'FAE', old); await end(old);
    for (const archived of [false, true]) {
      await prisma.customerQualityComplaint.update({ where: { id: assigned.complaintId }, data: archived ? { ledgerStatus: 'FOLLOWING', archivedAt: new Date() } : { ledgerStatus: 'CLOSED' } });
      expect(await service.summary(qe.actor, assigned.complaintId)).toMatchObject({ canDispatch: false, canRecoverAssignment: false });
      await expect(recover(assigned.complaintId)).rejects.toMatchObject({ status: 409 });
      await expect(service.candidates(qe.actor, assigned.complaintId, 'FAE', true)).rejects.toMatchObject({ status: 409 });
    }
    await expect(recover(assigned.complaintId, nextFae, 1, randomUUID(), outsider.actor)).rejects.toMatchObject({ status: 403 });
    await expect(recover(assigned.complaintId, nextFae, 1, randomUUID(), { ...outsider.actor, scopeOrganizationId: organizationId })).rejects.toMatchObject({ status: 403 });
    const supplier = await person([read, write, faePermission, 'customer-quality:complaints:reassign']);
    await prisma.user.update({ where: { id: supplier.actor.id }, data: { accountType: 'SUPPLIER' } });
    await expect(recover(assigned.complaintId, nextFae, 1, randomUUID(), { ...supplier.actor, accountType: 'SUPPLIER' })).rejects.toMatchObject({ status: 403 });
    await expect(service.assign(qe.actor, assigned.complaintId, 'SUPPLIER', { ...target(sqe, 0), recoverStale: true }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    await expect(service.candidates(qe.actor, assigned.complaintId, 'SUPPLIER', true)).rejects.toMatchObject({ status: 400 });
    const validate = (dto: object) => validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
    for (const recoverStale of [true, false]) expect(validate(plainToInstance(AssignCustomerAnalysisDto, { ...target(fae), recoverStale }))).toEqual([]);
    for (const recoverStale of ['true', 1, {}]) expect(validate(plainToInstance(AssignCustomerAnalysisDto, { ...target(fae), recoverStale }))).not.toEqual([]);
    for (const recoverStale of ['true', 'false']) expect(validate(plainToInstance(CustomerAnalysisCandidatesQueryDto, { recoverStale }))).toEqual([]);
    expect(validate(plainToInstance(CustomerAnalysisCandidatesQueryDto, { recoverStale: 'yes' }))).not.toEqual([]);
    expect(validate(plainToInstance(AssignCustomerAnalysisDto, { ...target(fae), canRecoverAssignment: true }))).not.toEqual([]);
    expect(validate(plainToInstance(TransferCustomerAnalysisDto, { ...target(fae, 1), recoverStale: true }))).not.toEqual([]);
    expect(await service.history(reader.actor, assigned.id)).toHaveLength(1);
  });

  it('uses CAS and body-sensitive idempotency, rechecking current authority on successful recovery replay', async () => {
    const old = await person([read, write, faePermission]), assigned = await assign(await complaint(), 'FAE', old); await end(old);
    await expect(recover(assigned.complaintId, nextFae, 0)).rejects.toMatchObject({ status: 409 });
    const key = randomUUID();
    const results = await Promise.allSettled([recover(assigned.complaintId, nextFae, 1, key), recover(assigned.complaintId, crossDepartment)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const winner = results.find(result => result.status === 'fulfilled')!.value;
    // The winning target may vary; replay its receipt only when this request won the real source-lock race.
    const receipt = await prisma.adminMutation.findFirstOrThrow({ where: { organizationId, action: 'CUSTOMER_ANALYSIS_ASSIGNED', response: { path: ['value', 'id'], equals: assigned.id } }, orderBy: { createdAt: 'desc' } });
    const targetPerson = winner.assigneeUserId === nextFae.actor.id ? nextFae : crossDepartment;
    expect(await recover(assigned.complaintId, targetPerson, 1, receipt.key)).toEqual(winner);
    await expect(recover(assigned.complaintId, targetPerson, 2, receipt.key)).rejects.toMatchObject({ status: 409 });
    await expect(recover(assigned.complaintId, reader, 1, receipt.key)).rejects.toMatchObject({ status: 403 });
    await expect(service.assign(qe.actor, assigned.complaintId, 'FAE', target(targetPerson, 1), randomUUID(), receipt.key)).rejects.toMatchObject({ status: 409 });
    for (const code of [write, 'customer-quality:complaints:reassign']) {
      await permission(qe, code, false);
      try { await expect(recover(assigned.complaintId, targetPerson, 1, receipt.key)).rejects.toMatchObject({ status: 403 }); }
      finally { await permission(qe, code, true); }
    }
    await permission(targetPerson, faePermission, false);
    try { await expect(recover(assigned.complaintId, targetPerson, 1, receipt.key)).rejects.toMatchObject({ status: 403 }); }
    finally { await permission(targetPerson, faePermission, true); }
    await prisma.session.update({ where: { id: qe.actor.sessionId }, data: { revokedAt: new Date() } });
    try { await expect(recover(assigned.complaintId, targetPerson, 1, receipt.key)).rejects.toMatchObject({ status: 401 }); }
    finally { await prisma.session.update({ where: { id: qe.actor.sessionId }, data: { revokedAt: null } }); }
    expect(await service.history(reader.actor, assigned.id)).toHaveLength(2);
    expect(await prisma.auditEvent.count({ where: { resourceId: assigned.id, action: 'CUSTOMER_ANALYSIS_ASSIGNED', outcome: 'SUCCESS' } })).toBe(2);
    expect(await service.summary(qe.actor, assigned.complaintId)).toMatchObject({ canDispatch: true, canRecoverAssignment: false });
  });
});
