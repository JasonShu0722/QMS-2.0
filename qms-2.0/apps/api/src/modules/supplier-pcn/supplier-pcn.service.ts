import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { FileLifecycleService } from '../file-management/file-lifecycle.service.js';
import { ProblemIndexService } from '../problem-index/problem-index.service.js';
import { SupplierQualityService } from '../supplier-quality/supplier-quality.service.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { jsonObject } from '../workflow/workflow-runtime-policy.js';
import { WorkflowRuntimeService } from '../workflow/workflow-runtime.service.js';
import type { AdvanceSupplierPcnDto, CreateSupplierPcnDto, ReviewSupplierPcnDto, StartSupplierPcnWorkflowDto, SubmitSupplierPcnDto, SupplierPcnFactsDto, SupplierPcnQueryDto, UpdateSupplierPcnDto } from './supplier-pcn.dto.js';

type Row = {
  id: string; owner_organization_id: string; supplier_organization_id: string; profile_id: string; supplier_name: string;
  change_type: string; title: string; material_code: string; before_change: string; after_change: string; reason: string; risk_control: string;
  planned_date: Date; status: string; version: number; file_id: string | null; problem_index_id: string | null; review_note: string | null;
  created_at: Date; updated_at: Date;
};
type Event = { event_type: string; pcn_version: number; actor_user_id: string; snapshot: object; note: string | null; created_at: Date };
function dto(row: Row) {
  return { id: row.id, profileId: row.profile_id, ownerOrganizationId: row.owner_organization_id, supplierOrganizationId: row.supplier_organization_id,
    supplierName: row.supplier_name, changeType: row.change_type, title: row.title, materialCode: row.material_code,
    beforeChange: row.before_change, afterChange: row.after_change, reason: row.reason, riskControl: row.risk_control,
    plannedDate: row.planned_date.toISOString().slice(0, 10), status: row.status, version: row.version, fileId: row.file_id,
    problemIndexId: row.problem_index_id, reviewNote: row.review_note, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
function clean(input: SupplierPcnFactsDto) {
  const facts = { changeType: input.changeType, title: input.title.trim(), materialCode: input.materialCode.trim(), beforeChange: input.beforeChange.trim(), afterChange: input.afterChange.trim(), reason: input.reason.trim(), riskControl: input.riskControl.trim(), plannedDate: input.plannedDate };
  if (Object.values(facts).some(value => !value)) adminError('SUPPLIER_INPUT_INVALID', 400);
  const date = new Date(`${input.plannedDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.plannedDate) adminError('SUPPLIER_INPUT_INVALID', 400);
  return { ...facts, date };
}

@Injectable()
export class SupplierPcnService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService,
    private readonly files: FileLifecycleService, private readonly supplier: SupplierQualityService, private readonly problems: ProblemIndexService,
    private readonly workflow: WorkflowRuntimeService) {}

  private scope(actor: AdminActor, requested?: string) {
    if (actor.accountType === 'SUPPLIER') {
      if (requested && requested !== actor.organizationId) adminError('ORGANIZATION_SCOPE_DENIED', 403);
      return actor.organizationId;
    }
    return requested ?? actor.scopeOrganizationId ?? actor.organizationId;
  }
  private permission(actor: AdminActor, write: boolean) {
    return actor.accountType === 'SUPPLIER' ? write ? 'supplier-pcn:submissions:write' : 'supplier-pcn:submissions:read'
      : write ? 'supplier-pcn:requests:approve' : 'supplier-pcn:requests:read';
  }
  private column(actor: AdminActor) { return actor.accountType === 'SUPPLIER' ? Prisma.raw('supplier_organization_id') : Prisma.raw('owner_organization_id'); }
  private async get(tx: AdminTransaction, actor: AdminActor, scope: string, id: string) {
    const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM supplier_pcns WHERE id = ${id}::uuid AND ${this.column(actor)} = ${scope}::uuid FOR UPDATE`);
    if (!row) adminError('SUPPLIER_RECORD_NOT_FOUND', 404);
    return row;
  }
  private async record(tx: AdminTransaction, actor: AdminActor, row: Row, eventType: 'CREATED' | 'UPDATED' | 'SUBMITTED' | 'STARTED' | 'NEEDS_CHANGES' | 'APPROVED' | 'CLOSED', traceId: string, note?: string) {
    await tx.$executeRaw`INSERT INTO supplier_pcn_events(id,pcn_id,event_type,pcn_version,actor_user_id,snapshot,file_id,note)
      VALUES(${randomUUID()}::uuid,${row.id}::uuid,${eventType},${row.version},${actor.id}::uuid,${JSON.stringify(dto(row))}::jsonb,${row.file_id}::uuid,${note ?? null})`;
    await this.audit.record({ organizationId: row.owner_organization_id, actorUserId: actor.id, action: `SUPPLIER_PCN_${eventType}`,
      resourceType: 'SupplierPcn', resourceId: row.id, outcome: 'SUCCESS', traceId,
      metadata: { version: row.version, profileId: row.profile_id, supplierOrganizationId: row.supplier_organization_id } }, tx);
  }
  private async full(tx: AdminTransaction, row: Row) {
    const events = await tx.$queryRaw<Event[]>`SELECT event_type,pcn_version,actor_user_id,snapshot,note,created_at FROM supplier_pcn_events WHERE pcn_id = ${row.id}::uuid ORDER BY pcn_version`;
    const problem = row.problem_index_id ? await tx.problemIndex.findFirst({ where: { id: row.problem_index_id, organizationId: row.owner_organization_id } }) : null;
    const instance = problem?.workflowInstanceId ? await tx.workflowInstance.findFirst({ where: { id: problem.workflowInstanceId, organizationId: row.owner_organization_id }, include: { currentNode: true } }) : null;
    return { ...dto(row), events: events.map(event => ({ eventType: event.event_type, pcnVersion: event.pcn_version, actorUserId: event.actor_user_id,
      snapshot: event.snapshot, note: event.note, createdAt: event.created_at.toISOString() })),
      workflow: instance && problem ? { instanceId: instance.id, currentNodeId: instance.currentNodeId, workflowVersionId: instance.workflowVersionId,
        version: instance.version, problemVersion: problem.version, status: instance.status, nodeType: instance.currentNode?.type ?? '' } : null };
  }

  async list(actor: AdminActor, query: SupplierPcnQueryDto) {
    const scope = this.scope(actor, query.organizationId);
    return this.prisma.$transaction(async tx => {
      await assertAdminAccess(tx, actor, scope, this.permission(actor, false));
      const filters = [Prisma.sql`${this.column(actor)} = ${scope}::uuid`];
      if (query.status) filters.push(Prisma.sql`status = ${query.status}`);
      const where = Prisma.join(filters, ' AND ');
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM supplier_pcns WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
      const [count] = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*) AS count FROM supplier_pcns WHERE ${where}`);
      return { items: rows.map(dto), total: Number(count?.count ?? 0), page: query.page, pageSize: query.pageSize };
    });
  }
  async detail(actor: AdminActor, id: string, requestedScope?: string) {
    const scope = this.scope(actor, requestedScope);
    return this.prisma.$transaction(async tx => {
      await assertAdminAccess(tx, actor, scope, this.permission(actor, false));
      return this.full(tx, await this.get(tx, actor, scope, id));
    });
  }
  async profiles(actor: AdminActor) {
    if (actor.accountType !== 'SUPPLIER') adminError('FEATURE_PERMISSION_DENIED', 403);
    return this.prisma.$transaction(async tx => {
      await assertAdminAccess(tx, actor, actor.organizationId, this.permission(actor, false));
      return { items: await this.supplier.pcnSupplierProfiles(tx, actor.organizationId) };
    });
  }
  create(actor: AdminActor, input: CreateSupplierPcnDto, traceId: string, key?: string) {
    if (actor.accountType !== 'SUPPLIER') adminError('FEATURE_PERMISSION_DENIED', 403);
    const facts = clean(input);
    return this.mutations.run({ actor, organizationId: actor.organizationId, key, traceId, action: 'SUPPLIER_PCN_CREATED', payload: input,
      permission: this.permission(actor, true), isolationLevel: 'ReadCommitted' }, async tx => {
      const profile = await this.supplier.pcnSupplierProfile(tx, actor.organizationId, input.profileId);
      const [row] = await tx.$queryRaw<Row[]>`INSERT INTO supplier_pcns(id,owner_organization_id,supplier_organization_id,profile_id,supplier_name,
        change_type,title,material_code,before_change,after_change,reason,risk_control,planned_date,created_by_id)
        VALUES(${randomUUID()}::uuid,${profile.ownerOrganizationId}::uuid,${profile.supplierOrganizationId}::uuid,${profile.id}::uuid,${profile.displayName},
        ${facts.changeType},${facts.title},${facts.materialCode},${facts.beforeChange},${facts.afterChange},${facts.reason},${facts.riskControl},${facts.date}::date,${actor.id}::uuid) RETURNING *`;
      await this.record(tx, actor, row!, 'CREATED', traceId);
      return dto(row!);
    });
  }
  update(actor: AdminActor, id: string, input: UpdateSupplierPcnDto, traceId: string, key?: string) {
    if (actor.accountType !== 'SUPPLIER') adminError('FEATURE_PERMISSION_DENIED', 403);
    const facts = clean(input);
    return this.mutations.run({ actor, organizationId: actor.organizationId, key, traceId, action: 'SUPPLIER_PCN_UPDATED', payload: { id, ...input },
      permission: this.permission(actor, true), isolationLevel: 'ReadCommitted' }, async tx => {
      const row = await this.get(tx, actor, actor.organizationId, id);
      if (row.version !== input.expectedVersion || !['DRAFT', 'NEEDS_CHANGES'].includes(row.status)) adminError('CONCURRENCY_CONFLICT', 409);
      const [updated] = await tx.$queryRaw<Row[]>`UPDATE supplier_pcns SET change_type=${facts.changeType},title=${facts.title},material_code=${facts.materialCode},
        before_change=${facts.beforeChange},after_change=${facts.afterChange},reason=${facts.reason},risk_control=${facts.riskControl},planned_date=${facts.date}::date,
        version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=${id}::uuid AND version=${input.expectedVersion} AND status IN ('DRAFT','NEEDS_CHANGES') RETURNING *`;
      if (!updated) adminError('CONCURRENCY_CONFLICT', 409);
      await this.record(tx, actor, updated, 'UPDATED', traceId);
      return dto(updated);
    });
  }
  submit(actor: AdminActor, id: string, input: SubmitSupplierPcnDto, traceId: string, key?: string) {
    if (actor.accountType !== 'SUPPLIER') adminError('FEATURE_PERMISSION_DENIED', 403);
    return this.mutations.run({ actor, organizationId: actor.organizationId, key, traceId, action: 'SUPPLIER_PCN_SUBMITTED', payload: { id, ...input },
      permission: this.permission(actor, true), isolationLevel: 'ReadCommitted' }, async tx => {
      const row = await this.get(tx, actor, actor.organizationId, id);
      if (row.version !== input.expectedVersion || !['DRAFT', 'NEEDS_CHANGES'].includes(row.status)) adminError('CONCURRENCY_CONFLICT', 409);
      await this.files.assertAttachable(tx, actor, { resourceType: 'supplier-pcn', resourceId: id }, [input.fileId]);
      const [updated] = await tx.$queryRaw<Row[]>`UPDATE supplier_pcns SET status='SUBMITTED',file_id=${input.fileId}::uuid,review_note=NULL,
        version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=${id}::uuid AND version=${input.expectedVersion} AND status IN ('DRAFT','NEEDS_CHANGES') RETURNING *`;
      if (!updated) adminError('CONCURRENCY_CONFLICT', 409);
      await this.record(tx, actor, updated, 'SUBMITTED', traceId);
      return dto(updated);
    });
  }

  private async workflowContext(tx: AdminTransaction, row: Row) {
    if (!row.problem_index_id) adminError('CONCURRENCY_CONFLICT', 409);
    const problem = await tx.problemIndex.findFirst({ where: { id: row.problem_index_id, organizationId: row.owner_organization_id, sourceType: 'supplier-pcn', sourceId: row.id } });
    if (!problem?.workflowInstanceId) adminError('CONCURRENCY_CONFLICT', 409);
    const instance = await tx.workflowInstance.findFirst({ where: { id: problem.workflowInstanceId, organizationId: row.owner_organization_id }, include: { currentNode: true } });
    if (!instance?.currentNode) adminError('CONCURRENCY_CONFLICT', 409);
    return { problem, instance, node: instance.currentNode };
  }
  private async assertFlow(tx: AdminTransaction, row: Row, definitionId: string, versionId: string) {
    const version = await tx.workflowVersion.findFirst({ where: { id: versionId, workflowDefinitionId: definitionId, organizationId: row.owner_organization_id, status: 'PUBLISHED' }, include: { nodes: true, transitions: true } });
    if (!version || version.nodes.length !== 3 || version.transitions.length !== 3) adminError('WORKFLOW_VERSION_NOT_FOUND', 404);
    const start = version.nodes.find(node => jsonObject(node.config).isStart === true);
    const approval = version.nodes.find(node => node.type === 'APPROVAL');
    const close = version.nodes.find(node => node.type === 'CLOSE' && jsonObject(node.config).isEnd === true);
    if (!start || start.type !== 'ACTION' || !approval || !close || jsonObject(jsonObject(start.config).assignment).permission !== 'supplier-pcn:submissions:write'
      || jsonObject(jsonObject(approval.config).assignment).permission !== 'supplier-pcn:requests:approve'
      || jsonObject(jsonObject(close.config).assignment).permission !== 'supplier-pcn:requests:approve'
      || !version.transitions.some(edge => edge.fromNodeId === start.id && edge.toNodeId === approval.id && edge.action === 'SUBMIT')
      || !version.transitions.some(edge => edge.fromNodeId === approval.id && edge.toNodeId === close.id && edge.action === 'APPROVE')
      || !version.transitions.some(edge => edge.fromNodeId === approval.id && edge.toNodeId === start.id && edge.action === 'RETURN')) adminError('WORKFLOW_DRAFT_INVALID', 409);
    return version;
  }
  start(actor: AdminActor, id: string, input: StartSupplierPcnWorkflowDto, traceId: string, key?: string) {
    if (actor.accountType !== 'INTERNAL') adminError('FEATURE_PERMISSION_DENIED', 403);
    const scope = this.scope(actor);
    return this.mutations.run({ actor, organizationId: scope, key, traceId, action: 'SUPPLIER_PCN_STARTED', payload: { id, ...input },
      permission: this.permission(actor, true), isolationLevel: 'ReadCommitted' }, async tx => {
      const row = await this.get(tx, actor, scope, id);
      if (row.version !== input.expectedVersion || row.status !== 'SUBMITTED' || row.problem_index_id) adminError('CONCURRENCY_CONFLICT', 409);
      await this.assertFlow(tx, row, input.workflowDefinitionId, input.workflowVersionId);
      await assertWorkflowFeature(tx, actor, scope, 'workflow:start');
      const problem = await this.problems.createFromDomain(tx as unknown as Parameters<ProblemIndexService['createFromDomain']>[0], { organizationId: scope, domainCode: 'supplier-pcn', problemType: 'PCN', sourceType: 'supplier-pcn',
        sourceId: id, severity: 'MEDIUM', responsibleParty: row.supplier_name, createdById: actor.id, traceId });
      const problemId = String(problem.id);
      const result = await this.workflow.startInstance({ organizationId: scope, actor, problemIndexId: problemId, workflowDefinitionId: input.workflowDefinitionId,
        workflowVersionId: input.workflowVersionId, expectedProblemVersion: Number(problem.version), instanceKey: `supplier-pcn:${id}`,
        idempotencyKey: `${key}:workflow`, traceId }, tx);
      const [updated] = await tx.$queryRaw<Row[]>`UPDATE supplier_pcns SET problem_index_id=${problemId}::uuid,version=version+1,updated_at=CURRENT_TIMESTAMP
        WHERE id=${id}::uuid AND version=${input.expectedVersion} AND problem_index_id IS NULL RETURNING *`;
      if (!updated) adminError('CONCURRENCY_CONFLICT', 409);
      await this.record(tx, actor, updated, 'STARTED', traceId);
      return { ...await this.full(tx, updated), workflow: { ...result, nodeType: 'ACTION' } };
    }, async tx => { await this.get(tx, actor, scope, id); });
  }
  review(actor: AdminActor, id: string, input: ReviewSupplierPcnDto, traceId: string, key?: string) {
    if (actor.accountType !== 'INTERNAL') adminError('FEATURE_PERMISSION_DENIED', 403);
    const scope = this.scope(actor);
    const note = input.note.trim();
    if (!note) adminError('SUPPLIER_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId: scope, key, traceId, action: `SUPPLIER_PCN_${input.action}`, payload: { id, ...input },
      permission: this.permission(actor, true), isolationLevel: 'ReadCommitted' }, async tx => {
      const row = await this.get(tx, actor, scope, id);
      if (row.version !== input.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
      const { problem, instance, node } = await this.workflowContext(tx, row);
      if (input.expectedWorkflowVersion !== instance.version || input.expectedProblemVersion !== problem.version || input.currentNodeId !== node.id) adminError('CONCURRENCY_CONFLICT', 409);
      if (input.action === 'CLOSE' ? row.status !== 'APPROVED' || node.type !== 'CLOSE' : row.status !== 'SUBMITTED' || node.type !== 'APPROVAL') adminError('CONCURRENCY_CONFLICT', 409);
      if (input.action === 'APPROVE') {
        if (!row.file_id) adminError('FILE_NOT_AVAILABLE', 409);
        const [evidence] = await this.files.readEvidence(tx, actor, [{ resource: { resourceType: 'supplier-pcn', resourceId: id }, fileIds: [row.file_id] }]);
        if (!evidence?.downloadable) adminError('FILE_NOT_AVAILABLE', 409);
      }
      await this.workflow.submitAction({ organizationId: scope, actor, problemIndexId: problem.id, workflowVersionId: instance.workflowVersionId,
        expectedProblemVersion: problem.version, instanceId: instance.id, currentNodeId: node.id, expectedVersion: instance.version,
        action: input.action, idempotencyKey: `${key}:workflow`, traceId }, tx, async transaction => {
        const status = input.action === 'RETURN' ? 'NEEDS_CHANGES' : input.action === 'CLOSE' ? 'CLOSED' : 'APPROVED';
        const [updated] = await transaction.$queryRaw<Row[]>`UPDATE supplier_pcns SET status=${status},review_note=${note},version=version+1,updated_at=CURRENT_TIMESTAMP
          WHERE id=${id}::uuid AND version=${input.expectedVersion} RETURNING *`;
        if (!updated) adminError('CONCURRENCY_CONFLICT', 409);
        await this.record(transaction, actor, updated, status, traceId, note);
      });
      const updated = await this.get(tx, actor, scope, id);
      return dto(updated);
    }, async tx => { await this.get(tx, actor, scope, id); });
  }
  advance(actor: AdminActor, id: string, input: AdvanceSupplierPcnDto, traceId: string, key?: string) {
    if (actor.accountType !== 'SUPPLIER') adminError('FEATURE_PERMISSION_DENIED', 403);
    return this.mutations.run({ actor, organizationId: actor.organizationId, key, traceId, action: 'SUPPLIER_PCN_ADVANCED', payload: { id, ...input },
      permission: this.permission(actor, true), isolationLevel: 'ReadCommitted' }, async tx => {
      const row = await this.get(tx, actor, actor.organizationId, id);
      if (row.version !== input.expectedVersion || row.status !== 'SUBMITTED' || row.file_id !== input.fileId) adminError('CONCURRENCY_CONFLICT', 409);
      const { problem, instance, node } = await this.workflowContext(tx, row);
      if (node.type !== 'ACTION' || input.expectedWorkflowVersion !== instance.version || input.expectedProblemVersion !== problem.version || input.currentNodeId !== node.id) adminError('CONCURRENCY_CONFLICT', 409);
      const [evidence] = await this.files.readEvidence(tx, actor, [{ resource: { resourceType: 'supplier-pcn', resourceId: id }, fileIds: [input.fileId] }]);
      if (!evidence?.downloadable) adminError('FILE_NOT_AVAILABLE', 409);
      await this.workflow.submitAction({ organizationId: row.owner_organization_id, actor, problemIndexId: problem.id, workflowVersionId: instance.workflowVersionId,
        expectedProblemVersion: problem.version, instanceId: instance.id, currentNodeId: node.id, expectedVersion: instance.version,
        action: 'SUBMIT', idempotencyKey: `${key}:workflow`, traceId }, tx,
        undefined, async (transaction) => { await this.get(transaction, actor, actor.organizationId, id); }, {
          authorize: async (transaction) => { await assertWorkflowFeature(transaction, actor, actor.organizationId, 'supplier-pcn:submissions:write'); },
          lock: async (transaction) => { await this.get(transaction, actor, actor.organizationId, id); },
        });
      return dto(row);
    }, async tx => { await this.get(tx, actor, actor.organizationId, id); });
  }
}
