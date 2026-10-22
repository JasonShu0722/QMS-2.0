import { Module } from '@nestjs/common';
import { OrganizationController } from './organization.controller.js';
import { OrganizationScopeService } from './organization-scope.service.js';
import { OrganizationService } from './organization.service.js';
import { OrganizationGovernanceController } from './organization-governance.controller.js';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { PositionOnboardingService } from './position-onboarding.service.js';
import { PositionOnboardingController } from './position-onboarding.controller.js';

@Module({
  imports: [AdminMutationModule, AuditLogModule],
  controllers: [OrganizationController, OrganizationGovernanceController, PositionOnboardingController],
  providers: [OrganizationScopeService, OrganizationService, PositionOnboardingService],
  exports: [OrganizationScopeService, OrganizationService, PositionOnboardingService],
})
export class OrganizationModule {}
