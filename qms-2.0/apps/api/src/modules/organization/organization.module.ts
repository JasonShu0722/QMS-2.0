import { Module } from '@nestjs/common';
import { OrganizationController } from './organization.controller.js';
import { OrganizationScopeService } from './organization-scope.service.js';
import { OrganizationService } from './organization.service.js';

@Module({
  controllers: [OrganizationController],
  providers: [OrganizationScopeService, OrganizationService],
  exports: [OrganizationScopeService],
})
export class OrganizationModule {}
