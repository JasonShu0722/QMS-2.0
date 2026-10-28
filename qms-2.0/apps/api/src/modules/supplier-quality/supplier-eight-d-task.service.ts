import { BadRequestException, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertActiveAuthentication, isSecurityConcurrencyConflict } from '../../common/security/session-security.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { WorkflowClosureRoundService } from '../workflow/workflow-closure-round.service.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';
import { SupplierEightDService } from './supplier-eight-d.service.js';
import { SupplierEightDDeadlineService } from './supplier-eight-d-deadline.service.js';
import { SupplierEightDReminderService, supplierTaskInaccessible } from './supplier-eight-d-reminder.service.js';
import { supplierHandlingStage } from './supplier-eight-d-reminder.policy.js';
import type { SupplierEightDActor } from './supplier-eight-d.types.js';
import type { SupplierEightDTaskContext, SupplierEightDReminderPlan } from './supplier-eight-d-task.types.js';
import type { SupplierEightDTaskDto, SupplierEightDTaskPageDto, SupplierEightDTaskQueryDto, SupplierEightDNotificationDto, SupplierEightDNotificationPageDto } from './supplier-eight-d-task.dto.js';

@Injectable()
export class SupplierEightDTaskService {
  constructor(private readonly prisma: PrismaService, private readonly core: SupplierEightDService,
    private readonly deadlines: SupplierEightDDeadlineService, private readonly rounds: WorkflowClosureRoundService,
    private readonly reminders: SupplierEightDReminderService) {}

  async list(actor: SupplierEightDActor, query: SupplierEightDTaskQueryDto): Promise<SupplierEightDTaskPageDto> {
    const candidates = await this.select(actor, query, 'task:read');
    const items: SupplierEightDTaskDto[] = [];
    for (const candidate of candidates) {
      try {
        items.push(...await this.transaction(async tx => {
          const c = await this.context(tx, actor, candidate.supplierProblemId, 'task:read');
          if (!c) return [];
          const result: SupplierEightDTaskDto[] = [], now = Date.now();
          const base = { supplierProblemId: c.supplierProblemId, problemId: c.problemId, reportNumber: c.reportNumber,
            workflowVersionId: c.workflowVersionId, userId: actor.id, rowVersion: c.rowVersion, contentVersion: c.contentVersion,
            instanceVersion: c.instanceVersion, duty: null, roundId: null, roundVersion: null, requestId: null, requestVersion: null, requestedDueAt: null };
          const stage = supplierHandlingStage(c);
          if (stage && c.handlingUserIds.includes(actor.id) && await this.core.canTaskRecipient(tx, c, actor.id, 'HANDLING')) {
            const dueAt = stage === 'ANALYSIS' ? c.analysisDueAt : c.submissionDueAt;
            result.push({ ...base, id: `handling:${c.supplierProblemId}`, kind: 'HANDLING', stage, status: 'HANDLING', dueAt,
              overdue: !!dueAt && new Date(dueAt).getTime() < now, actions: ['OPEN_REPORT', stage === 'ANALYSIS' ? 'ANALYSIS_COMPLETE' : 'SUBMIT'] });
          }
          if (actor.accountType === 'INTERNAL' && c.submittedRevisionId && !c.handling) {
            const snapshot = await this.rounds.readSnapshot(tx, actor, c.problemId);
            const round = snapshot.current;
            if (snapshot.sourcesCurrent && round?.status === 'PENDING') {
              for (const duty of round.duties.filter(d => d.userId === actor.id && d.status === 'PENDING')) {
                if (!await this.rounds.eligible(tx, actor, snapshot, duty.duty)) continue;
                result.push({ ...base, id: `closure:${round.id}:${duty.duty}`, kind: 'CLOSURE', stage: 'CLOSURE', status: 'PENDING',
                  dueAt: c.closureDueAt, overdue: !!c.closureDueAt && new Date(c.closureDueAt).getTime() < now, duty: duty.duty,
                  roundId: round.id, roundVersion: round.version, actions: ['OPEN_REPORT', 'DECIDE_CLOSURE'] });
              }
            }
          }
          for (const request of await this.deadlines.notificationPending(tx, c.organizationId, c.supplierProblemId)) {
            if (request.pendingUserId !== actor.id || !await this.deadlines.canNotifyPending(tx, c.organizationId, c.supplierProblemId, request.id, request.version, actor.id)) continue;
            result.push({ ...base, id: `extension:${request.id}:${request.version}`, kind: 'EXTENSION', stage: request.stage, status: request.status,
              duty: request.status === 'QUALITY_PENDING' ? 'SQE' : 'MANAGER', dueAt: request.originalDueAt,
              overdue: new Date(request.originalDueAt).getTime() < now, requestId: request.id, requestVersion: request.version,
              requestedDueAt: request.requestedDueAt, actions: ['OPEN_REPORT', 'DECIDE_EXTENSION'] });
          }
          await this.authorize(tx, actor, 'task:read');
          if (!await this.core.canTaskRecipient(tx, c, actor.id, 'READ')) return [];
          return result;
        }));
      } catch (error) { if (!supplierTaskInaccessible(error)) throw error; }
    }
    await this.transaction(tx => this.authorize(tx, actor, 'task:read'));
    return { items, ...this.page(candidates, query.pageSize ?? 25) };
  }

  async notifications(actor: SupplierEightDActor, query: SupplierEightDTaskQueryDto): Promise<SupplierEightDNotificationPageDto> {
    const candidates = await this.select(actor, query, 'notification:read');
    const items: SupplierEightDNotificationDto[] = [];
    for (const candidate of candidates) {
      try {
        items.push(...await this.transaction(async tx => {
          const c = await this.context(tx, actor, candidate.supplierProblemId, 'notification:read');
          if (!c) return [];
          const plans = [...await this.reminders.plans(tx, c, new Date()), ...await this.reminders.projectionPlans(tx, c)].filter(p => p.userId === actor.id);
          if (!plans.length) return [];
          // Inbox shows the latest committed projection per current duty, not an unbounded reminder history.
          const rows = await tx.$queryRaw<Array<{ id: string; kind: SupplierEightDNotificationDto['kind']; subject: string; body: string; context: unknown; deliveredAt: Date }>>(Prisma.sql`
            SELECT DISTINCT ON (context->>'fingerprint') id, kind, subject, body, context, delivered_at AS "deliveredAt" FROM supplier_eight_d_notifications
            WHERE organization_id = ${c.organizationId}::uuid AND supplier_problem_id = ${c.supplierProblemId}::uuid AND recipient_user_id = ${actor.id}::uuid
              AND context->>'fingerprint' IN (${Prisma.join(plans.map(p => p.fingerprint))})
            ORDER BY context->>'fingerprint', delivered_at DESC, id DESC`);
          const result: SupplierEightDNotificationDto[] = [];
          for (const row of rows) {
            const saved = row.context as Partial<SupplierEightDReminderPlan> | null;
            const plan = plans.find(p => p.userId === actor.id && p.kind === row.kind && p.fingerprint === saved?.fingerprint);
            if (!plan || !await this.reminders.current(tx, c, plan)) continue;
            result.push({ id: row.id, supplierProblemId: c.supplierProblemId, problemId: c.problemId, kind: row.kind,
              subject: row.subject, body: row.body, channel: 'IN_APP', status: 'DELIVERED', deliveredAt: row.deliveredAt.toISOString() });
          }
          result.sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt) || a.id.localeCompare(b.id));
          await this.authorize(tx, actor, 'notification:read');
          return await this.core.canTaskRecipient(tx, c, actor.id, 'NOTIFICATION') ? result : [];
        }));
      } catch (error) { if (!supplierTaskInaccessible(error)) throw error; }
    }
    await this.transaction(tx => this.authorize(tx, actor, 'notification:read'));
    return { items, ...this.page(candidates, query.pageSize ?? 25) };
  }

  private async select(actor: SupplierEightDActor, query: SupplierEightDTaskQueryDto, permission: 'task:read' | 'notification:read') {
    if (!query || typeof query !== 'object' || Object.keys(query).some(k => !['organizationId', 'supplierProblemId', 'cursor', 'pageSize'].includes(k))
      || ['organizationId', 'supplierProblemId', 'cursor'].some(k => query[k as keyof SupplierEightDTaskQueryDto] !== undefined && !isUUID(String(query[k as keyof SupplierEightDTaskQueryDto])))
      || query.pageSize !== undefined && (!Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100)) throw new BadRequestException();
    if (query.organizationId && query.organizationId.toLowerCase() !== actor.organizationId.toLowerCase()) workflowError('ORGANIZATION_SCOPE_DENIED', 403);
    return this.transaction(async tx => {
      await this.authorize(tx, actor, permission);
      return this.reminders.candidates(tx, query.cursor ?? null, query.pageSize ?? 25, actor, query.supplierProblemId);
    });
  }

  private page(candidates: Array<{ supplierProblemId: string }>, limit: number) {
    return { examined: candidates.length, nextCursor: candidates.length === limit ? candidates.at(-1)!.supplierProblemId : null };
  }
  private async context(tx: Prisma.TransactionClient, actor: SupplierEightDActor, id: string, permission: 'task:read' | 'notification:read'): Promise<SupplierEightDTaskContext | null> {
    await this.authorize(tx, actor, permission);
    const record = await this.core.lockRecord(tx, actor, id, true);
    await this.core.authorizeRead(tx, actor, record);
    const c = await this.core.notificationContext(tx, record.control.organizationId, id);
    return c && await this.core.canTaskRecipient(tx, c, actor.id, 'READ') ? c : null;
  }
  private async authorize(tx: Prisma.TransactionClient, actor: SupplierEightDActor, permission: 'task:read' | 'notification:read') {
    if (!['INTERNAL', 'SUPPLIER'].includes(actor.accountType) || actor.scopeOrganizationId && actor.scopeOrganizationId !== actor.organizationId) workflowError('ORGANIZATION_SCOPE_DENIED', 403);
    await assertActiveAuthentication(tx, actor, 'SHARE');
    await assertWorkflowFeature(tx, actor, actor.organizationId,
      actor.accountType === 'SUPPLIER' && permission === 'task:read' ? 'supplier-quality:responses:read' : permission);
    await assertWorkflowFeature(tx, actor, actor.organizationId, actor.accountType === 'SUPPLIER' ? 'supplier-quality:responses:read' : 'supplier-quality:issues:read');
  }
  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try { return await this.prisma.$transaction(work, { isolationLevel: 'ReadCommitted', timeout: 30000 }); }
    catch (error) { if (isSecurityConcurrencyConflict(error)) workflowError('CONCURRENCY_CONFLICT', 409); throw error; }
  }
}
