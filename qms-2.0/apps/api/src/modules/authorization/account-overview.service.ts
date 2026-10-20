import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { OrganizationService } from '../organization/organization.service.js';
import { AuthorizationService, type AuthorizedSessionUser } from './authorization.service.js';

@Injectable()
export class AccountOverviewService {
  constructor(private readonly prisma: PrismaService, private readonly organization: OrganizationService, private readonly authorization: AuthorizationService) {}

  current(user: AuthorizedSessionUser) {
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const assignments = await this.organization.currentAssignments(user.id, user.organizationId, now, transaction);
      const grants = await this.authorization.effectiveRolesForContext(user.id, user.organizationId, now, transaction);
      const names = new Map(assignments.map((assignment) => [assignment.id, assignment.position.name]));
      return {
        organizationId: user.organizationId,
        assignments,
        effectiveRoles: grants.map(({ role, sources }) => ({ id: role.id, code: role.code, name: role.name,
          sources: sources.map((source) => source.kind === 'DIRECT' ? source : { ...source, positionName: names.get(source.assignmentId)! }),
        })),
        permissions: [...new Set(grants.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code)))].sort(),
      };
    }, { isolationLevel: 'RepeatableRead' });
  }
}
