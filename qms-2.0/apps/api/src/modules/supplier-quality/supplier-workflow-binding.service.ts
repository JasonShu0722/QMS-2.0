import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma, SupplierWorkflowBinding } from '../../generated/prisma/client.js';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor } from '../../common/security/admin-mutation.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { jsonObject } from '../workflow/workflow-runtime-policy.js';
import { MAX_WORKFLOW_SLA_MINUTES } from '../workflow/workflow.types.js';
import type { SetSupplierWorkflowBindingDto, SupplierBindingSelectorDto, SupplierWorkflowBindingDto } from './supplier-workflow-binding.dto.js';

type Flow = Prisma.WorkflowVersionGetPayload<{ include: { nodes: true } }>;

@Injectable()
export class SupplierWorkflowBindingService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService) {}

  private internal(actor: AdminActor) { if (actor.accountType !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403); }

  async list(actor: AdminActor, organizationId: string) {
    this.internal(actor);
    return this.prisma.$transaction(async (tx) => {
      await assertActiveAuthentication(tx, actor);
      await this.assertInternalOwner(tx, organizationId);
      await assertAdminAccess(tx, actor, organizationId, 'configuration:read');
      const ids = await tx.$queryRaw<{ id: string }[]>`SELECT DISTINCT ON (severity, response_form, reply_mode) id
        FROM supplier_workflow_bindings WHERE organization_id = ${organizationId}::uuid
        ORDER BY severity, response_form, reply_mode, version DESC`;
      const records = await tx.supplierWorkflowBinding.findMany({ where: { id: { in: ids.map((row) => row.id) } }, orderBy: [{ severity: 'asc' }, { responseForm: 'asc' }, { replyMode: 'asc' }] });
      return { items: await Promise.all(records.map(async (record) => this.dto(record, await this.flow(tx, organizationId, record.workflowVersionId)))) };
    });
  }

  set(actor: AdminActor, organizationId: string, dto: SetSupplierWorkflowBindingDto, traceId: string, key?: string) {
    this.internal(actor);
    return this.mutations.run({ actor, organizationId, key, traceId, permission: 'configuration:manage', action: 'SUPPLIER_WORKFLOW_BINDING_CREATED', payload: { organizationId, ...dto } }, async (tx) => {
      await this.assertInternalOwner(tx, organizationId);
      const selector = this.selector(dto);
      const latest = await tx.supplierWorkflowBinding.findFirst({ where: { organizationId, ...selector }, orderBy: { version: 'desc' } });
      if ((latest?.version ?? 0) !== dto.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
      const flow = await this.flow(tx, organizationId, dto.workflowVersionId);
      if (dto.enabled) this.assertUsable(flow);
      const record = await tx.supplierWorkflowBinding.create({ data: { organizationId, ...selector, version: dto.expectedVersion + 1, workflowVersionId: flow.id, enabled: dto.enabled, createdById: actor.id } });
      await this.audit.record({ actorUserId: actor.id, organizationId, action: 'SUPPLIER_WORKFLOW_BINDING_CREATED', resourceType: 'SupplierWorkflowBinding', resourceId: record.id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: record.version, status: dto.enabled ? 'ENABLED' : 'DISABLED' } }, tx);
      return this.dto(record, flow);
    });
  }

  /** Server-side issuance prerequisite. Caller authorizes the domain and persists the returned binding ID. */
  async resolve(tx: Prisma.TransactionClient, organizationId: string, selector: SupplierBindingSelectorDto) {
    const owner = await tx.organization.findFirst({ where: { id: organizationId, type: 'INTERNAL', status: 'ACTIVE' } });
    if (!owner) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    const binding = await tx.supplierWorkflowBinding.findFirst({ where: { organizationId, ...this.selector(selector) }, orderBy: { version: 'desc' } });
    if (!binding?.enabled) adminError('SUPPLIER_WORKFLOW_CONFIGURATION_REQUIRED', 409);
    const flow = await this.flow(tx, organizationId, binding.workflowVersionId);
    const reply = this.assertUsable(flow);
    return { bindingId: binding.id, bindingVersion: binding.version, workflowDefinitionId: flow.workflowDefinitionId, workflowVersionId: flow.id, replyNodeId: reply.id, responseSlaMinutes: Number(jsonObject(reply.config).slaMinutes) };
  }

  private selector(value: SupplierBindingSelectorDto) { return { severity: value.severity, responseForm: value.responseForm, replyMode: value.replyMode }; }

  private async assertInternalOwner(tx: Prisma.TransactionClient, organizationId: string) {
    const owner = await tx.organization.findUnique({ where: { id: organizationId }, select: { type: true, status: true } });
    if (!owner) adminError('ORGANIZATION_NOT_FOUND', 404);
    if (owner.type !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
  }

  private async flow(tx: Prisma.TransactionClient, organizationId: string, id: string) {
    const flow = await tx.workflowVersion.findFirst({ where: { id, organizationId }, include: { nodes: true } });
    if (!flow) adminError('SUPPLIER_WORKFLOW_CONFIGURATION_INVALID', 409);
    return flow;
  }

  private replies(flow: Flow) {
    return flow.nodes.filter((node) => node.type === 'ACTION' && jsonObject(jsonObject(node.config).assignment).permission === 'supplier-quality:responses:write');
  }

  private assertUsable(flow: Flow) {
    const replies = this.replies(flow);
    const minutes = replies.length === 1 ? jsonObject(replies[0]!.config).slaMinutes : undefined;
    const closes = flow.nodes.filter((node) => node.type === 'CLOSE');
    if (flow.status !== 'PUBLISHED' || replies.length !== 1 || !Number.isSafeInteger(minutes) || Number(minutes) < 1 || Number(minutes) > MAX_WORKFLOW_SLA_MINUTES
      || !flow.nodes.some((node) => node.type === 'VERIFICATION') || !closes.length || closes.some((node) => jsonObject(node.config).requireIndependentVerification !== true)) {
      adminError('SUPPLIER_WORKFLOW_CONFIGURATION_INVALID', 409);
    }
    return replies[0]!;
  }

  private dto(record: SupplierWorkflowBinding, flow: Flow): SupplierWorkflowBindingDto {
    const replies = this.replies(flow);
    const sla = replies.length === 1 ? jsonObject(replies[0]!.config).slaMinutes : undefined;
    return { ...record, severity: record.severity as SupplierWorkflowBindingDto['severity'], responseForm: record.responseForm as SupplierWorkflowBindingDto['responseForm'], replyMode: record.replyMode as SupplierWorkflowBindingDto['replyMode'],
      workflowDefinitionId: flow.workflowDefinitionId, workflowStatus: flow.status, responseSlaMinutes: typeof sla === 'number' ? sla : null, createdAt: record.createdAt.toISOString() };
  }
}
