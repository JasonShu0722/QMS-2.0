import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { Prisma } from '../../src/generated/prisma/client.js';
import type { PrismaService } from '../../src/database/prisma.service.js';
import type { WorkflowClosureAdapter } from '../../src/modules/workflow/workflow-closure-round.types.js';
import type { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import type { WorkflowDeadlineContext, WorkflowDeadlineStage } from '../../src/modules/workflow/workflow-deadline-extension.types.js';
import { workflowClosureFixtureAdapter, createWorkflowClosureFixture } from './workflow-closure-round.fixture.js';

type Facts = { problemId: string; ownerNodeId: string; version: number; analysisDueAt: Date | null; submissionDueAt: Date | null; closureDueAt: Date | null; analysisCompletedAt: Date | null; submittedAt: Date | null };
export const deadlineFixtureAdapter: WorkflowClosureAdapter = {
  ...workflowClosureFixtureAdapter,
  async lockAndRead(tx, actor, problemId, operation) {
    const c = await workflowClosureFixtureAdapter.lockAndRead(tx, actor, problemId, operation);
    await tx.$queryRaw`SELECT problem_id FROM workflow_deadline_extension_fixture_facts WHERE problem_id = ${problemId}::uuid FOR UPDATE`;
    return c;
  },
  async deadlineContext(tx, c, actor, operation) {
    if (operation === 'REQUEST' && actor.id !== c.ownerUserId) throw new HttpException('owner only', 403);
    return deadlineFixtureContext(tx, c);
  },
  async applyDeadlineExtension(tx, c, stage, dueAt) {
    if (stage === 'ANALYSIS') await tx.$executeRaw`UPDATE workflow_deadline_extension_fixture_facts SET analysis_due_at = ${dueAt}, version = version + 1 WHERE problem_id = ${c.problemId}::uuid`;
    if (stage === 'SUBMISSION') await tx.$executeRaw`UPDATE workflow_deadline_extension_fixture_facts SET submission_due_at = ${dueAt}, version = version + 1 WHERE problem_id = ${c.problemId}::uuid`;
    if (stage === 'CLOSURE') await tx.$executeRaw`UPDATE workflow_deadline_extension_fixture_facts SET closure_due_at = ${dueAt}, version = version + 1 WHERE problem_id = ${c.problemId}::uuid`;
  },
};

export async function deadlineFixtureContext(tx: Prisma.TransactionClient, c: { organizationId: string; problemId: string; instanceId: string; workflowVersionId: string; ownerUserId: string; professionalUserId: string; responsibleSectionDepartmentId: string; contentVersion: number; instanceVersion: number }): Promise<WorkflowDeadlineContext> {
  const [r] = await tx.$queryRaw<Facts[]>`SELECT problem_id AS "problemId", owner_node_id AS "ownerNodeId", version,
    analysis_due_at AS "analysisDueAt", submission_due_at AS "submissionDueAt", closure_due_at AS "closureDueAt", analysis_completed_at AS "analysisCompletedAt", submitted_at AS "submittedAt"
    FROM workflow_deadline_extension_fixture_facts WHERE problem_id = ${c.problemId}::uuid`;
  if (!r) throw new Error('missing deadline fixture');
  return { ...c, ownerNodeId: r.ownerNodeId, rowVersion: r.version,
    analysisDueAt: r.analysisDueAt?.toISOString() ?? null, submissionDueAt: r.submissionDueAt?.toISOString() ?? null, closureDueAt: r.closureDueAt?.toISOString() ?? null,
    analysisCompletedAt: r.analysisCompletedAt?.toISOString() ?? null, submittedAt: r.submittedAt?.toISOString() ?? null, closedAt: null,
    policy: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: 24 } };
}

export async function initializeDeadlineFixture(prisma: PrismaService) {
  // A real test-owned domain table, never a production adapter or in-memory deadline substitute.
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS workflow_deadline_extension_fixture_facts (
    problem_id uuid PRIMARY KEY, owner_node_id uuid NOT NULL, version integer NOT NULL DEFAULT 1,
    analysis_due_at timestamptz(3), submission_due_at timestamptz(3), closure_due_at timestamptz(3), analysis_completed_at timestamptz(3), submitted_at timestamptz(3),
    CHECK (analysis_due_at IS NULL OR analysis_due_at < '2099-01-01'::timestamptz))`);
}

export async function createDeadlineFixture(prisma: PrismaService, rounds: WorkflowClosureRoundService) {
  const f = await createWorkflowClosureFixture(prisma, rounds);
  const ownerNode = await prisma.workflowNode.create({ data: { organizationId: f.org.id, workflowVersionId: f.instance.workflowVersionId, nodeKey: `owner-${randomUUID()}`, type: 'ACTION', name: 'Fixture owner',
    config: { isStart: true, assignment: { permission: 'workflow:act' }, processEightD: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: 24 } } } });
  await prisma.workflowInstance.update({ where: { id: f.instance.id }, data: { currentNodeId: ownerNode.id } });
  await prisma.$executeRaw`INSERT INTO workflow_deadline_extension_fixture_facts (problem_id, owner_node_id, analysis_due_at, closure_due_at)
    VALUES (${f.problem.id}::uuid, ${ownerNode.id}::uuid, ${new Date('2026-01-01T00:00:00Z')}, ${new Date('2027-01-01T00:00:00Z')})`;
  const due = async (stage: WorkflowDeadlineStage = 'ANALYSIS') => {
    const [row] = await prisma.$queryRaw<{ analysis: Date | null; submission: Date | null; closure: Date | null }[]>`SELECT analysis_due_at AS analysis, submission_due_at AS submission, closure_due_at AS closure
      FROM workflow_deadline_extension_fixture_facts WHERE problem_id = ${f.problem.id}::uuid`;
    return (stage === 'ANALYSIS' ? row!.analysis : stage === 'SUBMISSION' ? row!.submission : row!.closure)?.toISOString() ?? null;
  };
  return { ...f, ownerNode, due };
}
