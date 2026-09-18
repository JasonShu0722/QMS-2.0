import {
  clearSessionCookieOptions,
  csrfCookieOptions,
  parseCookie,
  sessionCookieOptions,
} from '../../src/modules/identity/session.service.js';

describe('identity cookie policy', () => {
  it('uses a production-only Secure session cookie with browser-inaccessible content', () => {
    expect(sessionCookieOptions('production')).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(sessionCookieOptions('development')).toMatchObject({
      secure: false,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(clearSessionCookieOptions('production')).not.toHaveProperty('maxAge');
  });

  it('keeps the CSRF cookie script-readable while retaining transport protections', () => {
    expect(csrfCookieOptions('production')).toEqual({
      secure: true,
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
    });
  });

  it('ignores malformed percent encoding instead of raising an internal error', () => {
    expect(parseCookie('qms_session=%E0%A4%A', 'qms_session')).toBeUndefined();
  });
});
