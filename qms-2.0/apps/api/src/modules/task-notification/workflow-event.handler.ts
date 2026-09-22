import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AtomicOutboxHandler, OutboxEvent } from './outbox-worker.service.js';
import { MAX_WORKFLOW_SLA_MINUTES } from '../workflow/workflow.types.js';
import { eligibleWorkflowRecipients, workflowObject as object } from './workflow-recipients.js';
import { handleWorkflowTiming, scheduleWorkflowTiming, WORKFLOW_TIMING_EVENTS } from './workflow-timing.js';
import { notificationContent } from '../platform-configuration/notification-content.js';

interface WorkflowEventPayload {
  schemaVersion: 1;
  organizationId: string;
  problemIndexId: string;
  instanceId: string;
  workflowVersionId: string;
  instanceVersion: number;
  previousNodeId: string | null;
  currentNodeId: string;
  action: string;
  status: 'RUNNING' | 'COMPLETED';
}

@Injectable()
export class WorkflowEventHandler implements AtomicOutboxHandler {
  readonly eventTypes = ['WORKFLOW_STARTED', 'WORKFLOW_ACTION_COMPLETED', ...WORKFLOW_TIMING_EVENTS];

  async handle(tx: Prisma.TransactionClient, event: OutboxEvent): Promise<'deferred' | void> {
    if (WORKFLOW_TIMING_EVENTS.some((type) => type === event.eventType)) return handleWorkflowTiming(tx, event);
    const payload = parseEvent(event);
    await tx.$queryRaw`SELECT id FROM workflow_instances WHERE id = ${payload.instanceId}::uuid FOR UPDATE`;
    const instance = await tx.workflowInstance.findUnique({ where: { id: payload.instanceId } });
    if (!instance || instance.problemIndexId !== payload.problemIndexId || instance.organizationId !== payload.organizationId || instance.workflowVersionId !== payload.workflowVersionId
      || instance.version < payload.instanceVersion) invalidEvent();
    const problem = await tx.problemIndex.findFirst({ where: { id: instance.problemIndexId, organizationId: payload.organizationId } });
    const node = await tx.workflowNode.findFirst({ where: { id: payload.currentNodeId, organizationId: payload.organizationId, workflowVersionId: payload.workflowVersionId } });
    const receipt = await tx.workflowMutation.findUnique({ where: { instanceId_instanceVersion: { instanceId: instance.id, instanceVersion: payload.instanceVersion } } });
    const response = object(receipt?.response);
    if (!problem || !node || !receipt || receipt.organizationId !== payload.organizationId || receipt.workflowVersionId !== payload.workflowVersionId
      || receipt.action !== payload.action || response.instanceId !== instance.id || response.version !== payload.instanceVersion
      || response.workflowVersionId !== payload.workflowVersionId || response.currentNodeId !== payload.currentNodeId || response.status !== payload.status
      || receipt.nodeId !== (payload.previousNodeId ?? payload.currentNodeId)) invalidEvent();
    if (instance.status === 'CANCELLED' || problem.workflowInstanceId !== instance.id) return;
    if (payload.instanceVersion <= instance.taskProjectionVersion) return;
    if (payload.instanceVersion !== instance.taskProjectionVersion + 1) return 'deferred';

    await tx.workflowTask.updateMany({
      where: { workflowInstanceId: instance.id, status: { in: ['PENDING', 'IN_PROGRESS', 'OVERDUE'] } },
      data: { status: 'COMPLETED', completedAt: event.createdAt, version: { increment: 1 } },
    });
    if (payload.status === 'RUNNING') {
      const config = object(node.config);
      const slaMinutes = config.slaMinutes;
      if (slaMinutes !== undefined && (!Number.isSafeInteger(slaMinutes) || Number(slaMinutes) < 1 || Number(slaMinutes) > MAX_WORKFLOW_SLA_MINUTES)) invalidEvent();
      const task = await tx.workflowTask.create({ data: {
        organizationId: payload.organizationId, workflowInstanceId: instance.id, workflowVersionId: payload.workflowVersionId,
        workflowNodeId: node.id, entryInstanceVersion: payload.instanceVersion, enteredAt: event.createdAt,
        dueAt: slaMinutes === undefined ? null : new Date(event.createdAt.getTime() + Number(slaMinutes) * 60_000),
      } });
      const activeProblem = problem.archivedAt === null && !['ARCHIVED', 'CLOSED'].includes(problem.status);
      if (activeProblem) await scheduleWorkflowTiming(tx, task, problem.id, config);
      if (activeProblem && instance.version === payload.instanceVersion && instance.currentNodeId === node.id && instance.status === payload.status) {
        const recipients = await eligibleWorkflowRecipients(tx, payload.organizationId, config.assignment);
        const content = await notificationContent(tx, payload.organizationId, 'TASK_ASSIGNED', { reportNumber: problem.reportNumber, nodeName: node.name, dueAt: task.dueAt?.toISOString() ?? '' });
        if (content) await tx.notification.createMany({ data: recipients.map((recipient) => ({
          organizationId: payload.organizationId, workflowTaskId: task.id, recipientUserId: recipient.id,
          deduplicationKey: `workflow-task:${instance.id}:${payload.instanceVersion}:${recipient.id}`,
          channel: 'IN_APP', status: 'DELIVERED', sentAt: new Date(),
          ...content,
        })) });
      }
    }
    await tx.workflowInstance.update({ where: { id: instance.id }, data: { taskProjectionVersion: payload.instanceVersion } });
  }
}

function parseEvent(event: OutboxEvent): WorkflowEventPayload {
  const value = object(event.payload);
  const uuidKeys = ['organizationId', 'problemIndexId', 'instanceId', 'workflowVersionId', 'currentNodeId'];
  if (value.schemaVersion !== 1 || uuidKeys.some((key) => typeof value[key] !== 'string' || !isUUID(value[key] as string))
    || !Number.isSafeInteger(value.instanceVersion) || Number(value.instanceVersion) < 1
    || (value.previousNodeId !== null && (typeof value.previousNodeId !== 'string' || !isUUID(value.previousNodeId)))
    || !['START', 'SUBMIT', 'APPROVE', 'VERIFY', 'REJECT', 'RETURN', 'REOPEN', 'CLOSE'].includes(String(value.action))
    || !['RUNNING', 'COMPLETED'].includes(String(value.status))) invalidEvent();
  const payload = value as unknown as WorkflowEventPayload;
  if (event.aggregateType !== 'WorkflowInstance' || event.aggregateId !== payload.instanceId
    || event.eventKey !== `workflow:${payload.instanceId}:${payload.instanceVersion}`
    || (payload.action === 'START'
      ? event.eventType !== 'WORKFLOW_STARTED' || payload.instanceVersion !== 1 || payload.previousNodeId !== null
      : event.eventType !== 'WORKFLOW_ACTION_COMPLETED' || payload.instanceVersion < 2 || payload.previousNodeId === null)
    || (payload.status === 'COMPLETED') !== (payload.action === 'CLOSE')) invalidEvent();
  return payload;
}

function invalidEvent(): never {
  throw new Error('WORKFLOW_EVENT_INVALID');
}
