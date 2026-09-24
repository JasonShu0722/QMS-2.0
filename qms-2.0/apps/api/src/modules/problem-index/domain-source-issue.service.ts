import { HttpException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { OutboxService } from '../task-notification/outbox.service.js';
import { ProblemIndexService, type CreateProblemIndexInput } from './problem-index.service.js';

export const DOMAIN_SOURCE_RESPONSE_FORMS = ['BRIEF', 'EIGHT_D'] as const;
export type DomainSourceResponseForm = (typeof DOMAIN_SOURCE_RESPONSE_FORMS)[number];

export interface DomainSourceReference {
  sourceDomain: string;
  sourceType: string;
  sourceId: string;
  sourceVersion: number;
  sourceSnapshot: Prisma.InputJsonObject;
  createdBy: string;
}

export interface DomainSourceIssueCommand {
  organizationId: string;
  actor: { id: string; organizationId: string; accountType: 'INTERNAL' | 'SUPPLIER'; sessionId: string };
  source: DomainSourceReference;
  additionalSources?: DomainSourceReference[];
  problemType: string;
  responseForm: DomainSourceResponseForm;
  responsibleScope: string;
  severity: string;
  ownerId?: string;
  dueAt?: Date;
  idempotencyKey: string;
  traceId?: string;
  workflowBinding: {
    workflowDefinitionId: string;
    workflowVersionId: string;
    instanceKey: string;
  };
}

export interface DomainSourceRecord {
  organizationId: string;
  createdBy: string;
  sourceVersion: number;
  sourceSnapshot: Prisma.InputJsonObject;
  archivedAt?: Date | null;
}

export interface DomainSourceIssueWorkflowBinding {
  problemIndexId: string;
  organizationId: string;
  actor: DomainSourceIssueCommand['actor'];
  expectedProblemVersion: number;
  idempotencyKey: string;
  traceId: string;
  responseForm: DomainSourceResponseForm;
  responsibleScope: string;
  workflowBinding: DomainSourceIssueCommand['workflowBinding'];
}

export interface DomainSourceIssueAdapters {
  authorize(transaction: Prisma.TransactionClient, command: DomainSourceIssueCommand, replay: boolean): Promise<void>;
  lockAndResolve(transaction: Prisma.TransactionClient, source: DomainSourceReference): Promise<DomainSourceRecord | null>;
  bindWorkflow(transaction: Prisma.TransactionClient, binding: DomainSourceIssueWorkflowBinding): Promise<{ instanceId: string }>;
}

export interface DomainSourceIssueResult {
  problem: Record<string, unknown>;
  source: DomainSourceRecord;
  sources: DomainSourceRecord[];
  replayed: boolean;
}

function stable(value: unknown): unknown {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) issueError('SOURCE_ISSUE_DATE_INVALID', 400);
    return value.toISOString();
  }
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stable(entry)]));
  }
  return value;
}

function digestCommand(command: DomainSourceIssueCommand): string {
  const { idempotencyKey: _key, traceId: _trace, ...payload } = command;
  const { sessionId: _session, ...actor } = payload.actor;
  const reference = ({ sourceDomain, sourceType, sourceId, sourceVersion, sourceSnapshot, createdBy }: DomainSourceReference) => ({ sourceDomain, sourceType, sourceId, sourceVersion, sourceSnapshot, createdBy });
  return createHash('sha256').update(JSON.stringify(stable({ ...payload, actor, source: reference(payload.source), additionalSources: payload.additionalSources?.map(reference) }))).digest('hex');
}

function eventKey(command: DomainSourceIssueCommand): string {
  const keyDigest = createHash('sha256').update(command.idempotencyKey).digest('hex');
  return `domain-source-issue:${command.organizationId}:${keyDigest}`;
}

function sourceKey(source: DomainSourceReference): string {
  return `${source.sourceDomain}\u0000${source.sourceType}\u0000${source.sourceId}`;
}

function assertCommand(command: DomainSourceIssueCommand): void {
  const requiredStrings: [string, unknown][] = [
    ['organizationId', command.organizationId], ['problemType', command.problemType], ['responsibleScope', command.responsibleScope],
    ['severity', command.severity], ['idempotencyKey', command.idempotencyKey], ['sourceDomain', command.source.sourceDomain],
    ['sourceType', command.source.sourceType], ['sourceId', command.source.sourceId], ['createdBy', command.source.createdBy],
    ['actorId', command.actor?.id], ['actorOrganizationId', command.actor?.organizationId], ['sessionId', command.actor?.sessionId],
  ];
  for (const [name, value] of requiredStrings) if (typeof value !== 'string' || !value.trim()) throw new Error(`SOURCE_ISSUE_${name.toUpperCase()}_REQUIRED`);
  if (!DOMAIN_SOURCE_RESPONSE_FORMS.includes(command.responseForm)) throw new Error('SOURCE_ISSUE_RESPONSE_FORM_INVALID');
  if (!Number.isSafeInteger(command.source.sourceVersion) || command.source.sourceVersion < 1) throw new Error('SOURCE_VERSION_INVALID');
  if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(command.idempotencyKey)) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
  if (command.dueAt !== undefined && (!(command.dueAt instanceof Date) || Number.isNaN(command.dueAt.getTime()))) issueError('SOURCE_ISSUE_DUE_AT_INVALID', 400);
  if (!command.workflowBinding || Object.values(command.workflowBinding).some((value) => typeof value !== 'string' || !value.trim())) throw new Error('SOURCE_ISSUE_WORKFLOW_BINDING_INVALID');
  if (command.actor.organizationId !== command.organizationId || command.actor.accountType !== 'INTERNAL') throw new Error('SOURCE_ISSUE_ACTOR_SCOPE_FORBIDDEN');
  const identities = new Set<string>();
  for (const source of [command.source, ...(command.additionalSources ?? [])]) {
    for (const value of [source.sourceDomain, source.sourceType, source.sourceId, source.createdBy]) if (typeof value !== 'string' || !value.trim()) throw new Error('SOURCE_REFERENCE_INVALID');
    if (!Number.isSafeInteger(source.sourceVersion) || source.sourceVersion < 1 || !source.sourceSnapshot || typeof source.sourceSnapshot !== 'object') throw new Error('SOURCE_REFERENCE_INVALID');
    const identity = `${source.sourceDomain}:${source.sourceType}:${source.sourceId}`;
    if (identities.has(identity)) throw new Error('SOURCE_REFERENCE_DUPLICATE');
    identities.add(identity);
  }
}

function issueError(code: string, status: number): never {
  throw new HttpException({ code, message: code }, status);
}

@Injectable()
export class DomainSourceIssueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly problems: ProblemIndexService,
    private readonly outbox: OutboxService,
  ) {}

  async issue(command: DomainSourceIssueCommand, adapters: DomainSourceIssueAdapters): Promise<DomainSourceIssueResult> {
    assertCommand(command);
    const work = async (tx: Prisma.TransactionClient): Promise<DomainSourceIssueResult> => {
      const [isolation] = await tx.$queryRaw<{ transaction_isolation: string }[]>`SHOW transaction_isolation`;
      if (isolation?.transaction_isolation !== 'read committed') throw new Error('SOURCE_ISSUE_TRANSACTION_ISOLATION_UNSUPPORTED');
      const key = eventKey(command);
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      await assertActiveAuthentication(tx, command.actor);
      const existing = await tx.outboxEvent.findUnique({ where: { eventKey: key } });
      await adapters.authorize(tx, command, Boolean(existing));
      const digest = digestCommand(command);
      if (existing) {
        const payload = existing.payload as Record<string, unknown>;
        if (payload.requestDigest !== digest) issueError('IDEMPOTENCY_REPLAY', 409);
        if (!payload.problem || typeof payload.problem !== 'object' || !payload.source || typeof payload.source !== 'object') throw new Error('SOURCE_ISSUE_REPLAY_INVALID');
        return { problem: payload.problem as Record<string, unknown>, source: payload.source as DomainSourceRecord, sources: payload.sources as DomainSourceRecord[], replayed: true };
      }

      const references = [command.source, ...(command.additionalSources ?? [])];
      const lockedSources = new Map<string, DomainSourceRecord>();
      const lockOrder = [...references].sort((left, right) => sourceKey(left) < sourceKey(right) ? -1 : sourceKey(left) > sourceKey(right) ? 1 : 0);
      for (const reference of lockOrder) {
        const source = await adapters.lockAndResolve(tx, reference);
        if (!source) issueError('SOURCE_NOT_FOUND', 404);
        if (source.organizationId !== command.organizationId) issueError('SOURCE_ORGANIZATION_FORBIDDEN', 403);
        if (source.archivedAt) issueError('SOURCE_ARCHIVED', 409);
        if (source.sourceVersion !== reference.sourceVersion) issueError('SOURCE_VERSION_CONFLICT', 409);
        if (source.createdBy !== reference.createdBy || JSON.stringify(stable(source.sourceSnapshot)) !== JSON.stringify(stable(reference.sourceSnapshot))) issueError('SOURCE_SNAPSHOT_CONFLICT', 409);
        lockedSources.set(sourceKey(reference), source);
      }
      const sources = references.map((reference) => lockedSources.get(sourceKey(reference))!);

      const input: CreateProblemIndexInput = {
        organizationId: command.organizationId,
        domainCode: command.source.sourceDomain,
        problemType: command.problemType,
        sourceType: command.source.sourceType,
        sourceId: command.source.sourceId,
        severity: command.severity,
        responsibleParty: command.responsibleScope,
        ownerId: command.ownerId,
        dueAt: command.dueAt,
        createdById: command.actor.id,
        traceId: command.traceId,
      };
      const problem = await this.problems.createForDomainSourceIssue(tx as never, input);
      for (const reference of references) {
        await tx.domainSourceIssueLink.create({ data: {
          organizationId: command.organizationId, problemIndexId: String(problem.id), sourceDomain: reference.sourceDomain,
          sourceType: reference.sourceType, sourceId: reference.sourceId, sourceVersion: reference.sourceVersion,
          sourceSnapshot: reference.sourceSnapshot, createdBy: reference.createdBy,
        } });
        await tx.domainSourceIssueLinkHistory.create({ data: {
          organizationId: command.organizationId, problemIndexId: String(problem.id), sourceDomain: reference.sourceDomain,
          sourceType: reference.sourceType, sourceId: reference.sourceId, sourceVersion: reference.sourceVersion,
          sourceSnapshot: reference.sourceSnapshot, action: 'LINKED', actorUserId: command.actor.id,
        } });
      }
      await tx.domainSourceIssueLinkHistory.create({ data: {
        organizationId: command.organizationId, problemIndexId: String(problem.id), sourceDomain: command.source.sourceDomain,
        sourceType: command.source.sourceType, sourceId: command.source.sourceId, sourceVersion: command.source.sourceVersion,
        sourceSnapshot: command.source.sourceSnapshot, action: 'PRIMARY_SELECTED', actorUserId: command.actor.id,
      } });
      const workflow = await adapters.bindWorkflow(tx, {
        problemIndexId: String(problem.id), organizationId: command.organizationId, actor: command.actor,
        expectedProblemVersion: Number(problem.version), idempotencyKey: command.idempotencyKey, traceId: command.traceId ?? randomUUID(),
        responseForm: command.responseForm, responsibleScope: command.responsibleScope, workflowBinding: command.workflowBinding,
      });
      const persisted = await tx.problemIndex.findUnique({ where: { id: String(problem.id) } });
      const instance = workflow?.instanceId ? await tx.workflowInstance.findFirst({ where: {
        id: workflow.instanceId, organizationId: command.organizationId, problemIndexId: String(problem.id),
        workflowDefinitionId: command.workflowBinding.workflowDefinitionId, workflowVersionId: command.workflowBinding.workflowVersionId,
      }, select: { id: true } }) : null;
      if (!instance || persisted?.workflowInstanceId !== instance.id) throw new Error('SOURCE_ISSUE_WORKFLOW_NOT_BOUND');
      const responseProblem = JSON.parse(JSON.stringify(persisted)) as Record<string, unknown>;
      await this.outbox.enqueue({
        eventKey: key,
        aggregateType: 'DomainSourceIssue',
        aggregateId: String(problem.id),
        eventType: 'DOMAIN_SOURCE_ISSUED',
        payload: {
          requestDigest: digest,
          organizationId: command.organizationId,
          problem: responseProblem as Prisma.InputJsonObject,
          sourceReference: command.source as unknown as Prisma.InputJsonObject,
          source: sources[0] as unknown as Prisma.InputJsonObject,
          sourceReferences: references as unknown as Prisma.InputJsonArray,
          sources: sources as unknown as Prisma.InputJsonArray,
          workflowInstanceId: instance.id,
          responseForm: command.responseForm,
          responsibleScope: command.responsibleScope,
          workflowBinding: command.workflowBinding ?? null,
        },
      }, tx);
      return { problem: responseProblem, source: sources[0]!, sources, replayed: false };
    };
    return this.prisma.$transaction(work, { isolationLevel: 'ReadCommitted' });
  }
}
