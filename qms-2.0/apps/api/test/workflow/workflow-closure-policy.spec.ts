import {
  planWorkflowClosure,
  type WorkflowClosureInput,
  type WorkflowClosureParticipant,
  type WorkflowClosurePolicy,
  type WorkflowClosureSeverity,
} from '../../src/modules/workflow/workflow-closure-policy.js';

const severities: WorkflowClosureSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const policies: WorkflowClosurePolicy[] = ['INTERNAL', 'SUPPLIER'];

function participant(userId: string): WorkflowClosureParticipant {
  return {
    userId,
    assignmentId: `assignment-${userId}`,
    positionId: `position-${userId}`,
    departmentId: 'department',
    bindingId: `binding-${userId}`,
    scopeId: `scope-${userId}`,
    bindingVersion: 2,
    scopeVersion: 3,
  };
}

function input(
  policy: WorkflowClosurePolicy,
  severity: WorkflowClosureSeverity,
): WorkflowClosureInput {
  return {
    policy,
    severity,
    ownerUserId: 'owner',
    professional: participant('professional'),
    sectionManager: participant('manager'),
    minister: participant('minister'),
  };
}

describe('planWorkflowClosure', () => {
  it.each(severities)('plans INTERNAL %s as independent parallel duties', (severity) => {
    const request = input('INTERNAL', severity);
    const highRisk = severity === 'HIGH' || severity === 'CRITICAL';

    expect(planWorkflowClosure(request)).toEqual({
      executionMode: 'PARALLEL',
      duties: [
        { duty: 'PROFESSIONAL', status: 'PENDING', participant: request.professional },
        {
          duty: highRisk ? 'MINISTER' : 'SECTION_MANAGER',
          status: 'PENDING',
          participant: highRisk ? request.minister : request.sectionManager,
        },
      ],
      samePersonGroups: [],
    });
  });

  it.each(['LOW', 'MEDIUM'] as const)('skips only the INTERNAL %s owner-manager duty', (severity) => {
    const request = input('INTERNAL', severity);
    request.professional = participant('owner');
    request.sectionManager = participant('owner');

    expect(planWorkflowClosure(request).duties).toEqual([
      { duty: 'PROFESSIONAL', status: 'PENDING', participant: request.professional },
      { duty: 'SECTION_MANAGER', status: 'SKIPPED_SAME_PERSON', participant: request.sectionManager },
    ]);
  });

  it.each(['LOW', 'MEDIUM'] as const)('skips INTERNAL %s owner-manager independently of a different professional', (severity) => {
    const request = input('INTERNAL', severity);
    request.sectionManager = participant('owner');

    expect(planWorkflowClosure(request)).toEqual({
      executionMode: 'PARALLEL',
      duties: [
        { duty: 'PROFESSIONAL', status: 'PENDING', participant: request.professional },
        { duty: 'SECTION_MANAGER', status: 'SKIPPED_SAME_PERSON', participant: request.sectionManager },
      ],
      samePersonGroups: [],
    });
  });

  it.each([undefined, ''])('does not skip when owner is %p and manager userId is empty', (ownerUserId) => {
    const request = input('INTERNAL', 'LOW');
    request.ownerUserId = ownerUserId;
    request.sectionManager = participant('');

    expect(planWorkflowClosure(request).duties[1].status).toBe('PENDING');
  });

  it.each(['HIGH', 'CRITICAL'] as const)('requires no manager and never skips INTERNAL %s minister', (severity) => {
    const request = input('INTERNAL', severity);
    request.sectionManager = null;
    request.professional = participant('owner');
    request.minister = participant('owner');

    expect(planWorkflowClosure(request)).toEqual({
      executionMode: 'PARALLEL',
      duties: [
        { duty: 'PROFESSIONAL', status: 'PENDING', participant: request.professional },
        { duty: 'MINISTER', status: 'PENDING', participant: request.minister },
      ],
      samePersonGroups: [],
    });
  });

  it.each(severities)('plans SUPPLIER %s with management waiting for the professional', (severity) => {
    const request = input('SUPPLIER', severity);
    delete request.ownerUserId;
    const highRisk = severity === 'HIGH' || severity === 'CRITICAL';

    expect(planWorkflowClosure(request)).toEqual({
      executionMode: 'PROFESSIONAL_THEN_MANAGEMENT',
      duties: [
        { duty: 'PROFESSIONAL', status: 'PENDING', participant: request.professional },
        { duty: 'SECTION_MANAGER', status: 'WAITING', participant: request.sectionManager },
        ...(highRisk ? [{ duty: 'MINISTER', status: 'WAITING', participant: request.minister }] : []),
      ],
      samePersonGroups: [],
    });
  });

  it.each(['LOW', 'MEDIUM'] as const)('keeps SUPPLIER %s owner-manager waiting without a same-person group', (severity) => {
    const request = input('SUPPLIER', severity);
    request.sectionManager = participant('owner');

    expect(planWorkflowClosure(request)).toEqual({
      executionMode: 'PROFESSIONAL_THEN_MANAGEMENT',
      duties: [
        { duty: 'PROFESSIONAL', status: 'PENDING', participant: request.professional },
        { duty: 'SECTION_MANAGER', status: 'WAITING', participant: request.sectionManager },
      ],
      samePersonGroups: [],
    });
  });

  describe.each(policies)('%s missing identities', (policy) => {
    it.each(severities)('keeps every required %s duty without skipping', (severity) => {
      const request = input(policy, severity);
      request.professional = null;
      request.sectionManager = null;
      request.minister = null;
      const highRisk = severity === 'HIGH' || severity === 'CRITICAL';
      const managementStatus = policy === 'INTERNAL' ? 'PENDING' : 'WAITING';
      const managementDuties = policy === 'INTERNAL'
        ? [highRisk ? 'MINISTER' : 'SECTION_MANAGER']
        : highRisk ? ['SECTION_MANAGER', 'MINISTER'] : ['SECTION_MANAGER'];

      expect(planWorkflowClosure(request)).toEqual({
        executionMode: policy === 'INTERNAL' ? 'PARALLEL' : 'PROFESSIONAL_THEN_MANAGEMENT',
        duties: [
          { duty: 'PROFESSIONAL', status: 'PENDING', participant: null },
          ...managementDuties.map((duty) => ({ duty, status: managementStatus, participant: null })),
        ],
        samePersonGroups: [],
      });
    });
  });

  describe.each(policies)('%s professional independence', (policy) => {
    it.each(severities)('never merges or skips the %s professional with management', (severity) => {
      const request = input(policy, severity);
      request.professional = participant('shared');
      request.sectionManager = participant('shared');
      request.minister = participant('shared');
      const result = planWorkflowClosure(request);

      expect(result.duties[0]).toEqual({
        duty: 'PROFESSIONAL', status: 'PENDING', participant: request.professional,
      });
      expect(result.duties.slice(1).map(({ status }) => status))
        .toEqual(policy === 'INTERNAL' ? ['PENDING'] : result.duties.slice(1).map(() => 'WAITING'));
      expect(result.samePersonGroups).toEqual(
        policy === 'SUPPLIER' && (severity === 'HIGH' || severity === 'CRITICAL')
          ? [{ userId: 'shared', duties: ['SECTION_MANAGER', 'MINISTER'] }]
          : [],
      );
    });
  });

  it.each(['HIGH', 'CRITICAL'] as const)('groups only same-person SUPPLIER %s management without skipping', (severity) => {
    const request = input('SUPPLIER', severity);
    request.ownerUserId = 'manager';
    request.minister = { ...participant('manager'), assignmentId: 'minister-assignment', bindingId: 'minister-binding' };

    expect(planWorkflowClosure(request)).toEqual({
      executionMode: 'PROFESSIONAL_THEN_MANAGEMENT',
      duties: [
        { duty: 'PROFESSIONAL', status: 'PENDING', participant: request.professional },
        { duty: 'SECTION_MANAGER', status: 'WAITING', participant: request.sectionManager },
        { duty: 'MINISTER', status: 'WAITING', participant: request.minister },
      ],
      samePersonGroups: [{ userId: 'manager', duties: ['SECTION_MANAGER', 'MINISTER'] }],
    });
  });

  it('does not group empty management userIds', () => {
    const request = input('SUPPLIER', 'HIGH');
    request.sectionManager = participant('');
    request.minister = participant('');

    expect(planWorkflowClosure(request).samePersonGroups).toEqual([]);
    expect(planWorkflowClosure(request).duties.slice(1).map(({ status }) => status)).toEqual(['WAITING', 'WAITING']);
  });

  it.each(['sectionManager', 'minister'] as const)('does not group a missing supplier %s', (missing) => {
    const request = input('SUPPLIER', 'HIGH');
    request[missing] = null;

    expect(planWorkflowClosure(request).samePersonGroups).toEqual([]);
    expect(planWorkflowClosure(request).duties.slice(1).map(({ status }) => status)).toEqual(['WAITING', 'WAITING']);
  });

  it.each(policies)('preserves nullable participant provenance for %s', (policy) => {
    const identity: WorkflowClosureParticipant = {
      userId: 'professional', assignmentId: null, positionId: null, departmentId: null,
      bindingId: null, scopeId: null, bindingVersion: null, scopeVersion: null,
    };
    const request = input(policy, 'LOW');
    request.professional = identity;

    expect(planWorkflowClosure(request).duties[0]).toEqual({
      duty: 'PROFESSIONAL', status: 'PENDING', participant: identity,
    });
  });

  describe.each(policies)('%s immutability', (policy) => {
    it.each(severities)('accepts frozen %s inputs and returns deterministic independent plans', (severity) => {
      const request = input(policy, severity);
      request.professional = participant('manager');
      request.minister = participant('manager');
      const snapshot = structuredClone(request);
      Object.freeze(request.professional);
      Object.freeze(request.sectionManager);
      Object.freeze(request.minister);
      Object.freeze(request);

      const first = planWorkflowClosure(request);
      const second = planWorkflowClosure(request);

      expect(first).toEqual(second);
      expect(request).toEqual(snapshot);
      expect(first).not.toBe(second);
      expect(first.duties).not.toBe(second.duties);
      expect(first.samePersonGroups).not.toBe(second.samePersonGroups);
    });
  });

  it.each(['', 'internal', 'UNKNOWN', null, undefined, 1])('rejects invalid policy %p explicitly', (policy) => {
    const request = { ...input('INTERNAL', 'LOW'), policy } as WorkflowClosureInput;

    expect(() => planWorkflowClosure(request)).toThrow(new Error('Invalid workflow closure policy'));
  });

  describe.each(policies)('%s invalid severity', (policy) => {
    it.each(['', 'low', 'UNKNOWN', null, undefined, 1])('rejects %p explicitly instead of falling back', (severity) => {
      const request = { ...input(policy, 'LOW'), severity } as WorkflowClosureInput;

      expect(() => planWorkflowClosure(request)).toThrow(new Error('Invalid workflow closure severity'));
    });
  });
});
