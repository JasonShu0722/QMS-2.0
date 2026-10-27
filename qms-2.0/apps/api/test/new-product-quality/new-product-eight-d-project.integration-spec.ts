import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { NEW_PRODUCT_EIGHT_D_RUNTIME, type InternalEightDRuntime } from '../../src/common/eight-d/internal-eight-d-runtime.js';
import { NewProductQualityService } from '../../src/modules/new-product-quality/new-product-quality.service.js';
import { ComponentProjectService } from '../../src/modules/platform-configuration/component-project.service.js';
import { ProcessDefectLedgerService } from '../../src/modules/process-quality/process-defect-ledger.service.js';
import { emptyProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowClosureTemplateService } from '../../src/modules/workflow/workflow-closure-template.service.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import { createWorkflowClosureFixture } from '../workflow/workflow-closure-round.fixture.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Project gates require disposable loopback PostgreSQL, never preview 55440.');
}

describe('new-product internal 8D project gates on PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let quality: NewProductQualityService;
  let runtime: InternalEightDRuntime;
  let rounds: WorkflowClosureRoundService;

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    quality = app.get(NewProductQualityService);
    runtime = app.get(NEW_PRODUCT_EIGHT_D_RUNTIME);
    rounds = app.get(WorkflowClosureRoundService);
  }, 120_000);
  afterAll(async () => app?.close());

  async function fixture() {
    const f = await createWorkflowClosureFixture(prisma, rounds);
    const codes = ['configuration:read', 'configuration:manage', 'workflow:manage', 'workflow:start',
      'component-project:read', 'component-project:manage', 'process-quality:defects:read', 'process-quality:defects:write',
      'new-product-quality:projects:read', 'new-product-quality:projects:write',
      ...['read', 'issue', 'work', 'sources'].map(action => `new-product-quality:issues:${action}`)];
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
    expect(permissions).toHaveLength(codes.length);
    await prisma.rolePermission.createMany({ data: permissions.map(p => ({ roleId: f.role.id, permissionId: p.id })), skipDuplicates: true });
    await prisma.session.updateMany({ where: { userId: { in: [f.owner.user.id, f.professional.user.id] } }, data: { reauthenticatedAt: new Date() } });
    const actor = f.professional.actor;
    await app.get(NumberingService).publishRuleVersion({ organizationId: f.org.id, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}' });
    const template = await app.get(WorkflowClosureTemplateService).initialize(actor,
      { policy: 'INTERNAL', domainCode: 'new-product-quality', code: randomUUID(), name: 'New-product project gate' }, randomUUID(), randomUUID());
    const published = await app.get(WorkflowDefinitionService).publishVersion({ organizationId: f.org.id, userId: actor.id, actor,
      definitionId: template.id, expectedRevision: template.revision, draftVersionId: template.version.id });
    await runtime.core.bind(actor, { expectedVersion: 0, workflowDefinitionId: template.id, workflowVersionId: published.id }, randomUUID(), randomUUID());
    await runtime.core.activate(actor, { expectedVersion: 1, enabled: true }, randomUUID(), randomUUID());
    const mappings = app.get(ComponentProjectService);
    const project = await quality.createProject(actor, { code: randomUUID(), name: 'Gate project', productCode: randomUUID() }, randomUUID(), randomUUID());
    const record = await mappings.createProject(actor, f.org.id, { code: project.code, name: project.name, stage: 'NEW_PRODUCT' }, randomUUID(), randomUUID());
    await mappings.createMapping(actor, f.org.id, { componentCode: project.product_code, projectRecordId: record.id, productCategory: 'Gate fixture' }, randomUUID(), randomUUID());
    const select = async () => {
      const defect = await app.get(ProcessDefectLedgerService).create(actor, { description: 'Selected process fact', productCode: project.product_code }, randomUUID(), randomUUID());
      return quality.selectProcessDefect(actor, project.id, { defectId: defect.id, expectedVersion: defect.version }, randomUUID(), randomUUID());
    };
    const first = await select(), second = await select();
    const issue = async () => {
      const issued = await runtime.core.issue(actor, { sources: [first, second].map(s => ({ defectId: s.id, expectedVersion: s.source_version })),
        severity: 'LOW', ownerUserId: f.owner.user.id, responsibleSectionDepartmentId: f.section.id }, randomUUID(), randomUUID());
      return String(issued.problem.id);
    };
    const stage = await quality.addStage(actor, project.id, { code: 'SOP', name: 'Production gate' }, randomUUID(), randomUUID());
    const deliverable = await quality.addDeliverable(actor, stage.id, { code: 'SOP', name: 'Production evidence', required: true }, randomUUID(), randomUUID());
    const evidence = await prisma.fileObject.create({ data: { organizationId: f.org.id, objectKey: randomUUID(), originalName: 'gate.txt', contentType: 'text/plain',
      sizeBytes: 1n, sha256: 'a'.repeat(64), verifiedSha256: 'a'.repeat(64), verifiedContentType: 'text/plain', verifiedSizeBytes: 1n,
      objectVersionId: randomUUID(), uploadCompletedAt: new Date(), scannedAt: new Date(), scannerEngine: 'fixture', scanStatus: 'CLEAN', status: 'AVAILABLE',
      resourceType: 'new-product-deliverable', resourceId: deliverable.id, resourceVersion: 1, uploadedById: actor.id } });
    await quality.submitDeliverable(actor, deliverable.id, { expectedVersion: 1, evidenceObjectId: evidence.id }, randomUUID(), randomUUID());
    await quality.reviewStage(actor, stage.id, { expectedVersion: 1, decision: 'PASS' }, randomUUID(), randomUUID());
    const batch = await quality.createTrialBatch(actor, project.id, { code: 'RUN' }, randomUUID(), randomUUID());
    await quality.recordMetric(actor, batch.id, { code: 'INPUT', target: 1, actual: 1, comparison: 'GTE', source: 'MANUAL' }, randomUUID(), randomUUID());
    await quality.createTrialSummary(actor, batch.id, { conclusion: 'Trial facts verified' }, randomUUID(), randomUUID());
    const approveSummary = async (expectedVersion = 1) => {
      const summary = await quality.submitTrialSummary(actor, batch.id, { expectedVersion }, randomUUID(), randomUUID());
      await quality.decideTrialSummary(f.owner.actor, batch.id, { expectedVersion: summary.version, decision: 'APPROVE' }, randomUUID(), randomUUID());
      return summary;
    };
    const handover = async () => quality.handoverProject(actor, project.id,
      { expectedVersion: (await quality.projectDetail(actor, project.id)).version, riskStatement: 'Tracked project risks' }, randomUUID(), randomUUID());
    return { ...f, actor, project, record, first, second, issue, batch, evidence, approveSummary, handover };
  }

  it('deduplicates two selections by problemId, keeps legacy item IDs separate and gates an open 8D handover', async () => {
    const f = await fixture(), problemId = await f.issue();
    const list = await quality.issueListForProject(f.actor, f.project.id);
    expect(list).toMatchObject({ items: [], internalEightDIssues: [{ problemId, selectionIds: expect.arrayContaining([f.first.id, f.second.id]) }], stats: { total: 1, in_progress: 1 } });
    expect((await quality.projectDetail(f.actor, f.project.id)).issues).toEqual(list);
    expect(await prisma.$queryRaw`SELECT id FROM new_product_issues WHERE project_id = ${f.project.id}::uuid`).toEqual([]);
    const summary = await f.approveSummary();
    expect(summary.issueSnapshot).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'INTERNAL_EIGHT_D', problemId, status: 'IN_PROGRESS' })]));
    await expect(f.handover()).rejects.toMatchObject({ status: 409, response: { code: 'NEW_PRODUCT_HANDOVER_RISK_APPROVAL_REQUIRED' } });
    await quality.approveMassProduction(f.actor, f.project.id, { decision: 'APPROVE', riskStatement: 'Tracked project risks', evidenceObjectId: f.evidence.id }, randomUUID(), randomUUID());
    expect(await f.handover()).toMatchObject({ open_issue_count: 1 });
  }, 120_000);

  it('invalidates approved trial facts when a new 8D appears, then closes through real reviews and hands over with zero open issues', async () => {
    const f = await fixture();
    await f.approveSummary();
    const problemId = await f.issue();
    await expect(quality.trialSummaryFile(f.actor, f.batch.id, 'xlsx', 3)).rejects.toMatchObject({ status: 409, response: { code: 'NEW_PRODUCT_TRIAL_SUMMARY_STALE' } });
    await expect(f.handover()).rejects.toMatchObject({ status: 409, response: { code: 'NEW_PRODUCT_HANDOVER_TRIAL_SUMMARY_STALE' } });
    const document = emptyProcessEightDDocument();
    document.description = 'Measured defect'; document.analysisProcess = 'Verified process'; document.occurrenceCause = 'Occurrence'; document.escapeCause = 'Escape';
    document.correctiveActions = (['OCCURRENCE', 'ESCAPE'] as const).map((causeKind, index) => ({ id: `gate-${index}`, causeKind, action: 'Correct cause', owner: 'Owner',
      plannedAt: '2026-10-25', verificationMethod: 'Measure', fileIds: [], implementationAt: '2026-10-25', result: 'Implemented', beforeState: 'NG', afterState: 'OK',
      firstBatch: `RUN-${index}`, followUpBatchCount: 3, followUpDuration: '', verificationRecord: 'Three batches passed', verificationFileIds: [], effective: true }));
    let current = await runtime.core.read(f.owner.actor, problemId);
    await runtime.core.save(f.owner.actor, problemId, { expectedVersion: current.version, document }, randomUUID(), randomUUID());
    current = await runtime.core.read(f.owner.actor, problemId);
    await runtime.core.analysisComplete(f.owner.actor, problemId, { expectedVersion: current.version, submissionDueAt: new Date('2026-11-10T00:00:00Z') }, randomUUID(), randomUUID());
    current = await runtime.core.read(f.owner.actor, problemId);
    await runtime.core.submit(f.owner.actor, problemId, { expectedVersion: current.version }, randomUUID(), randomUUID());
    let round = (await rounds.readProjection(prisma, f.org.id, problemId))!;
    round = await rounds.decide(f.actor, round.id, { expectedRoundVersion: round.version, duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: 'Verified' }, randomUUID(), randomUUID());
    await rounds.decide(f.manager.actor, round.id, { expectedRoundVersion: round.version, duties: ['SECTION_MANAGER'], decision: 'APPROVE', comment: 'Verified' }, randomUUID(), randomUUID());
    expect(await quality.issueListForProject(f.actor, f.project.id)).toMatchObject({ items: [], internalEightDIssues: [{ problemId, status: 'CLOSED' }], stats: { total: 1, closed: 1, in_progress: 0 } });
    await quality.reviseTrialSummary(f.actor, f.batch.id, { expectedVersion: 3, conclusion: 'Closed 8D verified' }, randomUUID(), randomUUID());
    await f.approveSummary(4);
    expect(await f.handover()).toMatchObject({ open_issue_count: 0, mass_production_approval_id: null });
  }, 120_000);

  it('tracks current links and the primary when sources move to another project, and still enforces project read authorization', async () => {
    const f = await fixture(), problemId = await f.issue();
    const mappings = app.get(ComponentProjectService);
    const other = await quality.createProject(f.actor, { code: randomUUID(), name: 'Other gate project', productCode: randomUUID() }, randomUUID(), randomUUID());
    const record = await mappings.createProject(f.actor, f.org.id, { code: other.code, name: other.name, stage: 'NEW_PRODUCT' }, randomUUID(), randomUUID());
    await mappings.createMapping(f.actor, f.org.id, { componentCode: other.product_code, projectRecordId: record.id, productCategory: 'Gate fixture' }, randomUUID(), randomUUID());
    const defect = await app.get(ProcessDefectLedgerService).create(f.actor, { description: 'Other project source', productCode: other.product_code }, randomUUID(), randomUUID());
    const selected = await quality.selectProcessDefect(f.actor, other.id, { defectId: defect.id, expectedVersion: defect.version }, randomUUID(), randomUUID());
    const current = await runtime.core.read(f.actor, problemId);
    await runtime.core.sources(f.actor, problemId, { expectedVersion: current.version, add: [{ defectId: selected.id, expectedVersion: selected.source_version }],
      removeDefectIds: [f.first.id, f.second.id], primaryDefectId: selected.id }, randomUUID(), randomUUID());
    expect(await quality.issueListForProject(f.actor, f.project.id)).toMatchObject({ internalEightDIssues: [], stats: { total: 0 } });
    expect(await quality.issueListForProject(f.actor, other.id)).toMatchObject({ internalEightDIssues: [{ problemId, selectionIds: [selected.id] }], stats: { total: 1 } });
    await mappings.updateProject(f.actor, f.org.id, record.id, { expectedVersion: record.version, stage: 'MASS_PRODUCTION' }, randomUUID(), randomUUID());
    expect(await quality.issueListForProject(f.actor, other.id)).toMatchObject({ internalEightDIssues: [{ problemId }] });
    await expect(quality.selectProcessDefect(f.actor, other.id, { defectId: defect.id, expectedVersion: defect.version }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409, response: { code: 'NEW_PRODUCT_DEFECT_STAGE_INELIGIBLE' } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'new-product-quality:projects:read' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: permission.id } } });
    await expect(quality.issueListForProject(f.actor, other.id)).rejects.toMatchObject({ status: 403 });
    await expect(quality.projectDetail(f.actor, other.id)).rejects.toMatchObject({ status: 403 });
  }, 120_000);
});
