import { jest } from '@jest/globals';
import { RateLimitService } from '../../src/modules/identity/rate-limit.guard.js';

describe('RateLimitService keyed identity', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSecret = process.env.QMS_RATE_LIMIT_SECRET;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalSecret === undefined) delete process.env.QMS_RATE_LIMIT_SECRET;
    else process.env.QMS_RATE_LIMIT_SECRET = originalSecret;
  });

  it('returns a stable HMAC key for the same normalized account and IP', () => {
    process.env.QMS_RATE_LIMIT_SECRET = 'test-secret';
    const service = new RateLimitService();

    expect(service.key('  User@Example.COM ', ' 192.0.2.10 ')).toBe(
      service.key('user@example.com', '192.0.2.10'),
    );
  });

  it('changes the key when the server secret changes', () => {
    process.env.QMS_RATE_LIMIT_SECRET = 'first-secret';
    const first = new RateLimitService().key('user@example.com', '192.0.2.10');
    process.env.QMS_RATE_LIMIT_SECRET = 'second-secret';
    const second = new RateLimitService().key('user@example.com', '192.0.2.10');

    expect(second).not.toBe(first);
  });

  it('fails fast when production has no configured secret', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.QMS_RATE_LIMIT_SECRET;

    expect(() => new RateLimitService()).toThrow(
      'QMS_RATE_LIMIT_SECRET must be configured in production',
    );
  });

  it('does not log the original account identifier', () => {
    process.env.QMS_RATE_LIMIT_SECRET = 'test-secret';
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const account = 'private-user@example.com';

    new RateLimitService().key(account, '192.0.2.10');

    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining(account));
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining(account));
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining(account));
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
