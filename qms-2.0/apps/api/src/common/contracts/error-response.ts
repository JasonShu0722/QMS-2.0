import { ApiProperty } from '@nestjs/swagger';

export type ErrorFields = Record<string, string[]>;

export class ErrorResponse {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } })
  fields!: ErrorFields;

  @ApiProperty()
  traceId!: string;
}

export interface ErrorResponseInput {
  code: string;
  message: string;
  fields?: ErrorFields;
  traceId: string;
  cause?: unknown;
}

const SENSITIVE_KEY =
  /password|passphrase|secret|token|sessionid|authorization|cookie|objectkey|accesskey|privatekey/i;

export function sanitizeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMetadata);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key.replace(/[_-]/g, '')) ? '[REDACTED]' : sanitizeMetadata(entry),
    ]),
  );
}

export function toErrorResponse(input: ErrorResponseInput): ErrorResponse {
  return {
    code: input.code,
    message:
      input.code === 'INTERNAL_ERROR' ? '服务暂时不可用' : input.message,
    fields: input.code === 'INTERNAL_ERROR' ? {} : input.fields ?? {},
    traceId: input.traceId,
  };
}
