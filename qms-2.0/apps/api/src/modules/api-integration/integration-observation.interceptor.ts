import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catchError, from, mergeMap, type Observable } from 'rxjs';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { PLATFORM_ERROR_CODES } from '../../common/contracts/platform-error.js';
import { DataExchangeRegistryService, type DataExchangeSourceHandle } from '../system-management/data-exchange-registry.service.js';
import { DataExchangeObservationService } from '../system-management/data-exchange-observation.service.js';
import { INBOUND_IDENTITY, INBOUND_MACHINE_AUTH, type InboundRequest } from './inbound.guard.js';
import { INBOUND_RESULT } from './inbound.dto.js';
import { IntegrationReceiptService, type IntegrationAttemptInput } from './integration-receipt.service.js';

@Injectable()
export class IntegrationObservationInterceptor implements NestInterceptor {
  private readonly handle: DataExchangeSourceHandle;
  constructor(private readonly prisma: PrismaService, private readonly registry: DataExchangeRegistryService,
    private readonly exchanges: DataExchangeObservationService, private readonly receipts: IntegrationReceiptService,
    private readonly reflector: Reflector) {
    this.handle = registry.register({ key: 'QMS_API_INBOUND', label: 'API接收', directions: ['INBOUND'], objectTypes: ['JSON_MESSAGE'], authorizeScope: async (organizationId, identity, transaction) => {
      const database = transaction ?? this.prisma;
      if (identity?.batchId && !isUUID(identity.batchId)) return false;
      const rows = identity?.batchId
        ? await database.$queryRaw<{ id: string }[]>`SELECT id FROM integration_endpoints WHERE organization_id=${organizationId}::uuid AND id=${identity.batchId}::uuid`
        : await database.$queryRaw<{ id: string }[]>`SELECT id FROM integration_endpoints WHERE organization_id=${organizationId}::uuid LIMIT 1`;
      return rows.length>0;
    } });
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.get<unknown>(INBOUND_MACHINE_AUTH, context.getHandler())) return next.handle();
    const request = context.switchToHttp().getRequest<InboundRequest>(), start = performance.now();
    return next.handle().pipe(
      mergeMap(value => from(this.capture(request, performance.now()-start).then(() => value))),
      catchError(error => from(this.capture(request, performance.now()-start, error).then(() => { throw error; }))),
    );
  }

  private async capture(request: InboundRequest, elapsed: number, error?: unknown): Promise<void> {
    const identity = request[INBOUND_IDENTITY];
    if (!identity) return;
    try {
      const result = request[INBOUND_RESULT];
      const response = error instanceof HttpException ? error.getResponse() : undefined;
      const reportedCode = response && typeof response === 'object' && 'code' in response ? response.code : undefined;
      const statusCode = result?.statusCode ?? (error instanceof HttpException ? error.getStatus() : 503);
      const reasonCode = !result ? statusCode>=500 ? 'INTERNAL_ERROR' : typeof reportedCode === 'string' && PLATFORM_ERROR_CODES.includes(reportedCode as never) ? reportedCode : `HTTP_${statusCode}` : undefined;
      const endpoint = result ? undefined : (await this.prisma.$queryRaw<{ version: number; return_receipt: boolean }[]>`SELECT version,return_receipt FROM integration_endpoints WHERE id=${identity.endpointId}::uuid AND organization_id=${identity.organizationId}::uuid`)[0];
      if (!result && !endpoint) throw new Error('INTEGRATION_ATTEMPT_SCOPE_UNAVAILABLE');
      const header = request.headers['idempotency-key'];
      const messageId = result?.receipt.messageId ?? (typeof header==='string' && /^[A-Za-z0-9._:-]{8,128}$/.test(header) ? header : undefined);
      const attempt: IntegrationAttemptInput = { traceId: requestTraceId(request), organizationId: identity.organizationId, endpointId: identity.endpointId, credentialId: identity.credentialId,
        ...(messageId ? { messageId } : {}), ...(result ? { receiptId: result.receipt.receiptId } : {}), configurationVersion: result?.configurationVersion ?? endpoint!.version,
        returnReceipt: result?.returnReceipt ?? endpoint!.return_receipt, statusCode, outcome: result ? result.receipt.duplicate ? 'DUPLICATE' : 'RECEIVED' : statusCode>=500 ? 'UNKNOWN' : 'REJECTED',
        ...(reasonCode ? { reasonCode } : {}), durationMs: Math.min(86400000,Math.max(0,Math.round(elapsed))) };
      await this.receipts.recordAttempt(attempt);
      const scope = await this.registry.bindScope(this.handle, identity.organizationId);
      await this.exchanges.recordStageResult(this.handle, scope, { direction: 'INBOUND', objectType: 'JSON_MESSAGE', level: 'BATCH', batchId: identity.endpointId, correlationId: attempt.traceId, attemptNumber: 1,
        eventKey: attempt.traceId, idempotencyKey: attempt.traceId, stage: 'transfer', outcome: result ? 'SUCCEEDED' : statusCode>=500 ? 'UNKNOWN' : 'FAILED', observedCount: result && !result.receipt.duplicate ? 1 : 0, ...(!result && statusCode<500 ? { errorCode: 'TRANSFER_FAILED' as const } : {}) });
    } catch {
      this.receipts.collectionFailed(identity.organizationId);
      console.warn('INTEGRATION_OBSERVATION_UNAVAILABLE');
    }
  }
}
