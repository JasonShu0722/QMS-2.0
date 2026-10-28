import { describe, expect, it } from '@jest/globals';
import { ACTIVE_PERMISSION_CODES, ADMIN_PERMISSIONS, INTERNAL_PLATFORM_PERMISSION_CODES } from '../../src/modules/authorization/permission-catalog.js';

describe('administrative lifecycle capabilities', () => {
  it.each(['organization:force-delete', 'organization:departments:force-delete', 'account:users:delete', 'organization:reconfigure'])(
    'registers %s for an explicit internal platform administrator without promoting ordinary administrators', permission => {
      expect(ACTIVE_PERMISSION_CODES.filter(code => code === permission)).toHaveLength(1);
      expect(INTERNAL_PLATFORM_PERMISSION_CODES).toContain(permission);
      expect(ADMIN_PERMISSIONS).not.toContain(permission);
    });
});
