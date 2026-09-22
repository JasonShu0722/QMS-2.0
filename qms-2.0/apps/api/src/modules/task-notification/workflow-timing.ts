import { isUUID } from 'class-validator';
import type { Prisma, WorkflowTask } from '../../generated/prisma/client.js';
import type { OutboxEvent } from './outbox-worker.service.js';
import { eligibleWorkflowRecipients, workflowObject } from './workflow-recipients.js';
import { notificationContent } from '../platform-configuration/notification-content.js';

export const WORKFLOW_TIMING_EVENTS = ['WORKFLOW_TASK_REMINDER', 'WORKFLOW_TASK_OVERDUE', 'WORKFLOW_TASK_ESCALATION'] as const;

function timingPlans(task: WorkflowTask, config: Record<string, unknown>) {
  if (!task.dueAt) return [];
  const plans = [{ eventType: 'WORKFLOW_TASK_OVERDUE', suffix: 'overdue', scheduledAt: task.dueAt }];
  if (config.escalation !== undefined) plans.push({ eventType: 'WORKFLOW_TASK_ESCALATION', suffix: 'escalation', scheduledAt: task.dueAt });
  const reminders = config.reminders ?? [];
  if (!Array.isArray(reminders)) invalid();
  const offsets = new Set<number>();
  for (const reminder of reminders) {
    const offset = workflowObject(reminder).offsetMinutes;
    if (!Number.isSafeInteger(offset) || Number(offset) < 0 || Number(offset) > Number(config.slaMinutes) || offsets.has(Number(offset))) invalid();
    offsets.add(Number(offset));
    plans.push({ eventType: 'WORKFLOW_TASK_REMINDER', suffix: `reminder:${offset}`, scheduledAt: new Date(task.dueAt.getTime() - Number(offset) * 60_000) });
  }
  return plans;
}

export async function scheduleWorkflowTiming(tx: Prisma.TransactionClient, task: WorkflowTask, problemIndexId: string, config: Record<string, unknown>) {
  await tx.outboxEvent.createMany({ data: timingPlans(task, config).map((plan) => ({
    eventKey: `workflow-task:${task.id}:${plan.suffix}`,
    aggregateType: 'WorkflowTask', aggregateId: task.id, eventType: plan.eventType, availableAt: plan.scheduledAt,
    payload: {
      schemaVersion: 1, taskId: task.id, organizationId: task.organizationId, problemIndexId,
      instanceId: task.workflowInstanceId, workflowVersionId: task.workflowVersionId, nodeId: task.workflowNodeId,
      entryInstanceVersion: task.entryInstanceVersion, scheduledAt: plan.scheduledAt.toISOString(),
    },
  })) });
}

export async function handleWorkflowTiming(tx: Prisma.TransactionClient, event: OutboxEvent): Promise<'deferred' | void> {
  const payload = workflowObject(event.payload);
  const uuidKeys = ['taskId', 'organizationId', 'problemIndexId', 'instanceId', 'workflowVersionId', 'nodeId'];
  if (payload.schemaVersion !== 1 || uuidKeys.some((key) => typeof payload[key] !== 'string' || !isUUID(String(payload[key])))
    || !Number.isSafeInteger(payload.entryInstanceVersion) || Number(payload.entryInstanceVersion) < 1
    || typeof payload.scheduledAt !== 'string' || event.aggregateType !== 'WorkflowTask' || event.aggregateId !== payload.taskId) invalid();
  await tx.$queryRaw`SELECT id FROM workflow_instances WHERE id = ${String(payload.instanceId)}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM workflow_tasks WHERE id = ${String(payload.taskId)}::uuid FOR UPDATE`;
  const task = await tx.workflowTask.findUnique({ where: { id: String(payload.taskId) } });
  if (!task || task.organizationId !== payload.organizationId || task.workflowInstanceId !== payload.instanceId
    || task.workflowVersionId !== payload.workflowVersionId || task.workflowNodeId !== payload.nodeId || task.entryInstanceVersion !== payload.entryInstanceVersion) invalid();
  const node = await tx.workflowNode.findUnique({ where: { id: task.workflowNodeId } });
  if (!node || node.organizationId !== task.organizationId || node.workflowVersionId !== task.workflowVersionId) invalid();
  const config = workflowObject(node.config);
  const plan = timingPlans(task, config).find((candidate) => event.eventKey === `workflow-task:${task.id}:${candidate.suffix}` && candidate.eventType === event.eventType);
  if (!plan || payload.scheduledAt !== plan.scheduledAt.toISOString()) invalid();
  const instance = await tx.workflowInstance.findUnique({ where: { id: task.workflowInstanceId } });
  if (!instance || !instance.problemIndexId || instance.problemIndexId !== payload.problemIndexId || instance.organizationId !== task.organizationId || instance.workflowVersionId !== task.workflowVersionId
    || instance.version < task.entryInstanceVersion) invalid();
  const receipt = await tx.workflowMutation.findUnique({ where: { instanceId_instanceVersion: { instanceId: instance.id, instanceVersion: task.entryInstanceVersion } } });
  const response = workflowObject(receipt?.response);
  if (!receipt || receipt.organizationId !== task.organizationId || receipt.workflowVersionId !== task.workflowVersionId || response.instanceId !== instance.id
    || response.workflowVersionId !== task.workflowVersionId || response.version !== task.entryInstanceVersion || response.currentNodeId !== task.workflowNodeId || response.status !== 'RUNNING') invalid();
  const problem = await tx.problemIndex.findFirst({ where: { id: instance.problemIndexId, organizationId: task.organizationId } });
  if (!problem) invalid();
  if (instance.status === 'CANCELLED' || problem.workflowInstanceId !== instance.id) return;
  if (plan.scheduledAt > event.processingAt) return 'deferred';
  if (problem.archivedAt || ['ARCHIVED', 'CLOSED'].includes(problem.status) || instance.status !== 'RUNNING' || instance.currentNodeId !== task.workflowNodeId
    || instance.version !== task.entryInstanceVersion || !['PENDING', 'IN_PROGRESS', 'OVERDUE'].includes(task.status)) return;
  if (event.eventType === 'WORKFLOW_TASK_OVERDUE') {
    if (task.status !== 'OVERDUE') await tx.workflowTask.update({ where: { id: task.id }, data: { status: 'OVERDUE', version: { increment: 1 } } });
    return;
  }
  const escalation = event.eventType === 'WORKFLOW_TASK_ESCALATION';
  const recipients = await eligibleWorkflowRecipients(tx, task.organizationId, escalation ? config.escalation : config.assignment, escalation ? 'problem-index:read' : 'workflow:act');
  const content = await notificationContent(tx, task.organizationId, escalation ? 'TASK_ESCALATED' : 'TASK_REMINDER', { reportNumber: problem.reportNumber, nodeName: node.name, dueAt: task.dueAt!.toISOString() });
  if (!content) return;
  await tx.notification.createMany({ data: recipients.map((recipient) => ({
    organizationId: task.organizationId, workflowTaskId: task.id, recipientUserId: recipient.id,
    deduplicationKey: `${event.eventKey}:${recipient.id}`, channel: 'IN_APP', status: 'DELIVERED', sentAt: event.processingAt,
    ...content,
  })), skipDuplicates: true });
}

function invalid(): never { throw new Error('WORKFLOW_TIMING_EVENT_INVALID'); }
