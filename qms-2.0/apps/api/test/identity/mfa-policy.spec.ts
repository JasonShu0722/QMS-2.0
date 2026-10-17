import { effectiveMfa, type Preference } from '../../src/common/security/mfa-policy.js';

describe('effective MFA policy', () => {
  const cases: [boolean, Preference, boolean, boolean, boolean][] = [
    [true, 'DEFAULT', false, false, true],
    [true, 'DEFAULT', false, true, true],
    [true, 'DEFAULT', true, false, true],
    [true, 'DEFAULT', true, true, true],
    [true, 'ENABLED', false, false, true],
    [true, 'ENABLED', false, true, true],
    [true, 'ENABLED', true, false, true],
    [true, 'ENABLED', true, true, true],
    [true, 'DISABLED', false, false, false],
    [true, 'DISABLED', false, true, false],
    [true, 'DISABLED', true, false, false],
    [true, 'DISABLED', true, true, false],
    [false, 'DEFAULT', false, false, false],
    [false, 'DEFAULT', false, true, true],
    [false, 'DEFAULT', true, false, true],
    [false, 'DEFAULT', true, true, true],
    [false, 'ENABLED', false, false, false],
    [false, 'ENABLED', false, true, true],
    [false, 'ENABLED', true, false, true],
    [false, 'ENABLED', true, true, true],
    [false, 'DISABLED', false, false, false],
    [false, 'DISABLED', false, true, true],
    [false, 'DISABLED', true, false, true],
    [false, 'DISABLED', true, true, true],
  ];

  it.each(cases)(
    'administrator=%s preference=%s roleRequired=%s bound=%s requires MFA=%s',
    (administrator, preference, roleRequired, bound, expected) => {
      expect(effectiveMfa(administrator, preference, roleRequired, bound)).toBe(expected);
    },
  );
});
