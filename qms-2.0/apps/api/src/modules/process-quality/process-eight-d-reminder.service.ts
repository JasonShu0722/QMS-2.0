import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { OutboxService } from '../task-notification/outbox.service.js';
import type { AtomicOutboxHandler, OutboxEvent } from '../task-notification/outbox-worker.service.js';
import { WorkflowClosureRoundService } from '../workflow/workflow-closure-round.service.js';
import { WorkflowDeadlineExtensionService } from '../workflow/workflow-deadline-extension.service.js';
import { canProcessWorkflowNode, featurePredicate } from '../workflow/workflow-access-policy.js';
import { canonical, jsonObject } from '../workflow/workflow-runtime-policy.js';
import { deadlineDueAt } from '../workflow/workflow-deadline-extension.policy.js';
import type { WorkflowDeadlineContext, WorkflowDeadlineStage } from '../workflow/workflow-deadline-extension.types.js';
import { ProcessEightDService } from './process-eight-d.service.js';
import { handlingReminderStage, reminderSlot } from './process-eight-d-reminder.policy.js';

export type ProcessEightDNotificationKind = 'HANDLING_REMINDER' | 'EXTENSION_PENDING' | 'EXTENSION_CANCELLED' | 'CLOSURE_REMINDER';
type Notice = { kind: ProcessEightDNotificationKind; fingerprint: string; recipients: string[]; stage: WorkflowDeadlineStage; dueAt: string | null; slot: number | null; requestId?: string; requestVersion?: number; roundId?: string; roundVersion?: number; current?: (userId: string) => Promise<boolean> };
const ignored = (error: unknown) => error instanceof HttpException && [403, 404].includes(error.getStatus());

@Injectable()
export class ProcessEightDReminderService implements AtomicOutboxHandler {
  readonly eventTypes = ['PROCESS_EIGHT_D_REMINDER_DUE', 'WORKFLOW_DEADLINE_EXTENSION_CHANGED'];
  private cursor: string | null = null;
  constructor(private readonly prisma: PrismaService, private readonly reports: ProcessEightDService,
    private readonly extensions: WorkflowDeadlineExtensionService, private readonly rounds: WorkflowClosureRoundService, private readonly outbox: OutboxService) {}

  // Register in the real worker maintenance cycle; outbox delivery uses the normal atomic handler/retry receipts.
  async poll(limit = 25, now = new Date()): Promise<{ examined: number; enqueued: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isFinite(now.getTime())) throw new BadRequestException();
    const select = () => this.reports.reminderCandidates(this.cursor, limit);
    let candidates = await select();
    if (!candidates.length && this.cursor) { this.cursor = null; candidates = await select(); }
    let enqueued = 0;
    for (const candidate of candidates) {
      try {
        enqueued += await this.prisma.$transaction(async tx => {
          const c = await this.reports.notificationContext(tx, candidate.organizationId, candidate.problemId);
          if (!c) return 0;
          const notices = await this.notices(tx, c, now);
          let count = 0;
          for (const notice of notices) {
            if (notice.slot === null || !notice.recipients.length || notice.kind === 'EXTENSION_CANCELLED') continue;
            const eventKey = `eight-d:${c.problemId}:${notice.fingerprint}:${notice.slot}`;
            const inserted = await tx.$executeRaw`INSERT INTO process_eight_d_reminder_slots (event_key, organization_id, problem_id)
              VALUES (${eventKey}, ${c.organizationId}::uuid, ${c.problemId}::uuid) ON CONFLICT (event_key) DO NOTHING`;
            if (!inserted) continue;
            await this.outbox.enqueue({ eventKey, aggregateType: 'ProcessEightDReminder', aggregateId: c.problemId, eventType: 'PROCESS_EIGHT_D_REMINDER_DUE',
              payload: { schemaVersion: 1, organizationId: c.organizationId, problemId: c.problemId, fingerprint: notice.fingerprint, slot: notice.slot } }, tx);
            count++;
          }
          return count;
        }, { isolationLevel: 'ReadCommitted', timeout: 30000 });
      } catch (error) { if (!ignored(error)) throw error; }
      this.cursor = candidate.problemId;
    }
    return { examined: candidates.length, enqueued };
  }

  async handle(tx: Prisma.TransactionClient, event: OutboxEvent): Promise<void> {
    const p = jsonObject(event.payload);
    if (p.schemaVersion !== 1 || typeof p.organizationId !== 'string' || !isUUID(p.organizationId) || typeof p.problemId !== 'string' || !isUUID(p.problemId)) throw new Error('PROCESS_EIGHT_D_REMINDER_EVENT_INVALID');
    const extensionEvent = event.eventType === 'WORKFLOW_DEADLINE_EXTENSION_CHANGED';
    if (extensionEvent) {
      if (event.aggregateType !== 'WorkflowDeadlineExtension' || typeof p.requestId !== 'string' || !isUUID(p.requestId) || event.aggregateId !== p.requestId
        || !Number.isSafeInteger(p.requestVersion) || Number(p.requestVersion) < 1 || event.eventKey !== `deadline:${p.requestId}:${p.requestVersion}`) throw new Error('PROCESS_EIGHT_D_REMINDER_EVENT_INVALID');
    } else if (event.eventType !== 'PROCESS_EIGHT_D_REMINDER_DUE' || event.aggregateType !== 'ProcessEightDReminder' || event.aggregateId !== p.problemId
      || typeof p.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(p.fingerprint) || !Number.isSafeInteger(p.slot) || Number(p.slot) < 0
      || event.eventKey !== `eight-d:${p.problemId}:${p.fingerprint}:${p.slot}`) throw new Error('PROCESS_EIGHT_D_REMINDER_EVENT_INVALID');
    const c = await this.reports.notificationContext(tx, p.organizationId, p.problemId);
    if (!c) return;
    const notices = await this.notices(tx, c, new Date());
    const notice = extensionEvent ? notices.find(n => n.requestId === p.requestId && n.requestVersion === p.requestVersion)
      : notices.find(n => n.fingerprint === p.fingerprint && n.slot === p.slot);
    if (!notice || !notice.recipients.length) return;
    const problem = await tx.problemIndex.findFirstOrThrow({ where: { id: c.problemId, organizationId: c.organizationId }, select: { reportNumber: true } });
    const subject = notice.kind === 'EXTENSION_CANCELLED' ? '延期申请失效，请重新申请' : notice.kind === 'EXTENSION_PENDING' ? '延期审批待办' : notice.kind === 'CLOSURE_REMINDER' ? '关闭审核催办' : '过程8D办理催办';
    for (const recipient of notice.recipients) {
      // Recheck after resolver waits, immediately before atomic projection; never synthesize a user session.
      if (!await this.recipient(tx, c, recipient) || (notice.current && !await notice.current(recipient))) continue;
      const { current: _current, ...saved } = notice;
      await tx.$executeRaw`INSERT INTO process_eight_d_notifications (id, organization_id, problem_id, recipient_user_id, event_key, kind, subject, body, context)
        VALUES (${randomUUID()}::uuid, ${c.organizationId}::uuid, ${c.problemId}::uuid, ${recipient}::uuid, ${event.eventKey}, ${notice.kind}, ${subject},
          ${`问题 ${problem.reportNumber}：${subject}。请进入问题工作区查看当前职责、原期限和延期记录。`},
          ${JSON.stringify({ ...saved, recipients: undefined })}::jsonb) ON CONFLICT (event_key, recipient_user_id) DO NOTHING`;
    }
  }

  async notificationVisible(tx: Prisma.TransactionClient, c: WorkflowDeadlineContext, userId: string, raw: unknown): Promise<boolean> {
    return (await this.notificationVisibility(tx, c, userId))(raw);
  }

  async notificationVisibility(tx: Prisma.TransactionClient, c: WorkflowDeadlineContext, userId: string): Promise<(raw: unknown) => Promise<boolean>> {
    const notices = await this.notices(tx, c, new Date(), false);
    return async raw => {
      const saved = jsonObject(raw);
      const notice = notices.find(n => n.kind === saved.kind && n.fingerprint === saved.fingerprint && n.recipients.includes(userId));
      return !!notice && await this.recipient(tx, c, userId) && (!notice.current || await notice.current(userId));
    };
  }

  private async notices(tx: Prisma.TransactionClient, c: WorkflowDeadlineContext, now: Date, invalidate = true): Promise<Notice[]> {
    const selection = await this.extensions.selectParticipants(tx, c);
    const validExtensions = await this.extensions.reconcile(tx, c, invalidate, selection);
    if (!await this.extensions.policyCurrent(tx, c)) return [];
    const notices: Notice[] = [];
    const stamp = { organizationId: c.organizationId, problemId: c.problemId, instanceId: c.instanceId, workflowVersionId: c.workflowVersionId,
      ownerUserId: c.ownerUserId, professionalUserId: c.professionalUserId, responsibleSectionDepartmentId: c.responsibleSectionDepartmentId, policy: c.policy };
    const add = async (notice: Omit<Notice, 'fingerprint'>) => {
      const recipients: string[] = [];
      for (const userId of new Set(notice.recipients)) if (await this.recipient(tx, c, userId)) recipients.push(userId);
      const { slot: _slot, recipients: _recipients, current: _current, ...facts } = notice;
      notices.push({ ...notice, recipients, fingerprint: createHash('sha256').update(canonical({ ...stamp, ...facts })).digest('hex') });
    };
    const hours = c.policy?.reminderEveryHours ?? null;
    const stage = handlingReminderStage(c);
    const instance = await tx.workflowInstance.findFirst({ where: { id: c.instanceId, organizationId: c.organizationId }, select: { currentNodeId: true } });
    if (stage && instance?.currentNodeId === c.ownerNodeId) {
      const dueAt = deadlineDueAt(c, stage);
      await add({ kind: 'HANDLING_REMINDER', recipients: [c.ownerUserId, c.professionalUserId], stage, dueAt, slot: reminderSlot(dueAt, hours, now) });
    } else if (c.submittedAt && !c.closedAt) {
      const round = await this.rounds.readProjection(tx, c.organizationId, c.problemId);
      if (round?.status === 'PENDING') {
        const recipients = await this.rounds.notificationRecipients(tx, c.organizationId, c.problemId, round.id, round.version);
        await add({ kind: 'CLOSURE_REMINDER', recipients, stage: 'CLOSURE', dueAt: c.closureDueAt, slot: reminderSlot(c.closureDueAt, hours, now), roundId: round.id, roundVersion: round.version,
          current: async userId => {
            const duties = round.duties.filter(d => d.userId === userId && d.status === 'PENDING');
            for (const duty of duties) if (await selection.currentParticipant(duty.participant)) return true;
            return false;
          } });
      }
    }
    for (const r of validExtensions) {
      const recipient = this.extensions.pendingUser(r);
      const slot = reminderSlot(r.updatedAt, hours, now);
      await add({ kind: 'EXTENSION_PENDING', recipients: recipient && recipient !== r.applicantUserId ? [recipient] : [], stage: r.stage,
        // The change event already delivers immediately; periodic slot zero must not deliver it again.
        dueAt: r.originalDueAt, slot: slot === 0 ? null : slot, requestId: r.id, requestVersion: r.version, current: () => selection.current() });
    }
    const allRequests = await this.extensions.readProjection(tx, c.organizationId, c.problemId);
    const cancellations = allRequests.filter(r => r.status === 'CANCELLED' && deadlineDueAt(c, r.stage) === r.originalDueAt
      && !allRequests.some(newer => newer.id !== r.id && newer.stage === r.stage && newer.createdAt >= r.updatedAt));
    for (const r of cancellations) await add({ kind: 'EXTENSION_CANCELLED', recipients: r.applicantUserId === c.ownerUserId ? [r.applicantUserId] : [], stage: r.stage, dueAt: r.originalDueAt, slot: null, requestId: r.id, requestVersion: r.version });
    return notices;
  }

  private async recipient(tx: Prisma.TransactionClient, c: WorkflowDeadlineContext, userId: string): Promise<boolean> {
    const [allowed] = await tx.$queryRaw<{ allowed: boolean }[]>`SELECT
      (${featurePredicate(Prisma.sql`${userId}::uuid`, Prisma.sql`${c.organizationId}::uuid`, Prisma.sql`'task:read'`)}
       AND ${featurePredicate(Prisma.sql`${userId}::uuid`, Prisma.sql`${c.organizationId}::uuid`, Prisma.sql`'notification:read'`)}) AS allowed`;
    return allowed?.allowed === true && await canProcessWorkflowNode(tx, userId, c.organizationId, { assigneeUserId: userId })
      && await this.reports.canNotifyRecipient(tx, c, userId);
  }
}
