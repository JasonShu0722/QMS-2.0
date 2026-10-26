import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, adminPermissions, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { FileLifecycleService } from '../file-management/file-lifecycle.service.js';
import type { FileResourceAction } from '../file-management/file-resource-access.js';
import { OrganizationService } from '../organization/organization.service.js';
import { CustomerComplaintLedgerService } from './customer-complaint-ledger.service.js';
import { LEDGER_PERMISSIONS, type CustomerLedgerCase } from './customer-complaint-ledger.types.js';
import { ANALYSIS_PERMISSIONS, ANALYSIS_RESOURCE_TYPE, analysisContent, analysisFail, assertAnalysisTransfer, assertAnalysisWriter, faeAnalysisStatus, type AnalysisAssignmentInput, type AnalysisContent, type AnalysisSaveInput, type AnalysisSection, type AnalysisSnapshot } from './customer-complaint-analysis.types.js';

type StoredAnalysis = Omit<AnalysisSnapshot, keyof AnalysisContent | 'faeStatus' | 'updatedAt'> & { content: AnalysisContent; updatedAt: Date };
const columns = Prisma.sql`id, organization_id AS "organizationId", complaint_id AS "complaintId", section,
  assignee_user_id AS "assigneeUserId", assignee_assignment_id AS "assigneeAssignmentId", department_id AS "departmentId",
  content, version, updated_by_user_id AS "updatedByUserId", updated_at AS "updatedAt"`;
const uuid = (id: string) => { if (!isUUID(id)) analysisFail('CUSTOMER_ANALYSIS_INPUT_INVALID'); return id; };
const version = (value: number, minimum = 1) => { if (!Number.isSafeInteger(value) || value < minimum || value > 2147483647) analysisFail('CUSTOMER_ANALYSIS_INPUT_INVALID'); };
const sectionValue = (value: string): AnalysisSection => { if (value !== 'FAE' && value !== 'SUPPLIER') analysisFail('CUSTOMER_ANALYSIS_SECTION_INVALID'); return value; };

@Injectable()
export class CustomerComplaintAnalysisService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService,
    private readonly files: FileLifecycleService, private readonly organizations: OrganizationService, private readonly ledger: CustomerComplaintLedgerService) {}

  private scope(actor: AdminActor, write = true) {
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    if (actor.accountType !== 'INTERNAL' || (write && organizationId !== actor.organizationId)) analysisFail('ORGANIZATION_SCOPE_DENIED', 403);
    return organizationId;
  }

  // This unlocked lookup only locates the source; the public ledger lock must precede the analysis lock.
  private async locate(tx: AdminTransaction, id: string) {
    const [row] = await tx.$queryRaw<StoredAnalysis[]>(Prisma.sql`SELECT ${columns} FROM customer_complaint_analyses WHERE id = ${uuid(id)}::uuid`);
    if (!row) analysisFail('CUSTOMER_ANALYSIS_NOT_FOUND', 404);
    return row;
  }

  private async lock(tx: AdminTransaction, actor: AdminActor, id: string, write: boolean) {
    // FileLifecycle reauthenticates with NO KEY UPDATE; take it before source/session locks, never upgrade SHARE later.
    await assertActiveAuthentication(tx, actor);
    const located = await this.locate(tx, id);
    if (located.organizationId !== this.scope(actor, write)) analysisFail('ORGANIZATION_SCOPE_DENIED', 403);
    const source = await this.ledger.readCase(tx, actor, located.complaintId, write ? 'analysis' : 'read');
    const [row] = await tx.$queryRaw<StoredAnalysis[]>(Prisma.sql`SELECT ${columns} FROM customer_complaint_analyses WHERE id = ${id}::uuid ${write ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`}`);
    if (!row || row.complaintId !== source.id || row.organizationId !== source.organizationId) analysisFail('CUSTOMER_ANALYSIS_NOT_FOUND', 404);
    return { row, source };
  }

  private async candidate(tx: AdminTransaction, organizationId: string, userId: string, assignmentId: string, section: AnalysisSection) {
    uuid(userId); uuid(assignmentId);
    const user = await tx.user.findFirst({ where: { id: userId, organizationId, accountType: 'INTERNAL', status: 'ACTIVE' }, select: { id: true, username: true } });
    const assignment = (await this.organizations.currentAssignments(userId, organizationId, new Date(), tx)).find(item => item.id === assignmentId);
    const permissions = user && assignment ? await adminPermissions(tx, userId, organizationId) : [];
    if (!user || !assignment || [LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write, ANALYSIS_PERMISSIONS[section]].some(code => !permissions.includes(code))) analysisFail('CUSTOMER_ANALYSIS_CANDIDATE_INVALID', 403);
    return { userId, username: user.username, assignmentId, departmentId: assignment.department.id };
  }

  private async writer(tx: AdminTransaction, actor: AdminActor, row: StoredAnalysis, source: CustomerLedgerCase) {
    if (actor.id !== row.assigneeUserId) analysisFail('CUSTOMER_ANALYSIS_ASSIGNEE_REQUIRED', 403);
    await assertAdminAccess(tx, actor, source.organizationId, [LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write, ANALYSIS_PERMISSIONS[row.section]]);
    const current = await this.candidate(tx, source.organizationId, actor.id, row.assigneeAssignmentId, row.section);
    assertAnalysisWriter(actor.id, row.assigneeUserId, current.departmentId === row.departmentId, source.status);
  }

  private async dispatcher(tx: AdminTransaction, actor: AdminActor, source: CustomerLedgerCase) {
    this.scope(actor);
    if (source.status !== 'FOLLOWING') analysisFail('CUSTOMER_ANALYSIS_SOURCE_CLOSED', 409);
    if (source.qualityEngineerId !== actor.id || !source.qualityEngineerAssignmentId) analysisFail('CUSTOMER_ANALYSIS_ENGINEER_REQUIRED', 403);
    const assignments = await this.organizations.currentAssignments(actor.id, source.organizationId, new Date(), tx);
    if (!assignments.some(item => item.id === source.qualityEngineerAssignmentId)) analysisFail('CUSTOMER_ANALYSIS_ENGINEER_REQUIRED', 403);
    await assertAdminAccess(tx, actor, source.organizationId, source.stage === 'NEW_PRODUCT'
      ? [LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write, LEDGER_PERMISSIONS.project] : [LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write]);
  }

  private plain(row: StoredAnalysis): AnalysisSnapshot {
    const content = { ...analysisContent({}, row.section), ...row.content };
    return { id: row.id, organizationId: row.organizationId, complaintId: row.complaintId, section: row.section,
      assigneeUserId: row.assigneeUserId, assigneeAssignmentId: row.assigneeAssignmentId, departmentId: row.departmentId,
      version: row.version, ...content, faeStatus: row.section === 'FAE' ? faeAnalysisStatus(content.text, 0) : null,
      updatedByUserId: row.updatedByUserId, updatedAt: row.updatedAt.toISOString() };
  }

  private async project(tx: AdminTransaction, actor: AdminActor, row: StoredAnalysis): Promise<AnalysisSnapshot> {
    const result = this.plain(row);
    if (result.fileIds.length) {
      const evidence = await this.files.readEvidence(tx, actor, [{ resource: { resourceType: ANALYSIS_RESOURCE_TYPE, resourceId: row.id }, fileIds: result.fileIds }]);
      if (row.section === 'FAE') result.faeStatus = faeAnalysisStatus(result.text, evidence.filter(file => file.downloadable).length);
    }
    return result;
  }

  async snapshot(tx: AdminTransaction, actor: AdminActor, complaintId: string) {
    const organizationId = this.scope(actor, false); uuid(complaintId);
    await assertActiveAuthentication(tx, actor);
    await this.ledger.readCase(tx, actor, complaintId, 'read');
    const rows = await tx.$queryRaw<StoredAnalysis[]>(Prisma.sql`SELECT ${columns} FROM customer_complaint_analyses WHERE complaint_id = ${complaintId}::uuid AND organization_id = ${organizationId}::uuid ORDER BY id FOR SHARE`);
    const snapshots = [];
    for (const row of rows) snapshots.push(await this.project(tx, actor, row));
    return { complaintId, fae: snapshots.find(row => row.section === 'FAE') ?? null, supplier: snapshots.find(row => row.section === 'SUPPLIER') ?? null };
  }

  summary(actor: AdminActor, complaintId: string) {
    return this.prisma.$transaction(tx => this.snapshot(tx, actor, complaintId), { isolationLevel: 'ReadCommitted' });
  }

  async history(actor: AdminActor, id: string) {
    return this.prisma.$transaction(async tx => {
      const { row } = await this.lock(tx, actor, id, false);
      return tx.$queryRaw<{ id: string; action: string; snapshot: AnalysisSnapshot }[]>`SELECT id, action, snapshot FROM customer_complaint_analysis_history WHERE analysis_id = ${row.id}::uuid AND organization_id = ${row.organizationId}::uuid ORDER BY version`;
    }, { isolationLevel: 'ReadCommitted' });
  }

  async candidates(actor: AdminActor, complaintId: string, rawSection: string) {
    const section = sectionValue(rawSection); const organizationId = this.scope(actor); uuid(complaintId);
    return this.prisma.$transaction(async tx => {
      const source = await this.ledger.readCase(tx, actor, complaintId, 'read');
      const [existing] = await tx.$queryRaw<StoredAnalysis[]>(Prisma.sql`SELECT ${columns} FROM customer_complaint_analyses WHERE complaint_id = ${complaintId}::uuid AND section = ${section} AND organization_id = ${organizationId}::uuid FOR SHARE`);
      let departmentId: string | undefined;
      if (existing && section === 'FAE') { await this.writer(tx, actor, existing, source); departmentId = existing.departmentId; }
      else await this.dispatcher(tx, actor, source);
      const users = await tx.user.findMany({ where: { organizationId, accountType: 'INTERNAL', status: 'ACTIVE' }, select: { id: true }, orderBy: { id: 'asc' } });
      const result = [];
      for (const user of users) {
        const permissions = await adminPermissions(tx, user.id, organizationId);
        if ([LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write, ANALYSIS_PERMISSIONS[section]].some(code => !permissions.includes(code))) continue;
        for (const assignment of await this.organizations.currentAssignments(user.id, organizationId, new Date(), tx)) {
          if (departmentId && assignment.department.id !== departmentId) continue;
          result.push(await this.candidate(tx, organizationId, user.id, assignment.id, section));
        }
      }
      return result;
    }, { isolationLevel: 'ReadCommitted' });
  }

  async listFAETasks(actor: AdminActor) {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async tx => {
      await assertActiveAuthentication(tx, actor);
      await assertAdminAccess(tx, actor, organizationId, [LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write, ANALYSIS_PERMISSIONS.FAE]);
      const rows = await tx.$queryRaw<StoredAnalysis[]>(Prisma.sql`SELECT ${columns} FROM customer_complaint_analyses WHERE organization_id = ${organizationId}::uuid AND assignee_user_id = ${actor.id}::uuid AND section = 'FAE' ORDER BY complaint_id, id`);
      const tasks = [];
      for (const entry of rows) {
        const { row, source } = await this.lock(tx, actor, entry.id, false);
        if (row.assigneeUserId !== actor.id || source.status !== 'FOLLOWING') continue;
        const appointments = await this.organizations.currentAssignments(actor.id, organizationId, new Date(), tx);
        if (!appointments.some(item => item.id === row.assigneeAssignmentId && item.department.id === row.departmentId)) continue;
        tasks.push({ kind: 'CUSTOMER_COMPLAINT_FAE' as const, analysis: await this.project(tx, actor, row) });
      }
      return tasks;
    }, { isolationLevel: 'ReadCommitted' });
  }

  async assign(actor: AdminActor, complaintId: string, rawSection: string, input: AnalysisAssignmentInput, traceId: string, key?: string) {
    const section = sectionValue(rawSection); const organizationId = this.scope(actor); uuid(complaintId); version(input.expectedVersion, 0);
    uuid(input.assigneeUserId); uuid(input.assigneeAssignmentId);
    const authorize = async (tx: AdminTransaction) => { const source = await this.ledger.readCase(tx, actor, complaintId, 'analysis'); await this.dispatcher(tx, actor, source); };
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'CUSTOMER_ANALYSIS_ASSIGNED', payload: { complaintId, section, ...input }, permission: [LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write], isolationLevel: 'ReadCommitted' }, async tx => {
      const [existing] = await tx.$queryRaw<StoredAnalysis[]>(Prisma.sql`SELECT ${columns} FROM customer_complaint_analyses WHERE organization_id = ${organizationId}::uuid AND complaint_id = ${complaintId}::uuid AND section = ${section} FOR UPDATE`);
      if ((existing?.version ?? 0) !== input.expectedVersion) analysisFail('CONCURRENCY_CONFLICT', 409);
      if (existing && section === 'FAE') analysisFail('CUSTOMER_ANALYSIS_TRANSFER_REQUIRED', 409);
      const target = await this.candidate(tx, organizationId, input.assigneeUserId, input.assigneeAssignmentId, section);
      const id = existing?.id ?? randomUUID();
      if (existing) await tx.$executeRaw`UPDATE customer_complaint_analyses SET assignee_user_id = ${target.userId}::uuid, assignee_assignment_id = ${target.assignmentId}::uuid, department_id = ${target.departmentId}::uuid,
        version = version + 1, updated_by_user_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND version = ${input.expectedVersion}`;
      else await tx.$executeRaw`INSERT INTO customer_complaint_analyses (id, organization_id, complaint_id, section, assignee_user_id, assignee_assignment_id, department_id, updated_by_user_id)
        VALUES (${id}::uuid, ${organizationId}::uuid, ${complaintId}::uuid, ${section}, ${target.userId}::uuid, ${target.assignmentId}::uuid, ${target.departmentId}::uuid, ${actor.id}::uuid)`;
      await authorize(tx);
      const currentTarget = await this.candidate(tx, organizationId, target.userId, target.assignmentId, section);
      if (currentTarget.departmentId !== target.departmentId) analysisFail('CONCURRENCY_CONFLICT', 409);
      return this.record(tx, actor, await this.locate(tx, id), 'ASSIGNED', traceId);
    }, authorize);
  }

  async transfer(actor: AdminActor, id: string, input: AnalysisAssignmentInput, traceId: string, key?: string) {
    const organizationId = this.scope(actor); uuid(id); uuid(input.assigneeUserId); uuid(input.assigneeAssignmentId); version(input.expectedVersion);
    const authorize = async (tx: AdminTransaction) => { const { row, source } = await this.lock(tx, actor, id, true); await this.writer(tx, actor, row, source); };
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'CUSTOMER_ANALYSIS_TRANSFERRED', payload: { id, ...input }, permission: [LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write, ANALYSIS_PERMISSIONS.FAE], isolationLevel: 'ReadCommitted' }, async tx => {
      const { row, source } = await this.lock(tx, actor, id, true);
      if (row.version !== input.expectedVersion) analysisFail('CONCURRENCY_CONFLICT', 409);
      const target = await this.candidate(tx, organizationId, input.assigneeUserId, input.assigneeAssignmentId, 'FAE');
      assertAnalysisTransfer(row.section, row.departmentId, target.departmentId);
      await this.writer(tx, actor, row, await this.ledger.readCase(tx, actor, source.id, 'analysis'));
      const changed = await tx.$executeRaw`UPDATE customer_complaint_analyses SET assignee_user_id = ${target.userId}::uuid, assignee_assignment_id = ${target.assignmentId}::uuid, department_id = ${target.departmentId}::uuid,
        version = version + 1, updated_by_user_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND version = ${input.expectedVersion}`;
      if (changed !== 1) analysisFail('CONCURRENCY_CONFLICT', 409);
      const currentTarget = await this.candidate(tx, organizationId, target.userId, target.assignmentId, 'FAE');
      if (currentTarget.departmentId !== target.departmentId) analysisFail('CONCURRENCY_CONFLICT', 409);
      assertAnalysisTransfer(row.section, row.departmentId, currentTarget.departmentId);
      return this.record(tx, actor, await this.locate(tx, id), 'TRANSFERRED', traceId);
    }, authorize);
  }

  async save(actor: AdminActor, id: string, input: AnalysisSaveInput, traceId: string, key?: string, requiredSection?: AnalysisSection) {
    const organizationId = this.scope(actor); uuid(id); version(input.expectedVersion);
    const authorize = async (tx: AdminTransaction) => {
      const { row, source } = await this.lock(tx, actor, id, true);
      if (requiredSection && row.section !== requiredSection) analysisFail('CUSTOMER_ANALYSIS_SECTION_INVALID');
      await this.writer(tx, actor, row, source);
    };
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'CUSTOMER_ANALYSIS_SAVED', payload: { id, requiredSection, ...input }, permission: [LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write], isolationLevel: 'ReadCommitted' }, async tx => {
      const { row } = await this.lock(tx, actor, id, true);
      if (row.version !== input.expectedVersion) analysisFail('CONCURRENCY_CONFLICT', 409);
      const { organizationId: _scope, ...body } = input as AnalysisSaveInput & { organizationId?: string };
      const content = analysisContent(body, row.section);
      // File authorization never calls assertAttachable: only the content mutation validates file evidence.
      if (content.fileIds.length) await this.files.assertAttachable(tx, actor, { resourceType: ANALYSIS_RESOURCE_TYPE, resourceId: id }, content.fileIds);
      await authorize(tx);
      const changed = await tx.$executeRaw`UPDATE customer_complaint_analyses SET content = ${JSON.stringify(content)}::jsonb, version = version + 1,
        updated_by_user_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND version = ${input.expectedVersion}`;
      if (changed !== 1) analysisFail('CONCURRENCY_CONFLICT', 409);
      return this.record(tx, actor, await this.locate(tx, id), 'SAVED', traceId);
    }, authorize);
  }

  private async record(tx: AdminTransaction, actor: AdminActor, row: StoredAnalysis, action: 'ASSIGNED' | 'TRANSFERRED' | 'SAVED', traceId: string) {
    const snapshot = await this.project(tx, actor, row);
    await tx.$executeRaw`INSERT INTO customer_complaint_analysis_history (id, organization_id, analysis_id, version, action, snapshot)
      VALUES (${randomUUID()}::uuid, ${row.organizationId}::uuid, ${row.id}::uuid, ${row.version}, ${action}, ${JSON.stringify(snapshot)}::jsonb)`;
    await this.audit.record({ organizationId: row.organizationId, actorUserId: actor.id, action: `CUSTOMER_ANALYSIS_${action}`, resourceType: ANALYSIS_RESOURCE_TYPE,
      resourceId: row.id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: row.version, targetUserId: row.assigneeUserId } }, tx);
    return snapshot;
  }

  async authorizeFile(tx: AdminTransaction, actor: AdminActor, id: string, action: FileResourceAction) {
    const reader = action === 'read' ? { ...actor, scopeOrganizationId: (await this.locate(tx, id)).organizationId } : actor;
    const { row, source } = await this.lock(tx, reader, id, action !== 'read');
    if (action !== 'read') await this.writer(tx, actor, row, source);
    return { organizationId: row.organizationId, version: row.version };
  }
}
