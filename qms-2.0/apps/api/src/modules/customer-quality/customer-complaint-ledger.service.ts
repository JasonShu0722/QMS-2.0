import { HttpException, Injectable } from '@nestjs/common';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { isUUID, validate } from 'class-validator';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, adminPermissions, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { ComponentProjectService, listComponentEngineerAssignments, readComponentEngineerAssignment } from '../platform-configuration/component-project.service.js';
import type { ComponentProjectResolutionDto } from '../platform-configuration/component-project.dto.js';
import { OrganizationService } from '../organization/organization.service.js';
import { complaintMileageBand, complaintMisTag, complaintServiceMonths, parseComplaintDate } from './customer-complaint-derived.js';
import { CustomerLedgerCreateDto, CustomerLedgerImportDto, CustomerLedgerListDto, CustomerLedgerNoteDto, CustomerLedgerReceivingDto, CustomerLedgerReassignDto, CustomerLedgerUpdateDto,
  type CustomerLedgerCandidateDto, type CustomerLedgerDetailDto, type CustomerLedgerImportItemDto, type CustomerLedgerImportResultDto,
  type CustomerLedgerImportRowDto, type CustomerLedgerItemDto } from './customer-complaint-ledger.dto.js';
import { LEDGER_PERMISSIONS, ledgerDisplayStatus, ledgerFail, mergeComplaintSupplement, normalizeComplaintFields,
  type ComplaintFields, type CustomerLedgerCase, type LedgerOperation, type LedgerStage } from './customer-complaint-ledger.types.js';

type Row = Record<string, any>;
const validId = (id: string) => { if (!isUUID(id)) ledgerFail('CUSTOMER_LEDGER_REFERENCE_INVALID'); return id; };
const iso = (value: Date | string | null | undefined) => value == null ? null : value instanceof Date ? value.toISOString() : value;
const date = (value: Date | string | null | undefined) => iso(value)?.slice(0, 10) ?? null;
const json = (value: unknown) => JSON.stringify(value);
const nonempty = (value: unknown) => value != null && !(typeof value === 'string' && !value.trim());
const version = (value: number) => { if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) ledgerFail('CUSTOMER_LEDGER_VERSION_INVALID'); };
const note = (value: string) => { if (!value?.trim() || value.trim().length > 10000) ledgerFail('CUSTOMER_LEDGER_NOTE_REQUIRED'); return value.trim(); };

@Injectable()
export class CustomerComplaintLedgerService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService,
    private readonly audit: AuditLogService, private readonly components: ComponentProjectService,
    private readonly organizations: OrganizationService) {}

  private scope(actor: AdminActor): string {
    if (actor.accountType !== 'INTERNAL') ledgerFail('ORGANIZATION_SCOPE_DENIED', 403);
    return validId(actor.scopeOrganizationId ?? actor.organizationId);
  }

  private async input<T extends object>(type: ClassConstructor<T>, input: T): Promise<T> {
    const dto = plainToInstance(type, input);
    if ((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length) ledgerFail('CUSTOMER_LEDGER_ENVELOPE_INVALID');
    return dto;
  }

  private async authorize(tx: AdminTransaction, actor: AdminActor, permission: string | string[] = LEDGER_PERMISSIONS.read) {
    const organizationId = this.scope(actor);
    await assertActiveAuthentication(tx, actor, 'SHARE');
    await assertAdminAccess(tx, actor, organizationId, permission);
    if ((await this.organizations.lookup(organizationId, tx))?.type !== 'INTERNAL') ledgerFail('ORGANIZATION_SCOPE_DENIED', 403);
    return organizationId;
  }

  private async row(tx: AdminTransaction, organizationId: string, id: string): Promise<Row> {
    const [row] = await tx.$queryRaw<Row[]>`SELECT * FROM customer_quality_complaints WHERE organization_id = ${organizationId}::uuid AND id = ${validId(id)}::uuid FOR UPDATE`;
    if (!row) ledgerFail('CUSTOMER_COMPLAINT_NOT_FOUND', 404);
    return row;
  }

  private fields(row: Row): ComplaintFields {
    if (row.ledger_raw) return row.ledger_raw as ComplaintFields;
    return { complaintType: row.complaint_type, customerName: row.customer_name ?? null, terminalCustomerName: row.terminal_customer_name,
      componentCode: row.product_code, productModel: row.product_model, defectDescription: row.defect_description,
      vin: row.vin, mileage: row.mileage, purchaseOn: date(row.purchase_date) };
  }

  private async mapping(tx: AdminTransaction, organizationId: string, componentCode: unknown) {
    return typeof componentCode === 'string' && componentCode ? this.components.resolveForDomain(tx, organizationId, componentCode) : null;
  }

  private async eligible(tx: AdminTransaction, organizationId: string, assignmentId: string | null, stage: LedgerStage | null) {
    const assignment = await readComponentEngineerAssignment(tx, organizationId, assignmentId, new Date());
    if (!assignment.valid || !assignment.userId) return null;
    const granted = await adminPermissions(tx, assignment.userId, organizationId);
    if (!granted.includes(LEDGER_PERMISSIONS.read) || !granted.includes(LEDGER_PERMISSIONS.write) || (stage === 'NEW_PRODUCT' && !granted.includes(LEDGER_PERMISSIONS.project))) return null;
    return assignment;
  }

  private async project(tx: AdminTransaction, row: Row, resolution?: ComponentProjectResolutionDto | null): Promise<CustomerLedgerItemDto> {
    const facts = normalizeComplaintFields(this.fields(row));
    if (row.customer_id && !facts.normalized.customerName) {
      const [customer] = await tx.$queryRaw<{ name: string }[]>`SELECT name FROM customer_quality_customers WHERE organization_id = ${row.organization_id}::uuid AND id = ${row.customer_id}::uuid`;
      if (customer) facts.normalized.customerName = customer.name;
    }
    const mapping = resolution === undefined ? await this.mapping(tx, row.organization_id, facts.normalized.componentCode) : resolution;
    const matched = mapping?.outcome === 'matched';
    const stage = matched ? mapping.project!.stage : row.registered_stage ?? null;
    const mappedAssignment = matched ? (stage === 'NEW_PRODUCT' ? mapping.projectEngineer.assignmentId : mapping.customerEngineer.assignmentId) : null;
    const candidate = mappedAssignment ? await this.eligible(tx, row.organization_id, mappedAssignment, stage) : null;
    const following = !row.archived_at && ledgerDisplayStatus(row.ledger_status, row.status) === 'FOLLOWING';
    const engineerId = row.quality_engineer_id ?? (following ? candidate?.userId : null) ?? null;
    const assignmentId = row.quality_engineer_assignment_id ?? (following ? candidate?.assignmentId : null) ?? null;
    const source = row.quality_engineer_source ?? (following && candidate ? 'MAPPING' : null);
    const warnings = facts.warnings.filter(warning => !(row.customer_id && warning.code === 'CUSTOMER_NOT_RECORDED'));
    if (!row.customer_id && facts.normalized.customerName) warnings.push({ field: 'customerName', code: 'CUSTOMER_UNRESOLVED' });
    if (!matched) warnings.push({ field: 'componentCode', code: 'MAPPING_NOT_FOUND' });
    if (!engineerId) warnings.push({ field: 'qualityEngineerId', code: 'ENGINEER_NOT_CONFIGURED' });
    if (row.quality_engineer_id && !await this.eligible(tx, row.organization_id, row.quality_engineer_assignment_id, row.registered_stage ?? stage)) warnings.push({ field: 'qualityEngineerId', code: 'ENGINEER_NO_LONGER_ELIGIBLE' });
    if (row.quality_engineer_id && candidate?.userId && candidate.userId !== row.quality_engineer_id) warnings.push({ field: 'qualityEngineerId', code: source === 'MANUAL' ? 'MANUAL_ENGINEER_DIFFERS' : 'ENGINEER_HANDOVER_REQUIRED' });
    if (row.quality_engineer_id && source === 'MAPPING' && matched && !candidate && mappedAssignment !== row.quality_engineer_assignment_id) warnings.push({ field: 'qualityEngineerId', code: 'ENGINEER_HANDOVER_REQUIRED' });
    if (row.registered_stage && stage && row.registered_stage !== stage) warnings.push({ field: 'stage', code: 'PROJECT_STAGE_CHANGED' });
    const singleAfterSales = facts.normalized.quantity === 1 && facts.normalized.complaintType === 'AFTER_SALES';
    return { id: row.id, organizationId: row.organization_id, complaintNumber: row.complaint_number, version: row.version,
      status: ledgerDisplayStatus(row.ledger_status, row.status), legacyStatus: row.status, archived: !!row.archived_at, customerId: row.customer_id,
      normalized: facts.normalized, raw: facts.raw, warnings, registeredByUserId: row.created_by_id,
      qualityEngineerId: engineerId, qualityEngineerAssignmentId: assignmentId, qualityEngineerSource: source, stage,
      mapping,
      mileageBand: singleAfterSales ? complaintMileageBand(facts.normalized.mileage as number | null) : null,
      serviceMonths: singleAfterSales ? complaintServiceMonths(facts.normalized.productionOn as string | null, facts.normalized.occurredOn as string | null) : null,
      misTag: singleAfterSales ? complaintMisTag(facts.normalized.productionOn as string | null, facts.normalized.occurredOn as string | null) : null,
      courierNumber: row.courier_number, receivedOn: date(row.received_on), closedAt: iso(row.closed_at), closedByUserId: row.closed_by_id,
      closureNote: row.closure_note, createdAt: iso(row.created_at)! };
  }

  private recordAudit(tx: AdminTransaction, actor: AdminActor, row: Row, action: string, traceId: string) {
    return this.audit.record({ organizationId: row.organization_id, actorUserId: actor.id, action, resourceType: 'CustomerComplaint',
      resourceId: row.id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: row.version } }, tx);
  }

  private async reconcileEmptyEngineer(tx: AdminTransaction, actor: AdminActor, row: Row, resolution?: ComponentProjectResolutionDto | null): Promise<Row> {
    if (row.archived_at || row.ledger_status == null || row.quality_engineer_id || ledgerDisplayStatus(row.ledger_status, row.status) === 'CLOSED') return row;
    const current = await this.row(tx, row.organization_id, row.id);
    if (current.archived_at || current.quality_engineer_id || ledgerDisplayStatus(current.ledger_status, current.status) === 'CLOSED') return current;
    const projection = await this.project(tx, current, resolution);
    if (!projection.qualityEngineerId) return current;
    const [updated] = await tx.$queryRaw<Row[]>`UPDATE customer_quality_complaints SET quality_engineer_id = ${projection.qualityEngineerId}::uuid,
      quality_engineer_assignment_id = ${projection.qualityEngineerAssignmentId}::uuid,quality_engineer_source = 'MAPPING',
      registered_stage = ${projection.stage},version = version + 1,updated_by_id = ${actor.id}::uuid,updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = ${current.organization_id}::uuid AND id = ${current.id}::uuid AND version = ${current.version} AND quality_engineer_id IS NULL RETURNING *`;
    if (!updated) ledgerFail('CONCURRENCY_CONFLICT', 409);
    await this.recordEvent(tx, actor, current, 'REASSIGNED', ledgerDisplayStatus(current.ledger_status,current.status), json({ operation: 'MAPPING_ENGINEER_FILLED',
      qualityEngineerId: projection.qualityEngineerId, qualityEngineerAssignmentId: projection.qualityEngineerAssignmentId, stage: projection.stage,
      previousAssignmentBasis: { userId: current.quality_engineer_id, assignmentId: current.quality_engineer_assignment_id, source: current.quality_engineer_source, stage: current.registered_stage },
      assignmentBasis: { userId: projection.qualityEngineerId, assignmentId: projection.qualityEngineerAssignmentId, source: 'MAPPING', stage: projection.stage } }));
    await this.recordAudit(tx, actor, updated, 'CUSTOMER_LEDGER_ENGINEER_AUTO_FILLED', `mapping-recovery:${randomUUID()}`);
    return updated;
  }

  // Server-only seam. An analysis lock grants no right to write FAE/SQE facts.
  async readCase(tx: AdminTransaction, actor: AdminActor, id: string, operation: LedgerOperation = 'read'): Promise<CustomerLedgerCase> {
    if (!['read', 'update', 'analysis', 'receiving', 'close', 'reopen', 'closed-edit'].includes(operation)) ledgerFail('CUSTOMER_LEDGER_OPERATION_INVALID');
    const [isolation] = await tx.$queryRaw<{ transaction_isolation: string }[]>`SHOW transaction_isolation`;
    if (isolation?.transaction_isolation !== 'read committed') ledgerFail('WORKFLOW_TRANSACTION_ISOLATION_UNSUPPORTED', 409);
    const organizationId = await this.authorize(tx, actor);
    const row = await this.reconcileEmptyEngineer(tx, actor, await this.row(tx, organizationId, id));
    if (operation !== 'read' && row.archived_at) ledgerFail('CUSTOMER_LEDGER_ARCHIVED', 409);
    const item = await this.project(tx, row);
    if (!['read', 'analysis'].includes(operation)) {
      await assertAdminAccess(tx, actor, organizationId, LEDGER_PERMISSIONS.write);
      const assignment = await this.eligible(tx, organizationId, item.qualityEngineerAssignmentId, row.registered_stage ?? item.stage);
      const corresponding = item.qualityEngineerId === actor.id && assignment?.userId === actor.id;
      if (operation === 'receiving') {
        if (row.created_by_id !== actor.id && !corresponding) ledgerFail('CUSTOMER_LEDGER_RESPONSIBILITY_DENIED', 403);
      } else {
        if (!corresponding && !(operation === 'update' && !item.qualityEngineerId && row.created_by_id === actor.id && item.status !== 'CLOSED')) ledgerFail('CUSTOMER_LEDGER_RESPONSIBILITY_DENIED', 403);
        if (operation === 'close' || operation === 'reopen') await assertAdminAccess(tx, actor, organizationId, LEDGER_PERMISSIONS.close);
        if ((operation === 'update' && item.status === 'CLOSED') || operation === 'closed-edit') await assertAdminAccess(tx, actor, organizationId, LEDGER_PERMISSIONS.closedEdit);
      }
    }
    return { id: item.id, organizationId, version: item.version, status: item.status, legacyStatus: item.legacyStatus,
      registeredByUserId: item.registeredByUserId, qualityEngineerId: item.qualityEngineerId,
      qualityEngineerAssignmentId: item.qualityEngineerAssignmentId, qualityEngineerSource: item.qualityEngineerSource, stage: item.stage,
      responsibilityStage: row.registered_stage ?? item.stage };
  }

  assertReadCase(tx: AdminTransaction, actor: AdminActor, id: string) { return this.readCase(tx, actor, id, 'read'); }

  async lockCase(tx: AdminTransaction, actor: AdminActor, id: string, expectedVersion: number, operation: LedgerOperation = 'read') {
    version(expectedVersion);
    const current = await this.readCase(tx, actor, id, operation);
    if (current.version !== expectedVersion) ledgerFail('CONCURRENCY_CONFLICT', 409);
    return current;
  }

  async auditCase(tx: AdminTransaction, actor: AdminActor, id: string, action: string, traceId: string) {
    const current = await this.assertReadCase(tx, actor, id);
    return this.audit.record({ organizationId: current.organizationId, actorUserId: actor.id, action,
      resourceType: 'CustomerComplaint', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: current.version } }, tx);
  }

  async detail(actor: AdminActor, id: string): Promise<CustomerLedgerDetailDto> {
    return this.prisma.$transaction(async tx => {
      const current = await this.assertReadCase(tx, actor, id);
      const row = await this.row(tx, current.organizationId, id);
      const history = await tx.$queryRaw<Row[]>`SELECT id, seq, event_type, from_status, to_status, note, actor_user_id, created_at FROM customer_quality_complaint_events WHERE organization_id = ${current.organizationId}::uuid AND complaint_id = ${id}::uuid ORDER BY seq`;
      return { ...await this.project(tx, row), history: history.map(event => ({ id: event.id, sequence: event.seq, eventType: event.event_type,
        fromStatus: event.from_status, toStatus: event.to_status, note: event.note, actorUserId: event.actor_user_id, createdAt: iso(event.created_at)! })) };
    }, { isolationLevel: 'ReadCommitted' });
  }

  async candidates(actor: AdminActor, query: CustomerLedgerListDto) {
    const dto = await this.input(CustomerLedgerListDto, query);
    return this.prisma.$transaction(async tx => {
      const organizationId = await this.authorize(tx, actor);
      const items: CustomerLedgerCandidateDto[] = [];
      const resolution = dto.componentCode ? await this.mapping(tx, organizationId, dto.componentCode) : null;
      const stage = resolution?.outcome === 'matched' ? resolution.project!.stage : dto.stage ?? null;
      let page = 1;
      for (;;) {
        const result = await listComponentEngineerAssignments(tx, organizationId, { page, pageSize: 100, search: dto.search }, new Date());
        for (const assignment of result.items) {
          if (!assignment.assignmentId || !await this.eligible(tx, organizationId, assignment.assignmentId, stage)) continue;
          items.push({ assignmentId: assignment.assignmentId, userId: assignment.userId!, username: assignment.username, fullName: assignment.fullName,
            departmentName: assignment.departmentName, positionName: assignment.positionName,
            projectQualified: !!await this.eligible(tx, organizationId, assignment.assignmentId, 'NEW_PRODUCT') });
        }
        if (page++ * 100 >= result.total) break;
      }
      return { items };
    }, { isolationLevel: 'ReadCommitted' });
  }

  async list(actor: AdminActor, input: CustomerLedgerListDto) {
    const query = await this.input(CustomerLedgerListDto, input);
    for (const value of [query.occurredFrom, query.occurredTo]) if (value !== undefined && !parseComplaintDate(value)) ledgerFail('CUSTOMER_LEDGER_DATE_INVALID');
    if (query.occurredFrom && query.occurredTo && query.occurredFrom > query.occurredTo) ledgerFail('CUSTOMER_LEDGER_DATE_INVALID');
    // Multi-source linkage belongs to the public issue read model, not its private tables.
    if (query.linked !== undefined) ledgerFail('CUSTOMER_LEDGER_LINK_FILTER_NOT_READY', 409);
    return this.prisma.$transaction(async tx => {
      const organizationId = await this.authorize(tx, actor);
      const components = await tx.$queryRaw<{ code: string }[]>`SELECT DISTINCT COALESCE(ledger_normalized->>'componentCode',product_code) AS code FROM customer_quality_complaints WHERE organization_id = ${organizationId}::uuid AND COALESCE(ledger_normalized->>'componentCode',product_code) IS NOT NULL`;
      const resolutions = new Map<string, ComponentProjectResolutionDto | null>();
      const mapRows: { code: string; stage: string | null; project: string | null; engineer: string | null }[] = [];
      for (const { code } of components) {
        const resolution = await this.mapping(tx, organizationId, code); resolutions.set(code, resolution);
        const stage = resolution?.outcome === 'matched' ? resolution.project!.stage : null;
        const assignmentId = stage === 'NEW_PRODUCT' ? resolution!.projectEngineer.assignmentId : resolution?.customerEngineer.assignmentId;
        const engineer = stage ? await this.eligible(tx, organizationId, assignmentId ?? null, stage) : null;
        mapRows.push({ code, stage, project: resolution?.project?.code ?? null, engineer: engineer?.userId ?? null });
      }
      const state = Prisma.sql`COALESCE(c.ledger_status, CASE WHEN c.status IN ('CLOSED','ARCHIVED') THEN 'CLOSED' ELSE 'FOLLOWING' END)`;
      const effectiveEngineer = Prisma.sql`CASE WHEN c.quality_engineer_id IS NOT NULL THEN c.quality_engineer_id::text WHEN c.archived_at IS NULL AND ${state} = 'FOLLOWING' THEN m.engineer ELSE NULL END`;
      const filter = Prisma.sql`c.organization_id = ${organizationId}::uuid
        ${query.complaintType ? Prisma.sql`AND c.complaint_type = ${query.complaintType}` : Prisma.empty}
        ${query.status ? Prisma.sql`AND ${state} = ${query.status}` : Prisma.empty}
        ${query.customerId ? Prisma.sql`AND c.customer_id = ${query.customerId}::uuid` : Prisma.empty}
        ${query.componentCode ? Prisma.sql`AND COALESCE(c.ledger_normalized->>'componentCode',c.product_code) = ${query.componentCode}` : Prisma.empty}
        ${query.stage ? Prisma.sql`AND COALESCE(m.stage,c.registered_stage) = ${query.stage}` : Prisma.empty}
        ${query.projectCode ? Prisma.sql`AND m.project = ${query.projectCode}` : Prisma.empty}
        ${query.qualityEngineerId ? Prisma.sql`AND ${effectiveEngineer} = ${query.qualityEngineerId}` : Prisma.empty}
        ${query.mine === 'true' ? Prisma.sql`AND ${effectiveEngineer} = ${actor.id}` : Prisma.empty}
        ${query.occurredFrom ? Prisma.sql`AND c.ledger_normalized->>'occurredOn' >= ${query.occurredFrom}` : Prisma.empty}
        ${query.occurredTo ? Prisma.sql`AND c.ledger_normalized->>'occurredOn' <= ${query.occurredTo}` : Prisma.empty}
        ${query.search ? Prisma.sql`AND (strpos(lower(COALESCE(c.ledger_raw::text,'') || ' ' || COALESCE(c.defect_description,'') || ' ' || c.complaint_number),lower(${query.search})) > 0
          OR EXISTS (SELECT 1 FROM customer_quality_customers customer WHERE customer.organization_id = c.organization_id AND customer.id = c.customer_id AND strpos(lower(customer.name),lower(${query.search})) > 0))` : Prisma.empty}`;
      const join = Prisma.sql`LEFT JOIN jsonb_to_recordset(${json(mapRows)}::jsonb) AS m(code text, stage text, project text, engineer text) ON m.code = COALESCE(c.ledger_normalized->>'componentCode',c.product_code)`;
      const [total] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT count(*)::int AS total FROM customer_quality_complaints c ${join} WHERE ${filter}`);
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT c.* FROM customer_quality_complaints c ${join} WHERE ${filter} ORDER BY c.created_at DESC,c.id LIMIT ${query.pageSize} OFFSET ${(query.page-1)*query.pageSize}`);
      const items: CustomerLedgerItemDto[] = [];
      for (const row of rows) {
        const resolution = resolutions.get(row.ledger_normalized?.componentCode ?? row.product_code) ?? null;
        items.push(await this.project(tx, await this.reconcileEmptyEngineer(tx, actor, row, resolution), resolution));
      }
      return { items, total: total!.total, page: query.page, pageSize: query.pageSize };
    }, { isolationLevel: 'ReadCommitted' });
  }

  private async customer(tx: AdminTransaction, organizationId: string, id: string | null | undefined) {
    if (!id) return null;
    const [row] = await tx.$queryRaw<Row[]>`SELECT id,name FROM customer_quality_customers WHERE organization_id = ${organizationId}::uuid AND id = ${validId(id)}::uuid AND active = true FOR SHARE`;
    if (!row) ledgerFail('CUSTOMER_LEDGER_CUSTOMER_UNAVAILABLE', 409);
    return row;
  }

  private async recordEvent(tx: AdminTransaction, actor: AdminActor, row: Row, eventType: 'CLOSED' | 'REOPENED' | 'PROGRESS_RECORDED' | 'REASSIGNED', toStatus: string, description: string) {
    await tx.$executeRaw`INSERT INTO customer_quality_complaint_events (id,organization_id,complaint_id,seq,event_type,from_status,to_status,note,actor_user_id)
      VALUES (${randomUUID()}::uuid,${row.organization_id}::uuid,${row.id}::uuid,
      (SELECT COALESCE(MAX(seq),0)+1 FROM customer_quality_complaint_events WHERE organization_id = ${row.organization_id}::uuid AND complaint_id = ${row.id}::uuid),
      ${eventType},${ledgerDisplayStatus(row.ledger_status,row.status)},${toStatus},${description},${actor.id}::uuid)`;
  }

  private async prepareCreation(tx: AdminTransaction, actor: AdminActor, input: CustomerLedgerCreateDto) {
    const organizationId = this.scope(actor);
    const customer = await this.customer(tx, organizationId, input.customerId);
    const facts = normalizeComplaintFields(input.fields);
    if (customer && !facts.normalized.customerName) facts.normalized.customerName = customer.name;
    const resolution = await this.mapping(tx, organizationId, facts.normalized.componentCode);
    const stage = resolution?.outcome === 'matched' ? resolution.project!.stage : null;
    const automaticId = resolution?.outcome === 'matched' ? stage === 'NEW_PRODUCT' ? resolution.projectEngineer.assignmentId : resolution.customerEngineer.assignmentId : null;
    const assignment = await this.eligible(tx, organizationId, input.qualityEngineerAssignmentId ?? automaticId ?? null, stage);
    if (input.qualityEngineerAssignmentId && !assignment) ledgerFail('CUSTOMER_LEDGER_ENGINEER_UNAVAILABLE', 409);
    if (nonempty(input.fields.investigation) && assignment?.userId !== actor.id) ledgerFail('CUSTOMER_LEDGER_RESPONSIBILITY_DENIED', 403);
    return { organizationId, customer, facts, resolution, stage, assignment };
  }

  private async createRow(tx: AdminTransaction, actor: AdminActor, input: CustomerLedgerCreateDto, traceId: string) {
    const { organizationId, customer, facts, resolution, stage, assignment } = await this.prepareCreation(tx, actor, input);
    const source = assignment ? input.qualityEngineerAssignmentId ? 'MANUAL' : 'MAPPING' : null;
    const id = randomUUID(); const number = `CQ-${id}`;
    const [row] = await tx.$queryRaw<Row[]>`INSERT INTO customer_quality_complaints
      (id,organization_id,complaint_number,customer_id,complaint_type,terminal_customer_name,product_code,product_model,defect_description,vin,mileage,purchase_date,
      ledger_status,ledger_raw,ledger_normalized,ledger_mapping_snapshot,quality_engineer_id,quality_engineer_assignment_id,quality_engineer_source,registered_stage,created_by_id,updated_by_id,updated_at)
      VALUES (${id}::uuid,${organizationId}::uuid,${number},${customer?.id ?? null}::uuid,${facts.normalized.complaintType},${facts.normalized.terminalCustomerName},${facts.normalized.componentCode},${facts.normalized.productModel},${facts.normalized.defectDescription},${facts.normalized.vin},${facts.normalized.mileage}::int,${facts.normalized.purchaseOn}::date,
      'FOLLOWING',${json(facts.raw)}::jsonb,${json(facts.normalized)}::jsonb,${resolution ? json(resolution) : null}::jsonb,${assignment?.userId ?? null}::uuid,${assignment?.assignmentId ?? null}::uuid,${source},${stage},${actor.id}::uuid,${actor.id}::uuid,CURRENT_TIMESTAMP) RETURNING *`;
    await this.recordAudit(tx, actor, row!, 'CUSTOMER_LEDGER_CREATED', traceId);
    return this.project(tx, row!, resolution);
  }

  async create(actor: AdminActor, input: CustomerLedgerCreateDto, traceId: string, key?: string) {
    const dto = await this.input(CustomerLedgerCreateDto, input);
    return this.mutations.run({ actor, organizationId: this.scope(actor), key, traceId, action: 'CUSTOMER_LEDGER_CREATED', payload: dto,
      permission: [LEDGER_PERMISSIONS.read,LEDGER_PERMISSIONS.write], isolationLevel: 'ReadCommitted' },
    tx => this.createRow(tx, actor, dto, traceId), async tx => { await this.authorize(tx, actor, [LEDGER_PERMISSIONS.read,LEDGER_PERMISSIONS.write]); });
  }

  private async prepareUpdate(tx: AdminTransaction, actor: AdminActor, id: string, input: CustomerLedgerUpdateDto, supplement = false) {
    const current = await this.lockCase(tx, actor, id, input.expectedVersion, 'update');
    const row = await this.row(tx, current.organizationId, id);
    if (supplement && input.qualityEngineerAssignmentId !== undefined) ledgerFail('CUSTOMER_LEDGER_SUPPLEMENT_SCOPE_INVALID');
    if (current.status === 'CLOSED' && input.qualityEngineerAssignmentId === null) ledgerFail('CUSTOMER_LEDGER_CLOSED_ENGINEER_REQUIRED', 409);
    const investigation = input.fields.investigation;
    if (investigation !== undefined && (supplement ? nonempty(investigation) : current.qualityEngineerId !== actor.id)) ledgerFail('CUSTOMER_LEDGER_RESPONSIBILITY_DENIED', 403);
    const raw = supplement ? mergeComplaintSupplement(this.fields(row), input.fields) : { ...this.fields(row), ...input.fields };
    const facts = normalizeComplaintFields(raw);
    const customerId = input.customerId === undefined || (supplement && !input.customerId) ? row.customer_id : input.customerId;
    if (input.customerId) await this.customer(tx, current.organizationId, input.customerId);
    const resolution = await this.mapping(tx, current.organizationId, facts.normalized.componentCode);
    const stage = resolution?.outcome === 'matched' ? resolution.project!.stage : current.stage;
    const picked = input.qualityEngineerAssignmentId === undefined ? null : await this.eligible(tx, current.organizationId, input.qualityEngineerAssignmentId, stage);
    if (input.qualityEngineerAssignmentId && !picked) ledgerFail('CUSTOMER_LEDGER_ENGINEER_UNAVAILABLE', 409);
    const engineerId = input.qualityEngineerAssignmentId === undefined ? current.qualityEngineerId : picked?.userId ?? null;
    const assignmentId = input.qualityEngineerAssignmentId === undefined ? current.qualityEngineerAssignmentId : picked?.assignmentId ?? null;
    const source = input.qualityEngineerAssignmentId === undefined ? current.qualityEngineerSource : picked ? 'MANUAL' : null;
    // Mapping changes alone retain the accepted responsibility; explicit handoff accepts the current stage.
    const responsibilityStage = input.qualityEngineerAssignmentId === undefined ? row.registered_stage ?? stage : stage;
    return { current, row, facts, customerId, resolution, engineerId, assignmentId, source, responsibilityStage };
  }

  private async updateRow(tx: AdminTransaction, actor: AdminActor, id: string, input: CustomerLedgerUpdateDto, traceId: string, supplement = false,
    prepared?: Awaited<ReturnType<CustomerComplaintLedgerService['prepareUpdate']>>) {
    const { current, row, facts, customerId, resolution, engineerId, assignmentId, source, responsibilityStage } = prepared ?? await this.prepareUpdate(tx, actor, id, input, supplement);
    const [updated] = await tx.$queryRaw<Row[]>`UPDATE customer_quality_complaints SET ledger_status = COALESCE(ledger_status,${current.status}),customer_id = ${customerId}::uuid,
      complaint_type = ${facts.normalized.complaintType},terminal_customer_name = ${facts.normalized.terminalCustomerName},product_code = ${facts.normalized.componentCode},product_model = ${facts.normalized.productModel},
      defect_description = ${facts.normalized.defectDescription},vin = ${facts.normalized.vin},mileage = ${facts.normalized.mileage}::int,purchase_date = ${facts.normalized.purchaseOn}::date,
      ledger_raw = ${json(facts.raw)}::jsonb,ledger_normalized = ${json(facts.normalized)}::jsonb,ledger_mapping_snapshot = COALESCE(ledger_mapping_snapshot,${resolution ? json(resolution) : null}::jsonb),
      quality_engineer_id = ${engineerId}::uuid,quality_engineer_assignment_id = ${assignmentId}::uuid,quality_engineer_source = ${source},registered_stage = ${responsibilityStage},
      version = version + 1,updated_by_id = ${actor.id}::uuid,updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = ${current.organizationId}::uuid AND id = ${id}::uuid AND version = ${input.expectedVersion} RETURNING *`;
    if (!updated) ledgerFail('CONCURRENCY_CONFLICT', 409);
    const change = json({ operation: supplement ? 'SUPPLEMENT' : 'UPDATE', changedFields: Object.keys(input.fields), previous: this.fields(row),
      previousEngineerId: current.qualityEngineerId, qualityEngineerId: engineerId,
      ...(input.qualityEngineerAssignmentId === undefined ? {} : {
        previousAssignmentBasis: { userId: current.qualityEngineerId, assignmentId: current.qualityEngineerAssignmentId, source: current.qualityEngineerSource, stage: row.registered_stage ?? current.stage },
        assignmentBasis: { userId: engineerId, assignmentId, source, stage: responsibilityStage },
      }) });
    const eventType = engineerId !== current.qualityEngineerId ? 'REASSIGNED' : 'PROGRESS_RECORDED';
    if (change.length <= 10000) await this.recordEvent(tx, actor, row, eventType, current.status, change);
    else {
      const changeId = randomUUID();
      // Existing immutable events cap notes at 10000; chunk without discarding any original cell.
      for (let start = 0; start < change.length; start += 4000) await this.recordEvent(tx, actor, row, eventType, current.status,
        json({ changeId, part: start / 4000 + 1, parts: Math.ceil(change.length / 4000), chunk: change.slice(start, start + 4000) }));
    }
    await this.recordAudit(tx, actor, updated, 'CUSTOMER_LEDGER_UPDATED', traceId);
    return this.project(tx, updated, resolution);
  }

  async update(actor: AdminActor, id: string, input: CustomerLedgerUpdateDto, traceId: string, key?: string) {
    const dto = await this.input(CustomerLedgerUpdateDto, input); validId(id);
    return this.mutations.run({ actor, organizationId: this.scope(actor), key, traceId, action: 'CUSTOMER_LEDGER_UPDATED', payload: { id,...dto },
      permission: [LEDGER_PERMISSIONS.read,LEDGER_PERMISSIONS.write], isolationLevel: 'ReadCommitted' },
    tx => this.updateRow(tx, actor, id, dto, traceId), async tx => { await this.readCase(tx, actor, id, 'update'); });
  }

  private async reassignmentCase(tx: AdminTransaction, actor: AdminActor, id: string, assignmentId: string) {
    const organizationId = await this.authorize(tx, actor, [LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write, LEDGER_PERMISSIONS.reassign]);
    // Do not reconcile an empty engineer here: this capability only repairs a saved stale responsibility.
    const row = await this.row(tx, organizationId, id);
    if (row.archived_at) ledgerFail('CUSTOMER_LEDGER_ARCHIVED', 409);
    const status = ledgerDisplayStatus(row.ledger_status, row.status);
    if (status === 'CLOSED') await assertAdminAccess(tx, actor, organizationId, LEDGER_PERMISSIONS.closedEdit);
    const resolution = await this.mapping(tx, organizationId, normalizeComplaintFields(this.fields(row)).normalized.componentCode);
    const stage: LedgerStage | null = resolution?.outcome === 'matched' ? resolution.project!.stage : row.registered_stage ?? null;
    const target = await this.eligible(tx, organizationId, assignmentId, stage);
    if (!target) ledgerFail('CUSTOMER_LEDGER_ENGINEER_UNAVAILABLE', 409);
    return { row, status, stage, target, resolution };
  }

  async reassign(actor: AdminActor, id: string, input: CustomerLedgerReassignDto, traceId: string, key?: string) {
    const dto = await this.input(CustomerLedgerReassignDto, input); validId(id);
    const organizationId = this.scope(actor);
    if (dto.organizationId !== undefined && dto.organizationId !== organizationId) ledgerFail('ORGANIZATION_SCOPE_DENIED', 403);
    const authorize = async (tx: AdminTransaction) => { await this.reassignmentCase(tx, actor, id, dto.qualityEngineerAssignmentId); };
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'CUSTOMER_LEDGER_REASSIGNED', payload: { id, ...dto },
      permission: [LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write, LEDGER_PERMISSIONS.reassign], isolationLevel: 'ReadCommitted' }, async tx => {
      const { row, status, stage, target, resolution } = await this.reassignmentCase(tx, actor, id, dto.qualityEngineerAssignmentId);
      if (row.version !== dto.expectedVersion) ledgerFail('CONCURRENCY_CONFLICT', 409);
      const previous = await this.eligible(tx, organizationId, row.quality_engineer_assignment_id, row.registered_stage ?? stage);
      if (!row.quality_engineer_id || previous?.userId === row.quality_engineer_id) ledgerFail('CUSTOMER_LEDGER_STALE_ENGINEER_REQUIRED', 409);
      const [updated] = await tx.$queryRaw<Row[]>`UPDATE customer_quality_complaints SET
        quality_engineer_id = ${target.userId}::uuid,quality_engineer_assignment_id = ${target.assignmentId}::uuid,quality_engineer_source = 'MANUAL',registered_stage = ${stage},
        version = version + 1,updated_by_id = ${actor.id}::uuid,updated_at = CURRENT_TIMESTAMP
        WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid AND version = ${dto.expectedVersion} RETURNING *`;
      if (!updated) ledgerFail('CONCURRENCY_CONFLICT', 409);
      await authorize(tx);
      const change = json({ operation: 'STALE_ENGINEER_HANDOFF', reason: dto.reason,
        previousAssignmentBasis: { userId: row.quality_engineer_id, assignmentId: row.quality_engineer_assignment_id, source: row.quality_engineer_source, stage: row.registered_stage ?? stage },
        assignmentBasis: { userId: target.userId, assignmentId: target.assignmentId, source: 'MANUAL', stage } });
      if (change.length <= 10000) await this.recordEvent(tx, actor, row, 'REASSIGNED', status, change);
      else {
        const changeId = randomUUID();
        for (let start = 0; start < change.length; start += 4000) await this.recordEvent(tx, actor, row, 'REASSIGNED', status,
          json({ changeId, part: start / 4000 + 1, parts: Math.ceil(change.length / 4000), chunk: change.slice(start, start + 4000) }));
      }
      await this.recordAudit(tx, actor, updated, 'CUSTOMER_LEDGER_REASSIGNED', traceId);
      return this.project(tx, updated, resolution);
    }, authorize);
  }

  private async transition(actor: AdminActor, id: string, input: CustomerLedgerNoteDto, traceId: string, key: string | undefined, close: boolean) {
    const dto = await this.input(CustomerLedgerNoteDto, input); const description = note(dto.note); validId(id);
    const operation = close ? 'close' : 'reopen';
    return this.mutations.run({ actor, organizationId: this.scope(actor), key, traceId, action: close ? 'CUSTOMER_LEDGER_CLOSED' : 'CUSTOMER_LEDGER_REOPENED', payload: { id,...dto },
      permission: [LEDGER_PERMISSIONS.read,LEDGER_PERMISSIONS.write,LEDGER_PERMISSIONS.close], isolationLevel: 'ReadCommitted' }, async tx => {
      const current = await this.lockCase(tx, actor, id, dto.expectedVersion, operation);
      if (current.status !== (close ? 'FOLLOWING' : 'CLOSED')) ledgerFail('CUSTOMER_LEDGER_TRANSITION_INVALID', 409);
      const row = await this.row(tx, current.organizationId, id);
      const [updated] = await tx.$queryRaw<Row[]>`UPDATE customer_quality_complaints SET ledger_status = ${close ? 'CLOSED' : 'FOLLOWING'},
        closed_at = CASE WHEN ${close} THEN CURRENT_TIMESTAMP ELSE closed_at END,
        closed_by_id = CASE WHEN ${close} THEN ${actor.id}::uuid ELSE closed_by_id END,
        closure_note = CASE WHEN ${close} THEN ${description} ELSE closure_note END,
        quality_engineer_id = ${current.qualityEngineerId}::uuid,quality_engineer_assignment_id = ${current.qualityEngineerAssignmentId}::uuid,quality_engineer_source = ${current.qualityEngineerSource},
        version = version + 1,updated_by_id = ${actor.id}::uuid,updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}::uuid AND organization_id = ${current.organizationId}::uuid AND version = ${dto.expectedVersion} RETURNING *`;
      if (!updated) ledgerFail('CONCURRENCY_CONFLICT', 409);
      await this.recordEvent(tx, actor, row, close ? 'CLOSED' : 'REOPENED', close ? 'CLOSED' : 'FOLLOWING', description);
      await this.recordAudit(tx, actor, updated, close ? 'CUSTOMER_LEDGER_CLOSED' : 'CUSTOMER_LEDGER_REOPENED', traceId);
      return this.project(tx, updated);
    }, async tx => { await this.readCase(tx, actor, id, operation); });
  }

  close(actor: AdminActor, id: string, input: CustomerLedgerNoteDto, traceId: string, key?: string) { return this.transition(actor, id, input, traceId, key, true); }
  reopen(actor: AdminActor, id: string, input: CustomerLedgerNoteDto, traceId: string, key?: string) { return this.transition(actor, id, input, traceId, key, false); }

  async receiving(actor: AdminActor, id: string, input: CustomerLedgerReceivingDto, traceId: string, key?: string) {
    const dto = await this.input(CustomerLedgerReceivingDto, input); validId(id);
    if (dto.receivedOn && !parseComplaintDate(dto.receivedOn)) ledgerFail('CUSTOMER_LEDGER_DATE_INVALID');
    return this.mutations.run({ actor, organizationId: this.scope(actor), key, traceId, action: 'CUSTOMER_LEDGER_RECEIVING_UPDATED', payload: { id,...dto },
      permission: [LEDGER_PERMISSIONS.read,LEDGER_PERMISSIONS.write], isolationLevel: 'ReadCommitted' }, async tx => {
      const current = await this.lockCase(tx, actor, id, dto.expectedVersion, 'receiving');
      const row = await this.row(tx, current.organizationId, id);
      const [updated] = await tx.$queryRaw<Row[]>`UPDATE customer_quality_complaints SET ledger_status = COALESCE(ledger_status,${current.status}),courier_number = ${dto.courierNumber === undefined ? row.courier_number : dto.courierNumber?.trim() || null},
        received_on = ${dto.receivedOn === undefined ? date(row.received_on) : dto.receivedOn || null}::date,version = version + 1,updated_by_id = ${actor.id}::uuid,updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}::uuid AND organization_id = ${current.organizationId}::uuid AND version = ${dto.expectedVersion} RETURNING *`;
      if (!updated) ledgerFail('CONCURRENCY_CONFLICT', 409);
      await this.recordEvent(tx, actor, row, 'PROGRESS_RECORDED', current.status, json({ operation: 'RECEIVING', courierNumber: updated.courier_number, receivedOn: date(updated.received_on) }));
      await this.recordAudit(tx, actor, updated, 'CUSTOMER_LEDGER_RECEIVING_UPDATED', traceId);
      return this.project(tx, updated);
    }, async tx => { await this.readCase(tx, actor, id, 'receiving'); });
  }

  private async similarities(tx: AdminTransaction, actor: AdminActor, fields: ComplaintFields) {
    const { normalized } = normalizeComplaintFields(fields);
    if (!normalized.vin && !normalized.barcode && !normalized.batch) return [];
    const rows = await tx.$queryRaw<Row[]>`SELECT * FROM customer_quality_complaints WHERE organization_id = ${this.scope(actor)}::uuid AND
      ((${normalized.vin}::text IS NOT NULL AND vin = ${normalized.vin}) OR (${normalized.barcode}::text IS NOT NULL AND ledger_normalized->>'barcode' = ${normalized.barcode}) OR (${normalized.batch}::text IS NOT NULL AND ledger_normalized->>'batch' = ${normalized.batch})) ORDER BY created_at DESC,id LIMIT 10`;
    const result: CustomerLedgerItemDto[] = [];
    for (const row of rows) result.push(await this.project(tx, await this.reconcileEmptyEngineer(tx, actor, row)));
    return result;
  }

  private receipt(row: CustomerLedgerImportRowDto, outcome: string, record: CustomerLedgerItemDto | null = null, errorCode: string | null = null): CustomerLedgerImportItemDto {
    return { rowNumber: row.rowNumber, outcome, complaintId: record?.id ?? null, errorCode,
      warnings: record?.warnings ?? normalizeComplaintFields(row.fields).warnings, record, similarities: [] };
  }

  private result(items: CustomerLedgerImportItemDto[]): CustomerLedgerImportResultDto {
    return { items, created: items.filter(i => i.outcome === 'CREATED').length, supplemented: items.filter(i => i.outcome === 'SUPPLEMENTED').length,
      skipped: items.filter(i => i.outcome === 'SKIPPED').length, failed: items.filter(i => i.outcome === 'FAILED').length,
      pendingCorrection: items.filter(i => ['CREATED','SUPPLEMENTED'].includes(i.outcome) && i.warnings.length > 0).length };
  }

  async preview(actor: AdminActor, input: CustomerLedgerImportDto) {
    const dto = await this.input(CustomerLedgerImportDto, input);
    return this.prisma.$transaction(async tx => {
      await this.authorize(tx, actor, [LEDGER_PERMISSIONS.read,LEDGER_PERMISSIONS.write]);
      const items: CustomerLedgerImportItemDto[] = [];
      for (const row of dto.rows) {
        const item = this.receipt(row, 'PREVIEW');
        item.similarities = await this.similarities(tx, actor, row.fields);
        if (row.action === 'ADD' || row.action === 'SUPPLEMENT') {
          try {
            if (row.action === 'ADD') await this.prepareCreation(tx, actor, row);
            else {
              const prepared = await this.prepareUpdate(tx, actor, row.targetId!, { ...row, expectedVersion: row.expectedVersion! }, true);
              item.warnings = prepared.facts.warnings;
              if (dto.mode === 'SKIP_ERRORS' && item.warnings.some(w => ['INVALID_VALUE','BEFORE_PRODUCTION'].includes(w.code))) item.outcome = 'SKIPPED';
            }
          }
          catch (error) {
            if (!(error instanceof HttpException)) throw error;
            item.errorCode = (error.getResponse() as { code: string }).code; item.outcome = 'FAILED';
          }
        }
        items.push(item);
      }
      return this.result(items);
    }, { isolationLevel: 'ReadCommitted' });
  }

  async commit(actor: AdminActor, input: CustomerLedgerImportDto, traceId: string, key?: string) {
    const dto = await this.input(CustomerLedgerImportDto, input);
    const organizationId = this.scope(actor);
    const authorize = async (tx: AdminTransaction) => { await this.authorize(tx, actor, [LEDGER_PERMISSIONS.read,LEDGER_PERMISSIONS.write]); };
    const mutation = (action: string, payload: object, mutationKey: string | undefined) => ({ actor, organizationId, key: mutationKey, traceId, action, payload,
      permission: [LEDGER_PERMISSIONS.read,LEDGER_PERMISSIONS.write], isolationLevel: 'ReadCommitted' as const });
    // Use the existing component-import pattern: reserve exact input, then commit bounded row receipts independently.
    await this.mutations.run(mutation('CUSTOMER_LEDGER_IMPORTED', dto, key), async () => null, authorize);
    const digest = createHash('sha256').update(key!).digest('hex');
    const items: CustomerLedgerImportItemDto[] = [];
    for (const row of dto.rows) {
      const rowKey = `customer-ledger:${digest}:${row.rowNumber}`;
      const item = await this.mutations.run(mutation('CUSTOMER_LEDGER_IMPORT_ROW', { mode: dto.mode, row }, rowKey), async tx => {
        const warnings = normalizeComplaintFields(row.fields).warnings;
        if (dto.mode === 'CANCEL') return this.receipt(row, 'CANCELLED');
        if (row.action === 'SKIP' || (row.action === 'ADD' && dto.mode === 'SKIP_ERRORS' && warnings.some(w => ['INVALID_VALUE','BEFORE_PRODUCTION'].includes(w.code)))) return this.receipt(row, 'SKIPPED');
        await tx.$executeRaw`SAVEPOINT customer_ledger_import_row`;
        try {
          const update = { fields: row.fields, customerId: row.customerId, qualityEngineerAssignmentId: row.qualityEngineerAssignmentId, expectedVersion: row.expectedVersion! };
          const prepared = row.action === 'SUPPLEMENT' ? await this.prepareUpdate(tx, actor, row.targetId!, update, true) : undefined;
          if (prepared && dto.mode === 'SKIP_ERRORS' && prepared.facts.warnings.some(w => ['INVALID_VALUE','BEFORE_PRODUCTION'].includes(w.code))) {
            // Target checks can reconcile responsibility; a skipped row must retain every original fact.
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT customer_ledger_import_row`;
            await tx.$executeRaw`RELEASE SAVEPOINT customer_ledger_import_row`;
            return { ...this.receipt(row, 'SKIPPED'), warnings: prepared.facts.warnings };
          }
          const record = row.action === 'ADD' ? await this.createRow(tx, actor, row, traceId)
            : await this.updateRow(tx, actor, row.targetId!, update, traceId, true, prepared);
          await tx.$executeRaw`RELEASE SAVEPOINT customer_ledger_import_row`;
          return this.receipt(row, row.action === 'ADD' ? 'CREATED' : 'SUPPLEMENTED', record);
        } catch (error) {
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT customer_ledger_import_row`;
          await tx.$executeRaw`RELEASE SAVEPOINT customer_ledger_import_row`;
          // Database/audit failures roll back the current row; a retry replays prior successful receipts.
          if (!(error instanceof HttpException) || ![400,403,404,409].includes(error.getStatus())) throw error;
          return this.receipt(row, 'FAILED', null, (error.getResponse() as { code: string }).code);
        }
      }, async tx => {
        await authorize(tx);
        // Fresh row failures remain receipts; replay must recheck the target before exposing an old success.
        if (row.action === 'SUPPLEMENT') {
          const receipt = await tx.adminMutation.findUnique({ where: { actorUserId_organizationId_key: { actorUserId: actor.id, organizationId, key: rowKey } }, select: { response: true } });
          if ((receipt?.response as { value?: CustomerLedgerImportItemDto } | undefined)?.value?.outcome === 'SUPPLEMENTED') await this.readCase(tx, actor, row.targetId!, 'update');
        }
      });
      items.push(item);
    }
    return this.result(items);
  }
}
