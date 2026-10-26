import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowClosureTemplateService } from '../../src/modules/workflow/workflow-closure-template.service.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import { FileScanWorkerService } from '../../src/modules/file-management/file-scan-worker.service.js';
import { FileVerificationService } from '../../src/modules/file-management/file-verification.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { ProcessEightDService } from '../../src/modules/process-quality/process-eight-d.service.js';
import { emptyProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import { createWorkflowClosureFixture } from '../workflow/workflow-closure-round.fixture.js';
import { requireDisposableProcessEightDDatabase } from './process-eight-d-task.fixture.js';
import { png } from './process-eight-d-pdf.fixture.js';

requireDisposableProcessEightDDatabase();

describe('complete process 8D HTTP chain with actual versioned storage and ClamAV', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  it('registers, issues, scans, submits, joins actual reviews and exports the immutable approved PDF', async () => {
    const prisma = app.get(PrismaService);
    const rounds = app.get(WorkflowClosureRoundService);
    const f = await createWorkflowClosureFixture(prisma, rounds);
    const codes = ['configuration:read', 'configuration:manage', 'workflow:manage', 'workflow:start', 'task:read', 'notification:read',
      'process-quality:defects:read', 'process-quality:defects:write', 'process-quality:defects:close',
      ...['read', 'work', 'issue', 'report', 'sources', 'risk', 'reassign', 'deadlines'].map(action => `process-quality:issues:${action}`)];
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
    expect(permissions).toHaveLength(codes.length);
    await prisma.rolePermission.createMany({ data: permissions.map(permission => ({ roleId: f.role.id, permissionId: permission.id })), skipDuplicates: true });
    const csrf = randomUUID();
    const cookie = async (person: typeof f.owner) => {
      const token = await app.get(SessionService).create(person.user.id, prisma, { reauthenticated: true, mfaVerified: true });
      person.actor.sessionId = (await prisma.session.findUniqueOrThrow({ where: { tokenHash: createHash('sha256').update(token).digest('hex') } })).id;
      return `qms_session=${token}; qms_csrf=${csrf}`;
    };
    const issuerCookie = await cookie(f.professional), ownerCookie = await cookie(f.owner), managerCookie = await cookie(f.manager);
    const send = (who: string, method: 'post' | 'put', path: string, body: object) => request(app.getHttpServer())[method](`/api/v1/${path}`)
      .set('Cookie', who).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(body);
    const get = (who: string, path: string) => request(app.getHttpServer()).get(`/api/v1/${path}`).set('Cookie', who);
    const unconfigured = await get(issuerCookie, 'process-quality/eight-d/binding').expect(200).expect('content-type', /application\/json/);
    expect(unconfigured.text).toBe('null');
    await app.get(NumberingService).publishRuleVersion({ organizationId: f.org.id, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}' });
    const template = await app.get(WorkflowClosureTemplateService).initialize(f.professional.actor,
      { policy: 'INTERNAL', domainCode: 'process-quality', code: randomUUID(), name: 'Actual process chain' }, randomUUID(), randomUUID());
    const published = await app.get(WorkflowDefinitionService).publishVersion({ organizationId: f.org.id, userId: f.professional.user.id,
      actor: f.professional.actor, definitionId: template.id, expectedRevision: template.revision, draftVersionId: template.version.id });
    const core = app.get(ProcessEightDService);
    await core.bind(f.professional.actor, { expectedVersion: 0, workflowDefinitionId: template.id, workflowVersionId: published.id }, randomUUID(), randomUUID());
    const binding = await core.binding(f.professional.actor);
    if (!binding) throw new Error('The actual workflow binding was not persisted');
    await core.activate(f.professional.actor, { expectedVersion: binding.version, enabled: true }, randomUUID(), randomUUID());
    const source = (await send(issuerCookie, 'post', 'process-quality/defects', { description: '真实HTTP来源，未知数量不伪造' }).expect(201)).body;
    const issued = (await send(issuerCookie, 'post', 'process-quality/eight-d', { sources: [{ defectId: source.id, expectedVersion: source.version }],
      severity: 'LOW', responsibleSectionDepartmentId: f.section.id, ownerUserId: f.owner.user.id,
      analysisDueAt: '2026-11-01T00:00:00Z', closureDueAt: '2026-12-01T00:00:00Z' }).expect(201)).body;
    const id = issued.problem.id;
    await get(ownerCookie, 'process-quality/eight-d/tasks').expect(200);
    await get(ownerCookie, 'process-quality/eight-d/notifications').expect(200);
    const prefix = `process-quality/eight-d/${id}`;
    const upload = (await send(ownerCookie, 'post', 'files/uploads', { resourceType: 'process-eight-d', resourceId: id,
      originalName: 'real-ok.png', contentType: 'image/png', sizeBytes: png.length, sha256: createHash('sha256').update(png).digest('hex') }).expect(201)).body;
    expect((await fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body: png })).status).toBe(200);
    await send(ownerCookie, 'post', `files/${upload.file.id}/complete`, { expectedVersion: upload.file.version }).expect(202);
    const [{ now }] = await prisma.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS "now"`;
    const offset = now.getTime() - Date.now() + 1000;
    const scanner = new FileScanWorkerService(prisma, app.get(FileVerificationService), app.get(AuditLogService), () => new Date(Date.now() + offset));
    await scanner.processDue(100);
    expect((await get(ownerCookie, `files/${upload.file.id}`).expect(200)).body).toMatchObject({ status: 'AVAILABLE', scanStatus: 'CLEAN' });
    const grant = (await send(ownerCookie, 'post', `files/${upload.file.id}/download`, {}).expect(201)).body;
    const original = await fetch(grant.url);
    expect(original.status).toBe(200);
    expect(original.headers.get('content-type')).toContain('application/octet-stream');
    expect(createHash('sha256').update(Buffer.from(await original.arrayBuffer())).digest('hex')).toBe(createHash('sha256').update(png).digest('hex'));
    const document = emptyProcessEightDDocument();
    document.description = '压装开裂：实际OK/NG佐证'; document.okFileIds = [upload.file.id];
    document.analysisProcess = '对照工艺参数并复查检验覆盖'; document.occurrenceCause = '发生原因'; document.escapeCause = '流出原因';
    document.correctiveActions = (['OCCURRENCE', 'ESCAPE'] as const).map((causeKind, index) => ({ id: `chain-${index}`, causeKind,
      action: '实施已确认对策', owner: '实际责任人', plannedAt: '2026-10-25', verificationMethod: '按实测标准验证', fileIds: [],
      implementationAt: '2026-10-25', result: '实施完成', beforeState: '改善前开裂', afterState: '改善后符合', firstBatch: `ACTUAL-${index}`,
      followUpBatchCount: 3, followUpDuration: '', verificationRecord: '跟进三批符合标准', verificationFileIds: [], effective: true }));
    let current = (await get(ownerCookie, prefix).expect(200)).body;
    current = (await send(ownerCookie, 'put', prefix, { expectedVersion: current.version, document }).expect(200)).body;
    current = (await send(ownerCookie, 'post', `${prefix}/analysis-complete`, { expectedVersion: current.version, submissionDueAt: '2026-11-10T00:00:00Z' }).expect(200)).body;
    current = (await send(ownerCookie, 'post', `${prefix}/submit`, { expectedVersion: current.version }).expect(200)).body;
    expect(current.status).toBe('IN_REVIEW');
    await send(ownerCookie, 'put', prefix, { expectedVersion: current.version, document }).expect(409);
    let round = (await get(ownerCookie, `workflow-closure/problems/${id}/rounds`).expect(200)).body[0];
    round = (await send(issuerCookie, 'post', `workflow-closure/rounds/${round.id}/decide`, { expectedRoundVersion: round.version,
      duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: '分析、对策及有效性已确认' }).expect(200)).body;
    expect((await get(ownerCookie, prefix).expect(200)).body.status).toBe('IN_REVIEW');
    await send(managerCookie, 'post', `workflow-closure/rounds/${round.id}/decide`, { expectedRoundVersion: round.version,
      duties: ['SECTION_MANAGER'], decision: 'APPROVE', comment: '管理侧同意关闭' }).expect(200);
    expect((await get(ownerCookie, prefix).expect(200)).body.status).toBe('CLOSED');
    const approved = (await get(ownerCookie, `${prefix}/report?view=APPROVED`).expect(200)).body;
    expect(approved).toMatchObject({ status: 'APPROVED', view: 'APPROVED', snapshot: { document: { description: document.description } } });
    expect(approved.attachments[0]).toMatchObject({ id: upload.file.id, rendering: 'EMBEDDED' });
    const pdf = await get(ownerCookie, `${prefix}/report/pdf?view=APPROVED`).expect(200).expect('content-type', /application\/pdf/);
    expect(Buffer.isBuffer(pdf.body)).toBe(true);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(JSON.stringify(approved)).not.toContain('"objectKey"');
  }, 120_000);

  it('locates incomplete HTTP submissions without writes and keeps independent same-section reassignment separate from internal routes', async () => {
    const prisma = app.get(PrismaService), core = app.get(ProcessEightDService);
    const f = await createWorkflowClosureFixture(prisma, app.get(WorkflowClosureRoundService));
    const codes = ['configuration:read', 'configuration:manage', 'workflow:manage', 'workflow:start',
      'process-quality:defects:read', 'process-quality:defects:write',
      ...['read', 'work', 'issue'].map(action => `process-quality:issues:${action}`)];
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
    expect(permissions).toHaveLength(codes.length);
    await prisma.rolePermission.createMany({ data: permissions.map(p => ({ roleId: f.role.id, permissionId: p.id })), skipDuplicates: true });
    const independent = await f.person(f.dept.id), crossSection = await prisma.department.create({ data: {
      organizationId: f.org.id, parentId: f.dept.id, code: randomUUID(), name: 'Other section' } });
    const crossOwner = await f.person(crossSection.id);
    const reassignPermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'process-quality:issues:reassign' } });
    const readPermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'process-quality:issues:read' } });
    const independentRole = await prisma.role.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'Independent reassignment',
      permissions: { create: [readPermission, reassignPermission].map(p => ({ permissionId: p.id })) } } });
    await prisma.userRole.deleteMany({ where: { userId: independent.user.id } });
    await prisma.userRole.create({ data: { organizationId: f.org.id, userId: independent.user.id, roleId: independentRole.id } });
    const csrf = randomUUID();
    const cookie = async (person: typeof f.owner) => {
      const token = await app.get(SessionService).create(person.user.id, prisma, { reauthenticated: true, mfaVerified: true });
      person.actor.sessionId = (await prisma.session.findUniqueOrThrow({ where: { tokenHash: createHash('sha256').update(token).digest('hex') } })).id;
      return `qms_session=${token}; qms_csrf=${csrf}`;
    };
    const issuerCookie = await cookie(f.professional), ownerCookie = await cookie(f.owner), independentCookie = await cookie(independent);
    const managerCookie = await cookie(f.manager), ministerCookie = await cookie(f.minister);
    const send = (who: string, method: 'post' | 'put', path: string, body: object, key = randomUUID()) => request(app.getHttpServer())[method](`/api/v1/${path}`)
      .set('Cookie', who).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
    const get = (who: string, path: string) => request(app.getHttpServer()).get(`/api/v1/${path}`).set('Cookie', who);
    await app.get(NumberingService).publishRuleVersion({ organizationId: f.org.id, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}' });
    const template = await app.get(WorkflowClosureTemplateService).initialize(f.professional.actor,
      { policy: 'INTERNAL', domainCode: 'process-quality', code: randomUUID(), name: 'Validation seam' }, randomUUID(), randomUUID());
    const published = await app.get(WorkflowDefinitionService).publishVersion({ organizationId: f.org.id, userId: f.professional.user.id,
      actor: f.professional.actor, definitionId: template.id, expectedRevision: template.revision, draftVersionId: template.version.id });
    const binding = await core.bind(f.professional.actor, { expectedVersion: 0, workflowDefinitionId: template.id, workflowVersionId: published.id }, randomUUID(), randomUUID());
    expect(binding).toMatchObject({ version: 1 });
    await core.activate(f.professional.actor, { expectedVersion: 1, enabled: true }, randomUUID(), randomUUID());
    const source = (await send(issuerCookie, 'post', 'process-quality/defects', { description: 'Missing fields and exact reassignment seam' }).expect(201)).body;
    const issued = (await send(issuerCookie, 'post', 'process-quality/eight-d', { sources: [{ defectId: source.id, expectedVersion: source.version }],
      severity: 'LOW', responsibleSectionDepartmentId: f.section.id, ownerUserId: f.owner.user.id,
      analysisDueAt: '2026-11-01T00:00:00Z', closureDueAt: '2026-12-01T00:00:00Z' }).expect(201)).body;
    const id = issued.problem.id, prefix = `process-quality/eight-d/${id}`;
    let current = (await get(ownerCookie, prefix).expect(200)).body;
    const document = emptyProcessEightDDocument();
    document.occurrenceCause = '发生因'; document.escapeCause = '流出因';
    document.correctiveActions = (['OCCURRENCE', 'ESCAPE'] as const).map((causeKind, i) => ({ id: `action-${i}`, causeKind,
      action: '改善措施', owner: '实际负责人', plannedAt: '2026-11-01', verificationMethod: '实测', fileIds: [], implementationAt: null,
      result: '', beforeState: '', afterState: '', firstBatch: '', followUpBatchCount: null, followUpDuration: '',
      verificationRecord: '', verificationFileIds: [], effective: null }));
    current = (await send(ownerCookie, 'put', prefix, { expectedVersion: current.version, document }).expect(200)).body;
    current = (await send(ownerCookie, 'post', `${prefix}/analysis-complete`, { expectedVersion: current.version, submissionDueAt: '2026-11-10T00:00:00Z' }).expect(200)).body;
    const snapshot = async () => ({
      report: (await get(ownerCookie, prefix).expect(200)).body,
      instance: await prisma.workflowInstance.findUniqueOrThrow({ where: { id: current.instanceId } }),
      problem: await prisma.problemIndex.findUniqueOrThrow({ where: { id } }),
      audits: await prisma.auditEvent.count({ where: { organizationId: f.org.id } }),
      outbox: await prisma.outboxEvent.count({ where: { aggregateId: id } }),
      receipts: await prisma.$queryRaw`SELECT key, digest, response FROM process_eight_d_receipts WHERE organization_id = ${f.org.id}::uuid ORDER BY actor_user_id, key`,
      rounds: await prisma.$queryRaw`SELECT id, version FROM workflow_closure_rounds WHERE problem_id = ${id}::uuid ORDER BY id`,
      revisions: await prisma.$queryRaw`SELECT id FROM process_eight_d_revisions WHERE problem_id = ${id}::uuid ORDER BY id`,
    });
    const before = await snapshot();
    const rejected = (await send(ownerCookie, 'post', `${prefix}/submit`, { expectedVersion: current.version }).expect(400)).body;
    expect(rejected).toMatchObject({ code: 'PROCESS_EIGHT_D_SUBMISSION_INCOMPLETE', fields: {
      'correctiveActions[0].firstBatch': ['请填写实际实施及验证记录'],
      'correctiveActions[0].effective': ['必须人工明确确认措施验证有效'],
    } });
    expect(await snapshot()).toEqual(before);
    const candidates = (who: string, sectionDepartmentId?: string) => get(who, 'process-quality/eight-d/assignment-options')
      .query({ action: 'REASSIGN', problemId: id, ...(sectionDepartmentId ? { sectionDepartmentId } : {}) });
    for (const sectionId of [undefined, f.section.id, crossSection.id]) {
      const result = (await candidates(independentCookie, sectionId).expect(200)).body;
      expect(result.departments.map((d: { id: string }) => d.id)).toContain(crossSection.id);
      if (sectionId) expect(result.users.map((u: { id: string }) => u.id)).toContain(sectionId === f.section.id ? f.owner.user.id : crossOwner.user.id);
    }
    for (const who of [ownerCookie, managerCookie, ministerCookie]) {
      const result = (await candidates(who).expect(200)).body;
      expect(result.departments.map((d: { id: string }) => d.id)).toEqual([f.section.id]);
      expect(result.departmentTotal).toBe(1);
      await candidates(who, crossSection.id).expect(403);
    }
    const key = randomUUID(), reassignment = { expectedVersion: current.version, ownerUserId: f.manager.user.id, responsibleSectionDepartmentId: f.section.id };
    current = (await send(independentCookie, 'put', `${prefix}/reassign`, reassignment, key).expect(200)).body;
    expect(current.ownerUserId).toBe(f.manager.user.id);
    expect((await send(independentCookie, 'put', `${prefix}/reassign`, reassignment, key).expect(200)).body).toEqual(current);
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: independentRole.id, permissionId: reassignPermission.id } } });
    await send(independentCookie, 'put', `${prefix}/reassign`, reassignment, key).expect(403);
    await prisma.rolePermission.create({ data: { roleId: independentRole.id, permissionId: reassignPermission.id } });
    current = (await send(independentCookie, 'put', `${prefix}/reassign`, { expectedVersion: current.version,
      ownerUserId: crossOwner.user.id, responsibleSectionDepartmentId: crossSection.id }).expect(200)).body;
    expect(current).toMatchObject({ ownerUserId: crossOwner.user.id, responsibleSectionDepartmentId: crossSection.id });
    await prisma.session.update({ where: { id: independent.actor.sessionId }, data: { revokedAt: new Date() } });
    await candidates(independentCookie, crossSection.id).expect(401);
  }, 120_000);
});
