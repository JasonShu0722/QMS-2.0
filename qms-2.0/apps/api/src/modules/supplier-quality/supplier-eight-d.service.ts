import { HttpException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { Prisma, type WorkflowNode } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { ControlledValidationException } from '../../common/contracts/controlled-validation.exception.js';
import { effectivePositionAssignmentWhere } from '../../common/security/effective-role-grants.js';
import { assertActiveAuthentication, isSecurityConcurrencyConflict, mfaPolicy } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { FileLifecycleService } from '../file-management/file-lifecycle.service.js';
import type { FileResourceAction } from '../file-management/file-resource-access.js';
import { OrganizationResponsibilityService } from '../organization/organization-responsibility.service.js';
import { ProblemIndexService } from '../problem-index/problem-index.service.js';
import { OutboxService } from '../task-notification/outbox.service.js';
import { assertWorkflowFeature, featurePredicate } from '../workflow/workflow-access-policy.js';
import { WorkflowClosureRoundService } from '../workflow/workflow-closure-round.service.js';
import type { WorkflowClosureContext, WorkflowClosureOperation, WorkflowSupplierSubmissionInput } from '../workflow/workflow-closure-round.types.js';
import { canonical, isClosureReviewNode, jsonObject, matchesCondition } from '../workflow/workflow-runtime-policy.js';
import { createWorkflowStart, persistWorkflowMutation } from '../workflow/workflow-start.js';
import { analysisCompletionIssues, documentFileIds, emptyProcessEightDDocument, normalizeProcessEightDDocument, ProcessEightDDocumentError, submissionIssues } from '../process-quality/process-eight-d-document.js';
import { eightDError as fail, eightDRequestDigest } from '../process-quality/process-eight-d-policy.js';
import { SupplierWorkflowBindingService } from './supplier-workflow-binding.service.js';
import type { IssueSupplierEightDDto, SaveSupplierEightDDto, SupplierEightDAnalysisCompleteDto, SupplierEightDDeadlinesDto, SupplierEightDReportDto, SupplierEightDVersionDto } from './supplier-eight-d.dto.js';
import type { SupplierEightDActor, SupplierEightDControl, SupplierEightDDeadlineContext, SupplierEightDDisclosureContext, SupplierEightDRecord } from './supplier-eight-d.types.js';
import type { SupplierEightDReportRead } from './supplier-eight-d-report.model.js';
import type { SupplierDeadlineStage } from './supplier-eight-d-deadline.policy.js';
import type { SupplierEightDTaskContext } from './supplier-eight-d-task.types.js';

const columns = Prisma.sql`supplier_problem_id AS "supplierProblemId", organization_id AS "organizationId", problem_index_id AS "problemIndexId",
  sqe_user_id AS "sqeUserId", sqe_assignment_id AS "sqeAssignmentId", responsible_section_department_id AS "responsibleSectionDepartmentId",
  row_version AS "rowVersion", analysis_due_at AS "analysisDueAt", analysis_completed_at AS "analysisCompletedAt", submission_due_at AS "submissionDueAt",
  closure_due_at AS "closureDueAt", submitted_revision_id AS "submittedRevisionId", approved_revision_id AS "approvedRevisionId", approved_snapshot AS "approvedSnapshot", closed_at AS "closedAt"`;
const iso = (date: Date | null) => date?.toISOString() ?? null;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
type Receipt = { supplierProblemId: string; action: string; digest: string; response: Prisma.JsonValue };

@Injectable()
export class SupplierEightDService {
  constructor(private readonly prisma: PrismaService, private readonly problems: ProblemIndexService,
    private readonly bindings: SupplierWorkflowBindingService, private readonly rounds: WorkflowClosureRoundService,
    private readonly responsibilities: OrganizationResponsibilityService, private readonly files: FileLifecycleService,
    private readonly audit: AuditLogService, private readonly outbox: OutboxService) {}

  async read(actor: SupplierEightDActor, id: string): Promise<SupplierEightDReportDto> {
    return this.transaction(async tx => {
      const record = await this.lockRecord(tx, actor, id, true);
      await this.authorizeRead(tx, actor, record);
      return this.model(tx, actor, record);
    });
  }

  async readReport(tx: Prisma.TransactionClient, actor: SupplierEightDActor, id: string, revision: string | null | undefined): Promise<SupplierEightDReportRead> {
    const record = await this.lockRecord(tx, actor, id, true);
    await this.authorizeRead(tx, actor, record);
    let selectedId: string | null = null, snapshot: Prisma.JsonValue;
    if (revision === undefined || revision === null && actor.accountType === 'SUPPLIER' && record.control.closedAt) {
      selectedId = record.control.approvedRevisionId;
      if (!selectedId || !record.control.approvedSnapshot) fail('SUPPLIER_EIGHT_D_REPORT_APPROVED_UNAVAILABLE', 409);
      snapshot = record.control.approvedSnapshot;
    } else if (revision !== null) {
      this.uuid(revision);
      const [origin] = await tx.$queryRaw<{ snapshot: Prisma.JsonValue }[]>`SELECT origin.snapshot FROM supplier_eight_d_submission_origins origin
        JOIN supplier_response_revisions revision ON revision.id = origin.revision_id AND revision.problem_id = origin.supplier_problem_id
        WHERE origin.organization_id = ${record.control.organizationId}::uuid AND origin.supplier_problem_id = ${id}::uuid AND origin.revision_id = ${revision}::uuid`;
      if (!origin) fail('SUPPLIER_EIGHT_D_REPORT_REVISION_NOT_FOUND', 404);
      selectedId = revision; snapshot = origin.snapshot;
    } else {
      const evidence = await this.evidence(tx, actor, record, documentFileIds(this.document(record)));
      const submitted = record.control.submittedRevisionId ? await tx.supplierResponseRevision.findFirst({ where: { id: record.control.submittedRevisionId, problemId: id }, select: { createdAt: true } }) : null;
      const rounds = await this.rounds.readHistoryProjection(tx, record.control.organizationId, record.problem.id);
      const facts = this.reportFacts(record);
      let supplement: { supplementUpdatedAt: string | null } | undefined;
      if (actor.accountType === 'INTERNAL' && record.control.closedAt) {
        const [latest] = await tx.$queryRaw<{ recordedAt: Date }[]>`SELECT recorded_at AS "recordedAt" FROM supplier_eight_d_supplements
          WHERE organization_id = ${record.control.organizationId}::uuid AND supplier_problem_id = ${id}::uuid ORDER BY content_version DESC LIMIT 1`;
        supplement = { supplementUpdatedAt: iso(latest?.recordedAt ?? null) };
      }
      snapshot = json({ ...facts, problem: { ...facts.problem, ...supplement }, evidence, submittedAt: submitted?.createdAt.toISOString() ?? null,
        approvalRounds: rounds.map(r => ({ id: r.id, roundNumber: r.roundNumber, status: r.status, contentVersion: r.contentVersion,
          version: r.version, createdAt: r.createdAt, updatedAt: r.updatedAt, duties: r.duties })) }) as Prisma.JsonValue;
    }
    const raw = jsonObject(snapshot), problem = jsonObject(raw.problem), instance = jsonObject(raw.instance);
    // Pre-port development revisions cannot acquire present-day facts retroactively.
    if (!Number.isSafeInteger(raw.rowVersion) || Number(raw.rowVersion) < 1 || !Number.isSafeInteger(raw.contentVersion) || Number(raw.contentVersion) < 1
      || typeof problem.reportNumber !== 'string' || typeof problem.createdAt !== 'string' || !Number.isSafeInteger(instance.version)
      || !raw.document || !Array.isArray(raw.evidence) || !Array.isArray(raw.sources) || !Array.isArray(raw.collaboratorUserIds)
      || !raw.deadlines || typeof raw.professionalUserId !== 'string' || typeof raw.responsibleSectionDepartmentId !== 'string') fail('SUPPLIER_EIGHT_D_REPORT_SNAPSHOT_INVALID', 409);
    const approvedIds = new Set(record.control.approvedSnapshot ? documentFileIds(normalizeProcessEightDDocument(jsonObject(record.control.approvedSnapshot).document)) : []);
    const privateSupplementFileIds = !selectedId && record.control.closedAt
      ? documentFileIds(normalizeProcessEightDDocument(raw.document)).filter(fileId => !approvedIds.has(fileId)) : [];
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { id: true, organizationId: true, accountType: true, securityVersion: true, status: true } });
    const profile = await tx.supplierBusinessProfile.findUniqueOrThrow({ where: { id: record.supplier.profileId }, select: { version: true, supplierOrganizationId: true } });
    const versionFingerprint = eightDRequestDigest({ user, sessionId: actor.sessionId, authorization: (await mfaPolicy(tx, actor.id)).digest, profile,
      organizationId: record.control.organizationId, supplierProblemId: id, supplierOrganizationId: record.supplier.supplierOrganizationId,
      releasedToSupplierAt: record.supplier.releasedToSupplierAt, replyMode: record.supplier.replyMode, internalResponderId: record.supplier.internalResponderId,
      rowVersion: record.control.rowVersion, contentVersion: record.supplier.version, instance: record.instance, problem: record.problem,
      approvedRevisionId: record.control.approvedRevisionId, selectedId, snapshot, privateSupplementFileIds });
    return { record, revision: selectedId ? { id: selectedId } : null, snapshot, privateSupplementFileIds, versionFingerprint, inReview: isClosureReviewNode(record.node) };
  }

  private reportFacts(record: SupplierEightDRecord) {
    return { document: this.document(record), contentVersion: record.supplier.version, rowVersion: record.control.rowVersion,
      problem: { id: record.problem.id, reportNumber: record.problem.reportNumber, severity: record.problem.severity, createdAt: record.problem.createdAt.toISOString(),
        closedAt: iso(record.problem.closedAt), title: record.supplier.title, materialCode: record.supplier.materialCode, materialCategory: record.supplier.materialCategory,
        defectDescription: record.supplier.defectDescription, defectQuantity: record.supplier.defectQuantity },
      instance: { id: record.instance.id, version: record.instance.version, status: record.instance.status },
      deadlines: { analysisDueAt: iso(record.control.analysisDueAt), submissionDueAt: iso(record.control.submissionDueAt), closureDueAt: iso(record.control.closureDueAt) },
      analysisCompletedAt: iso(record.control.analysisCompletedAt), submittedAt: null as string | null, ownerUserId: record.control.sqeUserId,
      professionalUserId: record.control.sqeUserId, responsibleSectionDepartmentId: record.control.responsibleSectionDepartmentId, collaboratorUserIds: [], sources: [] };
  }

  async deadlineContext(tx: Prisma.TransactionClient, actor: SupplierEightDActor, id: string, stage: SupplierDeadlineStage,
    operation: 'REQUEST' | 'DECIDE' | 'CANCEL' | 'READ'): Promise<SupplierEightDDeadlineContext> {
    if (!['REQUEST', 'DECIDE', 'CANCEL', 'READ'].includes(operation)) fail('SUPPLIER_INPUT_INVALID', 400);
    const record = await this.lockRecord(tx, actor, id, operation === 'READ');
    await this.authorizeRead(tx, actor, record);
    if (operation === 'REQUEST' || operation === 'CANCEL') await this.authorizeReply(tx, actor, record);
    if (operation === 'DECIDE') {
      this.local(actor);
      await this.authorize(tx, actor, record.control.organizationId, 'supplier-quality:issues:deadlines');
      await this.authorize(tx, actor, record.control.organizationId, 'workflow:act');
    }
    const context = await this.deadlineFacts(tx, record, stage, [actor.id]);
    if (operation !== 'READ') await assertActiveAuthentication(tx, actor, 'SHARE');
    return context;
  }

  async deadlineNotificationContext(tx: Prisma.TransactionClient, organizationId: string, id: string, stage: SupplierDeadlineStage): Promise<SupplierEightDDeadlineContext | null> {
    this.uuid(organizationId); this.uuid(id);
    if (!['ANALYSIS', 'SUBMISSION', 'CLOSURE'].includes(stage)) fail('SUPPLIER_INPUT_INVALID', 400);
    try {
      const source = await tx.supplierQualityProblem.findFirst({ where: { id, ownerOrganizationId: organizationId }, select: { problemIndexId: true } });
      if (!source?.problemIndexId) return null;
      const record = await this.lockFacts(tx, organizationId, source.problemIndexId, true);
      if (!this.notificationActive(record) || record.node.type !== 'ACTION'
        || jsonObject(jsonObject(record.node.config).supplierEightD).schemaVersion !== 1 || record.control.submittedRevisionId
        || stage === 'ANALYSIS' && record.control.analysisCompletedAt) return null;
      const dueAt = stage === 'ANALYSIS' ? record.control.analysisDueAt : stage === 'SUBMISSION' ? record.control.submissionDueAt : record.control.closureDueAt;
      if (!dueAt) return null;
      if (record.supplier.replyMode === 'SUPPLIER' && !record.supplier.releasedToSupplierAt) return null;
      return await this.deadlineFacts(tx, record, stage);
    } catch (error) { if (error instanceof HttpException && [403, 404].includes(error.getStatus())) return null; throw error; }
  }

  private notificationActive(record: SupplierEightDRecord): boolean {
    return !record.control.closedAt && !record.problem.closedAt && !record.problem.archivedAt
      && !['CLOSED', 'ARCHIVED'].includes(record.problem.status) && record.instance.status === 'RUNNING';
  }

  async notificationContext(tx: Prisma.TransactionClient, organizationId: string, id: string): Promise<SupplierEightDTaskContext | null> {
    this.uuid(organizationId); this.uuid(id);
    try {
      const source = await tx.supplierQualityProblem.findFirst({ where: { id, ownerOrganizationId: organizationId }, select: { problemIndexId: true } });
      if (!source?.problemIndexId) return null;
      const record = await this.lockFacts(tx, organizationId, source.problemIndexId, true), c = record.control;
      if (!this.notificationActive(record)) return null;
      const profile = await tx.supplierBusinessProfile.findFirst({ where: { id: record.supplier.profileId, ownerOrganizationId: organizationId } });
      if (!profile || profile.supplierOrganizationId !== record.supplier.supplierOrganizationId) return null;
      if (record.supplier.replyMode === 'SUPPLIER' && (!record.supplier.supplierOrganizationId
        || !await tx.organization.findFirst({ where: { id: record.supplier.supplierOrganizationId, type: 'SUPPLIER', status: 'ACTIVE' } }))) return null;
      const startNodes = await tx.workflowNode.findMany({ where: { organizationId, workflowVersionId: record.instance.workflowVersionId, type: 'ACTION' } });
      const starts = startNodes.filter(n => jsonObject(n.config).isStart === true && jsonObject(jsonObject(n.config).supplierEightD).schemaVersion === 1);
      if (starts.length !== 1) return null;
      const config = jsonObject(jsonObject(starts[0]!.config).supplierEightD), interval = config.reminderEveryHours;
      if (interval !== null && (!Number.isSafeInteger(interval) || Number(interval) < 1 || Number(interval) > 8760)) return null;
      const candidates = record.supplier.replyMode === 'INTERNAL'
        ? record.supplier.internalResponderId ? [record.supplier.internalResponderId] : []
        : record.supplier.releasedToSupplierAt ? (await tx.user.findMany({ where: { organizationId: record.supplier.supplierOrganizationId!, accountType: 'SUPPLIER', status: 'ACTIVE', mustChangePassword: false }, select: { id: true }, orderBy: { id: 'asc' } })).map(user => user.id) : [];
      await this.lockUsers(tx, [...candidates, c.sqeUserId]);
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR SHARE`;
      if (record.supplier.supplierOrganizationId) await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${record.supplier.supplierOrganizationId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM supplier_business_profiles WHERE id = ${record.supplier.profileId}::uuid FOR SHARE`;
      const sqe = await this.sqeAssignment(tx, organizationId, c.sqeAssignmentId);
      await tx.$queryRaw`SELECT id FROM departments WHERE id = ${sqe.position.departmentId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM positions WHERE id = ${sqe.positionId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM user_positions WHERE id = ${c.sqeAssignmentId}::uuid FOR SHARE`;
      await this.sqeFingerprint(tx, record);
      const currentProfile = await tx.supplierBusinessProfile.findUnique({ where: { id: record.supplier.profileId } });
      if (!currentProfile || currentProfile.supplierOrganizationId !== record.supplier.supplierOrganizationId) return null;
      if (record.supplier.replyMode === 'SUPPLIER' && !await tx.organization.findFirst({ where: { id: record.supplier.supplierOrganizationId!, type: 'SUPPLIER', status: 'ACTIVE' } })) return null;
      const handling = record.node.id === starts[0]!.id && !c.submittedRevisionId;
      const context: SupplierEightDTaskContext = { organizationId, supplierProblemId: id, problemId: record.problem.id, reportNumber: record.problem.reportNumber,
        instanceId: record.instance.id, workflowVersionId: record.instance.workflowVersionId, rowVersion: c.rowVersion, contentVersion: record.supplier.version,
        instanceVersion: record.instance.version, handling, analysisDueAt: iso(c.analysisDueAt), analysisCompletedAt: iso(c.analysisCompletedAt),
        submissionDueAt: iso(c.submissionDueAt), closureDueAt: iso(c.closureDueAt), closedAt: iso(c.closedAt), submittedRevisionId: c.submittedRevisionId,
        reminderEveryHours: interval as number | null, replyMode: record.supplier.replyMode as 'SUPPLIER' | 'INTERNAL',
        supplierOrganizationId: record.supplier.supplierOrganizationId, releasedToSupplierAt: iso(record.supplier.releasedToSupplierAt), handlingUserIds: [] };
      if (handling) for (const userId of candidates) if (await this.taskRecipientFacts(tx, context, userId, 'HANDLING')) context.handlingUserIds.push(userId);
      return context;
    } catch (error) { if (error instanceof HttpException && [403, 404].includes(error.getStatus())) return null; throw error; }
  }

  async canTaskRecipient(tx: Prisma.TransactionClient, context: SupplierEightDTaskContext, userId: string, purpose: 'READ' | 'HANDLING' | 'NOTIFICATION'): Promise<boolean> {
    this.uuid(userId);
    if (!['READ', 'HANDLING', 'NOTIFICATION'].includes(purpose)) return false;
    const current = await this.notificationContext(tx, context.organizationId, context.supplierProblemId);
    if (!current || canonical(current) !== canonical(context)) return false;
    await this.lockUsers(tx, [userId]);
    return this.taskRecipientFacts(tx, current, userId, purpose);
  }

  private async taskRecipientFacts(tx: Prisma.TransactionClient, context: SupplierEightDTaskContext, userId: string, purpose: 'READ' | 'HANDLING' | 'NOTIFICATION') {
    const user = await tx.user.findFirst({ where: { id: userId, status: 'ACTIVE', mustChangePassword: false, organization: { status: 'ACTIVE' } } });
    if (!user) return false;
    const supplier = user.accountType === 'SUPPLIER';
    if (supplier ? context.replyMode !== 'SUPPLIER' || user.organizationId !== context.supplierOrganizationId || !context.releasedToSupplierAt : user.organizationId !== context.organizationId) return false;
    if (!await this.feature(tx, user.organizationId, userId, supplier ? 'supplier-quality:responses:read' : 'supplier-quality:issues:read')) return false;
    if (purpose === 'NOTIFICATION') return (supplier || await this.feature(tx, user.organizationId, userId, 'task:read'))
      && await this.feature(tx, user.organizationId, userId, 'notification:read');
    if (purpose !== 'HANDLING') return true;
    if (!context.handling || !await this.feature(tx, user.organizationId, userId, 'supplier-quality:responses:write') || !await this.feature(tx, user.organizationId, userId, 'workflow:act')) return false;
    if (supplier) return true;
    const source = await tx.supplierQualityProblem.findUnique({ where: { id: context.supplierProblemId }, select: { internalResponderId: true } });
    if (context.replyMode !== 'INTERNAL' || source?.internalResponderId !== userId) return false;
    await this.internalResponder(tx, context.organizationId, userId);
    return true;
  }

  private async deadlineFacts(tx: Prisma.TransactionClient, record: SupplierEightDRecord, stage: SupplierDeadlineStage, users: string[] = []): Promise<SupplierEightDDeadlineContext> {
    this.editable(record);
    if (!['ANALYSIS', 'SUBMISSION', 'CLOSURE'].includes(stage)) fail('SUPPLIER_INPUT_INVALID', 400);
    if (record.control.submittedRevisionId || stage === 'ANALYSIS' && record.control.analysisCompletedAt) fail('WORKFLOW_ACTION_INVALID', 409);
    const originalDueAt = stage === 'ANALYSIS' ? record.control.analysisDueAt : stage === 'SUBMISSION' ? record.control.submissionDueAt : record.control.closureDueAt;
    if (!originalDueAt) fail('SUPPLIER_EIGHT_D_DUE_AT_REQUIRED', 409);
    const organizationId = record.control.organizationId;
    const profile = await tx.supplierBusinessProfile.findFirst({ where: { id: record.supplier.profileId, ownerOrganizationId: organizationId } });
    if (!profile || profile.supplierOrganizationId !== record.supplier.supplierOrganizationId) fail('SUPPLIER_RECORD_NOT_FOUND', 404);
    if (record.supplier.replyMode === 'SUPPLIER' && (!record.supplier.supplierOrganizationId
      || !await tx.organization.findFirst({ where: { id: record.supplier.supplierOrganizationId, type: 'SUPPLIER', status: 'ACTIVE' } }))) fail('ORGANIZATION_DISABLED', 403);
    const severity = record.problem.severity as SupplierEightDDeadlineContext['severity'];
    if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(severity)) fail('WORKFLOW_ACTION_INVALID', 409);
    await this.lockUsers(tx, [...users, record.control.sqeUserId]);
    const management = severity === 'HIGH' || severity === 'CRITICAL'
      ? await this.responsibilities.resolveManagementResponsibilities(tx, organizationId, record.control.responsibleSectionDepartmentId, undefined,
        [record.control.sqeUserId, ...users.filter(userId => userId !== record.control.sqeUserId)], true) : null;
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR SHARE`;
    if (record.supplier.supplierOrganizationId) {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${record.supplier.supplierOrganizationId}::uuid FOR SHARE`;
      if (!await tx.organization.findFirst({ where: { id: record.supplier.supplierOrganizationId, type: 'SUPPLIER', status: 'ACTIVE' } })) fail('ORGANIZATION_DISABLED', 403);
    }
    await tx.$queryRaw`SELECT id FROM departments WHERE id = ${record.control.responsibleSectionDepartmentId}::uuid AND organization_id = ${organizationId}::uuid FOR SHARE`;
    const sqe = await this.sqeAssignment(tx, organizationId, record.control.sqeAssignmentId);
    await tx.$queryRaw`SELECT id FROM positions WHERE id = ${sqe.positionId}::uuid AND organization_id = ${organizationId}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM user_positions WHERE id = ${sqe.id}::uuid AND organization_id = ${organizationId}::uuid FOR SHARE`;
    return { organizationId, supplierProblemId: record.supplier.id, problemId: record.problem.id, severity, stage, originalDueAt,
      rowVersion: record.control.rowVersion, contentVersion: record.supplier.version, instanceVersion: record.instance.version,
      sqeUserId: record.control.sqeUserId, sqeAssignmentId: record.control.sqeAssignmentId, responsibleSectionDepartmentId: record.control.responsibleSectionDepartmentId,
      sqeFingerprint: await this.sqeFingerprint(tx, record), management };
  }

  private async sqeFingerprint(tx: Prisma.TransactionClient, record: SupplierEightDRecord) {
    const sqe = await this.sqeAssignment(tx, record.control.organizationId, record.control.sqeAssignmentId);
    if (sqe.userId !== record.control.sqeUserId || sqe.position.departmentId !== record.control.responsibleSectionDepartmentId) fail('SUPPLIER_EIGHT_D_SQE_ASSIGNMENT_INVALID', 403);
    const department = await tx.department.findUniqueOrThrow({ where: { id: sqe.position.departmentId } });
    const organization = await tx.organization.findUniqueOrThrow({ where: { id: record.control.organizationId } });
    const user = await tx.user.findUniqueOrThrow({ where: { id: sqe.userId }, select: { id: true, securityVersion: true, status: true } });
    return eightDRequestDigest({ sqe, department, organization, user, permission: (await mfaPolicy(tx, sqe.userId)).digest });
  }

  async applyDeadlineExtension(tx: Prisma.TransactionClient, actor: SupplierEightDActor, context: SupplierEightDDeadlineContext, requestedDueAt: Date, traceId: string): Promise<void> {
    this.date(requestedDueAt); this.local(actor);
    const record = await this.lockRecord(tx, actor, context.supplierProblemId);
    await this.authorizeRead(tx, actor, record);
    await this.authorize(tx, actor, context.organizationId, 'supplier-quality:issues:deadlines');
    await this.authorize(tx, actor, context.organizationId, 'workflow:act');
    this.editable(record);
    const old = context.stage === 'ANALYSIS' ? record.control.analysisDueAt : context.stage === 'SUBMISSION' ? record.control.submissionDueAt : context.stage === 'CLOSURE' ? record.control.closureDueAt : null;
    if (record.problem.id !== context.problemId || record.control.organizationId !== context.organizationId || record.control.rowVersion !== context.rowVersion
      || record.supplier.version !== context.contentVersion || record.instance.version !== context.instanceVersion || record.problem.severity !== context.severity
      || record.control.submittedRevisionId || context.stage === 'ANALYSIS' && record.control.analysisCompletedAt || !old
      || old.getTime() !== context.originalDueAt.getTime() || requestedDueAt <= old || await this.sqeFingerprint(tx, record) !== context.sqeFingerprint) fail('CONCURRENCY_CONFLICT', 409);
    if (context.severity === 'HIGH' || context.severity === 'CRITICAL') {
      if (!context.management || context.management.organizationId !== context.organizationId || context.management.sectionDepartmentId !== context.responsibleSectionDepartmentId) fail('CONCURRENCY_CONFLICT', 409);
      const valid = await this.responsibilities.revalidateLockedManagementResponsibilities(tx, context.management, new Date());
      if (!context.management.responsibilities.some(source => source.responsibility === 'SECTION_MANAGER' && source.userId === actor.id && valid.has(source.bindingId))) fail('WORKFLOW_NODE_FORBIDDEN', 403);
    } else if (actor.id !== record.control.sqeUserId) fail('WORKFLOW_NODE_FORBIDDEN', 403);
    const column = context.stage === 'ANALYSIS' ? Prisma.sql`analysis_due_at` : context.stage === 'SUBMISSION' ? Prisma.sql`submission_due_at` : Prisma.sql`closure_due_at`;
    await this.bump(tx, actor, record, Prisma.sql`, ${column} = ${requestedDueAt}`);
    if (context.stage === 'CLOSURE') await this.problems.updateDomainSummary(tx as never, { organizationId: context.organizationId, id: context.problemId,
      expectedVersion: record.problem.version, dueAt: requestedDueAt, updatedById: actor.id, traceId });
    await this.changed(tx, actor, await this.lockRecord(tx, actor, context.supplierProblemId), 'DEADLINE_EXTENDED', traceId, randomUUID());
  }

  async disclosureContext(tx: Prisma.TransactionClient, actor: SupplierEightDActor, id: string, purpose: 'WRITE' | 'REPLAY' = 'WRITE'): Promise<SupplierEightDDisclosureContext> {
    const record = await this.lockRecord(tx, actor, id);
    await this.authorizeSqe(tx, actor, record, 'supplier-quality:issues:issue');
    if (!['WRITE', 'REPLAY'].includes(purpose)) fail('WORKFLOW_ACTION_INVALID', 400);
    if (record.supplier.replyMode !== 'SUPPLIER') fail('WORKFLOW_ACTION_INVALID', 409);
    if (purpose === 'WRITE') { this.editable(record); if (record.control.submittedRevisionId) fail('WORKFLOW_ACTION_INVALID', 409); }
    return { organizationId: record.control.organizationId, supplierProblemId: record.supplier.id, problemId: record.problem.id, profileId: record.supplier.profileId,
      supplierOrganizationId: record.supplier.supplierOrganizationId, rowVersion: record.control.rowVersion, contentVersion: record.supplier.version, instanceVersion: record.instance.version,
      releasedToSupplierAt: record.supplier.releasedToSupplierAt,
      publicFacts: { title: record.supplier.title, materialCode: record.supplier.materialCode,
        ...(record.supplier.materialCategory ? { materialCategory: record.supplier.materialCategory } : {}),
        defectDescription: record.supplier.defectDescription, defectQuantity: record.supplier.defectQuantity, severity: record.problem.severity,
        reportNumber: record.problem.reportNumber } };
  }

  async issueDraft(actor: SupplierEightDActor, id: string, input: IssueSupplierEightDDto, traceId: string, key: string) {
    this.local(actor); this.uuid(id); this.uuid(input.sqeAssignmentId); this.key(key); this.positive(input.expectedVersion);
    if (input.analysisDueAt) this.date(input.analysisDueAt);
    if (input.closureDueAt) this.date(input.closureDueAt);
    const digest = eightDRequestDigest({ id, action: 'ISSUE', input });
    return this.transaction(async tx => {
      const before = await tx.supplierQualityProblem.findFirst({ where: { id, ownerOrganizationId: actor.organizationId } });
      if (!before) fail('SUPPLIER_RECORD_NOT_FOUND', 404);
      if (before.problemIndexId) await this.lockRecord(tx, actor, id);
      else await tx.$queryRaw`SELECT id FROM supplier_quality_problems WHERE id = ${id}::uuid FOR UPDATE`;
      const supplier = await tx.supplierQualityProblem.findUniqueOrThrow({ where: { id } });
      const candidate = await tx.userPosition.findFirst({ where: { id: input.sqeAssignmentId, organizationId: actor.organizationId }, select: { userId: true } });
      await this.lockUsers(tx, [actor.id, ...(candidate ? [candidate.userId] : [])]);
      await assertActiveAuthentication(tx, actor, 'SHARE');
      await this.authorize(tx, actor, actor.organizationId, 'supplier-quality:issues:read');
      await this.authorize(tx, actor, actor.organizationId, 'supplier-quality:issues:issue');
      if (input.analysisDueAt || input.closureDueAt) {
        if (candidate?.userId !== actor.id) fail('WORKFLOW_NODE_FORBIDDEN', 403);
        await this.authorize(tx, actor, actor.organizationId, 'supplier-quality:issues:deadlines');
      }
      await this.receiptLock(tx, actor, actor.organizationId, key);
      const replay = await this.receipt(tx, actor, actor.organizationId, id, 'ISSUE', key, digest);
      if (replay) {
        await this.sqeAssignment(tx, actor.organizationId, input.sqeAssignmentId);
        await this.authorizeRead(tx, actor, await this.lockRecord(tx, actor, id));
        return replay as unknown as SupplierEightDReportDto;
      }
      if (supplier.problemIndexId || supplier.workflowBindingId || supplier.releasedToSupplierAt || supplier.version !== input.expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
      if (supplier.responseForm !== 'EIGHT_D') fail('SUPPLIER_EIGHT_D_REQUIRED', 409);
      const assignment = await this.sqeAssignment(tx, actor.organizationId, input.sqeAssignmentId);
      if (assignment.userId !== candidate?.userId) fail('CONCURRENCY_CONFLICT', 409);
      const profile = await tx.supplierBusinessProfile.findFirst({ where: { id: supplier.profileId, ownerOrganizationId: actor.organizationId } });
      if (!profile || supplier.supplierOrganizationId && profile.supplierOrganizationId !== supplier.supplierOrganizationId) fail('CONCURRENCY_CONFLICT', 409);
      const supplierOrganizationId = supplier.supplierOrganizationId ?? profile.supplierOrganizationId;
      if (supplier.replyMode === 'SUPPLIER' && !supplierOrganizationId) fail('SUPPLIER_COLLABORATION_NOT_ENABLED', 409);
      if (supplierOrganizationId && !(await tx.organization.findFirst({ where: { id: supplierOrganizationId, status: 'ACTIVE', type: 'SUPPLIER' } }))) fail('ORGANIZATION_DISABLED', 403);
      if (supplier.replyMode === 'INTERNAL') await this.internalResponder(tx, supplier.ownerOrganizationId, supplier.internalResponderId);
      const binding = await this.bindings.resolve(tx, actor.organizationId, { severity: supplier.severity as never, responseForm: 'EIGHT_D', replyMode: supplier.replyMode as never });
      if (binding.controlledEightD !== true) fail('SUPPLIER_WORKFLOW_CONFIGURATION_INVALID', 409);
      const start = await tx.workflowNode.findFirst({ where: { id: binding.replyNodeId, organizationId: actor.organizationId, workflowVersionId: binding.workflowVersionId } });
      if (!start || jsonObject(jsonObject(start.config).supplierEightD).schemaVersion !== 1 || jsonObject(start.config).isStart !== true) fail('SUPPLIER_WORKFLOW_CONFIGURATION_INVALID', 409);
      const problem = await this.problems.createFromDomain(tx as never, { organizationId: actor.organizationId, domainCode: 'supplier-quality', sourceType: 'supplier-quality',
        sourceId: id, problemType: 'EIGHT_D', severity: supplier.severity, ownerId: assignment.userId,
        ...(supplierOrganizationId ? { responsibleParty: supplierOrganizationId } : {}), dueAt: input.closureDueAt, createdById: actor.id, traceId });
      await createWorkflowStart(tx, { organizationId: actor.organizationId, actor, problemIndexId: String(problem.id), expectedProblemVersion: Number(problem.version),
        workflowDefinitionId: binding.workflowDefinitionId, workflowVersionId: binding.workflowVersionId, instanceKey: id, idempotencyKey: `s8d-issue:${createHash('sha256').update(key).digest('hex')}`, traceId },
      digest, { problems: this.problems, audit: this.audit, outbox: this.outbox }, null, undefined, undefined, true);
      const changed = await tx.supplierQualityProblem.updateMany({ where: { id, version: input.expectedVersion, problemIndexId: null }, data: {
        supplierOrganizationId, problemIndexId: String(problem.id), workflowBindingId: binding.bindingId, workflowBindingVersion: binding.bindingVersion, version: { increment: 1 } } });
      if (changed.count !== 1) fail('CONCURRENCY_CONFLICT', 409);
      await tx.$executeRaw`INSERT INTO supplier_eight_d_controls (supplier_problem_id, organization_id, problem_index_id, sqe_user_id, sqe_assignment_id,
        responsible_section_department_id, analysis_due_at, closure_due_at, updated_by) VALUES (${id}::uuid, ${actor.organizationId}::uuid, ${String(problem.id)}::uuid,
        ${assignment.userId}::uuid, ${assignment.id}::uuid, ${assignment.position.departmentId}::uuid, ${input.analysisDueAt ?? null}, ${input.closureDueAt ?? null}, ${actor.id}::uuid)`;
      await tx.supplierResponseDraft.create({ data: { problemId: id, content: json(emptyProcessEightDDocument()), updatedById: actor.id } });
      const record = await this.lockRecord(tx, actor, id);
      const response = await this.model(tx, actor, record);
      await this.changed(tx, actor, record, 'ISSUE', traceId, key);
      await this.storeReceipt(tx, actor, record, 'ISSUE', key, digest, response);
      return response;
    });
  }

  async save(actor: SupplierEightDActor, id: string, input: SaveSupplierEightDDto, traceId: string, key: string) {
    let document;
    try { document = normalizeProcessEightDDocument(input.document); }
    catch (error) { if (error instanceof ProcessEightDDocumentError) throw new ControlledValidationException('SUPPLIER_EIGHT_D_DOCUMENT_INVALID', error.issues); throw error; }
    return this.command(actor, id, input, 'SAVE', traceId, key, async (tx, record) => {
      await this.authorizeSave(tx, actor, record);
      if (!record.control.closedAt) this.editable(record);
      const evidence = await this.evidence(tx, actor, record, documentFileIds(document));
      const previous = this.document(record);
      if (canonical(previous) === canonical(document)) return;
      const plan = (d: typeof document) => ({ analysisProcess: d.analysisProcess, occurrenceCause: d.occurrenceCause, escapeCause: d.escapeCause, systemCause: d.systemCause,
        analysisFileIds: d.analysisFileIds, correctiveActions: d.correctiveActions.map(a => ({ id: a.id, causeKind: a.causeKind, action: a.action, owner: a.owner, plannedAt: a.plannedAt, verificationMethod: a.verificationMethod })) });
      const analysisChanged = canonical(plan(previous)) !== canonical(plan(document));
      await tx.supplierResponseDraft.upsert({ where: { problemId: id }, create: { problemId: id, content: json(document), updatedById: actor.id }, update: { content: json(document), updatedById: actor.id } });
      await this.bump(tx, actor, record, record.control.closedAt ? Prisma.empty : Prisma.sql`, analysis_completed_at = ${analysisChanged ? null : record.control.analysisCompletedAt}::timestamptz`, true);
      if (record.control.closedAt) await tx.$executeRaw`INSERT INTO supplier_eight_d_supplements (id, organization_id, supplier_problem_id, approved_revision_id, content_version, document, evidence, updated_by)
        VALUES (${randomUUID()}::uuid, ${record.control.organizationId}::uuid, ${id}::uuid, ${record.control.approvedRevisionId}::uuid, ${record.supplier.version + 1},
        ${JSON.stringify(document)}::jsonb, ${JSON.stringify(evidence)}::jsonb, ${actor.id}::uuid)`;
    }, async (tx, record) => {
      if (!record.control.closedAt) return;
      const approved = new Set(documentFileIds(normalizeProcessEightDDocument(jsonObject(record.control.approvedSnapshot).document)));
      const added = documentFileIds(document).filter(id => !approved.has(id));
      if (added.length) await this.files.assertAttachable(tx, actor, { resourceType: 'supplier-eight-d-supplement', resourceId: id }, added);
    });
  }

  async analysisComplete(actor: SupplierEightDActor, id: string, input: SupplierEightDAnalysisCompleteDto, traceId: string, key: string) {
    this.date(input.submissionDueAt);
    return this.command(actor, id, input, 'ANALYSIS_COMPLETE', traceId, key, async (tx, record) => {
      await this.authorizeReply(tx, actor, record); this.editable(record);
      if (record.control.submissionDueAt && record.control.submissionDueAt.getTime() !== input.submissionDueAt.getTime()) fail('SUPPLIER_EIGHT_D_EXTENSION_REQUIRED', 409);
      const document = this.document(record), issues = analysisCompletionIssues(document);
      if (issues.length) throw new ControlledValidationException('SUPPLIER_EIGHT_D_ANALYSIS_INCOMPLETE', issues);
      await this.evidence(tx, actor, record, documentFileIds(document));
      if (!record.control.analysisCompletedAt) await this.bump(tx, actor, record, Prisma.sql`, analysis_completed_at = CURRENT_TIMESTAMP, submission_due_at = COALESCE(submission_due_at, ${input.submissionDueAt})`);
    });
  }

  async deadlines(actor: SupplierEightDActor, id: string, input: SupplierEightDDeadlinesDto, traceId: string, key: string) {
    if (!input.analysisDueAt && !input.closureDueAt) fail('SUPPLIER_EIGHT_D_DUE_AT_REQUIRED', 400);
    if (input.analysisDueAt) this.date(input.analysisDueAt);
    if (input.closureDueAt) this.date(input.closureDueAt);
    return this.command(actor, id, input, 'DEADLINES', traceId, key, async (tx, record) => {
      await this.authorizeSqe(tx, actor, record, 'supplier-quality:issues:deadlines'); this.editable(record);
      if (input.analysisDueAt && (record.control.analysisDueAt || record.control.analysisCompletedAt) || input.closureDueAt && record.control.closureDueAt) fail('SUPPLIER_EIGHT_D_EXTENSION_REQUIRED', 409);
      await this.bump(tx, actor, record, Prisma.sql`, analysis_due_at = COALESCE(${input.analysisDueAt ?? null}::timestamptz, analysis_due_at), closure_due_at = COALESCE(${input.closureDueAt ?? null}::timestamptz, closure_due_at)`);
      if (input.closureDueAt) await this.problems.updateDomainSummary(tx as never, { organizationId: record.control.organizationId, id: record.problem.id, expectedVersion: record.problem.version, dueAt: input.closureDueAt, updatedById: actor.id, traceId });
    });
  }

  async submit(actor: SupplierEightDActor, id: string, input: SupplierEightDVersionDto, traceId: string, key: string) {
    return this.command(actor, id, input, 'SUBMIT', traceId, key, async (tx, record) => {
      await this.authorizeReply(tx, actor, record); this.editable(record);
      const document = this.document(record), issues = submissionIssues(document);
      if (!record.control.analysisCompletedAt || !record.control.submissionDueAt) issues.push({ path: 'analysisCompletedAt', message: '需由负责人先确认分析完成并明确完整提交计划' });
      if (issues.length) throw new ControlledValidationException('SUPPLIER_EIGHT_D_SUBMISSION_INCOMPLETE', issues);
      const evidence = await this.evidence(tx, actor, record, documentFileIds(document));
      const revision = await tx.supplierResponseRevision.create({ data: { problemId: id, revision: (await tx.supplierResponseRevision.count({ where: { problemId: id } })) + 1,
        content: json(document), submittedById: actor.id, workflowInstanceId: record.instance.id, workflowVersion: record.instance.version + 1 } });
      const snapshot = { ...this.reportFacts(record), rowVersion: record.control.rowVersion + 1,
        instance: { id: record.instance.id, version: record.instance.version + 1, status: record.instance.status },
        supplierProblemId: id, responseRevisionId: revision.id, contentVersion: record.supplier.version, document, evidence,
        supplierProblem: { title: record.supplier.title, materialCode: record.supplier.materialCode, materialCategory: record.supplier.materialCategory,
          defectDescription: record.supplier.defectDescription, defectQuantity: record.supplier.defectQuantity, profileId: record.supplier.profileId,
          supplierOrganizationId: record.supplier.supplierOrganizationId, replyMode: record.supplier.replyMode, internalResponderId: record.supplier.internalResponderId },
        severity: record.problem.severity, ownerUserId: record.control.sqeUserId, professionalUserId: record.control.sqeUserId,
        sqeAssignmentId: record.control.sqeAssignmentId, responsibleSectionDepartmentId: record.control.responsibleSectionDepartmentId,
        submittedBy: actor.id, submittedOrganizationId: actor.organizationId, submittedAt: revision.createdAt.toISOString(),
        analysisDueAt: iso(record.control.analysisDueAt), analysisCompletedAt: iso(record.control.analysisCompletedAt),
        submissionDueAt: iso(record.control.submissionDueAt), closureDueAt: iso(record.control.closureDueAt) };
      await tx.$executeRaw`INSERT INTO supplier_eight_d_submission_origins (revision_id, supplier_problem_id, organization_id, submitted_by, submitted_organization_id, supplier_organization_id, snapshot)
        VALUES (${revision.id}::uuid, ${id}::uuid, ${record.control.organizationId}::uuid, ${actor.id}::uuid, ${actor.organizationId}::uuid, ${record.supplier.supplierOrganizationId}::uuid, ${JSON.stringify(snapshot)}::jsonb)`;
      await this.bump(tx, actor, record, Prisma.sql`, submitted_revision_id = ${revision.id}::uuid`);
      await this.move(tx, actor, record, 'SUBMIT', traceId);
      const current = await this.lockRecord(tx, actor, id);
      await this.rounds.startForSupplierSubmission(tx, actor, record.problem.id, { supplierProblemId: id, responseRevisionId: revision.id,
        expectedContentVersion: current.supplier.version, expectedInstanceVersion: current.instance.version }, traceId);
    });
  }

  async lockRecord(tx: Prisma.TransactionClient, actor: SupplierEightDActor, id: string, readOnly = false): Promise<SupplierEightDRecord> {
    this.uuid(id);
    const supplier = await tx.supplierQualityProblem.findUnique({ where: { id } });
    if (!supplier?.problemIndexId) fail('SUPPLIER_RECORD_NOT_FOUND', 404);
    if (actor.accountType === 'INTERNAL') {
      this.local(actor);
      if (supplier.ownerOrganizationId !== actor.organizationId) fail('SUPPLIER_RECORD_NOT_FOUND', 404);
    } else if (supplier.supplierOrganizationId !== actor.organizationId || supplier.replyMode !== 'SUPPLIER' || !supplier.releasedToSupplierAt) fail('SUPPLIER_RECORD_NOT_FOUND', 404);
    return this.lockFacts(tx, supplier.ownerOrganizationId, supplier.problemIndexId, readOnly);
  }

  private async lockFacts(tx: Prisma.TransactionClient, organizationId: string, indexId: string, readOnly = false): Promise<SupplierEightDRecord> {
    const lock = readOnly ? Prisma.sql`FOR SHARE` : Prisma.sql`FOR UPDATE`;
    await tx.$queryRaw(Prisma.sql`SELECT id FROM problem_indexes WHERE id = ${indexId}::uuid AND organization_id = ${organizationId}::uuid ${lock}`);
    const problem = await tx.problemIndex.findFirst({ where: { id: indexId, organizationId, domainCode: 'supplier-quality', sourceType: 'supplier-quality', problemType: 'EIGHT_D' } });
    if (!problem?.sourceId || !problem.workflowInstanceId) fail('SUPPLIER_RECORD_NOT_FOUND', 404);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM workflow_instances WHERE id = ${problem.workflowInstanceId}::uuid AND organization_id = ${organizationId}::uuid ${lock}`);
    const instance = await tx.workflowInstance.findFirst({ where: { id: problem.workflowInstanceId, organizationId, problemIndexId: indexId }, include: { currentNode: true, workflowVersion: true } });
    await tx.$queryRaw(Prisma.sql`SELECT id FROM supplier_quality_problems WHERE id = ${problem.sourceId}::uuid AND owner_organization_id = ${organizationId}::uuid ${lock}`);
    const supplier = await tx.supplierQualityProblem.findFirst({ where: { id: problem.sourceId, ownerOrganizationId: organizationId, problemIndexId: indexId }, include: { responseDraft: true } });
    const [control] = await tx.$queryRaw<SupplierEightDControl[]>(Prisma.sql`SELECT ${columns} FROM supplier_eight_d_controls WHERE organization_id = ${organizationId}::uuid AND problem_index_id = ${indexId}::uuid ${lock}`);
    if (!supplier || !control || control.supplierProblemId !== supplier.id || supplier.responseForm !== 'EIGHT_D') fail('SUPPLIER_RECORD_NOT_FOUND', 404);
    if (!instance?.currentNode || instance.workflowVersion.status !== 'PUBLISHED' || instance.workflowVersion.organizationId !== organizationId
      || instance.currentNode.organizationId !== organizationId || instance.currentNode.workflowVersionId !== instance.workflowVersionId || problem.ownerId !== control.sqeUserId
      || problem.severity !== supplier.severity) fail('WORKFLOW_VERSION_MISMATCH', 409);
    return { problem, supplier, control, instance, node: instance.currentNode };
  }

  async authorizeRead(tx: Prisma.TransactionClient, actor: SupplierEightDActor, record: SupplierEightDRecord) {
    const owner = await tx.organization.findFirst({ where: { id: record.control.organizationId, type: 'INTERNAL', status: 'ACTIVE' } });
    const profile = await tx.supplierBusinessProfile.findFirst({ where: { id: record.supplier.profileId, ownerOrganizationId: record.control.organizationId } });
    if (!owner || !profile || profile.supplierOrganizationId !== record.supplier.supplierOrganizationId) fail('SUPPLIER_RECORD_NOT_FOUND', 404);
    if (actor.accountType === 'INTERNAL') {
      this.local(actor);
      if (actor.organizationId !== record.control.organizationId) fail('SUPPLIER_RECORD_NOT_FOUND', 404);
      await this.authorize(tx, actor, actor.organizationId, 'supplier-quality:issues:read');
    } else {
      if (actor.accountType !== 'SUPPLIER' || record.supplier.replyMode !== 'SUPPLIER' || actor.organizationId !== record.supplier.supplierOrganizationId || !record.supplier.releasedToSupplierAt
        || record.problem.archivedAt || record.problem.status === 'ARCHIVED') fail('SUPPLIER_RECORD_NOT_FOUND', 404);
      await this.authorize(tx, actor, actor.organizationId, 'supplier-quality:responses:read');
    }
  }

  async authorizeReply(tx: Prisma.TransactionClient, actor: SupplierEightDActor, record: SupplierEightDRecord) {
    await this.authorizeRead(tx, actor, record);
    if (record.supplier.replyMode === 'INTERNAL') {
      if (actor.accountType !== 'INTERNAL' || actor.id !== record.supplier.internalResponderId) fail('WORKFLOW_NODE_FORBIDDEN', 403);
      await this.internalResponder(tx, record.control.organizationId, actor.id);
    } else if (actor.accountType !== 'SUPPLIER' || actor.organizationId !== record.supplier.supplierOrganizationId) fail('WORKFLOW_NODE_FORBIDDEN', 403);
    await this.authorize(tx, actor, actor.organizationId, 'supplier-quality:responses:write');
    await this.authorize(tx, actor, actor.organizationId, 'workflow:act');
  }

  async disclosureFileGrant(tx: Prisma.TransactionClient, actor: SupplierEightDActor, id: string, action: FileResourceAction) {
    if (!['upload', 'complete', 'attach', 'delete', 'read'].includes(action)) fail('FILE_RESOURCE_DENIED', 403);
    const record = await this.lockRecord(tx, actor, id, action === 'read');
    if (action === 'read') await this.authorizeRead(tx, actor, record);
    else {
      await this.authorizeSqe(tx, actor, record, 'supplier-quality:issues:issue');
      this.editable(record);
      if (record.control.submittedRevisionId) fail('WORKFLOW_ACTION_INVALID', 409);
    }
    if (record.supplier.replyMode !== 'SUPPLIER' || !record.supplier.supplierOrganizationId) fail('FILE_RESOURCE_DENIED', 403);
    return { organizationId: record.supplier.supplierOrganizationId, version: record.supplier.version };
  }

  async fileGrant(tx: Prisma.TransactionClient, actor: SupplierEightDActor, id: string, action: FileResourceAction, kind: 'response' | 'supplement') {
    const record = await this.lockRecord(tx, actor, id, action === 'read');
    await this.authorizeRead(tx, actor, record);
    if (kind === 'supplement') {
      this.local(actor);
      if (!record.control.closedAt) fail('FILE_RESOURCE_DENIED', 403);
      if (action !== 'read') {
        // FileLifecycle later takes this same lock: acquire it before any participant SHARE locks.
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.id}::uuid FOR NO KEY UPDATE`;
        await this.authorizeSave(tx, actor, record);
      }
      return { organizationId: record.control.organizationId, version: record.control.rowVersion };
    }
    if (kind !== 'response') fail('FILE_RESOURCE_DENIED', 403);
    if (action !== 'read') { await this.authorizeReply(tx, actor, record); this.editable(record); }
    return { organizationId: record.supplier.supplierOrganizationId ?? record.control.organizationId, version: record.supplier.version };
  }

  private async authorizeSqe(tx: Prisma.TransactionClient, actor: SupplierEightDActor, record: SupplierEightDRecord, permission: string) {
    this.local(actor);
    await this.authorizeRead(tx, actor, record);
    if (actor.id !== record.control.sqeUserId) fail('WORKFLOW_NODE_FORBIDDEN', 403);
    const a = await this.sqeAssignment(tx, record.control.organizationId, record.control.sqeAssignmentId);
    if (a.userId !== record.control.sqeUserId || a.position.departmentId !== record.control.responsibleSectionDepartmentId) fail('WORKFLOW_NODE_FORBIDDEN', 403);
    await this.authorize(tx, actor, record.control.organizationId, permission);
  }

  private async authorizeSave(tx: Prisma.TransactionClient, actor: SupplierEightDActor, record: SupplierEightDRecord) {
    if (!record.control.closedAt) return this.authorizeReply(tx, actor, record);
    this.local(actor); await this.authorizeRead(tx, actor, record);
    await this.authorize(tx, actor, record.control.organizationId, 'supplier-quality:issues:work');
    if (actor.id === record.control.sqeUserId) return this.authorizeSqe(tx, actor, record, 'supplier-quality:issues:work');
    const management = await this.responsibilities.resolveManagementResponsibilities(tx, record.control.organizationId, record.control.responsibleSectionDepartmentId);
    const valid = await this.responsibilities.revalidateLockedManagementResponsibilities(tx, management, new Date());
    if (!management.responsibilities.some(r => r.responsibility === 'SECTION_MANAGER' && r.userId === actor.id && valid.has(r.bindingId))) fail('WORKFLOW_NODE_FORBIDDEN', 403);
  }

  async closureContext(tx: Prisma.TransactionClient, actor: SupplierEightDActor, indexId: string, operation: WorkflowClosureOperation): Promise<WorkflowClosureContext> {
    this.local(actor); this.uuid(indexId);
    const record = await this.lockFacts(tx, actor.organizationId, indexId, operation === 'READ');
    await this.authorizeRead(tx, actor, record);
    if (operation !== 'READ') {
      await this.freezeClosureSqe(tx, record);
    }
    if (operation === 'SUBMIT') fail('WORKFLOW_ACTION_INVALID', 409);
    if (operation === 'CANCEL') await this.authorizeSqe(tx, actor, record, 'supplier-quality:issues:work');
    return this.context(tx, record);
  }

  async supplierSubmissionContext(tx: Prisma.TransactionClient, actor: SupplierEightDActor, indexId: string, input: WorkflowSupplierSubmissionInput): Promise<WorkflowClosureContext> {
    const record = await this.lockRecord(tx, actor, input.supplierProblemId);
    await this.authorizeReply(tx, actor, record);
    if (record.problem.id !== indexId || record.control.closedAt || record.instance.status !== 'RUNNING' || !isClosureReviewNode(record.node)
      || record.supplier.version !== input.expectedContentVersion || record.instance.version !== input.expectedInstanceVersion || record.control.submittedRevisionId !== input.responseRevisionId) fail('CONCURRENCY_CONFLICT', 409);
    const origin = await this.origin(tx, record);
    if (origin.submittedBy !== actor.id || origin.submittedOrganizationId !== actor.organizationId) fail('WORKFLOW_NODE_FORBIDDEN', 403);
    const revision = await tx.supplierResponseRevision.findFirst({ where: { id: input.responseRevisionId, problemId: record.supplier.id, submittedById: actor.id,
      workflowInstanceId: record.instance.id, workflowVersion: record.instance.version } });
    if (!revision || canonical(revision.content) !== canonical(this.document(record))) fail('CONCURRENCY_CONFLICT', 409);
    await this.freezeClosureSqe(tx, record);
    return this.context(tx, record);
  }

  private async freezeClosureSqe(tx: Prisma.TransactionClient, record: SupplierEightDRecord) {
    const c = record.control;
    // Keep the shared resolver's lock order; every additional SQE lock is non-waiting against structure-first writers.
    await this.responsibilities.resolveManagementResponsibilities(tx, c.organizationId, c.responsibleSectionDepartmentId);
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT a.id FROM user_positions a
      JOIN users u ON u.id = a.user_id AND u.organization_id = a.organization_id
      JOIN positions p ON p.id = a.position_id AND p.organization_id = a.organization_id
      JOIN departments d ON d.id = p.department_id AND d.organization_id = p.organization_id
      WHERE a.id = ${c.sqeAssignmentId}::uuid AND a.organization_id = ${c.organizationId}::uuid
      FOR SHARE OF u, a, p, d SKIP LOCKED`;
    if (locked.length !== 1) fail('CONCURRENCY_CONFLICT', 409);
    const assignment = await this.sqeAssignment(tx, c.organizationId, c.sqeAssignmentId);
    if (assignment.userId !== c.sqeUserId || assignment.position.departmentId !== c.responsibleSectionDepartmentId) fail('WORKFLOW_NODE_FORBIDDEN', 403);
  }

  async complete(tx: Prisma.TransactionClient, context: WorkflowClosureContext, actor: SupplierEightDActor): Promise<void> {
    const record = await this.lockFacts(tx, context.organizationId, context.problemId);
    await this.assertContext(tx, record, context);
    if (!actor) fail('SUPPLIER_EIGHT_D_TRANSITION_ACTOR_REQUIRED', 409);
    this.local(actor); await this.authorizeRead(tx, actor, record); await this.authorize(tx, actor, context.organizationId, 'workflow:act');
    const round = await this.rounds.readProjection(tx, context.organizationId, context.problemId);
    if (!round || round.status !== 'APPROVED' || round.contentVersion !== context.contentVersion || canonical(round.contentSnapshot) !== canonical(context.content)
      || !round.duties.some(d => d.duty === 'PROFESSIONAL' && d.status === 'APPROVED') || !round.duties.every(d => d.status === 'APPROVED')
      || !round.duties.some(d => d.decidedBy === actor.id && d.status === 'APPROVED') || record.control.closedAt) fail('WORKFLOW_ACTION_INVALID', 409);
    const origin = await this.origin(tx, record);
    await this.assertFrozenEvidence(tx, record, origin.snapshot);
    await this.move(tx, actor, record, 'APPROVE', randomUUID(), true);
    // Approval keeps the actual duties, not two additional copies of the immutable full document.
    const approval = { id: round.id, instanceId: round.instanceId, workflowVersionId: round.workflowVersionId, contentVersion: round.contentVersion,
      roundNumber: round.roundNumber, status: round.status, version: round.version, duties: round.duties, createdBy: round.createdBy,
      createdAt: round.createdAt, updatedAt: round.updatedAt };
    const closed = await this.lockFacts(tx, context.organizationId, context.problemId), facts = jsonObject(origin.snapshot);
    const snapshot = { ...facts, rowVersion: record.control.rowVersion + 1,
      problem: { ...jsonObject(facts.problem), closedAt: iso(closed.problem.closedAt) },
      instance: { id: closed.instance.id, version: closed.instance.version, status: closed.instance.status }, approval, closedAt: iso(closed.problem.closedAt) };
    const changed = await tx.$executeRaw`UPDATE supplier_eight_d_controls SET approved_revision_id = submitted_revision_id, approved_snapshot = ${JSON.stringify(snapshot)}::jsonb,
      closed_at = (SELECT closed_at FROM problem_indexes WHERE id = ${record.problem.id}::uuid), row_version = row_version + 1, updated_by = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP
      WHERE supplier_problem_id = ${record.supplier.id}::uuid AND organization_id = ${context.organizationId}::uuid AND row_version = ${record.control.rowVersion} AND approved_revision_id IS NULL`;
    if (changed !== 1) fail('CONCURRENCY_CONFLICT', 409);
    await this.changed(tx, actor, await this.lockFacts(tx, context.organizationId, context.problemId), 'CLOSED', randomUUID(), round.id);
  }

  async returnForChanges(tx: Prisma.TransactionClient, context: WorkflowClosureContext, actor: SupplierEightDActor): Promise<void> {
    const record = await this.lockFacts(tx, context.organizationId, context.problemId);
    await this.assertContext(tx, record, context);
    if (!actor) fail('SUPPLIER_EIGHT_D_TRANSITION_ACTOR_REQUIRED', 409);
    this.local(actor); await this.authorizeRead(tx, actor, record); await this.authorize(tx, actor, context.organizationId, 'workflow:act');
    const round = await this.rounds.readProjection(tx, context.organizationId, context.problemId);
    if (!round || !['RETURNED', 'CANCELLED'].includes(round.status) || record.control.closedAt) fail('WORKFLOW_ACTION_INVALID', 409);
    await this.move(tx, actor, record, 'RETURN', randomUUID());
    await this.bump(tx, actor, record, Prisma.sql`, submitted_revision_id = NULL`);
    await this.changed(tx, actor, await this.lockFacts(tx, context.organizationId, context.problemId), 'RETURN', randomUUID(), round.id);
  }

  async canNotifyClosureRecipient(tx: Prisma.TransactionClient, context: WorkflowClosureContext, userId: string) {
    try {
      const record = await this.lockFacts(tx, context.organizationId, context.problemId, true);
      await this.assertContext(tx, record, context);
      await this.sqeAssignment(tx, context.organizationId, record.control.sqeAssignmentId);
      return !record.control.closedAt && !!await tx.user.findFirst({ where: { id: userId, organizationId: context.organizationId, accountType: 'INTERNAL', status: 'ACTIVE', organization: { status: 'ACTIVE' } } })
        && await this.feature(tx, context.organizationId, userId, 'supplier-quality:issues:read');
    } catch (error) { if (error instanceof HttpException && [403, 404, 409].includes(error.getStatus())) return false; throw error; }
  }

  private async context(tx: Prisma.TransactionClient, record: SupplierEightDRecord): Promise<WorkflowClosureContext> {
    const origin = record.control.submittedRevisionId ? await this.origin(tx, record) : null;
    return { organizationId: record.control.organizationId, problemId: record.problem.id, instanceId: record.instance.id, workflowVersionId: record.instance.workflowVersionId,
      currentNodeId: record.node.id, instanceVersion: record.instance.version, contentVersion: record.supplier.version, content: json(origin?.snapshot ?? { document: this.document(record), supplierProblemId: record.supplier.id }),
      policy: 'SUPPLIER', severity: record.problem.severity as WorkflowClosureContext['severity'], ownerUserId: record.control.sqeUserId,
      professionalUserId: record.control.sqeUserId, responsibleSectionDepartmentId: record.control.responsibleSectionDepartmentId };
  }

  private async origin(tx: Prisma.TransactionClient, record: SupplierEightDRecord) {
    const [origin] = await tx.$queryRaw<{ submittedBy: string; submittedOrganizationId: string; snapshot: Prisma.JsonValue }[]>`SELECT submitted_by AS "submittedBy", submitted_organization_id AS "submittedOrganizationId", snapshot
      FROM supplier_eight_d_submission_origins WHERE revision_id = ${record.control.submittedRevisionId}::uuid AND supplier_problem_id = ${record.supplier.id}::uuid AND organization_id = ${record.control.organizationId}::uuid`;
    if (!origin || !record.control.closedAt && (jsonObject(origin.snapshot).contentVersion !== record.supplier.version
      || canonical(jsonObject(origin.snapshot).document) !== canonical(this.document(record)))) fail('CONCURRENCY_CONFLICT', 409);
    if (record.control.closedAt && (record.control.submittedRevisionId !== record.control.approvedRevisionId
      || canonical(jsonObject(origin.snapshot).document) !== canonical(jsonObject(record.control.approvedSnapshot).document))) fail('CONCURRENCY_CONFLICT', 409);
    return origin;
  }

  private async assertContext(tx: Prisma.TransactionClient, record: SupplierEightDRecord, context: WorkflowClosureContext) {
    if (canonical(await this.context(tx, record)) !== canonical(context)) fail('CONCURRENCY_CONFLICT', 409);
  }

  private async command(actor: SupplierEightDActor, id: string, input: SupplierEightDVersionDto, action: string, traceId: string, key: string,
    work: (tx: Prisma.TransactionClient, record: SupplierEightDRecord) => Promise<void>, beforeUsers?: (tx: Prisma.TransactionClient, record: SupplierEightDRecord) => Promise<void>) {
    this.key(key); this.positive(input.expectedRowVersion); this.positive(input.expectedInstanceVersion);
    const digest = eightDRequestDigest({ id, action, input });
    return this.transaction(async tx => {
      const record = await this.lockRecord(tx, actor, id);
      await this.authorizeRead(tx, actor, record);
      // A proven replay writes nothing and must not be reinterpreted as a new closed-stage attachment.
      const existing = await this.receipt(tx, actor, record.control.organizationId, id, action, key, digest);
      if (!existing) await beforeUsers?.(tx, record);
      await this.lockUsers(tx, [actor.id, record.control.sqeUserId, record.supplier.internalResponderId].filter((id): id is string => !!id));
      await assertActiveAuthentication(tx, actor, 'SHARE');
      await this.authorizeRead(tx, actor, record);
      await this.receiptLock(tx, actor, record.control.organizationId, key);
      const replay = existing ?? await this.receipt(tx, actor, record.control.organizationId, id, action, key, digest);
      if (replay) {
        if (action === 'DEADLINES') await this.authorizeSqe(tx, actor, record, 'supplier-quality:issues:deadlines');
        else if (action === 'SAVE' && jsonObject(replay).closedAt !== null) await this.authorizeSave(tx, actor, record);
        else await this.authorizeReply(tx, actor, record);
        return replay as unknown as SupplierEightDReportDto;
      }
      if (record.control.rowVersion !== input.expectedRowVersion || record.instance.version !== input.expectedInstanceVersion) fail('CONCURRENCY_CONFLICT', 409);
      if (record.problem.archivedAt || record.problem.status === 'ARCHIVED') fail('WORKFLOW_ACTION_INVALID', 409);
      await work(tx, record);
      const current = await this.lockRecord(tx, actor, id);
      await this.authorizeRead(tx, actor, current);
      const response = await this.model(tx, actor, current);
      await this.changed(tx, actor, current, action, traceId, key);
      await this.storeReceipt(tx, actor, current, action, key, digest, response);
      return response;
    });
  }

  private async bump(tx: Prisma.TransactionClient, actor: SupplierEightDActor, record: SupplierEightDRecord, fields: Prisma.Sql, content = false) {
    if (record.control.rowVersion === 2147483647 || content && record.supplier.version === 2147483647) fail('CONCURRENCY_CONFLICT', 409);
    const count = await tx.$executeRaw(Prisma.sql`UPDATE supplier_eight_d_controls SET row_version = row_version + 1, updated_by = ${actor.id}::uuid,
      updated_at = CURRENT_TIMESTAMP ${fields} WHERE supplier_problem_id = ${record.supplier.id}::uuid AND organization_id = ${record.control.organizationId}::uuid AND row_version = ${record.control.rowVersion}`);
    if (count !== 1) fail('CONCURRENCY_CONFLICT', 409);
    if (content && (await tx.supplierQualityProblem.updateMany({ where: { id: record.supplier.id, version: record.supplier.version }, data: { version: { increment: 1 } } })).count !== 1) fail('CONCURRENCY_CONFLICT', 409);
  }

  private async move(tx: Prisma.TransactionClient, actor: SupplierEightDActor, record: SupplierEightDRecord, action: string, traceId: string, closing = false) {
    const edges = await tx.workflowTransition.findMany({ where: { organizationId: record.control.organizationId, workflowVersionId: record.instance.workflowVersionId, fromNodeId: record.node.id, action }, include: { toNode: true } });
    const target: WorkflowNode | undefined = edges[0]?.toNode;
    if (edges.length !== 1 || !target || !matchesCondition(edges[0]!.condition, record.problem)
      || action === 'SUBMIT' && (!isClosureReviewNode(target) || jsonObject(jsonObject(target.config).closureReview).policy !== 'SUPPLIER')
      || action === 'RETURN' && (target.type !== 'ACTION' || jsonObject(jsonObject(target.config).supplierEightD).schemaVersion !== 1)
      || closing && (target.type !== 'CLOSE' || jsonObject(target.config).isEnd !== true)) fail('WORKFLOW_TRANSITION_AMBIGUOUS', 409);
    const count = await tx.workflowInstance.updateMany({ where: { id: record.instance.id, organizationId: record.control.organizationId, version: record.instance.version, currentNodeId: record.node.id, status: 'RUNNING' },
      data: { currentNodeId: target.id, status: closing ? 'COMPLETED' : 'RUNNING', version: { increment: 1 }, updatedById: actor.id } });
    if (count.count !== 1) fail('CONCURRENCY_CONFLICT', 409);
    const problemVersion = await this.problems.applyWorkflowState(tx, { organizationId: record.control.organizationId, id: record.problem.id, expectedVersion: record.problem.version,
      expectedInstanceId: record.instance.id, instanceId: record.instance.id, status: closing ? 'CLOSED' : isClosureReviewNode(target) ? 'PENDING' : 'IN_PROGRESS', actorUserId: actor.id });
    await persistWorkflowMutation(tx, { organizationId: record.control.organizationId, actor, problemIndexId: record.problem.id, workflowVersionId: record.instance.workflowVersionId,
      expectedProblemVersion: record.problem.version, idempotencyKey: randomUUID(), traceId }, eightDRequestDigest({ action, indexId: record.problem.id, instanceVersion: record.instance.version }),
    action, record.node.id, record.node.id, { instanceId: record.instance.id, workflowVersionId: record.instance.workflowVersionId, currentNodeId: target.id,
      version: record.instance.version + 1, problemVersion, status: closing ? 'COMPLETED' : 'RUNNING' }, { audit: this.audit, outbox: this.outbox });
  }

  private async evidence(tx: Prisma.TransactionClient, actor: SupplierEightDActor, record: SupplierEightDRecord, ids: string[]) {
    if (!ids.length) return [];
    const approvedIds = record.control.closedAt ? new Set(documentFileIds(normalizeProcessEightDDocument(jsonObject(record.control.approvedSnapshot).document))) : null;
    const responseIds = ids.filter(id => !approvedIds || approvedIds.has(id)), supplementIds = ids.filter(id => approvedIds && !approvedIds.has(id));
    const groups = [
      ...(responseIds.length ? [{ resource: { resourceType: 'supplier-quality', resourceId: record.supplier.id }, fileIds: responseIds }] : []),
      ...(supplementIds.length ? [{ resource: { resourceType: 'supplier-eight-d-supplement', resourceId: record.supplier.id }, fileIds: supplementIds }] : []),
    ];
    const files = await this.files.readReportEvidence(tx, actor, groups);
    return files.map(f => ({ id: f.id, objectVersionId: f.objectVersionId, sha256: f.sha256, version: f.version, scanStatus: f.scanStatus, scannedAt: f.scannedAt })).sort((a, b) => a.id.localeCompare(b.id));
  }

  private async evidenceFacts(tx: Prisma.TransactionClient, record: SupplierEightDRecord, ids: string[]) {
    const unique = [...new Set(ids)].sort();
    if (unique.length > 100) fail('SUPPLIER_EIGHT_D_EVIDENCE_INVALID', 400);
    for (const id of unique) { this.uuid(id); await tx.$queryRaw`SELECT id FROM file_objects WHERE id = ${id}::uuid FOR SHARE`; }
    const files = await tx.fileObject.findMany({ where: { id: { in: unique }, resourceType: 'supplier-quality', resourceId: record.supplier.id,
      organizationId: { in: [record.control.organizationId, record.supplier.supplierOrganizationId].filter((id): id is string => !!id) }, status: 'AVAILABLE', scanStatus: 'CLEAN',
      deletedAt: null, objectVersionId: { not: null }, uploadCompletedAt: { not: null } }, orderBy: { id: 'asc' } });
    if (files.length !== unique.length || files.some(f => !f.scannedAt || !f.scannerEngine || f.verifiedSha256 !== f.sha256 || f.verifiedContentType !== f.contentType || f.verifiedSizeBytes !== f.sizeBytes)) fail('SUPPLIER_EIGHT_D_EVIDENCE_NOT_CLEAN', 409);
    return files.map(f => ({ id: f.id, objectVersionId: f.objectVersionId, sha256: f.sha256, version: f.version, scanStatus: f.scanStatus, scannedAt: iso(f.scannedAt) }));
  }

  private async assertFrozenEvidence(tx: Prisma.TransactionClient, record: SupplierEightDRecord, snapshot: Prisma.JsonValue) {
    const current = await this.evidenceFacts(tx, record, documentFileIds(this.document(record)));
    if (canonical(current) !== canonical(jsonObject(snapshot).evidence)) fail('SUPPLIER_EIGHT_D_EVIDENCE_CHANGED', 409);
  }

  private async sqeAssignment(tx: Prisma.TransactionClient, organizationId: string, id: string) {
    const assignment = await tx.userPosition.findFirst({ where: { id, organizationId, ...effectivePositionAssignmentWhere(), user: { organizationId, accountType: 'INTERNAL', status: 'ACTIVE' } }, include: { position: true } });
    if (!assignment || !await this.feature(tx, organizationId, assignment.userId, 'supplier-quality:issues:read') || !await this.feature(tx, organizationId, assignment.userId, 'supplier-quality:issues:work')
      || !await this.feature(tx, organizationId, assignment.userId, 'workflow:act')) fail('SUPPLIER_EIGHT_D_SQE_ASSIGNMENT_INVALID', 403);
    return assignment;
  }

  private async internalResponder(tx: Prisma.TransactionClient, organizationId: string, id: string | null) {
    if (!id || !await tx.userPosition.findFirst({ where: { organizationId, userId: id, ...effectivePositionAssignmentWhere(), user: { status: 'ACTIVE', accountType: 'INTERNAL', organizationId } } })
      || !await this.feature(tx, organizationId, id, 'supplier-quality:responses:read') || !await this.feature(tx, organizationId, id, 'supplier-quality:responses:write')
      || !await this.feature(tx, organizationId, id, 'supplier-quality:issues:read') || !await this.feature(tx, organizationId, id, 'workflow:act')) fail('SUPPLIER_EIGHT_D_RESPONDER_INVALID', 403);
  }

  private async authorize(tx: Prisma.TransactionClient, actor: SupplierEightDActor, organizationId: string, permission: string) {
    if (actor.scopeOrganizationId && actor.scopeOrganizationId !== actor.organizationId) fail('ORGANIZATION_SCOPE_DENIED', 403);
    await assertWorkflowFeature(tx, actor, organizationId, permission);
    const session = await tx.session.findFirst({ where: { id: actor.sessionId, userId: actor.id, revokedAt: null, expiresAt: { gt: new Date() }, user: { mustChangePassword: false } }, include: { user: true } });
    if (!session || session.securityVersion !== session.user.securityVersion) fail('AUTH_SESSION_REQUIRED', 401);
    if ((await mfaPolicy(tx, actor.id)).required && !session.mfaVerifiedAt) fail('AUTH_MFA_REQUIRED', 401);
  }

  private async feature(tx: Prisma.TransactionClient, orgId: string, userId: string, permission: string) {
    const [row] = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`SELECT ${featurePredicate(Prisma.sql`${userId}::uuid`, Prisma.sql`${orgId}::uuid`, Prisma.sql`${permission}`)} AS allowed`);
    return row?.allowed === true;
  }

  private async model(tx: Prisma.TransactionClient, actor: SupplierEightDActor, record: SupplierEightDRecord): Promise<SupplierEightDReportDto> {
    const c = record.control, round = await this.rounds.readProjection(tx, c.organizationId, record.problem.id);
    const submitted = c.submittedRevisionId ? await tx.supplierResponseRevision.findFirst({ where: { id: c.submittedRevisionId, problemId: record.supplier.id }, select: { createdAt: true } }) : null;
    const actions = ['read', 'deadline-extensions'];
    if (actor.accountType === 'SUPPLIER' || await this.can(async () => this.authorize(tx, actor, c.organizationId, 'supplier-quality:issues:report'))) actions.push('report');
    if (!record.problem.archivedAt && record.problem.status !== 'ARCHIVED') {
      if (c.closedAt) { if (await this.can(async () => this.authorizeSave(tx, actor, record))) actions.push('supplement'); }
      else if (record.instance.status === 'RUNNING' && !isClosureReviewNode(record.node)) {
        const canReply = await this.can(async () => this.authorizeReply(tx, actor, record));
        if (canReply) actions.push('save', 'analysis-complete', 'submit');
        if (await this.can(async () => this.authorizeSqe(tx, actor, record, 'supplier-quality:issues:deadlines'))) actions.push('deadlines');
        const handling = record.node.type === 'ACTION' && jsonObject(jsonObject(record.node.config).supplierEightD).schemaVersion === 1 && !c.submittedRevisionId;
        if (handling && record.supplier.replyMode === 'SUPPLIER' && record.supplier.supplierOrganizationId && !record.supplier.releasedToSupplierAt
          && await this.can(async () => this.authorizeSqe(tx, actor, record, 'supplier-quality:issues:issue'))) actions.push('disclosure-preview', 'release');
        if (handling && canReply && (c.analysisDueAt && !c.analysisCompletedAt || c.submissionDueAt || c.closureDueAt)) actions.push('request-extension');
      }
    }
    // The portal sees the approved basis, never an internal post-close supplement.
    const document = actor.accountType === 'SUPPLIER' && c.approvedSnapshot ? normalizeProcessEightDDocument(jsonObject(c.approvedSnapshot).document) : this.document(record);
    return { supplierProblemId: record.supplier.id, problemId: record.problem.id, organizationId: c.organizationId, instanceId: record.instance.id,
      workflowVersionId: record.instance.workflowVersionId, reportNumber: record.problem.reportNumber, title: record.supplier.title, severity: record.problem.severity,
      status: record.problem.status, rowVersion: c.rowVersion, contentVersion: record.supplier.version, instanceVersion: record.instance.version,
      sqeUserId: c.sqeUserId, sqeAssignmentId: c.sqeAssignmentId, responsibleSectionDepartmentId: c.responsibleSectionDepartmentId, document,
      submittedRevisionId: c.submittedRevisionId, approvedRevisionId: c.approvedRevisionId, analysisDueAt: iso(c.analysisDueAt), analysisCompletedAt: iso(c.analysisCompletedAt),
      submissionDueAt: iso(c.submissionDueAt), submittedAt: submitted?.createdAt.toISOString() ?? null, closureDueAt: iso(c.closureDueAt), closedAt: iso(c.closedAt), releasedToSupplierAt: iso(record.supplier.releasedToSupplierAt), allowedActions: actions,
      closure: round ? { id: round.id, problemId: round.problemId, instanceId: round.instanceId, workflowVersionId: round.workflowVersionId, contentVersion: round.contentVersion,
        roundNumber: round.roundNumber, status: round.status, version: round.version, createdAt: round.createdAt, updatedAt: round.updatedAt,
        duties: round.duties.map(({ id, duty, status, userId, decidedBy, comment, decidedAt, version }) => ({ id, duty, status, userId, decidedBy, comment, decidedAt, version })) } : null };
  }

  private async can(work: () => Promise<void>) { try { await work(); return true; } catch (e) { if (e instanceof HttpException && [401, 403, 404].includes(e.getStatus())) return false; throw e; } }
  private document(record: SupplierEightDRecord) { return normalizeProcessEightDDocument(record.supplier.responseDraft?.content ?? {}); }
  private editable(record: SupplierEightDRecord) {
    if (record.control.closedAt || record.problem.closedAt || record.problem.archivedAt || record.instance.status !== 'RUNNING' || record.node.type !== 'ACTION'
      || jsonObject(jsonObject(record.node.config).supplierEightD).schemaVersion !== 1) fail('WORKFLOW_ACTION_INVALID', 409);
  }
  private async lockUsers(tx: Prisma.TransactionClient, ids: string[]) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join([...new Set(ids)].sort().map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`);
  }
  private async receiptLock(tx: Prisma.TransactionClient, actor: SupplierEightDActor, organizationId: string, key: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`supplier-eight-d:${organizationId}:${actor.id}:${key}`}, 0))::text`;
  }
  private async receipt(tx: Prisma.TransactionClient, actor: SupplierEightDActor, organizationId: string, id: string, action: string, key: string, digest: string) {
    const [receipt] = await tx.$queryRaw<Receipt[]>`SELECT supplier_problem_id AS "supplierProblemId", action, digest, response FROM supplier_eight_d_receipts
      WHERE organization_id = ${organizationId}::uuid AND actor_user_id = ${actor.id}::uuid AND actor_organization_id = ${actor.organizationId}::uuid AND key = ${key}`;
    if (receipt && (receipt.supplierProblemId !== id || receipt.action !== action || receipt.digest !== digest)) fail('IDEMPOTENCY_REPLAY', 409);
    return receipt?.response ?? null;
  }
  private async storeReceipt(tx: Prisma.TransactionClient, actor: SupplierEightDActor, record: SupplierEightDRecord, action: string, key: string, digest: string, response: SupplierEightDReportDto) {
    await tx.$executeRaw`INSERT INTO supplier_eight_d_receipts (organization_id, supplier_problem_id, actor_user_id, actor_organization_id, key, action, digest, response)
      VALUES (${record.control.organizationId}::uuid, ${record.supplier.id}::uuid, ${actor.id}::uuid, ${actor.organizationId}::uuid, ${key}, ${action}, ${digest}, ${JSON.stringify(response)}::jsonb)`;
  }
  private async changed(tx: Prisma.TransactionClient, actor: SupplierEightDActor, record: SupplierEightDRecord, action: string, traceId: string, key: string) {
    await this.audit.record({ organizationId: record.control.organizationId, actorUserId: actor.id, action: `SUPPLIER_EIGHT_D_${action}`, resourceType: 'SupplierEightD', resourceId: record.supplier.id,
      outcome: 'SUCCESS', traceId, metadata: { resourceVersion: record.control.rowVersion, contentVersion: record.supplier.version } }, tx);
    await this.outbox.enqueue({ eventKey: `supplier-eight-d:${record.supplier.id}:${action}:${createHash('sha256').update(`${actor.id}:${key}`).digest('hex')}`, eventType: 'SUPPLIER_EIGHT_D_CHANGED', aggregateType: 'SupplierEightD', aggregateId: record.supplier.id,
      payload: { schemaVersion: 1, organizationId: record.control.organizationId, supplierProblemId: record.supplier.id, problemId: record.problem.id, rowVersion: record.control.rowVersion, contentVersion: record.supplier.version, action } }, tx);
  }
  private local(actor: SupplierEightDActor) { if (actor.accountType !== 'INTERNAL' || actor.scopeOrganizationId && actor.scopeOrganizationId !== actor.organizationId) fail('ORGANIZATION_SCOPE_DENIED', 403); }
  private uuid(id: string) { if (typeof id !== 'string' || !isUUID(id)) fail('SUPPLIER_INPUT_INVALID', 400); }
  private key(key: string) { if (typeof key !== 'string' || !/^[a-zA-Z0-9._:-]{8,128}$/.test(key)) fail('IDEMPOTENCY_KEY_REQUIRED', 400); }
  private positive(version: number) { if (!Number.isSafeInteger(version) || version < 1 || version > 2147483647) fail('CONCURRENCY_CONFLICT', 400); }
  private date(date: Date) { if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail('SUPPLIER_EIGHT_D_DUE_AT_INVALID', 400); }
  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    try { return await this.prisma.$transaction(work, { isolationLevel: 'ReadCommitted', timeout: 30_000 }); }
    catch (error) { if (isSecurityConcurrencyConflict(error)) fail('CONCURRENCY_CONFLICT', 409); throw error; }
  }
}
