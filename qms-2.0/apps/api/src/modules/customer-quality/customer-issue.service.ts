import { HttpException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertAdminAccess, type AdminActor } from '../../common/security/admin-mutation.service.js';
import { DomainSourceIssueService, type DomainSourceReference, type DomainSourceResponseForm } from '../problem-index/domain-source-issue.service.js';
import { DomainSourceLinkService } from '../problem-index/domain-source-link.service.js';
import { WorkflowRuntimeService } from '../workflow/workflow-runtime.service.js';
import { jsonObject } from '../workflow/workflow-runtime-policy.js';
import { CustomerQualityService } from './customer-quality.service.js';

export interface IssueCustomerComplaintsInput {
  sources: Array<{ complaintId: string; expectedVersion: number }>;
  problemType: string;
  responseForm: DomainSourceResponseForm;
  responsibleScope: string;
  ownerId?: string;
  dueAt?: Date;
  workflowBinding: { workflowDefinitionId: string; workflowVersionId: string; instanceKey: string };
}

export interface ChangeCustomerIssueSourcesInput {
  expectedProblemVersion: number;
  add: Array<{ complaintId: string; expectedVersion: number }>;
  remove: string[];
  primaryComplaintId?: string;
}

function reject(code: string, status: number): never {
  throw new HttpException({ code, message: code }, status);
}

@Injectable()
export class CustomerIssueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: CustomerQualityService,
    private readonly domainIssues: DomainSourceIssueService,
    private readonly runtime: WorkflowRuntimeService,
    private readonly sourceLinks: DomainSourceLinkService,
  ) {}

  async issue(actor: AdminActor, input: IssueCustomerComplaintsInput, traceId: string, idempotencyKey?: string) {
    if (actor.accountType !== 'INTERNAL') reject('ORGANIZATION_SCOPE_DENIED', 403);
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    if (organizationId !== actor.organizationId) reject('ORGANIZATION_SCOPE_DENIED', 403);
    if (input.problemType !== 'CUSTOMER_COMPLAINT' || input.responsibleScope !== 'customer-quality') reject('CUSTOMER_ISSUE_SCOPE_INVALID', 400);
    if (!Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 100) reject('CUSTOMER_ISSUE_SOURCES_INVALID', 400);
    if (new Set(input.sources.map((source) => source.complaintId)).size !== input.sources.length) reject('CUSTOMER_ISSUE_SOURCES_DUPLICATE', 400);
    if (input.sources.some((source) => !Number.isSafeInteger(source.expectedVersion) || source.expectedVersion < 1)) reject('CUSTOMER_ISSUE_SOURCE_VERSION_INVALID', 400);
    if (!idempotencyKey || !/^[a-zA-Z0-9._:-]{8,128}$/.test(idempotencyKey)) reject('IDEMPOTENCY_KEY_REQUIRED', 400);
    const digest = createHash('sha256').update(idempotencyKey ?? '').digest('hex');
    const event = await this.prisma.outboxEvent.findUnique({ where: { eventKey: `domain-source-issue:${organizationId}:${digest}` } });
    const storedReferences = (event?.payload as { sourceReferences?: unknown } | undefined)?.sourceReferences;
    let references: DomainSourceReference[];
    if (event) {
      if (!Array.isArray(storedReferences) || storedReferences.length !== input.sources.length) reject('IDEMPOTENCY_REPLAY', 409);
      references = storedReferences as DomainSourceReference[];
      if (references.some((reference, index) => reference.sourceDomain !== 'customer-quality' || reference.sourceType !== 'customer-complaint' || reference.sourceId !== input.sources[index]?.complaintId || reference.sourceVersion !== input.sources[index]?.expectedVersion)) reject('IDEMPOTENCY_REPLAY', 409);
    } else {
      references = await Promise.all(input.sources.map(async (source) => ({
        ...await this.ledger.sourceReference(actor, source.complaintId), sourceVersion: source.expectedVersion,
      })));
    }
    const levels = [...new Set(references.map((source) => source.sourceSnapshot.severity))];
    if (levels.length !== 1 || typeof levels[0] !== 'string') reject('CUSTOMER_ISSUE_SEVERITY_CONFLICT', 409);
    return this.domainIssues.issue({
      organizationId, actor, source: references[0]!, additionalSources: references.slice(1),
      problemType: input.problemType, responseForm: input.responseForm, responsibleScope: input.responsibleScope,
      severity: levels[0], ownerId: input.ownerId, dueAt: input.dueAt,
      workflowBinding: input.workflowBinding, idempotencyKey: idempotencyKey ?? '', traceId,
    }, {
      authorize: async (tx, command, replay) => {
        await assertAdminAccess(tx, actor, command.organizationId, 'customer-quality:complaints:write');
        if (replay) return;
        const workflowCode = input.responseForm === 'EIGHT_D' ? 'CUSTOMER_8D' : 'CUSTOMER_BRIEF';
        const definition = await tx.workflowDefinition.findUnique({ where: { organizationId_code: { organizationId, code: workflowCode } } });
        const workflowConfigurationError = input.responseForm === 'EIGHT_D' ? 'CUSTOMER_8D_WORKFLOW_CONFIGURATION_REQUIRED' : 'CUSTOMER_BRIEF_WORKFLOW_CONFIGURATION_REQUIRED';
        if (!definition || definition.id !== command.workflowBinding.workflowDefinitionId) reject(workflowConfigurationError, 409);
        const version = await tx.workflowVersion.findFirst({ where: { organizationId, workflowDefinitionId: definition.id, status: 'PUBLISHED' }, orderBy: { version: 'desc' }, include: { nodes: true } });
        const closes = version?.nodes.filter((node) => node.type === 'CLOSE') ?? [];
        if (!version || version.id !== command.workflowBinding.workflowVersionId || !version.nodes.some((node) => node.type === 'VERIFICATION') || closes.length !== 1 || jsonObject(closes[0]!.config).requireIndependentVerification !== true) reject(workflowConfigurationError, 409);
        if (input.ownerId) {
          const owner = await tx.user.findFirst({ where: { id: input.ownerId, organizationId, accountType: 'INTERNAL', status: 'ACTIVE' } });
          if (!owner) reject('CUSTOMER_ISSUE_OWNER_INVALID', 400);
        }
      },
      lockAndResolve: (tx, source) => this.ledger.lockAndResolve(tx, source),
      bindWorkflow: (tx, binding) => this.runtime.startInstance({
        organizationId: binding.organizationId, actor: binding.actor, problemIndexId: binding.problemIndexId,
        workflowDefinitionId: binding.workflowBinding.workflowDefinitionId,
        workflowVersionId: binding.workflowBinding.workflowVersionId,
        expectedProblemVersion: binding.expectedProblemVersion, instanceKey: binding.workflowBinding.instanceKey,
        idempotencyKey: binding.idempotencyKey, traceId: binding.traceId,
      }, tx),
    });
  }

  async changeSources(actor: AdminActor, problemIndexId: string, input: ChangeCustomerIssueSourcesInput, traceId: string, idempotencyKey?: string) {
    if (actor.accountType !== 'INTERNAL') reject('ORGANIZATION_SCOPE_DENIED', 403);
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    if (organizationId !== actor.organizationId) reject('ORGANIZATION_SCOPE_DENIED', 403);
    if (!Array.isArray(input.add) || !Array.isArray(input.remove) || input.add.length + input.remove.length > 100) reject('CUSTOMER_ISSUE_SOURCES_INVALID', 400);
    const identity = (sourceId: string) => ({ sourceDomain: 'customer-quality', sourceType: 'customer-complaint', sourceId });
    const add = await Promise.all(input.add.map(async (source) => ({
      ...await this.ledger.sourceReference(actor, source.complaintId), sourceVersion: source.expectedVersion,
    })));
    return this.sourceLinks.change({
      organizationId, problemIndexId, actor, expectedProblemVersion: input.expectedProblemVersion,
      add, remove: input.remove.map(identity), primary: input.primaryComplaintId ? identity(input.primaryComplaintId) : undefined,
      traceId, idempotencyKey: idempotencyKey ?? '',
    }, {
      authorize: async (tx, command) => {
        await assertAdminAccess(tx, actor, command.organizationId, 'customer-quality:complaints:write');
        await tx.$queryRaw`SELECT id FROM problem_indexes WHERE id = ${problemIndexId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
        const problem = await tx.problemIndex.findFirst({ where: { id: problemIndexId, organizationId, domainCode: 'customer-quality' } });
        if (!problem) reject('CUSTOMER_ISSUE_NOT_FOUND', 404);
      },
      lockAndResolve: (tx, reference) => this.ledger.lockAndResolve(tx, reference),
    });
  }

  async problemsForComplaint(actor: AdminActor, complaintId: string) {
    if (actor.accountType !== 'INTERNAL') reject('ORGANIZATION_SCOPE_DENIED', 403);
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    await this.ledger.detailComplaint(actor, complaintId);
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await assertAdminAccess(tx, actor, organizationId, 'customer-quality:complaints:read');
      const links = await tx.domainSourceIssueLink.findMany({ where: {
        organizationId, sourceDomain: 'customer-quality', sourceType: 'customer-complaint', sourceId: complaintId, removedAt: null,
      }, orderBy: { linkedAt: 'desc' } });
      const ids = [...new Set(links.map((link) => link.problemIndexId))];
      return tx.problemIndex.findMany({ where: { organizationId, id: { in: ids } }, orderBy: { createdAt: 'desc' } });
    });
  }

  async historyForComplaint(actor: AdminActor, complaintId: string) {
    if (actor.accountType !== 'INTERNAL') reject('ORGANIZATION_SCOPE_DENIED', 403);
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    await this.ledger.detailComplaint(actor, complaintId);
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await assertAdminAccess(tx, actor, organizationId, 'customer-quality:complaints:read');
      return tx.domainSourceIssueLinkHistory.findMany({ where: {
        organizationId, sourceDomain: 'customer-quality', sourceType: 'customer-complaint', sourceId: complaintId,
      }, orderBy: [{ changedAt: 'asc' }, { id: 'asc' }] });
    });
  }
}
