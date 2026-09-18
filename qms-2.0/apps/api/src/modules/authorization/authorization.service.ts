import { HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
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

  async assertAccess(
    session: AuthorizedSession,
    requirement: AccessContextRequirement,
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
      session.user.organizationId,
      requirement.featurePermission,
    );
  }

  async assertFeature(
    userId: string,
    organizationId: string,
    featurePermission: string,
  ): Promise<void> {
    const count = await this.prisma.userRole.count({
      where: {
        userId,
        organizationId,
        role: {
          permissions: {
            some: { permission: { code: featurePermission } },
          },
        },
      },
    });

    if (count < 1) {
      throw new HttpException(
        { code: 'FEATURE_PERMISSION_DENIED', message: '缺少所需权限' },
        403,
      );
    }
  }

  async permissionsForContext(userId: string, organizationId: string): Promise<string[]> {
    const assignments = await this.prisma.userRole.findMany({
      where: { userId, organizationId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    return [
      ...new Set(
        assignments.flatMap((assignment) =>
          assignment.role.permissions.map((entry) => entry.permission.code),
        ),
      ),
    ].sort();
  }
}
