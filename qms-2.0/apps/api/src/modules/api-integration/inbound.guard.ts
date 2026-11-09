import { applyDecorators, CanActivate, ExecutionContext, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import type { InboundIdentity, InboundResult } from './inbound.dto.js';
import { INBOUND_RESULT } from './inbound.dto.js';
import { InboundService } from './inbound.service.js';

export const INBOUND_MACHINE_AUTH = 'qms:inbound-machine-auth';
export const INBOUND_IDENTITY = Symbol('INBOUND_IDENTITY');
export type InboundRequest = Request & { [INBOUND_IDENTITY]?: InboundIdentity; [INBOUND_RESULT]?: InboundResult };

@Injectable()
export class InboundGuard implements CanActivate {
  constructor(private readonly inbound: InboundService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<InboundRequest>();
    context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>().setHeader('X-Request-Id', requestTraceId(request));
    request[INBOUND_IDENTITY] = await this.inbound.authenticate(request);
    return true;
  }
}

export function RequireInboundMachine() {
  return applyDecorators(SetMetadata(INBOUND_MACHINE_AUTH, InboundGuard), UseGuards(InboundGuard));
}
