import { HttpException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertAdminAccess, type AdminActor } from '../../common/security/admin-mutation.service.js';
import { DomainSourceIssueService, type DomainSourceReference, type DomainSourceResponseForm } from '../problem-index/domain-source-issue.service.js';
import { WorkflowRuntimeService } from '../workflow/workflow-runtime.service.js';
import { jsonObject } from '../workflow/workflow-runtime-policy.js';
import { ProcessDefectLedgerService } from './process-defect-ledger.service.js';

export interface IssueProcessDefectsInput {
  sources: Array<{ defectId: string; expectedVersion: number }>;
  problemType: string;
  responseForm: DomainSourceResponseForm;
  responsibleScope: string;
  severity: string;
  ownerId?: string;
  dueAt?: Date;
  workflowBinding: { workflowDefinitionId: string; workflowVersionId: string; instanceKey: string };
}

function reject(code: string, status: number): never {
  throw new HttpException({ code, message: code }, status);
}

@Injectable()
export class ProcessIssueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: ProcessDefectLedgerService,
    private readonly domainIssues: DomainSourceIssueService,
    private readonly runtime: WorkflowRuntimeService,
  ) {}

  async issue(actor: AdminActor, input: IssueProcessDefectsInput, traceId: string, idempotencyKey?: string) {
    if (actor.accountType !== 'INTERNAL') reject('ORGANIZATION_SCOPE_DENIED', 403);
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    if (organizationId !== actor.organizationId) reject('ORGANIZATION_SCOPE_DENIED', 403);
    if (input.responseForm !== 'BRIEF') reject('PROCESS_EIGHT_D_NOT_IMPLEMENTED', 409);
    if (input.problemType !== 'PROCESS_DEFECT' || input.responsibleScope !== 'process-quality') reject('PROCESS_ISSUE_SCOPE_INVALID', 400);
    if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(input.severity)) reject('PROCESS_ISSUE_SEVERITY_INVALID', 400);
    if (!Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 100) reject('PROCESS_ISSUE_SOURCES_INVALID', 400);
    if (new Set(input.sources.map((source) => source.defectId)).size !== input.sources.length) reject('PROCESS_ISSUE_SOURCES_DUPLICATE', 400);
    if (input.sources.some((source) => !Number.isSafeInteger(source.expectedVersion) || source.expectedVersion < 1)) reject('PROCESS_ISSUE_SOURCE_VERSION_INVALID', 400);
    if (!idempotencyKey || !/^[a-zA-Z0-9._:-]{8,128}$/.test(idempotencyKey)) reject('IDEMPOTENCY_KEY_REQUIRED', 400);
    const digest = createHash('sha256').update(idempotencyKey ?? '').digest('hex');
    const event = await this.prisma.outboxEvent.findUnique({ where: { eventKey: `domain-source-issue:${organizationId}:${digest}` } });
    const storedReferences = (event?.payload as { sourceReferences?: unknown } | undefined)?.sourceReferences;
    let references: DomainSourceReference[];
    if (event) {
      if (!Array.isArray(storedReferences) || storedReferences.length !== input.sources.length) reject('IDEMPOTENCY_REPLAY', 409);
      references = storedReferences as DomainSourceReference[];
      if (references.some((reference, index) => reference.sourceDomain !== 'process-quality' || reference.sourceType !== 'process-defect' || reference.sourceId !== input.sources[index]?.defectId || reference.sourceVersion !== input.sources[index]?.expectedVersion)) reject('IDEMPOTENCY_REPLAY', 409);
    } else {
      references = await Promise.all(input.sources.map(async (source) => ({
        ...await this.ledger.sourceReference(actor, source.defectId), sourceVersion: source.expectedVersion,
      })));
    }
    const result = await this.domainIssues.issue({
      organizationId, actor, source: references[0]!, additionalSources: references.slice(1),
      problemType: input.problemType, responseForm: input.responseForm, responsibleScope: input.responsibleScope,
      severity: input.severity, ownerId: input.ownerId, dueAt: input.dueAt,
      workflowBinding: input.workflowBinding, idempotencyKey: idempotencyKey ?? '', traceId,
    }, {
      authorize: async (tx, command, replay) => {
        await assertAdminAccess(tx, actor, command.organizationId, ['process-quality:defects:read', 'process-quality:defects:write']);
        if (replay) return;
        const definition = await tx.workflowDefinition.findUnique({ where: { organizationId_code: { organizationId, code: 'PROCESS_BRIEF' } } });
        if (!definition || definition.id !== command.workflowBinding.workflowDefinitionId) reject('PROCESS_BRIEF_WORKFLOW_CONFIGURATION_REQUIRED', 409);
        const version = await tx.workflowVersion.findFirst({ where: { organizationId, workflowDefinitionId: definition.id, status: 'PUBLISHED' }, orderBy: { version: 'desc' }, include: { nodes: true } });
        const closes = version?.nodes.filter((node) => node.type === 'CLOSE') ?? [];
        if (!version || version.id !== command.workflowBinding.workflowVersionId || !version.nodes.some((node) => node.type === 'VERIFICATION') || closes.length !== 1 || jsonObject(closes[0]!.config).requireIndependentVerification !== true) reject('PROCESS_BRIEF_WORKFLOW_CONFIGURATION_REQUIRED', 409);
        if (input.ownerId) {
          const owner = await tx.user.findFirst({ where: { id: input.ownerId, organizationId, accountType: 'INTERNAL', status: 'ACTIVE' } });
          if (!owner) reject('PROCESS_ISSUE_OWNER_INVALID', 400);
        }
      },
      lockAndResolve: (tx, source) => this.ledger.lockAndResolve(tx, source),
      bindWorkflow: (tx, binding) => this.runtime.startInstance({
        organizationId: binding.organizationId, actor: binding.actor, problemIndexId: binding.problemIndexId,
        workflowDefinitionId: binding.workflowBinding.workflowDefinitionId,
        workflowVersionId: binding.workflowBinding.workflowVersionId,
        expectedProblemVersion: binding.expectedProblemVersion,
        instanceKey: binding.workflowBinding.instanceKey,
        idempotencyKey: binding.idempotencyKey, traceId: binding.traceId,
      }, tx),
    });
    return { problem: result.problem, replayed: result.replayed };
  }

  async problemsForDefect(actor: AdminActor, defectId: string) {
    if (actor.accountType !== 'INTERNAL') reject('ORGANIZATION_SCOPE_DENIED', 403);
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    await this.ledger.sourceReference(actor, defectId);
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await assertAdminAccess(tx, actor, organizationId, 'process-quality:defects:read');
      const links = await tx.domainSourceIssueLink.findMany({ where: {
        organizationId, sourceDomain: 'process-quality', sourceType: 'process-defect', sourceId: defectId, removedAt: null,
      }, orderBy: { linkedAt: 'desc' } });
      const ids = [...new Set(links.map((link) => link.problemIndexId))];
      return tx.problemIndex.findMany({ where: { organizationId, id: { in: ids } }, orderBy: { createdAt: 'desc' } });
    });
  }
}
