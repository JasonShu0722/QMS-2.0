import { HttpException, Injectable } from '@nestjs/common';
import { adminError, type AdminActor } from '../../common/security/admin-mutation.service.js';
import { AdministrativeReconfigurationKind as Kind } from '../../common/security/administrative-reconfiguration.dto.js';
import { AuditQueryService } from '../audit-log/audit-query.service.js';
import { AdminUserReconfigurationService } from '../identity/admin-user-reconfiguration.service.js';
import { ConsoleContextService } from '../identity/console-context.service.js';
import { OrganizationReconfigurationService } from '../organization/organization-reconfiguration.service.js';
import { OutboxAdministrationService } from '../task-notification/outbox-administration.service.js';
import type { ConsoleHomeDto, ConsoleHomeSourceDto } from './system-management.dto.js';

type SourceQuery = Pick<ConsoleHomeSourceDto, 'key' | 'scope' | 'coverage' | 'organizationId'> & {
  read: () => Promise<Pick<ConsoleHomeSourceDto, 'total' | 'items'>>;
};

@Injectable()
export class SystemManagementService {
  constructor(
    private readonly contexts: ConsoleContextService,
    private readonly outbox: OutboxAdministrationService,
    private readonly audits: AuditQueryService,
    private readonly organizations: OrganizationReconfigurationService,
    private readonly users: AdminUserReconfigurationService,
  ) {}

  async home(actor: AdminActor, organizationId?: string): Promise<ConsoleHomeDto> {
    const context = await this.contexts.context(actor, organizationId);
    const targetId = context.targetOrganization.id;
    const homeId = context.actor.homeOrganization.id;
    const targetRead = (key: 'outbox' | 'audit', permission: string) => context.modules.some(module => module.key === key
      && module.scope === 'TARGET' && module.coverage === 'ORGANIZATION' && module.organizationId === targetId && module.permissions.includes(permission));
    const queries: SourceQuery[] = [];
    if (targetRead('outbox', 'outbox:read')) queries.push({
      key: 'outbox', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: targetId,
      read: async () => ({ total: (await this.outbox.list(actor, { organizationId: targetId, pageSize: 1, offset: 0 })).total }),
    });
    if (targetRead('audit', 'audit:read')) queries.push({
      key: 'audit', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: targetId,
      read: async () => ({ items: (await this.audits.list(actor, { organizationId: targetId, pageSize: 5 })).items }),
    });
    if (context.modules.some(module => module.key === 'reconfiguration' && module.scope === 'SESSION_HOME'
      && module.coverage === 'PLATFORM' && module.organizationId === homeId && module.permissions.includes('organization:reconfigure'))) {
      for (const [key, kind] of [
        ['reconfiguration-organizations', Kind.ORGANIZATION], ['reconfiguration-departments', Kind.DEPARTMENT],
        ['reconfiguration-positions', Kind.POSITION], ['reconfiguration-users', Kind.USER],
      ] as const) queries.push({
        key, scope: 'SESSION_HOME', coverage: 'PLATFORM', organizationId: homeId,
        read: async () => ({ total: (await (kind === Kind.USER ? this.users : this.organizations).listPending(actor, { kind, pageSize: 1, offset: 0 })).total }),
      });
    }
    const sources = await Promise.all(queries.map(async ({ read, ...scope }): Promise<ConsoleHomeSourceDto> => {
      try {
        const values = await read();
        return { ...scope, status: 'AVAILABLE', completedAt: new Date().toISOString(), ...values };
      } catch (error) {
        if (error instanceof HttpException && error.getStatus() === 401) adminError('AUTH_SESSION_REQUIRED', 401);
        return { ...scope, status: 'UNAVAILABLE', completedAt: new Date().toISOString(),
          reasonCode: error instanceof HttpException && error.getStatus() === 403 ? 'AUTHORIZATION_CHANGED' : 'SOURCE_UNAVAILABLE' };
      }
    }));
    return { context, sources, asOf: new Date().toISOString() };
  }
}
