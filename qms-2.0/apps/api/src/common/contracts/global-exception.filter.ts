import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { toErrorResponse } from './error-response.js';

interface SafeHttpError {
  code: string;
  message: string;
  fields?: Record<string, string[]>;
}

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
      fields: candidate.fields,
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
    const safe = isHttp ? safeHttpError(exception) : undefined;
    // Exception messages can contain submitted secrets or database diagnostics.
    const message = status >= 500 ? '服务暂时不可用' : '请求无法处理';

    response.status(status).json(
      toErrorResponse({
        code: status >= 500 ? 'INTERNAL_ERROR' : (safe?.code ?? `HTTP_${status}`),
        message: safe?.message ?? message,
        fields: safe?.fields,
        traceId: randomUUID(),
        cause: exception,
      }),
    );
  }
}
