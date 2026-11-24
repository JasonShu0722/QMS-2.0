import { BadRequestException, Injectable } from '@nestjs/common';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { listEffectiveOrganizationPositions, listEffectiveUserPositionIds, readOrganizationRuntime } from '../organization/organization-runtime.read-model.js';
import { PROCESS_LEDGER_CONFIGURATION_BOARDS, type ProcessLedgerBoard, type ProcessLedgerWorkflowCapabilitiesDto, type ProcessLedgerWorkflowConfigurationDto, type UpdateProcessLedgerWorkflowConfigurationDto } from './process-ledger-workflow-configuration.dto.js';

export type { ProcessLedgerBoard } from './process-ledger-workflow-configuration.dto.js';

const MANAGE = 'workflow:manage';
const READ = 'process-quality:defects:read';
const WRITE = 'process-quality:defects:write';
const CLOSE = 'process-quality:defects:close';
const REVIEW = 'process-quality:materials:review';
const ACTION = 'PROCESS_LEDGER_WORKFLOW_CONFIGURATION_UPDATED';

type BoardPositions = Partial<Record<ProcessLedgerBoard, string[]>>;
type Configuration = { version: number; boards: BoardPositions };

const boardPermission = (board: ProcessLedgerBoard) => board === 'CLOSURE' ? CLOSE : WRITE;
const configurationLock = (organizationId: string) => `process-ledger-workflow-configuration:${organizationId}`;

@Injectable()
export class ProcessLedgerWorkflowConfigurationService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService) {}

  async get(actor: AdminActor): Promise<ProcessLedgerWorkflowConfigurationDto> {
    const organizationId = actor.organizationId;
    return this.prisma.$transaction(async tx => {
      await assertActiveAuthentication(tx, actor);
      await assertAdminAccess(tx, actor, organizationId, MANAGE);
      await this.assertInternalScope(tx, actor, organizationId);
      return this.configuration(await this.read(tx, organizationId), await listEffectiveOrganizationPositions(tx, organizationId));
    });
  }

  async update(actor: AdminActor, input: UpdateProcessLedgerWorkflowConfigurationDto, traceId: string, key?: string): Promise<ProcessLedgerWorkflowConfigurationDto> {
    const organizationId = actor.organizationId;
    const boards: BoardPositions = {};
    for (const board of PROCESS_LEDGER_CONFIGURATION_BOARDS) {
      boards[board] = [...new Set((input.boards.find(item => item.board === board)?.positionIds ?? []).map(id => id.toLowerCase()))].sort();
    }
    return this.mutations.run({ actor, organizationId, key, traceId, action: ACTION, permission: MANAGE, isolationLevel: 'ReadCommitted',
      payload: { expectedVersion: input.expectedVersion, boards } }, async tx => {
      const previous = await this.read(tx, organizationId);
      if (previous.version !== input.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
      const positions = await listEffectiveOrganizationPositions(tx, organizationId);
      const available = new Set(positions.map(position => position.id));
      if (Object.values(boards).some(ids => ids.some(id => !available.has(id)))) throw new BadRequestException();

      const version = previous.version + 1;
      await tx.$executeRaw`INSERT INTO process_ledger_workflow_configuration_revisions (organization_id, version, boards, updated_by_id)
        VALUES (${organizationId}::uuid, ${version}, ${JSON.stringify(boards)}::jsonb, ${actor.id}::uuid)`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: ACTION, resourceType: 'ProcessLedgerWorkflowConfiguration',
        resourceId: organizationId, outcome: 'SUCCESS', traceId,
        metadata: { resourceVersion: version, previousResourceVersion: previous.version || null } }, tx);
      return this.configuration({ version, boards }, positions);
    }, async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${configurationLock(organizationId)}, 0))::text`;
      await assertAdminAccess(tx, actor, organizationId, MANAGE);
      await this.assertInternalScope(tx, actor, organizationId);
    });
  }

  async capabilities(actor: AdminActor): Promise<ProcessLedgerWorkflowCapabilitiesDto> {
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    return this.prisma.$transaction(async tx => {
      await assertActiveAuthentication(tx, actor);
      await this.assertInternalScope(tx, actor, organizationId);
      const granted = await assertAdminAccess(tx, actor, organizationId, READ);
      const requested = PROCESS_LEDGER_CONFIGURATION_BOARDS.filter(board => granted.includes(boardPermission(board)));
      const boards: ProcessLedgerWorkflowCapabilitiesDto['boards'] = await this.allowedBoards(tx, actor, organizationId, requested);
      if (granted.includes(REVIEW)) boards.push('MATERIAL_REVIEW');
      return { boards };
    });
  }

  async assertCanMaintain(tx: AdminTransaction, actor: AdminActor, organizationId: string, boardOrBoards: ProcessLedgerBoard | readonly ProcessLedgerBoard[]): Promise<void> {
    const requested = typeof boardOrBoards === 'string' ? [boardOrBoards] : [...new Set(boardOrBoards)];
    if (!requested.length) return;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${configurationLock(organizationId)}, 0))::text`;
    await this.assertInternalScope(tx, actor, organizationId);
    await assertAdminAccess(tx, actor, organizationId, [...new Set(requested.map(boardPermission))]);
    const allowed = await this.allowedBoards(tx, actor, organizationId, requested);
    if (allowed.length !== requested.length) adminError('FEATURE_PERMISSION_DENIED', 403);
  }

  private async assertInternalScope(tx: AdminTransaction, actor: AdminActor, organizationId: string) {
    if (actor.accountType !== 'INTERNAL' || organizationId !== (actor.scopeOrganizationId ?? actor.organizationId)) {
      adminError('ORGANIZATION_SCOPE_DENIED', 403);
    }
    for (const id of new Set([actor.organizationId, organizationId])) {
      const organization = await readOrganizationRuntime(tx, id);
      if (organization?.type !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
      if (organization.status !== 'ACTIVE' || organization.deletedAt || organization.configurationRequired) adminError('ORGANIZATION_DISABLED', 403);
    }
  }

  private async read(tx: AdminTransaction, organizationId: string): Promise<Configuration> {
    const [record] = await tx.$queryRaw<Configuration[]>`SELECT version, boards FROM process_ledger_workflow_configuration_revisions
      WHERE organization_id = ${organizationId}::uuid ORDER BY version DESC LIMIT 1`;
    return record ?? { version: 0, boards: {} };
  }

  private configuration(configuration: Configuration, positions: ProcessLedgerWorkflowConfigurationDto['positions']): ProcessLedgerWorkflowConfigurationDto {
    return { version: configuration.version, positions, boards: PROCESS_LEDGER_CONFIGURATION_BOARDS.map(board => ({ board, positionIds: configuration.boards[board] ?? [] })) };
  }

  private async allowedBoards(tx: AdminTransaction, actor: AdminActor, organizationId: string, requested: ProcessLedgerBoard[]): Promise<ProcessLedgerBoard[]> {
    if (!requested.length) return [];
    const configuration = await this.read(tx, organizationId);
    if (configuration.version === 0) return requested;
    if (actor.organizationId !== organizationId) return [];
    const selected = [...new Set(requested.flatMap(board => configuration.boards[board] ?? []))];
    if (!selected.length) return [];
    const held = new Set(await listEffectiveUserPositionIds(tx, organizationId, actor.id, selected));
    return requested.filter(board => configuration.boards[board]?.some(id => held.has(id)));
  }
}
