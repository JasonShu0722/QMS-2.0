import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowRuntimeService } from '../../src/modules/workflow/workflow-runtime.service.js';

if (!process.env.DATABASE_URL) throw new Error('Supplier problem reads require real PostgreSQL; no skipping.');

// Database records below are read fixtures, not evidence of supplier formal issuance.
describe('registered supplier domain reads through real HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const workflowInstances: string[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    try { if (prisma && workflowInstances.length) await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: workflowInstances } } }); }
    finally { await app?.close(); }
  });

  async function identity(type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL', codes = ['problem-index:read', 'supplier-quality:problems:read']) {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Supplier read fixture', type } });
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'unused', accountType: type } });
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Reader' } });
    for (const code of codes) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId: user.id, organizationId: organization.id, roleId: role.id } });
    const token = await app.get(SessionService).create(user.id);
    return { organization, user, role, cookie: `qms_session=${token}` };
  }

  async function fixture(owner?: Awaited<ReturnType<typeof identity>>) {
    owner ??= await identity();
    const supplier = await identity('SUPPLIER');
    const profile = await prisma.supplierBusinessProfile.create({ data: { ownerOrganizationId: owner.organization.id, supplierOrganizationId: supplier.organization.id, businessCode: randomUUID(), displayName: '责任供应商', contactEmail: 'private@example.invalid' } });
    const record = await prisma.supplierQualityProblem.create({ data: { ownerOrganizationId: owner.organization.id, supplierOrganizationId: supplier.organization.id, profileId: profile.id, createdById: owner.user.id, title: '来料端子氧化', materialCode: 'MAT-001', materialCategory: 'ELECTRONIC', defectDescription: '表面氧化影响导通', defectQuantity: 12, severity: 'HIGH', responseForm: 'BRIEF', replyMode: 'SUPPLIER' } });
    const index = await prisma.problemIndex.create({ data: { organizationId: owner.organization.id, reportNumber: randomUUID(), domainCode: 'supplier-quality', sourceType: 'supplier-quality', sourceId: record.id, problemType: 'BRIEF', severity: 'HIGH' } });
    await prisma.supplierQualityProblem.update({ where: { id: record.id }, data: { problemIndexId: index.id } });
    return { owner, supplier, profile, record, index };
  }

  function get(cookie: string, route: string) { return request(app.getHttpServer()).get(`/api/v1/${route}`).set('Cookie', cookie); }

  it('registers production supplier reads for the index and problem center without test adapter overrides', async () => {
    const context = await fixture();
    for (const route of ['problem-index', 'problem-center']) {
      const page = await get(context.owner.cookie, route).expect(200);
      expect(page.body).toMatchObject({ total: 1, items: [{ id: context.index.id, summary: { title: context.record.title, description: context.record.defectDescription, domainUiKey: 'supplier-quality' } }] });
      expect(page.body.statusCounts).toEqual([{ status: 'OPEN', count: 1 }]);
      expect(JSON.stringify(page.body)).not.toContain('private@example.invalid');
    }
  });

  it('projects current facts but never exposes response drafts, contacts or unsupported actions', async () => {
    const context = await fixture();
    await prisma.supplierResponseDraft.create({ data: { problemId: context.record.id, updatedById: context.supplier.user.id, content: { rootCause: '未提交的回复机密' } } });
    const result = await get(context.owner.cookie, `problem-index/${context.index.id}/workspace`).expect(200);
    expect(result.body).toMatchObject({ domainAvailability: 'AVAILABLE', readOnly: true, actions: [], evidence: [], domain: { domainVersion: 1, revisionId: null } });
    expect(result.body.domain.sections[0].fields).toEqual(expect.arrayContaining([
      { key: 'materialCode', label: '物料编码', value: 'MAT-001' },
      { key: 'defectQuantity', label: '不良数量', value: '12' },
      { key: 'supplierName', label: '责任供应商', value: '责任供应商' },
    ]));
    expect(JSON.stringify(result.body)).not.toContain('未提交的回复机密');
    expect(JSON.stringify(result.body)).not.toContain('private@example.invalid');
  });

  it('supports 500-character domain titles without violating the public summary contract', async () => {
    const context = await fixture();
    const title = '标题'.repeat(250);
    await prisma.supplierQualityProblem.update({ where: { id: context.record.id }, data: { title } });
    const result = await get(context.owner.cookie, `problem-index/${context.index.id}/workspace`).expect(200);
    expect(result.body.problem.summary.title.length).toBeLessThanOrEqual(200);
    expect(result.body.domain.sections[0].fields).toContainEqual({ key: 'title', label: '问题标题', value: title });
  });

  it('filters missing and mismatched domain links before pagination and counts', async () => {
    const context = await fixture();
    const hidden = await fixture(context.owner);
    await prisma.supplierQualityProblem.update({ where: { id: hidden.record.id }, data: { problemIndexId: null } });
    const wrongSource = await fixture(context.owner);
    await prisma.problemIndex.update({ where: { id: wrongSource.index.id }, data: { sourceId: randomUUID() } });
    const unknown = await fixture(context.owner);
    await prisma.problemIndex.update({ where: { id: unknown.index.id }, data: { domainCode: 'unknown-domain' } });
    const page = await get(context.owner.cookie, 'problem-index?pageSize=1').expect(200);
    expect(page.body).toMatchObject({ total: 1, items: [{ id: context.index.id }], statusCounts: [{ status: 'OPEN', count: 1 }] });
    const empty = await get(context.owner.cookie, 'problem-index?pageSize=1&page=2').expect(200);
    expect(empty.body).toMatchObject({ total: 1, items: [] });
    for (const id of [hidden.index.id, wrongSource.index.id, unknown.index.id]) await get(context.owner.cookie, `problem-index/${id}/workspace`).expect(404);
  });

  it('requires domain permission in addition to public permission on every read surface', async () => {
    const context = await fixture(await identity('INTERNAL', ['problem-index:read']));
    const page = await get(context.owner.cookie, 'problem-index').expect(200);
    expect(page.body).toMatchObject({ total: 0, items: [], statusCounts: [] });
    for (const route of [`problem-index/${context.index.id}`, `problem-index/${context.index.id}/workspace`, `reports/problems/${context.index.id}`, `problems/${context.index.id}/audit-trail`]) await get(context.owner.cookie, route).expect(404);
  });

  it('requires public permission even when domain permission is granted', async () => {
    const context = await fixture(await identity('INTERNAL', ['supplier-quality:problems:read']));
    for (const route of ['problem-index', `problem-index/${context.index.id}/workspace`]) await get(context.owner.cookie, route).expect(403);
  });

  it('denies foreign internal organization and supplier identities without granting owner scope', async () => {
    const context = await fixture();
    const other = await identity();
    for (const actor of [other, context.supplier]) {
      expect((await get(actor.cookie, 'problem-index').expect(200)).body.total).toBe(0);
      await get(actor.cookie, `problem-index/${context.index.id}/workspace`).expect(404);
      await get(actor.cookie, `problem-index?organizationId=${context.owner.organization.id}`).expect(403);
    }
  });

  it('removes records immediately after domain permission is revoked', async () => {
    const context = await fixture();
    await get(context.owner.cookie, `problem-index/${context.index.id}`).expect(200);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:problems:read' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: context.owner.role.id, permissionId: permission.id } } });
    expect((await get(context.owner.cookie, 'problem-index').expect(200)).body.total).toBe(0);
    await get(context.owner.cookie, `problem-index/${context.index.id}`).expect(404);
  });

  it('does not claim a report snapshot or domain revision audit trail from current facts', async () => {
    const context = await fixture();
    const report = await get(context.owner.cookie, `reports/problems/${context.index.id}`).expect(200);
    expect(report.body).toMatchObject({ dataAvailability: 'UNAVAILABLE', revision: null, summary: null, sections: [], evidence: [] });
    const trail = await get(context.owner.cookie, `problems/${context.index.id}/audit-trail`).expect(200);
    expect(trail.body).toMatchObject({ items: [], domainRevisionTrailAvailable: false });
  });

  it('shows current workflow facts but never substitutes them for a historical instance snapshot', async () => {
    const context = await fixture();
    const definitions = app.get(WorkflowDefinitionService);
    const definition = await definitions.createDraft({ organizationId: context.owner.organization.id, userId: context.owner.user.id, code: randomUUID(), name: 'Read fixture flow', draft: {
      nodes: [
        { id: 'reply', type: 'ACTION', name: '回复', config: { isStart: true, assignment: { assigneeUserId: context.owner.user.id } } },
        { id: 'close', type: 'CLOSE', name: '关闭', config: { isEnd: true, assignment: { assigneeUserId: context.owner.user.id }, requireIndependentVerification: true } },
      ], transitions: [{ id: 'next', from: 'reply', to: 'close', action: 'SUBMIT' }],
    } });
    const version = await definitions.publishVersion({ organizationId: context.owner.organization.id, userId: context.owner.user.id, definitionId: definition.id });
    const permission = await prisma.permission.upsert({ where: { code: 'workflow:start' }, create: { code: 'workflow:start', name: 'Start' }, update: {} });
    await prisma.rolePermission.create({ data: { roleId: context.owner.role.id, permissionId: permission.id } });
    const started = await app.get(WorkflowRuntimeService).startInstance({ organizationId: context.owner.organization.id, actor: { id: context.owner.user.id, organizationId: context.owner.organization.id, accountType: 'INTERNAL' }, problemIndexId: context.index.id, workflowDefinitionId: definition.id, workflowVersionId: version.id, expectedProblemVersion: 1, instanceKey: randomUUID(), idempotencyKey: randomUUID(), traceId: randomUUID() });
    workflowInstances.push(started.instanceId);
    const current = await get(context.owner.cookie, `problem-index/${context.index.id}/workspace`).expect(200);
    expect(current.body).toMatchObject({ domainAvailability: 'AVAILABLE', selectedInstance: { id: started.instanceId }, domain: { summary: { title: context.record.title } } });
    // A second linked instance only sets up the historical selection boundary; it is not an upgrade test.
    const historical = await prisma.workflowInstance.create({ data: { organizationId: context.owner.organization.id, problemIndexId: context.index.id, workflowDefinitionId: definition.id, workflowVersionId: version.id, instanceKey: randomUUID(), currentNodeId: started.currentNodeId } });
    const history = await get(context.owner.cookie, `problem-index/${context.index.id}/workspace?instanceId=${historical.id}`).expect(200);
    expect(history.body).toMatchObject({ domainAvailability: 'UNAVAILABLE', domain: null, readOnly: true, actions: [], evidence: [] });
    const report = await get(context.owner.cookie, `reports/problems/${context.index.id}?instanceId=${started.instanceId}`).expect(200);
    expect(report.body).toMatchObject({ dataAvailability: 'UNAVAILABLE', summary: null, sections: [] });
  });

  it('reads each upgraded instance from its own immutable response revision and evidence without exposing drafts or foreign data', async () => {
    const context = await fixture();
    const definitions = app.get(WorkflowDefinitionService);
    const definition = await definitions.createDraft({ organizationId: context.owner.organization.id, userId: context.owner.user.id,
      code: randomUUID(), name: 'Historical supplier read flow', draft: {
        nodes: [
          { id: 'reply', type: 'ACTION', name: '回复', config: { isStart: true, assignment: { assigneeUserId: context.owner.user.id } } },
          { id: 'close', type: 'CLOSE', name: '关闭', config: { isEnd: true, assignment: { assigneeUserId: context.owner.user.id }, requireIndependentVerification: true } },
        ], transitions: [{ id: 'next', from: 'reply', to: 'close', action: 'SUBMIT' }],
      } });
    const version = await definitions.publishVersion({ organizationId: context.owner.organization.id, userId: context.owner.user.id, definitionId: definition.id });
    const node = await prisma.workflowNode.findFirstOrThrow({ where: { workflowVersionId: version.id, type: 'ACTION' } });
    const before = await prisma.workflowInstance.create({ data: { organizationId: context.owner.organization.id, problemIndexId: context.index.id,
      workflowDefinitionId: definition.id, workflowVersionId: version.id, instanceKey: randomUUID(), currentNodeId: node.id, status: 'CANCELLED', version: 3 } });
    const after = await prisma.workflowInstance.create({ data: { organizationId: context.owner.organization.id, problemIndexId: context.index.id,
      workflowDefinitionId: definition.id, workflowVersionId: version.id, instanceKey: randomUUID(), currentNodeId: node.id } });
    await prisma.problemIndex.update({ where: { id: context.index.id }, data: { workflowInstanceId: after.id, problemType: 'EIGHT_D', version: 3 } });
    await prisma.supplierQualityProblem.update({ where: { id: context.record.id }, data: { responseForm: 'EIGHT_D', version: 4, releasedToSupplierAt: new Date() } });
    const brief = await prisma.supplierResponseRevision.create({ data: { problemId: context.record.id, revision: 1,
      content: { rootCause: '简报原因', correctiveAction: '简报措施' }, submittedById: context.supplier.user.id, workflowInstanceId: before.id, workflowVersion: version.version } });
    const eightD = await prisma.supplierResponseRevision.create({ data: { problemId: context.record.id, revision: 2,
      content: { rootCause: '8D 原因', correctiveAction: '人工修订措施', preventiveAction: '新增预防措施' },
      submittedById: context.owner.user.id, workflowInstanceId: after.id, workflowVersion: version.version } });
    await prisma.workflowUpgrade.create({ data: { organizationId: context.owner.organization.id, problemIndexId: context.index.id,
      actorUserId: context.owner.user.id, beforeInstanceId: before.id, afterInstanceId: after.id, beforeProblemVersion: 2,
      afterProblemVersion: 3, beforeDomainRevisionId: brief.id, afterDomainRevisionId: eightD.id, mappingVersion: 'supplier-brief-eight-d-v1',
      mappingSummary: [], reason: '升级 8D', key: randomUUID(), requestDigest: 'a'.repeat(64), response: { domainVersion: 4 } } });
    const file = await prisma.fileObject.create({ data: { organizationId: context.supplier.organization.id, objectKey: randomUUID(),
      originalName: 'history.pdf', contentType: 'application/pdf', sizeBytes: 12, sha256: 'a'.repeat(64), verifiedSha256: 'a'.repeat(64),
      verifiedContentType: 'application/pdf', verifiedSizeBytes: 12, objectVersionId: 'historical-read-version', uploadCompletedAt: new Date(),
      uploadExpiresAt: new Date(Date.now() + 60_000), scannedAt: new Date(), scannerEngine: 'ClamAV test', scanStatus: 'CLEAN', status: 'AVAILABLE',
      resourceType: 'supplier-quality', resourceId: context.record.id, resourceVersion: 3, uploadedById: context.supplier.user.id,
      retainUntil: new Date(Date.now() + 86_400_000) } });
    await prisma.supplierEvidenceReference.createMany({ data: [brief.id, eightD.id].map((revisionId) => ({ problemId: context.record.id,
      revisionId, fileId: file.id, purpose: 'RESPONSE' })) });
    const newerFile = await prisma.fileObject.create({ data: { organizationId: context.supplier.organization.id, objectKey: randomUUID(),
      originalName: 'eight-d.pdf', contentType: 'application/pdf', sizeBytes: 14, sha256: 'b'.repeat(64), verifiedSha256: 'b'.repeat(64),
      verifiedContentType: 'application/pdf', verifiedSizeBytes: 14, objectVersionId: 'eight-d-read-version', uploadCompletedAt: new Date(),
      uploadExpiresAt: new Date(Date.now() + 60_000), scannedAt: new Date(), scannerEngine: 'ClamAV test', scanStatus: 'CLEAN', status: 'AVAILABLE',
      resourceType: 'supplier-quality', resourceId: context.record.id, resourceVersion: 4, uploadedById: context.supplier.user.id,
      retainUntil: new Date(Date.now() + 86_400_000) } });
    await prisma.supplierEvidenceReference.create({ data: { problemId: context.record.id, revisionId: eightD.id,
      fileId: newerFile.id, purpose: 'EIGHT_D_RESPONSE' } });
    await prisma.supplierResponseDraft.create({ data: { problemId: context.record.id, updatedById: context.supplier.user.id,
      content: { rootCause: '未提交的供应商秘密' } } });

    const current = await get(context.owner.cookie, `problem-index/${context.index.id}/workspace`).expect(200);
    expect(current.body).toMatchObject({ domainAvailability: 'AVAILABLE', selectedInstance: { id: after.id },
      domain: { domainVersion: 4, revisionId: eightD.id, sections: expect.arrayContaining([expect.objectContaining({ key: 'supplierResponse', fields: expect.arrayContaining([
        { key: 'responseForm', label: '回复形式', value: '8D' }, { key: 'rootCause', label: '根本原因', value: '8D 原因' },
        { key: 'correctiveAction', label: '纠正措施', value: '人工修订措施' },
      ]) })]) }, evidence: expect.arrayContaining([expect.objectContaining({ id: file.id }), expect.objectContaining({ id: newerFile.id })]) });
    const historical = await get(context.owner.cookie, `problem-index/${context.index.id}/workspace?instanceId=${before.id}`).expect(200);
    expect(historical.body).toMatchObject({ domainAvailability: 'AVAILABLE', selectedInstance: { id: before.id }, readOnly: true, actions: [],
      domain: { domainVersion: 3, revisionId: brief.id, sections: [expect.objectContaining({ key: 'supplierResponse', fields: expect.arrayContaining([
        { key: 'responseForm', label: '回复形式', value: '简报' }, { key: 'rootCause', label: '根本原因', value: '简报原因' },
        { key: 'correctiveAction', label: '纠正措施', value: '简报措施' },
      ]) })] }, evidence: [{ id: file.id }] });
    expect(JSON.stringify(historical.body)).not.toMatch(/8D 原因|人工修订措施|未提交的供应商秘密|private@example.invalid/);
    expect(JSON.stringify(historical.body)).not.toContain(newerFile.id);
    expect(JSON.stringify(current.body)).not.toContain('未提交的供应商秘密');
    const unlinked = await prisma.workflowInstance.create({ data: { organizationId: context.owner.organization.id, problemIndexId: context.index.id,
      workflowDefinitionId: definition.id, workflowVersionId: version.id, instanceKey: randomUUID(), currentNodeId: node.id } });
    await prisma.supplierResponseRevision.create({ data: { problemId: context.record.id, revision: 3,
      content: { rootCause: '不关联实例的内容' }, submittedById: context.owner.user.id, workflowInstanceId: unlinked.id, workflowVersion: version.version } });
    const unavailable = await get(context.owner.cookie, `problem-index/${context.index.id}/workspace?instanceId=${unlinked.id}`).expect(200);
    expect(unavailable.body).toMatchObject({ domainAvailability: 'UNAVAILABLE', domain: null, evidence: [] });
    const currentAgain = await get(context.owner.cookie, `problem-index/${context.index.id}/workspace`).expect(200);
    expect(JSON.stringify(currentAgain.body)).not.toContain('不关联实例的内容');
    const historicalReport = await get(context.owner.cookie, `reports/problems/${context.index.id}?instanceId=${before.id}`).expect(200);
    expect(historicalReport.body).toMatchObject({ dataAvailability: 'UNAVAILABLE', revision: null, evidence: [] });
    const outsider = await identity();
    for (const actor of [context.supplier, outsider]) {
      await get(actor.cookie, `problem-index/${context.index.id}/workspace?instanceId=${before.id}`).expect(404);
    }
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:problems:read' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: context.owner.role.id, permissionId: permission.id } } });
    await get(context.owner.cookie, `problem-index/${context.index.id}/workspace?instanceId=${before.id}`).expect(404);
  });

  it('allows an internal reader explicitly granted both permissions in the owning organization', async () => {
    const context = await fixture();
    const remote = await identity();
    await prisma.userRole.create({ data: { userId: remote.user.id, organizationId: context.owner.organization.id, roleId: context.owner.role.id } });
    const page = await get(remote.cookie, `problem-index?organizationId=${context.owner.organization.id}`).expect(200);
    expect(page.body).toMatchObject({ total: 1, items: [{ id: context.index.id }] });
    await get(remote.cookie, `problem-index/${context.index.id}/workspace?organizationId=${context.owner.organization.id}`).expect(200);
    await prisma.organization.update({ where: { id: context.owner.organization.id }, data: { status: 'DISABLED' } });
    await get(remote.cookie, `problem-index?organizationId=${context.owner.organization.id}`).expect(403);
  });
});
