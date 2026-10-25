import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { WorkflowClosureRoundService } from '../workflow/workflow-closure-round.service.js';
import { assertWorkflowFeature, type WorkflowActor } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';
import type { ClosureInboxQueryDto, ClosureNotificationDto, ClosureNotificationPageDto, ClosureTaskDto, ClosureTaskPageDto } from './closure-inbox.dto.js';
import { inboxPage } from './task.service.js';

@Injectable()
export class ClosureInboxService {
  constructor(private readonly prisma: PrismaService, private readonly rounds: WorkflowClosureRoundService) {}

  async list(actor: WorkflowActor, query: ClosureInboxQueryDto): Promise<ClosureTaskPageDto> {
    const { pageSize, offset } = inboxPage(query);
    return this.prisma.$transaction(async tx => {
      const items = await this.pending(tx, actor, query);
      await this.rounds.assertActor(tx, actor);
      return { items: items.slice(offset, offset + pageSize), total: items.length };
    }, { isolationLevel: 'ReadCommitted', timeout: 30_000 });
  }

  async notifications(actor: WorkflowActor, query: ClosureInboxQueryDto): Promise<ClosureNotificationPageDto> {
    const { pageSize, offset } = inboxPage(query);
    return this.prisma.$transaction(async tx => {
      await assertWorkflowFeature(tx, actor, actor.organizationId, 'notification:read');
      const pending = await this.pending(tx, actor, query);
      const roundIds = [...new Set(pending.map(duty => duty.roundId))];
      const rows = pending.length ? await tx.$queryRaw<Array<{ id: string; roundId: string; roundVersion: number; kind: 'CLOSURE_PENDING'; subject: string; body: string; deliveredAt: Date }>>(Prisma.sql`
        SELECT id, round_id AS "roundId", round_version AS "roundVersion", kind, subject, body, delivered_at AS "deliveredAt"
        FROM closure_notifications WHERE organization_id = ${actor.organizationId}::uuid AND recipient_user_id = ${actor.id}::uuid
          AND round_id IN (${Prisma.join(roundIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY delivered_at DESC, id DESC`) : [];
      const items: ClosureNotificationDto[] = [];
      for (const row of rows) {
        const duties = pending.filter(duty => duty.roundId === row.roundId && duty.roundVersion === row.roundVersion);
        const first = duties[0];
        if (!first) continue;
        items.push({ ...row, deliveredAt: row.deliveredAt.toISOString(), problemId: first.problemId, reportNumber: first.reportNumber,
          duties: ['PROFESSIONAL', 'SECTION_MANAGER', 'MINISTER'].filter(duty => duties.some(item => item.duty === duty)) as ClosureNotificationDto['duties'],
          requiresJointConfirmation: first.requiresJointConfirmation, jointDuties: first.jointDuties });
      }
      await assertWorkflowFeature(tx, actor, actor.organizationId, 'notification:read');
      await this.rounds.assertActor(tx, actor);
      return { items: items.slice(offset, offset + pageSize), total: items.length };
    }, { isolationLevel: 'ReadCommitted', timeout: 30_000 });
  }

  private async pending(tx: Prisma.TransactionClient, actor: WorkflowActor, query: ClosureInboxQueryDto): Promise<ClosureTaskDto[]> {
    if (query.organizationId && query.organizationId.toLowerCase() !== actor.organizationId) workflowError('ORGANIZATION_SCOPE_DENIED', 403);
    await assertWorkflowFeature(tx, actor, actor.organizationId, 'task:read');
    const eligible = await this.rounds.eligibleDuties(actor, tx);
    const items: ClosureTaskDto[] = [];
    for (const projection of eligible) {
      if ((query.problemId && query.problemId.toLowerCase() !== projection.problemId) || (query.roundId && query.roundId.toLowerCase() !== projection.roundId)) continue;
      const round = await this.rounds.readProjection(tx, actor.organizationId, projection.problemId);
      if (!round || round.id !== projection.roundId || round.version !== projection.roundVersion || round.status !== 'PENDING') continue;
      const duty = round.duties.find(item => item.duty === projection.duty && item.userId === actor.id && item.status === 'PENDING');
      if (!duty) continue;
      const problem = await tx.problemIndex.findFirstOrThrow({ where: { id: projection.problemId, organizationId: actor.organizationId }, select: { reportNumber: true } });
      items.push({ id: duty.id, roundId: round.id, roundVersion: round.version, problemId: round.problemId,
        reportNumber: problem.reportNumber, workflowVersionId: round.workflowVersionId, duty: duty.duty, status: 'PENDING',
        contentVersion: round.contentVersion, createdAt: round.createdAt, userId: duty.userId, canAct: true,
        requiresJointConfirmation: projection.samePersonDuties.length > 1, jointDuties: projection.samePersonDuties });
    }
    await assertWorkflowFeature(tx, actor, actor.organizationId, 'task:read');
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }
}
