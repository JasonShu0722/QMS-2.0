import { BadRequestException, Injectable } from '@nestjs/common';
import { adminError } from '../../common/security/admin-mutation.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthorizedSessionUser } from '../authorization/authorization.service.js';
import { ConsoleContextService } from '../identity/console-context.service.js';
import { ApiObservationCollectorService, API_OBSERVATION_RETENTION_MS } from './api-observation-collector.service.js';
import { ApiObservationPageDto, ApiObservationQueryDto } from './api-observation.dto.js';

@Injectable()
export class ApiObservationService {
  constructor(private readonly prisma: PrismaService, private readonly contexts: ConsoleContextService, private readonly collector: ApiObservationCollectorService) {}
  async query(actor: AuthorizedSessionUser, query: ApiObservationQueryDto): Promise<ApiObservationPageDto> {
    const context = await this.contexts.context(actor, query.organizationId);
    const organizationId = context.targetOrganization.id;
    if (!context.modules.some(module => module.key === 'api-monitoring' && module.organizationId === organizationId && module.permissions.includes('console:api:read'))) adminError('FEATURE_PERMISSION_DENIED', 403);
    const scope = query.scope ?? 'ORGANIZATION';
    if (scope === 'PLATFORM' && !context.hasPlatformAdministrator) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    const now = new Date();
    const requestedTo = query.to ? new Date(query.to) : now;
    const requestedFrom = query.from ? new Date(query.from) : new Date(requestedTo.getTime() - 86400000);
    if (!Number.isFinite(requestedTo.getTime()) || !Number.isFinite(requestedFrom.getTime()) || requestedFrom >= requestedTo || requestedTo.getTime() - requestedFrom.getTime() > API_OBSERVATION_RETENTION_MS || requestedFrom.getTime() < now.getTime() - API_OBSERVATION_RETENTION_MS || requestedTo.getTime() > now.getTime() + 60000) throw new BadRequestException('Observation range must be within the last seven days.');
    const from = new Date(Math.floor(requestedFrom.getTime() / 60000) * 60000);
    const to = new Date(Math.ceil(requestedTo.getTime() / 60000) * 60000);
    const page = query.page ?? 1; const limit = query.limit ?? 50;
    const where: Prisma.ApiObservationBucketWhereInput = {
      minute: { gte: from, lt: to }, ...(scope === 'ORGANIZATION' ? { scopeKey: organizationId } : {}),
      ...(query.method ? { method: query.method } : {}), ...(query.route ? { route: query.route } : {}), ...(query.statusClass ? { statusClass: query.statusClass } : {}),
    };
    const result = await this.prisma.$transaction(async tx => {
      const total = await tx.apiObservationBucket.count({ where });
      const rows = await tx.apiObservationBucket.findMany({ where, orderBy: [{ minute: 'desc' }, { scopeKey: 'asc' }, { route: 'asc' }, { method: 'asc' }, { statusClass: 'asc' }], skip: (page - 1) * limit, take: limit });
      const sums = await tx.apiObservationBucket.aggregate({ where, _sum: { count: true, durationTotal: true, le50: true, le200: true, le1000: true, le5000: true, gt5000: true }, _max: { durationMax: true } });
      const errors = await tx.apiObservationBucket.aggregate({ where: { ...where, AND: { statusClass: { gte: 4 } } }, _sum: { count: true } });
      const producers = scope === 'PLATFORM' ? await tx.apiObservationCollector.findMany({ where: { updatedAt: { gte: new Date(now.getTime() - API_OBSERVATION_RETENTION_MS) } }, orderBy: [{ updatedAt: 'desc' }, { producerId: 'asc' }], take: 100 }) : [];
      return { total, rows, sums, errors, producers };
    });
    const sum = result.sums._sum;
    const live = this.collector.liveStatus();
    let status: ApiObservationPageDto['collector']['status'] = 'UNKNOWN';
    if (scope === 'PLATFORM' && result.producers.length) {
      const recent = result.producers.some(producer => producer.lastFlushedAt && now.getTime() - producer.lastFlushedAt.getTime() <= 15000);
      status = !recent ? 'STALE' : result.producers.some(producer => !producer.lastFlushedAt || now.getTime() - producer.lastFlushedAt.getTime() > 15000 || producer.failures || producer.dropped) || live.failures || live.dropped || result.producers.length === 100 ? 'PARTIAL' : 'CURRENT';
    }
    return {
      scope, organizationId, from: from.toISOString(), to: to.toISOString(), asOf: now.toISOString(), page, limit, total: result.total,
      items: result.rows.map(({ id: _id, minute, ...row }) => ({ ...row, minute: minute.toISOString() })),
      summary: { requests: sum.count ?? 0, errors: result.errors._sum.count ?? 0, durationTotal: sum.durationTotal ?? 0, durationMax: result.sums._max.durationMax ?? 0, le50: sum.le50 ?? 0, le200: sum.le200 ?? 0, le1000: sum.le1000 ?? 0, le5000: sum.le5000 ?? 0, gt5000: sum.gt5000 ?? 0 },
      collector: scope === 'ORGANIZATION' ? { status: 'UNKNOWN' } : { status, producers: result.producers.map(producer => ({ producerId: producer.producerId, dropped: producer.dropped, failures: producer.failures, startedAt: producer.startedAt.toISOString(), lastFlushedAt: producer.lastFlushedAt?.toISOString() ?? null, lastFailureAt: producer.lastFailureAt?.toISOString() ?? null })), liveDropped: live.dropped, liveFailures: live.failures },
    };
  }
}
