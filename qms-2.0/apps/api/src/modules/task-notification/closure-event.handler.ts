import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { WorkflowClosureRoundService } from '../workflow/workflow-closure-round.service.js';
import { jsonObject } from '../workflow/workflow-runtime-policy.js';
import type { AtomicOutboxHandler, OutboxEvent } from './outbox-worker.service.js';

@Injectable()
export class ClosureEventHandler implements AtomicOutboxHandler {
  readonly eventTypes = ['WORKFLOW_CLOSURE_CHANGED'];
  constructor(private readonly rounds: WorkflowClosureRoundService) {}

  async handle(tx: Prisma.TransactionClient, event: OutboxEvent): Promise<void> {
    const payload = jsonObject(event.payload);
    if (event.eventType !== 'WORKFLOW_CLOSURE_CHANGED' || event.aggregateType !== 'WorkflowClosureRound' || payload.schemaVersion !== 1
      || ['organizationId', 'problemId', 'roundId'].some(key => typeof payload[key] !== 'string' || !isUUID(payload[key] as string))
      || !Number.isSafeInteger(payload.roundVersion) || Number(payload.roundVersion) < 1 || Number(payload.roundVersion) > 2147483647
      || event.aggregateId !== payload.roundId || event.eventKey !== `closure:${payload.roundId}:${payload.roundVersion}`) {
      throw new Error('WORKFLOW_CLOSURE_EVENT_INVALID');
    }
    const organizationId = payload.organizationId as string;
    const problemId = payload.problemId as string;
    const roundId = payload.roundId as string;
    const roundVersion = payload.roundVersion as number;
    const recipients = await this.rounds.notificationRecipients(tx, organizationId, problemId, roundId, roundVersion);
    if (!recipients.length) return;
    const problem = await tx.problemIndex.findFirstOrThrow({ where: { id: problemId, organizationId }, select: { reportNumber: true } });
    for (const recipientId of recipients) {
      await tx.$executeRaw`INSERT INTO closure_notifications (id, organization_id, round_id, round_version, recipient_user_id, kind, subject, body)
        VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${roundId}::uuid, ${roundVersion}, ${recipientId}::uuid,
          'CLOSURE_PENDING', ${'关闭审核待办'}, ${`问题 ${problem.reportNumber} 有关闭审核职责待处理，请核对本轮内容及全部待确认职责。`})
        ON CONFLICT (round_id, round_version, recipient_user_id, kind) DO NOTHING`;
    }
  }
}
