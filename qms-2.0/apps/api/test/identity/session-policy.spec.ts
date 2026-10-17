import { sessionLifetimeMs } from '../../src/modules/identity/session-policy.js';

describe('fixed session lifetime', () => {
  it.each<[boolean, boolean, number]>([[false, false, 8], [false, true, 8], [true, true, 7 * 24], [true, false, 30 * 24]])(
    'remember=%s administrator=%s lasts %s hours independently of MFA', (remember, administrator, hours) => {
      expect(sessionLifetimeMs(remember, administrator)).toBe(hours * 3_600_000);
    },
  );
});
