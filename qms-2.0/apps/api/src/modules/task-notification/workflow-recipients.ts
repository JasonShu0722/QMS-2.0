import { isUUID } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';
import { workflowAccessPredicate } from '../workflow/workflow-access-policy.js';

export function workflowObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function eligibleWorkflowRecipients(tx: Prisma.TransactionClient, organizationId: string, raw: unknown, permission = 'workflow:act') {
  const assignment = typeof raw === 'string' ? { roleCode: raw } : workflowObject(raw);
  const keys = ['roleCode', 'assigneeUserId', 'permission'].filter((key) => assignment[key] !== undefined);
  if (!keys.length || keys.some((key) => typeof assignment[key] !== 'string' || !String(assignment[key]).trim())
    || (assignment.assigneeUserId !== undefined && !isUUID(String(assignment.assigneeUserId)))) throw new Error('WORKFLOW_EVENT_INVALID');
  return tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT recipient.id FROM users recipient
    WHERE recipient.organization_id = ${organizationId}::uuid
      AND ${workflowAccessPredicate(Prisma.sql`recipient.id`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`${JSON.stringify(raw)}::jsonb`, permission)}`);
}
