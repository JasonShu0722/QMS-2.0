import { HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';

export interface ProcessProductionInput {
  batchCode: string;
  workOrderCode: string;
  operationCode: string;
  productCode: string;
  lineCode?: string;
  periodStart: Date;
  periodEnd: Date;
  totalQuantity: number;
  goodQuantity: number;
  firstPassQuantity: number;
}

interface ProductionRow {
  id: string;
  organization_id: string;
  batch_code: string;
  work_order_code: string;
  operation_code: string;
  product_code: string;
  line_code: string | null;
  period_start: Date;
  period_end: Date;
  total_quantity: number;
  good_quantity: number;
  first_pass_quantity: number;
  source_kind: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface ProcessProductionReportSnapshot {
  batchCount: number;
  totalQuantity: number;
  goodQuantity: number;
  firstPassQuantity: number;
  yieldRate: number | null;
  firstPassRate: number | null;
  defectQuantity: number;
  batches: Array<ReturnType<typeof mapRow> & { defectQuantity: number }>;
}

function reject(code: string, status: number): never {
  throw new HttpException({ code, message: code }, status);
}

function required(value: string, maximum: number): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > maximum) reject('PROCESS_PRODUCTION_INPUT_INVALID', 400);
  return trimmed;
}

function validQuantities(totalQuantity: number, goodQuantity: number, firstPassQuantity: number) {
  if (![totalQuantity, goodQuantity, firstPassQuantity].every(Number.isSafeInteger) || totalQuantity < 1 || goodQuantity < 0 || firstPassQuantity < 0 || firstPassQuantity > goodQuantity || goodQuantity > totalQuantity) {
    reject('PROCESS_PRODUCTION_QUANTITY_INVALID', 400);
  }
}

function validPeriod(periodStart: Date, periodEnd: Date) {
  if (!(periodStart instanceof Date) || !(periodEnd instanceof Date) || !Number.isFinite(periodStart.getTime()) || !Number.isFinite(periodEnd.getTime()) || periodEnd <= periodStart) {
    reject('PROCESS_PRODUCTION_PERIOD_INVALID', 400);
  }
}

function mapRow(row: ProductionRow) {
  return {
    id: row.id, organizationId: row.organization_id, batchCode: row.batch_code, workOrderCode: row.work_order_code,
    operationCode: row.operation_code, productCode: row.product_code, lineCode: row.line_code,
    periodStart: row.period_start, periodEnd: row.period_end, totalQuantity: row.total_quantity,
    goodQuantity: row.good_quantity, firstPassQuantity: row.first_pass_quantity, sourceKind: row.source_kind,
    yieldRate: row.good_quantity / row.total_quantity, firstPassRate: row.first_pass_quantity / row.total_quantity,
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapConflict(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('23P01') || message.includes('23505') || message.includes('exclusion constraint') || message.includes('duplicate key')) reject('CONCURRENCY_CONFLICT', 409);
  throw error;
}

@Injectable()
export class ProcessProductionService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService) {}

  private scope(actor: AdminActor): string {
    if (actor.accountType !== 'INTERNAL') reject('ORGANIZATION_SCOPE_DENIED', 403);
    return actor.scopeOrganizationId ?? actor.organizationId;
  }

  async create(actor: AdminActor, input: ProcessProductionInput, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    const batchCode = required(input.batchCode, 100);
    const workOrderCode = required(input.workOrderCode, 100);
    const operationCode = required(input.operationCode, 100);
    const productCode = required(input.productCode, 100);
    const lineCode = input.lineCode == null || !input.lineCode.trim() ? null : required(input.lineCode, 100);
    validPeriod(input.periodStart, input.periodEnd);
    validQuantities(input.totalQuantity, input.goodQuantity, input.firstPassQuantity);
    const facts = { batchCode, workOrderCode, operationCode, productCode, lineCode, periodStart: input.periodStart, periodEnd: input.periodEnd, totalQuantity: input.totalQuantity, goodQuantity: input.goodQuantity, firstPassQuantity: input.firstPassQuantity };
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_PRODUCTION_CREATED', payload: facts, permission: 'process-quality:defects:write' }, async (tx) => {
      const id = randomUUID();
      const rows = await tx.$queryRaw<ProductionRow[]>`INSERT INTO process_production_batches (id, organization_id, batch_code, work_order_code, operation_code, product_code, line_code, period_start, period_end, total_quantity, good_quantity, first_pass_quantity, created_by_id, updated_by_id) VALUES (${id}::uuid, ${organizationId}::uuid, ${batchCode}, ${workOrderCode}, ${operationCode}, ${productCode}, ${lineCode}, ${input.periodStart}, ${input.periodEnd}, ${input.totalQuantity}, ${input.goodQuantity}, ${input.firstPassQuantity}, ${actor.id}::uuid, ${actor.id}::uuid) RETURNING *`;
      await tx.$executeRaw`INSERT INTO process_production_revisions (id, organization_id, production_batch_id, version, total_quantity, good_quantity, first_pass_quantity, reason, recorded_by_id) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${id}::uuid, 1, ${input.totalQuantity}, ${input.goodQuantity}, ${input.firstPassQuantity}, '初始记录', ${actor.id}::uuid)`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'PROCESS_PRODUCTION_CREATED', resourceType: 'ProcessProductionBatch', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: 1 } }, tx);
      return mapRow(rows[0]!);
    }).catch(mapConflict);
  }

  async correct(actor: AdminActor, id: string, input: { expectedVersion: number; totalQuantity?: number; goodQuantity: number; firstPassQuantity: number; reason: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) reject('PROCESS_PRODUCTION_INPUT_INVALID', 400);
    const reason = required(input.reason, 2000);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_PRODUCTION_CORRECTED', payload: { id, ...input, reason }, permission: 'process-quality:defects:write' }, async (tx) => {
      const current = (await tx.$queryRaw<ProductionRow[]>`SELECT * FROM process_production_batches WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid FOR UPDATE`)[0];
      if (!current) reject('PROCESS_PRODUCTION_NOT_FOUND', 404);
      if (current.version !== input.expectedVersion) reject('CONCURRENCY_CONFLICT', 409);
      const totalQuantity = input.totalQuantity ?? current.total_quantity;
      validQuantities(totalQuantity, input.goodQuantity, input.firstPassQuantity);
      const rows = await tx.$queryRaw<ProductionRow[]>`UPDATE process_production_batches SET total_quantity = ${totalQuantity}, good_quantity = ${input.goodQuantity}, first_pass_quantity = ${input.firstPassQuantity}, version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid AND version = ${input.expectedVersion} RETURNING *`;
      if (!rows[0]) reject('CONCURRENCY_CONFLICT', 409);
      await tx.$executeRaw`INSERT INTO process_production_revisions (id, organization_id, production_batch_id, version, total_quantity, good_quantity, first_pass_quantity, reason, recorded_by_id) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${id}::uuid, ${rows[0].version}, ${totalQuantity}, ${input.goodQuantity}, ${input.firstPassQuantity}, ${reason}, ${actor.id}::uuid)`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'PROCESS_PRODUCTION_CORRECTED', resourceType: 'ProcessProductionBatch', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: rows[0].version, reason } }, tx);
      return mapRow(rows[0]);
    });
  }

  async list(actor: AdminActor, query: { periodStart: Date; periodEnd: Date; productCode?: string; batchCode?: string; page: number; pageSize: number }) {
    const organizationId = this.scope(actor);
    validPeriod(query.periodStart, query.periodEnd);
    if (!Number.isSafeInteger(query.page) || query.page < 1 || !Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) reject('PROCESS_PRODUCTION_QUERY_INVALID', 400);
    const productCode = query.productCode?.trim() || null;
    const batchCode = query.batchCode?.trim() || null;
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, 'process-quality:defects:read');
      const rows = await tx.$queryRaw<ProductionRow[]>`SELECT * FROM process_production_batches WHERE organization_id = ${organizationId}::uuid AND period_start >= ${query.periodStart} AND period_end <= ${query.periodEnd} AND (${productCode}::varchar IS NULL OR product_code = ${productCode}) AND (${batchCode}::varchar IS NULL OR batch_code = ${batchCode}) ORDER BY period_start DESC, id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`;
      const totals = await tx.$queryRaw<Array<{ total: bigint }>>`SELECT count(*) AS total FROM process_production_batches WHERE organization_id = ${organizationId}::uuid AND period_start >= ${query.periodStart} AND period_end <= ${query.periodEnd} AND (${productCode}::varchar IS NULL OR product_code = ${productCode}) AND (${batchCode}::varchar IS NULL OR batch_code = ${batchCode})`;
      return { items: rows.map(mapRow), total: Number(totals[0]!.total), page: query.page, pageSize: query.pageSize };
    });
  }

  async summary(actor: AdminActor, query: { periodStart: Date; periodEnd: Date; productCode?: string }) {
    const organizationId = this.scope(actor);
    validPeriod(query.periodStart, query.periodEnd);
    const productCode = query.productCode?.trim() || null;
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, 'process-quality:defects:read');
      const rows = await tx.$queryRaw<Array<{ batch_count: bigint; total_quantity: bigint; good_quantity: bigint; first_pass_quantity: bigint }>>`SELECT count(*) AS batch_count, COALESCE(sum(total_quantity), 0) AS total_quantity, COALESCE(sum(good_quantity), 0) AS good_quantity, COALESCE(sum(first_pass_quantity), 0) AS first_pass_quantity FROM process_production_batches WHERE organization_id = ${organizationId}::uuid AND period_start >= ${query.periodStart} AND period_end <= ${query.periodEnd} AND (${productCode}::varchar IS NULL OR product_code = ${productCode})`;
      const row = rows[0]!;
      const totalQuantity = Number(row.total_quantity);
      const goodQuantity = Number(row.good_quantity);
      const firstPassQuantity = Number(row.first_pass_quantity);
      return { batchCount: Number(row.batch_count), totalQuantity, goodQuantity, firstPassQuantity, yieldRate: totalQuantity ? goodQuantity / totalQuantity : null, firstPassRate: totalQuantity ? firstPassQuantity / totalQuantity : null };
    });
  }

  async snapshot(transaction: AdminTransaction, organizationId: string, batchIds: string[]): Promise<ProcessProductionReportSnapshot> {
    if (!batchIds.length || batchIds.length > 100) reject('PROCESS_SHIPMENT_BATCHES_INVALID', 400);
    const ids = [...new Set(batchIds)];
    if (ids.length !== batchIds.length) reject('PROCESS_SHIPMENT_BATCHES_INVALID', 400);
    const rows = await transaction.$queryRaw<ProductionRow[]>(Prisma.sql`SELECT * FROM process_production_batches WHERE organization_id = ${organizationId}::uuid AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY period_start, id`);
    if (rows.length !== ids.length) reject('PROCESS_PRODUCTION_BATCH_NOT_FOUND', 404);
    const defects = await transaction.$queryRaw<Array<{ production_batch_id: string; defect_quantity: number }>>(Prisma.sql`SELECT b.id AS production_batch_id, COALESCE(SUM(d.defect_quantity), 0)::int AS defect_quantity FROM process_production_batches b LEFT JOIN process_defects d ON d.organization_id = b.organization_id AND d.batch_code = b.batch_code AND d.work_order_code = b.work_order_code AND d.operation_code = b.operation_code AND d.occurred_at >= b.period_start AND d.occurred_at < b.period_end AND d.archived_at IS NULL WHERE b.organization_id = ${organizationId}::uuid AND b.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) GROUP BY b.id`);
    const defectByBatch = new Map(defects.map((row) => [String(row.production_batch_id), Number(row.defect_quantity)]));
    const batches = rows.map((row) => ({ ...mapRow(row), defectQuantity: defectByBatch.get(String(row.id)) ?? 0 }));
    const totalQuantity = batches.reduce((sum, row) => sum + row.totalQuantity, 0);
    const goodQuantity = batches.reduce((sum, row) => sum + row.goodQuantity, 0);
    const firstPassQuantity = batches.reduce((sum, row) => sum + row.firstPassQuantity, 0);
    const defectQuantity = batches.reduce((sum, row) => sum + row.defectQuantity, 0);
    return { batchCount: batches.length, totalQuantity, goodQuantity, firstPassQuantity, yieldRate: totalQuantity ? goodQuantity / totalQuantity : null, firstPassRate: totalQuantity ? firstPassQuantity / totalQuantity : null, defectQuantity, batches };
  }

  async detail(actor: AdminActor, id: string) {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, 'process-quality:defects:read');
      const row = (await tx.$queryRaw<ProductionRow[]>`SELECT * FROM process_production_batches WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid`)[0];
      if (!row) reject('PROCESS_PRODUCTION_NOT_FOUND', 404);
      const revisions = await tx.$queryRaw<Array<{ version: number; total_quantity: number; good_quantity: number; first_pass_quantity: number; reason: string; recorded_by_id: string; recorded_at: Date }>>`SELECT version, total_quantity, good_quantity, first_pass_quantity, reason, recorded_by_id, recorded_at FROM process_production_revisions WHERE organization_id = ${organizationId}::uuid AND production_batch_id = ${id}::uuid ORDER BY version`;
      const defects = await tx.processDefect.findMany({ where: { organizationId, batchCode: row.batch_code, workOrderCode: row.work_order_code, operationCode: row.operation_code, occurredAt: { gte: row.period_start, lt: row.period_end } }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
      return { ...mapRow(row), revisions, defects, defectQuantity: defects.reduce((total, defect) => total + defect.defectQuantity, 0) };
    });
  }
}
