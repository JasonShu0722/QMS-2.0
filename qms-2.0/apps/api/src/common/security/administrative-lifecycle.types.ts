import type { Prisma } from '../../generated/prisma/client.js';
import type { AdminActor } from './admin-mutation.service.js';

export type AdministrativeEntityKind = 'ORGANIZATION' | 'DEPARTMENT' | 'USER';
export type AdministrativeLifecycleImpact = {
  kind: AdministrativeEntityKind;
  entityId: string;
  organizationId: string;
  receiptOrganizationId: string;
  userIds: string[];
  departmentIds: string[];
  positionIds: string[];
  organizationIds: string[];
};
export type AdministrativeLifecycleEffectResult = { module: string; changed: number; pendingConfiguration: number };

// Only server-constructed impacts may enter this port, after target locks and authorization.
export interface AdministrativeLifecycleEffect {
  readonly module: 'identity' | 'workflow' | 'platform-configuration';
  apply(tx: Prisma.TransactionClient, actor: AdminActor, impact: AdministrativeLifecycleImpact): Promise<AdministrativeLifecycleEffectResult>;
}
