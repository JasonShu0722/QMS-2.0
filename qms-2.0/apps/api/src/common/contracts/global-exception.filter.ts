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

function safeErrorCode(exception: HttpException): PlatformErrorCode | undefined {
  const payload = exception.getResponse();
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'code' in payload &&
    typeof payload.code === 'string' &&
    PLATFORM_ERROR_CODES.includes(payload.code as PlatformErrorCode)
  ) {
    return payload.code as PlatformErrorCode;
  }
  return undefined;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const isHttp = exception instanceof HttpException;
    const isOversizedBody = typeof exception === 'object' && exception !== null && 'type' in exception && exception.type === 'entity.too.large' && 'status' in exception && exception.status === 413;
    const status = isHttp
      ? exception.getStatus()
      : isOversizedBody ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.INTERNAL_SERVER_ERROR;
    const code = isHttp && status < 500 ? safeErrorCode(exception) : undefined;
    const message = status >= 500 ? '服务暂时不可用'
      : code ? PLATFORM_ERROR_MESSAGES[code] : '请求无法处理';

    response.status(status).json(
      toErrorResponse({
        code: status >= 500 ? 'INTERNAL_ERROR' : (code ?? `HTTP_${status}`),
        message,
        traceId: requestTraceId(host.switchToHttp().getRequest?.()),
        cause: exception,
      }),
    );
  }
}
