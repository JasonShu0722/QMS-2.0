import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { isUUID } from 'class-validator';
import { parseCookie, SESSION_COOKIE, SessionService } from '../../modules/identity/session.service.js';
import {
  ACCESS_CONTEXT_METADATA,
  AUTHENTICATION_REQUIRED_METADATA,
  type AccessContextRequirement,
} from '../../modules/authorization/access.decorator.js';
import { AuthorizationService, type AuthorizedSession } from '../../modules/authorization/authorization.service.js';
import { OrganizationScopeService } from '../../modules/organization/organization-scope.service.js';
import { AuditLogService } from '../../modules/audit-log/audit-log.service.js';
import { requestTraceId } from '../contracts/request-trace.js';

export const AUTHENTICATED_SESSION = Symbol('AUTHENTICATED_SESSION');

export type AuthorizedRequest = Request & {
  [AUTHENTICATED_SESSION]?: AuthorizedSession;
  authorizedOrganizationId?: string;
};

function requestValue(request: Request, source: string, field = 'organizationId'): unknown {
  if (source === 'session') return undefined;
  const container =
    source === 'query' ? request.query : source === 'body' ? request.body : request.params;
  if (!container || typeof container !== 'object') return undefined;
  return (container as Record<string, unknown>)[field];
}

function singleString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    if (value.length > 1) {
      throw new HttpException(
        { code: 'ORGANIZATION_SCOPE_AMBIGUOUS', message: '组织范围参数不能重复' },
        400,
      );
    }
    if (typeof value[0] === 'string' && value[0].trim()) return value[0].trim();
  }
  return undefined;
}

@Injectable()
export class AuthenticatedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly scopes: OrganizationScopeService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<AccessContextRequirement | undefined>(
      ACCESS_CONTEXT_METADATA,
      [context.getHandler(), context.getClass()],
    );
    const authenticationRequired = this.reflector.getAllAndOverride<boolean | undefined>(
      AUTHENTICATION_REQUIRED_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!requirement && !authenticationRequired) return true;

    const request = context.switchToHttp().getRequest<AuthorizedRequest>();
    const token = parseCookie(request.headers.cookie, SESSION_COOKIE);
    if (!token) this.sessionRequired();
    const session = await this.sessions.resolve(token);
    if (!session) this.sessionRequired();

    if (!requirement) {
      request[AUTHENTICATED_SESSION] = session;
      request.authorizedOrganizationId = session.user.organizationId;
      return true;
    }

    let organizationId: string;
    try {
      if (requirement.workflowPermission) await this.authorization.assertAccess(session, requirement);
      const target = requirement.organizationScope
        ? singleString(requestValue(request, requirement.organizationScope.source, requirement.organizationScope.field))
        : undefined;
      if (target && !isUUID(target)) throw new HttpException('Invalid organization ID', 400);
      organizationId = await this.scopes.fromSession(session, {
        requestedOrganizationId: target,
        optional: requirement.organizationScope?.optional ?? true,
      });
      await this.authorization.assertAccess(session, requirement, organizationId);
    } catch (error) {
      if (error instanceof HttpException && [400, 403].includes(error.getStatus())) {
        const payload = error.getResponse() as { code: string };
        await this.audit.record({
          actorUserId: session.user.id, organizationId: session.user.organizationId,
          action: 'ACTION_REJECTED', resourceType: 'Authorization', outcome: 'DENIED',
          traceId: requestTraceId(request),
          metadata: { permissionCode: requirement.featurePermission, reasonCode: payload.code },
        });
      }
      throw error;
    }
    request[AUTHENTICATED_SESSION] = session;
    request.authorizedOrganizationId = organizationId;
    return true;
  }

  private sessionRequired(): never {
    throw new HttpException(
      { code: 'AUTH_SESSION_REQUIRED', message: '请先登录' },
      401,
    );
  }
}
