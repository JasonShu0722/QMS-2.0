import {
  PLATFORM_ERROR_MESSAGES,
  PLATFORM_ERROR_CODES,
  type PlatformErrorCode,
} from '../../src/common/contracts/platform-error.js';

describe('platform error contract', () => {
  const requiredCodes: PlatformErrorCode[] = [
    'PROBLEM_NOT_FOUND',
    'NUMBERING_CONFLICT',
    'WORKFLOW_VERSION_IMMUTABLE',
    'WORKFLOW_NODE_FORBIDDEN',
    'IDEMPOTENCY_REPLAY',
    'CONCURRENCY_CONFLICT',
  ];

  it.each(requiredCodes)('defines a safe response for %s', (code) => {
    expect(PLATFORM_ERROR_CODES).toContain(code);
    expect(PLATFORM_ERROR_MESSAGES[code]).toEqual(expect.any(String));
    expect(PLATFORM_ERROR_MESSAGES[code].length).toBeGreaterThan(0);
  });

  it('keeps the public error payload traceable', () => {
    const payload = {
      code: 'PROBLEM_NOT_FOUND' satisfies PlatformErrorCode,
      message: PLATFORM_ERROR_MESSAGES.PROBLEM_NOT_FOUND,
      fields: {},
      traceId: 'trace-platform-001',
    };

    expect(payload).toMatchObject({
      code: 'PROBLEM_NOT_FOUND',
      message: expect.any(String),
      traceId: expect.any(String),
    });
  });
});
