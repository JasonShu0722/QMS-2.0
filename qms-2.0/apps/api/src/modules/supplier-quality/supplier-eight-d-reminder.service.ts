import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { OutboxService } from '../task-notification/outbox.service.js';
import type { AtomicOutboxHandler, OutboxEvent } from '../task-notification/outbox-worker.service.js';
import { WorkflowClosureRoundService } from '../workflow/workflow-closure-round.service.js';
import { SupplierEightDService } from './supplier-eight-d.service.js';
import { SupplierEightDDeadlineService } from './supplier-eight-d-deadline.service.js';
import { supplierReminderEvent, supplierReminderPlans, supplierReminderPayload, supplierProjectionPlans, supplierChangePayload, supplierDeadlineChangePayload } from './supplier-eight-d-reminder.policy.js';
import type { SupplierEightDActor } from './supplier-eight-d.types.js';
import type { SupplierEightDClosurePending, SupplierEightDReminderPlan, SupplierEightDTaskContext } from './supplier-eight-d-task.types.js';

export const supplierTaskInaccessible = (error: unknown) => error instanceof HttpException && [403, 404].includes(error.getStatus());

@Injectable()
export class SupplierEightDReminderService implements AtomicOutboxHandler {
  readonly eventTypes = ['SUPPLIER_EIGHT_D_REMINDER_DUE', 'SUPPLIER_EIGHT_D_CHANGED', 'SUPPLIER_EIGHT_D_DEADLINE_CHANGED'];
  private cursor: string | null = null;

  constructor(private readonly prisma: PrismaService, private readonly core: SupplierEightDService,
    private readonly deadlines: SupplierEightDDeadlineService, private readonly rounds: WorkflowClosureRoundService,
    private readonly outbox: OutboxService) {}

  async candidates(tx: Prisma.TransactionClient, cursor: string | null, limit: number, actor?: SupplierEightDActor, supplierProblemId?: string) {
    return tx.$queryRaw<Array<{ supplierProblemId: string; organizationId: string }>>(Prisma.sql`
      SELECT c.supplier_problem_id AS "supplierProblemId", c.organization_id AS "organizationId"
      FROM supplier_eight_d_controls c JOIN supplier_quality_problems s
        ON s.id = c.supplier_problem_id AND s.owner_organization_id = c.organization_id AND s.problem_index_id = c.problem_index_id
      WHERE c.closed_at IS NULL AND s.response_form = 'EIGHT_D'
        ${cursor ? Prisma.sql`AND c.supplier_problem_id > ${cursor}::uuid` : Prisma.empty}
        ${supplierProblemId ? Prisma.sql`AND c.supplier_problem_id = ${supplierProblemId}::uuid` : Prisma.empty}
        ${!actor ? Prisma.empty : actor.accountType === 'INTERNAL' ? Prisma.sql`AND c.organization_id = ${actor.organizationId}::uuid`
          : Prisma.sql`AND s.reply_mode = 'SUPPLIER' AND s.supplier_organization_id = ${actor.organizationId}::uuid AND s.released_to_supplier_at IS NOT NULL`}
      ORDER BY c.supplier_problem_id LIMIT ${limit}`);
  }

  async poll(limit = 25, now = new Date()): Promise<{ examined: number; enqueued: number; deliveryState: 'PENDING_PROJECTION' }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isFinite(now.getTime())) throw new BadRequestException();
    const select = () => this.prisma.$transaction(tx => this.candidates(tx, this.cursor, limit));
    let candidates = await select();
    if (!candidates.length && this.cursor) { this.cursor = null; candidates = await select(); }
    let enqueued = 0;
    for (const candidate of candidates) {
      try {
        enqueued += await this.prisma.$transaction(async tx => {
          const c = await this.core.notificationContext(tx, candidate.organizationId, candidate.supplierProblemId);
          if (!c) return 0;
          let count = 0;
          for (const plan of await this.plans(tx, c, now)) {
            if (!await this.current(tx, c, plan)) continue;
            const event = supplierReminderEvent(c, plan);
            const inserted = await tx.$executeRaw`INSERT INTO supplier_eight_d_reminder_slots (event_key, organization_id, supplier_problem_id)
              VALUES (${event.eventKey}, ${c.organizationId}::uuid, ${c.supplierProblemId}::uuid) ON CONFLICT (event_key) DO NOTHING`;
            if (!inserted) continue;
            await this.outbox.enqueue(event, tx);
            count++;
          }
          return count;
        }, { isolationLevel: 'ReadCommitted', timeout: 30000 });
      } catch (error) { if (!supplierTaskInaccessible(error)) throw error; }
      this.cursor = candidate.supplierProblemId;
    }
    return { examined: candidates.length, enqueued, deliveryState: 'PENDING_PROJECTION' };
  }

  async handle(tx: Prisma.TransactionClient, event: OutboxEvent): Promise<void> {
    if (event.eventType === 'SUPPLIER_EIGHT_D_CHANGED') {
      const p = supplierChangePayload(event);
      const c = await this.core.notificationContext(tx, p.organizationId, p.supplierProblemId);
      if (!c || c.problemId !== p.problemId || c.rowVersion !== p.rowVersion || c.contentVersion !== p.contentVersion
        || p.instanceVersion !== undefined && c.instanceVersion !== p.instanceVersion) return;
      const plans = await this.projectionPlans(tx, c);
      // Ordinary saves/deadline edits need no assignment ping. Their live task view is already current.
      if (!['ISSUE', 'RELEASE', 'SUBMIT', 'RETURN', 'ANALYSIS_COMPLETE'].includes(p.action)) return;
      for (const plan of plans.filter(plan => plan.kind !== 'EXTENSION_PENDING')) await this.project(tx, c, plan, event);
      return;
    }
    if (event.eventType === 'SUPPLIER_EIGHT_D_DEADLINE_CHANGED') {
      const p = supplierDeadlineChangePayload(event);
      const c = await this.core.notificationContext(tx, p.organizationId, p.supplierProblemId);
      if (!c) return;
      const plans = await this.projectionPlans(tx, c);
      for (const plan of plans.filter(plan => plan.kind === 'EXTENSION_PENDING' && plan.requestId === p.requestId && plan.requestVersion === p.version)) {
        await this.project(tx, c, plan, event);
      }
      return;
    }
    const p = supplierReminderPayload(event);
    const c = await this.core.notificationContext(tx, p.organizationId, p.supplierProblemId);
    if (!c || c.problemId !== p.problemId) return;
    const plan = (await this.plans(tx, c, new Date())).find(plan => plan.fingerprint === p.fingerprint && plan.slot === p.slot);
    if (plan) await this.project(tx, c, plan, event);
  }

  private async project(tx: Prisma.TransactionClient, c: SupplierEightDTaskContext, plan: SupplierEightDReminderPlan, event: OutboxEvent) {
    if (!await this.current(tx, c, plan)) return;
    const subject = plan.kind === 'HANDLING_REMINDER' ? '供应商8D办理提醒' : plan.kind === 'CLOSURE_REMINDER' ? '供应商8D关闭审核提醒' : '供应商8D延期审批提醒';
    // Only a committed IN_APP projection is delivered; no email or external portal delivery is claimed.
    await tx.$executeRaw`INSERT INTO supplier_eight_d_notifications
      (id, organization_id, supplier_problem_id, recipient_user_id, event_key, kind, subject, body, context)
      VALUES (${randomUUID()}::uuid, ${c.organizationId}::uuid, ${c.supplierProblemId}::uuid, ${plan.userId}::uuid, ${event.eventKey}, ${plan.kind}, ${subject},
        ${`问题 ${c.reportNumber}：${subject}。请进入本单工作区核对当前阶段及真实职责。`}, ${JSON.stringify(plan)}::jsonb)
      ON CONFLICT (event_key, recipient_user_id) DO NOTHING`;
  }

  async plans(tx: Prisma.TransactionClient, c: SupplierEightDTaskContext, now: Date): Promise<SupplierEightDReminderPlan[]> {
    const { closure, extensions } = await this.selection(tx, c);
    return supplierReminderPlans(c, closure, extensions, now);
  }

  async projectionPlans(tx: Prisma.TransactionClient, c: SupplierEightDTaskContext): Promise<SupplierEightDReminderPlan[]> {
    const { closure, extensions } = await this.selection(tx, c);
    return supplierProjectionPlans(c, closure, extensions);
  }

  private async selection(tx: Prisma.TransactionClient, c: SupplierEightDTaskContext) {
    let closure: SupplierEightDClosurePending | null = null;
    if (c.submittedRevisionId && !c.handling && !c.closedAt) {
      const round = await this.rounds.readProjection(tx, c.organizationId, c.problemId);
      if (round?.status === 'PENDING') {
        const recipients = await this.rounds.notificationRecipients(tx, c.organizationId, c.problemId, round.id, round.version);
        closure = { roundId: round.id, roundVersion: round.version, duties: round.duties.filter(d => recipients.includes(d.userId)) };
      }
    }
    return { closure, extensions: await this.deadlines.notificationPending(tx, c.organizationId, c.supplierProblemId) };
  }

  async current(tx: Prisma.TransactionClient, c: SupplierEightDTaskContext, plan: SupplierEightDReminderPlan): Promise<boolean> {
    if (!await this.core.canTaskRecipient(tx, c, plan.userId, 'NOTIFICATION')) return false;
    if (plan.kind === 'HANDLING_REMINDER') return this.core.canTaskRecipient(tx, c, plan.userId, 'HANDLING');
    if (plan.kind === 'EXTENSION_PENDING') return !!plan.requestId && !!plan.requestVersion
      && this.deadlines.canNotifyPending(tx, c.organizationId, c.supplierProblemId, plan.requestId, plan.requestVersion, plan.userId);
    if (!plan.roundId || !plan.roundVersion) return false;
    const recipients = await this.rounds.notificationRecipients(tx, c.organizationId, c.problemId, plan.roundId, plan.roundVersion);
    const round = await this.rounds.readProjection(tx, c.organizationId, c.problemId);
    return recipients.includes(plan.userId) && round?.id === plan.roundId && round.version === plan.roundVersion
      && round.duties.some(d => d.userId === plan.userId && d.duty === plan.duty && d.status === 'PENDING');
  }
}
