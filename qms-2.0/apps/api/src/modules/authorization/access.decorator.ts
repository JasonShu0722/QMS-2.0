import { SetMetadata } from '@nestjs/common';

export const ACCESS_CONTEXT_METADATA = Symbol('ACCESS_CONTEXT_METADATA');

export type OrganizationTargetSource = 'query' | 'body' | 'params' | 'session';

export interface AccessContextRequirement {
  featurePermission: string;
  organizationScope?: {
    source: OrganizationTargetSource;
    field?: string;
    optional?: boolean;
  };
  workflowPermission?: string;
}

export const RequireAccess = (requirement: AccessContextRequirement) =>
  SetMetadata(ACCESS_CONTEXT_METADATA, requirement);
