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

@Module({
  imports: [AdminMutationModule, AuditLogModule],
  controllers: [OrganizationController, OrganizationGovernanceController, PositionOnboardingController, OrganizationResponsibilityController],
  providers: [OrganizationScopeService, OrganizationService, PositionOnboardingService, OrganizationResponsibilityService],
  exports: [OrganizationScopeService, OrganizationService, PositionOnboardingService, OrganizationResponsibilityService],
})
export class OrganizationModule {}
