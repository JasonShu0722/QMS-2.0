import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { isSecurityConcurrencyConflict } from '../../common/security/session-security.js';
import { inboxPage } from '../task-notification/task.service.js';
import { WorkflowClosureRoundService } from '../workflow/workflow-closure-round.service.js';
import { WorkflowDeadlineExtensionService } from '../workflow/workflow-deadline-extension.service.js';
import { assertWorkflowFeature, type WorkflowActor } from '../workflow/workflow-access-policy.js';
import { deadlineDueAt, deadlineStageOpen } from '../workflow/workflow-deadline-extension.policy.js';
import type { WorkflowDeadlineStage } from '../workflow/workflow-deadline-extension.types.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';
import { ProcessEightDService } from './process-eight-d.service.js';
import { ProcessEightDReminderService, type ProcessEightDNotificationKind } from './process-eight-d-reminder.service.js';
import { handlingReminderStage } from './process-eight-d-reminder.policy.js';
import type { ProcessEightDNotificationDto, ProcessEightDNotificationPageDto, ProcessEightDTaskDto, ProcessEightDTaskPageDto, ProcessEightDTaskQueryDto } from './process-eight-d-task.dto.js';

const inaccessible = (error: unknown) => error instanceof HttpException && [403, 404].includes(error.getStatus());

@Injectable()
export class ProcessEightDTaskService {
  constructor(private readonly prisma: PrismaService, private readonly reports: ProcessEightDService,
    private readonly extensions: WorkflowDeadlineExtensionService, private readonly rounds: WorkflowClosureRoundService, private readonly reminders: ProcessEightDReminderService) {}

  async list(actor: WorkflowActor, query: ProcessEightDTaskQueryDto): Promise<ProcessEightDTaskPageDto> {
    this.validate(actor, query);
    const { pageSize, offset } = inboxPage(query);
    const candidates = await this.transaction(async tx => {
      await this.authorize(tx, actor, 'task:read');
      const extensionProblemIds = await this.extensions.candidateProblemIds(tx, actor);
      return this.reports.taskCandidates(tx, actor.organizationId, actor.id, extensionProblemIds, query.problemId);
    });
    const items: ProcessEightDTaskDto[] = [];
    // Release each problem's structure locks before the next problem acquires user locks.
    for (const candidate of candidates) {
      try {
        items.push(...await this.transaction(async tx => {
          await this.authorize(tx, actor, 'task:read');
          const items: ProcessEightDTaskDto[] = [];
          const record = await this.reports.lockRecord(tx, actor, candidate.problemId, 'READ');
          await this.reports.authorizeRead(tx, actor, record);
          const c = await this.reports.deadlineContext(tx, record);
          const stage = handlingReminderStage(c);
          const base = { problemId: c.problemId, reportNumber: record.problem.reportNumber, workflowVersionId: c.workflowVersionId,
            userId: actor.id, rowVersion: c.rowVersion, contentVersion: c.contentVersion, instanceVersion: c.instanceVersion };
          if (actor.id === c.ownerUserId && stage && record.instance.status === 'RUNNING' && record.instance.currentNodeId === c.ownerNodeId) {
            try {
              await this.reports.authorizeEdit(tx, actor, record);
              const requests = await this.extensions.readProjection(tx, c.organizationId, c.problemId);
              const extensionStages = actor.id !== c.professionalUserId && await this.extensions.policyCurrent(tx, c)
                ? (['ANALYSIS', 'SUBMISSION', 'CLOSURE'] as WorkflowDeadlineStage[]).filter(s => deadlineDueAt(c, s) !== null && deadlineStageOpen(c, s)
                  && !requests.some(r => r.stage === s && ['LEADER_PENDING', 'QUALITY_PENDING'].includes(r.status))) : [];
              const dueAt = deadlineDueAt(c, stage);
              items.push({ ...base, id: `handling:${c.problemId}`, kind: 'HANDLING', stage, status: 'HANDLING', dueAt, overdue: !!dueAt && new Date(dueAt).getTime() < Date.now(),
                extensionRequestId: null, extensionRequestVersion: null, requestedDueAt: null, extensionStages,
                actions: ['OPEN_REPORT', ...(stage === 'ANALYSIS' ? ['ANALYSIS_COMPLETE' as const] : ['SUBMIT' as const]), ...(extensionStages.length ? ['REQUEST_EXTENSION' as const] : [])] });
            } catch (error) { if (!inaccessible(error)) throw error; }
          }
          try {
            for (const r of await this.extensions.eligible(tx, actor, c.problemId)) {
              items.push({ ...base, id: `extension:${r.id}`, kind: 'EXTENSION', stage: r.stage, status: r.status as 'LEADER_PENDING' | 'QUALITY_PENDING',
                dueAt: r.originalDueAt, overdue: new Date(r.originalDueAt).getTime() < Date.now(), extensionRequestId: r.id, extensionRequestVersion: r.version,
                requestedDueAt: r.requestedDueAt, extensionStages: [], actions: ['OPEN_REPORT', 'DECIDE_EXTENSION'] });
            }
          } catch (error) { if (!inaccessible(error)) throw error; }
          await this.reports.authorizeRead(tx, actor, record);
          if (items.some(item => item.kind === 'HANDLING')) {
            try { await this.reports.authorizeEdit(tx, actor, record); }
            catch (error) {
              if (!inaccessible(error)) throw error;
              items.splice(0, items.length, ...items.filter(item => item.kind !== 'HANDLING'));
            }
          }
          await this.authorize(tx, actor, 'task:read');
          return items;
        }));
      } catch (error) { if (!inaccessible(error)) throw error; }
    }
    await this.transaction(tx => this.authorize(tx, actor, 'task:read'));
    items.sort((a, b) => (a.dueAt ?? '\uffff').localeCompare(b.dueAt ?? '\uffff') || a.id.localeCompare(b.id));
    return { items: items.slice(offset, offset + pageSize), total: items.length };
  }

  async notifications(actor: WorkflowActor, query: ProcessEightDTaskQueryDto): Promise<ProcessEightDNotificationPageDto> {
    this.validate(actor, query);
    const { pageSize, offset } = inboxPage(query);
    const rows = await this.transaction(async tx => {
      await this.authorize(tx, actor, 'notification:read');
      return tx.$queryRaw<Array<{ id: string; problemId: string; kind: ProcessEightDNotificationKind; subject: string; body: string; context: unknown; deliveredAt: Date }>>(Prisma.sql`
        SELECT id, problem_id AS "problemId", kind, subject, body, context, delivered_at AS "deliveredAt" FROM process_eight_d_notifications
        WHERE organization_id = ${actor.organizationId}::uuid AND recipient_user_id = ${actor.id}::uuid
        ${query.problemId ? Prisma.sql`AND problem_id = ${query.problemId}::uuid` : Prisma.empty} ORDER BY problem_id, delivered_at DESC, id DESC`);
    });
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const group = groups.get(row.problemId) ?? [];
      group.push(row); groups.set(row.problemId, group);
    }
    const items: ProcessEightDNotificationDto[] = [];
    for (const [problemId, group] of groups) {
      try {
        items.push(...await this.transaction(async tx => {
          await this.authorize(tx, actor, 'notification:read');
          const record = await this.reports.lockRecord(tx, actor, problemId, 'READ');
          await this.reports.authorizeRead(tx, actor, record);
          const c = await this.reports.deadlineContext(tx, record);
          const items: ProcessEightDNotificationDto[] = [];
          const visible = await this.reminders.notificationVisibility(tx, c, actor.id);
          for (const row of group) {
            if (await visible(row.context)) items.push({ id: row.id, problemId, kind: row.kind, subject: row.subject, body: row.body, deliveredAt: row.deliveredAt.toISOString() });
          }
          await this.reports.authorizeRead(tx, actor, record);
          await this.authorize(tx, actor, 'notification:read');
          return items;
        }));
      } catch (error) { if (!inaccessible(error)) throw error; }
    }
    await this.transaction(tx => this.authorize(tx, actor, 'notification:read'));
    items.sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt) || a.id.localeCompare(b.id));
    return { items: items.slice(offset, offset + pageSize), total: items.length };
  }

  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try { return await this.prisma.$transaction(work, { isolationLevel: 'ReadCommitted', timeout: 30000 }); }
    catch (error) { if (isSecurityConcurrencyConflict(error)) workflowError('CONCURRENCY_CONFLICT', 409); throw error; }
  }
  private async authorize(tx: Prisma.TransactionClient, actor: WorkflowActor, permission: 'task:read' | 'notification:read') {
    await this.rounds.assertActor(tx, actor);
    await assertWorkflowFeature(tx, actor, actor.organizationId, permission);
  }
  private validate(actor: WorkflowActor, query: ProcessEightDTaskQueryDto) {
    if (!query || typeof query !== 'object' || Object.keys(query).some(k => !['organizationId', 'problemId', 'pageSize', 'offset'].includes(k))
      || (query.problemId !== undefined && !isUUID(query.problemId)) || (query.organizationId !== undefined && !isUUID(query.organizationId))) throw new BadRequestException();
    if (query.organizationId && query.organizationId.toLowerCase() !== actor.organizationId) workflowError('ORGANIZATION_SCOPE_DENIED', 403);
  }
}
