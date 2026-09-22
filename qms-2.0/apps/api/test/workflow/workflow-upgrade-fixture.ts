import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../src/database/prisma.service.js';
import type { Prisma, ProblemIndex } from '../../src/generated/prisma/client.js';
import type { WorkflowActor } from '../../src/modules/workflow/workflow-access-policy.js';
import type { WorkflowUpgradeContext, WorkflowUpgradeDomainAdapter, WorkflowUpgradePlan } from '../../src/modules/workflow/workflow-upgrade.registry.js';
import { workflowError } from '../../src/modules/workflow/workflow-runtime-policy.js';
import { timingFixture } from '../task-notification/workflow-timing-fixture.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowValidationService } from '../../src/modules/workflow/workflow-validation.service.js';

interface NeutralSource {
  id: string; organization_id: string; problem_id: string; owner_id: string; active: boolean; kind: string; version: number;
  target_definition_id: string; target_version_id: string; current_revision_id: string; data: Record<string, unknown>; target_draft: Record<string, unknown>; evidence_ids: string[];
}

export async function prepareUpgradeTestSchema(prisma: PrismaService) {
  await prisma.$executeRaw`CREATE SCHEMA IF NOT EXISTS workflow_upgrade_test`;
  await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS workflow_upgrade_test.sources (
    id UUID PRIMARY KEY, organization_id UUID NOT NULL, problem_id UUID NOT NULL UNIQUE, owner_id UUID NOT NULL, active BOOLEAN NOT NULL DEFAULT true,
    kind TEXT NOT NULL, version INTEGER NOT NULL, target_definition_id UUID NOT NULL, target_version_id UUID NOT NULL, current_revision_id UUID NOT NULL,
    data JSONB NOT NULL, target_draft JSONB NOT NULL, evidence_ids UUID[] NOT NULL DEFAULT '{}')`;
  await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS workflow_upgrade_test.revisions (
    id UUID PRIMARY KEY, source_id UUID NOT NULL, instance_id UUID NOT NULL, instance_version INTEGER NOT NULL, node_id UUID NOT NULL,
    data JSONB NOT NULL, evidence_ids UUID[] NOT NULL DEFAULT '{}', UNIQUE(instance_id, instance_version))`;
  await prisma.$executeRaw`CREATE OR REPLACE FUNCTION workflow_upgrade_test.immutable_revision() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'NEUTRAL_REVISION_IMMUTABLE' USING ERRCODE = '23514'; END $$`;
  await prisma.$executeRaw`DROP TRIGGER IF EXISTS neutral_revision_immutable ON workflow_upgrade_test.revisions`;
  await prisma.$executeRaw`CREATE TRIGGER neutral_revision_immutable BEFORE UPDATE OR DELETE ON workflow_upgrade_test.revisions
    FOR EACH ROW EXECUTE FUNCTION workflow_upgrade_test.immutable_revision()`;
}

export class NeutralUpgradeAdapter implements WorkflowUpgradeDomainAdapter {
  readonly domainCode = 'neutral-upgrade';
  readonly sourceType = 'neutral-upgrade';

  async authorizeAndLock(tx: Prisma.TransactionClient, actor: WorkflowActor, problem: ProblemIndex) {
    await tx.$queryRaw`SELECT id FROM workflow_upgrade_test.sources WHERE id = ${problem.sourceId}::uuid FOR UPDATE`;
    const source = await this.source(tx, problem);
    if (!source || !source.active || source.owner_id !== actor.id || source.organization_id !== problem.organizationId || source.problem_id !== problem.id) workflowError('WORKFLOW_UPGRADE_DOMAIN_DENIED', 403);
  }

  async prepare(tx: Prisma.TransactionClient, context: WorkflowUpgradeContext): Promise<WorkflowUpgradePlan> {
    const source = await this.source(tx, context.problem);
    if (!source || source.kind !== 'BRIEF') workflowError('WORKFLOW_UPGRADE_NOT_ALLOWED', 409);
    return { domainVersion: source.version, targetDefinitionId: source.target_definition_id, targetVersionId: source.target_version_id,
      targetProblemType: '8D', allowedNodeIds: [context.node.id], mappingVersion: 'neutral-v1', beforeDomainRevisionId: source.current_revision_id,
      mappingSummary: this.mapping(source).summary, evidenceFileIds: source.evidence_ids };
  }

  async apply(tx: Prisma.TransactionClient, context: WorkflowUpgradeContext, plan: WorkflowUpgradePlan,
    target: { instanceId: string; nodeId: string; expectedDomainVersion: number }) {
    const source = await this.source(tx, context.problem);
    if (!source || source.kind !== 'BRIEF' || source.version !== target.expectedDomainVersion) workflowError('CONCURRENCY_CONFLICT', 409);
    const mapped = this.mapping(source);
    const revisionId = randomUUID();
    await tx.$executeRaw`INSERT INTO workflow_upgrade_test.revisions(id, source_id, instance_id, instance_version, node_id, data, evidence_ids)
      VALUES (${revisionId}::uuid, ${source.id}::uuid, ${target.instanceId}::uuid, 1, ${target.nodeId}::uuid, ${JSON.stringify(mapped.data)}::jsonb, ${source.evidence_ids}::uuid[])`;
    const changed = await tx.$executeRaw`UPDATE workflow_upgrade_test.sources SET kind = '8D', version = version + 1, data = ${JSON.stringify(mapped.data)}::jsonb,
      current_revision_id = ${revisionId}::uuid WHERE id = ${source.id}::uuid AND version = ${target.expectedDomainVersion} AND kind = 'BRIEF'`;
    if (changed !== 1) workflowError('CONCURRENCY_CONFLICT', 409);
    return { domainVersion: source.version + 1, beforeDomainRevisionId: plan.beforeDomainRevisionId, afterDomainRevisionId: revisionId,
      mappingSummary: mapped.summary, evidenceFileIds: source.evidence_ids };
  }

  private mapping(source: NeutralSource) {
    const data = { ...source.target_draft };
    const summary = ['summary', 'flag', 'zero', 'empty', 'cleared', 'absent'].map((fieldId) => {
      if (Object.prototype.hasOwnProperty.call(data, fieldId)) return { fieldId, outcome: 'PRESERVED' as const };
      if (!Object.prototype.hasOwnProperty.call(source.data, fieldId)) return { fieldId, outcome: 'UNMAPPED' as const };
      data[fieldId] = source.data[fieldId];
      return { fieldId, outcome: 'COPIED' as const };
    });
    return { data, summary };
  }

  private async source(tx: Prisma.TransactionClient, problem: ProblemIndex) {
    const [source] = await tx.$queryRaw<NeutralSource[]>`SELECT * FROM workflow_upgrade_test.sources WHERE id = ${problem.sourceId}::uuid`;
    return source;
  }
}

export async function upgradeFixture(prisma: PrismaService, organizations: string[], prepareEvidence?: (context: { problem: ProblemIndex; actor: WorkflowActor }) => Promise<string[]>) {
  const context = await timingFixture(prisma, organizations);
  const sourceId = randomUUID();
  const revisionId = randomUUID();
  const problem = await prisma.problemIndex.update({ where: { id: context.problem.id }, data: { domainCode: 'neutral-upgrade', sourceType: 'neutral-upgrade', sourceId, problemType: 'BRIEF', ownerId: context.user.id } });
  const session = await prisma.session.create({ data: { userId: context.user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
  const actor = { id: context.user.id, organizationId: context.organization.id, accountType: 'INTERNAL' as const, sessionId: session.id };
  const evidenceIds = await prepareEvidence?.({ problem, actor }) ?? [];
  const definitions = new WorkflowDefinitionService(prisma, new WorkflowValidationService(), new AuditLogService(prisma));
  const draft = await definitions.createDraft({ organizationId: context.organization.id, userId: context.user.id, code: randomUUID(), name: 'Neutral 8D target', draft: {
    nodes: [{ id: 'd1', type: 'ACTION', name: '8D first step', config: { isStart: true, assignment: 'HANDLER' } },
      { id: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, assignment: 'HANDLER' } }], transitions: [{ id: 'submit', from: 'd1', to: 'close' }],
  } });
  const target = await definitions.publishVersion({ organizationId: context.organization.id, userId: context.user.id, definitionId: String(draft.id) });
  const original = { summary: 'source summary', flag: true, zero: 99, empty: 'source value', cleared: 'source value' };
  await prisma.$executeRaw`INSERT INTO workflow_upgrade_test.sources(id, organization_id, problem_id, owner_id, kind, version, target_definition_id, target_version_id,
    current_revision_id, data, target_draft, evidence_ids) VALUES (${sourceId}::uuid, ${context.organization.id}::uuid, ${problem.id}::uuid, ${context.user.id}::uuid, 'BRIEF', 1,
    ${String(draft.id)}::uuid, ${String(target.id)}::uuid, ${revisionId}::uuid, ${JSON.stringify(original)}::jsonb, ${JSON.stringify({ flag: false, zero: 0, empty: '', cleared: null })}::jsonb, ${evidenceIds}::uuid[])`;
  await prisma.$executeRaw`INSERT INTO workflow_upgrade_test.revisions(id, source_id, instance_id, instance_version, node_id, data, evidence_ids)
    VALUES (${revisionId}::uuid, ${sourceId}::uuid, ${context.started.instanceId}::uuid, 1, ${context.started.currentNodeId}::uuid, ${JSON.stringify(original)}::jsonb, ${evidenceIds}::uuid[])`;
  for (const code of ['problem-index:read', 'task:read', 'task:claim', 'notification:read']) {
    const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
    await prisma.rolePermission.create({ data: { roleId: context.role.id, permissionId: permission.id } });
  }
  const input = { instanceId: context.started.instanceId, currentNodeId: context.started.currentNodeId, expectedProblemVersion: context.started.problemVersion,
    expectedInstanceVersion: 1, expectedDomainVersion: 1, reason: 'Escalate the investigation' };
  return { ...context, problem, sourceId, revisionId, target, session, actor, input };
}
