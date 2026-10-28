import type { AdministrativeLifecycleImpact } from '../../common/security/administrative-lifecycle.types.js';

export type WorkflowAdministrativeInvalidationInput = {
  problemId: string;
  organizationId: string;
  actorUserId: string;
  reason: string;
  impact: AdministrativeLifecycleImpact;
};

export type WorkflowAdministrativeTarget = { organizationId: string; problemId: string };

export type WorkflowAdministrativeImpact = Pick<AdministrativeLifecycleImpact,
  'kind' | 'userIds' | 'departmentIds' | 'positionIds' | 'organizationIds'>;

export type WorkflowAdministrativeSnapshot = {
  organizationId: string;
  context: unknown;
  participants: unknown;
  applicantUserId?: string | null;
  creatorUserId?: string | null;
  creatorOrganizationId?: string | null;
};
