import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { toErrorResponse } from './error-response.js';
import { requestTraceId } from './request-trace.js';
import { PLATFORM_ERROR_CODES, PLATFORM_ERROR_MESSAGES, type PlatformErrorCode } from './platform-error.js';

interface SafeHttpError {
  code: string;
  message: string;
  fields?: Record<string, string[]>;
}

const CONTROLLED_ERROR_CODES = new Set([
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_SESSION_REQUIRED',
  'AUTH_RATE_LIMITED',
  'CSRF_INVALID',
  'FEATURE_PERMISSION_DENIED',
  'ORGANIZATION_SCOPE_AMBIGUOUS',
  'ORGANIZATION_SCOPE_DENIED',
  'WORKFLOW_PERMISSION_REQUIRED',
  ...PLATFORM_ERROR_CODES,
]);

function safeHttpError(exception: HttpException): SafeHttpError | undefined {
  const payload = exception.getResponse();
  if (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as Partial<SafeHttpError>).code === 'string' &&
    typeof (payload as Partial<SafeHttpError>).message === 'string'
  ) {
    const candidate = payload as SafeHttpError;
    return {
      code: candidate.code,
      message: candidate.message,
    };
  }
  return undefined;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const candidate = isHttp ? safeHttpError(exception) : undefined;
    const safe = candidate && CONTROLLED_ERROR_CODES.has(candidate.code)
      ? candidate
      : undefined;
    // Exception messages can contain submitted secrets or database diagnostics.
    const message = status >= 500 ? '服务暂时不可用' : '请求无法处理';
    const controlled = safe && PLATFORM_ERROR_CODES.includes(safe.code as PlatformErrorCode);

    response.status(status).json(
      toErrorResponse({
        code: status >= 500 ? 'INTERNAL_ERROR' : (safe?.code ?? `HTTP_${status}`),
        message: controlled ? PLATFORM_ERROR_MESSAGES[safe.code as PlatformErrorCode] : message,
        traceId: requestTraceId(host.switchToHttp().getRequest?.()),
        cause: exception,
      }),
    );
  }
}
