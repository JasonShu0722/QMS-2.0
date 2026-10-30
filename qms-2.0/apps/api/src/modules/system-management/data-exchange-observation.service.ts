import { BadRequestException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { adminError } from '../../common/security/admin-mutation.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma, DataExchangeAttempt } from '../../generated/prisma/client.js';
import type { AuthorizedSessionUser } from '../authorization/authorization.service.js';
import { ConsoleContextService } from '../identity/console-context.service.js';
import { DataExchangeRegistryService, type DataExchangeIdentity, type DataExchangeSourceHandle, type TrustedExchangeScope } from './data-exchange-registry.service.js';
import { DataExchangeAttemptDto, DataExchangePageDto, DataExchangeQueryDto, DataExchangeStageDto, DataExchangeStagesDto, EXCHANGE_ERRORS, EXCHANGE_OUTCOMES, EXCHANGE_STAGES, type ExchangeOutcome, type ExchangeStage } from './data-exchange-observation.dto.js';

export const DATA_EXCHANGE_RETENTION_MS = 30 * 86400000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const opaque = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(value);
const terminal = (value: ExchangeOutcome) => value === 'SUCCEEDED' || value === 'FAILED';
const emptyStages = (): DataExchangeStagesDto => ({ transfer: { outcome: 'NOT_REPORTED' }, validation: { outcome: 'NOT_REPORTED' }, processing: { outcome: 'NOT_REPORTED' }, reconciliation: { outcome: 'NOT_REPORTED' } });
export type DataExchangeStageEvent = DataExchangeIdentity & { eventKey: string; idempotencyKey: string; stage: ExchangeStage; outcome: Exclude<ExchangeOutcome, 'NOT_REPORTED'>; observedCount?: number; errorCode?: (typeof EXCHANGE_ERRORS)[number] };

export function normalizeDataExchangeEvent(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Invalid exchange metadata.');
  const input = value as Record<string, unknown>;
  const allowed = ['eventKey', 'idempotencyKey', 'direction', 'objectType', 'level', 'correlationId', 'batchId', 'recordId', 'attemptNumber', 'stage', 'outcome', 'observedCount', 'errorCode'];
  if (Object.keys(input).some(key => !allowed.includes(key)) || !opaque(input.eventKey) || !opaque(input.idempotencyKey)
    || !['INBOUND', 'OUTBOUND'].includes(input.direction as string) || !/^[A-Z][A-Z0-9_]{0,47}$/.test(String(input.objectType))
    || !['BATCH', 'RECORD'].includes(input.level as string) || !opaque(input.correlationId)
    || input.batchId !== undefined && !opaque(input.batchId) || input.recordId !== undefined && !opaque(input.recordId)
    || input.level === 'BATCH' && input.recordId !== undefined || input.level === 'RECORD' && (!input.batchId || !input.recordId)
    || !Number.isInteger(input.attemptNumber) || Number(input.attemptNumber) < 1 || Number(input.attemptNumber) > 1000000
    || !(EXCHANGE_STAGES as readonly unknown[]).includes(input.stage) || !(EXCHANGE_OUTCOMES as readonly unknown[]).includes(input.outcome) || input.outcome === 'NOT_REPORTED'
    || input.observedCount !== undefined && (!Number.isInteger(input.observedCount) || Number(input.observedCount) < 0 || Number(input.observedCount) > 1000000000)
    || input.errorCode !== undefined && (!(EXCHANGE_ERRORS as readonly unknown[]).includes(input.errorCode) || input.outcome !== 'FAILED')) throw new BadRequestException('Invalid exchange metadata.');
  const event = input as unknown as DataExchangeStageEvent;
  const identity: DataExchangeIdentity = { direction: event.direction, objectType: event.objectType, level: event.level, correlationId: event.correlationId, ...(event.batchId ? { batchId: event.batchId } : {}), ...(event.recordId ? { recordId: event.recordId } : {}), attemptNumber: event.attemptNumber };
  const idempotencyKeyHash = hash(event.idempotencyKey);
  const state = { outcome: event.outcome, ...(event.observedCount !== undefined ? { observedCount: event.observedCount } : {}), ...(event.errorCode ? { errorCode: event.errorCode } : {}) };
  const canonical = { identity, idempotencyKeyHash, stage: event.stage, state };
  return { identity, idempotencyKeyHash, stage: event.stage, state, eventKeyHash: hash(event.eventKey), inputHash: hash(JSON.stringify(canonical)), attemptKey: hash(JSON.stringify(identity)) };
}

@Injectable()
export class DataExchangeObservationService {
  private readonly unavailableScopes = new Set<string>();
  constructor(private readonly prisma: PrismaService, private readonly registry: DataExchangeRegistryService, private readonly contexts: ConsoleContextService) {}

  async recordStageResult(handle: DataExchangeSourceHandle, scope: TrustedExchangeScope, input: DataExchangeStageEvent) {
    const event = normalizeDataExchangeEvent(input);
    const { sourceKey, scopeKey } = await this.registry.verify(handle, scope, event.identity);
    try {
      const result = await this.prisma.$transaction(async tx => {
        // Both locks are server-derived and ordered: receipt identity, then attempt identity.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([sourceKey, scopeKey, event.eventKeyHash])}, 0))`;
        await this.registry.verify(handle, scope, event.identity, tx);
        const receipt = await tx.dataExchangeReceipt.findUnique({ where: { sourceKey_scopeKey_eventKeyHash: { sourceKey, scopeKey, eventKeyHash: event.eventKeyHash } } });
        if (receipt) {
          if (receipt.inputHash !== event.inputHash) adminError('IDEMPOTENCY_REPLAY', 409);
          return { status: 'RECORDED' as const, attemptId: receipt.attemptId, recordedAt: receipt.recordedAt.toISOString() };
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([sourceKey, scopeKey, event.attemptKey])}, 0))`;
        await this.registry.verify(handle, scope, event.identity, tx);
        if (event.identity.level === 'RECORD') {
          const parent = await tx.dataExchangeAttempt.findFirst({ where: { sourceKey, scopeKey, direction: event.identity.direction, objectType: event.identity.objectType, level: 'BATCH', batchId: event.identity.batchId, correlationId: event.identity.correlationId, attemptNumber: event.identity.attemptNumber } });
          if (!parent) adminError('ORGANIZATION_SCOPE_DENIED', 403);
        }
        let attempt = await tx.dataExchangeAttempt.findUnique({ where: { sourceKey_scopeKey_attemptKey: { sourceKey, scopeKey, attemptKey: event.attemptKey } } });
        if (attempt && attempt.idempotencyKeyHash !== event.idempotencyKeyHash) adminError('CONCURRENCY_CONFLICT', 409);
        const stages = attempt ? this.stages(attempt.stages) : emptyStages();
        const previous = stages[event.stage];
        if (terminal(previous.outcome) && JSON.stringify({ outcome: previous.outcome, ...(previous.observedCount !== undefined ? { observedCount: previous.observedCount } : {}), ...(previous.errorCode ? { errorCode: previous.errorCode } : {}) }) !== JSON.stringify(event.state)) adminError('CONCURRENCY_CONFLICT', 409);
        if (previous.outcome === 'UNKNOWN' && event.state.outcome === 'PENDING') adminError('CONCURRENCY_CONFLICT', 409);
        const now = new Date();
        if (!terminal(previous.outcome)) stages[event.stage] = { ...event.state, observedAt: now.toISOString() };
        const finishedAt = EXCHANGE_STAGES.every(stage => terminal(stages[stage].outcome)) ? now : null;
        if (!attempt) attempt = await tx.dataExchangeAttempt.create({ data: { id: randomUUID(), sourceKey, scopeKey, attemptKey: event.attemptKey, ...event.identity, idempotencyKeyHash: event.idempotencyKeyHash, stages: stages as unknown as Prisma.InputJsonValue, startedAt: now, observedAt: now, finishedAt } });
        else attempt = await tx.dataExchangeAttempt.update({ where: { id: attempt.id }, data: { stages: stages as unknown as Prisma.InputJsonValue, observedAt: now, finishedAt: attempt.finishedAt ?? finishedAt } });
        await tx.dataExchangeReceipt.create({ data: { id: randomUUID(), sourceKey, scopeKey, eventKeyHash: event.eventKeyHash, inputHash: event.inputHash, attemptId: attempt.id, recordedAt: now } });
        return { status: 'RECORDED' as const, attemptId: attempt.id, recordedAt: now.toISOString() };
      });
      this.unavailableScopes.delete(scopeKey);
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (this.unavailableScopes.size < 256) this.unavailableScopes.add(scopeKey);
      throw new ServiceUnavailableException('Exchange observation is unavailable.');
    }
  }

  async tryRecordStageResult(handle: DataExchangeSourceHandle, scope: TrustedExchangeScope, input: DataExchangeStageEvent) {
    try { return await this.recordStageResult(handle, scope, input); }
    catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
      return { status: 'UNAVAILABLE' as const };
    }
  }

  async list(actor: AuthorizedSessionUser, query: DataExchangeQueryDto): Promise<DataExchangePageDto> {
    const access = await this.access(actor, query);
    const { scope, organizationId } = access;
    const sources = await this.registry.sources(scope === 'ORGANIZATION' ? organizationId : undefined);
    if (query.sourceKey && !sources.some(source => source.key === query.sourceKey)) throw new BadRequestException('Unknown exchange source filter.');
    if (query.objectType && !sources.some(source => (!query.sourceKey || source.key === query.sourceKey) && source.objectTypes.includes(query.objectType!))) throw new BadRequestException('Unknown exchange object type filter.');
    if (!!query.stage !== !!query.outcome) throw new BadRequestException('Stage and outcome filters must be supplied together.');
    const now = new Date();
    const to = query.to ? new Date(query.to) : now;
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 86400000);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to || to.getTime() - from.getTime() > DATA_EXCHANGE_RETENTION_MS || from.getTime() < now.getTime() - DATA_EXCHANGE_RETENTION_MS || to.getTime() > now.getTime() + 60000) throw new BadRequestException('Exchange range must be within the last thirty days.');
    const page = query.page ?? 1; const limit = query.limit ?? 50;
    const where: Prisma.DataExchangeAttemptWhereInput = { observedAt: { gte: from, lt: to }, ...(scope === 'ORGANIZATION' ? { scopeKey: organizationId } : {}), sourceKey: query.sourceKey ?? { in: sources.map(source => source.key) }, ...(query.direction ? { direction: query.direction } : {}), ...(query.objectType ? { objectType: query.objectType } : {}), ...(query.level ? { level: query.level } : {}), ...(query.batchId ? { batchId: query.batchId } : {}), ...(query.stage && query.outcome ? { stages: { path: [query.stage, 'outcome'], equals: query.outcome } } : {}) };
    const result = await this.prisma.$transaction(async tx => {
      const total = await tx.dataExchangeAttempt.count({ where });
      const rows = await tx.dataExchangeAttempt.findMany({ where, orderBy: [{ observedAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit });
      const batch: Prisma.DataExchangeAttemptWhereInput = { AND: [where, { level: 'BATCH' }] };
      const summary = {
        batchAttempts: await tx.dataExchangeAttempt.count({ where: batch }),
        recordAttempts: await tx.dataExchangeAttempt.count({ where: { AND: [where, { level: 'RECORD' }] } }),
        transferSucceededBatches: await tx.dataExchangeAttempt.count({ where: { AND: [batch, { stages: { path: ['transfer', 'outcome'], equals: 'SUCCEEDED' } }] } }),
        processingFailedBatches: await tx.dataExchangeAttempt.count({ where: { AND: [batch, { stages: { path: ['processing', 'outcome'], equals: 'FAILED' } }] } }),
        reconciliationSucceededBatches: await tx.dataExchangeAttempt.count({ where: { AND: [batch, { stages: { path: ['reconciliation', 'outcome'], equals: 'SUCCEEDED' } }] } }),
      };
      return { total, rows, summary };
    });
    return { scope, organizationId, connectionStatus: sources.length ? 'REGISTERED' : 'NOT_CONNECTED', sources, items: result.rows.map(row => this.project(row)), total: result.total, page, limit, from: from.toISOString(), to: to.toISOString(), asOf: now.toISOString(), summary: result.summary, collection: { status: scope === 'ORGANIZATION' && this.unavailableScopes.has(organizationId) ? 'UNAVAILABLE' : 'UNKNOWN' } };
  }

  async detail(actor: AuthorizedSessionUser, query: DataExchangeQueryDto, id: string): Promise<DataExchangeAttemptDto> {
    const { scope, organizationId } = await this.access(actor, query);
    const sources = await this.registry.sources(scope === 'ORGANIZATION' ? organizationId : undefined);
    const row = await this.prisma.dataExchangeAttempt.findFirst({ where: { id, sourceKey: { in: sources.map(source => source.key) }, ...(scope === 'ORGANIZATION' ? { scopeKey: organizationId } : {}), observedAt: { gte: new Date(Date.now() - DATA_EXCHANGE_RETENTION_MS) } } });
    if (!row) throw new NotFoundException('Exchange observation not found.');
    return this.project(row);
  }

  async purgeExpired(now = new Date()): Promise<number> {
    if (!Number.isFinite(now.getTime())) throw new BadRequestException('Invalid retention clock.');
    const cutoff = new Date(now.getTime() - DATA_EXCHANGE_RETENTION_MS);
    return this.prisma.$executeRaw`DELETE FROM data_exchange_attempts WHERE id IN (SELECT id FROM data_exchange_attempts WHERE observed_at < ${cutoff} ORDER BY observed_at, id LIMIT 1000 FOR UPDATE SKIP LOCKED)`;
  }

  private async access(actor: AuthorizedSessionUser, query: DataExchangeQueryDto) {
    const context = await this.contexts.context(actor, query.organizationId);
    const organizationId = context.targetOrganization.id;
    if (!context.modules.some(module => module.key === 'data-exchanges' && module.organizationId === organizationId && module.permissions.includes('console:exchanges:read'))) adminError('FEATURE_PERMISSION_DENIED', 403);
    const scope = query.scope ?? 'ORGANIZATION';
    if (scope === 'PLATFORM' && !context.hasPlatformAdministrator) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    return { scope, organizationId };
  }
  private stages(value: Prisma.JsonValue): DataExchangeStagesDto {
    const result = emptyStages();
    for (const key of EXCHANGE_STAGES) {
      const stage = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, Prisma.JsonValue>)[key] : undefined;
      if (!stage || typeof stage !== 'object' || Array.isArray(stage)) throw new ServiceUnavailableException('Invalid exchange observation state.');
      const raw = stage as Record<string, Prisma.JsonValue>;
      if (!(EXCHANGE_OUTCOMES as readonly unknown[]).includes(raw.outcome)) throw new ServiceUnavailableException('Invalid exchange observation state.');
      result[key] = { outcome: raw.outcome as ExchangeOutcome, ...(typeof raw.observedCount === 'number' ? { observedCount: raw.observedCount } : {}), ...(typeof raw.errorCode === 'string' && (EXCHANGE_ERRORS as readonly string[]).includes(raw.errorCode) ? { errorCode: raw.errorCode as DataExchangeStageDto['errorCode'] } : {}), ...(typeof raw.observedAt === 'string' ? { observedAt: raw.observedAt } : {}) };
    }
    return result;
  }
  private project(row: DataExchangeAttempt): DataExchangeAttemptDto {
    return { id: row.id, organizationId: row.scopeKey, sourceKey: row.sourceKey, direction: row.direction, objectType: row.objectType, level: row.level, correlationId: row.correlationId, ...(row.batchId ? { batchId: row.batchId } : {}), ...(row.recordId ? { recordId: row.recordId } : {}), attemptNumber: row.attemptNumber, stages: this.stages(row.stages), startedAt: row.startedAt.toISOString(), observedAt: row.observedAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null };
  }
}
