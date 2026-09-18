import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { parseCookie, SESSION_COOKIE, SessionService } from '../../modules/identity/session.service.js';
import { ACCESS_CONTEXT_METADATA, type AccessContextRequirement } from '../../modules/authorization/access.decorator.js';
import { AuthorizationService, type AuthorizedSession } from '../../modules/authorization/authorization.service.js';
import { OrganizationScopeService } from '../../modules/organization/organization-scope.service.js';

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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<AccessContextRequirement | undefined>(
      ACCESS_CONTEXT_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!requirement) return true;

    const request = context.switchToHttp().getRequest<AuthorizedRequest>();
    const token = parseCookie(request.headers.cookie, SESSION_COOKIE);
    if (!token) this.sessionRequired();
    const session = await this.sessions.resolve(token);
    if (!session) this.sessionRequired();

    await this.authorization.assertAccess(session, requirement);
    const target = requirement.organizationScope
      ? singleString(
          requestValue(
            request,
            requirement.organizationScope.source,
            requirement.organizationScope.field,
          ),
        )
      : undefined;
    const organizationId = await this.scopes.fromSession(session, {
      requestedOrganizationId: target,
      optional: requirement.organizationScope?.optional ?? true,
    });
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
