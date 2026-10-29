import 'reflect-metadata';
import { workflowInvalidationMatches } from '../../src/modules/workflow/workflow-administrative-invalidation.service.js';
import type { WorkflowAdministrativeImpact, WorkflowAdministrativeSnapshot } from '../../src/modules/workflow/workflow-administrative-invalidation.types.js';

describe('administrative workflow snapshot matching', () => {
  const snapshot: WorkflowAdministrativeSnapshot = {
    organizationId: 'owned-org',
    context: { ownerUserId: 'owner', professionalUserId: 'professional', responsibleSectionDepartmentId: 'section',
      endedBy: 'historical-actor', content: { evidenceId: 'not-a-participant' } },
    participants: [{ userId: 'approved-reviewer', departmentId: 'manager-dept', positionId: 'manager-position',
      assignmentId: 'assignment', bindingId: 'binding', scopeId: 'scope' }],
  };
  const impact = (input: Partial<WorkflowAdministrativeImpact>): WorkflowAdministrativeImpact => ({
    kind: 'USER', userIds: [], departmentIds: [], positionIds: [], organizationIds: [], ...input,
  });

  it.each(['owner', 'professional', 'approved-reviewer'])('matches saved user %s even after a duty was approved', userId => {
    expect(workflowInvalidationMatches(snapshot, impact({ userIds: [userId] }))).toBe(true);
  });
  it.each(['section', 'manager-dept'])('matches the saved responsibility or participant department %s', departmentId => {
    expect(workflowInvalidationMatches(snapshot, impact({ departmentIds: [departmentId] }))).toBe(true);
  });
  it('matches owned organization and saved participant position', () => {
    expect(workflowInvalidationMatches(snapshot, impact({ kind: 'ORGANIZATION', organizationIds: ['owned-org'] }))).toBe(true);
    expect(workflowInvalidationMatches(snapshot, impact({ positionIds: ['manager-position'] }))).toBe(true);
  });
  it('matches both deadline participants and the original applicant', () => {
    const deadline = { ...snapshot, applicantUserId: 'applicant', participants: {
      leader: { userId: 'leader', departmentId: 'leader-dept' }, professional: { userId: 'quality' }, leaderSkipped: false,
    } };
    for (const userId of ['leader', 'quality', 'applicant']) expect(workflowInvalidationMatches(deadline, impact({ userIds: [userId] }))).toBe(true);
    expect(workflowInvalidationMatches(deadline, impact({ departmentIds: ['leader-dept'] }))).toBe(true);
  });
  it('matches the pending submission creator and creator organization, not only the internal owning organization', () => {
    const supplierSubmission = { ...snapshot, creatorUserId: 'external-submitter', creatorOrganizationId: 'external-org' };
    expect(workflowInvalidationMatches(supplierSubmission, impact({ userIds: ['external-submitter'] }))).toBe(true);
    expect(workflowInvalidationMatches(supplierSubmission, impact({ kind: 'ORGANIZATION', organizationIds: ['external-org'] }))).toBe(true);
  });
  it('never scans arbitrary content, history, assignments or substrings for UUID-like matches', () => {
    for (const userId of ['historical-actor', 'not-a-participant', 'assignment', 'binding', 'scope', 'own']) {
      expect(workflowInvalidationMatches(snapshot, impact({ userIds: [userId] }))).toBe(false);
    }
    expect(workflowInvalidationMatches(snapshot, impact({ departmentIds: ['owned-org'] }))).toBe(false);
    expect(workflowInvalidationMatches(snapshot, impact({}))).toBe(false);
    expect(workflowInvalidationMatches({ organizationId: 'other', context: null, participants: null }, impact({ userIds: ['owner'] }))).toBe(false);
  });

  it.each(['DEPARTMENT', 'ORGANIZATION'] as const)('does not turn %s credential users into globally deleted accounts', kind => {
    const sibling: WorkflowAdministrativeSnapshot = {
      organizationId: 'surviving-org', creatorOrganizationId: 'surviving-org', creatorUserId: 'same-user', applicantUserId: 'same-user',
      context: { ownerUserId: 'same-user', professionalUserId: 'same-user', responsibleSectionDepartmentId: 'B' },
      participants: [{ userId: 'same-user', departmentId: 'B', positionId: 'B-position', assignmentId: 'B-assignment' }],
    };
    const deletion = impact({ kind, userIds: ['same-user'], departmentIds: ['A'], positionIds: ['A-position'],
      organizationIds: kind === 'ORGANIZATION' ? ['deleted-org'] : [] });
    expect(workflowInvalidationMatches(sibling, deletion)).toBe(false);
    expect(workflowInvalidationMatches({ ...sibling, context: { responsibleSectionDepartmentId: 'A' } }, deletion)).toBe(true);
    expect(workflowInvalidationMatches({ ...sibling, participants: [{ userId: 'same-user', positionId: 'A-position' }] }, deletion)).toBe(true);
    expect(workflowInvalidationMatches(sibling, { ...deletion, kind: 'USER' })).toBe(true);
  });

  it('matches users made unavailable by department removal without invalidating surviving credential users', () => {
    const removal = { ...impact({ kind: 'DEPARTMENT', userIds: ['professional', 'approved-reviewer'], departmentIds: ['A'] }), unavailableUserIds: ['professional'] };
    expect(workflowInvalidationMatches(snapshot, removal)).toBe(true);
    expect(workflowInvalidationMatches({ ...snapshot, context: {}, participants: [{ userId: 'approved-reviewer' }] }, removal)).toBe(false);
    const unavailableReviewer = { ...removal, unavailableUserIds: ['approved-reviewer'] };
    expect(workflowInvalidationMatches({ ...snapshot, context: {}, participants: [{ userId: 'approved-reviewer', departmentId: null, positionId: null }] }, unavailableReviewer)).toBe(true);
  });
});
