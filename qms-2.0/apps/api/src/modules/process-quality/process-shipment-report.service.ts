import { HttpException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { FileLifecycleService } from '../file-management/file-lifecycle.service.js';
import { ProcessProductionService, type ProcessProductionReportSnapshot } from './process-production.service.js';

interface ShipmentReportRow {
  id: string;
  organization_id: string;
  report_number: string;
  status: string;
  period_start: Date;
  period_end: Date;
  product_code: string | null;
  batch_count: number;
  total_quantity: number;
  good_quantity: number;
  first_pass_quantity: number;
  defect_quantity: number;
  snapshot: ProcessProductionReportSnapshot & { periodStart: Date; periodEnd: Date; productCode: string | null };
  version: number;
  created_by_id: string;
  updated_by_id: string;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

type EvidenceRow = { file_id: string; file_version: number; sha256: string; scanned_at: Date; position: number };
type CustomerRow = { customer_id: string; customer_version: number; customer_code: string; customer_name: string };
type IssueRow = { problem_id: string; report_number: string; status: string; version: number };

function fail(code: string, status: number): never {
  throw new HttpException({ code, message: code }, status);
}

function text(value: unknown, max: number, code = 'PROCESS_SHIPMENT_REPORT_INPUT_INVALID'): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > max) fail(code, 400);
  return normalized;
}

function period(start: Date, end: Date) {
  if (!(start instanceof Date) || !(end instanceof Date) || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) fail('PROCESS_SHIPMENT_REPORT_PERIOD_INVALID', 400);
}

function mapReport(row: ShipmentReportRow) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    reportNumber: row.report_number,
    status: row.status,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    productCode: row.product_code,
    batchCount: row.batch_count,
    totalQuantity: row.total_quantity,
    goodQuantity: row.good_quantity,
    firstPassQuantity: row.first_pass_quantity,
    defectQuantity: row.defect_quantity,
    yieldRate: row.total_quantity ? row.good_quantity / row.total_quantity : null,
    firstPassRate: row.total_quantity ? row.first_pass_quantity / row.total_quantity : null,
    version: row.version,
    createdById: row.created_by_id,
    updatedById: row.updated_by_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    snapshot: row.snapshot,
  };
}

@Injectable()
export class ProcessShipmentReportService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService, private readonly production: ProcessProductionService, private readonly files: FileLifecycleService) {}

  private async hydrate(tx: Prisma.TransactionClient, row: ShipmentReportRow) {
    const [evidence, customers, issues] = await Promise.all([
      tx.$queryRaw<EvidenceRow[]>`SELECT file_id, file_version, sha256, scanned_at, position FROM process_shipment_report_evidence_refs WHERE organization_id = ${row.organization_id}::uuid AND report_id = ${row.id}::uuid ORDER BY position`,
      tx.$queryRaw<CustomerRow[]>`SELECT customer_id, customer_version, customer_code, customer_name FROM process_shipment_report_customers WHERE organization_id = ${row.organization_id}::uuid AND report_id = ${row.id}::uuid ORDER BY created_at, id`,
      tx.$queryRaw<IssueRow[]>`SELECT link.problem_id, link.report_number, problem.status, problem.version FROM process_shipment_report_issues link JOIN process_shipment_issue_read problem ON problem.organization_id = link.organization_id AND problem.id = link.problem_id WHERE link.organization_id = ${row.organization_id}::uuid AND link.report_id = ${row.id}::uuid ORDER BY link.created_at, link.id`,
    ]);
    return { ...mapReport(row), evidence: evidence.map((item) => ({ fileId: item.file_id, fileVersion: item.file_version, sha256: item.sha256.trim(), scannedAt: item.scanned_at, position: item.position })), customers: customers.map((item) => ({ customerId: item.customer_id, customerVersion: item.customer_version, customerCode: item.customer_code, customerName: item.customer_name })), issues: issues.map((item) => ({ id: item.problem_id, reportNumber: item.report_number, status: item.status, version: item.version })) };
  }

  private async current(tx: Prisma.TransactionClient, organizationId: string, id: string, lock = false) {
    const rows = await tx.$queryRaw<ShipmentReportRow[]>(Prisma.sql`SELECT * FROM process_shipment_reports WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
    if (!rows[0]) fail('PROCESS_SHIPMENT_REPORT_NOT_FOUND', 404);
    return rows[0]!;
  }

  private async changed(tx: Prisma.TransactionClient, actor: AdminActor, report: ShipmentReportRow, action: string, traceId: string) {
    const rows = await tx.$queryRaw<ShipmentReportRow[]>`UPDATE process_shipment_reports SET version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE organization_id = ${report.organization_id}::uuid AND id = ${report.id}::uuid AND version = ${report.version} AND status = 'DRAFT' RETURNING *`;
    if (!rows[0]) fail('CONCURRENCY_CONFLICT', 409);
    await this.audit.record({ organizationId: report.organization_id, actorUserId: actor.id, action, resourceType: 'ProcessShipmentReport', resourceId: report.id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: rows[0].version } }, tx);
    return this.hydrate(tx, rows[0]!);
  }

  private scope(actor: AdminActor): string {
    if (actor.accountType !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
    return actor.scopeOrganizationId ?? actor.organizationId;
  }

  async create(actor: AdminActor, input: { reportNumber?: string; periodStart: Date; periodEnd: Date; productCode?: string; batchIds: string[] }, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    period(input.periodStart, input.periodEnd);
    const batchIds = input.batchIds;
    if (!Array.isArray(batchIds) || batchIds.length < 1 || batchIds.length > 100) fail('PROCESS_SHIPMENT_BATCHES_INVALID', 400);
    const generatedNumber = createHash('sha256').update(`${input.periodStart.toISOString()}|${input.periodEnd.toISOString()}|${[...batchIds].sort().join(',')}`).digest('hex').slice(0, 8).toUpperCase();
    const reportNumber = input.reportNumber?.trim() || `SHIP-${input.periodStart.toISOString().slice(0, 10).replaceAll('-', '')}-${generatedNumber}`;
    text(reportNumber, 100);
    const productCode = input.productCode?.trim() || null;
    if (productCode && productCode.length > 100) fail('PROCESS_SHIPMENT_REPORT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_SHIPMENT_REPORT_CREATED', payload: { reportNumber, periodStart: input.periodStart, periodEnd: input.periodEnd, productCode, batchIds }, permission: 'process-quality:defects:write', isolationLevel: 'ReadCommitted' }, async (tx) => {
      const snapshot = await this.production.snapshot(tx, organizationId, batchIds);
      if (productCode && snapshot.batches.some((batch) => batch.productCode !== productCode)) fail('PROCESS_SHIPMENT_PRODUCT_MISMATCH', 409);
      if (snapshot.batches.some((batch) => batch.periodStart < input.periodStart || batch.periodEnd > input.periodEnd)) fail('PROCESS_SHIPMENT_PERIOD_MISMATCH', 409);
      const id = randomUUID();
      const snapshotPayload = { ...snapshot, periodStart: input.periodStart, periodEnd: input.periodEnd, productCode };
      const rows = await tx.$queryRaw<ShipmentReportRow[]>(Prisma.sql`INSERT INTO process_shipment_reports (id, organization_id, report_number, status, period_start, period_end, product_code, batch_count, total_quantity, good_quantity, first_pass_quantity, defect_quantity, snapshot, created_by_id, updated_by_id) VALUES (${id}::uuid, ${organizationId}::uuid, ${reportNumber}, 'DRAFT', ${input.periodStart}, ${input.periodEnd}, ${productCode}, ${snapshot.batchCount}, ${snapshot.totalQuantity}, ${snapshot.goodQuantity}, ${snapshot.firstPassQuantity}, ${snapshot.defectQuantity}, ${JSON.stringify(snapshotPayload)}::jsonb, ${actor.id}::uuid, ${actor.id}::uuid) RETURNING *`);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'PROCESS_SHIPMENT_REPORT_CREATED', resourceType: 'ProcessShipmentReport', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: 1 } }, tx);
      return this.hydrate(tx, rows[0]!);
    }, undefined);
  }

  async list(actor: AdminActor, query: { page: number; pageSize: number; includeArchived?: boolean; productCode?: string }) {
    const organizationId = this.scope(actor);
    if (!Number.isSafeInteger(query.page) || query.page < 1 || !Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) fail('PROCESS_SHIPMENT_REPORT_QUERY_INVALID', 400);
    const productCode = query.productCode?.trim() || null;
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, 'process-quality:defects:read');
      const filters = [Prisma.sql`organization_id = ${organizationId}::uuid`, productCode ? Prisma.sql`product_code = ${productCode}` : Prisma.sql`TRUE`, query.includeArchived ? Prisma.sql`TRUE` : Prisma.sql`archived_at IS NULL`];
      const where = Prisma.join(filters, ' AND ');
      const [rows, totals] = await Promise.all([
        tx.$queryRaw<ShipmentReportRow[]>(Prisma.sql`SELECT * FROM process_shipment_reports WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`),
        tx.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS total FROM process_shipment_reports WHERE ${where}`),
      ]);
      return { items: await Promise.all(rows.map((row) => this.hydrate(tx, row))), total: Number(totals[0]?.total ?? 0), page: query.page, pageSize: query.pageSize };
    });
  }

  async detail(actor: AdminActor, id: string) {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, 'process-quality:defects:read');
      const rows = await tx.$queryRaw<ShipmentReportRow[]>(Prisma.sql`SELECT * FROM process_shipment_reports WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid`);
      if (!rows[0]) fail('PROCESS_SHIPMENT_REPORT_NOT_FOUND', 404);
      return this.hydrate(tx, rows[0]);
    });
  }

  async archive(actor: AdminActor, id: string, expectedVersion: number, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail('PROCESS_SHIPMENT_REPORT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_SHIPMENT_REPORT_ARCHIVED', payload: { id, expectedVersion }, permission: 'process-quality:defects:write' }, async (tx) => {
      const current = (await tx.$queryRaw<ShipmentReportRow[]>(Prisma.sql`SELECT * FROM process_shipment_reports WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid FOR UPDATE`))[0];
      if (!current) fail('PROCESS_SHIPMENT_REPORT_NOT_FOUND', 404);
      if (current.status === 'ARCHIVED' || current.version !== expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
      const rows = await tx.$queryRaw<ShipmentReportRow[]>(Prisma.sql`UPDATE process_shipment_reports SET status = 'ARCHIVED', archived_at = CURRENT_TIMESTAMP, version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid AND version = ${expectedVersion} AND archived_at IS NULL RETURNING *`);
      if (!rows[0]) fail('CONCURRENCY_CONFLICT', 409);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'PROCESS_SHIPMENT_REPORT_ARCHIVED', resourceType: 'ProcessShipmentReport', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: rows[0].version } }, tx);
      return this.hydrate(tx, rows[0]);
    });
  }

  async updateEvidence(actor: AdminActor, id: string, input: { expectedVersion: number; fileIds: string[] }, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || !Array.isArray(input.fileIds) || input.fileIds.length < 1 || input.fileIds.length > 20 || new Set(input.fileIds).size !== input.fileIds.length) fail('PROCESS_SHIPMENT_REPORT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_SHIPMENT_REPORT_EVIDENCE_UPDATED', payload: { id, ...input }, permission: 'process-quality:defects:write', isolationLevel: 'ReadCommitted' }, async (tx) => {
      const report = await this.current(tx, organizationId, id, true);
      if (report.status !== 'DRAFT' || report.version !== input.expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
      const files = await this.files.assertAttachable(tx, actor, { resourceType: 'process-shipment-report', resourceId: id }, input.fileIds);
      await tx.$executeRaw`DELETE FROM process_shipment_report_evidence_refs WHERE organization_id = ${organizationId}::uuid AND report_id = ${id}::uuid`;
      for (const [position, fileId] of input.fileIds.entries()) {
        const file = files.find((candidate) => candidate.id === fileId)!;
        if (!file.scannedAt) fail('FILE_NOT_AVAILABLE', 409);
        await tx.$executeRaw`INSERT INTO process_shipment_report_evidence_refs (id, organization_id, report_id, file_id, file_version, sha256, scanned_at, position, created_by_id) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${id}::uuid, ${fileId}::uuid, ${file.version}, ${file.sha256}, ${file.scannedAt}::timestamptz, ${position}, ${actor.id}::uuid)`;
      }
      return this.changed(tx, actor, report, 'PROCESS_SHIPMENT_REPORT_EVIDENCE_UPDATED', traceId);
    });
  }

  async associateCustomer(actor: AdminActor, id: string, input: { customerId: string; expectedVersion: number }, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) fail('PROCESS_SHIPMENT_REPORT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_SHIPMENT_REPORT_CUSTOMER_LINKED', payload: { id, ...input }, permission: 'process-quality:defects:write', additionalAccess: [{ organizationId, permission: 'customer-quality:complaints:read' }] }, async (tx) => {
      const report = await this.current(tx, organizationId, id, true);
      if (report.status !== 'DRAFT' || report.version !== input.expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
      const customers = await tx.$queryRaw<Array<{ id: string; code: string; name: string; version: number }>>`SELECT id, code, name, version FROM process_shipment_customer_read WHERE organization_id = ${organizationId}::uuid AND id = ${input.customerId}::uuid`;
      const customer = customers[0];
      if (!customer) fail('CUSTOMER_MASTER_NOT_FOUND', 404);
      const existing = await tx.$queryRaw<CustomerRow[]>`SELECT customer_id FROM process_shipment_report_customers WHERE organization_id = ${organizationId}::uuid AND report_id = ${id}::uuid AND customer_id = ${customer.id}::uuid`;
      if (existing.length) fail('CONCURRENCY_CONFLICT', 409);
      await tx.$executeRaw`INSERT INTO process_shipment_report_customers (id, organization_id, report_id, customer_id, customer_version, customer_code, customer_name, created_by_id) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${id}::uuid, ${customer.id}::uuid, ${customer.version}, ${customer.code}, ${customer.name}, ${actor.id}::uuid)`;
      return this.changed(tx, actor, report, 'PROCESS_SHIPMENT_REPORT_CUSTOMER_LINKED', traceId);
    });
  }

  async linkIssue(actor: AdminActor, id: string, input: { problemId: string; expectedVersion: number; expectedProblemVersion: number }, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || !Number.isSafeInteger(input.expectedProblemVersion) || input.expectedProblemVersion < 1) fail('PROCESS_SHIPMENT_REPORT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_SHIPMENT_REPORT_ISSUE_LINKED', payload: { id, ...input }, permission: 'process-quality:defects:write' }, async (tx) => {
      const report = await this.current(tx, organizationId, id, true);
      if (report.status !== 'DRAFT' || report.version !== input.expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
      const issues = await tx.$queryRaw<Array<{ id: string; report_number: string; version: number }>>`SELECT id, report_number, version FROM process_shipment_issue_read WHERE organization_id = ${organizationId}::uuid AND id = ${input.problemId}::uuid AND archived_at IS NULL`;
      const issue = issues[0];
      if (!issue) fail('PROCESS_SHIPMENT_ISSUE_NOT_FOUND', 404);
      if (issue.version !== input.expectedProblemVersion) fail('CONCURRENCY_CONFLICT', 409);
      const existing = await tx.$queryRaw<IssueRow[]>`SELECT problem_id FROM process_shipment_report_issues WHERE organization_id = ${organizationId}::uuid AND report_id = ${id}::uuid AND problem_id = ${issue.id}::uuid`;
      if (existing.length) fail('CONCURRENCY_CONFLICT', 409);
      await tx.$executeRaw`INSERT INTO process_shipment_report_issues (id, organization_id, report_id, problem_id, problem_version, report_number, created_by_id) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${id}::uuid, ${issue.id}::uuid, ${issue.version}, ${issue.report_number}, ${actor.id}::uuid)`;
      return this.changed(tx, actor, report, 'PROCESS_SHIPMENT_REPORT_ISSUE_LINKED', traceId);
    });
  }
}
