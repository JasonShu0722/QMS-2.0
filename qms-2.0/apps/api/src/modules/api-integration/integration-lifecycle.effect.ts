import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AdminActor } from '../../common/security/admin-mutation.service.js';
import { AdministrativeLifecycleRegistry } from '../../common/security/administrative-lifecycle.registry.js';
import type { AdministrativeLifecycleEffect, AdministrativeLifecycleImpact } from '../../common/security/administrative-lifecycle.types.js';
import { readOrganizationRuntime } from '../organization/organization-runtime.read-model.js';

@Injectable()
export class IntegrationLifecycleEffect implements AdministrativeLifecycleEffect, OnModuleInit {
  readonly module = 'api-integration' as const;
  constructor(private readonly registry: AdministrativeLifecycleRegistry) {}
  onModuleInit(): void { this.registry.register(this); }

  async apply(tx: Prisma.TransactionClient, _actor: AdminActor, impact: AdministrativeLifecycleImpact) {
    if (impact.kind!=='ORGANIZATION') return { module: this.module, changed: 0, pendingConfiguration: 0 };
    await readOrganizationRuntime(tx, impact.organizationId, true);
    await tx.$queryRaw`SELECT id FROM integration_endpoints WHERE organization_id=${impact.organizationId}::uuid ORDER BY id FOR UPDATE`;
    const endpoints = await tx.$executeRaw`UPDATE integration_endpoints SET status='DISABLED',version=version+1,updated_at=clock_timestamp() WHERE organization_id=${impact.organizationId}::uuid AND status<>'DISABLED'`;
    const credentials = await tx.$executeRaw`UPDATE integration_credentials SET revoked_at=clock_timestamp() WHERE organization_id=${impact.organizationId}::uuid AND revoked_at IS NULL`;
    return { module: this.module, changed: endpoints+credentials, pendingConfiguration: 0 };
  }
}
