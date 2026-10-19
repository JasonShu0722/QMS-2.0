import { HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { effectiveRoleGrants } from '../../common/security/effective-role-grants.js';
import type { AuthorizedSession } from '../authorization/authorization.service.js';

export interface OrganizationScopeRequest {
  requestedOrganizationId?: string;
  optional?: boolean;
}

@Injectable()
export class OrganizationScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async fromSession(
    session: AuthorizedSession,
    request: OrganizationScopeRequest = {},
  ): Promise<string> {
    const homeOrganizationId = session.user.organizationId;
    const requestedOrganizationId = request.requestedOrganizationId ?? homeOrganizationId;
    if (!requestedOrganizationId && !request.optional) this.reject();

    if (session.user.accountType === 'SUPPLIER') {
      if (requestedOrganizationId !== homeOrganizationId) this.reject();
      return homeOrganizationId;
    }

    const assignments = await effectiveRoleGrants(this.prisma, session.user.id, requestedOrganizationId);
    if (!assignments.length) this.reject();
    return requestedOrganizationId;
  }

  private reject(): never {
    throw new HttpException(
      { code: 'ORGANIZATION_SCOPE_DENIED', message: '无权访问该组织范围' },
      403,
    );
  }
}
