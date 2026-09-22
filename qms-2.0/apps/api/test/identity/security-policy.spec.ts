import { isGovernancePermission } from '../../src/common/security/session-security.js';

describe('MFA governance policy', () => {
  it('requires MFA for governance writes, without treating read-only access as administration', () => {
    expect(isGovernancePermission('account:users:update')).toBe(true);
    expect(isGovernancePermission('configuration:manage')).toBe(true);
    expect(isGovernancePermission('outbox:retry')).toBe(true);
    expect(isGovernancePermission('account:users:read')).toBe(false);
    expect(isGovernancePermission('audit:read')).toBe(false);
  });
});
