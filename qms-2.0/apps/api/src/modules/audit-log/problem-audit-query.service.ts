import { BadRequestException, Injectable } from '@nestjs/common';
import { isUUID, validateSync } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { WorkflowActor } from '../workflow/workflow-access-policy.js';
import { ProblemQueryService } from '../problem-index/problem-query.service.js';
import { ProblemWorkspaceService } from '../problem-index/problem-workspace.service.js';
import { ProblemAuditQueryDto, type ProblemAuditPageDto } from './problem-audit-query.dto.js';

function decodeCursor(value?: string): { at: Date; id: string } | null {
  if (!value) return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(value)) throw new Error();
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { at: string; id: string };
    if (Object.keys(parsed).length !== 2 || !isUUID(parsed.id) || typeof parsed.at !== 'string' || !Number.isFinite(Date.parse(parsed.at))) throw new Error();
    return { at: new Date(parsed.at), id: parsed.id };
  } catch { throw new BadRequestException(); }
}

@Injectable()
export class ProblemAuditQueryService {
  constructor(private readonly prisma: PrismaService, private readonly problems: ProblemQueryService, private readonly workspaces: ProblemWorkspaceService) {}

  async read(actor: WorkflowActor, organizationId: string, id: string, query: ProblemAuditQueryDto): Promise<ProblemAuditPageDto> {
    if (validateSync(Object.assign(new ProblemAuditQueryDto(), query), { whitelist: true, forbidNonWhitelisted: true }).length) throw new BadRequestException();
    const cursor = decodeCursor(query.cursor);
    const pageSize = query.pageSize ?? 25;
    return this.prisma.$transaction(async (tx) => {
      const { adapter, context } = await this.problems.authorized(tx, actor, organizationId, id, 'history');
      const revisions = adapter.listRevisionIds ? await adapter.listRevisionIds(tx, context) : [];
      if (revisions.length > 1000 || revisions.some((revisionId) => !isUUID(revisionId)) || new Set(revisions).size !== revisions.length) throw new BadRequestException();
      const evidence = await this.workspaces.evidence(tx, adapter, context, null);
      const fileIds = evidence.map((file) => file.id);
      const resources = [
        Prisma.sql`(event.resource_type = 'ProblemIndex' AND event.resource_id = ${id} AND event.action IN ('PROBLEM_INDEX_CREATED', 'PROBLEM_INDEX_UPDATED', 'PROBLEM_INDEX_ARCHIVED'))`,
        Prisma.sql`(event.resource_type = 'WorkflowInstance' AND event.action IN ('WORKFLOW_STARTED', 'WORKFLOW_ACTION_COMPLETED') AND EXISTS (SELECT 1 FROM workflow_instances instance WHERE instance.id::text = event.resource_id AND instance.organization_id = ${organizationId}::uuid AND instance.problem_index_id = ${id}::uuid))`,
        Prisma.sql`(event.resource_type = 'WorkflowTask' AND event.action IN ('TASK_CLAIMED', 'TASK_RELEASED', 'TASK_RECLAIMED', 'TASK_RETRIED') AND EXISTS (SELECT 1 FROM workflow_tasks task JOIN workflow_instances instance ON instance.id = task.workflow_instance_id AND instance.organization_id = task.organization_id WHERE task.id::text = event.resource_id AND task.organization_id = ${organizationId}::uuid AND instance.problem_index_id = ${id}::uuid))`,
        Prisma.sql`(event.resource_type = 'WorkflowUpgrade' AND event.action = 'WORKFLOW_UPGRADED' AND EXISTS (SELECT 1 FROM workflow_upgrades upgrade WHERE upgrade.id::text = event.resource_id AND upgrade.organization_id = ${organizationId}::uuid AND upgrade.problem_index_id = ${id}::uuid))`,
      ];
      if (fileIds.length) resources.push(Prisma.sql`(event.resource_type = 'FileObject' AND event.resource_id IN (${Prisma.join(fileIds)}) AND event.action IN ('ATTACHMENT_UPLOAD_INITIALIZED', 'ATTACHMENT_UPLOAD_COMPLETED', 'ATTACHMENT_UPLOAD_EXPIRED', 'ATTACHMENT_SCAN_CLEAN', 'ATTACHMENT_SCAN_REJECTED', 'ATTACHMENT_SCAN_FAILED', 'ATTACHMENT_DELETED', 'ATTACHMENT_DOWNLOAD_AUTHORIZED'))`);
      if (revisions.length) resources.push(Prisma.sql`(event.resource_type = ${adapter.revisionResourceType!} AND event.resource_id IN (${Prisma.join([...revisions])}))`);
      const after = cursor ? Prisma.sql`AND (event.created_at, event.id) < (${cursor.at}, ${cursor.id}::uuid)` : Prisma.empty;
      const events = await tx.$queryRaw<{ id: string; action: string; outcome: string; resourceType: string; resourceId: string; actorUserId: string | null; actorName: string | null; createdAt: Date; resourceVersion: unknown; reasonCode: unknown }[]>(Prisma.sql`
        SELECT event.id, event.action, event.outcome, event.resource_type AS "resourceType", event.resource_id AS "resourceId", event.actor_user_id AS "actorUserId", actor.username AS "actorName", event.created_at AS "createdAt", event.metadata->'resourceVersion' AS "resourceVersion", event.metadata->'reasonCode' AS "reasonCode"
        FROM audit_events event LEFT JOIN users actor ON actor.id = event.actor_user_id
        WHERE event.organization_id = ${organizationId}::uuid AND (${Prisma.join(resources, ' OR ')}) ${after}
        ORDER BY event.created_at DESC, event.id DESC LIMIT ${pageSize + 1}`);
      await this.problems.authenticate(tx, actor, organizationId);
      const visible = events.slice(0, pageSize);
      const last = visible.at(-1);
      return { items: visible.map((event) => ({ ...event, createdAt: event.createdAt.toISOString(),
        resourceVersion: typeof event.resourceVersion === 'number' && Number.isSafeInteger(event.resourceVersion) && event.resourceVersion > 0 ? event.resourceVersion : null,
        reasonCode: typeof event.reasonCode === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(event.reasonCode) ? event.reasonCode : null })),
        nextCursor: events.length > pageSize && last ? Buffer.from(JSON.stringify({ at: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null,
        domainRevisionTrailAvailable: !!adapter.listRevisionIds };
    }, { isolationLevel: 'ReadCommitted' });
  }
}
