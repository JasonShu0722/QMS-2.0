import { createHash } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { OutboxService } from '../task-notification/outbox.service.js';
import type { DomainSourceIssueAdapters, DomainSourceReference } from './domain-source-issue.service.js';

type SourceIdentity = Pick<DomainSourceReference, 'sourceDomain' | 'sourceType' | 'sourceId'>;
type Actor = { id: string; organizationId: string; accountType: 'INTERNAL' | 'SUPPLIER'; sessionId: string };

export interface ChangeDomainSourcesCommand {
  organizationId: string;
  problemIndexId: string;
  actor: Actor;
  expectedProblemVersion: number;
  add: DomainSourceReference[];
  remove: SourceIdentity[];
  primary?: SourceIdentity;
  idempotencyKey: string;
  traceId: string;
}

export interface DomainSourceLinkAdapters {
  authorize(transaction: Prisma.TransactionClient, command: ChangeDomainSourcesCommand): Promise<void>;
  lockAndResolve: DomainSourceIssueAdapters['lockAndResolve'];
}

function fail(code: string, status: number): never { throw new HttpException({ code, message: code }, status); }
function key(source: SourceIdentity): string { return `${source.sourceDomain}\u0000${source.sourceType}\u0000${source.sourceId}`; }
function validIdentity(source: SourceIdentity): boolean { return [source.sourceDomain, source.sourceType, source.sourceId].every((value) => typeof value === 'string' && value.trim()); }
function stable(value: unknown): unknown { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([name, entry]) => [name, stable(entry)])); return value; }

@Injectable()
export class DomainSourceLinkService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService, private readonly outbox: OutboxService) {}

  async change(command: ChangeDomainSourcesCommand, adapters: DomainSourceLinkAdapters, outerTransaction?: Prisma.TransactionClient) {
    if (!command.organizationId || !command.problemIndexId || command.actor.organizationId !== command.organizationId || command.actor.accountType !== 'INTERNAL') fail('SOURCE_LINK_SCOPE_FORBIDDEN', 403);
    if (!Number.isSafeInteger(command.expectedProblemVersion) || command.expectedProblemVersion < 1 || !/^[a-zA-Z0-9._:-]{8,128}$/.test(command.idempotencyKey)) fail('SOURCE_LINK_INPUT_INVALID', 400);
    if (command.add.length + command.remove.length === 0 && !command.primary) fail('SOURCE_LINK_INPUT_INVALID', 400);
    const identities = [...command.add, ...command.remove];
    if (identities.some((source) => !validIdentity(source)) || new Set(identities.map(key)).size !== identities.length || (command.primary && !validIdentity(command.primary))) fail('SOURCE_LINK_INPUT_INVALID', 400);
    const digest = createHash('sha256').update(JSON.stringify(stable({ problemIndexId: command.problemIndexId, expectedProblemVersion: command.expectedProblemVersion, add: [...command.add].sort((left, right) => key(left).localeCompare(key(right))).map(({ sourceDomain, sourceType, sourceId, sourceVersion }) => ({ sourceDomain, sourceType, sourceId, sourceVersion })), remove: [...command.remove].sort((left, right) => key(left).localeCompare(key(right))), primary: command.primary ?? null }))).digest('hex');
    const eventKey = `source-link:${command.organizationId}:${createHash('sha256').update(`${command.actor.id}:${command.idempotencyKey}`).digest('hex')}`;
    const work = async (transaction: Prisma.TransactionClient) => {
      const [isolation] = await transaction.$queryRaw<{ transaction_isolation: string }[]>`SHOW transaction_isolation`;
      if (isolation?.transaction_isolation !== 'read committed') fail('WORKFLOW_TRANSACTION_ISOLATION_UNSUPPORTED', 409);
      await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${eventKey}, 0))`;
      await assertActiveAuthentication(transaction, command.actor, outerTransaction ? 'SHARE' : 'NO KEY UPDATE');
      await adapters.authorize(transaction, command);
      const existing = await transaction.outboxEvent.findUnique({ where: { eventKey } });
      if (existing) {
        const payload = existing.payload as Record<string, unknown>;
        if (payload.digest !== digest) fail('IDEMPOTENCY_REPLAY', 409);
        return payload.problem as Record<string, unknown>;
      }
      await transaction.$queryRaw`SELECT id FROM problem_indexes WHERE organization_id = ${command.organizationId}::uuid AND id = ${command.problemIndexId}::uuid FOR UPDATE`;
      const problem = await transaction.problemIndex.findFirst({ where: { organizationId: command.organizationId, id: command.problemIndexId, archivedAt: null } });
      if (!problem) fail('PROBLEM_NOT_FOUND', 404);
      if (problem.version !== command.expectedProblemVersion) fail('CONCURRENCY_CONFLICT', 409);
      const links = await transaction.domainSourceIssueLink.findMany({ where: { organizationId: command.organizationId, problemIndexId: command.problemIndexId, removedAt: null } });
      const active = new Set(links.map(key));
      for (const reference of [...command.add].sort((left, right) => key(left).localeCompare(key(right)))) {
        if (active.has(key(reference))) fail('SOURCE_ALREADY_LINKED', 409);
        const source = await adapters.lockAndResolve(transaction, reference);
        if (!source) fail('SOURCE_NOT_FOUND', 404);
        if (source.organizationId !== command.organizationId) fail('SOURCE_ORGANIZATION_FORBIDDEN', 403);
        if (source.archivedAt || source.sourceVersion !== reference.sourceVersion || source.createdBy !== reference.createdBy || JSON.stringify(stable(source.sourceSnapshot)) !== JSON.stringify(stable(reference.sourceSnapshot))) fail('SOURCE_SNAPSHOT_CONFLICT', 409);
        active.add(key(reference));
      }
      for (const reference of command.remove) {
        if (!active.has(key(reference))) fail('SOURCE_LINK_NOT_FOUND', 404);
        active.delete(key(reference));
      }
      if (active.size === 0) fail('SOURCE_LAST_LINK_REQUIRED', 409);
      const currentPrimary = { sourceDomain: problem.domainCode, sourceType: problem.sourceType, sourceId: problem.sourceId ?? '' };
      const primary = command.primary ?? (active.has(key(currentPrimary)) ? currentPrimary : null);
      if (!primary || !active.has(key(primary))) fail('SOURCE_PRIMARY_REQUIRED', 409);
      for (const reference of command.add) {
        const old = await transaction.domainSourceIssueLink.findFirst({ where: { organizationId: command.organizationId, problemIndexId: command.problemIndexId, sourceDomain: reference.sourceDomain, sourceType: reference.sourceType, sourceId: reference.sourceId } });
        if (old) await transaction.domainSourceIssueLink.update({ where: { id: old.id }, data: { sourceVersion: reference.sourceVersion, sourceSnapshot: reference.sourceSnapshot, createdBy: reference.createdBy, removedAt: null, removedBy: null, linkedAt: new Date() } });
        else await transaction.domainSourceIssueLink.create({ data: { organizationId: command.organizationId, problemIndexId: command.problemIndexId, ...reference } });
        await transaction.domainSourceIssueLinkHistory.create({ data: { organizationId: command.organizationId, problemIndexId: command.problemIndexId, sourceDomain: reference.sourceDomain, sourceType: reference.sourceType, sourceId: reference.sourceId, sourceVersion: reference.sourceVersion, sourceSnapshot: reference.sourceSnapshot, action: 'LINKED', actorUserId: command.actor.id } });
      }
      for (const reference of command.remove) {
        const removed = await transaction.domainSourceIssueLink.update({ where: { organizationId_problemIndexId_sourceDomain_sourceType_sourceId: { organizationId: command.organizationId, problemIndexId: command.problemIndexId, ...reference } }, data: { removedAt: new Date(), removedBy: command.actor.id } });
        await transaction.domainSourceIssueLinkHistory.create({ data: { organizationId: command.organizationId, problemIndexId: command.problemIndexId, sourceDomain: reference.sourceDomain, sourceType: reference.sourceType, sourceId: reference.sourceId, sourceVersion: removed.sourceVersion, sourceSnapshot: removed.sourceSnapshot as Prisma.InputJsonObject, action: 'UNLINKED', actorUserId: command.actor.id } });
      }
      if (key(primary) !== key(currentPrimary)) {
        const selected = await transaction.domainSourceIssueLink.findFirstOrThrow({ where: { organizationId: command.organizationId, problemIndexId: command.problemIndexId, sourceDomain: primary.sourceDomain, sourceType: primary.sourceType, sourceId: primary.sourceId, removedAt: null } });
        await transaction.domainSourceIssueLinkHistory.create({ data: { organizationId: command.organizationId, problemIndexId: command.problemIndexId, sourceDomain: primary.sourceDomain, sourceType: primary.sourceType, sourceId: primary.sourceId, sourceVersion: selected.sourceVersion, sourceSnapshot: selected.sourceSnapshot as Prisma.InputJsonObject, action: 'PRIMARY_SELECTED', actorUserId: command.actor.id } });
      }
      const changed = await transaction.problemIndex.updateMany({ where: { id: command.problemIndexId, organizationId: command.organizationId, version: command.expectedProblemVersion, archivedAt: null }, data: { domainCode: primary.sourceDomain, sourceType: primary.sourceType, sourceId: primary.sourceId, version: { increment: 1 }, updatedById: command.actor.id } });
      if (changed.count !== 1) fail('CONCURRENCY_CONFLICT', 409);
      const updated = await transaction.problemIndex.findUniqueOrThrow({ where: { id: command.problemIndexId } });
      const response = JSON.parse(JSON.stringify(updated)) as Record<string, unknown>;
      await this.audit.record({ organizationId: command.organizationId, actorUserId: command.actor.id, action: 'DOMAIN_SOURCES_CHANGED', resourceType: 'ProblemIndex', resourceId: command.problemIndexId, outcome: 'SUCCESS', traceId: command.traceId, metadata: { resourceVersion: updated.version } }, transaction);
      await this.outbox.enqueue({ eventKey, aggregateType: 'DomainSourceIssue', aggregateId: command.problemIndexId, eventType: 'DOMAIN_SOURCES_CHANGED', payload: { digest, problem: response as Prisma.InputJsonObject, organizationId: command.organizationId } }, transaction);
      return response;
    };
    return outerTransaction ? work(outerTransaction) : this.prisma.$transaction(work, { isolationLevel: 'ReadCommitted' });
  }
}
