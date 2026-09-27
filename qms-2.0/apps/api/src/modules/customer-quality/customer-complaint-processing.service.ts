import { HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { FileLifecycleService } from '../file-management/file-lifecycle.service.js';
import { validateEightDContent, type CustomerComplaintEightDContent } from './customer-complaint-8d.rules.js';
import { WorkflowRuntimeService } from '../workflow/workflow-runtime.service.js';
import { jsonObject } from '../workflow/workflow-runtime-policy.js';

type Row = Record<string, any>;
export type ComplaintCategory = 'PRODUCT_QUALITY' | 'DELIVERY' | 'SERVICE' | 'OTHER';
export type TriageInput = { expectedVersion: number; category: ComplaintCategory; categoryNote?: string | null; responsibleDepartmentId: string; ownerUserId: string; note: string };
export type ProgressInput = { expectedVersion: number; note: string; evidenceFileObjectId?: string };
export type ResolveInput = { expectedVersion: number; resolutionSummary: string };
export type NoteInput = { expectedVersion: number; note: string };

function fail(code: string, status: number): never { throw new HttpException({ code, message: code }, status); }
function validUuid(id: string): string { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400); return id; }
function note(value: string, max = 10000): string { const result = value?.trim(); if (!result || result.length > max) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400); return result; }
function version(value: number) { if (!Number.isSafeInteger(value) || value < 1) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400); }

@Injectable()
export class CustomerComplaintProcessingService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService, private readonly files: FileLifecycleService, private readonly runtime?: WorkflowRuntimeService) {}

  private scope(actor: AdminActor) {
    if (actor.accountType !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
    return actor.scopeOrganizationId ?? actor.organizationId;
  }

  async assignees(actor: AdminActor) {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, 'customer-quality:complaints:read');
      const [departments, users] = await Promise.all([
        tx.department.findMany({ where: { organizationId, status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        tx.user.findMany({ where: { organizationId, status: 'ACTIVE', accountType: 'INTERNAL' }, select: { id: true, username: true }, orderBy: { username: 'asc' } }),
      ]);
      return { departments, users };
    });
  }

  async events(actor: AdminActor, id: string) {
    const organizationId = this.scope(actor); id = validUuid(id);
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, 'customer-quality:complaints:read');
      const complaint = await tx.$queryRaw<Row[]>`SELECT id FROM customer_quality_complaints WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`;
      if (!complaint[0]) fail('CUSTOMER_COMPLAINT_NOT_FOUND', 404);
      return tx.$queryRaw<Row[]>`SELECT * FROM customer_quality_complaint_events WHERE organization_id = ${organizationId}::uuid AND complaint_id = ${id}::uuid ORDER BY seq ASC`;
    });
  }

  async attachments(actor: AdminActor, id: string) {
    await this.events(actor, id);
    return this.files.listResource(actor, { resourceType: 'CustomerComplaint', resourceId: id });
  }

  private async locked(tx: AdminTransaction, organizationId: string, id: string, expectedVersion: number): Promise<Row> {
    const rows = await tx.$queryRaw<Row[]>`SELECT * FROM customer_quality_complaints WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
    if (!rows[0]) fail('CUSTOMER_COMPLAINT_NOT_FOUND', 404);
    if (rows[0].version !== expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
    return rows[0];
  }

  private async append(tx: AdminTransaction, organizationId: string, complaint: Row, actor: AdminActor, eventType: string, toStatus: string, description: string, evidenceFileObjectId: string | null = null) {
    await tx.$executeRaw`INSERT INTO customer_quality_complaint_events
      (id, organization_id, complaint_id, seq, event_type, from_status, to_status, note, category, responsible_department_id, owner_user_id, evidence_file_object_id, actor_user_id)
      VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${complaint.id}::uuid,
      (SELECT COALESCE(MAX(seq), 0) + 1 FROM customer_quality_complaint_events WHERE organization_id = ${organizationId}::uuid AND complaint_id = ${complaint.id}::uuid),
      ${eventType}, ${complaint.status}, ${toStatus}, ${description}, ${complaint.category}, ${complaint.responsible_department_id}::uuid, ${complaint.owner_user_id}::uuid, ${evidenceFileObjectId}::uuid, ${actor.id}::uuid)`;
  }

  private async mutate(actor: AdminActor, id: string, expectedVersion: number, action: string, payload: unknown, traceId: string, key: string | undefined, work: (tx: AdminTransaction, organizationId: string, complaint: Row) => Promise<Row>) {
    const organizationId = this.scope(actor); id = validUuid(id); version(expectedVersion);
    return this.mutations.run({ actor, organizationId, key, traceId, action, payload: { id, ...payload as object }, permission: 'customer-quality:complaints:write', isolationLevel: 'ReadCommitted' }, async (tx) => {
      const complaint = await this.locked(tx, organizationId, id, expectedVersion);
      const updated = await work(tx, organizationId, complaint);
      await this.audit.record({ organizationId, actorUserId: actor.id, action, resourceType: 'CustomerComplaint', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: updated.version } }, tx);
      return updated;
    });
  }

  async triage(actor: AdminActor, id: string, input: TriageInput, traceId: string, key?: string) {
    const category = input.category;
    if (!['PRODUCT_QUALITY', 'DELIVERY', 'SERVICE', 'OTHER'].includes(category)) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    const categoryNote = input.categoryNote?.trim() || null;
    if ((category === 'OTHER' && (!categoryNote || categoryNote.length > 200)) || (category !== 'OTHER' && categoryNote)) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    const departmentId = validUuid(input.responsibleDepartmentId); const ownerId = validUuid(input.ownerUserId); const description = note(input.note);
    return this.mutate(actor, id, input.expectedVersion, 'CUSTOMER_COMPLAINT_TRIAGED', { ...input, categoryNote, note: description }, traceId, key, async (tx, organizationId, complaint) => {
      if (!['OPEN', 'IN_ANALYSIS'].includes(complaint.status)) fail('CUSTOMER_COMPLAINT_TRANSITION_INVALID', 409);
      const department = await tx.department.findFirst({ where: { id: departmentId, organizationId, status: 'ACTIVE' } });
      const owner = await tx.user.findFirst({ where: { id: ownerId, organizationId, accountType: 'INTERNAL', status: 'ACTIVE' } });
      if (!department || !owner) fail('CUSTOMER_COMPLAINT_RESPONSIBILITY_INVALID', 400);
      const rows = await tx.$queryRaw<Row[]>`UPDATE customer_quality_complaints SET category = ${category}, category_note = ${categoryNote}, responsible_department_id = ${departmentId}::uuid, owner_user_id = ${ownerId}::uuid, status = 'IN_ANALYSIS', version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${complaint.id}::uuid RETURNING *`;
      await this.append(tx, organizationId, { ...complaint, category, responsible_department_id: departmentId, owner_user_id: ownerId }, actor, complaint.status === 'OPEN' ? 'TRIAGED' : 'REASSIGNED', 'IN_ANALYSIS', description);
      return rows[0]!;
    });
  }

  async progress(actor: AdminActor, id: string, input: ProgressInput, traceId: string, key?: string) {
    const description = note(input.note); const evidenceId = input.evidenceFileObjectId ? validUuid(input.evidenceFileObjectId) : null;
    return this.mutate(actor, id, input.expectedVersion, 'CUSTOMER_COMPLAINT_PROGRESS_RECORDED', { expectedVersion: input.expectedVersion, note: description, evidenceId }, traceId, key, async (tx, organizationId, complaint) => {
      if (complaint.status !== 'IN_ANALYSIS') fail('CUSTOMER_COMPLAINT_TRANSITION_INVALID', 409);
      if (evidenceId) {
        await this.files.assertAttachable(tx, actor, { resourceType: 'CustomerComplaint', resourceId: id }, [evidenceId]);
      }
      const rows = await tx.$queryRaw<Row[]>`UPDATE customer_quality_complaints SET version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${complaint.id}::uuid RETURNING *`;
      await this.append(tx, organizationId, complaint, actor, 'PROGRESS_RECORDED', complaint.status, description, evidenceId);
      return rows[0]!;
    });
  }

  async resolve(actor: AdminActor, id: string, input: ResolveInput, traceId: string, key?: string) {
    const summary = note(input.resolutionSummary);
    return this.mutate(actor, id, input.expectedVersion, 'CUSTOMER_COMPLAINT_RESOLVED', { expectedVersion: input.expectedVersion, summary }, traceId, key, async (tx, organizationId, complaint) => {
      if (complaint.status !== 'IN_ANALYSIS' || !complaint.category || !complaint.responsible_department_id || !complaint.owner_user_id) fail('CUSTOMER_COMPLAINT_TRANSITION_INVALID', 409);
      if (complaint.physical_analysis_required) {
        const analyses = await tx.$queryRaw<Row[]>`SELECT status, evidence_summary FROM customer_quality_physical_analyses WHERE organization_id = ${organizationId}::uuid AND complaint_id = ${complaint.id}::uuid ORDER BY version DESC LIMIT 1`;
        if (analyses[0]?.status !== 'COMPLETED' && !(analyses[0]?.status === 'MISSING' && analyses[0].evidence_summary?.trim())) fail('CUSTOMER_COMPLAINT_ANALYSIS_REQUIRED', 409);
      }
      if (complaint.return_required) {
        const dispositions = await tx.$queryRaw<Row[]>`SELECT status FROM customer_quality_physical_dispositions WHERE organization_id = ${organizationId}::uuid AND complaint_id = ${complaint.id}::uuid ORDER BY version DESC LIMIT 1`;
        if (dispositions[0]?.status !== 'CLOSED') fail('CUSTOMER_COMPLAINT_DISPOSITION_REQUIRED', 409);
      }
      const snapshot = complaint.severity_snapshot as Record<string, unknown>;
      if (snapshot.requiresFormalIssue === true) {
        const links = await tx.domainSourceIssueLink.count({ where: { organizationId, sourceDomain: 'customer-quality', sourceType: 'customer-complaint', sourceId: complaint.id, removedAt: null } });
        if (!links) fail('CUSTOMER_COMPLAINT_FORMAL_ISSUE_REQUIRED', 409);
      }
      const rows = await tx.$queryRaw<Row[]>`UPDATE customer_quality_complaints SET status = 'RESOLVED', resolution_summary = ${summary}, resolved_at = CURRENT_TIMESTAMP, resolved_by_id = ${actor.id}::uuid, version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${complaint.id}::uuid RETURNING *`;
      await this.append(tx, organizationId, complaint, actor, 'RESOLVED', 'RESOLVED', summary);
      return rows[0]!;
    });
  }

  async close(actor: AdminActor, id: string, input: NoteInput, traceId: string, key?: string) {
    const description = note(input.note);
    return this.mutate(actor, id, input.expectedVersion, 'CUSTOMER_COMPLAINT_CLOSED', { expectedVersion: input.expectedVersion, note: description }, traceId, key, async (tx, organizationId, complaint) => {
      if (complaint.status !== 'RESOLVED') fail('CUSTOMER_COMPLAINT_TRANSITION_INVALID', 409);
      if (complaint.resolved_by_id === actor.id) fail('CUSTOMER_COMPLAINT_INDEPENDENT_REVIEW_REQUIRED', 403);
      const problems = await tx.$queryRaw<Row[]>`SELECT p.status AS problem_status, wi.status AS workflow_status FROM domain_source_issue_links l JOIN problem_indexes p ON p.id = l.problem_index_id AND p.organization_id = l.organization_id LEFT JOIN workflow_instances wi ON wi.id = p.workflow_instance_id AND wi.organization_id = p.organization_id WHERE l.organization_id = ${organizationId}::uuid AND l.source_domain = 'customer-quality' AND l.source_type = 'customer-complaint' AND l.source_id = ${complaint.id}::uuid AND l.removed_at IS NULL FOR UPDATE OF l, p`;
      if (problems.some((problem) => !['CLOSED', 'ARCHIVED'].includes(problem.problem_status) || problem.workflow_status !== 'COMPLETED')) fail('CUSTOMER_COMPLAINT_ISSUE_OPEN', 409);
      const eightD = await tx.$queryRaw<Row[]>`SELECT c.eight_d_status, wd.code AS workflow_code FROM customer_quality_complaints c JOIN domain_source_issue_links l ON l.organization_id = c.organization_id AND l.source_domain = 'customer-quality' AND l.source_type = 'customer-complaint' AND l.source_id = c.id AND l.removed_at IS NULL JOIN problem_indexes p ON p.organization_id = l.organization_id AND p.id = l.problem_index_id JOIN workflow_instances wi ON wi.organization_id = p.organization_id AND wi.id = p.workflow_instance_id JOIN workflow_definitions wd ON wd.organization_id = wi.organization_id AND wd.id = wi.workflow_definition_id WHERE c.organization_id = ${organizationId}::uuid AND c.id = ${complaint.id}::uuid AND wd.code = 'CUSTOMER_8D'`;
      if (eightD.some((entry) => entry.eight_d_status !== 'APPROVED')) fail('CUSTOMER_8D_APPROVAL_REQUIRED', 409);
      const rows = await tx.$queryRaw<Row[]>`UPDATE customer_quality_complaints SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP, closed_by_id = ${actor.id}::uuid, closure_note = ${description}, version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${complaint.id}::uuid RETURNING *`;
      await this.append(tx, organizationId, complaint, actor, 'CLOSED', 'CLOSED', description);
      return rows[0]!;
    });
  }

  async reopen(actor: AdminActor, id: string, input: NoteInput, traceId: string, key?: string) {
    const description = note(input.note);
    return this.mutate(actor, id, input.expectedVersion, 'CUSTOMER_COMPLAINT_REOPENED', { expectedVersion: input.expectedVersion, note: description }, traceId, key, async (tx, organizationId, complaint) => {
      if (!['RESOLVED', 'CLOSED'].includes(complaint.status)) fail('CUSTOMER_COMPLAINT_TRANSITION_INVALID', 409);
      const department = await tx.department.findFirst({ where: { id: complaint.responsible_department_id, organizationId, status: 'ACTIVE' } });
      const owner = await tx.user.findFirst({ where: { id: complaint.owner_user_id, organizationId, accountType: 'INTERNAL', status: 'ACTIVE' } });
      if (!department || !owner) fail('CUSTOMER_COMPLAINT_RESPONSIBILITY_INVALID', 409);
      const rows = await tx.$queryRaw<Row[]>`UPDATE customer_quality_complaints SET status = 'IN_ANALYSIS', resolution_summary = NULL, resolved_at = NULL, resolved_by_id = NULL, closed_at = NULL, closed_by_id = NULL, closure_note = NULL, version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${complaint.id}::uuid RETURNING *`;
      await this.append(tx, organizationId, complaint, actor, 'REOPENED', 'IN_ANALYSIS', description);
      return rows[0]!;
    });
  }

  private eightDDto(row: Row) {
    const content = (row.eight_d_content ?? {}) as CustomerComplaintEightDContent;
    return { complaintId: row.id, ...content, version: row.version, status: row.eight_d_status, approvalLevel: row.eight_d_approval_level,
      submittedAt: row.eight_d_submitted_at?.toISOString?.() ?? null, approvedAt: row.eight_d_approved_at?.toISOString?.() ?? null };
  }

  private async formalWorkflow(tx: AdminTransaction, organizationId: string, complaintId: string): Promise<Row & { approvalLevel: string | null }> {
    const [row] = await tx.$queryRaw<Row[]>`SELECT p.id AS problem_id, p.version AS problem_version, p.status AS problem_status, wi.id AS instance_id, wi.workflow_version_id, wi.version AS instance_version, wi.current_node_id, wd.code AS workflow_code FROM domain_source_issue_links l JOIN problem_indexes p ON p.organization_id = l.organization_id AND p.id = l.problem_index_id JOIN workflow_instances wi ON wi.organization_id = p.organization_id AND wi.id = p.workflow_instance_id JOIN workflow_definitions wd ON wd.organization_id = wi.organization_id AND wd.id = wi.workflow_definition_id WHERE l.organization_id = ${organizationId}::uuid AND l.source_domain = 'customer-quality' AND l.source_type = 'customer-complaint' AND l.source_id = ${complaintId}::uuid AND l.removed_at IS NULL AND wd.code = 'CUSTOMER_8D' ORDER BY l.linked_at DESC LIMIT 1`;
    if (!row || row.workflow_code !== 'CUSTOMER_8D' || !row.current_node_id) fail('CUSTOMER_8D_REQUIRES_FORMAL_ISSUE', 409);
    const nodes = await tx.workflowNode.findMany({ where: { organizationId, workflowVersionId: row.workflow_version_id } });
    const approval = nodes.find((node) => node.type === 'APPROVAL');
    const approvalLevel = approval ? jsonObject(approval.config).approvalLevel : null;
    return { ...row, approvalLevel: typeof approvalLevel === 'string' ? approvalLevel : null };
  }

  async eightD(actor: AdminActor, id: string) {
    const organizationId = this.scope(actor); id = validUuid(id);
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, 'customer-quality:complaints:read');
      const [row] = await tx.$queryRaw<Row[]>`SELECT * FROM customer_quality_complaints WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`;
      if (!row) fail('CUSTOMER_COMPLAINT_NOT_FOUND', 404);
      await this.formalWorkflow(tx, organizationId, id);
      return this.eightDDto(row);
    });
  }

  async saveEightD(actor: AdminActor, id: string, input: { expectedVersion: number; content: unknown }, traceId: string, key?: string) {
    let content: CustomerComplaintEightDContent;
    try { content = validateEightDContent(input.content, 'DRAFT'); } catch { fail('CUSTOMER_8D_INPUT_INVALID', 400); }
    const organizationId = this.scope(actor); const complaintId = validUuid(id);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'CUSTOMER_COMPLAINT_8D_DRAFT_SAVED', payload: { id: complaintId, ...input }, permission: 'customer-quality:complaints:write', isolationLevel: 'ReadCommitted' }, async (tx) => {
      const complaint = await this.locked(tx, organizationId, complaintId, input.expectedVersion);
      const workflow = await this.formalWorkflow(tx, organizationId, id);
      if (complaint.eight_d_status !== 'DRAFT') fail('CUSTOMER_8D_LOCKED', 409);
      const [row] = await tx.$queryRaw<Row[]>`UPDATE customer_quality_complaints SET eight_d_content = ${JSON.stringify(content)}::jsonb, eight_d_version = eight_d_version + 1, eight_d_approval_level = ${workflow.approvalLevel}, version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${complaint.id}::uuid AND version = ${input.expectedVersion} RETURNING *`;
      await this.audit.record({ organizationId: complaint.organization_id, actorUserId: actor.id, action: 'CUSTOMER_COMPLAINT_8D_DRAFT_SAVED', resourceType: 'CustomerComplaint8D', resourceId: complaintId, outcome: 'SUCCESS', traceId, metadata: { version: row!.version, eightDVersion: row!.eight_d_version } }, tx);
      return this.eightDDto(row!);
    });
  }

  async submitEightD(actor: AdminActor, id: string, input: { expectedVersion: number; content: unknown }, traceId: string, key?: string) {
    let content: CustomerComplaintEightDContent;
    try { content = validateEightDContent(input.content, 'SUBMIT'); } catch (error) { fail((error as Error).message === 'CUSTOMER_8D_SUBMISSION_INCOMPLETE' ? 'CUSTOMER_8D_SUBMISSION_INCOMPLETE' : 'CUSTOMER_8D_INPUT_INVALID', 400); }
    const organizationId = this.scope(actor); const complaintId = validUuid(id); const workflow = await this.prisma.$transaction((tx) => this.formalWorkflow(tx, organizationId, complaintId));
    if (!key) fail('IDEMPOTENCY_KEY_REQUIRED', 400);
    if (!this.runtime) fail('CUSTOMER_8D_WORKFLOW_CONFIGURATION_REQUIRED', 409);
    await this.runtime.submitAction({ organizationId, actor, problemIndexId: workflow.problem_id, workflowVersionId: workflow.workflow_version_id, expectedProblemVersion: workflow.problem_version, idempotencyKey: key, traceId, instanceId: workflow.instance_id, currentNodeId: workflow.current_node_id, expectedVersion: workflow.instance_version, action: 'SUBMIT', commandPayload: { complaintId, expectedVersion: input.expectedVersion } }, undefined, async (tx) => {
      const complaint = await this.locked(tx, organizationId, complaintId, input.expectedVersion);
      if (complaint.eight_d_status !== 'DRAFT') fail('CUSTOMER_8D_LOCKED', 409);
      const evidence = await this.files.readEvidence(tx, actor, [{ resource: { resourceType: 'CustomerComplaint', resourceId: complaintId }, fileIds: content.verificationEvidenceFileIds }]);
      if (evidence.length !== content.verificationEvidenceFileIds.length || evidence.some((file) => !file.downloadable)) fail('CUSTOMER_8D_EVIDENCE_INVALID', 409);
      await tx.$executeRaw`UPDATE customer_quality_complaints SET eight_d_content = ${JSON.stringify(content)}::jsonb, eight_d_version = eight_d_version + 1, eight_d_status = 'SUBMITTED', eight_d_approval_level = ${workflow.approvalLevel}, eight_d_submitted_at = CURRENT_TIMESTAMP, eight_d_submitted_by_id = ${actor.id}::uuid, version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${complaintId}::uuid AND version = ${input.expectedVersion}`;
    }, async (tx) => { const latest = await this.formalWorkflow(tx, organizationId, complaintId); if (latest.problem_id !== workflow.problem_id || latest.instance_id !== workflow.instance_id) fail('CONCURRENCY_CONFLICT', 409); });
    const [row] = await this.prisma.$queryRaw<Row[]>`SELECT * FROM customer_quality_complaints WHERE id = ${complaintId}::uuid AND organization_id = ${organizationId}::uuid`;
    return this.eightDDto(row!);
  }

  async approveEightD(actor: AdminActor, id: string, input: { expectedVersion: number; note: string }, traceId: string, key?: string) {
    const noteText = note(input.note, 2000);
    const organizationId = this.scope(actor); const complaintId = validUuid(id); const workflow = await this.prisma.$transaction((tx) => this.formalWorkflow(tx, organizationId, complaintId));
    if (!key) fail('IDEMPOTENCY_KEY_REQUIRED', 400);
    if (!this.runtime) fail('CUSTOMER_8D_WORKFLOW_CONFIGURATION_REQUIRED', 409);
    await this.runtime.submitAction({ organizationId, actor, problemIndexId: workflow.problem_id, workflowVersionId: workflow.workflow_version_id, expectedProblemVersion: workflow.problem_version, idempotencyKey: key, traceId, instanceId: workflow.instance_id, currentNodeId: workflow.current_node_id, expectedVersion: workflow.instance_version, action: 'APPROVE', commandPayload: { complaintId, expectedVersion: input.expectedVersion, note: noteText } }, undefined, async (tx) => {
      const complaint = await this.locked(tx, organizationId, complaintId, input.expectedVersion);
      if (complaint.eight_d_status !== 'SUBMITTED') fail('CUSTOMER_8D_APPROVAL_INVALID', 409);
      if (complaint.eight_d_submitted_by_id === actor.id) fail('CUSTOMER_8D_INDEPENDENT_APPROVAL_REQUIRED', 403);
      const content = complaint.eight_d_content as CustomerComplaintEightDContent;
      const evidence = await this.files.readEvidence(tx, actor, [{ resource: { resourceType: 'CustomerComplaint', resourceId: complaintId }, fileIds: content.verificationEvidenceFileIds }]);
      if (evidence.length !== content.verificationEvidenceFileIds.length || evidence.some((file) => !file.downloadable)) fail('CUSTOMER_8D_EVIDENCE_INVALID', 409);
      await tx.$executeRaw`UPDATE customer_quality_complaints SET eight_d_status = 'APPROVED', eight_d_approved_at = CURRENT_TIMESTAMP, eight_d_approved_by_id = ${actor.id}::uuid, version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${complaintId}::uuid AND version = ${input.expectedVersion}`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'CUSTOMER_COMPLAINT_8D_APPROVED', resourceType: 'CustomerComplaint8D', resourceId: complaintId, outcome: 'SUCCESS', traceId, metadata: { approvalLevel: complaint.eight_d_approval_level, note: noteText, version: complaint.version + 1 } }, tx);
    }, async (tx) => { const latest = await this.formalWorkflow(tx, organizationId, complaintId); if (latest.problem_id !== workflow.problem_id || latest.instance_id !== workflow.instance_id) fail('CONCURRENCY_CONFLICT', 409); });
    const [row] = await this.prisma.$queryRaw<Row[]>`SELECT * FROM customer_quality_complaints WHERE id = ${complaintId}::uuid AND organization_id = ${organizationId}::uuid`;
    return this.eightDDto(row!);
  }
}
