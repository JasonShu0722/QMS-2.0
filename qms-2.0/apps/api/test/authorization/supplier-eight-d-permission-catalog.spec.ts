import { ACTIVE_PERMISSION_CODES, ADMIN_PERMISSIONS, PERMISSION_CATALOG } from '../../src/modules/authorization/permission-catalog.js';

it('registers guarded supplier 8D actions without automatic ordinary-administrator grants', () => {
  const codes = ['read', 'issue', 'work', 'reassign', 'deadlines', 'report', 'copy'].map(action => `supplier-quality:issues:${action}`);
  const entry = PERMISSION_CATALOG.flatMap(group => group.modules).find(module => module.key === 'supplier-eight-d');
  expect(entry?.status).toBe('active');
  expect(entry?.operations.map(operation => operation.code)).toEqual(codes);
  expect(entry?.operations.every(operation => operation.enforcement === 'guarded')).toBe(true);
  for (const code of codes) {
    expect(ACTIVE_PERMISSION_CODES.filter(value => value === code)).toHaveLength(1);
    expect(ADMIN_PERMISSIONS).not.toContain(code);
  }
});
