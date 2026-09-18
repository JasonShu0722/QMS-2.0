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

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    // Exception messages can contain submitted secrets or database diagnostics.
    const message = status >= 500 ? '服务暂时不可用' : '请求无法处理';

    response.status(status).json(
      toErrorResponse({
        code: status >= 500 ? 'INTERNAL_ERROR' : `HTTP_${status}`,
        message,
        traceId: randomUUID(),
        cause: exception,
      }),
    );
  }
}
