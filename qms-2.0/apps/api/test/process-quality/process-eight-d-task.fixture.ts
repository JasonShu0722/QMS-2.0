import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { PrismaService } from '../../src/database/prisma.service.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import { ProcessEightDService } from '../../src/modules/process-quality/process-eight-d.service.js';
import { WorkflowDeadlineExtensionService } from '../../src/modules/workflow/workflow-deadline-extension.service.js';
import { emptyProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import { createWorkflowClosureFixture } from '../workflow/workflow-closure-round.fixture.js';

export function requireDisposableProcessEightDDatabase() {
  const url = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
  if (!url || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash) throw new Error('Process 8D tasks/reminders require disposable loopback PostgreSQL, never preview 55440.');
}

// Persist a read-model fixture; issuance and complete-report validation belong to C's real business-chain suite.
export async function createProcessEightDTaskFixture(app: INestApplicationContext, organizations: string[]) {
  const prisma = app.get(PrismaService);
  const rounds = app.get(WorkflowClosureRoundService);
  const reports = app.get(ProcessEightDService);
  const extensions = app.get(WorkflowDeadlineExtensionService);
  const f = await createWorkflowClosureFixture(prisma, rounds);
  organizations.push(f.org.id);
  const permissions = await prisma.permission.findMany({ where: { code: { in: ['task:read', 'notification:read', 'process-quality:issues:read', 'process-quality:issues:work'] } } });
  if (permissions.length !== 4) throw new Error('Process 8D task fixture requires the real seeded permission catalog');
  await prisma.rolePermission.createMany({ data: permissions.map(permission => ({ roleId: f.role.id, permissionId: permission.id })) });
  await prisma.problemIndex.update({ where: { id: f.problem.id }, data: { domainCode: 'process-quality', sourceType: 'process-defect', problemType: 'EIGHT_D' } });
  const ownerNode = await prisma.workflowNode.create({ data: { organizationId: f.org.id, workflowVersionId: f.instance.workflowVersionId, nodeKey: 'owner', type: 'ACTION', name: 'Process owner',
    config: { isStart: true, assignment: { permission: 'workflow:act' }, processEightD: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: 24 } } } });
  await prisma.workflowNode.update({ where: { id: f.node.id }, data: { config: { closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'process-quality' } } } });
  await prisma.workflowInstance.update({ where: { id: f.instance.id }, data: { currentNodeId: ownerNode.id } });
  const dueAt = new Date(Date.now() - 48 * 3600000);
  await prisma.$executeRaw`INSERT INTO process_eight_d_reports (problem_id, organization_id, responsible_section_department_id, professional_user_id,
    document, analysis_due_at, closure_due_at, created_by, updated_by)
    VALUES (${f.problem.id}::uuid, ${f.org.id}::uuid, ${f.section.id}::uuid, ${f.professional.user.id}::uuid,
      ${JSON.stringify(emptyProcessEightDDocument())}::jsonb, ${dueAt}, ${dueAt}, ${f.professional.user.id}::uuid, ${f.professional.user.id}::uuid)`;
  const context = () => prisma.$transaction(async tx => reports.deadlineContext(tx, await reports.lockRecord(tx, f.owner.actor, f.problem.id, 'READ')));
  const request = async () => {
    const c = await context();
    return extensions.request(f.owner.actor, f.problem.id, { expectedRowVersion: c.rowVersion, expectedInstanceVersion: c.instanceVersion,
      stage: 'ANALYSIS', requestedDueAt: new Date(Date.now() + 72 * 3600000).toISOString(), reason: 'Explicit process 8D request' }, randomUUID(), randomUUID());
  };
  const toClosure = async () => {
    await prisma.workflowInstance.update({ where: { id: f.instance.id }, data: { currentNodeId: f.node.id, version: { increment: 1 } } });
    await prisma.$executeRaw`UPDATE process_eight_d_reports SET submitted_at = CURRENT_TIMESTAMP, analysis_completed_at = CURRENT_TIMESTAMP,
      submission_due_at = ${dueAt}, version = version + 1 WHERE problem_id = ${f.problem.id}::uuid`;
    const c = await context();
    return rounds.start(f.owner.actor, f.problem.id, { expectedContentVersion: c.contentVersion, expectedInstanceVersion: c.instanceVersion }, randomUUID(), randomUUID());
  };
  return { ...f, ownerNode, dueAt, context, request, toClosure, reports, extensions, rounds, prisma };
}

export async function clearProcessEightDTaskFixtureEvents(prisma: PrismaService, organizations: readonly string[]) {
  if (!organizations.length) return;
  await prisma.$executeRaw`DELETE FROM outbox_events WHERE payload->>'organizationId' = ANY(${[...organizations]}::text[])
    AND event_type IN ('PROCESS_EIGHT_D_REMINDER_DUE', 'WORKFLOW_DEADLINE_EXTENSION_CHANGED', 'WORKFLOW_CLOSURE_CHANGED', 'PROCESS_EIGHT_D_CHANGED', 'PROCESS_EIGHT_D_DEADLINE_EXTENDED')`;
}

// A second problem in the same organization, with different candidate users for lock-order tests.
export async function addProcessEightDTaskProblem(f: Awaited<ReturnType<typeof createProcessEightDTaskFixture>>) {
  const { prisma } = f;
  const section = await prisma.department.create({ data: { organizationId: f.org.id, parentId: f.dept.id, code: randomUUID(), name: 'Second section' } });
  const owner = await f.person(section.id); const manager = await f.person(section.id);
  await prisma.$executeRaw`INSERT INTO department_management_bindings (id, organization_id, department_id, responsibility, position_id, created_by, updated_by)
    VALUES (${randomUUID()}::uuid, ${f.org.id}::uuid, ${section.id}::uuid, 'SECTION_MANAGER', ${manager.position.id}::uuid, ${owner.user.id}::uuid, ${owner.user.id}::uuid)`;
  await prisma.$executeRaw`INSERT INTO department_minister_scopes (id, organization_id, department_id, section_department_id, minister_assignment_id, valid_from, created_by, updated_by)
    VALUES (${randomUUID()}::uuid, ${f.org.id}::uuid, ${f.dept.id}::uuid, ${section.id}::uuid, ${f.minister.assignment.id}::uuid,
      ${new Date(Date.now() - 60000)}, ${owner.user.id}::uuid, ${owner.user.id}::uuid)`;
  const problem = await prisma.problemIndex.create({ data: { organizationId: f.org.id, reportNumber: randomUUID(), domainCode: 'process-quality', sourceType: 'process-defect', problemType: 'EIGHT_D', severity: 'LOW', ownerId: owner.user.id } });
  const instance = await prisma.workflowInstance.create({ data: { organizationId: f.org.id, problemIndexId: problem.id,
    workflowDefinitionId: f.instance.workflowDefinitionId, workflowVersionId: f.instance.workflowVersionId, currentNodeId: f.ownerNode.id, instanceKey: randomUUID() } });
  await prisma.problemIndex.update({ where: { id: problem.id }, data: { workflowInstanceId: instance.id } });
  await prisma.$executeRaw`INSERT INTO process_eight_d_reports (problem_id, organization_id, responsible_section_department_id, professional_user_id,
    document, analysis_due_at, closure_due_at, created_by, updated_by)
    VALUES (${problem.id}::uuid, ${f.org.id}::uuid, ${section.id}::uuid, ${f.professional.user.id}::uuid,
      ${JSON.stringify(emptyProcessEightDDocument())}::jsonb, ${f.dueAt}, ${f.dueAt}, ${f.professional.user.id}::uuid, ${f.professional.user.id}::uuid)`;
  const request = async () => {
    const c = await prisma.$transaction(async tx => f.reports.deadlineContext(tx, await f.reports.lockRecord(tx, owner.actor, problem.id, 'READ')));
    return f.extensions.request(owner.actor, problem.id, { expectedRowVersion: c.rowVersion, expectedInstanceVersion: c.instanceVersion,
      stage: 'ANALYSIS', requestedDueAt: new Date(Date.now() + 72 * 3600000).toISOString(), reason: 'Second explicit request' }, randomUUID(), randomUUID());
  };
  return { section, owner, manager, problem, instance, request };
}

export async function waitForProcessEightDProblemLock(prisma: PrismaService) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (
      SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND state = 'active'
        AND wait_event_type = 'Lock' AND query LIKE 'SELECT id FROM problem_indexes%FOR UPDATE%') AS waiting`;
    if (row?.waiting) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Expected a real PostgreSQL problem-lock wait, not an elapsed-time guess');
}
