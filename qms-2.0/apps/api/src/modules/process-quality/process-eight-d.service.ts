import { HttpException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { isUUID, validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Prisma, type WorkflowNode } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { ControlledValidationException } from '../../common/contracts/controlled-validation.exception.js';
import { effectivePositionAssignmentWhere } from '../../common/security/effective-role-grants.js';
import { hasPlatformAdministrator } from '../../common/security/platform-administrator.js';
import { assertRecentAuthentication, isSecurityConcurrencyConflict, mfaPolicy } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { FileResourceAccess } from '../file-management/file-resource-access.js';
import { OrganizationResponsibilityService } from '../organization/organization-responsibility.service.js';
import { DomainSourceIssueService, type DomainSourceReference } from '../problem-index/domain-source-issue.service.js';
import { DomainSourceLinkService } from '../problem-index/domain-source-link.service.js';
import { ProblemIndexService } from '../problem-index/problem-index.service.js';
import { ProblemDomainRegistry } from '../problem-index/problem-domain-registry.js';
import { OutboxService } from '../task-notification/outbox.service.js';
import { assertWorkflowFeature, canProcessWorkflowNode, featurePredicate } from '../workflow/workflow-access-policy.js';
import { WorkflowClosureRoundService } from '../workflow/workflow-closure-round.service.js';
import type { WorkflowClosureContext, WorkflowClosureOperation } from '../workflow/workflow-closure-round.types.js';
import type { WorkflowDeadlineContext, WorkflowDeadlinePolicy, WorkflowDeadlineStage } from '../workflow/workflow-deadline-extension.types.js';
import { deadlineDueAt, deadlineStageOpen, parseDeadlinePolicy } from '../workflow/workflow-deadline-extension.policy.js';
import { WorkflowDeadlineExtensionService } from '../workflow/workflow-deadline-extension.service.js';
import { canonical, isClosureReviewNode, jsonObject, matchesCondition } from '../workflow/workflow-runtime-policy.js';
import { WorkflowRuntimeService } from '../workflow/workflow-runtime.service.js';
import { persistWorkflowMutation } from '../workflow/workflow-start.js';
import { ProcessDefectLedgerService } from './process-defect-ledger.service.js';
import { analysisCompletionIssues, documentFileIds, emptyProcessEightDDocument, normalizeProcessEightDDocument, ProcessEightDDocumentError, submissionIssues } from './process-eight-d-document.js';
import { PROCESS_EIGHT_D_MAX_FILES } from './process-eight-d-document.dto.js';
import { assertEightDSources, assertSourceConfirmation, eightDError as workflowError, eightDRequestDigest } from './process-eight-d-policy.js';
import type { IssueProcessEightDInput, ProcessEightDActor, ProcessEightDPurpose, ProcessEightDRecord, ProcessEightDReport, ProcessEightDRevision, ProcessEightDSourceConfirmation, ProcessEightDStage, ProcessEightDVersionInput, SaveProcessEightDInput } from './process-eight-d.types.js';
import { ProcessEightDAssignmentOptionsQueryDto, type ProcessEightDAssignmentOptionsDto, type ProcessEightDAnalysisCompleteDto, type ProcessEightDDeadlinesDto, type ProcessEightDRelatedProblemDto, type ProcessEightDRiskDto, type ProcessEightDSourceConfirmationDto, type ProcessEightDSourcePreviewDto, type ProcessEightDSourcePreviewInputDto, type ProcessEightDSourcesDto, type ReassignProcessEightDDto } from './process-eight-d.dto.js';

const reportColumns = Prisma.sql`problem_id AS "problemId", organization_id AS "organizationId",
  responsible_section_department_id AS "responsibleSectionDepartmentId", professional_user_id AS "professionalUserId", document,
  version, content_version AS "contentVersion", analysis_completed_at AS "analysisCompletedAt", analysis_due_at AS "analysisDueAt",
  submission_due_at AS "submissionDueAt", closure_due_at AS "closureDueAt", submitted_at AS "submittedAt", closed_revision_id AS "closedRevisionId",
  created_by AS "createdBy", updated_by AS "updatedBy", created_at AS "createdAt", updated_at AS "updatedAt"`;
type Binding = { organizationId: string; workflowDefinitionId: string; workflowVersionId: string; enabled: boolean; version: number };
type ReassignmentAccess = { kind: 'OWNER' | 'MANAGEMENT' | 'CROSS_DEPARTMENT'; sectionDepartmentId: string };
const bindingColumns = Prisma.sql`organization_id AS "organizationId", workflow_definition_id AS "workflowDefinitionId", workflow_version_id AS "workflowVersionId", enabled, version`;
const iso = (date: Date | null) => date?.toISOString() ?? null;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

@Injectable()
export class ProcessEightDService {
  constructor(private readonly prisma: PrismaService, private readonly ledger: ProcessDefectLedgerService,
    private readonly domainIssues: DomainSourceIssueService, private readonly links: DomainSourceLinkService,
    private readonly runtime: WorkflowRuntimeService, private readonly problems: ProblemIndexService,
    private readonly rounds: WorkflowClosureRoundService, private readonly responsibilities: OrganizationResponsibilityService,
    private readonly resources: FileResourceAccess, private readonly audit: AuditLogService, private readonly outbox: OutboxService,
    private readonly readRegistry: ProblemDomainRegistry, private readonly extensions: WorkflowDeadlineExtensionService) {}

  async readResourceOrganizationId(tx: Prisma.TransactionClient, problemId: string): Promise<string> {
    this.uuid(problemId);
    const [report] = await tx.$queryRaw<{ organizationId: string }[]>`SELECT organization_id AS "organizationId" FROM process_eight_d_reports WHERE problem_id = ${problemId}::uuid`;
    if (!report) workflowError('PROBLEM_NOT_FOUND', 404);
    return report.organizationId;
  }

  async lockRecord(tx: Prisma.TransactionClient, actor: ProcessEightDActor, problemId: string, purpose: ProcessEightDPurpose): Promise<ProcessEightDRecord> {
    const readOnly = purpose === 'READ';
    this.scope(actor, readOnly); this.uuid(problemId);
    const organizationId = readOnly ? actor.scopeOrganizationId ?? actor.organizationId : actor.organizationId;
    this.uuid(organizationId);
    return this.lockFacts(tx, organizationId, problemId, readOnly);
  }

  private async lockFacts(tx: Prisma.TransactionClient, organizationId: string, problemId: string, readOnly = false): Promise<ProcessEightDRecord> {
    await tx.$queryRaw`SELECT id FROM problem_indexes WHERE organization_id = ${organizationId}::uuid AND id = ${problemId}::uuid ${readOnly ? Prisma.sql`FOR SHARE` : Prisma.sql`FOR UPDATE`}`;
    const problem = await tx.problemIndex.findFirst({ where: { id: problemId, organizationId, domainCode: 'process-quality', sourceType: 'process-defect', ...(readOnly ? {} : { archivedAt: null }) } });
    if (!problem?.workflowInstanceId) workflowError('PROBLEM_NOT_FOUND', 404);
    await tx.$queryRaw`SELECT id FROM workflow_instances WHERE organization_id = ${organizationId}::uuid AND id = ${problem.workflowInstanceId}::uuid ${readOnly ? Prisma.sql`FOR SHARE` : Prisma.sql`FOR UPDATE`}`;
    const instance = await tx.workflowInstance.findFirst({ where: { id: problem.workflowInstanceId, organizationId, problemIndexId: problem.id }, include: { currentNode: true, workflowVersion: true } });
    const [report] = await tx.$queryRaw<ProcessEightDReport[]>(Prisma.sql`SELECT ${reportColumns} FROM process_eight_d_reports
      WHERE organization_id = ${organizationId}::uuid AND problem_id = ${problemId}::uuid ${readOnly ? Prisma.sql`FOR SHARE` : Prisma.sql`FOR UPDATE`}`);
    if (!report) workflowError('PROCESS_EIGHT_D_NOT_FOUND', 404);
    if (!instance?.currentNode || instance.workflowVersion.status !== 'PUBLISHED' || instance.workflowVersion.organizationId !== organizationId
      || instance.currentNode.organizationId !== organizationId || instance.currentNode.workflowVersionId !== instance.workflowVersionId) workflowError('WORKFLOW_VERSION_MISMATCH', 409);
    const collaborators = await tx.$queryRaw<{ userId: string }[]>`SELECT user_id AS "userId" FROM process_eight_d_collaborators
      WHERE organization_id = ${organizationId}::uuid AND problem_id = ${problemId}::uuid ORDER BY user_id`;
    return { problem, instance, node: instance.currentNode, report, collaboratorUserIds: collaborators.map(c => c.userId) };
  }

  // Read-only security checks deliberately take no user/structure locks after the domain lock/resolver.
  async authorizeRead(tx: Prisma.TransactionClient, actor: ProcessEightDActor, record: ProcessEightDRecord): Promise<void> {
    await this.authorize(tx, actor, 'process-quality:issues:read', record.problem.organizationId, 'READ');
  }

  async authorizeEdit(tx: Prisma.TransactionClient, actor: ProcessEightDActor, record: ProcessEightDRecord): Promise<void> {
    await this.authorizeRead(tx, actor, record);
    await this.authorize(tx, actor, 'process-quality:issues:work', record.problem.organizationId);
    this.editable(record);
    if (actor.id === record.problem.ownerId) await this.assertOwnerAssignment(tx, record.problem.organizationId, actor.id, record.report.responsibleSectionDepartmentId);
    else if (!record.collaboratorUserIds.includes(actor.id) || !await this.eligibleWorker(tx, record.problem.organizationId, actor.id)) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
  }

  async authorizeDeadlineRequest(tx: Prisma.TransactionClient, actor: ProcessEightDActor, record: ProcessEightDRecord): Promise<void> {
    await this.authorizeRead(tx, actor, record);
    await this.authorize(tx, actor, 'process-quality:issues:work');
    this.owner(actor, record); this.notClosed(record);
    await this.assertOwnerAssignment(tx, actor.organizationId, actor.id, record.report.responsibleSectionDepartmentId);
    if (record.node.id !== (await this.ownerNode(tx, record)).id && !isClosureReviewNode(record.node)) workflowError('WORKFLOW_ACTION_INVALID', 409);
  }

  async deadlineContext(tx: Prisma.TransactionClient, record: ProcessEightDRecord): Promise<WorkflowDeadlineContext> {
    const ownerNode = await this.ownerNode(tx, record);
    return { organizationId: record.problem.organizationId, problemId: record.problem.id, instanceId: record.instance.id,
      workflowVersionId: record.instance.workflowVersionId, ownerNodeId: ownerNode.id, instanceVersion: record.instance.version,
      rowVersion: record.report.version, contentVersion: record.report.contentVersion, ownerUserId: record.problem.ownerId!,
      professionalUserId: record.report.professionalUserId, responsibleSectionDepartmentId: record.report.responsibleSectionDepartmentId,
      analysisDueAt: iso(record.report.analysisDueAt), submissionDueAt: iso(record.report.submissionDueAt), closureDueAt: iso(record.report.closureDueAt),
      analysisCompletedAt: iso(record.report.analysisCompletedAt), submittedAt: iso(record.report.submittedAt), closedAt: iso(record.problem.closedAt),
      policy: this.deadlinePolicy(ownerNode.config) };
  }

  async deadlineRequestStages(tx: Prisma.TransactionClient, actor: ProcessEightDActor, record: ProcessEightDRecord): Promise<WorkflowDeadlineStage[]> {
    if (actor.id !== record.problem.ownerId || actor.id === record.report.professionalUserId || record.problem.closedAt
      || record.report.closedRevisionId || record.instance.status !== 'RUNNING') return [];
    try {
      await this.authorizeDeadlineRequest(tx, actor, record);
      const c = await this.deadlineContext(tx, record);
      if (!await canProcessWorkflowNode(tx, actor.id, c.organizationId, { assigneeUserId: actor.id }) || !await this.extensions.policyCurrent(tx, c)) return [];
      const requests = await this.extensions.readProjection(tx, c.organizationId, c.problemId);
      const stages: WorkflowDeadlineStage[] = record.instance.currentNodeId === c.ownerNodeId ? ['ANALYSIS', 'SUBMISSION', 'CLOSURE'] : ['CLOSURE'];
      return stages.filter(stage => deadlineDueAt(c, stage) !== null && deadlineStageOpen(c, stage)
        && !requests.some(request => request.stage === stage && ['LEADER_PENDING', 'QUALITY_PENDING'].includes(request.status)));
    } catch (error) {
      if (error instanceof HttpException && ([403, 404].includes(error.getStatus()) || error.getStatus() === 409
        && (error.getResponse() as { code?: string }).code === 'WORKFLOW_ACTION_INVALID')) return [];
      throw error;
    }
  }

  async applyDeadlineExtension(tx: Prisma.TransactionClient, record: ProcessEightDRecord, stage: ProcessEightDStage, dueAt: Date): Promise<void> {
    this.date(dueAt);
    if (record.problem.closedAt || record.report.closedRevisionId || record.instance.status !== 'RUNNING') workflowError('WORKFLOW_ACTION_INVALID', 409);
    const column = stage === 'ANALYSIS' ? Prisma.sql`analysis_due_at` : stage === 'SUBMISSION' ? Prisma.sql`submission_due_at` : stage === 'CLOSURE' ? Prisma.sql`closure_due_at` : workflowError('WORKFLOW_ACTION_INVALID', 400);
    const old = stage === 'ANALYSIS' ? record.report.analysisDueAt : stage === 'SUBMISSION' ? record.report.submissionDueAt : record.report.closureDueAt;
    if (!old || dueAt <= old || stage === 'ANALYSIS' && record.report.analysisCompletedAt || stage === 'SUBMISSION' && record.report.submittedAt) workflowError('WORKFLOW_ACTION_INVALID', 409);
    const changed = await tx.$executeRaw(Prisma.sql`UPDATE process_eight_d_reports SET ${column} = ${dueAt}, version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = ${record.problem.organizationId}::uuid AND problem_id = ${record.problem.id}::uuid AND version = ${record.report.version}`);
    if (changed !== 1) workflowError('CONCURRENCY_CONFLICT', 409);
    if (stage === 'CLOSURE') await this.problems.updateDomainSummary(tx as never, { organizationId: record.problem.organizationId, id: record.problem.id,
      expectedVersion: record.problem.version, dueAt });
    await this.audit.record({ organizationId: record.problem.organizationId, action: 'PROCESS_EIGHT_D_DEADLINE_EXTENDED', resourceType: 'ProcessEightDReport',
      resourceId: record.problem.id, outcome: 'SUCCESS', traceId: randomUUID(), metadata: { status: stage, resourceVersion: record.report.version + 1,
        previousDueAt: old.toISOString(), dueAt: dueAt.toISOString() } }, tx);
    await this.outbox.enqueue({ eventKey: `process-eight-d:${record.problem.id}:deadline:${record.report.version + 1}`, aggregateType: 'ProcessEightDReport',
      aggregateId: record.problem.id, eventType: 'PROCESS_EIGHT_D_DEADLINE_EXTENDED', payload: { organizationId: record.problem.organizationId, problemId: record.problem.id, stage, dueAt: dueAt.toISOString() } }, tx);
  }

  async notificationContext(tx: Prisma.TransactionClient, organizationId: string, problemId: string): Promise<WorkflowDeadlineContext | null> {
    this.uuid(organizationId); this.uuid(problemId);
    try {
      const record = await this.lockFacts(tx, organizationId, problemId);
      if (record.problem.closedAt || record.report.closedRevisionId || record.instance.status !== 'RUNNING') return null;
      return this.deadlineContext(tx, record);
    } catch (error) {
      if (error instanceof HttpException && [403, 404, 409].includes(error.getStatus())) return null;
      throw error;
    }
  }

  async canNotifyRecipient(tx: Prisma.TransactionClient, context: WorkflowDeadlineContext, userId: string): Promise<boolean> {
    const current = await this.notificationContext(tx, context.organizationId, context.problemId);
    if (!current || canonical(current) !== canonical(context)) return false;
    const user = await tx.user.findFirst({ where: { id: userId, organizationId: context.organizationId, accountType: 'INTERNAL', status: 'ACTIVE', organization: { status: 'ACTIVE', type: 'INTERNAL' } } });
    if (!user || !await this.feature(tx, context.organizationId, userId, 'process-quality:issues:read')) return false;
    if (userId === current.ownerUserId) {
      try { await this.assertOwnerAssignment(tx, current.organizationId, userId, current.responsibleSectionDepartmentId); }
      catch (error) { if (error instanceof HttpException) return false; throw error; }
      return this.feature(tx, current.organizationId, userId, 'process-quality:issues:work');
    }
    // D/N2 selects and revalidates actual duties; this hook adds domain access without a second, late resolver lock.
    const appointment = await tx.userPosition.findFirst({ where: { organizationId: current.organizationId, userId, ...effectivePositionAssignmentWhere() } });
    return !!appointment && this.feature(tx, current.organizationId, userId, 'workflow:act');
  }

  async applyApprovedDeadlineExtension(tx: Prisma.TransactionClient, context: WorkflowDeadlineContext, stage: ProcessEightDStage, dueAt: Date): Promise<void> {
    const record = await this.lockFacts(tx, context.organizationId, context.problemId);
    if (canonical(await this.deadlineContext(tx, record)) !== canonical(context)) workflowError('CONCURRENCY_CONFLICT', 409);
    return this.applyDeadlineExtension(tx, record, stage, dueAt);
  }

  async hasReport(tx: Prisma.TransactionClient, organizationId: string, problemId: string): Promise<boolean> {
    const [row] = await tx.$queryRaw<{ present: boolean }[]>`SELECT EXISTS(SELECT 1 FROM process_eight_d_reports
      WHERE organization_id = ${organizationId}::uuid AND problem_id = ${problemId}::uuid) AS present`;
    return row?.present === true;
  }

  async taskCandidates(tx: Prisma.TransactionClient, organizationId: string, ownerUserId: string, additionalProblemIds: string[] = [], problemId?: string): Promise<{ problemId: string }[]> {
    this.uuid(organizationId); this.uuid(ownerUserId); additionalProblemIds.forEach(id => this.uuid(id)); if (problemId) this.uuid(problemId);
    return tx.$queryRaw<{ problemId: string }[]>(Prisma.sql`SELECT r.problem_id AS "problemId"
      FROM process_eight_d_reports r JOIN problem_indexes p ON p.organization_id = r.organization_id AND p.id = r.problem_id
      WHERE r.organization_id = ${organizationId}::uuid AND p.closed_at IS NULL AND p.archived_at IS NULL AND p.status NOT IN ('CLOSED', 'ARCHIVED')
        AND (p.owner_id = ${ownerUserId}::uuid ${additionalProblemIds.length ? Prisma.sql`OR r.problem_id IN (${Prisma.join(additionalProblemIds.map(id => Prisma.sql`${id}::uuid`))})` : Prisma.empty})
        ${problemId ? Prisma.sql`AND r.problem_id = ${problemId}::uuid` : Prisma.empty} ORDER BY r.problem_id`);
  }

  async reminderCandidates(cursor: string | null, limit: number): Promise<{ organizationId: string; problemId: string }[]> {
    if (cursor) this.uuid(cursor);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) workflowError('PROCESS_EIGHT_D_LIMIT_INVALID', 400);
    return this.prisma.$queryRaw<{ organizationId: string; problemId: string }[]>(Prisma.sql`SELECT r.organization_id AS "organizationId", r.problem_id AS "problemId"
      FROM process_eight_d_reports r JOIN problem_indexes p ON p.organization_id = r.organization_id AND p.id = r.problem_id
      WHERE p.closed_at IS NULL AND p.archived_at IS NULL AND p.status NOT IN ('CLOSED', 'ARCHIVED')
        ${cursor ? Prisma.sql`AND r.problem_id > ${cursor}::uuid` : Prisma.empty} ORDER BY r.problem_id LIMIT ${limit}`);
  }

  visibilityPredicate(actor: ProcessEightDActor, organizationId: string, legacy: Prisma.Sql): Prisma.Sql {
    const exists = Prisma.sql`EXISTS (SELECT 1 FROM process_eight_d_reports eight_d WHERE eight_d.organization_id = p.organization_id AND eight_d.problem_id = p.id)`;
    const read = featurePredicate(Prisma.sql`${actor.id}::uuid`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`'process-quality:issues:read'`);
    return Prisma.sql`((${exists} AND ${read} AND p.organization_id = ${organizationId}::uuid) OR (NOT ${exists} AND ${legacy}))`;
  }

  async read(actor: ProcessEightDActor, problemId: string) {
    return this.transaction(async tx => {
      const record = await this.lockRecord(tx, actor, problemId, 'READ');
      await this.authorizeRead(tx, actor, record);
      return this.reportModel(tx, actor, record);
    });
  }

  async readReport(tx: Prisma.TransactionClient, actor: ProcessEightDActor, problemId: string, revisionId?: string | null): Promise<{ record: ProcessEightDRecord; revision: ProcessEightDRevision | null; snapshot: Prisma.JsonValue }> {
    const record = await this.lockRecord(tx, actor, problemId, 'READ');
    await this.authorizeRead(tx, actor, record);
    if (revisionId) {
      const revisions = await this.revisions(tx, record);
      const revision = revisions.find(r => r.id === revisionId);
      if (!revision) workflowError('PROBLEM_REPORT_REVISION_NOT_FOUND', 404);
      const snapshot = await this.readableSnapshot(tx, actor, revision.snapshot);
      return { record, revision: { ...revision, snapshot }, snapshot };
    }
    const current = record.report.closedRevisionId;
    if (current && revisionId !== null) return this.readReport(tx, actor, problemId, current);
    return { record, revision: null, snapshot: await this.readableSnapshot(tx, actor, json(await this.fullSnapshot(tx, record)) as Prisma.JsonValue) };
  }

  async revisions(tx: Prisma.TransactionClient, record: ProcessEightDRecord): Promise<ProcessEightDRevision[]> {
    return tx.$queryRaw<ProcessEightDRevision[]>`SELECT id, problem_id AS "problemId", organization_id AS "organizationId", content_version AS "contentVersion", snapshot, recorded_at AS "recordedAt"
      FROM process_eight_d_revisions WHERE organization_id = ${record.problem.organizationId}::uuid AND problem_id = ${record.problem.id}::uuid ORDER BY recorded_at, id`;
  }

  async binding(actor: ProcessEightDActor) {
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    this.scope(actor, true); this.uuid(organizationId);
    return this.transaction(async tx => { await this.authorize(tx, actor, 'configuration:read', organizationId, 'ADMIN_CONFIGURATION'); return this.readBinding(tx, organizationId); });
  }

  async bind(actor: ProcessEightDActor, input: { expectedVersion: number; workflowDefinitionId: string; workflowVersionId: string }, key: string, traceId: string) {
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    return this.configuration(actor, organizationId, input, key, traceId, async (tx, current) => {
      await this.validateFlow(tx, organizationId, input.workflowDefinitionId, input.workflowVersionId);
      if (current) await tx.$executeRaw`UPDATE process_eight_d_bindings SET workflow_definition_id = ${input.workflowDefinitionId}::uuid,
        workflow_version_id = ${input.workflowVersionId}::uuid, enabled = false, version = version + 1, updated_by = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP
        WHERE organization_id = ${organizationId}::uuid AND version = ${input.expectedVersion}`;
      else await tx.$executeRaw`INSERT INTO process_eight_d_bindings (organization_id, workflow_definition_id, workflow_version_id, updated_by)
        VALUES (${organizationId}::uuid, ${input.workflowDefinitionId}::uuid, ${input.workflowVersionId}::uuid, ${actor.id}::uuid)`;
    });
  }

  async activate(actor: ProcessEightDActor, input: { expectedVersion: number; enabled: boolean }, key: string, traceId: string) {
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    return this.configuration(actor, organizationId, input, key, traceId, async (tx, current) => {
      if (!current) workflowError('PROCESS_EIGHT_D_CONFIGURATION_REQUIRED', 409);
      await this.validateFlow(tx, organizationId, current.workflowDefinitionId, current.workflowVersionId);
      await tx.$executeRaw`UPDATE process_eight_d_bindings SET enabled = ${input.enabled}, version = version + 1, updated_by = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP
        WHERE organization_id = ${organizationId}::uuid AND version = ${input.expectedVersion}`;
    });
  }

  async assignmentOptions(actor: ProcessEightDActor, input: ProcessEightDAssignmentOptionsQueryDto): Promise<ProcessEightDAssignmentOptionsDto> {
    this.scope(actor);
    const query = plainToInstance(ProcessEightDAssignmentOptionsQueryDto, input);
    if (validateSync(query, { whitelist: true, forbidNonWhitelisted: true }).length || query.action !== 'ISSUE' && !query.problemId
      || query.action === 'ISSUE' && query.problemId) workflowError('PROCESS_EIGHT_D_ASSIGNMENT_QUERY_INVALID', 400);
    if (query.organizationId && query.organizationId !== actor.organizationId) workflowError('ORGANIZATION_SCOPE_DENIED', 403);
    return this.transaction(async tx => {
      const record = query.problemId ? await this.lockRecord(tx, actor, query.problemId, 'READ') : null;
      let sectionId = query.sectionDepartmentId;
      const crossDepartmentReassign = query.action === 'REASSIGN' && await this.feature(tx, actor.organizationId, actor.id, 'process-quality:issues:reassign');
      if (query.action === 'REASSIGN' && !sectionId && !crossDepartmentReassign) sectionId = record!.report.responsibleSectionDepartmentId;
      const authorize = async () => {
        await this.authorize(tx, actor, 'process-quality:issues:read');
        if (query.action === 'ISSUE') await this.authorize(tx, actor, 'process-quality:issues:issue');
        else if (query.action === 'COLLABORATORS') { await this.authorizeEdit(tx, actor, record!); this.owner(actor, record!); }
        else if (crossDepartmentReassign) { await this.authorizeRead(tx, actor, record!); this.editable(record!); await this.authorize(tx, actor, 'process-quality:issues:reassign'); }
        else await this.authorizeReassignment(tx, actor, record!, sectionId!);
      };
      await authorize();
      const search = query.search?.trim(), skip = (query.page - 1) * query.pageSize;
      const departments = await this.responsibilities.workflowDepartmentOptions(tx, actor.organizationId, search, query.pageSize, skip,
        query.action === 'REASSIGN' && !crossDepartmentReassign ? record!.report.responsibleSectionDepartmentId : undefined);
      const work = featurePredicate(Prisma.sql`u.id`, Prisma.sql`${actor.organizationId}::uuid`, Prisma.sql`'process-quality:issues:work'`);
      const read = featurePredicate(Prisma.sql`u.id`, Prisma.sql`${actor.organizationId}::uuid`, Prisma.sql`'process-quality:issues:read'`);
      const pattern = `%${search?.replace(/[\\%_]/g, '\\$&') ?? ''}%`;
      const [page] = await tx.$queryRaw<{ users: ProcessEightDAssignmentOptionsDto['users']; userTotal: number }[]>(Prisma.sql`
        WITH eligible AS MATERIALIZED (SELECT u.id, u.username, u.full_name AS "fullName" FROM users u
          WHERE u.organization_id = ${actor.organizationId}::uuid AND u.account_type = 'INTERNAL' AND u.status = 'ACTIVE'
            AND ${work} AND ${read} ${search ? Prisma.sql`AND (u.username ILIKE ${pattern} OR u.full_name ILIKE ${pattern})` : Prisma.empty}
            ${query.action === 'COLLABORATORS' ? Prisma.sql`AND u.id <> ${record!.problem.ownerId}::uuid` : Prisma.empty}
            AND EXISTS (SELECT 1 FROM user_positions a JOIN positions pos ON pos.id = a.position_id
              JOIN departments dept ON dept.id = pos.department_id JOIN organizations org ON org.id = a.organization_id
              WHERE a.user_id = u.id AND a.organization_id = u.organization_id AND a.started_at <= CURRENT_TIMESTAMP AND (a.ended_at IS NULL OR a.ended_at > CURRENT_TIMESTAMP)
                AND pos.organization_id = u.organization_id AND pos.status = 'ACTIVE' AND dept.organization_id = u.organization_id AND dept.status = 'ACTIVE'
                AND org.status = 'ACTIVE' AND org.type = 'INTERNAL' ${sectionId ? Prisma.sql`AND pos.department_id = ${sectionId}::uuid` : Prisma.empty}))
        SELECT (SELECT count(*)::int FROM eligible) AS "userTotal",
          COALESCE((SELECT jsonb_agg(selected ORDER BY username, id) FROM (SELECT * FROM eligible ORDER BY username, id LIMIT ${query.pageSize} OFFSET ${skip}) selected), '[]'::jsonb) AS users`);
      await authorize();
      return { departments: departments.items, departmentTotal: departments.total, users: (page?.users ?? []).map(u => ({ id: u.id, username: u.username, fullName: u.fullName })),
        userTotal: page?.userTotal ?? 0, page: query.page, pageSize: query.pageSize };
    });
  }

  async previewSources(actor: ProcessEightDActor, input: ProcessEightDSourcePreviewInputDto): Promise<ProcessEightDSourcePreviewDto[]> {
    this.scope(actor); assertEightDSources(input.sources);
    if (input.problemId) this.uuid(input.problemId);
    const references = await Promise.all(input.sources.map(source => this.ledger.sourceReference(actor, source.defectId)));
    return this.transaction(async tx => {
      await this.authorize(tx, actor, 'process-quality:defects:read');
      await this.authorize(tx, actor, input.problemId ? 'process-quality:issues:sources' : 'process-quality:issues:issue');
      if (input.problemId) await this.authorizeRead(tx, actor, await this.lockRecord(tx, actor, input.problemId, 'READ'));
      const previews: ProcessEightDSourcePreviewDto[] = [];
      for (const [index, source] of input.sources.entries()) {
        if (references[index]!.sourceVersion !== source.expectedVersion) workflowError('SOURCE_VERSION_CONFLICT', 409);
        previews.push((await this.sourcePreview(tx, actor, source.defectId, input.problemId)).preview);
      }
      return previews;
    });
  }

  async issue(actor: ProcessEightDActor, input: Omit<IssueProcessEightDInput, 'sourceConfirmations'> & { sourceConfirmations?: ProcessEightDSourceConfirmationDto[] }, traceId: string, key: string) {
    this.scope(actor); this.key(key); assertEightDSources(input.sources);
    this.validateConfirmations(input.sources.map(s => s.defectId), input.sourceConfirmations ?? []);
    this.uuid(input.ownerUserId); this.uuid(input.responsibleSectionDepartmentId);
    if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(input.severity)) workflowError('PROCESS_ISSUE_SEVERITY_INVALID', 400);
    if (input.analysisDueAt) this.date(input.analysisDueAt);
    if (input.closureDueAt) this.date(input.closureDueAt);
    const digest = createHash('sha256').update(key).digest('hex');
    const previous = await this.prisma.outboxEvent.findUnique({ where: { eventKey: `domain-source-issue:${actor.organizationId}:${digest}` } });
    const payload = jsonObject(previous?.payload);
    const references = previous ? payload.sourceReferences as unknown as DomainSourceReference[] : await Promise.all(input.sources.map(async source => ({
      ...await this.ledger.sourceReference(actor, source.defectId), sourceVersion: source.expectedVersion,
    })));
    if (!Array.isArray(references) || references.length !== input.sources.length || references.some((s, i) => s.sourceDomain !== 'process-quality' || s.sourceType !== 'process-defect'
      || s.sourceId !== input.sources[i]!.defectId || s.sourceVersion !== input.sources[i]!.expectedVersion)) workflowError('IDEMPOTENCY_REPLAY', 409);
    const bound = previous ? jsonObject(payload.workflowBinding) : await this.transaction(async tx => {
      await this.authorize(tx, actor, 'process-quality:issues:issue');
      const binding = await this.readBinding(tx, actor.organizationId);
      if (!binding?.enabled) workflowError('PROCESS_EIGHT_D_CONFIGURATION_REQUIRED', 409);
      return binding;
    });
    const instanceKey = `eight-d:${digest}:${eightDRequestDigest(input)}`;
    const workflowDefinitionId = String(bound.workflowDefinitionId), workflowVersionId = String(bound.workflowVersionId);
    const confirmedSources: ProcessEightDSourceConfirmation[] = [];
    const result = await this.domainIssues.issue({ organizationId: actor.organizationId, actor, source: references[0]!, additionalSources: references.slice(1),
      problemType: 'PROCESS_DEFECT', responseForm: 'EIGHT_D', responsibleScope: 'process-quality', severity: input.severity, ownerId: input.ownerUserId,
      dueAt: input.closureDueAt, idempotencyKey: key, traceId, workflowBinding: { workflowDefinitionId, workflowVersionId, instanceKey } }, {
      authorize: async (tx, _command, replay) => {
        await this.authorize(tx, actor, 'process-quality:issues:issue');
        await this.authorize(tx, actor, 'process-quality:defects:read');
        if (replay) return;
        const current = await this.readBinding(tx, actor.organizationId, true);
        if (!current?.enabled || current.workflowDefinitionId !== workflowDefinitionId || current.workflowVersionId !== workflowVersionId) workflowError('PROCESS_EIGHT_D_CONFIGURATION_REQUIRED', 409);
        await this.validateFlow(tx, actor.organizationId, workflowDefinitionId, workflowVersionId);
        await this.assertOwnerAssignment(tx, actor.organizationId, input.ownerUserId, input.responsibleSectionDepartmentId);
        if (!await this.eligibleWorker(tx, actor.organizationId, input.ownerUserId)) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
      },
      lockAndResolve: async (tx, reference) => {
        const source = await this.ledger.lockAndResolve(tx, reference);
        const confirmed = await this.confirmSourcePreview(tx, actor, reference.sourceId, input.sourceConfirmations ?? []);
        if (confirmed) confirmedSources.push(confirmed);
        return source;
      },
      bindWorkflow: async (tx, binding) => {
        // Source waits can outlive an appointment; the user lock also fences authorization writers.
        await this.lockUsers(tx, actor.organizationId, [input.ownerUserId]);
        await this.assertOwnerAssignment(tx, actor.organizationId, input.ownerUserId, input.responsibleSectionDepartmentId);
        if (!await this.eligibleWorker(tx, actor.organizationId, input.ownerUserId)) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
        const instance = await this.runtime.startInstance({ organizationId: binding.organizationId, actor,
          problemIndexId: binding.problemIndexId, expectedProblemVersion: binding.expectedProblemVersion, workflowDefinitionId, workflowVersionId,
          instanceKey, idempotencyKey: key, traceId }, tx, undefined, tx => this.authorize(tx, actor, 'process-quality:issues:issue'));
        await tx.$executeRaw`INSERT INTO process_eight_d_reports (problem_id, organization_id, responsible_section_department_id, professional_user_id,
          document, analysis_due_at, closure_due_at, created_by, updated_by) VALUES (${binding.problemIndexId}::uuid, ${actor.organizationId}::uuid,
          ${input.responsibleSectionDepartmentId}::uuid, ${actor.id}::uuid, ${JSON.stringify(emptyProcessEightDDocument())}::jsonb,
          ${input.analysisDueAt ?? null}, ${input.closureDueAt ?? null}, ${actor.id}::uuid, ${actor.id}::uuid)`;
        await this.confirmations(tx, actor, binding.problemIndexId, confirmedSources);
        await this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.id, action: 'PROCESS_EIGHT_D_ISSUED', resourceType: 'ProcessEightDReport',
          resourceId: binding.problemIndexId, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: 1 } }, tx);
        return instance;
      },
    });
    return { problem: result.problem, replayed: result.replayed };
  }

  async save(actor: ProcessEightDActor, problemId: string, input: SaveProcessEightDInput, traceId: string, key: string) {
    let document;
    try { document = normalizeProcessEightDDocument(input.document); }
    catch (error) { if (error instanceof ProcessEightDDocumentError) throw new ControlledValidationException('PROCESS_EIGHT_D_DOCUMENT_INVALID', error.issues); throw error; }
    return this.command(actor, problemId, input, 'SAVE', key, traceId, async (tx, record) => {
      await this.authorizeEdit(tx, actor, record);
      await this.assertEvidence(tx, actor, record, documentFileIds(document), false);
      if (canonical(document) === canonical(record.report.document)) return;
      const plan = (d: typeof document) => ({ analysisProcess: d.analysisProcess, occurrenceCause: d.occurrenceCause, escapeCause: d.escapeCause, systemCause: d.systemCause,
        analysisFileIds: d.analysisFileIds, correctiveActions: d.correctiveActions.map(a => ({ id: a.id, causeKind: a.causeKind, action: a.action, owner: a.owner, plannedAt: a.plannedAt, verificationMethod: a.verificationMethod })) });
      const analysisChanged = canonical(plan(document)) !== canonical(plan(record.report.document));
      await this.updateReport(tx, actor, record, Prisma.sql`document = ${JSON.stringify(document)}::jsonb,
        analysis_completed_at = ${analysisChanged ? null : record.report.analysisCompletedAt}::timestamptz`, true);
    }, [], tx => this.lockEvidence(tx, documentFileIds(document)));
  }

  async analysisComplete(actor: ProcessEightDActor, problemId: string, input: ProcessEightDAnalysisCompleteDto, traceId: string, key: string) {
    this.date(input.submissionDueAt);
    return this.command(actor, problemId, input, 'ANALYSIS_COMPLETE', key, traceId, async (tx, record) => {
      await this.authorizeEdit(tx, actor, record); this.owner(actor, record);
      if (record.report.submissionDueAt && record.report.submissionDueAt.getTime() !== input.submissionDueAt.getTime()) workflowError('PROCESS_EIGHT_D_EXTENSION_REQUIRED', 409);
      if (record.report.analysisCompletedAt) return;
      const issues = analysisCompletionIssues(record.report.document);
      if (issues.length) throw new ControlledValidationException('PROCESS_EIGHT_D_ANALYSIS_INCOMPLETE', issues);
      await this.assertEvidence(tx, actor, record, documentFileIds(record.report.document), false);
      await this.updateReport(tx, actor, record, Prisma.sql`analysis_completed_at = CURRENT_TIMESTAMP, submission_due_at = COALESCE(submission_due_at, ${input.submissionDueAt})`, false);
    }, [], (tx, record) => this.lockEvidence(tx, documentFileIds(record.report.document)));
  }

  async collaborators(actor: ProcessEightDActor, problemId: string, input: ProcessEightDVersionInput & { userIds: string[] }, traceId: string, key: string) {
    if (!Array.isArray(input.userIds) || input.userIds.length > 100 || new Set(input.userIds).size !== input.userIds.length) workflowError('PROCESS_EIGHT_D_COLLABORATORS_INVALID', 400);
    input.userIds.forEach(id => this.uuid(id));
    return this.command(actor, problemId, input, 'COLLABORATORS', key, traceId, async (tx, record) => {
      await this.authorizeEdit(tx, actor, record); this.owner(actor, record);
      for (const userId of input.userIds) if (userId === record.problem.ownerId || !await this.eligibleWorker(tx, actor.organizationId, userId)) workflowError('PROCESS_EIGHT_D_COLLABORATOR_INVALID', 400);
      if (canonical([...input.userIds].sort()) === canonical(record.collaboratorUserIds)) return;
      await tx.$executeRaw`DELETE FROM process_eight_d_collaborators WHERE organization_id = ${actor.organizationId}::uuid AND problem_id = ${problemId}::uuid`;
      for (const userId of [...input.userIds].sort()) await tx.$executeRaw`INSERT INTO process_eight_d_collaborators (organization_id, problem_id, user_id, added_by)
        VALUES (${actor.organizationId}::uuid, ${problemId}::uuid, ${userId}::uuid, ${actor.id}::uuid)`;
      await this.updateReport(tx, actor, record, Prisma.sql`updated_by = ${actor.id}::uuid`, true);
    }, input.userIds);
  }

  async reassign(actor: ProcessEightDActor, problemId: string, input: ReassignProcessEightDDto, traceId: string, key: string) {
    this.uuid(input.ownerUserId); this.uuid(input.responsibleSectionDepartmentId); this.reason(input.reason);
    return this.command(actor, problemId, input, 'REASSIGN', key, traceId, async (tx, record) => {
      const access = await this.authorizeReassignment(tx, actor, record, input.responsibleSectionDepartmentId);
      await this.assertOwnerAssignment(tx, actor.organizationId, input.ownerUserId, input.responsibleSectionDepartmentId);
      if (!await this.eligibleWorker(tx, actor.organizationId, input.ownerUserId)) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
      await this.problems.updateDomainSummary(tx as never, { organizationId: actor.organizationId, id: problemId, expectedVersion: record.problem.version,
        ownerId: input.ownerUserId, updatedById: actor.id, traceId });
      await tx.$executeRaw`DELETE FROM process_eight_d_collaborators WHERE organization_id = ${actor.organizationId}::uuid AND problem_id = ${problemId}::uuid AND user_id = ${input.ownerUserId}::uuid`;
      await this.updateReport(tx, actor, record, Prisma.sql`responsible_section_department_id = ${input.responsibleSectionDepartmentId}::uuid`, true);
      return access;
    }, [input.ownerUserId]);
  }

  async risk(actor: ProcessEightDActor, problemId: string, input: ProcessEightDRiskDto, traceId: string, key: string) {
    this.reason(input.reason);
    if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(input.severity)) workflowError('PROCESS_ISSUE_SEVERITY_INVALID', 400);
    return this.command(actor, problemId, input, 'RISK', key, traceId, async (tx, record) => {
      await this.authorizeRead(tx, actor, record); await this.authorize(tx, actor, 'process-quality:issues:risk');
      this.notClosed(record);
      if (record.problem.severity === input.severity) return;
      record = await this.cancelBeforeChange(tx, actor, record, input.confirmCancelApproval === true, input.reason?.trim() || 'PROCESS_EIGHT_D_RISK_CHANGED', key, traceId);
      await this.problems.updateDomainSummary(tx as never, { organizationId: actor.organizationId, id: problemId, expectedVersion: record.problem.version,
        severity: input.severity, updatedById: actor.id, traceId });
      await this.updateReport(tx, actor, record, Prisma.sql`updated_by = ${actor.id}::uuid`, true);
    });
  }

  async sources(actor: ProcessEightDActor, problemId: string, input: ProcessEightDSourcesDto, traceId: string, key: string) {
    this.reason(input.reason);
    if (!Array.isArray(input.add) || !Array.isArray(input.removeDefectIds) || input.removeDefectIds.length > 100) workflowError('PROCESS_EIGHT_D_SOURCES_INVALID', 400);
    if (input.add.length) assertEightDSources(input.add);
    input.removeDefectIds.forEach(id => this.uuid(id));
    if (input.primaryDefectId) this.uuid(input.primaryDefectId);
    this.validateConfirmations(input.add.map(s => s.defectId), input.sourceConfirmations ?? []);
    const add = await Promise.all(input.add.map(async source => ({ ...await this.ledger.sourceReference(actor, source.defectId), sourceVersion: source.expectedVersion })));
    const confirmedSources: ProcessEightDSourceConfirmation[] = [];
    return this.command(actor, problemId, input, 'SOURCES', key, traceId, async (tx, record) => {
      await this.authorizeRead(tx, actor, record); await this.authorize(tx, actor, 'process-quality:issues:sources');
      await this.authorize(tx, actor, 'process-quality:defects:read');
      if (record.report.closedRevisionId && (input.removeDefectIds.length || input.primaryDefectId || !add.length)) workflowError('PROCESS_EIGHT_D_CLOSED_SOURCES_APPEND_ONLY', 409);
      const old = await tx.domainSourceIssueLink.findMany({ where: { organizationId: actor.organizationId, problemIndexId: problemId, removedAt: null } });
      if (old.length + add.length - input.removeDefectIds.length > 100) workflowError('PROCESS_EIGHT_D_SOURCES_INVALID', 400);
      record = await this.cancelBeforeChange(tx, actor, record, input.confirmCancelApproval === true, input.reason?.trim() || 'PROCESS_EIGHT_D_SOURCES_CHANGED', key, traceId);
      const identity = (id: string) => ({ sourceDomain: 'process-quality', sourceType: 'process-defect', sourceId: id });
      await this.links.change({ organizationId: actor.organizationId, problemIndexId: problemId, actor, expectedProblemVersion: record.problem.version, add,
        remove: input.removeDefectIds.map(identity), ...(input.primaryDefectId ? { primary: identity(input.primaryDefectId) } : {}),
        idempotencyKey: `8d-sources:${createHash('sha256').update(key).digest('hex')}`, traceId }, {
        authorize: async tx => { await this.authorizeRead(tx, actor, record); await this.authorize(tx, actor, 'process-quality:issues:sources'); },
        lockAndResolve: async (tx, source) => {
          const found = await this.ledger.lockAndResolve(tx, source);
          const confirmed = await this.confirmSourcePreview(tx, actor, source.sourceId, input.sourceConfirmations ?? [], problemId);
          if (confirmed) confirmedSources.push(confirmed);
          return found;
        },
      }, tx);
      await this.confirmations(tx, actor, problemId, confirmedSources);
      await this.updateReport(tx, actor, record, Prisma.sql`updated_by = ${actor.id}::uuid`, !record.report.closedRevisionId);
    }, [], async tx => { for (const source of [...add].sort((a, b) => a.sourceId.localeCompare(b.sourceId))) await this.ledger.lockAndResolve(tx, source); });
  }

  async deadlines(actor: ProcessEightDActor, problemId: string, input: ProcessEightDDeadlinesDto, traceId: string, key: string) {
    if (!input.analysisDueAt && !input.closureDueAt) workflowError('PROCESS_EIGHT_D_DUE_AT_REQUIRED', 400);
    if (input.analysisDueAt) this.date(input.analysisDueAt);
    if (input.closureDueAt) this.date(input.closureDueAt);
    return this.command(actor, problemId, input, 'DEADLINES', key, traceId, async (tx, record) => {
      await this.authorizeRead(tx, actor, record); await this.authorize(tx, actor, 'process-quality:issues:deadlines'); this.notClosed(record);
      if (input.analysisDueAt && (record.report.analysisDueAt || record.report.analysisCompletedAt) || input.closureDueAt && record.report.closureDueAt) workflowError('PROCESS_EIGHT_D_EXTENSION_REQUIRED', 409);
      await this.updateReport(tx, actor, record, Prisma.sql`analysis_due_at = COALESCE(${input.analysisDueAt ?? null}::timestamptz, analysis_due_at),
        closure_due_at = COALESCE(${input.closureDueAt ?? null}::timestamptz, closure_due_at)`, false);
      if (input.closureDueAt) await this.problems.updateDomainSummary(tx as never, { organizationId: actor.organizationId, id: problemId,
        expectedVersion: record.problem.version, dueAt: input.closureDueAt, updatedById: actor.id, traceId });
    });
  }

  async submit(actor: ProcessEightDActor, problemId: string, input: ProcessEightDVersionInput, traceId: string, key: string) {
    return this.command(actor, problemId, input, 'SUBMIT', key, traceId, async (tx, record) => {
      await this.authorizeEdit(tx, actor, record); this.owner(actor, record);
      await this.authorize(tx, actor, 'workflow:act');
      const issues = submissionIssues(record.report.document);
      if (!record.report.analysisCompletedAt || !record.report.submissionDueAt) issues.push({ path: 'analysisCompletedAt', message: '需由负责人先确认分析完成并明确完整提交计划' });
      if (issues.length) throw new ControlledValidationException('PROCESS_EIGHT_D_SUBMISSION_INCOMPLETE', issues);
      await this.assertEvidence(tx, actor, record, documentFileIds(record.report.document));
      const edges = await tx.workflowTransition.findMany({ where: { organizationId: actor.organizationId, workflowVersionId: record.instance.workflowVersionId, fromNodeId: record.node.id, action: 'SUBMIT' }, include: { toNode: true } });
      if (edges.length !== 1 || !isClosureReviewNode(edges[0]!.toNode) || !matchesCondition(edges[0]!.condition, record.problem)) workflowError('WORKFLOW_TRANSITION_AMBIGUOUS', 409);
      await this.updateReport(tx, actor, record, Prisma.sql`submitted_at = CURRENT_TIMESTAMP`, false);
      await this.move(tx, record, edges[0]!.toNode, 'SUBMIT', actor.id, traceId);
      record = await this.lockRecord(tx, actor, problemId, 'SUBMIT');
      await this.rounds.start(actor, problemId, { expectedContentVersion: record.report.contentVersion, expectedInstanceVersion: record.instance.version },
        `8d-submit:${createHash('sha256').update(key).digest('hex')}`, traceId, tx);
    }, [], (tx, record) => this.lockEvidence(tx, documentFileIds(record.report.document)));
  }

  async closureContext(tx: Prisma.TransactionClient, actor: ProcessEightDActor, problemId: string, operation: WorkflowClosureOperation): Promise<WorkflowClosureContext> {
    const record = await this.lockRecord(tx, actor, problemId, operation === 'READ' ? 'READ' : operation);
    await this.authorizeRead(tx, actor, record);
    if (operation === 'SUBMIT') { this.owner(actor, record); await this.authorize(tx, actor, 'process-quality:issues:work'); await this.assertOwnerAssignment(tx, actor.organizationId, actor.id, record.report.responsibleSectionDepartmentId); }
    if (operation === 'CANCEL') {
      const owner = actor.id === record.problem.ownerId && await this.feature(tx, actor.organizationId, actor.id, 'process-quality:issues:work');
      const change = await this.feature(tx, actor.organizationId, actor.id, 'process-quality:issues:risk') || await this.feature(tx, actor.organizationId, actor.id, 'process-quality:issues:sources');
      if (!owner && !change) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
    }
    return this.contextFromRecord(tx, record);
  }

  async complete(tx: Prisma.TransactionClient, context: WorkflowClosureContext, actor?: ProcessEightDActor): Promise<void> {
    const record = await this.lockFacts(tx, context.organizationId, context.problemId);
    await this.assertContext(tx, record, context);
    if (!actor) workflowError('PROCESS_EIGHT_D_TRANSITION_ACTOR_REQUIRED', 409);
    await this.authorizeRead(tx, actor, record); await this.authorize(tx, actor, 'workflow:act');
    const round = await this.rounds.readProjection(tx, context.organizationId, context.problemId);
    if (!round || round.status !== 'APPROVED' || round.contentVersion !== context.contentVersion || canonical(round.contentSnapshot) !== canonical(context.content)
      || !round.duties.some(d => d.duty === 'PROFESSIONAL' && d.status === 'APPROVED') || !round.duties.every(d => ['APPROVED', 'SKIPPED_SAME_PERSON'].includes(d.status))) workflowError('WORKFLOW_ACTION_INVALID', 409);
    this.notClosed(record);
    const fileIds = documentFileIds(record.report.document);
    if (fileIds.length > PROCESS_EIGHT_D_MAX_FILES) throw new ControlledValidationException('PROCESS_EIGHT_D_SUBMISSION_INCOMPLETE',
      [{ path: 'fileIds', message: `正文最多关联 ${PROCESS_EIGHT_D_MAX_FILES} 个不同附件` }]);
    const end = await tx.workflowNode.findMany({ where: { organizationId: context.organizationId, workflowVersionId: context.workflowVersionId, type: 'CLOSE' } });
    if (end.length !== 1 || jsonObject(end[0]!.config).isEnd !== true) workflowError('WORKFLOW_TRANSITION_AMBIGUOUS', 409);
    const actorId = actor.id;
    if (!round.duties.some(d => d.decidedBy === actorId && d.status === 'APPROVED')) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
    const id = randomUUID();
    const evidence = await this.evidenceSnapshot(tx, record, fileIds);
    await this.move(tx, record, end[0]!, 'CLOSE', actorId, randomUUID(), true);
    const closedRecord = await this.lockFacts(tx, context.organizationId, context.problemId);
    const snapshot = { ...await this.fullSnapshot(tx, closedRecord), rowVersion: record.report.version + 1, closedRevisionId: id, approval: round, evidence };
    await tx.$executeRaw`INSERT INTO process_eight_d_revisions (id, organization_id, problem_id, content_version, snapshot)
      VALUES (${id}::uuid, ${context.organizationId}::uuid, ${context.problemId}::uuid, ${context.contentVersion}, ${JSON.stringify(snapshot)}::jsonb)`;
    const changed = await tx.$executeRaw`UPDATE process_eight_d_reports SET closed_revision_id = ${id}::uuid, version = version + 1,
      updated_by = ${actorId}::uuid, updated_at = CURRENT_TIMESTAMP WHERE organization_id = ${context.organizationId}::uuid
      AND problem_id = ${context.problemId}::uuid AND version = ${record.report.version} AND closed_revision_id IS NULL`;
    if (changed !== 1) workflowError('CONCURRENCY_CONFLICT', 409);
    await this.audit.record({ organizationId: context.organizationId, actorUserId: actorId, action: 'PROCESS_EIGHT_D_CLOSED', resourceType: 'ProcessEightDRevision', resourceId: id,
      outcome: 'SUCCESS', traceId: randomUUID(), metadata: { problemId: context.problemId, resourceVersion: context.contentVersion } }, tx);
  }

  async returnForChanges(tx: Prisma.TransactionClient, context: WorkflowClosureContext, actor?: ProcessEightDActor): Promise<void> {
    const record = await this.lockFacts(tx, context.organizationId, context.problemId);
    await this.assertContext(tx, record, context);
    if (!actor) workflowError('PROCESS_EIGHT_D_TRANSITION_ACTOR_REQUIRED', 409);
    await this.authorizeRead(tx, actor, record); await this.authorize(tx, actor, 'workflow:act');
    const round = await this.rounds.readProjection(tx, context.organizationId, context.problemId);
    if (!round || !['RETURNED', 'CANCELLED'].includes(round.status)) workflowError('WORKFLOW_ACTION_INVALID', 409);
    const actorId = actor.id;
    await this.move(tx, record, await this.ownerNode(tx, record), 'RETURN', actorId, randomUUID());
    // Keep completed analysis and all collaborators; the next real content edit invalidates analysis completion.
    await tx.$executeRaw`UPDATE process_eight_d_reports SET submitted_at = NULL, version = version + 1, updated_by = ${actorId}::uuid, updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = ${context.organizationId}::uuid AND problem_id = ${context.problemId}::uuid AND version = ${record.report.version}`;
  }

  async canNotifyClosureRecipient(tx: Prisma.TransactionClient, context: WorkflowClosureContext, userId: string): Promise<boolean> {
    try {
      const record = await this.lockFacts(tx, context.organizationId, context.problemId);
      await this.assertContext(tx, record, context);
      const user = await tx.user.findFirst({ where: { id: userId, organizationId: context.organizationId, accountType: 'INTERNAL', status: 'ACTIVE', organization: { status: 'ACTIVE' } } });
      return !!user && !record.problem.closedAt && await this.feature(tx, context.organizationId, userId, 'process-quality:issues:read');
    } catch (error) { if (error instanceof HttpException && [403, 404, 409].includes(error.getStatus())) return false; throw error; }
  }

  async allowedActions(tx: Prisma.TransactionClient, actor: ProcessEightDActor, record: ProcessEightDRecord): Promise<string[]> {
    const actions = ['read'];
    if (record.problem.archivedAt || record.problem.status === 'ARCHIVED' || record.problem.organizationId !== actor.organizationId) return actions;
    if ((await this.deadlineRequestStages(tx, actor, record)).length) actions.push('request-extension');
    if (!record.report.closedRevisionId && record.instance.status === 'RUNNING') {
      if (!isClosureReviewNode(record.node)) {
        try { await this.authorizeEdit(tx, actor, record); actions.push('save'); if (actor.id === record.problem.ownerId) actions.push('analysis-complete', 'submit', 'collaborators', 'reassign'); }
        catch (error) { if (!(error instanceof HttpException) || ![403, 409].includes(error.getStatus())) throw error; }
        if (actor.id !== record.problem.ownerId && await this.feature(tx, actor.organizationId, actor.id, 'process-quality:issues:work')) {
          const management = await this.responsibilities.resolveManagementResponsibilities(tx, actor.organizationId, record.report.responsibleSectionDepartmentId);
          const valid = await this.responsibilities.revalidateLockedManagementResponsibilities(tx, management, new Date());
          if (management.responsibilities.some(r => r.userId === actor.id && valid.has(r.bindingId))) actions.push('reassign');
        }
      }
      for (const action of ['risk', 'sources', 'deadlines', 'reassign']) if (await this.feature(tx, actor.organizationId, actor.id, `process-quality:issues:${action}`)) {
        if (action !== 'reassign' || !isClosureReviewNode(record.node)) actions.push(action);
      }
    } else if (record.report.closedRevisionId && await this.feature(tx, actor.organizationId, actor.id, 'process-quality:issues:sources')) actions.push('sources');
    return [...new Set(actions)];
  }

  async reportModel(tx: Prisma.TransactionClient, actor: ProcessEightDActor, record: ProcessEightDRecord) {
    const { problem, instance, report } = record;
    const sources = await tx.domainSourceIssueLink.findMany({ where: { organizationId: problem.organizationId, problemIndexId: problem.id, removedAt: null }, orderBy: { sourceId: 'asc' } });
    return { problemId: problem.id, reportNumber: problem.reportNumber, organizationId: problem.organizationId, instanceId: instance.id, workflowVersionId: instance.workflowVersionId,
      instanceVersion: instance.version, problemVersion: problem.version, version: report.version, contentVersion: report.contentVersion,
      status: report.closedRevisionId ? 'CLOSED' : isClosureReviewNode(record.node) ? 'IN_REVIEW' : 'PROCESSING', severity: problem.severity,
      ownerUserId: problem.ownerId!, professionalUserId: report.professionalUserId, responsibleSectionDepartmentId: report.responsibleSectionDepartmentId,
      collaboratorUserIds: record.collaboratorUserIds, document: report.document, analysisCompletedAt: iso(report.analysisCompletedAt), analysisDueAt: iso(report.analysisDueAt),
      submissionDueAt: iso(report.submissionDueAt), closureDueAt: iso(report.closureDueAt), submittedAt: iso(report.submittedAt), closedRevisionId: report.closedRevisionId,
      sources: sources.map(s => ({ defectId: s.sourceId, sourceVersion: s.sourceVersion, snapshot: s.sourceSnapshot, primary: s.sourceId === problem.sourceId })),
      revisions: (await this.revisions(tx, record)).map(r => ({ id: r.id, contentVersion: r.contentVersion, recordedAt: r.recordedAt.toISOString() })),
      allowedActions: await this.allowedActions(tx, actor, record) };
  }

  private async fullSnapshot(tx: Prisma.TransactionClient, record: ProcessEightDRecord) {
    const sourceConfirmations = await tx.$queryRaw<Prisma.JsonObject[]>`SELECT defect_id AS "defectId", related_problem_ids AS "relatedProblemIds", recurrence, reason,
      actor_user_id AS "actorUserId", recorded_at AS "recordedAt" FROM process_eight_d_source_confirmations
      WHERE organization_id = ${record.problem.organizationId}::uuid AND problem_id = ${record.problem.id}::uuid ORDER BY recorded_at, id`;
    return { ...await this.contentSnapshot(tx, record), problem: json(record.problem), instance: json(record.instance),
      deadlines: { analysisDueAt: iso(record.report.analysisDueAt), submissionDueAt: iso(record.report.submissionDueAt), closureDueAt: iso(record.report.closureDueAt) },
      analysisCompletedAt: iso(record.report.analysisCompletedAt), submittedAt: iso(record.report.submittedAt),
      sourceConfirmations: json(sourceConfirmations), approvalRounds: json(await this.rounds.readHistoryProjection(tx, record.problem.organizationId, record.problem.id)),
      contentVersion: record.report.contentVersion, rowVersion: record.report.version };
  }

  private async contentSnapshot(tx: Prisma.TransactionClient, record: ProcessEightDRecord) {
    const sources = await tx.domainSourceIssueLink.findMany({ where: { organizationId: record.problem.organizationId, problemIndexId: record.problem.id, removedAt: null }, orderBy: [{ sourceDomain: 'asc' }, { sourceType: 'asc' }, { sourceId: 'asc' }] });
    return { document: json(record.report.document), severity: record.problem.severity, ownerUserId: record.problem.ownerId,
      professionalUserId: record.report.professionalUserId, responsibleSectionDepartmentId: record.report.responsibleSectionDepartmentId,
      collaboratorUserIds: record.collaboratorUserIds, primarySourceId: record.problem.sourceId,
      sources: sources.map(s => ({ sourceDomain: s.sourceDomain, sourceType: s.sourceType, sourceId: s.sourceId, sourceVersion: s.sourceVersion, sourceSnapshot: s.sourceSnapshot })) };
  }

  private async contextFromRecord(tx: Prisma.TransactionClient, record: ProcessEightDRecord): Promise<WorkflowClosureContext> {
    if (!record.problem.ownerId || !['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(record.problem.severity)) workflowError('WORKFLOW_ACTION_INVALID', 409);
    return { organizationId: record.problem.organizationId, problemId: record.problem.id, instanceId: record.instance.id, workflowVersionId: record.instance.workflowVersionId,
      currentNodeId: record.node.id, instanceVersion: record.instance.version, contentVersion: record.report.contentVersion,
      content: json(await this.contentSnapshot(tx, record)), policy: 'INTERNAL', severity: record.problem.severity as WorkflowClosureContext['severity'],
      ownerUserId: record.problem.ownerId, professionalUserId: record.report.professionalUserId, responsibleSectionDepartmentId: record.report.responsibleSectionDepartmentId };
  }

  private async assertContext(tx: Prisma.TransactionClient, record: ProcessEightDRecord, context: WorkflowClosureContext) {
    if (canonical(await this.contextFromRecord(tx, record)) !== canonical(context)) workflowError('CONCURRENCY_CONFLICT', 409);
  }

  private async cancelBeforeChange(tx: Prisma.TransactionClient, actor: ProcessEightDActor, record: ProcessEightDRecord, confirmed: boolean, reason: string, key: string, traceId: string) {
    if (!isClosureReviewNode(record.node)) return record;
    if (!confirmed) workflowError('PROCESS_EIGHT_D_CANCEL_APPROVAL_CONFIRMATION_REQUIRED', 409);
    const round = await this.rounds.readProjection(tx, actor.organizationId, record.problem.id);
    if (!round || round.status !== 'PENDING') workflowError('CONCURRENCY_CONFLICT', 409);
    await this.rounds.cancel(actor, round.id, { expectedRoundVersion: round.version, reason }, `8d-cancel:${createHash('sha256').update(key).digest('hex')}`, traceId, tx);
    return this.lockRecord(tx, actor, record.problem.id, 'EDIT');
  }

  private async command(actor: ProcessEightDActor, problemId: string, input: ProcessEightDVersionInput, action: string, key: string, traceId: string,
    work: (tx: Prisma.TransactionClient, record: ProcessEightDRecord) => Promise<void | ReassignmentAccess>, additionalUserIds: string[] = [],
    lockDomain?: (tx: Prisma.TransactionClient, record: ProcessEightDRecord) => Promise<void>) {
    this.key(key); this.scope(actor);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) workflowError('CONCURRENCY_CONFLICT', 400);
    const digest = eightDRequestDigest({ problemId, action, input });
    return this.transaction(async tx => {
      const record = await this.lockRecord(tx, actor, problemId, 'EDIT');
      await lockDomain?.(tx, record);
      await this.lockUsers(tx, actor.organizationId, [actor.id, record.problem.ownerId!, record.report.professionalUserId, ...record.collaboratorUserIds, ...additionalUserIds]);
      await this.authorizeRead(tx, actor, record);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`process-eight-d:${actor.organizationId}:${actor.id}:${key}`}, 0))::text`;
      const replay = await this.receipt(tx, actor, key, digest);
      if (replay) {
        const stored = jsonObject(replay) as Prisma.JsonObject;
        await this.replayAccess(tx, actor, record, action, stored.reassignmentAccess);
        return action === 'REASSIGN' ? stored.response! : replay;
      }
      if (record.report.version !== input.expectedVersion) workflowError('CONCURRENCY_CONFLICT', 409);
      const reassignmentAccess = await work(tx, record);
      const current = await this.lockRecord(tx, actor, problemId, 'READ');
      await this.authorizeRead(tx, actor, current);
      const response = await this.reportModel(tx, actor, current);
      await this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.id, action: `PROCESS_EIGHT_D_${action}`, resourceType: 'ProcessEightDReport',
        resourceId: problemId, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: current.report.version, contentVersion: current.report.contentVersion,
          ...(typeof (input as { reason?: string }).reason === 'string' ? { reason: (input as { reason?: string }).reason! } : {}) } }, tx);
      await this.outbox.enqueue({ eventKey: `process-eight-d:${problemId}:${action}:${createHash('sha256').update(key).digest('hex')}`, eventType: 'PROCESS_EIGHT_D_CHANGED', aggregateType: 'ProcessEightDReport', aggregateId: problemId,
        payload: { organizationId: actor.organizationId, problemId, rowVersion: current.report.version, contentVersion: current.report.contentVersion, action,
          ...(action === 'RISK' ? { riskChange: { actorUserId: actor.id, previousSeverity: record.problem.severity, severity: current.problem.severity,
            reason: (input as ProcessEightDRiskDto).reason ?? null } } : {}) } }, tx);
      // Keep the original authorization route private; never replace it with a different grant on replay.
      await this.storeReceipt(tx, actor, key, digest, action === 'REASSIGN' ? { response, reassignmentAccess } : response);
      return response;
    });
  }

  private async replayAccess(tx: Prisma.TransactionClient, actor: ProcessEightDActor, record: ProcessEightDRecord, action: string, reassignmentAccess?: Prisma.JsonValue) {
    if (action === 'REASSIGN') {
      const access = jsonObject(reassignmentAccess);
      if (!['OWNER', 'MANAGEMENT', 'CROSS_DEPARTMENT'].includes(String(access.kind)) || typeof access.sectionDepartmentId !== 'string'
        || access.kind !== 'CROSS_DEPARTMENT' && access.sectionDepartmentId !== record.report.responsibleSectionDepartmentId) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
      await this.authorizeReassignment(tx, actor, record, record.report.responsibleSectionDepartmentId, access.kind as ReassignmentAccess['kind']);
      return;
    }
    const permission: Record<string, string> = { RISK: 'risk', SOURCES: 'sources', DEADLINES: 'deadlines' };
    if (permission[action]) await this.authorize(tx, actor, `process-quality:issues:${permission[action]}`);
    else {
      await this.authorize(tx, actor, 'process-quality:issues:work');
      if (action === 'SAVE' && actor.id !== record.problem.ownerId) {
        if (!record.collaboratorUserIds.includes(actor.id) || !await this.eligibleWorker(tx, actor.organizationId, actor.id)) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
      } else { this.owner(actor, record); await this.assertOwnerAssignment(tx, actor.organizationId, actor.id, record.report.responsibleSectionDepartmentId); }
    }
  }

  private async updateReport(tx: Prisma.TransactionClient, actor: ProcessEightDActor, record: ProcessEightDRecord, fields: Prisma.Sql, content: boolean) {
    if (record.report.version === 2_147_483_647 || content && record.report.contentVersion === 2_147_483_647) workflowError('CONCURRENCY_CONFLICT', 409);
    const changed = await tx.$executeRaw(Prisma.sql`UPDATE process_eight_d_reports SET ${fields}, version = version + 1,
      ${content ? Prisma.sql`content_version = content_version + 1,` : Prisma.empty} updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = ${actor.organizationId}::uuid AND problem_id = ${record.problem.id}::uuid AND version = ${record.report.version}`);
    if (changed !== 1) workflowError('CONCURRENCY_CONFLICT', 409);
    await tx.$executeRaw`UPDATE process_eight_d_reports SET updated_by = ${actor.id}::uuid WHERE organization_id = ${actor.organizationId}::uuid AND problem_id = ${record.problem.id}::uuid`;
  }

  private async move(tx: Prisma.TransactionClient, record: ProcessEightDRecord, target: WorkflowNode, action: string, actorId: string, traceId: string, closing = false) {
    const transitions = await tx.workflowTransition.findMany({ where: { organizationId: record.problem.organizationId, workflowVersionId: record.instance.workflowVersionId,
      fromNodeId: record.node.id, toNodeId: target.id, action: closing ? 'APPROVE' : action } });
    if (transitions.length !== 1 || !matchesCondition(transitions[0]!.condition, record.problem)) workflowError('WORKFLOW_TRANSITION_AMBIGUOUS', 409);
    const user = await tx.user.findFirst({ where: { id: actorId, organizationId: record.problem.organizationId, accountType: 'INTERNAL', status: 'ACTIVE' } });
    if (!user) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
    const changed = await tx.workflowInstance.updateMany({ where: { id: record.instance.id, organizationId: record.problem.organizationId, version: record.instance.version, status: 'RUNNING', currentNodeId: record.node.id },
      data: { currentNodeId: target.id, status: closing ? 'COMPLETED' : 'RUNNING', version: { increment: 1 }, updatedById: actorId } });
    if (changed.count !== 1) workflowError('CONCURRENCY_CONFLICT', 409);
    const problemVersion = await this.problems.applyWorkflowState(tx, { organizationId: record.problem.organizationId, id: record.problem.id, expectedVersion: record.problem.version,
      expectedInstanceId: record.instance.id, instanceId: record.instance.id, status: closing ? 'CLOSED' : isClosureReviewNode(target) ? 'PENDING' : 'IN_PROGRESS', actorUserId: actorId });
    const key = randomUUID();
    await persistWorkflowMutation(tx, { organizationId: record.problem.organizationId, actor: { id: user.id, organizationId: user.organizationId, accountType: user.accountType },
      problemIndexId: record.problem.id, workflowVersionId: record.instance.workflowVersionId, expectedProblemVersion: record.problem.version, idempotencyKey: key, traceId },
    createHash('sha256').update(canonical({ problemId: record.problem.id, contentVersion: record.report.contentVersion, action, instanceVersion: record.instance.version })).digest('hex'),
    action, record.node.id, record.node.id, { instanceId: record.instance.id, currentNodeId: target.id, workflowVersionId: record.instance.workflowVersionId,
      version: record.instance.version + 1, problemVersion, status: closing ? 'COMPLETED' : 'RUNNING' }, { audit: this.audit, outbox: this.outbox });
  }

  private async assertEvidence(tx: Prisma.TransactionClient, actor: ProcessEightDActor, record: ProcessEightDRecord, ids: string[], clean = true) {
    if (!ids.length) return;
    await this.resources.authorizeAndLock(tx, actor, { resourceType: 'process-eight-d', resourceId: record.problem.id }, 'read');
    await this.evidenceSnapshot(tx, record, ids, clean);
  }

  private async evidenceSnapshot(tx: Prisma.TransactionClient, record: ProcessEightDRecord, ids: string[], clean = true) {
    const unique = [...new Set(ids)].sort();
    if (!unique.length) return [];
    await this.lockEvidence(tx, unique);
    const files = await tx.fileObject.findMany({ where: { id: { in: unique }, organizationId: record.problem.organizationId, resourceType: 'process-eight-d', resourceId: record.problem.id,
      ...(clean ? { status: 'AVAILABLE' as const, scanStatus: 'CLEAN' } : { status: { not: 'DELETED' as const } }),
      deletedAt: null, objectVersionId: { not: null }, uploadCompletedAt: { not: null } }, orderBy: { id: 'asc' } });
    if (files.length !== unique.length) workflowError('PROCESS_EIGHT_D_EVIDENCE_NOT_CLEAN', 409);
    if (clean && files.some(f => !f.scannedAt || !f.scannerEngine || f.verifiedSha256 !== f.sha256
      || f.verifiedContentType !== f.contentType || f.verifiedSizeBytes !== f.sizeBytes)) workflowError('PROCESS_EIGHT_D_EVIDENCE_NOT_CLEAN', 409);
    return files.map(f => ({ id: f.id, objectVersionId: f.objectVersionId, sha256: f.sha256, version: f.version, scanStatus: f.scanStatus, scannedAt: iso(f.scannedAt) }));
  }

  private async lockEvidence(tx: Prisma.TransactionClient, ids: string[]) {
    for (const id of [...new Set(ids)].sort()) { this.uuid(id); await tx.$queryRaw`SELECT id FROM file_objects WHERE id = ${id}::uuid FOR SHARE`; }
  }

  private async ownerNode(tx: Prisma.TransactionClient, record: ProcessEightDRecord) {
    const nodes = await tx.workflowNode.findMany({ where: { organizationId: record.problem.organizationId, workflowVersionId: record.instance.workflowVersionId, type: 'ACTION' } });
    const owners = nodes.filter(n => jsonObject(n.config).isStart === true && this.deadlinePolicy(n.config));
    if (owners.length !== 1) workflowError('PROCESS_EIGHT_D_CONFIGURATION_INVALID', 409);
    return owners[0]!;
  }

  private deadlinePolicy(config: Prisma.JsonValue): WorkflowDeadlinePolicy | null {
    return parseDeadlinePolicy(jsonObject(config).processEightD);
  }

  private async validateFlow(tx: Prisma.TransactionClient, organizationId: string, definitionId: string, versionId: string) {
    const version = await tx.workflowVersion.findFirst({ where: { id: versionId, organizationId, workflowDefinitionId: definitionId, status: 'PUBLISHED' }, include: { nodes: true, transitions: true } });
    const owners = version?.nodes.filter(n => n.type === 'ACTION' && jsonObject(n.config).isStart === true && this.deadlinePolicy(n.config)) ?? [];
    const gates = version?.nodes.filter(n => isClosureReviewNode(n) && jsonObject(jsonObject(n.config).closureReview).policy === 'INTERNAL' && jsonObject(jsonObject(n.config).closureReview).domainCode === 'process-quality') ?? [];
    const ends = version?.nodes.filter(n => n.type === 'CLOSE' && jsonObject(n.config).isEnd === true) ?? [];
    if (!version || owners.length !== 1 || gates.length !== 1 || ends.length !== 1
      || !version.transitions.some(t => t.fromNodeId === owners[0]!.id && t.toNodeId === gates[0]!.id && t.action === 'SUBMIT')
      || !version.transitions.some(t => t.fromNodeId === gates[0]!.id && t.toNodeId === owners[0]!.id && t.action === 'RETURN')
      || !version.transitions.some(t => t.fromNodeId === gates[0]!.id && t.toNodeId === ends[0]!.id && t.action === 'APPROVE')) workflowError('PROCESS_EIGHT_D_CONFIGURATION_INVALID', 409);
    return version;
  }

  private async readBinding(tx: Prisma.TransactionClient, organizationId: string, lock = false): Promise<Binding | null> {
    const [binding] = await tx.$queryRaw<Binding[]>(Prisma.sql`SELECT ${bindingColumns} FROM process_eight_d_bindings WHERE organization_id = ${organizationId}::uuid ${lock ? Prisma.sql`FOR SHARE` : Prisma.empty}`);
    return binding ?? null;
  }

  private async configuration(actor: ProcessEightDActor, organizationId: string, input: { expectedVersion: number }, key: string, traceId: string, work: (tx: Prisma.TransactionClient, binding: Binding | null) => Promise<void>) {
    this.key(key); this.scope(actor, true); this.uuid(organizationId);
    const digest = eightDRequestDigest({ operation: 'configuration', input });
    return this.transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`process-eight-d-configuration:${organizationId}`}, 0))::text`;
      await assertRecentAuthentication(tx, actor);
      await this.authorize(tx, actor, 'configuration:manage', organizationId, 'ADMIN_CONFIGURATION');
      const replay = await this.receipt(tx, actor, key, digest, organizationId); if (replay) return replay;
      const binding = await this.readBinding(tx, organizationId);
      if ((binding?.version ?? 0) !== input.expectedVersion) workflowError('CONCURRENCY_CONFLICT', 409);
      await work(tx, binding);
      const response = await this.readBinding(tx, organizationId);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'PROCESS_EIGHT_D_BINDING_CHANGED', resourceType: 'ProcessEightDBinding',
        resourceId: organizationId, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: response!.version, status: response!.enabled ? 'ENABLED' : 'DISABLED' } }, tx);
      await this.storeReceipt(tx, actor, key, digest, response, organizationId);
      return response;
    });
  }

  private async confirmations(tx: Prisma.TransactionClient, actor: ProcessEightDActor, problemId: string, confirmations: ProcessEightDSourceConfirmation[]) {
    for (const c of confirmations) {
      this.uuid(c.defectId); this.reason(c.reason);
      await tx.$executeRaw`INSERT INTO process_eight_d_source_confirmations (id, organization_id, problem_id, defect_id, related_problem_ids, recurrence, reason, actor_user_id)
        VALUES (${randomUUID()}::uuid, ${actor.organizationId}::uuid, ${problemId}::uuid, ${c.defectId}::uuid, ${JSON.stringify(c.relatedProblemIds)}::jsonb, ${c.recurrence}, ${c.reason ?? ''}, ${actor.id}::uuid)`;
    }
  }

  private validateConfirmations(defectIds: string[], confirmations: ProcessEightDSourceConfirmation[]) {
    if (!Array.isArray(confirmations) || confirmations.length > 100 || new Set(confirmations.map(c => c.defectId)).size !== confirmations.length
      || confirmations.some(c => !defectIds.includes(c.defectId))) workflowError('PROCESS_EIGHT_D_SOURCE_CONFIRMATION_INVALID', 400);
  }

  private async sourcePreview(tx: Prisma.TransactionClient, actor: ProcessEightDActor, defectId: string, except?: string) {
    const links = await tx.domainSourceIssueLink.findMany({ where: { organizationId: actor.organizationId, sourceDomain: 'process-quality', sourceType: 'process-defect', sourceId: defectId,
      removedAt: null, ...(except ? { problemIndexId: { not: except } } : {}) }, select: { problemIndexId: true } });
    const relatedProblemIds = [...new Set(links.map(l => l.problemIndexId))].sort();
    const relatedProblems = await this.visibleSourceProblems(tx, actor, defectId, relatedProblemIds);
    const preview: ProcessEightDSourcePreviewDto = { defectId, relatedProblems, hasHiddenRelations: relatedProblems.length !== relatedProblemIds.length,
      relatedSetToken: eightDRequestDigest({ organizationId: actor.organizationId, actorUserId: actor.id, defectId, except: except ?? null, relatedProblemIds }) };
    return { relatedProblemIds, preview };
  }

  private async visibleSourceProblems(tx: Prisma.TransactionClient, actor: ProcessEightDActor, defectId: string, ids: string[]): Promise<ProcessEightDRelatedProblemDto[]> {
    if (!ids.length) return [];
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    const visible = await tx.$queryRaw<ProcessEightDRelatedProblemDto[]>(Prisma.sql`SELECT p.id AS "problemId", p.report_number AS "reportNumber", p.status,
      COALESCE(NULLIF(r.document->>'description', ''), p.report_number) AS title,
      (p.domain_code = 'process-quality' AND p.source_type = 'process-defect' AND p.source_id = ${defectId}::uuid) AS primary
      FROM problem_indexes p LEFT JOIN process_eight_d_reports r ON r.organization_id = p.organization_id AND r.problem_id = p.id
        AND p.domain_code = 'process-quality' AND p.source_type = 'process-defect'
      WHERE p.organization_id = ${organizationId}::uuid AND p.archived_at IS NULL
        AND p.id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) AND ${this.readRegistry.visibility(actor, organizationId)} ORDER BY p.id`);
    const otherDomains = visible.length ? await tx.problemIndex.findMany({ where: { organizationId, id: { in: visible.map(p => p.problemId) }, domainCode: { not: 'process-quality' } } }) : [];
    for (const problem of otherDomains) {
      const adapter = this.readRegistry.forProblem(problem);
      await adapter.authorizeRead(tx, { actor, problem, purpose: 'overview' });
      const summary = (await adapter.readSummaries(tx, actor, [problem])).get(problem.id);
      if (!summary) workflowError('PROBLEM_SUMMARY_UNAVAILABLE', 409);
      visible.find(p => p.problemId === problem.id)!.title = summary.title;
    }
    return visible;
  }

  private async readableSnapshot(tx: Prisma.TransactionClient, actor: ProcessEightDActor, snapshot: Prisma.JsonValue): Promise<Prisma.JsonValue> {
    const body = jsonObject(snapshot);
    if (!Array.isArray(body.sourceConfirmations)) return snapshot;
    const sourceConfirmations = [];
    for (const raw of body.sourceConfirmations) {
      const confirmation = jsonObject(raw);
      const ids = Array.isArray(confirmation.relatedProblemIds) ? confirmation.relatedProblemIds.filter((id): id is string => typeof id === 'string' && isUUID(id)) : [];
      const visible = await this.visibleSourceProblems(tx, actor, String(confirmation.defectId), ids);
      sourceConfirmations.push(visible.length === ids.length ? confirmation : { ...confirmation, relatedProblemIds: visible.map(p => p.problemId), hasHiddenRelations: true });
    }
    return json({ ...body, sourceConfirmations }) as Prisma.JsonValue;
  }

  private async confirmSourcePreview(tx: Prisma.TransactionClient, actor: ProcessEightDActor, defectId: string, confirmations: ProcessEightDSourceConfirmationDto[], except?: string) {
    // The caller holds the source row lock; retain existing links until this mutation commits.
    await tx.$queryRaw`SELECT id FROM domain_source_issue_links WHERE organization_id = ${actor.organizationId}::uuid
      AND source_domain = 'process-quality' AND source_type = 'process-defect' AND source_id = ${defectId}::uuid AND removed_at IS NULL ORDER BY id FOR SHARE`;
    const { relatedProblemIds, preview } = await this.sourcePreview(tx, actor, defectId, except);
    const confirmation = confirmations.find(c => c.defectId === defectId);
    assertSourceConfirmation(defectId, preview.relatedProblems.map(p => p.problemId), confirmations);
    if ((preview.hasHiddenRelations || confirmation?.relatedSetToken !== undefined) && confirmation?.relatedSetToken !== preview.relatedSetToken) workflowError('PROCESS_EIGHT_D_SOURCE_CONFIRMATION_REQUIRED', 409);
    return confirmation ? { ...confirmation, relatedProblemIds } : undefined;
  }

  private async receipt(tx: Prisma.TransactionClient, actor: ProcessEightDActor, key: string, digest: string, organizationId = actor.organizationId): Promise<Prisma.JsonValue | null> {
    const [receipt] = await tx.$queryRaw<{ digest: string; response: Prisma.JsonValue }[]>`SELECT digest, response FROM process_eight_d_receipts
      WHERE organization_id = ${organizationId}::uuid AND actor_user_id = ${actor.id}::uuid AND key = ${key}`;
    if (receipt && receipt.digest !== digest) workflowError('IDEMPOTENCY_REPLAY', 409);
    return receipt?.response ?? null;
  }

  private storeReceipt(tx: Prisma.TransactionClient, actor: ProcessEightDActor, key: string, digest: string, response: unknown, organizationId = actor.organizationId) {
    return tx.$executeRaw`INSERT INTO process_eight_d_receipts (organization_id, actor_user_id, key, digest, response)
      VALUES (${organizationId}::uuid, ${actor.id}::uuid, ${key}, ${digest}, ${JSON.stringify(response)}::jsonb)`;
  }

  private async authorize(tx: Prisma.TransactionClient, actor: ProcessEightDActor, permission: string, organizationId = actor.organizationId, purpose: 'LOCAL' | 'READ' | 'ADMIN_CONFIGURATION' = 'LOCAL') {
    this.scope(actor, purpose !== 'LOCAL');
    if (organizationId !== actor.organizationId && (purpose === 'LOCAL' || !await hasPlatformAdministrator(tx, actor.id))) workflowError('ORGANIZATION_SCOPE_DENIED', 403);
    await assertWorkflowFeature(tx, actor, organizationId, permission);
    if (purpose === 'ADMIN_CONFIGURATION' && (await tx.organization.findUnique({ where: { id: organizationId }, select: { type: true } }))?.type !== 'INTERNAL') workflowError('ORGANIZATION_SCOPE_DENIED', 403);
    const session = await tx.session.findFirst({ where: { id: actor.sessionId, userId: actor.id, revokedAt: null, expiresAt: { gt: new Date() }, user: { mustChangePassword: false } },
      select: { securityVersion: true, mfaVerifiedAt: true, user: { select: { securityVersion: true, organization: { select: { type: true } } } } } });
    if (!session || session.securityVersion !== session.user.securityVersion) workflowError('AUTH_SESSION_REQUIRED', 401);
    if (session.user.organization.type !== 'INTERNAL') workflowError('ORGANIZATION_SCOPE_DENIED', 403);
    if ((await mfaPolicy(tx, actor.id)).required && !session.mfaVerifiedAt) workflowError('AUTH_MFA_REQUIRED', 401);
  }

  private async feature(tx: Prisma.TransactionClient, organizationId: string, userId: string, permission: string) {
    const [row] = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`SELECT ${featurePredicate(Prisma.sql`${userId}::uuid`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`${permission}`)} AS allowed`);
    return row?.allowed === true;
  }

  private async eligibleWorker(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
    const user = await tx.user.findFirst({ where: { id: userId, organizationId, accountType: 'INTERNAL', status: 'ACTIVE', organization: { status: 'ACTIVE', type: 'INTERNAL' } } });
    const assignment = await tx.userPosition.findFirst({ where: { organizationId, userId, ...effectivePositionAssignmentWhere() } });
    return !!user && !!assignment && await this.feature(tx, organizationId, userId, 'process-quality:issues:work') && await this.feature(tx, organizationId, userId, 'process-quality:issues:read');
  }

  private async authorizeReassignment(tx: Prisma.TransactionClient, actor: ProcessEightDActor, record: ProcessEightDRecord, sectionId: string,
    requiredKind?: ReassignmentAccess['kind']): Promise<ReassignmentAccess> {
    await this.authorizeRead(tx, actor, record); this.editable(record);
    const sectionDepartmentId = record.report.responsibleSectionDepartmentId;
    if (requiredKind === 'CROSS_DEPARTMENT' || !requiredKind && (sectionId !== sectionDepartmentId
      || await this.feature(tx, actor.organizationId, actor.id, 'process-quality:issues:reassign'))) {
      await this.authorize(tx, actor, 'process-quality:issues:reassign');
      return { kind: 'CROSS_DEPARTMENT', sectionDepartmentId };
    }
    if (sectionId !== sectionDepartmentId) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
    await this.authorize(tx, actor, 'process-quality:issues:work');
    if (requiredKind === 'OWNER') this.owner(actor, record);
    if (requiredKind === 'MANAGEMENT' || actor.id !== record.problem.ownerId) {
      const management = await this.responsibilities.resolveManagementResponsibilities(tx, actor.organizationId, sectionDepartmentId);
      const valid = await this.responsibilities.revalidateLockedManagementResponsibilities(tx, management, new Date());
      if (!management.responsibilities.some(r => r.userId === actor.id && valid.has(r.bindingId))) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
      return { kind: 'MANAGEMENT', sectionDepartmentId };
    }
    await this.assertOwnerAssignment(tx, actor.organizationId, actor.id, sectionDepartmentId);
    return { kind: 'OWNER', sectionDepartmentId };
  }

  private async assertOwnerAssignment(tx: Prisma.TransactionClient, organizationId: string, ownerId: string, sectionId: string) {
    const assignment = await tx.userPosition.findFirst({ where: { organizationId, userId: ownerId, ...effectivePositionAssignmentWhere(), user: { organizationId, accountType: 'INTERNAL', status: 'ACTIVE' },
      position: { organizationId, departmentId: sectionId, status: 'ACTIVE', department: { organizationId, status: 'ACTIVE' } } } });
    if (!assignment) workflowError('PROCESS_EIGHT_D_OWNER_ASSIGNMENT_INVALID', 403);
  }

  private async lockUsers(tx: Prisma.TransactionClient, organizationId: string, ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))].sort();
    if (unique.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE organization_id = ${organizationId}::uuid AND id IN (${Prisma.join(unique.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`);
  }

  private scope(actor: ProcessEightDActor, allowCrossScope = false) { if (actor.accountType !== 'INTERNAL' || !allowCrossScope && actor.scopeOrganizationId && actor.scopeOrganizationId !== actor.organizationId) workflowError('ORGANIZATION_SCOPE_DENIED', 403); }
  private owner(actor: ProcessEightDActor, record: ProcessEightDRecord) { if (actor.id !== record.problem.ownerId) workflowError('WORKFLOW_NODE_FORBIDDEN', 403); }
  private notClosed(record: ProcessEightDRecord) { if (record.report.closedRevisionId || record.problem.closedAt || ['CLOSED', 'ARCHIVED'].includes(record.problem.status) || record.instance.status !== 'RUNNING') workflowError('WORKFLOW_ACTION_INVALID', 409); }
  private editable(record: ProcessEightDRecord) { this.notClosed(record); if (isClosureReviewNode(record.node) || jsonObject(record.node.config).isStart !== true || !this.deadlinePolicy(record.node.config) || record.node.type !== 'ACTION') workflowError('PROCESS_EIGHT_D_APPROVAL_LOCKED', 409); }
  private uuid(id: string) { if (!isUUID(id)) workflowError('PROCESS_EIGHT_D_ID_INVALID', 400); }
  private key(key: string) { if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key ?? '')) workflowError('IDEMPOTENCY_KEY_REQUIRED', 400); }
  private date(date: Date) { if (!(date instanceof Date) || !Number.isFinite(date.getTime())) workflowError('PROCESS_EIGHT_D_DUE_AT_INVALID', 400); }
  private reason(reason?: string) { if (reason !== undefined && (typeof reason !== 'string' || reason.length > 2000)) workflowError('PROCESS_EIGHT_D_REASON_INVALID', 400); }
  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try { return await this.prisma.$transaction(work, { isolationLevel: 'ReadCommitted', timeout: 30_000 }); }
    catch (error) { if (isSecurityConcurrencyConflict(error) || (error as { code?: string }).code === 'P2002') workflowError('CONCURRENCY_CONFLICT', 409); throw error; }
  }
}
