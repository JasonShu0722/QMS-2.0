import { Module } from '@nestjs/common';
import { OrganizationController } from './organization.controller.js';
import { OrganizationScopeService } from './organization-scope.service.js';
import { OrganizationService } from './organization.service.js';
import { OrganizationGovernanceController } from './organization-governance.controller.js';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { PositionOnboardingService } from './position-onboarding.service.js';
import { PositionOnboardingController } from './position-onboarding.controller.js';
import { OrganizationResponsibilityService } from './organization-responsibility.service.js';
import { OrganizationResponsibilityController } from './organization-responsibility.controller.js';
import { AdministrativeLifecycleModule } from '../../common/security/administrative-lifecycle.registry.js';
import { OrganizationForceDeleteService } from './organization-force-delete.service.js';
import { OrganizationForceDeleteController } from './organization-force-delete.controller.js';
import { OrganizationReconfigurationService } from './organization-reconfiguration.service.js';
import { AdministrativeIdentityReadModule } from '../identity/administrative-identity-read-model.js';
import { LegacyAuthorizationOwnerModule } from '../authorization/legacy-authorization-owner.service.js';
import { LegacyAuthorizationIdentityModule } from '../identity/legacy-authorization-identity.service.js';
import { LegacyRoleReferenceModule } from '../workflow/legacy-role-reference.read-model.js';
import { LegacyAuthorizationMigrationService } from './legacy-authorization-migration.service.js';
import { LegacyAuthorizationMigrationController } from './legacy-authorization-migration.controller.js';
import { LegacyAuthorizationReadController } from './legacy-authorization-read.controller.js';
import { LegacyAuthorizationReadService } from './legacy-authorization-read.service.js';

@Module({
  imports: [AdminMutationModule, AuditLogModule, AdministrativeLifecycleModule, AdministrativeIdentityReadModule, LegacyAuthorizationOwnerModule, LegacyAuthorizationIdentityModule, LegacyRoleReferenceModule],
  controllers: [OrganizationController, OrganizationGovernanceController, PositionOnboardingController, OrganizationResponsibilityController, OrganizationForceDeleteController, LegacyAuthorizationMigrationController, LegacyAuthorizationReadController],
  providers: [OrganizationScopeService, OrganizationService, PositionOnboardingService, OrganizationResponsibilityService, OrganizationForceDeleteService, OrganizationReconfigurationService, LegacyAuthorizationMigrationService, LegacyAuthorizationReadService],
  exports: [OrganizationScopeService, OrganizationService, PositionOnboardingService, OrganizationResponsibilityService, OrganizationReconfigurationService],
})
export class OrganizationModule {}
