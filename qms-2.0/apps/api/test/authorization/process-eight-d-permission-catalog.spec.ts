import { ACTIVE_PERMISSION_CODES, ADMIN_PERMISSIONS, PERMISSION_CATALOG } from '../../src/modules/authorization/permission-catalog.js';

describe('process 8D action permissions', () => {
  it('separates source close, assigned SQE review and issue actions without granting them to administrators implicitly', () => {
    const codes = ['process-quality:defects:close', 'process-quality:materials:review', 'process-quality:issues:read',
      'process-quality:issues:report',
      'process-quality:issues:issue', 'process-quality:issues:work', 'process-quality:issues:sources',
      'process-quality:issues:risk', 'process-quality:issues:reassign', 'process-quality:issues:deadlines'];
    for (const code of codes) {
      expect(ACTIVE_PERMISSION_CODES.filter(entry => entry === code)).toHaveLength(1);
      expect(ADMIN_PERMISSIONS).not.toContain(code);
    }
    const issues = PERMISSION_CATALOG.flatMap(group => group.modules).find(module => module.key === 'process-issues');
    expect(issues?.status).toBe('active');
    expect(issues?.operations.map(operation => operation.code)).toEqual(codes.slice(2));
  });
});
