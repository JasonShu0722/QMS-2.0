import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { hasPlatformAdministrator } from '../../common/security/platform-administrator.js';
import { assertActiveAuthentication, securityError } from '../../common/security/session-security.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma, WorkbenchGraphStatus } from '../../generated/prisma/client.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type { AuthorizedSession, AuthorizedSessionUser } from '../authorization/authorization.service.js';
import { readOrganizationRuntime } from '../organization/organization-runtime.read-model.js';
import catalog from './workbench-catalog.json' with { type: 'json' };
import type { UpdateWorkbenchGraphStatusDto, WorkbenchGraphDto, WorkbenchGraphNodeDto } from './workbench-graph.dto.js';

const graph: Omit<WorkbenchGraphDto, 'canEditStatus'> = {
  version: catalog.version,
  nodes: catalog.nodes.map(({ id, name, domain, entry, aliases, status, summary, plan, guide, statusUpdatedOn }: typeof catalog.nodes[number] & { statusUpdatedOn?: string }) => ({
    id, name, domain, entry, aliases, status: status as WorkbenchGraphNodeDto['status'], summary, plan,
    statusUpdatedOn: statusUpdatedOn ?? catalog.statusBaselineDate, statusVersion: 0,
    guide: {
      title: guide.title, version: guide.version, role: guide.role, prerequisites: guide.prerequisites,
      steps: guide.steps, result: guide.result, exceptions: guide.exceptions,
    },
  })),
  relations: catalog.relations.map(({ id, from, to, name, kind, status, trigger, content, result, exceptions }) => ({
    id, from, to, name, kind: kind as WorkbenchGraphDto['relations'][number]['kind'],
    status: status as WorkbenchGraphDto['relations'][number]['status'], trigger, content, result, exceptions,
  })),
};

const nodesById = new Map(graph.nodes.map(node => [node.id, node]));

function effectiveNode(node: WorkbenchGraphNodeDto, override?: Pick<WorkbenchGraphStatus, 'status' | 'version' | 'updatedAt'>): WorkbenchGraphNodeDto {
  return override ? { ...node, status: override.status, statusVersion: override.version, statusUpdatedOn: override.updatedAt.toISOString().slice(0, 10) } : node;
}

function staleStatus(): never {
  throw new ConflictException({ code: 'CONCURRENCY_CONFLICT', message: '功能状态已变更，请刷新后重试' });
}

@Injectable()
export class WorkbenchGraphService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  async getGraph(user: AuthorizedSessionUser): Promise<WorkbenchGraphDto> {
    const [overrides, canEditStatus] = await Promise.all([
      this.prisma.workbenchGraphStatus.findMany({ select: { nodeId: true, status: true, version: true, updatedAt: true } }),
      this.canEditStatus(user, this.prisma),
    ]);
    const byNode = new Map(overrides.map(override => [override.nodeId, override]));
    return { ...graph, canEditStatus, nodes: graph.nodes.map(node => effectiveNode(node, byNode.get(node.id))) };
  }

  async updateNodeStatus({ id: sessionId, user }: AuthorizedSession, id: string, body: UpdateWorkbenchGraphStatusDto, traceId: string): Promise<WorkbenchGraphNodeDto> {
    return this.prisma.$transaction(async transaction => {
      const { user: current } = await assertActiveAuthentication(transaction, { id: user.id, sessionId });
      if (current.organizationId !== user.organizationId || current.accountType !== user.accountType) securityError('AUTH_SESSION_REQUIRED');
      if (!await this.canEditStatus(user, transaction)) {
        throw new ForbiddenException({ code: 'FEATURE_PERMISSION_DENIED', message: '仅有效平台管理员可调整功能状态' });
      }
      const node = nodesById.get(id);
      if (!node) throw new NotFoundException('功能节点不存在');
      const previous = await transaction.workbenchGraphStatus.findUnique({ where: { nodeId: id }, select: { status: true, version: true } });
      if ((previous?.version ?? 0) !== body.expectedVersion || body.expectedVersion === 2147483647) staleStatus();
      const next = { status: body.status, version: body.expectedVersion + 1, updatedAt: new Date(), evidence: body.evidence ?? null };
      const changed = previous
        ? await transaction.workbenchGraphStatus.updateMany({ where: { nodeId: id, version: body.expectedVersion }, data: next })
        : await transaction.workbenchGraphStatus.createMany({ data: { nodeId: id, ...next }, skipDuplicates: true });
      if (changed.count !== 1) staleStatus();
      await this.audit.record({
        action: 'WORKBENCH_GRAPH_STATUS_UPDATED', resourceType: 'WorkbenchGraphNode', resourceId: id, outcome: 'SUCCESS',
        actorUserId: user.id, organizationId: user.organizationId, traceId,
        metadata: { status: next.status, previousStatus: previous?.status ?? node.status, resourceVersion: next.version, ...(next.evidence && { evidence: next.evidence }) },
      }, transaction);
      return effectiveNode(node, next);
    });
  }

  private async canEditStatus(user: AuthorizedSessionUser, transaction: Prisma.TransactionClient): Promise<boolean> {
    if (user.accountType !== 'INTERNAL' || !await hasPlatformAdministrator(transaction, user.id)) return false;
    const organization = await readOrganizationRuntime(transaction, user.organizationId);
    return organization?.status === 'ACTIVE' && organization.type === 'INTERNAL' && !organization.deletedAt && !organization.configurationRequired;
  }
}
