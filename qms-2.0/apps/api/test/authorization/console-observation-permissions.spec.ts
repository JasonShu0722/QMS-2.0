import { ACTIVE_PERMISSION_CODES, ADMIN_PERMISSIONS, INTERNAL_PLATFORM_PERMISSION_CODES } from '../../src/modules/authorization/permission-catalog.js';

const observationReads = ['console:api:read', 'console:exchanges:read', 'console:services:read'];

describe('explicit console observation read capabilities', () => {
  it.each(observationReads)('registers %s without implicitly granting it to existing administrators', code => {
    expect(ACTIVE_PERMISSION_CODES).toContain(code);
    expect(ADMIN_PERMISSIONS).not.toContain(code);
    expect(INTERNAL_PLATFORM_PERMISSION_CODES).not.toContain(code);
  });
});
