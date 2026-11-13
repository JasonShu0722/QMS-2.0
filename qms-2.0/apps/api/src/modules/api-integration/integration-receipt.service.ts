import { HttpException, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertRecentAuthentication } from '../../common/security/session-security.js';
import { decryptSecret } from '../../common/security/security-keyring.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { readOrganizationRuntime } from '../organization/organization-runtime.read-model.js';
import { assertIntegrationOrganization, integrationError, integrationInteger, integrationScope, lockIntegrationEndpoint } from './integration-types.js';
import type { DeleteIntegrationReceiptsDto, IntegrationAttemptDto, IntegrationAttemptPageDto, IntegrationOperationDto, IntegrationPayloadDto, IntegrationReceiptDeleteResultDto, IntegrationReceiptDto, IntegrationReceiptEndpointDto, IntegrationReceiptEndpointPageDto, IntegrationReceiptEndpointQueryDto, IntegrationReceiptPageDto, IntegrationReceiptQueryDto, UpdateIntegrationCapacityDto } from './integration-receipt.dto.js';

type ReceiptRow = Omit<IntegrationReceiptDto, 'receivedAt' | 'bodyExpiresAt' | 'metadataExpiresAt'> & { receivedAt: Date; bodyExpiresAt: Date; metadataExpiresAt: Date };
type AttemptRow = Omit<IntegrationAttemptDto, 'observedAt'> & { observedAt: Date };
export type IntegrationAttemptInput = Omit<IntegrationAttemptDto, 'id' | 'observedAt' | 'endpointName' | 'endpointCode'>;
type DeleteReceiptRow = { id: string; endpoint_id: string; released_bytes: number; metadata_expires_at: Date; now: Date };
const receiptProjection = Prisma.sql`r.id,r.organization_id AS "organizationId",r.endpoint_id AS "endpointId",e.name AS "endpointName",e.code AS "endpointCode",r.credential_id AS "credentialId",r.message_id AS "messageId",e.source_code AS "sourceCode",e.source_name AS "sourceName",r.configuration_version AS "configurationVersion",r.received_at AS "receivedAt",r.body_expires_at AS "bodyExpiresAt",r.metadata_expires_at AS "metadataExpiresAt",(r.payload_ciphertext IS NOT NULL AND r.body_expires_at>clock_timestamp()) AS "bodyAvailable",r.payload_bytes AS "payloadBytes"`;
const receiptDto = (row: ReceiptRow): IntegrationReceiptDto => ({ ...row, receivedAt: row.receivedAt.toISOString(), bodyExpiresAt: row.bodyExpiresAt.toISOString(), metadataExpiresAt: row.metadataExpiresAt.toISOString() });
const attemptDto = (row: AttemptRow): IntegrationAttemptDto => ({ ...row, observedAt: row.observedAt.toISOString() });

@Injectable()
export class IntegrationReceiptService {
  private readonly unavailable = new Set<string>();
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService, private readonly mutations: AdminMutationService) {}

  collectionStatus(organizationId: string): 'UNKNOWN' | 'UNAVAILABLE' { return this.unavailable.has(organizationId) ? 'UNAVAILABLE' : 'UNKNOWN'; }
  collectionFailed(organizationId: string): void { if (this.unavailable.size < 256) this.unavailable.add(organizationId); }

  private async authorize(tx: AdminTransaction, actor: AdminActor, payload = false): Promise<string> {
    const organizationId = integrationScope(actor);
    await assertAdminAccess(tx, actor, organizationId, payload ? ['integration:receipts:read', 'integration:payload:read'] : 'integration:receipts:read');
    await assertIntegrationOrganization(tx, organizationId);
    return organizationId;
  }

  private async range(tx: AdminTransaction, query: IntegrationReceiptQueryDto, days: number) {
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const now = clock!.now;
    const to = query.to ? new Date(query.to) : now;
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - days * 86400000);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to || to.getTime() - from.getTime() > 90 * 86400000 || to.getTime() > now.getTime() + 60000) integrationError('INTEGRATION_INPUT_INVALID', 400);
    return { from, to, now, page: integrationInteger(query.page ?? 1, 1, 10000), limit: integrationInteger(query.limit ?? 20, 1, 1000) };
  }

  async listReceiptEndpoints(actor: AdminActor, query: IntegrationReceiptEndpointQueryDto): Promise<IntegrationReceiptEndpointPageDto> {
    const page = integrationInteger(query.page ?? 1, 1, 10000), limit = integrationInteger(query.limit ?? 20, 1, 100);
    const search = query.search?.trim() ?? '';
    if (search.length > 120) integrationError('INTEGRATION_INPUT_INVALID', 400);
    return this.prisma.$transaction(async tx => {
      const organizationId = await this.authorize(tx, actor);
      const where = Prisma.sql`organization_id=${organizationId}::uuid AND (${search}='' OR strpos(lower(name),lower(${search}))>0 OR strpos(lower(code),lower(${search}))>0)`;
      const items = await tx.$queryRaw<IntegrationReceiptEndpointDto[]>(Prisma.sql`SELECT id,name,code FROM integration_endpoints WHERE ${where} ORDER BY name,code,id LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
      const [count] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT count(*)::int AS total FROM integration_endpoints WHERE ${where}`);
      return { items, total: count!.total, page, limit };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async deleteReceipts(actor: AdminActor, input: DeleteIntegrationReceiptsDto, traceId: string, key?: string): Promise<IntegrationReceiptDeleteResultDto> {
    const organizationId = integrationScope(actor);
    if (!Array.isArray(input.receiptIds) || input.receiptIds.length < 1 || input.receiptIds.length > 1000 || input.receiptIds.some(id => typeof id !== 'string' || !isUUID(id))) integrationError('INTEGRATION_INPUT_INVALID', 400);
    const receiptIds = input.receiptIds.map(id => id.toLowerCase()).sort();
    if (new Set(receiptIds).size !== receiptIds.length) integrationError('INTEGRATION_INPUT_INVALID', 400);
    let rows: DeleteReceiptRow[] = [];
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'INTEGRATION_RECEIPTS_DELETED', payload: { receiptIds }, permission: 'integration:manage', isolationLevel: 'ReadCommitted' }, async tx => {
      const [protectedInput] = await tx.$queryRaw<{ count: number }[]>(Prisma.sql`SELECT count(*)::int AS count FROM integration_ingestion_jobs j WHERE j.organization_id=${organizationId}::uuid AND j.receipt_id IN (${Prisma.join(receiptIds.map(id => Prisma.sql`${id}::uuid`))}) AND EXISTS(SELECT 1 FROM integration_ingestion_items i WHERE i.job_id=j.id AND i.status IN ('PENDING','AWAITING_CONFIRMATION','PROCESSING_FAILED'))`);
      if (protectedInput!.count) integrationError('INGESTION_INPUT_PROTECTED', 409);
      if (rows.length !== receiptIds.length || rows.some(row => row.metadata_expires_at <= row.now)) integrationError('INTEGRATION_RECEIPT_NOT_FOUND', 404);
      const released = new Map<string, bigint>();
      for (const row of rows) released.set(row.endpoint_id, (released.get(row.endpoint_id) ?? 0n) + BigInt(row.released_bytes));
      let total = 0n;
      for (const [endpointId, bytes] of released) {
        total += bytes;
        const changed = await tx.$executeRaw`UPDATE integration_endpoints SET used_body_bytes=used_body_bytes-${bytes} WHERE organization_id=${organizationId}::uuid AND id=${endpointId}::uuid AND used_body_bytes>=${bytes}`;
        if (changed !== 1) integrationError('INTEGRATION_CONFIGURATION_UNAVAILABLE', 503);
      }
      const capacity = await tx.$executeRaw`UPDATE integration_scope_capacities SET used_body_bytes=used_body_bytes-${total},receipt_count=receipt_count-${rows.length} WHERE organization_id=${organizationId}::uuid AND used_body_bytes>=${total} AND receipt_count>=${rows.length}`;
      if (capacity !== 1) integrationError('INTEGRATION_CONFIGURATION_UNAVAILABLE', 503);
      await tx.$executeRaw(Prisma.sql`DELETE FROM integration_receipts WHERE organization_id=${organizationId}::uuid AND id IN (${Prisma.join(receiptIds.map(id => Prisma.sql`${id}::uuid`))})`);
      for (const row of rows) await this.audit.record({ actorUserId: actor.id, organizationId, action: 'INTEGRATION_RECEIPTS_DELETED', resourceType: 'IntegrationReceipt', resourceId: row.id, outcome: 'SUCCESS', traceId, metadata: { endpointId: row.endpoint_id, receiptId: row.id } }, tx);
      return { deletedCount: rows.length, receiptIds: rows.map(row => row.id) };
    }, async tx => {
      await assertIntegrationOrganization(tx, organizationId, true);
      const identities = await tx.$queryRaw<{ endpoint_id: string }[]>(Prisma.sql`SELECT DISTINCT endpoint_id FROM integration_receipts WHERE organization_id=${organizationId}::uuid AND id IN (${Prisma.join(receiptIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY endpoint_id`);
      for (const identity of identities) await tx.$queryRaw`SELECT id FROM integration_endpoints WHERE organization_id=${organizationId}::uuid AND id=${identity.endpoint_id}::uuid FOR UPDATE`;
      rows = await tx.$queryRaw<DeleteReceiptRow[]>(Prisma.sql`SELECT id,endpoint_id,CASE WHEN payload_ciphertext IS NULL THEN 0 ELSE payload_bytes END AS released_bytes,metadata_expires_at,clock_timestamp() AS now FROM integration_receipts WHERE organization_id=${organizationId}::uuid AND id IN (${Prisma.join(receiptIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
      await tx.$queryRaw`SELECT organization_id FROM integration_scope_capacities WHERE organization_id=${organizationId}::uuid FOR UPDATE`;
      await assertRecentAuthentication(tx, actor);
      await assertAdminAccess(tx, actor, organizationId, 'integration:manage');
    });
  }

  async listReceipts(actor: AdminActor, query: IntegrationReceiptQueryDto): Promise<IntegrationReceiptPageDto> {
    return this.prisma.$transaction(async tx => {
      const organizationId = await this.authorize(tx, actor), range = await this.range(tx, query, 7);
      const conditions = [Prisma.sql`r.organization_id=${organizationId}::uuid`, Prisma.sql`r.received_at>=${range.from} AND r.received_at<=${range.to} AND r.metadata_expires_at>${range.now}`];
      if (query.endpointId) conditions.push(Prisma.sql`r.endpoint_id=${query.endpointId}::uuid`);
      if (query.sourceCode) conditions.push(Prisma.sql`EXISTS(SELECT 1 FROM integration_endpoints endpoint WHERE endpoint.organization_id=r.organization_id AND endpoint.id=r.endpoint_id AND endpoint.source_code=${query.sourceCode})`);
      if (query.messageId) conditions.push(Prisma.sql`r.message_id=${query.messageId}`);
      if (query.receiptId) conditions.push(Prisma.sql`r.id=${query.receiptId}::uuid`);
      if (query.traceId) conditions.push(Prisma.sql`EXISTS(SELECT 1 FROM integration_request_attempts a WHERE a.organization_id=r.organization_id AND a.receipt_id=r.id AND a.id=${query.traceId}::uuid)`);
      if (query.outcome) integrationError('INTEGRATION_INPUT_INVALID', 400);
      const where = Prisma.join(conditions, ' AND ');
      const rows = await tx.$queryRaw<ReceiptRow[]>(Prisma.sql`SELECT ${receiptProjection} FROM integration_receipts r JOIN integration_endpoints e ON e.id=r.endpoint_id AND e.organization_id=r.organization_id WHERE ${where} ORDER BY r.received_at DESC,r.id DESC LIMIT ${range.limit} OFFSET ${(range.page - 1) * range.limit}`);
      const [count] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT count(*)::int AS total FROM integration_receipts r WHERE ${where}`);
      return { items: rows.map(receiptDto), total: count!.total, page: range.page, limit: range.limit, from: range.from.toISOString(), to: range.to.toISOString() };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async receipt(actor: AdminActor, id: string): Promise<IntegrationReceiptDto> {
    return this.prisma.$transaction(async tx => {
      const organizationId = await this.authorize(tx, actor);
      const [row] = await tx.$queryRaw<ReceiptRow[]>(Prisma.sql`SELECT ${receiptProjection} FROM integration_receipts r JOIN integration_endpoints e ON e.id=r.endpoint_id AND e.organization_id=r.organization_id WHERE r.organization_id=${organizationId}::uuid AND r.id=${id}::uuid AND r.metadata_expires_at>clock_timestamp()`);
      if (!row) integrationError('INTEGRATION_RECEIPT_NOT_FOUND', 404);
      return receiptDto(row);
    });
  }

  async payload(actor: AdminActor, id: string, traceId: string): Promise<IntegrationPayloadDto> {
    return this.prisma.$transaction(async tx => {
      const organizationId = await this.authorize(tx, actor, true);
      const [identity] = await tx.$queryRaw<{ endpoint_id: string }[]>`SELECT endpoint_id FROM integration_receipts WHERE organization_id=${organizationId}::uuid AND id=${id}::uuid`;
      if (!identity) integrationError('INTEGRATION_RECEIPT_NOT_FOUND', 404);
      await lockIntegrationEndpoint(tx, organizationId, identity.endpoint_id, true);
      await this.authorize(tx, actor, true);
      const [row] = await tx.$queryRaw<{ id: string; organization_id: string; endpoint_id: string; payload_ciphertext: string | null; body_expires_at: Date; metadata_expires_at: Date; now: Date }[]>`SELECT id,organization_id,endpoint_id,payload_ciphertext,body_expires_at,metadata_expires_at,clock_timestamp() AS now FROM integration_receipts WHERE organization_id=${organizationId}::uuid AND id=${id}::uuid FOR UPDATE`;
      if (!row || row.metadata_expires_at <= row.now) integrationError('INTEGRATION_RECEIPT_NOT_FOUND', 404);
      if (!row.payload_ciphertext || row.body_expires_at <= row.now) integrationError('INTEGRATION_PAYLOAD_EXPIRED', 410);
      const text = decryptSecret(row.payload_ciphertext, `integration:${row.organization_id}:${row.endpoint_id}:${row.id}`);
      await this.audit.record({ actorUserId: actor.id, organizationId: row.organization_id, action: 'INTEGRATION_PAYLOAD_READ', resourceType: 'IntegrationReceipt', resourceId: row.id, outcome: 'SUCCESS', traceId, metadata: { endpointId: row.endpoint_id, receiptId: row.id } }, tx);
      return { id: row.id, text, bodyExpiresAt: row.body_expires_at.toISOString() };
    }, { isolationLevel: 'ReadCommitted' });
  }

  async listAttempts(actor: AdminActor, query: IntegrationReceiptQueryDto): Promise<IntegrationAttemptPageDto> {
    return this.prisma.$transaction(async tx => {
      const organizationId = await this.authorize(tx, actor), range = await this.range(tx, query, 7);
      const conditions = [Prisma.sql`a.organization_id=${organizationId}::uuid`, Prisma.sql`a.observed_at>=${range.from} AND a.observed_at<=${range.to} AND a.observed_at>${range.now}::timestamptz - INTERVAL '7 days'`];
      if (query.endpointId) conditions.push(Prisma.sql`a.endpoint_id=${query.endpointId}::uuid`);
      if (query.sourceCode) conditions.push(Prisma.sql`e.source_code=${query.sourceCode}`);
      if (query.messageId) conditions.push(Prisma.sql`a.message_id=${query.messageId}`);
      if (query.receiptId) conditions.push(Prisma.sql`a.receipt_id=${query.receiptId}::uuid`);
      if (query.traceId) conditions.push(Prisma.sql`a.id=${query.traceId}::uuid`);
      if (query.outcome) conditions.push(Prisma.sql`a.outcome=${query.outcome}`);
      const where = Prisma.join(conditions, ' AND ');
      const rows = await tx.$queryRaw<AttemptRow[]>(Prisma.sql`SELECT a.id,a.id AS "traceId",a.organization_id AS "organizationId",a.endpoint_id AS "endpointId",e.name AS "endpointName",e.code AS "endpointCode",a.credential_id AS "credentialId",a.message_id AS "messageId",a.receipt_id AS "receiptId",a.configuration_version AS "configurationVersion",a.return_receipt AS "returnReceipt",a.status_code AS "statusCode",a.outcome,a.reason_code AS "reasonCode",a.duration_ms AS "durationMs",a.observed_at AS "observedAt" FROM integration_request_attempts a JOIN integration_endpoints e ON e.id=a.endpoint_id AND e.organization_id=a.organization_id WHERE ${where} ORDER BY a.observed_at DESC,a.id DESC LIMIT ${range.limit} OFFSET ${(range.page-1)*range.limit}`);
      const [count] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT count(*)::int AS total FROM integration_request_attempts a JOIN integration_endpoints e ON e.id=a.endpoint_id AND e.organization_id=a.organization_id WHERE ${where}`);
      return { items: rows.map(row => attemptDto({ ...row, ...(row.messageId === null ? { messageId: undefined } : {}), ...(row.receiptId === null ? { receiptId: undefined } : {}), ...(row.reasonCode === null ? { reasonCode: undefined } : {}) })), total: count!.total, page: range.page, limit: range.limit, from: range.from.toISOString(), to: range.to.toISOString(), collectionStatus: this.collectionStatus(organizationId) };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async operations(actor: AdminActor): Promise<IntegrationOperationDto> {
    return this.prisma.$transaction(async tx => {
      const organizationId = await this.authorize(tx, actor);
      const [row] = await tx.$queryRaw<{ used_body_bytes: bigint; capacity_bytes: bigint; receipt_count: number; last_cleanup_succeeded_at: Date | null; last_cleanup_failed_at: Date | null }[]>`SELECT used_body_bytes,capacity_bytes,receipt_count,last_cleanup_succeeded_at,last_cleanup_failed_at FROM integration_scope_capacities WHERE organization_id=${organizationId}::uuid`;
      return { usedBodyBytes: Number(row?.used_body_bytes ?? 0), capacityBytes: Number(row?.capacity_bytes ?? 1073741824), receiptCount: row?.receipt_count ?? 0, receiptLimit: 100000, requestCollection: this.collectionStatus(organizationId), ...(row?.last_cleanup_succeeded_at ? { lastCleanupSucceededAt: row.last_cleanup_succeeded_at.toISOString() } : {}), ...(row?.last_cleanup_failed_at ? { lastCleanupFailedAt: row.last_cleanup_failed_at.toISOString() } : {}) };
    });
  }

  async updateCapacity(actor: AdminActor, input: UpdateIntegrationCapacityDto, traceId: string, key?: string): Promise<IntegrationOperationDto> {
    const organizationId = integrationScope(actor), capacityBytes = integrationInteger(input.capacityBytes, 16777216, 10737418240);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'INTEGRATION_SCOPE_CAPACITY_UPDATED', payload: { organizationId, capacityBytes }, permission: 'integration:manage', isolationLevel: 'ReadCommitted' }, async tx => {
      await tx.$executeRaw`INSERT INTO integration_scope_capacities(organization_id) VALUES(${organizationId}::uuid) ON CONFLICT DO NOTHING`;
      const [current] = await tx.$queryRaw<{ used_body_bytes: bigint; capacity_bytes: bigint }[]>`SELECT used_body_bytes,capacity_bytes FROM integration_scope_capacities WHERE organization_id=${organizationId}::uuid FOR UPDATE`;
      if (capacityBytes < Number(current?.used_body_bytes ?? 0)) integrationError('INTEGRATION_CAPACITY_CONFLICT', 409);
      await tx.$executeRaw`UPDATE integration_scope_capacities SET capacity_bytes=${capacityBytes} WHERE organization_id=${organizationId}::uuid`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'INTEGRATION_SCOPE_CAPACITY_UPDATED', resourceType: 'IntegrationScopeCapacity', resourceId: organizationId, outcome: 'SUCCESS', traceId, metadata: { capacityBytes, previousCapacityBytes: Number(current?.capacity_bytes ?? 1073741824) } }, tx);
      const [row] = await tx.$queryRaw<{ used_body_bytes: bigint; capacity_bytes: bigint; receipt_count: number; last_cleanup_succeeded_at: Date | null; last_cleanup_failed_at: Date | null }[]>`SELECT used_body_bytes,capacity_bytes,receipt_count,last_cleanup_succeeded_at,last_cleanup_failed_at FROM integration_scope_capacities WHERE organization_id=${organizationId}::uuid`;
      return { usedBodyBytes: Number(row!.used_body_bytes), capacityBytes: Number(row!.capacity_bytes), receiptCount: row!.receipt_count, receiptLimit: 100000, requestCollection: this.collectionStatus(organizationId), ...(row!.last_cleanup_succeeded_at ? { lastCleanupSucceededAt: row!.last_cleanup_succeeded_at.toISOString() } : {}), ...(row!.last_cleanup_failed_at ? { lastCleanupFailedAt: row!.last_cleanup_failed_at.toISOString() } : {}) };
    }, async tx => { await assertIntegrationOrganization(tx, organizationId, true); await assertRecentAuthentication(tx, actor); await assertAdminAccess(tx, actor, organizationId, 'integration:manage'); });
  }

  async recordAttempt(input: IntegrationAttemptInput): Promise<void> {
    if (![input.traceId,input.organizationId,input.endpointId,input.credentialId].every(value => isUUID(value)) || input.receiptId !== undefined && !isUUID(input.receiptId) || input.messageId !== undefined && !/^[A-Za-z0-9._:-]{8,128}$/.test(input.messageId) || !['RECEIVED','DUPLICATE','REJECTED','FAILED','UNKNOWN'].includes(input.outcome) || !Number.isSafeInteger(input.durationMs) || input.durationMs<0 || input.durationMs>86400000 || !Number.isInteger(input.statusCode) || input.statusCode<100 || input.statusCode>599 || !Number.isInteger(input.configurationVersion) || input.configurationVersion<1) throw new HttpException('Invalid internal request result',400);
    await this.prisma.$transaction(async tx => {
      await readOrganizationRuntime(tx, input.organizationId, true);
      const [owner] = await tx.$queryRaw<{ id: string }[]>`SELECT e.id FROM integration_endpoints e JOIN integration_credentials c ON c.endpoint_id=e.id AND c.organization_id=e.organization_id WHERE e.organization_id=${input.organizationId}::uuid AND e.id=${input.endpointId}::uuid AND c.id=${input.credentialId}::uuid FOR UPDATE OF e`;
      if (!owner) throw new HttpException('Invalid request result scope',403);
      await tx.$executeRaw`DELETE FROM integration_request_attempts WHERE id IN (SELECT id FROM integration_request_attempts WHERE organization_id=${input.organizationId}::uuid AND observed_at<=clock_timestamp()-INTERVAL '7 days' ORDER BY observed_at,id LIMIT 100)`;
      const [count] = await tx.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM integration_request_attempts WHERE organization_id=${input.organizationId}::uuid`;
      if (count!.count>=10000) await tx.$executeRaw`DELETE FROM integration_request_attempts WHERE id IN (SELECT id FROM integration_request_attempts WHERE organization_id=${input.organizationId}::uuid ORDER BY observed_at,id LIMIT 100)`;
      await tx.$executeRaw`INSERT INTO integration_request_attempts(id,organization_id,endpoint_id,credential_id,message_id,receipt_id,configuration_version,return_receipt,status_code,outcome,reason_code,duration_ms)
        VALUES(${input.traceId}::uuid,${input.organizationId}::uuid,${input.endpointId}::uuid,${input.credentialId}::uuid,${input.messageId ?? null},${input.receiptId ?? null}::uuid,${input.configurationVersion},${input.returnReceipt},${input.statusCode},${input.outcome},${input.reasonCode ?? null},${input.durationMs}) ON CONFLICT(id) DO NOTHING`;
    }, { isolationLevel: 'ReadCommitted' });
  }
}
