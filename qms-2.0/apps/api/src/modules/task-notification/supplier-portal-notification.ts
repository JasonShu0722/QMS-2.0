import { Prisma, type ProblemIndex, type WorkflowNode, type WorkflowTask } from '../../generated/prisma/client.js';
import { featurePredicate, workflowAccessPredicate } from '../workflow/workflow-access-policy.js';
import { notificationContent } from '../platform-configuration/notification-content.js';
import { eligibleWorkflowRecipients, workflowObject } from './workflow-recipients.js';

export async function projectSupplierNotification(tx: Prisma.TransactionClient, problem: ProblemIndex, node: WorkflowNode, task: WorkflowTask,
  eventKey: string, kind: 'TASK_ASSIGNED' | 'TASK_REMINDER', sentAt: Date): Promise<boolean> {
  const assignment = workflowObject(workflowObject(node.config).assignment);
  if (problem.domainCode !== 'supplier-quality' || problem.sourceType !== 'supplier-quality' || node.type !== 'ACTION'
    || assignment.permission !== 'supplier-quality:responses:write') return false;
  if (!problem.sourceId) throw new Error('SUPPLIER_NOTIFICATION_RESOURCE_INVALID');
  const record = await tx.supplierQualityProblem.findFirst({ where: {
    id: problem.sourceId, problemIndexId: problem.id, ownerOrganizationId: problem.organizationId,
  }, select: { id: true, supplierOrganizationId: true, replyMode: true, releasedToSupplierAt: true } });
  if (!record) throw new Error('SUPPLIER_NOTIFICATION_RESOURCE_INVALID');
  if (record.replyMode !== 'SUPPLIER') return false;
  if (!record.releasedToSupplierAt) return true;
  const supplier = await tx.organization.findFirst({ where: { id: record.supplierOrganizationId, type: 'SUPPLIER', status: 'ACTIVE' } });
  if (!supplier) throw new Error('SUPPLIER_NOTIFICATION_ORGANIZATION_INVALID');
  const candidates = await eligibleWorkflowRecipients(tx, supplier.id, workflowObject(node.config).assignment);
  if (!candidates.length) return true;
  const recipients = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT recipient.id FROM users recipient
    WHERE recipient.id IN (${Prisma.join(candidates.map((candidate) => Prisma.sql`${candidate.id}::uuid`))})
      AND recipient.organization_id = ${supplier.id}::uuid AND recipient.account_type = 'SUPPLIER'
      AND ${featurePredicate(Prisma.sql`recipient.id`, Prisma.sql`${supplier.id}::uuid`, Prisma.sql`'supplier-quality:responses:read'`)}
      AND ${featurePredicate(Prisma.sql`recipient.id`, Prisma.sql`${supplier.id}::uuid`, Prisma.sql`'notification:read'`)}`);
  if (!recipients.length) return true;
  const content = await notificationContent(tx, supplier.id, kind, { reportNumber: problem.reportNumber, nodeName: node.name, dueAt: task.dueAt?.toISOString() ?? '' });
  if (!content) return true;
  await tx.supplierPortalNotification.createMany({ data: recipients.map((recipient) => ({
    eventKey, supplierOrganizationId: supplier.id, recipientUserId: recipient.id,
    ownerOrganizationId: problem.organizationId, workflowTaskId: task.id, supplierProblemId: record.id,
    kind, ruleVersion: content.ruleVersion, subject: content.subject, body: content.body, createdAt: sentAt,
  })), skipDuplicates: true });
  return true;
}

export function supplierPortalNotificationScope(userId: string, organizationId: string): Prisma.Sql {
  const user = Prisma.sql`${userId}::uuid`;
  const organization = Prisma.sql`${organizationId}::uuid`;
  return Prisma.sql`FROM supplier_portal_notifications portal_notice
    JOIN workflow_tasks task ON task.id = portal_notice.workflow_task_id AND task.organization_id = portal_notice.owner_organization_id
    JOIN workflow_instances instance ON instance.id = task.workflow_instance_id AND instance.organization_id = task.organization_id
    JOIN workflow_nodes node ON node.id = task.workflow_node_id AND node.organization_id = task.organization_id AND node.workflow_version_id = task.workflow_version_id
    JOIN problem_indexes problem ON problem.id = instance.problem_index_id AND problem.organization_id = task.organization_id
    JOIN supplier_quality_problems supplier_problem ON supplier_problem.id = portal_notice.supplier_problem_id
      AND supplier_problem.problem_index_id = problem.id AND supplier_problem.owner_organization_id = problem.organization_id
      AND supplier_problem.supplier_organization_id = portal_notice.supplier_organization_id
    WHERE portal_notice.supplier_organization_id = ${organization} AND portal_notice.recipient_user_id = ${user}
      AND supplier_problem.reply_mode = 'SUPPLIER' AND supplier_problem.released_to_supplier_at IS NOT NULL
      AND problem.domain_code = 'supplier-quality' AND problem.source_type = 'supplier-quality' AND problem.source_id = supplier_problem.id
      AND problem.archived_at IS NULL AND problem.status NOT IN ('CLOSED', 'ARCHIVED')
      AND problem.workflow_instance_id = instance.id AND instance.status = 'RUNNING'
      AND instance.current_node_id = task.workflow_node_id AND instance.version = task.entry_instance_version
      AND task.status IN ('PENDING', 'IN_PROGRESS', 'OVERDUE')
      AND node.type = 'ACTION' AND node.config->'assignment'->>'permission' = 'supplier-quality:responses:write'
      AND portal_notice.kind IN ('TASK_ASSIGNED', 'TASK_REMINDER')
      AND ${featurePredicate(user, organization, Prisma.sql`'supplier-quality:responses:read'`)}
      AND ${featurePredicate(user, organization, Prisma.sql`'notification:read'`)}
      AND ${workflowAccessPredicate(user, organization, Prisma.sql`node.config->'assignment'`)}`;
}
