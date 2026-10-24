import { ACTIVE_PERMISSION_CODES, ADMIN_PERMISSIONS, PERMISSION_CATALOG } from '../../src/modules/authorization/permission-catalog.js';

describe('component project permissions', () => {
  it('exposes independent read and maintenance grants without expanding administration grants', () => {
    const module = PERMISSION_CATALOG.flatMap((group) => group.modules).find((entry) => entry.key === 'component-project');
    expect(module?.status).toBe('active');
    expect(module?.operations.map(({ code }) => code)).toEqual(['component-project:read', 'component-project:manage']);
    for (const code of ['component-project:read', 'component-project:manage']) {
      expect(ACTIVE_PERMISSION_CODES.filter((entry) => entry === code)).toHaveLength(1);
      expect(ADMIN_PERMISSIONS).not.toContain(code);
    }
  });
});
