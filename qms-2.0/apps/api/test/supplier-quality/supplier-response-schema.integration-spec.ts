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

if (!process.env.DATABASE_URL) throw new Error('Supplier response integration requires real PostgreSQL; no skipping.');

describe('supplier response submission with real HTTP and PostgreSQL', () => {
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

  async function context() {
    const owner = await prisma.organization.create({ data: { code: randomUUID(), name: 'Response owner', type: 'INTERNAL' } });
    const supplier = await prisma.organization.create({ data: { code: randomUUID(), name: 'Response supplier', type: 'SUPPLIER' } });
    const ownerUser = await prisma.user.create({ data: { organizationId: owner.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    const verifierUser = await prisma.user.create({ data: { organizationId: owner.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    const supplierUser = await prisma.user.create({ data: { organizationId: supplier.id, username: randomUUID(), passwordHash: 'unused', accountType: 'SUPPLIER' } });
    for (const [organization, users, codes] of [
      [owner, [ownerUser, verifierUser], ['configuration:read', 'configuration:manage', 'supplier-quality:problems:read', 'supplier-quality:problems:write', 'workflow:start', 'workflow:act']],
      [supplier, [supplierUser], ['supplier-quality:responses:read', 'supplier-quality:responses:write', 'workflow:act']],
    ] as const) {
      for (const user of users) {
        const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Response test role' } });
        for (const code of codes) {
          const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
          await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
        }
        await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: organization.id } });
      }
    }
    const ownerToken = await app.get(SessionService).create(ownerUser.id, prisma, { mfaVerified: true, reauthenticated: true });
    const verifierToken = await app.get(SessionService).create(verifierUser.id, prisma, { mfaVerified: true, reauthenticated: true });
    const supplierToken = await app.get(SessionService).create(supplierUser.id, prisma, { mfaVerified: true, reauthenticated: true });
    const profile = await prisma.supplierBusinessProfile.create({ data: { ownerOrganizationId: owner.id, supplierOrganizationId: supplier.id, businessCode: randomUUID(), displayName: supplier.name } });
    await app.get(NumberingService).publishRuleVersion({ organizationId: owner.id, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}', createdById: ownerUser.id });
    return { owner, supplier, ownerUserId: ownerUser.id, verifierUserId: verifierUser.id, supplierUserId: supplierUser.id, profile, ownerCookie: 'qms_session=' + ownerToken + '; qms_csrf=' + csrf, verifierCookie: 'qms_session=' + verifierToken + '; qms_csrf=' + csrf, supplierCookie: 'qms_session=' + supplierToken + '; qms_csrf=' + csrf };
  }

  async function flow(owner: Awaited<ReturnType<typeof context>>) {
    const definitions = app.get(WorkflowDefinitionService);
    const ownerUser = await prisma.user.findFirstOrThrow({ where: { organizationId: owner.owner.id } });
    const definition = await definitions.createDraft({ organizationId: owner.owner.id, userId: ownerUser.id, code: randomUUID(), name: 'Supplier response flow', draft: {
      nodes: [
        { id: 'reply', name: 'Reply', type: 'ACTION', config: { isStart: true, slaMinutes: 90, assignment: { permission: 'supplier-quality:responses:write' } } },
        { id: 'verify', name: 'Verify', type: 'VERIFICATION', config: { assignment: { permission: 'supplier-quality:problems:write' } } },
        { id: 'close', name: 'Close', type: 'CLOSE', config: { isEnd: true, requireIndependentVerification: true, assignment: { permission: 'supplier-quality:problems:write' } } },
      ], transitions: [
        { id: 'reply', from: 'reply', to: 'verify', action: 'SUBMIT' },
        { id: 'verify', from: 'verify', to: 'close', action: 'VERIFY' },
        { id: 'return', from: 'verify', to: 'reply', action: 'RETURN' },
        { id: 'reject', from: 'verify', to: 'reply', action: 'REJECT' },
        { id: 'reopen', from: 'close', to: 'reply', action: 'REOPEN' },
      ],
    } });
    return definitions.publishVersion({ organizationId: owner.owner.id, userId: ownerUser.id, definitionId: definition.id });
  }

  async function prepare(owner: Awaited<ReturnType<typeof context>>) {
    const version = await flow(owner);
    await request(app.getHttpServer()).put('/api/v1/supplier-quality/workflow-bindings').set('Cookie', owner.ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ severity: 'HIGH', responseForm: 'BRIEF', replyMode: 'SUPPLIER', expectedVersion: 0, workflowVersionId: version.id, enabled: true }).expect(200);
    const draft = await request(app.getHttpServer()).post('/api/v1/supplier-quality/drafts').set('Cookie', owner.ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ profileId: owner.profile.id, title: 'Problem awaiting response', materialCode: 'MAT-RESPONSE', defectDescription: 'Batch defect detected', defectQuantity: 4, severity: 'HIGH', responseForm: 'BRIEF', replyMode: 'SUPPLIER' }).expect(201);
    const issued = await request(app.getHttpServer()).post('/api/v1/supplier-quality/drafts/' + draft.body.id + '/issue').set('Cookie', owner.ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: draft.body.version }).expect(201);
    return issued.body as { id: string; version: number };
  }

  it('submits one immutable revision, advances the workflow and rejects replay payload changes', async () => {
    const owner = await context();
    const issued = await prepare(owner);
    const replyDetail = await request(app.getHttpServer()).get('/api/v1/supplier-portal/problems/' + issued.id).set('Cookie', owner.supplierCookie).expect(200);
    expect(replyDetail.body).toMatchObject({ availableActions: ['SUBMIT'], actionUnavailableReason: null, currentWorkflowNode: { type: 'ACTION' }, responseHistory: { items: [], total: 0, page: 1, pageSize: 20 }, currentVerification: { status: 'NOT_VERIFIED' } });
    expect(replyDetail.body.currentWorkflowNode).not.toHaveProperty('id');
    expect(replyDetail.body).not.toHaveProperty('problemIndexId');
    expect(replyDetail.body).not.toHaveProperty('latestResponseRevision');
    const key = randomUUID();
    const content = { rootCause: 'Process parameter drift', correctiveAction: 'Recalibrate and add first-article confirmation', completionTime: '2026-09-23T08:00:00Z' };
    const evidenceFile = await prisma.fileObject.create({ data: { organizationId: owner.supplier.id, objectKey: randomUUID(), originalName: 'corrective-action.pdf', contentType: 'application/pdf', sizeBytes: 12, sha256: 'a'.repeat(64), verifiedSha256: 'a'.repeat(64), verifiedContentType: 'application/pdf', verifiedSizeBytes: 12, objectVersionId: 'supplier-response-version-1', uploadCompletedAt: new Date(), uploadExpiresAt: new Date(Date.now() + 60_000), scannedAt: new Date(), scannerEngine: 'ClamAV test', scanStatus: 'CLEAN', status: 'AVAILABLE', resourceType: 'supplier-quality', resourceId: issued.id, resourceVersion: issued.version, uploadedById: owner.supplierUserId, retainUntil: new Date(Date.now() + 86_400_000) } });
    const submitted = await request(app.getHttpServer()).post('/api/v1/supplier-portal/problems/' + issued.id + '/actions').set('Cookie', owner.supplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send({ expectedContentVersion: issued.version, content, evidenceFileIds: [evidenceFile.id], evidencePurpose: 'CORRECTIVE_ACTION' });
    expect(submitted.status).toBe(201);
    expect(submitted.body).toMatchObject({ id: issued.id, stage: 'ISSUED', canEditResponse: false, responseDraft: {} });
    const revision = await prisma.supplierResponseRevision.findFirstOrThrow({ where: { problemId: issued.id } });
    expect(revision).toMatchObject({ problemId: issued.id, revision: 1, content, submittedById: expect.any(String) });
    expect(await prisma.supplierEvidenceReference.findMany({ where: { problemId: issued.id, revisionId: revision.id } })).toMatchObject([{ fileId: evidenceFile.id, purpose: 'CORRECTIVE_ACTION' }]);
    expect(await prisma.supplierResponseDraft.count({ where: { problemId: issued.id } })).toBe(0);
    const supplierDetail = await request(app.getHttpServer()).get('/api/v1/supplier-portal/problems/' + issued.id).set('Cookie', owner.supplierCookie).expect(200);
    expect(supplierDetail.body).toMatchObject({ availableActions: [], actionUnavailableReason: 'WORKFLOW_NODE_FORBIDDEN', currentVerification: { status: 'NOT_VERIFIED' }, responseHistory: { total: 1, items: [{ id: revision.id, revision: 1, content, evidence: [{ fileId: evidenceFile.id }] }] }, latestResponseRevision: { id: revision.id, revision: 1, content, evidence: [{ fileId: evidenceFile.id, purpose: 'CORRECTIVE_ACTION', originalName: 'corrective-action.pdf', status: 'AVAILABLE', scanStatus: 'CLEAN', downloadable: true }] } });
    expect(supplierDetail.body.currentWorkflowNode).toEqual({ type: 'VERIFICATION' });
    expect(supplierDetail.body).not.toHaveProperty('problemIndexId');
    const internalDetail = await request(app.getHttpServer()).get('/api/v1/supplier-quality/problems/' + issued.id).set('Cookie', owner.ownerCookie).expect(200);
    expect(internalDetail.body).toMatchObject({ problemIndexId: expect.any(String), availableActions: expect.arrayContaining(['VERIFY', 'RETURN', 'REJECT']), currentWorkflowNode: { type: 'VERIFICATION', name: 'Verify', id: expect.any(String) }, latestResponseRevision: { id: revision.id, content } });
    await prisma.fileObject.update({ where: { id: evidenceFile.id }, data: { status: 'QUARANTINED', scanStatus: 'PENDING' } });
    const scanningDetail = await request(app.getHttpServer()).get('/api/v1/supplier-portal/problems/' + issued.id).set('Cookie', owner.supplierCookie).expect(200);
    expect(scanningDetail.body.latestResponseRevision.evidence).toMatchObject([{ fileId: evidenceFile.id, downloadable: false, scanStatus: 'PENDING' }]);
    const index = await prisma.problemIndex.findFirstOrThrow({ where: { sourceId: issued.id } });
    expect(index.status).toBe('PENDING');
    const instance = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: index.workflowInstanceId! }, include: { currentNode: true } });
    expect(instance.currentNode?.name).toBe('Verify');
    const replay = await request(app.getHttpServer()).post('/api/v1/supplier-portal/problems/' + issued.id + '/actions').set('Cookie', owner.supplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send({ expectedContentVersion: issued.version, content, evidenceFileIds: [evidenceFile.id], evidencePurpose: 'CORRECTIVE_ACTION' });
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(submitted.body);
    expect(await prisma.supplierResponseRevision.count({ where: { problemId: issued.id } })).toBe(1);
    await request(app.getHttpServer()).post('/api/v1/supplier-portal/problems/' + issued.id + '/actions').set('Cookie', owner.supplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send({ expectedContentVersion: issued.version, content: { ...content, rootCause: 'Changed with same key' } }).expect(409);
  });

  it('rejects saving a response draft after the reply node has advanced', async () => {
    const owner = await context();
    const issued = await prepare(owner);
    const content = { rootCause: 'Root cause', correctiveAction: 'Corrective action', completionTime: '2026-09-23T08:00:00Z' };
    await request(app.getHttpServer()).post('/api/v1/supplier-portal/problems/' + issued.id + '/actions').set('Cookie', owner.supplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedContentVersion: issued.version, content }).expect(201);
    await request(app.getHttpServer()).put('/api/v1/supplier-portal/problems/' + issued.id + '/response-draft').set('Cookie', owner.supplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: issued.version + 1, content: { rootCause: 'Must not save' } }).expect(409);
  });

  it('persists verification and requires a different internal user to close', async () => {
    const owner = await context();
    const issued = await prepare(owner);
    const content = { rootCause: 'Root cause', correctiveAction: 'Corrective action', completionTime: '2026-09-23T08:00:00Z' };
    const submitted = await request(app.getHttpServer()).post('/api/v1/supplier-portal/problems/' + issued.id + '/actions').set('Cookie', owner.supplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedContentVersion: issued.version, content }).expect(201);
    const verifyKey = randomUUID();
    await request(app.getHttpServer()).post('/api/v1/supplier-quality/problems/' + issued.id + '/workflow-actions').set('Cookie', owner.verifierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', verifyKey).send({ action: 'VERIFY', expectedContentVersion: submitted.body.version, accepted: true }).expect(200);
    const verifierDetail = await request(app.getHttpServer()).get('/api/v1/supplier-quality/problems/' + issued.id).set('Cookie', owner.verifierCookie).expect(200);
    expect(verifierDetail.body.currentVerification).toMatchObject({ status: 'ACCEPTED', verifierId: owner.verifierUserId, revisionId: expect.any(String) });
    expect(verifierDetail.body.availableActions).not.toContain('CLOSE');
    expect(verifierDetail.body.actionUnavailableReason).toBe('WORKFLOW_INDEPENDENT_VERIFICATION_REQUIRED');
    const closerDetail = await request(app.getHttpServer()).get('/api/v1/supplier-quality/problems/' + issued.id).set('Cookie', owner.ownerCookie).expect(200);
    expect(closerDetail.body.availableActions).toContain('CLOSE');
    const portalDetail = await request(app.getHttpServer()).get('/api/v1/supplier-portal/problems/' + issued.id).set('Cookie', owner.supplierCookie).expect(200);
    expect(portalDetail.body.currentVerification).toMatchObject({ status: 'ACCEPTED', revisionId: expect.any(String) });
    expect(portalDetail.body.currentVerification).not.toHaveProperty('verifierId');
    await request(app.getHttpServer()).post('/api/v1/supplier-quality/problems/' + issued.id + '/workflow-actions').set('Cookie', owner.verifierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ action: 'CLOSE', expectedContentVersion: submitted.body.version }).expect(403);
    const replay = await request(app.getHttpServer()).post('/api/v1/supplier-quality/problems/' + issued.id + '/workflow-actions').set('Cookie', owner.verifierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', verifyKey).send({ action: 'VERIFY', expectedContentVersion: submitted.body.version, accepted: true }).expect(200);
    expect(replay.body.id).toBe(issued.id);
    await request(app.getHttpServer()).post('/api/v1/supplier-quality/problems/' + issued.id + '/workflow-actions').set('Cookie', owner.verifierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', verifyKey).send({ action: 'VERIFY', expectedContentVersion: submitted.body.version, accepted: false }).expect(400);
    const closed = await request(app.getHttpServer()).post('/api/v1/supplier-quality/problems/' + issued.id + '/workflow-actions').set('Cookie', owner.ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ action: 'CLOSE', expectedContentVersion: submitted.body.version }).expect(200);
    expect(closed.body.problemStatus).toBe('CLOSED');
    const verification = await prisma.supplierVerification.findFirstOrThrow({ where: { problemId: issued.id }, orderBy: { createdAt: 'desc' } });
    expect(verification).toMatchObject({ problemId: issued.id, verifierId: expect.any(String), contentVersion: submitted.body.version, accepted: true });
  });

  it('scopes the detail read model to the associated enterprise and current read grant', async () => {
    const owner = await context();
    const issued = await prepare(owner);
    const other = await context();
    await request(app.getHttpServer()).get('/api/v1/supplier-portal/problems/' + issued.id).set('Cookie', other.supplierCookie).expect(404);
    await request(app.getHttpServer()).get('/api/v1/supplier-quality/problems/' + issued.id).set('Cookie', other.ownerCookie).expect(404);
    const role = await prisma.userRole.findFirstOrThrow({ where: { userId: owner.supplierUserId, organizationId: owner.supplier.id } });
    const readPermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:responses:read' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.roleId, permissionId: readPermission.id } } });
    await request(app.getHttpServer()).get('/api/v1/supplier-portal/problems/' + issued.id).set('Cookie', owner.supplierCookie).expect(403);
  });

  it.each(['RETURN', 'REJECT'] as const)('%s sends the problem back for a new immutable response with CAS and replay protection', async (action) => {
    const owner = await context();
    const issued = await prepare(owner);
    const evidenceFile = await prisma.fileObject.create({ data: { organizationId: owner.supplier.id, objectKey: randomUUID(), originalName: 'initial-evidence.pdf', contentType: 'application/pdf', sizeBytes: 12, sha256: 'b'.repeat(64), verifiedSha256: 'b'.repeat(64), verifiedContentType: 'application/pdf', verifiedSizeBytes: 12, objectVersionId: 'supplier-response-history-version-1', uploadCompletedAt: new Date(), uploadExpiresAt: new Date(Date.now() + 60_000), scannedAt: new Date(), scannerEngine: 'ClamAV test', scanStatus: 'CLEAN', status: 'AVAILABLE', resourceType: 'supplier-quality', resourceId: issued.id, resourceVersion: issued.version, uploadedById: owner.supplierUserId, retainUntil: new Date(Date.now() + 86_400_000) } });
    const firstContent = { rootCause: 'Initial cause', correctiveAction: 'Initial action', completionTime: '2026-09-23T08:00:00Z' };
    const first = await request(app.getHttpServer()).post('/api/v1/supplier-portal/problems/' + issued.id + '/actions').set('Cookie', owner.supplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedContentVersion: issued.version, content: firstContent, evidenceFileIds: [evidenceFile.id] }).expect(201);
    const actionKey = randomUUID();
    const actionBody = { action, expectedContentVersion: first.body.version };
    await request(app.getHttpServer()).post('/api/v1/supplier-quality/problems/' + issued.id + '/workflow-actions').set('Cookie', owner.supplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(actionBody).expect(403);
    const returned = await request(app.getHttpServer()).post('/api/v1/supplier-quality/problems/' + issued.id + '/workflow-actions').set('Cookie', owner.ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', actionKey).send(actionBody).expect(200);
    expect(returned.body.canEditResponse).toBe(false);
    await request(app.getHttpServer()).post('/api/v1/supplier-quality/problems/' + issued.id + '/workflow-actions').set('Cookie', owner.ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', actionKey).send(actionBody).expect(200);
    const secondContent = { ...firstContent, correctiveAction: 'Revised action' };
    await request(app.getHttpServer()).post('/api/v1/supplier-portal/problems/' + issued.id + '/actions').set('Cookie', owner.supplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedContentVersion: issued.version, content: secondContent }).expect(409);
    const secondKey = randomUUID();
    const second = await request(app.getHttpServer()).post('/api/v1/supplier-portal/problems/' + issued.id + '/actions').set('Cookie', owner.supplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', secondKey).send({ expectedContentVersion: first.body.version, content: secondContent }).expect(201);
    await request(app.getHttpServer()).post('/api/v1/supplier-portal/problems/' + issued.id + '/actions').set('Cookie', owner.supplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', secondKey).send({ expectedContentVersion: first.body.version, content: secondContent }).expect(201);
    expect(await prisma.supplierResponseRevision.findMany({ where: { problemId: issued.id }, orderBy: { revision: 'asc' }, select: { revision: true, content: true } })).toMatchObject([{ revision: 1, content: firstContent }, { revision: 2, content: secondContent }]);
    const firstPage = await request(app.getHttpServer()).get('/api/v1/supplier-portal/problems/' + issued.id + '?revisionPage=1&revisionPageSize=1').set('Cookie', owner.supplierCookie).expect(200);
    expect(firstPage.body.responseHistory).toMatchObject({ total: 2, page: 1, pageSize: 1, items: [{ revision: 2, content: secondContent, evidence: [] }] });
    const secondPage = await request(app.getHttpServer()).get('/api/v1/supplier-portal/problems/' + issued.id + '?revisionPage=2&revisionPageSize=1').set('Cookie', owner.supplierCookie).expect(200);
    expect(secondPage.body).toMatchObject({ latestResponseRevision: { revision: 2 }, responseHistory: { total: 2, page: 2, pageSize: 1, items: [{ revision: 1, content: firstContent, evidence: [{ fileId: evidenceFile.id, downloadable: true }] }] } });
    expect(secondPage.body).not.toHaveProperty('problemIndexId');
    await request(app.getHttpServer()).get('/api/v1/supplier-portal/problems/' + issued.id + '?revisionPageSize=21').set('Cookie', owner.supplierCookie).expect(400);
  });

  it('reopens a closed problem, ties verification to the new revision and rejects revoked replays', async () => {
    const owner = await context();
    const issued = await prepare(owner);
    const firstContent = { rootCause: 'Initial cause', correctiveAction: 'Initial action', completionTime: '2026-09-23T08:00:00Z' };
    const firstKey = randomUUID();
    const first = await request(app.getHttpServer()).post('/api/v1/supplier-portal/problems/' + issued.id + '/actions').set('Cookie', owner.supplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', firstKey).send({ expectedContentVersion: issued.version, content: firstContent }).expect(201);
    const firstVerify = await request(app.getHttpServer()).post('/api/v1/supplier-quality/problems/' + issued.id + '/workflow-actions').set('Cookie', owner.verifierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ action: 'VERIFY', expectedContentVersion: first.body.version, accepted: true }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/supplier-quality/problems/' + issued.id + '/workflow-actions').set('Cookie', owner.ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ action: 'CLOSE', expectedContentVersion: firstVerify.body.version }).expect(200);
    const reopenKey = randomUUID();
    const reopened = await request(app.getHttpServer()).post('/api/v1/supplier-quality/problems/' + issued.id + '/workflow-actions').set('Cookie', owner.ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', reopenKey).send({ action: 'REOPEN', expectedContentVersion: first.body.version }).expect(200);
    expect(reopened.body.problemStatus).toBe('IN_PROGRESS');
    const invalidated = await request(app.getHttpServer()).get('/api/v1/supplier-quality/problems/' + issued.id).set('Cookie', owner.ownerCookie).expect(200);
    expect(invalidated.body.currentVerification).toMatchObject({ status: 'INVALIDATED', verifierId: owner.verifierUserId });
    const secondContent = { ...firstContent, rootCause: 'Corrected root cause' };
    const second = await request(app.getHttpServer()).post('/api/v1/supplier-portal/problems/' + issued.id + '/actions').set('Cookie', owner.supplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedContentVersion: first.body.version, content: secondContent }).expect(201);
    const revisions = await prisma.supplierResponseRevision.findMany({ where: { problemId: issued.id }, orderBy: { revision: 'asc' } });
    expect(revisions).toHaveLength(2);
    expect(revisions.map((revision) => revision.revision)).toEqual([1, 2]);
    expect(await prisma.supplierVerification.count({ where: { problemId: issued.id, revisionId: revisions[1]!.id } })).toBe(0);
    await request(app.getHttpServer()).post('/api/v1/supplier-quality/problems/' + issued.id + '/workflow-actions').set('Cookie', owner.ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ action: 'CLOSE', expectedContentVersion: second.body.version }).expect(403);
    await request(app.getHttpServer()).post('/api/v1/supplier-quality/problems/' + issued.id + '/workflow-actions').set('Cookie', owner.verifierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ action: 'VERIFY', expectedContentVersion: second.body.version, accepted: false }).expect(400);
    expect(await prisma.supplierVerification.count({ where: { problemId: issued.id, revisionId: revisions[1]!.id } })).toBe(0);
    const secondVerified = await request(app.getHttpServer()).post('/api/v1/supplier-quality/problems/' + issued.id + '/workflow-actions').set('Cookie', owner.ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ action: 'VERIFY', expectedContentVersion: second.body.version, accepted: true }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/supplier-quality/problems/' + issued.id + '/workflow-actions').set('Cookie', owner.verifierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ action: 'CLOSE', expectedContentVersion: secondVerified.body.version }).expect(200);
    const verifications = await prisma.supplierVerification.findMany({ where: { problemId: issued.id }, orderBy: { createdAt: 'asc' } });
    expect(verifications).toMatchObject([{ revisionId: revisions[0]!.id, accepted: true }, { revisionId: revisions[1]!.id, accepted: true }]);
    const ownerRole = await prisma.userRole.findFirstOrThrow({ where: { userId: owner.ownerUserId, organizationId: owner.owner.id } });
    await prisma.userRole.delete({ where: { userId_roleId_organizationId: { userId: owner.ownerUserId, roleId: ownerRole.roleId, organizationId: owner.owner.id } } });
    await request(app.getHttpServer()).post('/api/v1/supplier-quality/problems/' + issued.id + '/workflow-actions').set('Cookie', owner.ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', reopenKey).send({ action: 'REOPEN', expectedContentVersion: first.body.version }).expect(403);
    await prisma.userRole.create({ data: { userId: owner.ownerUserId, roleId: ownerRole.roleId, organizationId: owner.owner.id } });
    await prisma.session.updateMany({ where: { userId: owner.ownerUserId, revokedAt: null }, data: { revokedAt: new Date() } });
    await request(app.getHttpServer()).post('/api/v1/supplier-quality/problems/' + issued.id + '/workflow-actions').set('Cookie', owner.ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', reopenKey).send({ action: 'REOPEN', expectedContentVersion: first.body.version }).expect(401);
    const supplierRole = await prisma.userRole.findFirstOrThrow({ where: { userId: owner.supplierUserId, organizationId: owner.supplier.id } });
    await prisma.userRole.delete({ where: { userId_roleId_organizationId: { userId: owner.supplierUserId, roleId: supplierRole.roleId, organizationId: owner.supplier.id } } });
    await request(app.getHttpServer()).post('/api/v1/supplier-portal/problems/' + issued.id + '/actions').set('Cookie', owner.supplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', firstKey).send({ expectedContentVersion: issued.version, content: firstContent }).expect(403);
    await prisma.userRole.create({ data: { userId: owner.supplierUserId, roleId: supplierRole.roleId, organizationId: owner.supplier.id } });
    await prisma.session.updateMany({ where: { userId: owner.supplierUserId, revokedAt: null }, data: { revokedAt: new Date() } });
    await request(app.getHttpServer()).post('/api/v1/supplier-portal/problems/' + issued.id + '/actions').set('Cookie', owner.supplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', firstKey).send({ expectedContentVersion: issued.version, content: firstContent }).expect(401);
  });
});
