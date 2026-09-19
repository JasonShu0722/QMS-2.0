import { RateLimitGuard, RateLimitService } from '../../src/modules/identity/rate-limit.guard.js';

it('limits reset ID and IP even when an attacker rotates session cookies', () => {
  const guard = new RateLimitGuard(new RateLimitService());
  const context = (index: number) => ({ switchToHttp: () => ({ getRequest: () => ({ path: '/api/v1/auth/password-reset/complete', headers: { cookie: `qms_session=untrusted-${index}` }, body: { resetId: 'one-reset-id' }, ip: '127.0.0.1' }) }) });
  for (let index = 0; index < 30; index += 1) expect(guard.canActivate(context(index) as never)).toBe(true);
  expect(() => guard.canActivate(context(30) as never)).toThrow();
});
