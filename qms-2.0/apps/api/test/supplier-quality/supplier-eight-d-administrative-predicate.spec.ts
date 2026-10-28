import 'reflect-metadata';
import type { AdministrativeLifecycleImpact } from '../../src/common/security/administrative-lifecycle.types.js';
import { SupplierEightDService } from '../../src/modules/supplier-quality/supplier-eight-d.service.js';

describe('supplier administrative deadline source predicate', () => {
  const service = Object.create(SupplierEightDService.prototype) as SupplierEightDService;
  const impact = (kind: AdministrativeLifecycleImpact['kind']): AdministrativeLifecycleImpact => ({
    kind, entityId: 'A', organizationId: 'org', receiptOrganizationId: 'admin-org',
    userIds: ['same-user-in-A-and-B'], departmentIds: ['A'], positionIds: ['A-position'], organizationIds: [],
  });

  it.each(['DEPARTMENT', 'ORGANIZATION'] as const)('%s uses responsibility sources, not credential user IDs', kind => {
    const predicate = service['administrativeDeadlinePredicate'](impact(kind));
    expect(predicate.values).not.toContainEqual(['same-user-in-A-and-B']);
    expect(predicate.values).toContainEqual(['A']);
    expect(predicate.values).toContainEqual(['A-position']);
    expect(predicate.text).toContain('r.sqe_assignment_id');
  });

  it('retains global account matching for actual USER deletion', () => {
    const predicate = service['administrativeDeadlinePredicate'](impact('USER'));
    expect(predicate.values).toContainEqual(['same-user-in-A-and-B']);
    expect(predicate.text).toContain('r.applicant_user_id');
  });
});
