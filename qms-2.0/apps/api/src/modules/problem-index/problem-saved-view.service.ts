import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { isUUID, validateSync } from 'class-validator';
import { Prisma, type ProblemSavedView } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { activeActorPredicate, assertWorkflowFeature, featurePredicate, type WorkflowActor } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';
import { CreateProblemSavedViewDto, DeleteProblemSavedViewDto, ProblemSavedViewConfigurationDto, ProblemSavedViewDeletedDto, ProblemSavedViewDto, ProblemSavedViewPageDto, ProblemSavedViewQueryDto, UpdateProblemSavedViewDto } from './problem-saved-view.dto.js';

@Injectable()
export class ProblemSavedViewService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  async list(actor: WorkflowActor, query: ProblemSavedViewQueryDto): Promise<ProblemSavedViewPageDto> {
    const checked = this.validate(ProblemSavedViewQueryDto, query);
    const organizationId = checked.organizationId ?? actor.organizationId;
    this.uuid(organizationId);
    return this.prisma.$transaction(async (tx) => {
      await this.authenticate(tx, actor, organizationId);
      const user = Prisma.sql`${actor.id}::uuid`;
      const organization = Prisma.sql`${organizationId}::uuid`;
      const [page] = await tx.$queryRaw<ProblemSavedViewPageDto[]>(Prisma.sql`
        WITH eligible AS MATERIALIZED (
          SELECT id, organization_id AS "organizationId", name, configuration, version, created_at AS "createdAt", updated_at AS "updatedAt"
          FROM problem_saved_views WHERE owner_user_id = ${user} AND organization_id = ${organization}
            AND ${activeActorPredicate(user, organization)} AND ${featurePredicate(user, organization, Prisma.sql`'problem-index:read'`)}
        ), selected AS (SELECT * FROM eligible ORDER BY "updatedAt" DESC, id DESC LIMIT ${checked.pageSize ?? 25} OFFSET ${checked.offset ?? 0})
        SELECT (SELECT count(*)::int FROM eligible) AS total,
          COALESCE((SELECT jsonb_agg(selected ORDER BY "updatedAt" DESC, id DESC) FROM selected), '[]'::jsonb) AS items`);
      await this.authenticate(tx, actor, organizationId);
      return page!;
    }, { isolationLevel: 'ReadCommitted' });
  }

  async create(actor: WorkflowActor, organizationId: string, input: CreateProblemSavedViewDto, traceId: string): Promise<ProblemSavedViewDto> {
    this.uuid(organizationId);
    const body = this.validate(CreateProblemSavedViewDto, input);
    return this.prisma.$transaction(async (tx) => {
      await this.authenticate(tx, actor, organizationId);
      const view = await tx.problemSavedView.create({ data: { organizationId, ownerUserId: actor.id, name: body.name.trim(), configuration: this.configuration(body.configuration) } });
      await this.record(tx, actor, view, 'PROBLEM_VIEW_CREATED', traceId);
      return this.dto(view);
    }, { isolationLevel: 'ReadCommitted' });
  }

  async update(actor: WorkflowActor, organizationId: string, id: string, input: UpdateProblemSavedViewDto, traceId: string): Promise<ProblemSavedViewDto> {
    this.uuid(organizationId); this.uuid(id);
    const body = this.validate(UpdateProblemSavedViewDto, input);
    if (body.name === undefined && body.configuration === undefined) throw new BadRequestException();
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, actor, organizationId, id);
      if (current.version !== body.expectedVersion) workflowError('CONCURRENCY_CONFLICT', 409);
      const changed = await tx.problemSavedView.updateMany({ where: { id, ownerUserId: actor.id, organizationId, version: body.expectedVersion }, data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.configuration !== undefined ? { configuration: this.configuration(body.configuration) } : {}), version: { increment: 1 },
      } });
      if (changed.count !== 1) workflowError('CONCURRENCY_CONFLICT', 409);
      const view = await tx.problemSavedView.findUniqueOrThrow({ where: { id } });
      await this.record(tx, actor, view, 'PROBLEM_VIEW_UPDATED', traceId);
      return this.dto(view);
    }, { isolationLevel: 'ReadCommitted' });
  }

  async remove(actor: WorkflowActor, organizationId: string, id: string, input: DeleteProblemSavedViewDto, traceId: string): Promise<ProblemSavedViewDeletedDto> {
    this.uuid(organizationId); this.uuid(id);
    const body = this.validate(DeleteProblemSavedViewDto, input);
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, actor, organizationId, id);
      if (current.version !== body.expectedVersion) workflowError('CONCURRENCY_CONFLICT', 409);
      const changed = await tx.problemSavedView.deleteMany({ where: { id, ownerUserId: actor.id, organizationId, version: body.expectedVersion } });
      if (changed.count !== 1) workflowError('CONCURRENCY_CONFLICT', 409);
      await this.record(tx, actor, current, 'PROBLEM_VIEW_DELETED', traceId);
      return { id, deleted: true };
    }, { isolationLevel: 'ReadCommitted' });
  }

  private async lock(tx: Prisma.TransactionClient, actor: WorkflowActor, organizationId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM problem_saved_views WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND owner_user_id = ${actor.id}::uuid FOR UPDATE`;
    await this.authenticate(tx, actor, organizationId);
    const view = await tx.problemSavedView.findFirst({ where: { id, organizationId, ownerUserId: actor.id } });
    if (!view) throw new NotFoundException();
    return view;
  }

  private async authenticate(tx: Prisma.TransactionClient, actor: WorkflowActor, organizationId: string) {
    await assertActiveAuthentication(tx, actor);
    await assertWorkflowFeature(tx, actor, organizationId, 'problem-index:read');
  }

  private validate<Input extends object>(type: ClassConstructor<Input>, value: Input): Input {
    const input = plainToInstance(type, value);
    if (!input || validateSync(input, { whitelist: true, forbidNonWhitelisted: true }).length) throw new BadRequestException();
    return input;
  }

  private uuid(value: string) { if (!isUUID(value)) throw new BadRequestException(); }
  private configuration(value: ProblemSavedViewConfigurationDto): Prisma.InputJsonObject { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject; }
  private dto(view: ProblemSavedView): ProblemSavedViewDto {
    return { id: view.id, organizationId: view.organizationId, name: view.name, configuration: view.configuration as unknown as ProblemSavedViewConfigurationDto,
      version: view.version, createdAt: view.createdAt.toISOString(), updatedAt: view.updatedAt.toISOString() };
  }
  private record(tx: Prisma.TransactionClient, actor: WorkflowActor, view: ProblemSavedView, action: string, traceId: string) {
    return this.audit.record({ organizationId: view.organizationId, actorUserId: actor.id, action, resourceType: 'ProblemSavedView', resourceId: view.id,
      outcome: 'SUCCESS', traceId, metadata: { resourceVersion: view.version } }, tx);
  }
}
