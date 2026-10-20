import { HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { effectiveRoleGrants } from '../../common/security/effective-role-grants.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AccessContextRequirement } from './access.decorator.js';
import {
  PLATFORM_ERROR_MESSAGES,
  type PlatformErrorCode,
} from '../../common/contracts/platform-error.js';

export interface AuthorizedSessionUser {
  id: string;
  organizationId: string;
  accountType: 'INTERNAL' | 'SUPPLIER';
}

export interface AuthorizedSession {
  id: string;
  user: AuthorizedSessionUser;
}

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  effectiveRolesForContext(userId: string, organizationId: string, now = new Date(), transaction: Prisma.TransactionClient = this.prisma) {
    return effectiveRoleGrants(transaction, userId, organizationId, now);
  }

  async assertAccess(
    session: AuthorizedSession,
    requirement: AccessContextRequirement,
    organizationId = session.user.organizationId,
  ): Promise<void> {
    if (requirement.workflowPermission) {
      const code: PlatformErrorCode = 'WORKFLOW_PERMISSION_REQUIRED';
      throw new HttpException(
        { code, message: PLATFORM_ERROR_MESSAGES[code] },
        403,
      );
    }
    await this.assertFeature(
      session.user.id,
      organizationId,
      requirement.featurePermission,
    );
  }

  async assertFeature(
    userId: string,
    organizationId: string,
    featurePermission: string,
  ): Promise<void> {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { status: true } });
    if (!organization || (organization.status !== 'ACTIVE' && !['organization:read', 'organization:manage'].includes(featurePermission))) {
      throw new HttpException({ code: 'ORGANIZATION_DISABLED', message: '组织已停用' }, 403);
    }
    if (organization.status !== 'ACTIVE' && featurePermission === 'organization:read') {
      await this.assertFeature(userId, organizationId, 'organization:manage');
    }
    const permissions = await this.permissionsForContext(userId, organizationId);
    if (!permissions.includes(featurePermission)) {
      throw new HttpException(
        { code: 'FEATURE_PERMISSION_DENIED', message: '缺少所需权限' },
        403,
      );
    }
  }

  async permissionsForContext(userId: string, organizationId: string): Promise<string[]> {
    const assignments = await effectiveRoleGrants(this.prisma, userId, organizationId);
    return [
      ...new Set(
        assignments.flatMap((assignment) =>
          assignment.role.permissions.map((entry) => entry.permission.code),
        ),
      ),
    ].sort();
  }
}
