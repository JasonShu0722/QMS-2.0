import {
  sanitizeMetadata,
  toErrorResponse,
} from '../../src/common/contracts/error-response.js';
import { HttpException, type ArgumentsHost } from '@nestjs/common';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';

describe('error response contract', () => {
  it.each([400, 401, 500, 503])('does not echo exception details for HTTP %s', (status) => {
    let actual: unknown;
    const response = { status: (_value: number) => response, json: (body: unknown) => { actual = body; } };
    const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
    new GlobalExceptionFilter().catch(new HttpException({ message: 'password=secret SELECT C:\\private', token: 'secret' }, status), host);
    expect(JSON.stringify(actual)).not.toMatch(/secret|SELECT|private|password/);
    expect(actual).toMatchObject({ code: status >= 500 ? 'INTERNAL_ERROR' : `HTTP_${status}`, fields: {} });
  });

  it('maps an unknown downstream error code to the safe HTTP contract', () => {
    let actual: unknown;
    const response = { status: (_value: number) => response, json: (body: unknown) => { actual = body; } };
    const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
    new GlobalExceptionFilter().catch(
      new HttpException({ code: 'DATABASE_PASSWORD_LEAK', message: 'SELECT password FROM users', fields: { secret: ['x'] } }, 400),
      host,
    );

    expect(actual).toMatchObject({ code: 'HTTP_400', message: '请求无法处理', fields: {} });
    expect(JSON.stringify(actual)).not.toMatch(/DATABASE_PASSWORD_LEAK|SELECT|secret/);
  });

  it('does not trust generic HTTP error payload messages or fields', () => {
    let actual: unknown;
    const response = { status: (_value: number) => response, json: (body: unknown) => { actual = body; } };
    const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
    new GlobalExceptionFilter().catch(
      new HttpException({ code: 'HTTP_400', message: 'SELECT token FROM sessions', fields: { token: ['secret'] } }, 400),
      host,
    );

    expect(actual).toMatchObject({ code: 'HTTP_400', message: '请求无法处理', fields: {} });
    expect(JSON.stringify(actual)).not.toMatch(/SELECT|token|secret/);
  });

  it('returns the stable public shape', () => {
    expect(
      toErrorResponse({
        code: 'VALIDATION_FAILED',
        message: '请求参数无效',
        fields: { username: ['用户名不能为空'] },
        traceId: 'trace-001',
      }),
    ).toEqual({
      code: 'VALIDATION_FAILED',
      message: '请求参数无效',
      fields: { username: ['用户名不能为空'] },
      traceId: 'trace-001',
    });
  });

  it.each([
    'password',
    'passwordHash',
    'tokenHash',
    'sessionToken',
    'sessionId',
    'session_id',
    'objectKey',
    'object_key',
    'access_key',
    'authorization',
  ])('redacts sensitive metadata key %s recursively', (key) => {
    const metadata = sanitizeMetadata({
      safe: 'kept',
      nested: { [key]: 'sensitive-value' },
    });

    expect(JSON.stringify(metadata)).not.toContain('sensitive-value');
    expect(metadata).toEqual({ safe: 'kept', nested: { [key]: '[REDACTED]' } });
  });

  it('never exposes stack traces, SQL text, or local paths', () => {
    const response = toErrorResponse({
      code: 'INTERNAL_ERROR',
      message:
        'Error at C:\\work\\qms\\secret.ts:4 SELECT password_hash FROM users',
      traceId: 'trace-002',
      cause: new Error('database unavailable'),
    });

    expect(response).toEqual({
      code: 'INTERNAL_ERROR',
      message: '服务暂时不可用',
      fields: {},
      traceId: 'trace-002',
    });
    expect(JSON.stringify(response)).not.toMatch(/SELECT|password_hash|C:\\|stack/i);
  });
});
