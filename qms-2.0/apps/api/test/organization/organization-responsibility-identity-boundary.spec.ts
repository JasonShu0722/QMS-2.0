import { readFileSync } from 'node:fs';
import { AdministrativeIdentityReadModel } from '../../src/modules/identity/administrative-identity-read-model.js';

describe('organization responsibility identity SQL ownership', () => {
  const source = readFileSync(new URL('../../src/modules/organization/organization-responsibility.service.ts', import.meta.url), 'utf8');

  it('never reads or locks the private identity table in organization SQL', () => {
    expect(source).not.toMatch(/\b(?:FROM|JOIN)\s+users\b/i);
    expect(source).not.toMatch(/user:\s*\{\s*select/);
    expect(source.slice(source.indexOf('@Injectable'))).not.toMatch(/user:\s*\{\s*(?:organizationId|username|fullName)/);
    expect(source).toContain('this.identity.workflowEligibleUsers');
    expect(source).toContain('this.identity.lockResponsibilityUsers(tx, organizationId, userIds)');
  });

  it('composes the actual public eligibility relation with a fixed tenant and minimal projection', () => {
    const owner = new AdministrativeIdentityReadModel();
    expect(owner).toHaveProperty('workflowEligibleUsers');
    if (!('workflowEligibleUsers' in owner)) return;
    const relation = (owner.workflowEligibleUsers as (id: string) => { text: string; values: unknown[] })('tenant');
    expect(relation.text).toMatch(/SELECT id, username, full_name FROM users/i);
    expect(relation.text).toContain("status = 'ACTIVE'");
    expect(relation.text).toContain("account_type = 'INTERNAL'");
    expect(relation.text).toContain('deleted_at IS NULL');
    expect(relation.text).toContain('NOT configuration_required');
    expect(relation.values).toEqual(['tenant']);
    expect(relation.text).not.toMatch(/password|email|secret|token|security_version/i);
  });
});
