import { HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { decryptSecret } from '../../common/security/security-keyring.js';
import type { IntegrationRecord } from '../../common/integration-master-data.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { readOrganizationRuntime } from '../organization/organization-runtime.read-model.js';
import { assertIntegrationOrganization, integrationInteger, integrationScope, lockIntegrationEndpoint } from './integration-types.js';
import { IngestionTargetsService } from './ingestion-targets.service.js';
import { ingestionInputProtected } from './ingestion-input.read-model.js';
import { evaluateIngestionRow, ingestionError, ingestionTargetPermission, normalizeIngestionRule, type IngestionFields, type IngestionRule } from './ingestion.policy.js';
import type { DeleteIngestionRuleDto, IngestionControlDto, IngestionDifferenceDto, IngestionEndpointDto, IngestionEndpointPageDto, IngestionHistoryPreviewInputDto, IngestionImportResultDto, IngestionItemActionDto, IngestionItemDetailDto, IngestionItemDto, IngestionItemPageDto, IngestionJobDto, IngestionJobPageDto, IngestionJobQueryDto, IngestionPreviewDto, IngestionPreviewInputDto, IngestionRuleDto, IngestionRulePageDto, SaveIngestionRuleDto, SubmitIngestionImportDto, UpdateIngestionRuleDto } from './ingestion.dto.js';
import type { IntegrationPageQueryDto } from './integration-admin.dto.js';

type RuleRow = { id: string; organization_id: string; endpoint_id: string; creator_id: string; configuration: IngestionRule; actor_snapshot: AdminActor; version: number; enabled: boolean; updated_at: Date };
type ReceiptRow = { id: string; endpoint_id: string; organization_id: string; received_at: Date; payload_ciphertext: string | null; available: boolean };
type Selection = { receiptId: string; indexes: number[]; expected?: { id: string; version: number } | null };
type PreviewRow = { id: string; actor_id: string; endpoint_id: string; rule_id: string; rule_version: number; kind: 'SINGLE' | 'HISTORY'; selections: Selection[]; valid: boolean; expires_at: Date };
type JobRow = { id: string; organization_id: string; endpoint_id: string; receipt_id: string | null; rule_id: string; rule_version: number; rule_snapshot: IngestionRule & { configuredBy?: AdminActor; authorizedBy?: AdminActor }; actor_snapshot: AdminActor; source: 'AUTO' | 'SINGLE' | 'HISTORY'; status: string; sequence: bigint; generation: number; error_code: string | null; created_at: Date; next_row_index: number; expansion_complete: boolean; parent_job_id: string | null; planning_preview_id: string | null; reprocess_reason: string | null };
type ItemRow = { id: string; organization_id: string; job_id: string; receipt_id: string; row_index: number; status: string; target_id: string | null; target_version: number | null; source_updated_at: Date | null; source_received_at: Date | null; error_code: string | null; error_field: string | null; duplicate_of_item_id: string | null; version: number };
type Evaluation = { action: string; fields?: IngestionFields; differences: IngestionDifferenceDto[]; current: IntegrationRecord | null; sourceUpdatedAt: string | null; sourceReceivedAt?: Date; errorCode?: string; errorField?: string; duplicateOfItemId?: string };
const actorSnapshot = (actor: AdminActor, organizationId: string): AdminActor => ({ id: actor.id, organizationId: actor.organizationId, accountType: actor.accountType, sessionId: '', scopeOrganizationId: organizationId });
const itemDto = (row: ItemRow): IngestionItemDto => ({ id: row.id, jobId: row.job_id, receiptId: row.receipt_id, rowIndex: row.row_index, status: row.status, errorCode: row.error_code, errorField: row.error_field, duplicateOfItemId: row.duplicate_of_item_id, targetId: row.target_id, targetVersion: row.target_version, version: row.version });
const ruleDto = (row: RuleRow): IngestionRuleDto => ({ ...row.configuration, organizationId: row.organization_id, id: row.id, version: row.version, creatorId: row.creator_id, updatedAt: row.updated_at.toISOString() });
const errorCode = (error: unknown): string => error instanceof HttpException ? String((error.getResponse() as { code?: string }).code ?? 'INGESTION_PROCESSING_FAILED') : 'INGESTION_PROCESSING_FAILED';
const validationField = (error: HttpException, rule: IngestionRule): string => {
  const field = (error.getResponse() as { field?: unknown }).field;
  const controlled = [...Object.values(rule.mapping), ...rule.conditions.map(condition => condition.path), rule.sourceUpdatedAtField];
  return typeof field === 'string' && controlled.includes(field) ? field : 'target';
};
const newestDate = (first: Date | null | undefined, second: Date | null | undefined): Date | null => !first ? second ?? null : !second || first >= second ? first : second;
const pausedHistoryReference = Prisma.sql`EXISTS(SELECT 1 FROM integration_ingestion_jobs parent JOIN integration_ingestion_preview_receipts snapshot ON snapshot.organization_id=parent.organization_id AND snapshot.preview_id=parent.planning_preview_id WHERE parent.parent_job_id IS NULL AND parent.planning_preview_id IS NOT NULL AND parent.organization_id=j.organization_id AND snapshot.receipt_id=j.receipt_id AND parent.rule_id=j.rule_id AND parent.rule_version=j.rule_version AND parent.generation=j.generation AND parent.status='PAUSED')`;
const historyParentHasWork = Prisma.sql`NOT parent.expansion_complete OR EXISTS(SELECT 1 FROM integration_ingestion_jobs owner JOIN integration_ingestion_preview_receipts snapshot ON snapshot.receipt_id=owner.receipt_id AND snapshot.preview_id=parent.planning_preview_id WHERE owner.organization_id=parent.organization_id AND owner.rule_id=parent.rule_id AND owner.rule_version=parent.rule_version AND owner.generation=parent.generation AND owner.status IN ('PENDING','PAUSED','BLOCKED'))`;
const historyParentHasBlockedSource = Prisma.sql`EXISTS(SELECT 1 FROM integration_ingestion_jobs owner JOIN integration_ingestion_preview_receipts snapshot ON snapshot.receipt_id=owner.receipt_id AND snapshot.preview_id=parent.planning_preview_id WHERE owner.organization_id=parent.organization_id AND owner.rule_id=parent.rule_id AND owner.rule_version=parent.rule_version AND owner.generation=parent.generation AND owner.status='BLOCKED') OR EXISTS(SELECT 1 FROM integration_ingestion_items failed JOIN integration_ingestion_preview_receipts snapshot ON snapshot.receipt_id=failed.receipt_id AND snapshot.preview_id=parent.planning_preview_id WHERE failed.organization_id=parent.organization_id AND failed.rule_id=parent.rule_id AND failed.rule_version=parent.rule_version AND failed.generation=parent.generation AND failed.status='PROCESSING_FAILED')`;

@Injectable()
export class IngestionService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService, private readonly targets: IngestionTargetsService) {}

  private async rule(tx: AdminTransaction, organizationId: string, id: string, version?: number): Promise<RuleRow> {
    const [row] = await tx.$queryRaw<RuleRow[]>`SELECT * FROM integration_ingestion_rules WHERE organization_id=${organizationId}::uuid AND id=${id}::uuid`;
    if (!row) ingestionError('INGESTION_NOT_FOUND', 404);
    if (version !== undefined && row.version !== version) ingestionError('CONCURRENCY_CONFLICT', 409);
    return row;
  }
  private async access(tx: AdminTransaction, actor: AdminActor, permission = 'ingestion:read', payload = false, target?: IngestionRule['target']) {
    const organizationId = integrationScope(actor);
    await assertIntegrationOrganization(tx, organizationId);
    await assertAdminAccess(tx, actor, organizationId, [permission, ...(payload ? ['integration:receipts:read', 'integration:payload:read'] : []), ...(target ? [ingestionTargetPermission(target)] : [])]);
    return organizationId;
  }
  private page(query: IntegrationPageQueryDto) { return { page: integrationInteger(query.page ?? 1, 1, 10000), limit: integrationInteger(query.limit ?? 20, 1, 100) }; }

  async listEndpoints(actor: AdminActor, query: IntegrationPageQueryDto): Promise<IngestionEndpointPageDto> {
    const { page, limit } = this.page(query);
    return this.prisma.$transaction(async tx => {
      const organizationId = await this.access(tx, actor);
      const items = await tx.$queryRaw<IngestionEndpointDto[]>`SELECT id,name,code,status FROM integration_endpoints WHERE organization_id=${organizationId}::uuid AND deleted_at IS NULL ORDER BY name,id LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
      const [count] = await tx.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM integration_endpoints WHERE organization_id=${organizationId}::uuid AND deleted_at IS NULL`;
      return { items, total: count!.total, page, limit };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async deleteRule(actor: AdminActor, id: string, input: DeleteIngestionRuleDto, traceId: string, key?: string): Promise<void> {
    const organizationId = integrationScope(actor);
    await this.mutations.run({ actor, organizationId, key, traceId, action: 'INGESTION_RULE_DELETED', payload: { id, ...input }, permission: 'ingestion:manage', isolationLevel: 'ReadCommitted' }, async tx => {
      const current = await this.rule(tx, organizationId, id, input.expectedVersion);
      await lockIntegrationEndpoint(tx, organizationId, current.endpoint_id, true);
      await this.access(tx, actor, 'ingestion:manage', false, current.configuration.target);
      const count = await tx.$executeRaw`DELETE FROM integration_ingestion_rules WHERE organization_id=${organizationId}::uuid AND id=${id}::uuid AND version=${input.expectedVersion}`;
      if (count !== 1) ingestionError('CONCURRENCY_CONFLICT', 409);
      await this.event(tx, actor, organizationId, 'INGESTION_RULE_DELETED', id, traceId, { resourceVersion: input.expectedVersion });
    });
  }

  async listRules(actor: AdminActor, query: IntegrationPageQueryDto): Promise<IngestionRulePageDto> {
    const { page, limit } = this.page(query);
    return this.prisma.$transaction(async tx => {
      const organizationId = await this.access(tx, actor);
      const rows = await tx.$queryRaw<RuleRow[]>`SELECT * FROM integration_ingestion_rules WHERE organization_id=${organizationId}::uuid ORDER BY updated_at DESC,id LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
      const [count] = await tx.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM integration_ingestion_rules WHERE organization_id=${organizationId}::uuid`;
      return { items: rows.map(ruleDto), total: count!.total, page, limit };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async saveRule(actor: AdminActor, input: SaveIngestionRuleDto | UpdateIngestionRuleDto, traceId: string, key?: string, id?: string): Promise<IngestionRuleDto> {
    const organizationId = integrationScope(actor), configuration = normalizeIngestionRule(input);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'INGESTION_RULE_SAVED', payload: { id, ...input }, permission: 'ingestion:manage', isolationLevel: 'ReadCommitted' }, async tx => {
      const endpoint = await lockIntegrationEndpoint(tx, organizationId, configuration.endpointId);
      await this.access(tx, actor, 'ingestion:manage', false, configuration.target);
      if (configuration.enabled) {
        await assertAdminAccess(tx, actor, organizationId, 'ingestion:run');
        if (endpoint.status !== 'ENABLED') ingestionError('INTEGRATION_ACCESS_DENIED', 403);
        const overlaps = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM integration_ingestion_rules WHERE organization_id=${organizationId}::uuid AND endpoint_id=${configuration.endpointId}::uuid AND target=${configuration.target} AND enabled AND (${id ?? null}::uuid IS NULL OR id<>${id ?? null}::uuid)`;
        if (overlaps.length) ingestionError('INGESTION_RULE_OVERLAP', 409);
      }
      let row: RuleRow;
      if (id) {
        const current = await this.rule(tx, organizationId, id, (input as UpdateIngestionRuleDto).expectedVersion);
        if (current.endpoint_id !== configuration.endpointId || current.configuration.target !== configuration.target) ingestionError('INGESTION_RULE_INVALID');
        [row] = await tx.$queryRaw<RuleRow[]>`UPDATE integration_ingestion_rules SET configuration=${JSON.stringify(configuration)}::jsonb, enabled=${configuration.enabled},actor_snapshot=${JSON.stringify(actorSnapshot(actor, organizationId))}::jsonb,creator_id=${actor.id}::uuid,version=version+1,updated_at=clock_timestamp() WHERE organization_id=${organizationId}::uuid AND id=${id}::uuid AND version=${current.version} RETURNING *`;
      } else {
        const [count] = await tx.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM integration_ingestion_rules WHERE organization_id=${organizationId}::uuid`;
        if (count!.total >= 100) ingestionError('INGESTION_CAPACITY_UNAVAILABLE', 503);
        [row] = await tx.$queryRaw<RuleRow[]>`INSERT INTO integration_ingestion_rules(id,organization_id,endpoint_id,creator_id,actor_snapshot,configuration,enabled,target) VALUES(${randomUUID()}::uuid,${organizationId}::uuid,${configuration.endpointId}::uuid,${actor.id}::uuid,${JSON.stringify(actorSnapshot(actor, organizationId))}::jsonb,${JSON.stringify(configuration)}::jsonb,${configuration.enabled},${configuration.target}) RETURNING *`;
      }
      if (!row!) ingestionError('CONCURRENCY_CONFLICT', 409);
      await this.event(tx, actor, organizationId, 'INGESTION_RULE_SAVED', row.id, traceId, { resourceVersion: row.version, endpointId: row.endpoint_id, target: configuration.target, enabled: configuration.enabled });
      return ruleDto(row);
    });
  }

  private async receipt(tx: AdminTransaction, organizationId: string, id: string, endpointId: string, allowProtected = false): Promise<ReceiptRow> {
    const [row] = await tx.$queryRaw<ReceiptRow[]>(Prisma.sql`SELECT r.id,r.organization_id,r.endpoint_id,r.received_at,r.payload_ciphertext,(r.body_expires_at>clock_timestamp() OR (${allowProtected} AND ${ingestionInputProtected})) AS available FROM integration_receipts r WHERE r.organization_id=${organizationId}::uuid AND r.id=${id}::uuid AND r.endpoint_id=${endpointId}::uuid`);
    if (!row) ingestionError('INTEGRATION_RECEIPT_NOT_FOUND', 404);
    if (!row.payload_ciphertext || !row.available) ingestionError('INTEGRATION_PAYLOAD_EXPIRED', 410);
    return row;
  }
  private payload(receipt: ReceiptRow): unknown[] {
    const value: unknown = JSON.parse(decryptSecret(receipt.payload_ciphertext!, `integration:${receipt.organization_id}:${receipt.endpoint_id}:${receipt.id}`));
    if (!Array.isArray(value) || value.some(item => !item || typeof item !== 'object' || Array.isArray(item))) ingestionError('INTEGRATION_MESSAGE_INVALID');
    return value;
  }
  private async evaluate(tx: AdminTransaction, actor: AdminActor, rule: IngestionRule, row: unknown, receipt: ReceiptRow, source: string): Promise<Evaluation> {
    let parsed: ReturnType<typeof evaluateIngestionRow>;
    try { parsed = evaluateIngestionRow(rule, row); } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 400) return { action: 'VALIDATION_FAILED', differences: [], current: null, sourceUpdatedAt: null, errorCode: errorCode(error), errorField: validationField(error, rule) };
      throw error;
    }
    if (!parsed.matched) return { action: 'FILTERED', differences: [], current: null, sourceUpdatedAt: null };
    let current: IntegrationRecord | null;
    try { current = await this.targets.inspect(tx, actor, rule.target, parsed.fields); } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 400) return { action: 'VALIDATION_FAILED', differences: [], current: null, sourceUpdatedAt: parsed.sourceUpdatedAt, errorCode: errorCode(error), errorField: validationField(error, rule) };
      throw error;
    }
    if (!current) return { action: 'INSERTED', fields: parsed.fields, differences: [], current: null, sourceUpdatedAt: parsed.sourceUpdatedAt };
    const permitted = Object.entries(parsed.fields).filter(([field]) => field !== 'code' && (rule.mode === 'INSERT_ONLY' || rule.updateFields.includes(field)));
    const differences = permitted.filter(([field, value]) => current.values[field as keyof IngestionFields] !== value).map(([field, value]) => ({ field, before: current.values[field as keyof IngestionFields] ?? null, after: value }));
    const result = { fields: { ...current.values, ...Object.fromEntries(permitted) }, differences, current, sourceUpdatedAt: parsed.sourceUpdatedAt };
    if (!differences.length) return { ...result, action: 'UNCHANGED' };
    if (rule.mode === 'INSERT_ONLY') return { ...result, action: 'EXISTING_SKIPPED' };
    const [latest] = await tx.$queryRaw<{ endpoint_id: string; receipt_received_at: Date; source_updated_at: Date | null; target_version: number }[]>`SELECT endpoint_id,receipt_received_at,source_updated_at,target_version FROM integration_ingestion_target_versions WHERE organization_id=${receipt.organization_id}::uuid AND target=${rule.target} AND target_id=${current.id}::uuid`;
    const timestamp = parsed.sourceUpdatedAt ? new Date(parsed.sourceUpdatedAt) : null;
    const staleSource = latest && (latest.endpoint_id !== receipt.endpoint_id || latest.receipt_received_at > receipt.received_at || latest.target_version !== current.version || timestamp && latest.source_updated_at && timestamp <= latest.source_updated_at);
    const uncertainHistory = source === 'HISTORY' && (!timestamp || !latest?.source_updated_at);
    return { ...result, action: rule.mode === 'CONFIRM' || staleSource || uncertainHistory ? 'AWAITING_CONFIRMATION' : 'UPDATED' };
  }

  async preview(actor: AdminActor, input: IngestionPreviewInputDto, traceId: string, key?: string): Promise<IngestionPreviewDto> {
    const organizationId = integrationScope(actor);
    const preview = await this.mutations.run({ actor, organizationId, key, traceId, action: 'INGESTION_PREVIEWED', payload: input, permission: 'ingestion:run', authentication: 'active', isolationLevel: 'ReadCommitted' }, async tx => {
      const rule = await this.rule(tx, organizationId, input.ruleId, input.ruleVersion);
      await lockIntegrationEndpoint(tx, organizationId, rule.endpoint_id);
      await this.access(tx, actor, 'ingestion:run', true, rule.configuration.target);
      const receipt = await this.receipt(tx, organizationId, input.receiptId, rule.endpoint_id), rows = this.payload(receipt);
      integrationInteger(input.rowIndex, 0, Math.max(0, rows.length - 1));
      if (input.rowIndex >= rows.length) ingestionError('INGESTION_RULE_INVALID');
      const evaluation = await this.evaluate(tx, actor, rule.configuration, rows[input.rowIndex], receipt, 'SINGLE');
      const preview = await this.storePreview(tx, actor, rule, 'SINGLE', [{ receiptId: receipt.id, indexes: [input.rowIndex], expected: evaluation.current ? { id: evaluation.current.id, version: evaluation.current.version } : null }]);
      await this.event(tx, actor, organizationId, 'INGESTION_PREVIEWED', receipt.id, traceId, { ruleId: rule.id, rowIndex: input.rowIndex });
      return preview;
    });
    return this.prisma.$transaction(async tx => {
      const rule = await this.rule(tx, organizationId, input.ruleId, input.ruleVersion);
      await this.access(tx, actor, 'ingestion:run', true, rule.configuration.target);
      const receipt = await this.receipt(tx, organizationId, input.receiptId, rule.endpoint_id), rows = this.payload(receipt);
      const evaluation = await this.evaluate(tx, actor, rule.configuration, rows[input.rowIndex], receipt, 'SINGLE');
      return { ...preview, action: evaluation.action, ...(evaluation.errorCode ? { errorCode: evaluation.errorCode } : {}), ...(evaluation.errorField ? { errorField: evaluation.errorField } : {}), ...(evaluation.fields ? { fields: evaluation.fields } : {}), differences: evaluation.differences };
    }, { isolationLevel: 'RepeatableRead' });
  }
  async previewHistory(actor: AdminActor, input: IngestionHistoryPreviewInputDto, traceId: string, key?: string): Promise<IngestionPreviewDto> {
    const organizationId = integrationScope(actor), from = new Date(input.from), to = new Date(input.to);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to || to.getTime() > Date.now()) ingestionError('INGESTION_RULE_INVALID');
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'INGESTION_HISTORY_PREVIEWED', payload: input, permission: 'ingestion:run', authentication: 'active', isolationLevel: 'ReadCommitted' }, async tx => {
      const initial = await this.rule(tx, organizationId, input.ruleId, input.ruleVersion);
      await lockIntegrationEndpoint(tx, organizationId, initial.endpoint_id);
      const rule = await this.rule(tx, organizationId, input.ruleId, input.ruleVersion);
      await this.access(tx, actor, 'ingestion:run', true, rule.configuration.target);
      const [unavailable] = await tx.$queryRaw<{ exists: boolean }[]>`SELECT EXISTS(SELECT 1 FROM integration_receipts WHERE organization_id=${organizationId}::uuid AND endpoint_id=${rule.endpoint_id}::uuid AND received_at>=${from} AND received_at<=${to} AND (payload_ciphertext IS NULL OR body_expires_at<=clock_timestamp())) AS exists`;
      if (unavailable!.exists) ingestionError('INTEGRATION_PAYLOAD_EXPIRED', 410);
      const preview = await this.storePreview(tx, actor, rule, 'HISTORY', []);
      await tx.$executeRaw`INSERT INTO integration_ingestion_preview_receipts(preview_id,organization_id,receipt_id,ordinal) SELECT ${preview.previewId}::uuid,organization_id,id,(row_number() OVER(ORDER BY received_at,id)-1)::int FROM integration_receipts WHERE organization_id=${organizationId}::uuid AND endpoint_id=${rule.endpoint_id}::uuid AND received_at>=${from} AND received_at<=${to}`;
      Object.assign(preview, await this.historyStats(tx, organizationId, preview.previewId));
      await this.event(tx, actor, organizationId, 'INGESTION_HISTORY_PREVIEWED', preview.previewId, traceId, { ruleId: rule.id, receiptCount: preview.receiptCount, ...(preview.rowCount === null ? {} : { rowCount: preview.rowCount }) });
      return preview;
    }, async tx => {
      const rule = await this.rule(tx, organizationId, input.ruleId, input.ruleVersion);
      await this.access(tx, actor, 'ingestion:run', true, rule.configuration.target);
    });
  }
  private async storePreview(tx: AdminTransaction, actor: AdminActor, rule: RuleRow, kind: 'SINGLE' | 'HISTORY', selections: Selection[]): Promise<IngestionPreviewDto> {
    await tx.$executeRaw`DELETE FROM integration_ingestion_previews p WHERE p.organization_id=${rule.organization_id}::uuid AND p.expires_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM integration_ingestion_jobs j WHERE j.planning_preview_id=p.id)`;
    const [count] = await tx.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM integration_ingestion_previews p WHERE p.organization_id=${rule.organization_id}::uuid AND NOT EXISTS(SELECT 1 FROM integration_ingestion_jobs j WHERE j.planning_preview_id=p.id)`;
    if (count!.total >= 100) ingestionError('INGESTION_PREVIEW_LIMIT_EXCEEDED', 429);
    const previewId = randomUUID(), expiresAt = new Date(Date.now() + 600000);
    await tx.$executeRaw`INSERT INTO integration_ingestion_previews(id,organization_id,actor_id,endpoint_id,rule_id,rule_version,kind,selections,expires_at) VALUES(${previewId}::uuid,${rule.organization_id}::uuid,${actor.id}::uuid,${rule.endpoint_id}::uuid,${rule.id}::uuid,${rule.version},${kind},${JSON.stringify(selections)}::jsonb,${expiresAt})`;
    return { previewId, receiptCount: selections.length, rowCount: selections.reduce((sum, selection) => sum + selection.indexes.length, 0), expiresAt: expiresAt.toISOString() };
  }
  private async historyStats(tx: AdminTransaction, organizationId: string, previewId: string): Promise<{ receiptCount: number; rowCount: number | null }> {
    const [row] = await tx.$queryRaw<{ receipt_count: number; known_count: number; total: bigint | null }[]>`SELECT count(*)::int AS receipt_count,count(r.row_count)::int AS known_count,sum(r.row_count) AS total FROM integration_ingestion_preview_receipts s JOIN integration_receipts r ON r.organization_id=s.organization_id AND r.id=s.receipt_id WHERE s.organization_id=${organizationId}::uuid AND s.preview_id=${previewId}::uuid`;
    return { receiptCount: row!.receipt_count, rowCount: row!.known_count === row!.receipt_count ? Number(row!.total ?? 0) : null };
  }
  private async enqueueHistory(tx: AdminTransaction, rule: RuleRow, previewId: string, actor: AdminActor, reprocessReason?: string): Promise<IngestionImportResultDto> {
    const organizationId = rule.organization_id, endpointId = rule.endpoint_id;
    const [unavailable] = await tx.$queryRaw<{ exists: boolean }[]>`SELECT EXISTS(SELECT 1 FROM integration_ingestion_preview_receipts s JOIN integration_receipts r ON r.organization_id=s.organization_id AND r.id=s.receipt_id WHERE s.organization_id=${organizationId}::uuid AND s.preview_id=${previewId}::uuid AND r.payload_ciphertext IS NULL) AS exists`;
    if (unavailable!.exists) ingestionError('INTEGRATION_PAYLOAD_EXPIRED', 410);
    const stats = await this.historyStats(tx, organizationId, previewId);
    await tx.$executeRaw`INSERT INTO integration_ingestion_queues(organization_id,endpoint_id) VALUES(${organizationId}::uuid,${endpointId}::uuid) ON CONFLICT DO NOTHING`;
    if (!stats.receiptCount) return { ...stats, jobIds: [], reused: true };
    const [existing] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM integration_ingestion_jobs WHERE organization_id=${organizationId}::uuid AND planning_preview_id=${previewId}::uuid AND parent_job_id IS NULL AND ${!reprocessReason}`;
    if (existing) return { ...stats, jobIds: [existing.id], reused: true };
    const [queue] = await tx.$queryRaw<{ next_sequence: bigint }[]>`UPDATE integration_ingestion_queues SET next_sequence=next_sequence+1+(SELECT count(*) FROM integration_ingestion_preview_receipts WHERE preview_id=${previewId}::uuid) WHERE organization_id=${organizationId}::uuid AND endpoint_id=${endpointId}::uuid RETURNING next_sequence-(1+(SELECT count(*) FROM integration_ingestion_preview_receipts WHERE preview_id=${previewId}::uuid)) AS next_sequence`;
    const id = randomUUID();
    const [generation] = await tx.$queryRaw<{ value: number }[]>`SELECT CASE WHEN ${!!reprocessReason} THEN COALESCE(max(generation),0)+1 ELSE 0 END AS value FROM integration_ingestion_jobs WHERE organization_id=${organizationId}::uuid AND rule_id=${rule.id}::uuid AND rule_version=${rule.version}`;
    await tx.$executeRaw`INSERT INTO integration_ingestion_jobs(id,organization_id,endpoint_id,receipt_id,rule_id,rule_version,rule_snapshot,actor_snapshot,source,sequence,generation,selection_key,reprocess_reason,expansion_complete,next_row_index,planning_preview_id) VALUES(${id}::uuid,${organizationId}::uuid,${endpointId}::uuid,NULL,${rule.id}::uuid,${rule.version},${JSON.stringify({ ...rule.configuration, configuredBy: rule.actor_snapshot })}::jsonb,${JSON.stringify(actor)}::jsonb,'HISTORY',${queue!.next_sequence},${generation!.value},-2,${reprocessReason ?? null},false,0,${previewId}::uuid)`;
    return { ...stats, jobIds: [id], reused: false };
  }
  private async planHistoryParent(tx: AdminTransaction, parent: JobRow): Promise<void> {
    const [total] = await tx.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM integration_ingestion_preview_receipts WHERE organization_id=${parent.organization_id}::uuid AND preview_id=${parent.planning_preview_id}::uuid`;
    const end = Math.min(total!.count, parent.next_row_index + 500);
    if (end > parent.next_row_index) {
      await tx.$executeRaw`INSERT INTO integration_ingestion_jobs(id,organization_id,endpoint_id,receipt_id,rule_id,rule_version,rule_snapshot,actor_snapshot,source,sequence,generation,selection_key,reprocess_reason,expansion_complete,parent_job_id,planning_preview_id)
        SELECT gen_random_uuid(),parent.organization_id,parent.endpoint_id,s.receipt_id,parent.rule_id,parent.rule_version,parent.rule_snapshot,parent.actor_snapshot,'HISTORY',parent.sequence+s.ordinal+1,parent.generation,-1,parent.reprocess_reason,false,parent.id,NULL
        FROM integration_ingestion_jobs parent JOIN integration_ingestion_preview_receipts s ON s.organization_id=parent.organization_id AND s.preview_id=parent.planning_preview_id WHERE parent.id=${parent.id}::uuid AND s.ordinal>=${parent.next_row_index} AND s.ordinal<${end}
        ON CONFLICT DO NOTHING`;
    }
    await tx.$executeRaw`UPDATE integration_ingestion_jobs SET next_row_index=${end},expansion_complete=${end}=${total!.count} WHERE id=${parent.id}::uuid`;
    await this.refreshJob(tx, parent.id);
  }

  async submitImport(actor: AdminActor, input: SubmitIngestionImportDto, traceId: string, key?: string): Promise<IngestionImportResultDto> {
    const organizationId = integrationScope(actor);
    if (input.confirmed !== true || input.reprocessReason !== undefined && (!input.reprocessReason.trim() || input.reprocessReason.length > 300)) ingestionError('INGESTION_RULE_INVALID');
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'INGESTION_IMPORT_SUBMITTED', payload: input, permission: 'ingestion:run', authentication: 'active', isolationLevel: 'ReadCommitted' }, async tx => {
      const [preview] = await tx.$queryRaw<PreviewRow[]>`SELECT *,expires_at>clock_timestamp() AS valid FROM integration_ingestion_previews WHERE organization_id=${organizationId}::uuid AND id=${input.previewId}::uuid AND actor_id=${actor.id}::uuid`;
      if (!preview?.valid) ingestionError('INGESTION_PREVIEW_EXPIRED', 410);
      await lockIntegrationEndpoint(tx, organizationId, preview.endpoint_id);
      const rule = await this.rule(tx, organizationId, preview.rule_id, preview.rule_version);
      await this.access(tx, actor, 'ingestion:run', true, rule.configuration.target);
      await this.access(tx, rule.actor_snapshot, 'ingestion:run', false, rule.configuration.target);
      if (preview.kind === 'HISTORY' && !preview.selections.length) {
        const result = await this.enqueueHistory(tx, rule, preview.id, actorSnapshot(actor, organizationId), input.reprocessReason?.trim());
        await this.event(tx, actor, organizationId, 'INGESTION_IMPORT_SUBMITTED', preview.id, traceId, { ruleId: rule.id, target: rule.configuration.target, receiptCount: result.receiptCount, ...(result.rowCount === null ? {} : { rowCount: result.rowCount }), reprocessed: !!input.reprocessReason });
        return result;
      }
      const result: IngestionImportResultDto = { jobIds: [], reused: true, receiptCount: preview.selections.length, rowCount: 0 };
      for (const selection of preview.selections) {
        const receipt = await this.receipt(tx, organizationId, selection.receiptId, rule.endpoint_id), rows = this.payload(receipt);
        if (selection.indexes.some(index => index >= rows.length)) ingestionError('CONCURRENCY_CONFLICT', 409);
        if (!selection.indexes.length) continue;
        if (preview.kind === 'SINGLE') {
          const evaluation = await this.evaluate(tx, actor, rule.configuration, rows[selection.indexes[0]!], receipt, 'SINGLE');
          if ((evaluation.current?.id ?? null) !== (selection.expected?.id ?? null) || (evaluation.current?.version ?? null) !== (selection.expected?.version ?? null)) ingestionError('CONCURRENCY_CONFLICT', 409);
        }
        const queued = await this.enqueue(tx, rule, receipt.id, selection.indexes, preview.kind, actorSnapshot(actor, organizationId), input.reprocessReason?.trim(), selection.expected);
        result.jobIds.push(queued.id, ...queued.additionalIds); result.reused &&= queued.reused; result.rowCount! += selection.indexes.length;
      }
      result.jobIds = [...new Set(result.jobIds)];
      await this.event(tx, actor, organizationId, 'INGESTION_IMPORT_SUBMITTED', preview.id, traceId, { ruleId: rule.id, target: rule.configuration.target, receiptCount: result.receiptCount, rowCount: result.rowCount!, reprocessed: !!input.reprocessReason });
      return result;
    }, async tx => {
      const [preview] = await tx.$queryRaw<PreviewRow[]>`SELECT * FROM integration_ingestion_previews WHERE organization_id=${organizationId}::uuid AND id=${input.previewId}::uuid AND actor_id=${actor.id}::uuid`;
      if (!preview) ingestionError('INGESTION_PREVIEW_EXPIRED', 410);
      const rule = await this.rule(tx, organizationId, preview.rule_id, preview.rule_version);
      await this.access(tx, actor, 'ingestion:run', true, rule.configuration.target);
    }, async (tx, response) => {
      const metadata = await this.audit.readSuccessfulResourceMetadata(tx, { organizationId, actorUserId: actor.id, action: 'INGESTION_IMPORT_SUBMITTED', resourceType: 'IntegrationIngestion', resourceId: input.previewId });
      const target = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata.target : undefined;
      const auditedRuleId = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata.ruleId : undefined;
      const targets = typeof target === 'string' && ['SUPPLIER', 'CUSTOMER', 'MATERIAL', 'COMPONENT'].includes(target)
        ? [target as IngestionRule['target']]
        : (await tx.$queryRaw<{ target: IngestionRule['target'] }[]>`SELECT DISTINCT rule_snapshot->>'target' AS target FROM integration_ingestion_jobs WHERE organization_id=${organizationId}::uuid AND id=ANY(${response.jobIds}::uuid[])`).map(job => job.target);
      if (!targets.length && response.jobIds.length === 0 && typeof auditedRuleId === 'string') {
        const currentRule = await tx.$queryRaw<{ target: IngestionRule['target'] }[]>`SELECT target FROM integration_ingestion_rules WHERE organization_id=${organizationId}::uuid AND id=${auditedRuleId}::uuid`;
        if (currentRule[0]?.target) targets.push(currentRule[0].target);
      }
      if (!targets.length) ingestionError('INGESTION_NOT_FOUND', 404);
      for (const target of targets) await this.access(tx, actor, 'ingestion:run', true, target);
    });
  }

  async enqueueReceived(tx: AdminTransaction, organizationId: string, endpointId: string, receiptId: string, rowCount: number): Promise<void> {
    const rules = await tx.$queryRaw<RuleRow[]>`SELECT * FROM integration_ingestion_rules WHERE organization_id=${organizationId}::uuid AND endpoint_id=${endpointId}::uuid AND enabled ORDER BY id`;
    if (!rules.length) return;
    if (rowCount > 10000 || rowCount * rules.length > 10000) ingestionError('INGESTION_CAPACITY_UNAVAILABLE', 503);
    if (!rowCount) return;
    for (const rule of rules) await this.enqueue(tx, rule, receiptId, Array.from({ length: rowCount }, (_, index) => index), 'AUTO', rule.actor_snapshot);
  }
  private async enqueue(tx: AdminTransaction, rule: RuleRow, receiptId: string, indexes: number[], source: 'AUTO' | 'SINGLE' | 'HISTORY', actor: AdminActor, reprocessReason?: string, expected?: { id: string; version: number } | null): Promise<{ id: string; additionalIds: string[]; reused: boolean }> {
    const organizationId = rule.organization_id, endpointId = rule.endpoint_id;
    let generation = 0;
    if (reprocessReason) {
      const [last] = await tx.$queryRaw<{ generation: number }[]>`SELECT COALESCE(max(generation),0)::int AS generation FROM integration_ingestion_jobs WHERE organization_id=${organizationId}::uuid AND (receipt_id=${receiptId}::uuid OR planning_preview_id IN (SELECT preview_id FROM integration_ingestion_preview_receipts WHERE receipt_id=${receiptId}::uuid)) AND rule_id=${rule.id}::uuid AND rule_version=${rule.version}`;
      generation = last!.generation + 1;
    }
    const [parent] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM integration_ingestion_jobs WHERE organization_id=${organizationId}::uuid AND rule_id=${rule.id}::uuid AND rule_version=${rule.version} AND generation=${generation} AND parent_job_id IS NULL AND planning_preview_id IN (SELECT preview_id FROM integration_ingestion_preview_receipts WHERE organization_id=${organizationId}::uuid AND receipt_id=${receiptId}::uuid) ORDER BY sequence LIMIT 1`;
    if (parent) return { id: parent.id, additionalIds: [], reused: true };
    const [unexpanded] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM integration_ingestion_jobs WHERE organization_id=${organizationId}::uuid AND receipt_id=${receiptId}::uuid AND rule_id=${rule.id}::uuid AND rule_version=${rule.version} AND generation=${generation} AND selection_key=-1 AND NOT expansion_complete`;
    if (unexpanded) return { id: unexpanded.id, additionalIds: [], reused: true };
    const covered = await tx.$queryRaw<{ row_index: number; job_id: string }[]>`SELECT row_index,job_id FROM integration_ingestion_items WHERE organization_id=${organizationId}::uuid AND receipt_id=${receiptId}::uuid AND rule_id=${rule.id}::uuid AND rule_version=${rule.version} AND generation=${generation} AND row_index=ANY(${indexes}::integer[]) ORDER BY row_index`;
    const coveredJobs = [...new Set(covered.map(item => item.job_id))];
    const coveredIndexes = new Set(covered.map(item => item.row_index));
    indexes = indexes.filter(index => !coveredIndexes.has(index));
    if (!indexes.length) return { id: coveredJobs[0]!, additionalIds: coveredJobs.slice(1), reused: true };
    const selectionKey = source === 'SINGLE' ? indexes[0]! : -1;
    const [existing] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM integration_ingestion_jobs WHERE organization_id=${organizationId}::uuid AND receipt_id=${receiptId}::uuid AND rule_id=${rule.id}::uuid AND rule_version=${rule.version} AND generation=${generation} AND selection_key=${selectionKey}`;
    if (existing) return { id: existing.id, additionalIds: coveredJobs, reused: true };
    await tx.$executeRaw`DELETE FROM integration_ingestion_jobs j WHERE j.organization_id=${organizationId}::uuid AND j.completed_at<clock_timestamp()-INTERVAL '90 days' AND j.status IN ('COMPLETED','CANCELLED') AND NOT EXISTS(SELECT 1 FROM integration_ingestion_items i JOIN integration_ingestion_jobs owner ON owner.id=i.job_id WHERE (owner.id=j.id OR owner.parent_job_id=j.id) AND i.status IN ('PENDING','AWAITING_CONFIRMATION','PROCESSING_FAILED')) AND NOT EXISTS(SELECT 1 FROM integration_ingestion_jobs child WHERE child.parent_job_id=j.id AND child.status IN ('PENDING','PAUSED','BLOCKED'))`;
    const [counts] = await tx.$queryRaw<{ jobs: number; items: number }[]>`SELECT (SELECT count(*)::int FROM integration_ingestion_jobs WHERE organization_id=${organizationId}::uuid AND expansion_complete AND status IN ('PENDING','PAUSED','BLOCKED')) AS jobs,(SELECT count(*)::int FROM integration_ingestion_items WHERE organization_id=${organizationId}::uuid AND status='PENDING') AS items`;
    if (counts!.jobs >= 10000 || counts!.items + indexes.length > 100000) ingestionError('INGESTION_CAPACITY_UNAVAILABLE', source === 'AUTO' ? 503 : 429);
    await tx.$executeRaw`INSERT INTO integration_ingestion_queues(organization_id,endpoint_id) VALUES(${organizationId}::uuid,${endpointId}::uuid) ON CONFLICT DO NOTHING`;
    const [queue] = await tx.$queryRaw<{ next_sequence: bigint }[]>`UPDATE integration_ingestion_queues SET next_sequence=next_sequence+1 WHERE organization_id=${organizationId}::uuid AND endpoint_id=${endpointId}::uuid RETURNING next_sequence-1 AS next_sequence`;
    const id = randomUUID();
    await tx.$executeRaw`INSERT INTO integration_ingestion_jobs(id,organization_id,endpoint_id,receipt_id,rule_id,rule_version,rule_snapshot,actor_snapshot,source,sequence,generation,selection_key,reprocess_reason) VALUES(${id}::uuid,${organizationId}::uuid,${endpointId}::uuid,${receiptId}::uuid,${rule.id}::uuid,${rule.version},${JSON.stringify({ ...rule.configuration, configuredBy: rule.actor_snapshot })}::jsonb,${JSON.stringify(actor)}::jsonb,${source},${queue!.next_sequence},${generation},${selectionKey},${reprocessReason ?? null})`;
    for (let offset = 0; offset < indexes.length; offset += 500) await tx.$executeRaw(Prisma.sql`INSERT INTO integration_ingestion_items(id,organization_id,job_id,receipt_id,rule_id,rule_version,row_index,generation,target_id,target_version) VALUES ${Prisma.join(indexes.slice(offset, offset + 500).map(index => Prisma.sql`(${randomUUID()}::uuid,${organizationId}::uuid,${id}::uuid,${receiptId}::uuid,${rule.id}::uuid,${rule.version},${index},${generation},${expected?.id ?? null}::uuid,${expected?.version ?? null})`))} ON CONFLICT(organization_id,receipt_id,rule_id,rule_version,row_index,generation) DO NOTHING`);
    await this.refreshJob(tx, id);
    return { id, additionalIds: coveredJobs, reused: false };
  }

  private async event(tx: AdminTransaction, actor: AdminActor, organizationId: string, action: string, id: string, traceId: string, metadata: Record<string, string | number | boolean>) {
    await this.audit.record({ organizationId, actorUserId: actor.id, action, resourceType: 'IntegrationIngestion', resourceId: id, outcome: 'SUCCESS', traceId, metadata }, tx);
  }
  private async refreshJob(tx: AdminTransaction, id: string) {
    await tx.$executeRaw`UPDATE integration_ingestion_jobs j SET status=CASE WHEN NOT expansion_complete OR EXISTS(SELECT 1 FROM integration_ingestion_items i WHERE i.job_id=j.id AND i.status='PENDING') THEN 'PENDING' ELSE 'COMPLETED' END,completed_at=CASE WHEN NOT expansion_complete OR EXISTS(SELECT 1 FROM integration_ingestion_items i WHERE i.job_id=j.id AND i.status='PENDING') THEN NULL ELSE clock_timestamp() END,error_code=NULL WHERE j.id=${id}::uuid AND j.status NOT IN ('PAUSED','CANCELLED','BLOCKED')`;
    await tx.$executeRaw(Prisma.sql`UPDATE integration_ingestion_jobs parent SET status=CASE WHEN ${historyParentHasWork} THEN 'PENDING' ELSE 'COMPLETED' END,completed_at=CASE WHEN ${historyParentHasWork} THEN NULL ELSE clock_timestamp() END WHERE ${this.parentReferencesJob(id)} AND parent.status NOT IN ('PAUSED','CANCELLED','BLOCKED')`);
  }
  private parentReferencesJob(id: string | Prisma.Sql) {
    return Prisma.sql`parent.organization_id=(SELECT organization_id FROM integration_ingestion_jobs WHERE id=${id}::uuid) AND parent.parent_job_id IS NULL AND parent.planning_preview_id IS NOT NULL AND (parent.id=${id}::uuid OR EXISTS(SELECT 1 FROM integration_ingestion_jobs changed WHERE changed.id=${id}::uuid AND changed.organization_id=parent.organization_id AND changed.rule_id=parent.rule_id AND changed.rule_version=parent.rule_version AND changed.generation=parent.generation AND (changed.parent_job_id=parent.id OR EXISTS(SELECT 1 FROM integration_ingestion_preview_receipts snapshot WHERE snapshot.organization_id=parent.organization_id AND snapshot.preview_id=parent.planning_preview_id AND snapshot.receipt_id=changed.receipt_id))))`;
  }
  private async releaseResolvedParents(tx: AdminTransaction, organizationId: string, ownerIds: string[], errorCodes: string[]) {
    if (!ownerIds.length) return;
    await tx.$executeRaw(Prisma.sql`UPDATE integration_ingestion_jobs parent SET status=CASE WHEN ${historyParentHasWork} THEN 'PENDING' ELSE 'COMPLETED' END,completed_at=CASE WHEN ${historyParentHasWork} THEN NULL ELSE clock_timestamp() END,error_code=NULL WHERE parent.organization_id=${organizationId}::uuid AND parent.parent_job_id IS NULL AND parent.planning_preview_id IS NOT NULL AND (parent.status IN ('PENDING','COMPLETED') OR (parent.status='BLOCKED' AND parent.error_code=ANY(${errorCodes}::text[]) AND NOT (${historyParentHasBlockedSource}))) AND EXISTS(SELECT 1 FROM integration_ingestion_jobs owner WHERE owner.id=ANY(${ownerIds}::uuid[]) AND ${this.parentReferencesJob(Prisma.sql`owner.id`)})`);
  }

  async processDue(limit = 100): Promise<number> {
    integrationInteger(limit, 1, 1000);
    let processed = 0;
    for (let round = 0; round < limit; round++) {
      const candidates = await this.prisma.$queryRaw<JobRow[]>(Prisma.sql`SELECT j.* FROM integration_ingestion_jobs j WHERE j.status='PENDING' AND (j.planning_preview_id IS NULL OR NOT j.expansion_complete) AND NOT ${pausedHistoryReference} AND NOT EXISTS(SELECT 1 FROM integration_ingestion_jobs earlier WHERE earlier.organization_id=j.organization_id AND earlier.endpoint_id=j.endpoint_id AND earlier.sequence<j.sequence AND (earlier.status IN ('PAUSED','BLOCKED') OR (earlier.status='PENDING' AND (earlier.planning_preview_id IS NULL OR NOT earlier.expansion_complete)))) ORDER BY j.created_at,j.id LIMIT 1`);
      const candidate = candidates[0];
      if (!candidate) break;
      let itemId: string | undefined;
      try {
        const completed = await this.prisma.$transaction(async tx => {
          const endpoint = await lockIntegrationEndpoint(tx, candidate.organization_id, candidate.endpoint_id);
          if (endpoint.status !== 'ENABLED') ingestionError('INGESTION_AUTHORIZATION_REVOKED', 403);
          const [job] = await tx.$queryRaw<JobRow[]>(Prisma.sql`SELECT j.* FROM integration_ingestion_jobs j WHERE j.organization_id=${candidate.organization_id}::uuid AND j.id=${candidate.id}::uuid AND NOT ${pausedHistoryReference} FOR UPDATE OF j`);
          if (!job || job.status !== 'PENDING') return false;
          const [earlier] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM integration_ingestion_jobs WHERE organization_id=${job.organization_id}::uuid AND endpoint_id=${job.endpoint_id}::uuid AND sequence<${job.sequence} AND (status IN ('PAUSED','BLOCKED') OR (status='PENDING' AND (planning_preview_id IS NULL OR NOT expansion_complete))) LIMIT 1`;
          if (earlier) return false;
          const executionActor = job.rule_snapshot.authorizedBy ?? job.actor_snapshot;
          await this.access(tx, executionActor, 'ingestion:run', false, job.rule_snapshot.target);
          if (!job.rule_snapshot.authorizedBy && job.rule_snapshot.configuredBy) await this.access(tx, job.rule_snapshot.configuredBy, 'ingestion:run', false, job.rule_snapshot.target);
          if (job.parent_job_id === null && job.planning_preview_id !== null && job.receipt_id === null) {
            await this.planHistoryParent(tx, job);
            return true;
          }
          let [item] = await tx.$queryRaw<ItemRow[]>`SELECT * FROM integration_ingestion_items WHERE job_id=${job.id}::uuid AND status='PENDING' ORDER BY row_index LIMIT 1 FOR UPDATE`;
          let receipt: ReceiptRow | undefined, rows: unknown[] | undefined;
          if (!item && !job.expansion_complete) {
            receipt = await this.receipt(tx, job.organization_id, job.receipt_id!, job.endpoint_id, true);
            rows = this.payload(receipt);
            await tx.$executeRaw`UPDATE integration_receipts SET row_count=${rows.length} WHERE organization_id=${job.organization_id}::uuid AND id=${job.receipt_id}::uuid AND row_count IS NULL`;
            const [active] = await tx.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM integration_ingestion_items WHERE organization_id=${job.organization_id}::uuid AND status='PENDING'`;
            const end = Math.min(rows.length, job.next_row_index + Math.max(1, Math.min(500, 100000 - active!.count)));
            if (end > job.next_row_index) await tx.$executeRaw`INSERT INTO integration_ingestion_items(id,organization_id,job_id,receipt_id,rule_id,rule_version,row_index,generation)
              SELECT gen_random_uuid(),${job.organization_id}::uuid,${job.id}::uuid,${job.receipt_id}::uuid,${job.rule_id}::uuid,${job.rule_version},row_index,${job.generation} FROM generate_series(${job.next_row_index}::integer,${end - 1}::integer) AS row_index ON CONFLICT(organization_id,receipt_id,rule_id,rule_version,row_index,generation) DO NOTHING`;
            await tx.$executeRaw`UPDATE integration_ingestion_jobs SET next_row_index=${end},expansion_complete=${end === rows.length} WHERE id=${job.id}::uuid`;
            await this.refreshJob(tx, job.id);
            return true;
          }
          if (!item) { await this.refreshJob(tx, job.id); return !job.expansion_complete; }
          itemId = item.id;
          receipt ??= await this.receipt(tx, job.organization_id, item.receipt_id, job.endpoint_id, true);
          rows ??= this.payload(receipt);
          if (item.row_index >= rows.length) ingestionError('INTEGRATION_MESSAGE_INVALID');
          const parsed = (() => { try { return evaluateIngestionRow(job.rule_snapshot, rows[item.row_index]); } catch { return null; } })();
          if (parsed?.matched) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ingestion-target:${job.organization_id}:${job.rule_snapshot.target}:${parsed.fields.code}`},0))::text`;
          const evaluation = await this.evaluate(tx, executionActor, job.rule_snapshot, rows[item.row_index], receipt, job.source);
          if (job.source === 'SINGLE' && ['INSERTED', 'UPDATED'].includes(evaluation.action) && ((item.target_id ?? null) !== (evaluation.current?.id ?? null) || (item.target_version ?? null) !== (evaluation.current?.version ?? null))) evaluation.action = 'AWAITING_CONFIRMATION';
          await this.applyEvaluation(tx, job, item, receipt, evaluation, executionActor, randomUUID());
          await this.refreshJob(tx, job.id);
          return true;
        }, { isolationLevel: 'ReadCommitted', timeout: 15000 });
        if (completed) processed++;
      } catch (error) {
        await this.recordFailure(candidate, itemId, error);
        processed++;
      }
    }
    return processed;
  }

  private async reuseDifference(tx: AdminTransaction, job: JobRow, item: ItemRow, receipt: ReceiptRow, evaluation: Evaluation): Promise<void> {
    const candidates = await tx.$queryRaw<ItemRow[]>`SELECT i.* FROM integration_ingestion_items i JOIN integration_ingestion_jobs j ON j.id=i.job_id WHERE i.organization_id=${job.organization_id}::uuid AND i.target_id=${evaluation.current!.id}::uuid AND i.target_version=${evaluation.current!.version} AND i.status='AWAITING_CONFIRMATION' AND j.endpoint_id=${job.endpoint_id}::uuid AND j.rule_snapshot->>'target'=${job.rule_snapshot.target} AND COALESCE(j.rule_snapshot->>'sourceUpdatedAtField','')=${job.rule_snapshot.sourceUpdatedAtField ?? ''} ORDER BY j.sequence,i.row_index`;
    for (const candidate of candidates) {
      const previousJob = await this.jobRow(tx, job.organization_id, candidate.job_id);
      const previousReceipt = await this.receipt(tx, job.organization_id, candidate.receipt_id, previousJob.endpoint_id, true);
      const parsed = evaluateIngestionRow(previousJob.rule_snapshot, this.payload(previousReceipt)[candidate.row_index]);
      if (!parsed.matched) continue;
      const differences = Object.entries(parsed.fields).filter(([field, value]) => field !== 'code' && previousJob.rule_snapshot.updateFields.includes(field) && evaluation.current!.values[field as keyof IngestionFields] !== value)
        .map(([field, value]) => ({ field, before: evaluation.current!.values[field as keyof IngestionFields] ?? null, after: value }));
      if (differences.length !== evaluation.differences.length || differences.some(difference => !evaluation.differences.some(current => current.field === difference.field && current.before === difference.before && current.after === difference.after))) continue;
      const sourceUpdatedAt = newestDate(candidate.source_updated_at, evaluation.sourceUpdatedAt ? new Date(evaluation.sourceUpdatedAt) : null);
      const receivedAt = newestDate(candidate.source_received_at ?? previousReceipt.received_at, evaluation.sourceReceivedAt ?? receipt.received_at)!;
      if (await this.stale(tx, previousJob, candidate, previousReceipt, evaluation)) {
        await tx.$executeRaw`UPDATE integration_ingestion_items SET status='SKIPPED',duplicate_of_item_id=${item.id}::uuid,error_code=NULL,error_field=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=${candidate.id}::uuid`;
        await tx.$executeRaw`UPDATE integration_ingestion_items SET duplicate_of_item_id=${item.id}::uuid WHERE duplicate_of_item_id=${candidate.id}::uuid`;
        evaluation.sourceUpdatedAt = sourceUpdatedAt?.toISOString() ?? null;
        evaluation.sourceReceivedAt = receivedAt;
        continue;
      }
      await tx.$executeRaw`UPDATE integration_ingestion_items SET source_received_at=${receivedAt},source_updated_at=${sourceUpdatedAt},updated_at=clock_timestamp() WHERE id=${candidate.id}::uuid`;
      await tx.$executeRaw`UPDATE integration_ingestion_items SET duplicate_of_item_id=${candidate.id}::uuid WHERE duplicate_of_item_id=${item.id}::uuid`;
      evaluation.action = 'SKIPPED';
      evaluation.duplicateOfItemId = candidate.id;
      return;
    }
  }

  private async applyEvaluation(tx: AdminTransaction, job: JobRow, item: ItemRow, receipt: ReceiptRow, evaluation: Evaluation, actor: AdminActor, traceId: string): Promise<void> {
    if (evaluation.action === 'AWAITING_CONFIRMATION') await this.reuseDifference(tx, job, item, receipt, evaluation);
    const receivedAt = newestDate(evaluation.sourceReceivedAt ?? item.source_received_at, receipt.received_at)!;
    const sourceUpdatedAt = newestDate(item.source_updated_at, evaluation.sourceUpdatedAt ? new Date(evaluation.sourceUpdatedAt) : null);
    let current = evaluation.current;
    if (evaluation.action === 'INSERTED' || evaluation.action === 'UPDATED') {
      current = await this.targets.write(tx, actor, job.rule_snapshot.target, evaluation.fields!, current ? { id: current.id, version: current.version } : null, traceId);
      await tx.$executeRaw`INSERT INTO integration_ingestion_target_versions(organization_id,target,target_id,endpoint_id,receipt_received_at,source_updated_at,target_version) VALUES(${job.organization_id}::uuid,${job.rule_snapshot.target},${current.id}::uuid,${job.endpoint_id}::uuid,${receivedAt},${sourceUpdatedAt},${current.version}) ON CONFLICT(organization_id,target,target_id) DO UPDATE SET endpoint_id=EXCLUDED.endpoint_id,receipt_received_at=EXCLUDED.receipt_received_at,source_updated_at=EXCLUDED.source_updated_at,target_version=EXCLUDED.target_version`;
    }
    if (evaluation.action === 'UNCHANGED' && current) await tx.$executeRaw`INSERT INTO integration_ingestion_target_versions(organization_id,target,target_id,endpoint_id,receipt_received_at,source_updated_at,target_version) VALUES(${job.organization_id}::uuid,${job.rule_snapshot.target},${current.id}::uuid,${job.endpoint_id}::uuid,${receipt.received_at},${evaluation.sourceUpdatedAt ? new Date(evaluation.sourceUpdatedAt) : null},${current.version}) ON CONFLICT(organization_id,target,target_id) DO UPDATE SET receipt_received_at=EXCLUDED.receipt_received_at,source_updated_at=COALESCE(EXCLUDED.source_updated_at,integration_ingestion_target_versions.source_updated_at),target_version=EXCLUDED.target_version WHERE integration_ingestion_target_versions.endpoint_id=EXCLUDED.endpoint_id AND integration_ingestion_target_versions.receipt_received_at<=EXCLUDED.receipt_received_at AND (integration_ingestion_target_versions.source_updated_at IS NULL OR EXCLUDED.source_updated_at IS NULL OR integration_ingestion_target_versions.source_updated_at<=EXCLUDED.source_updated_at)`;
    await tx.$executeRaw`UPDATE integration_ingestion_items SET status=${evaluation.action},target_id=${current?.id ?? null}::uuid,target_version=${current?.version ?? null},source_updated_at=${sourceUpdatedAt},source_received_at=${receivedAt},error_code=${evaluation.errorCode ?? null},error_field=${evaluation.errorField ?? null},duplicate_of_item_id=${evaluation.duplicateOfItemId ?? null}::uuid,version=version+1,updated_at=clock_timestamp() WHERE id=${item.id}::uuid`;
    await this.event(tx, actor, job.organization_id, 'INGESTION_ITEM_PROCESSED', item.id, traceId, { jobId: job.id, receiptId: item.receipt_id, rowIndex: item.row_index, ruleVersion: job.rule_version, result: evaluation.action, target: job.rule_snapshot.target });
  }
  private async recordFailure(candidate: JobRow, itemId: string | undefined, error: unknown) {
    const validation = error instanceof HttpException && error.getStatus() === 400;
    const revoked = error instanceof HttpException && [401, 403, 404].includes(error.getStatus());
    const code = validation ? errorCode(error) : revoked ? 'INGESTION_AUTHORIZATION_REVOKED' : 'INGESTION_PROCESSING_FAILED';
    await this.prisma.$transaction(async tx => {
      await readOrganizationRuntime(tx, candidate.organization_id, true);
      await tx.$queryRaw`SELECT id FROM integration_endpoints WHERE organization_id=${candidate.organization_id}::uuid AND id=${candidate.endpoint_id}::uuid FOR UPDATE`;
      const [job] = await tx.$queryRaw<JobRow[]>`SELECT * FROM integration_ingestion_jobs WHERE organization_id=${candidate.organization_id}::uuid AND id=${candidate.id}::uuid FOR UPDATE`;
      if (!job || job.status !== 'PENDING') return;
      if (itemId) {
        const [pending] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM integration_ingestion_items WHERE id=${itemId}::uuid AND job_id=${job.id}::uuid AND status='PENDING'`;
        if (!pending) return;
      }
      if (itemId) await tx.$executeRaw`UPDATE integration_ingestion_items SET status=${validation ? 'VALIDATION_FAILED' : 'PROCESSING_FAILED'},error_code=${code},error_field=${validation ? validationField(error as HttpException, job.rule_snapshot) : null},version=version+1,updated_at=clock_timestamp() WHERE id=${itemId}::uuid AND job_id=${job.id}::uuid AND status='PENDING'`;
      if (validation) await this.refreshJob(tx, job.id);
      else await tx.$executeRaw`UPDATE integration_ingestion_jobs SET status='BLOCKED',error_code=${code} WHERE id=${job.id}::uuid`;
      if (!validation) await tx.$executeRaw(Prisma.sql`UPDATE integration_ingestion_jobs parent SET status='BLOCKED',error_code=${code} WHERE ${this.parentReferencesJob(job.id)} AND parent.status='PENDING'`);
    }, { isolationLevel: 'ReadCommitted' });
  }

  private async jobRow(tx: AdminTransaction, organizationId: string, id: string): Promise<JobRow> {
    const [row] = await tx.$queryRaw<JobRow[]>`SELECT * FROM integration_ingestion_jobs WHERE organization_id=${organizationId}::uuid AND id=${id}::uuid`;
    if (!row) ingestionError('INGESTION_NOT_FOUND', 404);
    return row;
  }
  private async jobDto(tx: AdminTransaction, row: JobRow): Promise<IngestionJobDto> {
    const [counts] = await tx.$queryRaw<{ total: number; pending: number; succeeded: number; skipped: number; failed: number; awaiting: number }[]>(Prisma.sql`SELECT count(*)::int AS total,count(*) FILTER(WHERE status='PENDING')::int AS pending,count(*) FILTER(WHERE status IN ('INSERTED','UPDATED','UNCHANGED'))::int AS succeeded,count(*) FILTER(WHERE status IN ('FILTERED','EXISTING_SKIPPED','SKIPPED','CANCELLED'))::int AS skipped,count(*) FILTER(WHERE status IN ('VALIDATION_FAILED','PROCESSING_FAILED'))::int AS failed,count(*) FILTER(WHERE status='AWAITING_CONFIRMATION')::int AS awaiting FROM integration_ingestion_items i WHERE ${this.jobItemsFilter(row)}`);
    const [batch] = row.planning_preview_id ? await tx.$queryRaw<{ receipt_count: number; unexpanded: boolean }[]>`SELECT count(*)::int AS receipt_count,EXISTS(SELECT 1 FROM integration_ingestion_jobs child JOIN integration_ingestion_preview_receipts s ON s.preview_id=${row.planning_preview_id}::uuid AND s.receipt_id=child.receipt_id WHERE child.organization_id=${row.organization_id}::uuid AND child.rule_id=${row.rule_id}::uuid AND child.rule_version=${row.rule_version} AND child.generation=${row.generation} AND NOT child.expansion_complete) AS unexpanded FROM integration_ingestion_preview_receipts WHERE preview_id=${row.planning_preview_id}::uuid` : [];
    const expanded = row.expansion_complete && !batch?.unexpanded;
    return { id: row.id, endpointId: row.endpoint_id, receiptId: row.receipt_id, parentJobId: row.parent_job_id, planningPreviewId: row.planning_preview_id, ruleId: row.rule_id, ruleVersion: row.rule_version, target: row.rule_snapshot.target, source: row.source, status: row.status, sequence: Number(row.sequence), total: expanded ? counts!.total : null, expansionComplete: expanded, planned: row.planning_preview_id ? row.next_row_index : 0, receiptCount: batch?.receipt_count ?? (row.receipt_id ? 1 : 0), pending: counts!.pending, succeeded: counts!.succeeded, skipped: counts!.skipped, failed: counts!.failed, awaitingConfirmation: counts!.awaiting, errorCode: row.error_code, createdAt: row.created_at.toISOString() };
  }
  private jobItemsFilter(job: JobRow) {
    return job.planning_preview_id
      ? Prisma.sql`i.organization_id=${job.organization_id}::uuid AND i.rule_id=${job.rule_id}::uuid AND i.rule_version=${job.rule_version} AND i.generation=${job.generation} AND i.receipt_id IN (SELECT receipt_id FROM integration_ingestion_preview_receipts WHERE preview_id=${job.planning_preview_id}::uuid)`
      : Prisma.sql`i.job_id=${job.id}::uuid`;
  }
  private jobOwnersFilter(job: JobRow) {
    return Prisma.sql`owner.organization_id=${job.organization_id}::uuid AND owner.rule_id=${job.rule_id}::uuid AND owner.rule_version=${job.rule_version} AND owner.generation=${job.generation} AND (owner.id=${job.id}::uuid OR owner.parent_job_id=${job.id}::uuid OR owner.id IN (SELECT i.job_id FROM integration_ingestion_items i WHERE ${this.jobItemsFilter(job)}) OR owner.receipt_id IN (SELECT receipt_id FROM integration_ingestion_preview_receipts WHERE organization_id=${job.organization_id}::uuid AND preview_id=${job.planning_preview_id}::uuid))`;
  }
  async listJobs(actor: AdminActor, query: IngestionJobQueryDto): Promise<IngestionJobPageDto> {
    const { page, limit } = this.page(query);
    return this.prisma.$transaction(async tx => {
      const organizationId = await this.access(tx, actor), filter = Prisma.sql`organization_id=${organizationId}::uuid AND parent_job_id IS NULL ${query.endpointId ? Prisma.sql`AND endpoint_id=${query.endpointId}::uuid` : Prisma.empty} ${query.receiptId ? Prisma.sql`AND (receipt_id=${query.receiptId}::uuid OR planning_preview_id IN (SELECT preview_id FROM integration_ingestion_preview_receipts WHERE receipt_id=${query.receiptId}::uuid))` : Prisma.empty}`;
      const rows = await tx.$queryRaw<JobRow[]>(Prisma.sql`SELECT * FROM integration_ingestion_jobs WHERE ${filter} ORDER BY created_at DESC,id LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
      const [count] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT count(*)::int AS total FROM integration_ingestion_jobs WHERE ${filter}`);
      const items = [];
      for (const row of rows) items.push(await this.jobDto(tx, row));
      return { items, total: count!.total, page, limit };
    }, { isolationLevel: 'RepeatableRead' });
  }
  async getJob(actor: AdminActor, id: string): Promise<IngestionJobDto> {
    return this.prisma.$transaction(async tx => { const organizationId = await this.access(tx, actor); return this.jobDto(tx, await this.jobRow(tx, organizationId, id)); });
  }
  async listItems(actor: AdminActor, jobId: string, query: IntegrationPageQueryDto): Promise<IngestionItemPageDto> {
    const { page, limit } = this.page(query);
    return this.prisma.$transaction(async tx => {
      const organizationId = await this.access(tx, actor), job = await this.jobRow(tx, organizationId, jobId);
      const rows = await tx.$queryRaw<ItemRow[]>(Prisma.sql`SELECT i.* FROM integration_ingestion_items i JOIN integration_ingestion_jobs j ON j.id=i.job_id WHERE ${this.jobItemsFilter(job)} ORDER BY j.sequence,i.row_index LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
      const [count] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT count(*)::int AS total FROM integration_ingestion_items i WHERE ${this.jobItemsFilter(job)}`);
      return { items: rows.map(itemDto), total: count!.total, page, limit };
    }, { isolationLevel: 'RepeatableRead' });
  }
  private async itemRow(tx: AdminTransaction, organizationId: string, id: string): Promise<ItemRow> {
    const [row] = await tx.$queryRaw<ItemRow[]>`SELECT * FROM integration_ingestion_items WHERE organization_id=${organizationId}::uuid AND id=${id}::uuid`;
    if (!row) ingestionError('INGESTION_NOT_FOUND', 404);
    return row;
  }
  private async stale(tx: AdminTransaction, job: JobRow, item: ItemRow, receipt: ReceiptRow, evaluation: Evaluation): Promise<boolean> {
    if ((evaluation.current?.id ?? null) !== item.target_id || (evaluation.current?.version ?? null) !== item.target_version) return true;
    if (!evaluation.current) return false;
    const receivedAt = item.source_received_at ?? receipt.received_at;
    const [newer] = await tx.$queryRaw<{ id: string }[]>`SELECT i.id FROM integration_ingestion_items i JOIN integration_ingestion_jobs j ON j.id=i.job_id JOIN integration_receipts r ON r.id=i.receipt_id WHERE i.organization_id=${job.organization_id}::uuid AND i.target_id=${evaluation.current.id}::uuid AND j.rule_snapshot->>'target'=${job.rule_snapshot.target} AND i.status IN ('INSERTED','UPDATED','UNCHANGED') AND (r.received_at>${receivedAt} OR (r.received_at=${receivedAt} AND i.receipt_id=${item.receipt_id}::uuid AND i.row_index>${item.row_index}) OR (r.received_at=${receivedAt} AND r.received_at=${receipt.received_at} AND j.endpoint_id=${job.endpoint_id}::uuid AND j.sequence>${job.sequence})) LIMIT 1`;
    if (newer) return true;
    const [latest] = await tx.$queryRaw<{ receipt_received_at: Date; source_updated_at: Date | null }[]>`SELECT receipt_received_at,source_updated_at FROM integration_ingestion_target_versions WHERE organization_id=${job.organization_id}::uuid AND target=${job.rule_snapshot.target} AND target_id=${evaluation.current.id}::uuid`;
    return !!latest && (latest.receipt_received_at > receivedAt || !!item.source_updated_at && !!latest.source_updated_at && item.source_updated_at <= latest.source_updated_at);
  }
  async getItem(actor: AdminActor, id: string, traceId: string): Promise<IngestionItemDetailDto> {
    return this.prisma.$transaction(async tx => {
      const organizationId = await this.access(tx, actor, 'ingestion:read', true), item = await this.itemRow(tx, organizationId, id), job = await this.jobRow(tx, organizationId, item.job_id);
      await this.access(tx, actor, 'ingestion:read', true, job.rule_snapshot.target);
      const receipt = await this.receipt(tx, organizationId, item.receipt_id, job.endpoint_id, true), rows = this.payload(receipt);
      const evaluation = await this.evaluate(tx, actor, job.rule_snapshot, rows[item.row_index], receipt, job.source);
      await this.event(tx, actor, organizationId, 'INGESTION_DIFFERENCE_READ', item.id, traceId, { jobId: job.id, receiptId: receipt.id, rowIndex: item.row_index });
      return { ...itemDto(item), differences: evaluation.differences, ...(evaluation.fields ? { fields: evaluation.fields } : {}), stale: await this.stale(tx, job, item, receipt, evaluation) };
    }, { isolationLevel: 'RepeatableRead' });
  }
  async controlJob(actor: AdminActor, id: string, input: IngestionControlDto, traceId: string, key?: string): Promise<IngestionJobDto> {
    const organizationId = integrationScope(actor);
    if (!input.reason?.trim() || input.reason.length > 300) ingestionError('INGESTION_RULE_INVALID');
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'INGESTION_JOB_CONTROLLED', payload: { id, ...input }, permission: 'ingestion:run', isolationLevel: 'ReadCommitted' }, async tx => {
      const initial = await this.jobRow(tx, organizationId, id);
      await lockIntegrationEndpoint(tx, organizationId, initial.endpoint_id, true);
      const job = await this.jobRow(tx, organizationId, id);
      await this.access(tx, actor, 'ingestion:run', false, job.rule_snapshot.target);
      let affectedOwnerIds: string[] = [];
      if (input.action === 'CANCEL') {
        const cancelled = await tx.$queryRaw<{ job_id: string }[]>(Prisma.sql`UPDATE integration_ingestion_items i SET status='CANCELLED',version=version+1,updated_at=clock_timestamp() WHERE ${this.jobItemsFilter(job)} AND i.status IN ('PENDING','PROCESSING_FAILED','AWAITING_CONFIRMATION','VALIDATION_FAILED') RETURNING i.job_id`);
        await tx.$executeRaw`UPDATE integration_ingestion_jobs SET status='CANCELLED',error_code=NULL,completed_at=clock_timestamp() WHERE id=${id}::uuid`;
        const owners = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`UPDATE integration_ingestion_jobs owner SET status='CANCELLED',error_code=NULL,completed_at=clock_timestamp() WHERE ${this.jobOwnersFilter(job)} AND owner.status NOT IN ('COMPLETED','CANCELLED') RETURNING owner.id`);
        affectedOwnerIds = [...new Set([id, ...cancelled.map(row => row.job_id), ...owners.map(owner => owner.id)])];
      } else if (input.action === 'PAUSE') {
        if (job.status === 'PENDING') await tx.$executeRaw`UPDATE integration_ingestion_jobs SET status='PAUSED' WHERE id=${id}::uuid`;
      } else {
        if (job.status === 'CANCELLED') ingestionError('CONCURRENCY_CONFLICT', 409);
        if (input.action === 'RETRY') {
          if (job.receipt_id) await this.receipt(tx, organizationId, job.receipt_id, job.endpoint_id, true);
          await tx.$executeRaw`UPDATE integration_ingestion_jobs SET rule_snapshot=jsonb_set(rule_snapshot,'{authorizedBy}',${JSON.stringify(actorSnapshot(actor, organizationId))}::jsonb) WHERE id=${id}::uuid`;
          const owners = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`UPDATE integration_ingestion_jobs owner SET status=CASE WHEN owner.id=${id}::uuid THEN 'PENDING' WHEN owner.status='PAUSED' THEN 'PAUSED' ELSE 'PENDING' END,error_code=NULL,completed_at=NULL,rule_snapshot=jsonb_set(rule_snapshot,'{authorizedBy}',${JSON.stringify(actorSnapshot(actor, organizationId))}::jsonb) WHERE ${this.jobOwnersFilter(job)} AND owner.status<>'CANCELLED' AND (owner.status IN ('PENDING','BLOCKED','PAUSED') OR EXISTS(SELECT 1 FROM integration_ingestion_items i WHERE i.job_id=owner.id AND ${this.jobItemsFilter(job)} AND i.status IN ('PROCESSING_FAILED','VALIDATION_FAILED'))) RETURNING owner.id`);
          affectedOwnerIds = owners.map(owner => owner.id);
          await tx.$executeRaw(Prisma.sql`UPDATE integration_ingestion_items i SET status='PENDING',error_code=NULL,error_field=NULL,version=version+1,updated_at=clock_timestamp() WHERE ${this.jobItemsFilter(job)} AND i.status IN ('PROCESSING_FAILED','VALIDATION_FAILED') AND EXISTS(SELECT 1 FROM integration_ingestion_jobs owner WHERE owner.id=i.job_id AND owner.status<>'CANCELLED')`);
        } else if (job.status === 'BLOCKED') ingestionError('INGESTION_QUEUE_BLOCKED', 409);
        await tx.$executeRaw`UPDATE integration_ingestion_jobs SET status='PENDING',error_code=NULL,completed_at=NULL WHERE id=${id}::uuid`;
      }
      await this.releaseResolvedParents(tx, organizationId, affectedOwnerIds, ['INGESTION_PROCESSING_FAILED','INGESTION_AUTHORIZATION_REVOKED']);
      await this.refreshJob(tx, id);
      await this.event(tx, actor, organizationId, 'INGESTION_JOB_CONTROLLED', id, traceId, { action: input.action, ingestionReason: input.reason.trim() });
      return this.jobDto(tx, await this.jobRow(tx, organizationId, id));
    });
  }
  async actOnItem(actor: AdminActor, id: string, input: IngestionItemActionDto, confirm: boolean, traceId: string, key?: string): Promise<IngestionItemDto> {
    const organizationId = integrationScope(actor);
    if (!input.reason?.trim() || input.reason.length > 300) ingestionError('INGESTION_RULE_INVALID');
    return this.mutations.run({ actor, organizationId, key, traceId, action: confirm ? 'INGESTION_ITEM_CONFIRMED' : 'INGESTION_ITEM_SKIPPED', payload: { id, ...input }, permission: 'ingestion:run', isolationLevel: 'ReadCommitted' }, async tx => {
      const initial = await this.itemRow(tx, organizationId, id), job = await this.jobRow(tx, organizationId, initial.job_id);
      const endpoint = await lockIntegrationEndpoint(tx, organizationId, job.endpoint_id, true);
      await tx.$queryRaw`SELECT id FROM integration_ingestion_jobs WHERE id=${job.id}::uuid FOR UPDATE`;
      const item = await this.itemRow(tx, organizationId, id);
      if (item.version !== input.expectedVersion || !['PENDING', 'AWAITING_CONFIRMATION', 'VALIDATION_FAILED', 'PROCESSING_FAILED'].includes(item.status)) ingestionError('CONCURRENCY_CONFLICT', 409);
      await this.access(tx, actor, 'ingestion:run', confirm, job.rule_snapshot.target);
      if (confirm) {
        if (endpoint.status !== 'ENABLED' || endpoint.deletedAt) ingestionError('INTEGRATION_ACCESS_DENIED', 403);
        if (item.status !== 'AWAITING_CONFIRMATION') ingestionError('CONCURRENCY_CONFLICT', 409);
        await this.access(tx, job.rule_snapshot.authorizedBy ?? job.actor_snapshot, 'ingestion:run', false, job.rule_snapshot.target);
        if (!job.rule_snapshot.authorizedBy && job.rule_snapshot.configuredBy) await this.access(tx, job.rule_snapshot.configuredBy, 'ingestion:run', false, job.rule_snapshot.target);
        const receipt = await this.receipt(tx, organizationId, item.receipt_id, job.endpoint_id, true), rows = this.payload(receipt);
        const evaluation = await this.evaluate(tx, actor, job.rule_snapshot, rows[item.row_index], receipt, job.source);
        if (await this.stale(tx, job, item, receipt, evaluation)) ingestionError('INGESTION_STALE_CONFIRMATION', 409);
        if (!evaluation.fields || !evaluation.current || !['AWAITING_CONFIRMATION', 'UPDATED', 'UNCHANGED'].includes(evaluation.action)) ingestionError('CONCURRENCY_CONFLICT', 409);
        evaluation.action = evaluation.differences.length ? 'UPDATED' : 'UNCHANGED';
        await this.applyEvaluation(tx, job, item, receipt, evaluation, actor, traceId);
      } else {
        await tx.$executeRaw`UPDATE integration_ingestion_items SET status='SKIPPED',error_code=NULL,error_field=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=${id}::uuid`;
        if (job.status === 'BLOCKED' && item.status === 'PROCESSING_FAILED' && job.error_code === 'INGESTION_PROCESSING_FAILED') {
          await tx.$executeRaw`UPDATE integration_ingestion_jobs SET status='PENDING',error_code=NULL WHERE id=${job.id}::uuid AND status='BLOCKED' AND error_code='INGESTION_PROCESSING_FAILED' AND NOT EXISTS(SELECT 1 FROM integration_ingestion_items WHERE job_id=${job.id}::uuid AND status='PROCESSING_FAILED')`;
        }
      }
      await this.refreshJob(tx, job.id);
      if (!confirm && item.status === 'PROCESSING_FAILED' && job.error_code === 'INGESTION_PROCESSING_FAILED') {
        await this.releaseResolvedParents(tx, organizationId, [job.id], ['INGESTION_PROCESSING_FAILED']);
      }
      await this.event(tx, actor, organizationId, confirm ? 'INGESTION_ITEM_CONFIRMED' : 'INGESTION_ITEM_SKIPPED', id, traceId, { ingestionReason: input.reason.trim(), jobId: job.id });
      return itemDto(await this.itemRow(tx, organizationId, id));
    });
  }
}
