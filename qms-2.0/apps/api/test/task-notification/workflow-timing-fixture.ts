import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { WorkflowRuntimeService, type WorkflowActionResult } from '../../src/modules/workflow/workflow-runtime.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowValidationService } from '../../src/modules/workflow/workflow-validation.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import type { WorkflowAction } from '../../src/modules/workflow/workflow.types.js';

export async function timingFixture(prisma: PrismaService, organizations: string[], config: Record<string, unknown> = {}) {
  const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Timing fixture', type: 'INTERNAL' } });
  organizations.push(organization.id);
  const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'fixture', accountType: 'INTERNAL' } });
  const role = await prisma.role.create({ data: { organizationId: organization.id, code: 'HANDLER', name: 'Handler' } });
  const managerRole = await prisma.role.create({ data: { organizationId: organization.id, code: 'MANAGER', name: 'Manager' } });
  const manager = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'fixture', accountType: 'INTERNAL' } });
  for (const [roleId, codes] of [[role.id, ['workflow:start', 'workflow:act']], [managerRole.id, ['problem-index:read']]] as const) {
    for (const code of codes) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
  }
  await prisma.userRole.createMany({ data: [
    { userId: user.id, roleId: role.id, organizationId: organization.id },
    { userId: manager.id, roleId: managerRole.id, organizationId: organization.id },
  ] });
  const audit = new AuditLogService(prisma);
  const outbox = new OutboxService(prisma);
  const runtime = new WorkflowRuntimeService(prisma, audit, outbox, new ProblemIndexService(prisma, new NumberingService(prisma), audit, outbox));
  const definitions = new WorkflowDefinitionService(prisma, new WorkflowValidationService(), audit);
  const definition = await definitions.createDraft({ organizationId: organization.id, userId: user.id, code: randomUUID(), name: 'Timed flow', draft: {
    nodes: [
      { id: 'handle', name: 'Handle', type: 'ACTION', config: { isStart: true, assignment: 'HANDLER', slaMinutes: 60, reminders: [{ offsetMinutes: 10 }, { offsetMinutes: 0 }], escalation: 'MANAGER', ...config } },
      { id: 'close', name: 'Close', type: 'CLOSE', config: { isEnd: true, assignment: 'HANDLER' } },
    ],
    transitions: [{ id: 'submit', from: 'handle', to: 'close' }, { id: 'return', from: 'close', to: 'handle', action: 'RETURN' }, { id: 'reopen', from: 'close', to: 'handle', action: 'REOPEN' }],
  } });
  const version = await definitions.publishVersion({ organizationId: organization.id, userId: user.id, definitionId: String(definition.id) });
  const problem = await prisma.problemIndex.create({ data: { organizationId: organization.id, reportNumber: randomUUID(), domainCode: 'neutral-test', problemType: 'test', sourceType: 'neutral', severity: 'LOW' } });
  const command = { organizationId: organization.id, actor: { id: user.id, organizationId: organization.id, accountType: 'INTERNAL' as const }, problemIndexId: problem.id, workflowVersionId: String(version.id), idempotencyKey: randomUUID(), traceId: randomUUID() };
  const started = await runtime.startInstance({ ...command, workflowDefinitionId: String(definition.id), instanceKey: problem.id, expectedProblemVersion: 1 });
  const action = (result: WorkflowActionResult, action: WorkflowAction) => runtime.submitAction({ ...command, idempotencyKey: randomUUID(), instanceId: result.instanceId, currentNodeId: result.currentNodeId, expectedVersion: result.version, expectedProblemVersion: result.problemVersion, action });
  return { organization, user, role, manager, managerRole, problem, started, action };
}

export async function clearTimingEvents(prisma: PrismaService, organizations: string[]) {
  const instances = await prisma.workflowInstance.findMany({ where: { organizationId: { in: organizations } }, select: { id: true } });
  const tasks = await prisma.workflowTask.findMany({ where: { organizationId: { in: organizations } }, select: { id: true } });
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [...instances, ...tasks].map((record) => record.id) } } });
}
