import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';

if (!process.env.DATABASE_URL) throw new Error('Supplier upgrade integration requires real PostgreSQL; no skipping.');

describe('supplier BRIEF to EIGHT_D upgrade with real HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const csrf = randomUUID();

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => app?.close());

  async function fixture(withTarget = true, replyMode: 'SUPPLIER' | 'INTERNAL' = 'SUPPLIER') {
    const owner = await prisma.organization.create({ data: { code: randomUUID(), name: 'Upgrade owner', type: 'INTERNAL' } });
    const supplier = await prisma.organization.create({ data: { code: randomUUID(), name: 'Upgrade supplier', type: 'SUPPLIER' } });
    const engineer = await prisma.user.create({ data: { organizationId: owner.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    const responder = await prisma.user.create({ data: { organizationId: supplier.id, username: randomUUID(), passwordHash: 'unused', accountType: 'SUPPLIER' } });
    for (const [organization, user, codes] of [
      [owner, engineer, ['configuration:read', 'configuration:manage', 'problem-index:read', 'supplier-quality:problems:read', 'supplier-quality:problems:write', 'supplier-quality:responses:write', 'workflow:start', 'workflow:act']],
      [supplier, responder, ['supplier-quality:responses:read', 'supplier-quality:responses:write', 'workflow:act']],
    ] as const) {
      const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Upgrade role' } });
      for (const code of codes) {
        const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
        await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
      }
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: organization.id } });
    }
    const sessions = app.get(SessionService);
    const ownerCookie = `qms_session=${await sessions.create(engineer.id, prisma, { mfaVerified: true, reauthenticated: true })}; qms_csrf=${csrf}`;
    const supplierCookie = `qms_session=${await sessions.create(responder.id, prisma, { mfaVerified: true, reauthenticated: true })}; qms_csrf=${csrf}`;
    const profile = await prisma.supplierBusinessProfile.create({ data: { ownerOrganizationId: owner.id, supplierOrganizationId: supplier.id, businessCode: randomUUID(), displayName: supplier.name } });
    await app.get(NumberingService).publishRuleVersion({ organizationId: owner.id, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}', createdById: engineer.id });
    const definitions = app.get(WorkflowDefinitionService);
    async function flow(name: string) {
      const definition = await definitions.createDraft({ organizationId: owner.id, userId: engineer.id, code: randomUUID(), name, draft: {
        nodes: [
          { id: 'reply', name: 'Reply', type: 'ACTION', config: { isStart: true, slaMinutes: 90, assignment: { permission: 'supplier-quality:responses:write' } } },
          { id: 'verify', name: 'Verify', type: 'VERIFICATION', config: { assignment: { permission: 'supplier-quality:problems:write' } } },
          { id: 'close', name: 'Close', type: 'CLOSE', config: { isEnd: true, requireIndependentVerification: true, assignment: { permission: 'supplier-quality:problems:write' } } },
        ], transitions: [{ id: 'submit', from: 'reply', to: 'verify', action: 'SUBMIT' }, { id: 'verify', from: 'verify', to: 'close', action: 'VERIFY' }],
      } });
      return definitions.publishVersion({ organizationId: owner.id, userId: engineer.id, definitionId: definition.id });
    }
    const briefFlow = await flow('BRIEF workflow');
    const targetFlow = withTarget ? await flow('8D workflow') : null;
    async function binding(responseForm: 'BRIEF' | 'EIGHT_D', workflowVersionId: string) {
      await request(app.getHttpServer()).put('/api/v1/supplier-quality/workflow-bindings').set('Cookie', ownerCookie).set('x-csrf-token', csrf)
        .set('Idempotency-Key', randomUUID()).send({ severity: 'HIGH', responseForm, replyMode, expectedVersion: 0, workflowVersionId, enabled: true }).expect(200);
    }
    await binding('BRIEF', briefFlow.id);
    if (targetFlow) await binding('EIGHT_D', targetFlow.id);
    const draft = await request(app.getHttpServer()).post('/api/v1/supplier-quality/drafts').set('Cookie', ownerCookie).set('x-csrf-token', csrf)
      .set('Idempotency-Key', randomUUID()).send({ profileId: profile.id, title: 'Escalating defect', materialCode: 'MAT-UPGRADE', defectDescription: 'Unstable process', defectQuantity: 4,
        severity: 'HIGH', responseForm: 'BRIEF', replyMode, ...(replyMode === 'INTERNAL' ? { internalResponderId: engineer.id } : {}) }).expect(201);
    const issued = await request(app.getHttpServer()).post(`/api/v1/supplier-quality/drafts/${draft.body.id}/issue`).set('Cookie', ownerCookie).set('x-csrf-token', csrf)
      .set('Idempotency-Key', randomUUID()).send({ expectedVersion: draft.body.version }).expect(201);
    const evidence = replyMode === 'SUPPLIER' ? await prisma.fileObject.create({ data: { organizationId: supplier.id, objectKey: randomUUID(), originalName: 'response.pdf', contentType: 'application/pdf', sizeBytes: 12,
      sha256: 'a'.repeat(64), verifiedSha256: 'a'.repeat(64), verifiedContentType: 'application/pdf', verifiedSizeBytes: 12, objectVersionId: 'upgrade-test-version', uploadCompletedAt: new Date(),
      uploadExpiresAt: new Date(Date.now() + 60_000), scannedAt: new Date(), scannerEngine: 'ClamAV test', scanStatus: 'CLEAN', status: 'AVAILABLE', resourceType: 'supplier-quality',
      resourceId: issued.body.id, resourceVersion: issued.body.version, uploadedById: responder.id, retainUntil: new Date(Date.now() + 86_400_000) } }) : null;
    const brief = { rootCause: 'Source cause', correctiveAction: 'Source action', completionTime: '2026-09-23T08:00:00Z' };
    const responsePath = replyMode === 'SUPPLIER' ? `/api/v1/supplier-portal/problems/${issued.body.id}/actions` : `/api/v1/supplier-quality/problems/${issued.body.id}/actions`;
    await request(app.getHttpServer()).post(responsePath).set('Cookie', replyMode === 'SUPPLIER' ? supplierCookie : ownerCookie).set('x-csrf-token', csrf)
      .set('Idempotency-Key', randomUUID()).send({ expectedContentVersion: issued.body.version, content: brief,
        ...(evidence ? { evidenceFileIds: [evidence.id], evidencePurpose: 'CORRECTIVE_ACTION' } : {}) }).expect(201);
    const problem = await prisma.problemIndex.findFirstOrThrow({ where: { sourceId: issued.body.id } });
    const instance = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: problem.workflowInstanceId! } });
    const source = await prisma.supplierQualityProblem.findUniqueOrThrow({ where: { id: issued.body.id } });
    const revision = await prisma.supplierResponseRevision.findFirstOrThrow({ where: { problemId: source.id } });
    return { owner, supplier, ownerCookie, supplierCookie, problem, instance, source, revision, evidence, brief, targetFlow };
  }

  it('registers the domain adapter and upgrades identity, explicit content and evidence atomically', async () => {
    const setup = await fixture();
    await prisma.supplierResponseDraft.create({ data: { problemId: setup.source.id, content: { correctiveAction: 'Human 8D action' }, updatedById: setup.source.createdById } });
    const preview = await request(app.getHttpServer()).get(`/api/v1/problem-index/${setup.problem.id}/upgrade-preview`).set('Cookie', setup.ownerCookie).expect(200);
    expect(preview.body).toMatchObject({ canUpgrade: true, targetVersionId: setup.targetFlow!.id, expectedDomainVersion: setup.source.version,
      mappingSummary: expect.arrayContaining([{ fieldId: 'rootCause', outcome: 'COPIED' }, { fieldId: 'correctiveAction', outcome: 'PRESERVED' }]) });
    const input = { instanceId: setup.instance.id, currentNodeId: setup.instance.currentNodeId, expectedProblemVersion: setup.problem.version,
      expectedInstanceVersion: setup.instance.version, expectedDomainVersion: setup.source.version, reason: 'Escalate to 8D' };
    const key = randomUUID();
    const upgraded = await request(app.getHttpServer()).post(`/api/v1/problem-index/${setup.problem.id}/upgrade`).set('Cookie', setup.ownerCookie).set('x-csrf-token', csrf)
      .set('Idempotency-Key', key).send(input).expect(201);
    expect(upgraded.body).toMatchObject({ problemId: setup.problem.id, reportNumber: setup.problem.reportNumber, beforeInstanceId: setup.instance.id,
      beforeDomainRevisionId: setup.revision.id, domainVersion: setup.source.version + 1 });
    expect(upgraded.body.afterInstanceId).not.toBe(setup.instance.id);
    const currentIndex = await prisma.problemIndex.findUniqueOrThrow({ where: { id: setup.problem.id } });
    expect(currentIndex).toMatchObject({ reportNumber: setup.problem.reportNumber, sourceId: setup.source.id, problemType: 'EIGHT_D', workflowInstanceId: upgraded.body.afterInstanceId });
    expect(await prisma.workflowInstance.findUniqueOrThrow({ where: { id: setup.instance.id } })).toMatchObject({ status: 'CANCELLED' });
    const current = await prisma.supplierQualityProblem.findUniqueOrThrow({ where: { id: setup.source.id } });
    expect(current).toMatchObject({ responseForm: 'EIGHT_D', version: setup.source.version + 1 });
    const revisions = await prisma.supplierResponseRevision.findMany({ where: { problemId: setup.source.id }, orderBy: { revision: 'asc' }, include: { evidence: true } });
    expect(revisions).toHaveLength(2);
    expect(revisions[0]).toMatchObject({ id: setup.revision.id, content: setup.brief, evidence: [{ fileId: setup.evidence!.id }] });
    expect(revisions[1]).toMatchObject({ id: upgraded.body.afterDomainRevisionId, revision: 2,
      content: { ...setup.brief, correctiveAction: 'Human 8D action' }, evidence: [{ fileId: setup.evidence!.id, purpose: 'CORRECTIVE_ACTION' }] });
    expect(await prisma.supplierResponseDraft.findUniqueOrThrow({ where: { problemId: setup.source.id } })).toMatchObject({
      content: { ...setup.brief, correctiveAction: 'Human 8D action' }, updatedById: setup.source.createdById });
    expect(await prisma.workflowUpgrade.count({ where: { problemIndexId: setup.problem.id } })).toBe(1);
    const replay = await request(app.getHttpServer()).post(`/api/v1/problem-index/${setup.problem.id}/upgrade`).set('Cookie', setup.ownerCookie).set('x-csrf-token', csrf)
      .set('Idempotency-Key', key).send(input).expect(201);
    expect(replay.body).toEqual(upgraded.body);
    expect(await prisma.supplierResponseRevision.count({ where: { problemId: setup.source.id } })).toBe(2);
    const eightD = { problemDescription: 'Escalated defect', containmentAction: 'Contain lots', interimAction: 'Inspect all lots',
      rootCause: setup.brief.rootCause, correctiveAction: 'Human 8D action', preventiveAction: 'Add control', verificationResult: 'Samples passed' };
    await request(app.getHttpServer()).post(`/api/v1/supplier-portal/problems/${setup.source.id}/actions`).set('Cookie', setup.supplierCookie)
      .set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedContentVersion: current.version, content: eightD,
        evidenceFileIds: [setup.evidence!.id], evidencePurpose: 'EIGHT_D_RESPONSE' }).expect(201);
    const submitted = await prisma.supplierResponseRevision.findFirstOrThrow({ where: { problemId: setup.source.id }, orderBy: { revision: 'desc' }, include: { evidence: true } });
    expect(submitted).toMatchObject({ revision: 3, content: eightD, evidence: [{ fileId: setup.evidence!.id, purpose: 'EIGHT_D_RESPONSE' }] });
  });

  it('refuses upgrade without an enabled EIGHT_D binding and denies supplier actors', async () => {
    const setup = await fixture(false);
    await request(app.getHttpServer()).get(`/api/v1/problem-index/${setup.problem.id}/upgrade-preview`).set('Cookie', setup.supplierCookie).expect(404);
    const preview = await request(app.getHttpServer()).get(`/api/v1/problem-index/${setup.problem.id}/upgrade-preview`).set('Cookie', setup.ownerCookie).expect(409);
    expect(preview.body.code).toBe('SUPPLIER_WORKFLOW_CONFIGURATION_REQUIRED');
    expect(await prisma.workflowUpgrade.count({ where: { problemIndexId: setup.problem.id } })).toBe(0);
  });

  it('upgrades an internal-response problem and keeps mapped content editable in the new reply draft', async () => {
    const setup = await fixture(true, 'INTERNAL');
    expect(setup.source.releasedToSupplierAt).toBeNull();
    await prisma.supplierResponseDraft.create({ data: { problemId: setup.source.id, content: { rootCause: 'Engineer investigation' }, updatedById: setup.source.createdById } });
    const preview = await request(app.getHttpServer()).get(`/api/v1/problem-index/${setup.problem.id}/upgrade-preview`).set('Cookie', setup.ownerCookie).expect(200);
    expect(preview.body).toMatchObject({ canUpgrade: true, mappingSummary: expect.arrayContaining([
      { fieldId: 'rootCause', outcome: 'PRESERVED' }, { fieldId: 'correctiveAction', outcome: 'COPIED' }]) });
    const input = { instanceId: setup.instance.id, currentNodeId: setup.instance.currentNodeId, expectedProblemVersion: setup.problem.version,
      expectedInstanceVersion: setup.instance.version, expectedDomainVersion: setup.source.version, reason: 'Internal 8D escalation' };
    const upgraded = await request(app.getHttpServer()).post(`/api/v1/problem-index/${setup.problem.id}/upgrade`).set('Cookie', setup.ownerCookie).set('x-csrf-token', csrf)
      .set('Idempotency-Key', randomUUID()).send(input).expect(201);
    const content = { ...setup.brief, rootCause: 'Engineer investigation' };
    expect(await prisma.supplierResponseRevision.findUniqueOrThrow({ where: { id: upgraded.body.afterDomainRevisionId } })).toMatchObject({ content });
    expect(await prisma.supplierResponseDraft.findUniqueOrThrow({ where: { problemId: setup.source.id } })).toMatchObject({ content });
    const detail = await request(app.getHttpServer()).get(`/api/v1/supplier-quality/problems/${setup.source.id}`).set('Cookie', setup.ownerCookie).expect(200);
    expect(detail.body).toMatchObject({ responseForm: 'EIGHT_D', canEditResponse: true, responseDraft: content });
    expect(await prisma.supplierEvidenceReference.count({ where: { problemId: setup.source.id } })).toBe(0);
  });
});
