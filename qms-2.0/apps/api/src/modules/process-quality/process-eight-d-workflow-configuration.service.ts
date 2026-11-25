import { BadRequestException, Injectable } from '@nestjs/common';
import { ControlledValidationException } from '../../common/contracts/controlled-validation.exception.js';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { listEffectiveOrganizationPositions, listEffectiveUserPositionIds, readOrganizationRuntime } from '../organization/organization-runtime.read-model.js';
import { WorkflowClosureTemplateService } from '../workflow/workflow-closure-template.service.js';
import { PROCESS_EIGHT_D_WORKFLOW_STAGES, type ProcessEightDWorkflowStage, type ProcessEightDWorkflowConfigurationDto, type UpdateProcessEightDWorkflowConfigurationDto } from './process-eight-d-workflow-configuration.dto.js';

export type { ProcessEightDWorkflowStage } from './process-eight-d-workflow-configuration.dto.js';

const MANAGE = 'workflow:manage';
const ISSUE = 'process-quality:issues:issue';
const ACTION = 'PROCESS_EIGHT_D_WORKFLOW_CONFIGURATION_UPDATED';
const configurationLock = (organizationId: string) => `process-eight-d-workflow-configuration:${organizationId}`;

type StagePositions = Partial<Record<ProcessEightDWorkflowStage, string[]>>;
type Configuration = { version: number; stages: StagePositions; workflowVersionId: string | null };
type Positions = ProcessEightDWorkflowConfigurationDto['positions'];

@Injectable()
export class ProcessEightDWorkflowConfigurationService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService,
    private readonly templates: WorkflowClosureTemplateService) {}

  async get(actor: AdminActor): Promise<ProcessEightDWorkflowConfigurationDto> {
    const organizationId = actor.organizationId;
    return this.prisma.$transaction(async tx => {
      await this.assertInternalScope(tx, actor, organizationId);
      await assertAdminAccess(tx, actor, organizationId, MANAGE);
      return this.projection(await this.read(tx, organizationId), await listEffectiveOrganizationPositions(tx, organizationId));
    });
  }

  async update(actor: AdminActor, input: UpdateProcessEightDWorkflowConfigurationDto, traceId: string, key?: string): Promise<ProcessEightDWorkflowConfigurationDto> {
    const organizationId = actor.organizationId;
    const stages: StagePositions = {};
    for (const stage of PROCESS_EIGHT_D_WORKFLOW_STAGES) {
      stages[stage] = [...new Set((input.stages.find(item => item.stage === stage)?.positionIds ?? []).map(id => id.toLowerCase()))].sort();
    }
    return this.mutations.run({ actor, organizationId, key, traceId, action: ACTION, permission: MANAGE, isolationLevel: 'ReadCommitted',
      payload: { expectedVersion: input.expectedVersion, stages } }, async tx => {
      const previous = await this.read(tx, organizationId);
      if (previous.version !== input.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
      const positions = await listEffectiveOrganizationPositions(tx, organizationId);
      const available = new Set(positions.map(position => position.id));
      if (Object.values(stages).some(ids => ids.some(id => !available.has(id)))) throw new BadRequestException();

      const version = previous.version + 1;
      const projected = this.projection({ version, stages, workflowVersionId: previous.workflowVersionId }, positions);
      const workflowVersionId = previous.workflowVersionId ?? (projected.missingStages.length ? null : await this.templates.publishManagedProcessEightD(tx, actor, traceId));
      await tx.$executeRaw`INSERT INTO process_eight_d_workflow_configuration_revisions (organization_id, version, stages, workflow_version_id, updated_by_id)
        VALUES (${organizationId}::uuid, ${version}, ${JSON.stringify(stages)}::jsonb, ${workflowVersionId}::uuid, ${actor.id}::uuid)`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: ACTION, resourceType: 'ProcessEightDWorkflowConfiguration',
        resourceId: organizationId, outcome: 'SUCCESS', traceId,
        metadata: { resourceVersion: version, previousResourceVersion: previous.version || null } }, tx);
      return projected;
    }, async tx => {
      const [result] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${configurationLock(organizationId)}, 0)) AS locked`;
      if (!result?.locked) adminError('CONCURRENCY_CONFLICT', 409);
      await this.assertInternalScope(tx, actor, organizationId);
      await assertAdminAccess(tx, actor, organizationId, MANAGE);
    });
  }

  async assertCanIssue(tx: AdminTransaction, actor: AdminActor, organizationId: string): Promise<{ workflowDefinitionId: string; workflowVersionId: string }> {
    await this.lockConfiguration(tx, organizationId);
    await this.assertInternalScope(tx, actor, organizationId);
    await assertAdminAccess(tx, actor, organizationId, ISSUE);
    const configuration = await this.read(tx, organizationId);
    const { missingStages } = this.projection(configuration, await listEffectiveOrganizationPositions(tx, organizationId));
    if (missingStages.length) throw new ControlledValidationException('PROCESS_EIGHT_D_WORKFLOW_NOT_READY',
      missingStages.map(stage => ({ path: `stages.${stage}`, message: '' })));
    const { workflowVersionId } = configuration;
    if (!workflowVersionId) adminError('PROCESS_EIGHT_D_WORKFLOW_NOT_READY', 409);
    const binding = await this.templates.publishedVersionBinding(tx, organizationId, workflowVersionId);
    if (!binding) adminError('PROCESS_EIGHT_D_WORKFLOW_NOT_READY', 409);
    if (!(await this.eligibleStages(tx, actor, organizationId, configuration, ['ISSUE'])).length) adminError('FEATURE_PERMISSION_DENIED', 403);
    return { ...binding, workflowVersionId };
  }

  async isManagedVersion(tx: AdminTransaction, organizationId: string, workflowVersionId: string): Promise<boolean> {
    const [result] = await tx.$queryRaw<{ managed: boolean }[]>`SELECT EXISTS (
      SELECT 1 FROM process_eight_d_workflow_configuration_revisions
      WHERE organization_id = ${organizationId}::uuid AND workflow_version_id = ${workflowVersionId}::uuid
    ) AS managed`;
    return result?.managed ?? false;
  }

  async allowedStages(tx: AdminTransaction, actor: AdminActor, organizationId: string, requested: readonly ProcessEightDWorkflowStage[]): Promise<ProcessEightDWorkflowStage[]> {
    await this.assertInternalScope(tx, actor, organizationId);
    return this.eligibleStages(tx, actor, organizationId, await this.read(tx, organizationId), requested);
  }

  async assertCanOperate(tx: AdminTransaction, actor: AdminActor, organizationId: string, stage: ProcessEightDWorkflowStage): Promise<void> {
    await this.lockConfiguration(tx, organizationId);
    if (!(await this.allowedStages(tx, actor, organizationId, [stage])).length) adminError('FEATURE_PERMISSION_DENIED', 403);
  }

  async lockConfiguration(tx: AdminTransaction, organizationId: string) {
    const [result] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock_shared(hashtextextended(${configurationLock(organizationId)}, 0)) AS locked`;
    if (!result?.locked) adminError('CONCURRENCY_CONFLICT', 409);
  }

  private async assertInternalScope(tx: AdminTransaction, actor: AdminActor, organizationId: string) {
    await assertActiveAuthentication(tx, actor);
    if (actor.accountType !== 'INTERNAL' || organizationId !== actor.organizationId || organizationId !== (actor.scopeOrganizationId ?? actor.organizationId)) {
      adminError('ORGANIZATION_SCOPE_DENIED', 403);
    }
    const organization = await readOrganizationRuntime(tx, organizationId);
    if (organization?.type !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
    if (organization.status !== 'ACTIVE' || organization.deletedAt || organization.configurationRequired) adminError('ORGANIZATION_DISABLED', 403);
  }

  private async read(tx: AdminTransaction, organizationId: string): Promise<Configuration> {
    const [record] = await tx.$queryRaw<Configuration[]>`SELECT version, stages, workflow_version_id AS "workflowVersionId"
      FROM process_eight_d_workflow_configuration_revisions WHERE organization_id = ${organizationId}::uuid ORDER BY version DESC LIMIT 1`;
    return record ?? { version: 0, stages: {}, workflowVersionId: null };
  }

  private projection(configuration: Configuration, positions: Positions): ProcessEightDWorkflowConfigurationDto {
    const stages = PROCESS_EIGHT_D_WORKFLOW_STAGES.map(stage => ({ stage, positionIds: configuration.stages[stage] ?? [] }));
    const available = new Set(positions.map(position => position.id));
    return { version: configuration.version, positions, stages,
      missingStages: stages.filter(item => !item.positionIds.some(id => available.has(id))).map(item => item.stage) };
  }

  private async eligibleStages(tx: AdminTransaction, actor: AdminActor, organizationId: string, configuration: Configuration, requested: readonly ProcessEightDWorkflowStage[]): Promise<ProcessEightDWorkflowStage[]> {
    const selected = [...new Set(requested.flatMap(stage => configuration.stages[stage] ?? []))];
    if (!selected.length) return [];
    const held = new Set(await listEffectiveUserPositionIds(tx, organizationId, actor.id, selected));
    return requested.filter(stage => configuration.stages[stage]?.some(id => held.has(id)));
  }
}
