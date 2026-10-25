import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../src/database/prisma.service.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import type { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import type { WorkflowClosureAdapter, WorkflowClosureContext, WorkflowClosureDecideInput, WorkflowClosureRound } from '../../src/modules/workflow/workflow-closure-round.types.js';
import type { WorkflowActor } from '../../src/modules/workflow/workflow-access-policy.js';

const createdOrganizations: string[] = [];
export async function clearWorkflowClosureFixtureEvents(prisma: PrismaService) {
  if (!createdOrganizations.length) return;
  const rounds = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM workflow_closure_rounds WHERE organization_id = ANY(${createdOrganizations}::uuid[])`;
  await prisma.outboxEvent.deleteMany({ where: { eventType: 'WORKFLOW_CLOSURE_CHANGED', aggregateId: { in: rounds.map(round => round.id) } } });
}

// Only this test installs a neutral adapter. No domain adapter is registered in production.
export const workflowClosureFixtureAdapter: WorkflowClosureAdapter = {
  domainCode: 'CLOSURE_FIXTURE',
  async lockAndRead(tx, actor, problemId, operation) {
    const before = await tx.problemIndex.findFirst({ where: { id: problemId, organizationId: actor.organizationId } });
    if (!before) throw Object.assign(new Error('scope'), { status: 403 });
    await tx.$queryRaw`SELECT id FROM problem_indexes WHERE id = ${problemId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM workflow_instances WHERE id = ${before.workflowInstanceId}::uuid FOR UPDATE`;
    const p = await tx.problemIndex.findUniqueOrThrow({ where: { id: problemId } });
    const i = await tx.workflowInstance.findUniqueOrThrow({ where: { id: p.workflowInstanceId! }, include: { currentNode: true } });
    const config = (await tx.workflowNode.findFirstOrThrow({ where: { workflowVersionId: i.workflowVersionId, nodeKey: 'closure' } })).config as Record<string, Prisma.JsonValue>;
    if (operation === 'CANCEL' && actor.id !== p.ownerId) throw Object.assign(new Error('cancel scope'), { status: 403 });
    return { organizationId: p.organizationId, problemId, instanceId: i.id, workflowVersionId: i.workflowVersionId,
      currentNodeId: i.currentNodeId!, instanceVersion: i.version, contentVersion: p.version,
      content: { title: 'Neutral fixture', revision: p.version }, policy: config.fixturePolicy as 'INTERNAL' | 'SUPPLIER',
      severity: p.severity as WorkflowClosureContext['severity'], responsibleSectionDepartmentId: String(config.sectionId),
      ownerUserId: p.ownerId!, professionalUserId: String(config.professionalId) };
  },
  async complete(tx, c) {
    const end = await tx.workflowNode.findFirst({ where: { workflowVersionId: c.workflowVersionId, nodeKey: 'end' } });
    await tx.workflowInstance.update({ where: { id: c.instanceId }, data: { status: 'COMPLETED', version: { increment: 1 }, ...(end ? { currentNodeId: end.id } : {}) } });
    await tx.problemIndex.update({ where: { id: c.problemId }, data: { status: 'CLOSED', closedAt: new Date(), version: { increment: 1 } } });
  },
  async returnForChanges(tx, c) {
    await tx.problemIndex.update({ where: { id: c.problemId }, data: { status: 'IN_PROGRESS', version: { increment: 1 } } });
  },
  async canNotifyRecipient(tx, c, userId) {
    const p = await tx.problemIndex.findUnique({ where: { id: c.problemId } });
    const node = await tx.workflowNode.findUnique({ where: { id: c.currentNodeId } });
    const config = node?.config as Record<string, Prisma.JsonValue> | undefined;
    return !!p && p.organizationId === c.organizationId && p.version === c.contentVersion && p.ownerId === c.ownerUserId
      && p.severity === c.severity && config?.professionalId === c.professionalUserId && config.sectionId === c.responsibleSectionDepartmentId
      && config.fixturePolicy === c.policy && !!await tx.user.findFirst({ where: { id: userId, organizationId: c.organizationId } });
  },
};


export async function createWorkflowClosureFixture(prisma: PrismaService, service: WorkflowClosureRoundService, policy: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL', severity: WorkflowClosureContext['severity'] = 'LOW', dual = false) {
  const org = await prisma.organization.create({ data: { code: randomUUID(), name: 'Closure fixture', type: 'INTERNAL' } });
  createdOrganizations.push(org.id);
  const dept = await prisma.department.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Department' } });
  const section = await prisma.department.create({ data: { organizationId: org.id, parentId: dept.id, code: randomUUID(), name: 'Section' } });
  const role = await prisma.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Workflow actors', permissions: { create: { permissionId: (await prisma.permission.findUniqueOrThrow({ where: { code: 'workflow:act' } })).id } } } });
  const person = async (departmentId: string) => {
    const position = await prisma.position.create({ data: { organizationId: org.id, departmentId, code: randomUUID(), name: 'Appointment' } });
    const user = await prisma.user.create({ data: { organizationId: org.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    const assignment = await prisma.userPosition.create({ data: { organizationId: org.id, userId: user.id, positionId: position.id, startedAt: new Date(Date.now() - 60000) } });
    await prisma.userRole.create({ data: { organizationId: org.id, userId: user.id, roleId: role.id } });
    const session = await prisma.session.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), securityVersion: user.securityVersion, mfaVerifiedAt: new Date() } });
    const actor: WorkflowActor = { id: user.id, organizationId: org.id, accountType: 'INTERNAL', sessionId: session.id };
    return { user, assignment, position, actor };
  };
  const owner = await person(section.id);
  const professional = await person(dept.id);
  const manager = await person(section.id);
  const minister = await person(dept.id);
  if (dual) await prisma.userPosition.update({ where: { id: minister.assignment.id }, data: { userId: manager.user.id } });
  const binding = async (duty: string, departmentId: string, positionId: string) => {
    const id = randomUUID();
    await prisma.$executeRaw`INSERT INTO department_management_bindings (id, organization_id, department_id, responsibility, position_id, created_by, updated_by)
      VALUES (${id}::uuid, ${org.id}::uuid, ${departmentId}::uuid, ${duty}, ${positionId}::uuid, ${owner.user.id}::uuid, ${owner.user.id}::uuid)`;
    return id;
  };
  const managerBinding = await binding('SECTION_MANAGER', section.id, manager.position.id);
  await binding('MINISTER', dept.id, minister.position.id);
  const scopeId = randomUUID();
  await prisma.$executeRaw`INSERT INTO department_minister_scopes (id, organization_id, department_id, section_department_id, minister_assignment_id, valid_from, created_by, updated_by)
    VALUES (${scopeId}::uuid, ${org.id}::uuid, ${dept.id}::uuid, ${section.id}::uuid, ${minister.assignment.id}::uuid, CURRENT_TIMESTAMP - INTERVAL '1 minute', ${owner.user.id}::uuid, ${owner.user.id}::uuid)`;
  const definition = await prisma.workflowDefinition.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Fixture' } });
  const version = await prisma.workflowVersion.create({ data: { organizationId: org.id, workflowDefinitionId: definition.id, version: 1, status: 'PUBLISHED' } });
  const node = await prisma.workflowNode.create({ data: { organizationId: org.id, workflowVersionId: version.id, nodeKey: 'closure', type: 'APPROVAL', name: 'Fixture closure', config: { closureReview: { schemaVersion: 1, policy, domainCode: workflowClosureFixtureAdapter.domainCode }, fixturePolicy: policy, sectionId: section.id, professionalId: professional.user.id } } });
  const problem = await prisma.problemIndex.create({ data: { organizationId: org.id, reportNumber: randomUUID(), domainCode: workflowClosureFixtureAdapter.domainCode, problemType: 'FIXTURE', sourceType: 'FIXTURE', severity, ownerId: owner.user.id } });
  const instance = await prisma.workflowInstance.create({ data: { organizationId: org.id, problemIndexId: problem.id, workflowDefinitionId: definition.id, workflowVersionId: version.id, instanceKey: randomUUID(), currentNodeId: node.id } });
  await prisma.problemIndex.update({ where: { id: problem.id }, data: { workflowInstanceId: instance.id } });
  const start = (key = randomUUID()) => service.start(owner.actor, problem.id, { expectedContentVersion: 1, expectedInstanceVersion: 1 }, key, randomUUID());
  const decide = (actor: WorkflowActor, round: WorkflowClosureRound, duties: WorkflowClosureDecideInput['duties'], decision: 'APPROVE' | 'RETURN' = 'APPROVE', key = randomUUID()) => service.decide(actor, round.id, { expectedRoundVersion: round.version, duties, decision, comment: 'Verified' }, key, randomUUID());
  return { org, dept, section, owner, professional, manager, minister, managerBinding, scopeId, node, problem, instance, start, decide, person, role };
}
