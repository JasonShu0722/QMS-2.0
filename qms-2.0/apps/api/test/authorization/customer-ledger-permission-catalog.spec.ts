import { ACTIVE_PERMISSION_CODES, ADMIN_PERMISSIONS, INTERNAL_PLATFORM_PERMISSION_CODES, PERMISSION_CATALOG } from '../../src/modules/authorization/permission-catalog.js';

describe('customer ledger and analysis action permissions', () => {
  it('registers distinct guarded actions without implicitly granting ordinary administrators business duties', () => {
    const codes = ['customer-quality:complaints:close', 'customer-quality:complaints:closed-edit',
      'customer-quality:analyses:fae', 'customer-quality:analyses:supplier'];
    const operations = PERMISSION_CATALOG.flatMap(group => group.modules.flatMap(module => module.operations));
    for (const code of codes) {
      expect(ACTIVE_PERMISSION_CODES.filter(item => item === code)).toHaveLength(1);
      expect(operations.find(item => item.code === code)?.enforcement).toBe('guarded');
      expect(INTERNAL_PLATFORM_PERMISSION_CODES).toContain(code);
      expect(ADMIN_PERMISSIONS).not.toContain(code);
    }
    expect(new Set(codes).size).toBe(4);
    expect(operations.find(item => item.code === 'customer-quality:complaints:write')).toBeDefined();
  });
});
