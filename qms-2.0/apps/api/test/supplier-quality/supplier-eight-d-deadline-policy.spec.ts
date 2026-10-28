import {
  assertSupplierDeadlineDates,
  initialSupplierDeadlineStatus,
  nextSupplierDeadlineStatus,
  supplierDeadlineDuty,
  type SupplierDeadlineApproval,
  type SupplierDeadlineDecisionInput,
  type SupplierDeadlineStage,
} from '../../src/modules/supplier-quality/supplier-eight-d-deadline.policy.js';
import { SUPPLIER_SEVERITIES, type SupplierProblemFacts } from '../../src/modules/supplier-quality/supplier-quality.types.js';

const decision = (overrides: Partial<SupplierDeadlineDecisionInput> = {}): SupplierDeadlineDecisionInput => ({
  severity: 'HIGH', status: 'QUALITY_PENDING', decision: 'APPROVE', duty: 'SQE',
  actorUserId: 'sqe', sqeUserId: 'sqe', managerUserId: 'manager', ...overrides,
});

describe('supplier 8D deadline approval policy', () => {
  it.each(SUPPLIER_SEVERITIES)('%s starts with SQE, never with management', severity => {
    expect(initialSupplierDeadlineStatus(severity)).toBe('QUALITY_PENDING');
    expect(supplierDeadlineDuty(severity, 'QUALITY_PENDING')).toBe('SQE');
  });

  it.each(['LOW', 'MEDIUM'] as const)('%s needs only the actual SQE and no manager', severity => {
    expect(nextSupplierDeadlineStatus(decision({ severity, managerUserId: null }))).toBe('APPROVED');
    expect(supplierDeadlineDuty(severity, 'APPROVED')).toBeNull();
    expect(() => supplierDeadlineDuty(severity, 'MANAGER_PENDING')).toThrow('SUPPLIER_DEADLINE_STATE_INVALID');
    expect(() => nextSupplierDeadlineStatus(decision({
      severity, status: 'MANAGER_PENDING', duty: 'MANAGER', actorUserId: 'manager',
    }))).toThrow();
  });

  it.each(['HIGH', 'CRITICAL'] as const)('%s requires SQE then the actual manager', severity => {
    const status = nextSupplierDeadlineStatus(decision({ severity }));
    expect(status).toBe('MANAGER_PENDING');
    expect(supplierDeadlineDuty(severity, status)).toBe('MANAGER');
    expect(nextSupplierDeadlineStatus(decision({ severity, status, duty: 'MANAGER', actorUserId: 'manager' }))).toBe('APPROVED');
  });

  it.each(SUPPLIER_SEVERITIES)('%s rejects an early manager even for RETURN', severity => {
    for (const action of ['APPROVE', 'RETURN'] as const) {
      expect(() => nextSupplierDeadlineStatus(decision({
        severity, decision: action, duty: 'MANAGER', actorUserId: 'manager',
      }))).toThrow('SUPPLIER_DEADLINE_ACTOR_DENIED');
    }
  });

  it.each(['HIGH', 'CRITICAL'] as const)('%s keeps two explicit duties when SQE and manager are the same person', severity => {
    const samePerson = decision({ severity, managerUserId: 'sqe' });
    expect(() => nextSupplierDeadlineStatus({ ...samePerson, duty: 'MANAGER' })).toThrow();
    const status = nextSupplierDeadlineStatus(samePerson);
    expect(status).toBe('MANAGER_PENDING');
    expect(supplierDeadlineDuty(severity, status)).toBe('MANAGER');
    expect(() => nextSupplierDeadlineStatus({ ...samePerson, status })).toThrow();
    expect(nextSupplierDeadlineStatus({ ...samePerson, status, duty: 'MANAGER' })).toBe('APPROVED');
  });

  it.each([
    ['QUALITY_PENDING', 'SQE', 'sqe'], ['MANAGER_PENDING', 'MANAGER', 'manager'],
  ] as const)('rejects minister and administrator substitution in %s', (status, duty, actorUserId) => {
    expect(() => nextSupplierDeadlineStatus(decision({ status, duty, actorUserId: 'minister' }))).toThrow('SUPPLIER_DEADLINE_ACTOR_DENIED');
    expect(() => nextSupplierDeadlineStatus(decision({ status, duty, actorUserId: 'admin' }))).toThrow('SUPPLIER_DEADLINE_ACTOR_DENIED');
    expect(() => nextSupplierDeadlineStatus(decision({ status, duty: 'MINISTER' as 'MANAGER', actorUserId }))).toThrow();
    expect(() => nextSupplierDeadlineStatus(decision({ status, duty, actorUserId: status === 'QUALITY_PENDING' ? 'manager' : 'sqe' }))).toThrow();
  });

  it.each(SUPPLIER_SEVERITIES)('%s permits SQE return but requires a new request to restart', severity => {
    const status = nextSupplierDeadlineStatus(decision({ severity, decision: 'RETURN' }));
    expect(status).toBe('RETURNED');
    expect(() => nextSupplierDeadlineStatus(decision({ severity, status }))).toThrow('SUPPLIER_DEADLINE_STATE_INVALID');
    expect(initialSupplierDeadlineStatus(severity)).toBe('QUALITY_PENDING');
  });

  it.each(['HIGH', 'CRITICAL'] as const)('%s permits manager return without falling back to SQE', severity => {
    expect(nextSupplierDeadlineStatus(decision({
      severity, status: 'MANAGER_PENDING', duty: 'MANAGER', actorUserId: 'manager', decision: 'RETURN',
    }))).toBe('RETURNED');
  });

  it.each(SUPPLIER_SEVERITIES)('%s rejects every decision on completed, returned or cancelled requests', severity => {
    for (const status of ['APPROVED', 'RETURNED', 'CANCELLED'] as const) {
      expect(supplierDeadlineDuty(severity, status)).toBeNull();
      for (const action of ['APPROVE', 'RETURN'] as const) {
        for (const duty of ['SQE', 'MANAGER'] as const) {
          expect(() => nextSupplierDeadlineStatus(decision({
            severity, status, decision: action, duty, actorUserId: duty === 'SQE' ? 'sqe' : 'manager',
          }))).toThrow('SUPPLIER_DEADLINE_STATE_INVALID');
        }
      }
    }
  });

  it.each(['URGENT', '', null, undefined])('fails closed for invalid severity %s', value => {
    const severity = value as SupplierProblemFacts['severity'];
    expect(() => initialSupplierDeadlineStatus(severity)).toThrow('SUPPLIER_DEADLINE_SEVERITY_INVALID');
    expect(() => supplierDeadlineDuty(severity, 'QUALITY_PENDING')).toThrow();
    expect(() => nextSupplierDeadlineStatus(decision({ severity }))).toThrow();
  });

  it.each(['WAITING', 'LEADER_PENDING', 'toString', '', null, undefined])('rejects invalid state %s', value => {
    const status = value as SupplierDeadlineApproval;
    expect(() => supplierDeadlineDuty('HIGH', status)).toThrow('SUPPLIER_DEADLINE_STATE_INVALID');
    expect(() => nextSupplierDeadlineStatus(decision({ status }))).toThrow();
  });

  it.each(['CANCEL', 'RESTART', 'SKIP', '', null, undefined])('rejects unsupported decision %s', value => {
    expect(() => nextSupplierDeadlineStatus(decision({
      decision: value as SupplierDeadlineDecisionInput['decision'],
    }))).toThrow('SUPPLIER_DEADLINE_ACTION_INVALID');
  });

  it.each(['', ' ', null, undefined])('does not match absent actor/duty identities %s', value => {
    expect(() => nextSupplierDeadlineStatus(decision({ actorUserId: value as string, sqeUserId: value as string }))).toThrow();
    expect(() => nextSupplierDeadlineStatus(decision({
      status: 'MANAGER_PENDING', duty: 'MANAGER', actorUserId: value as string, managerUserId: value as string,
    }))).toThrow();
  });

  it('never changes dates or input while a request or single approval is pending', () => {
    const dates = Object.freeze({ originalDueAt: '2026-10-01T00:00:00Z', requestedDueAt: '2026-11-01T00:00:00Z' });
    const input = Object.freeze(decision());
    assertSupplierDeadlineDates('ANALYSIS', dates.originalDueAt, dates.requestedDueAt);
    expect(initialSupplierDeadlineStatus(input.severity)).toBe('QUALITY_PENDING');
    expect(nextSupplierDeadlineStatus(input)).toBe('MANAGER_PENDING');
    expect(dates).toEqual({ originalDueAt: '2026-10-01T00:00:00Z', requestedDueAt: '2026-11-01T00:00:00Z' });
    expect(input).toEqual(decision());
  });
});

describe('supplier 8D explicit extension dates', () => {
  const original = '2026-10-28T00:00:00.000Z';
  const later = '2026-10-29T00:00:00.000Z';

  it.each(['ANALYSIS', 'SUBMISSION', 'CLOSURE'] as const)('accepts an explicit later %s deadline without default days', stage => {
    expect(() => assertSupplierDeadlineDates(stage, original, later)).not.toThrow();
    expect(() => assertSupplierDeadlineDates(stage, original, '2026-10-28T09:00:00+08:00')).not.toThrow();
  });

  it.each(['2026-10-27T23:59:59Z', original, '2026-10-28T08:00:00+08:00'])('rejects non-extension %s by instant rather than text order', date => {
    expect(() => assertSupplierDeadlineDates('CLOSURE', original, date)).toThrow('SUPPLIER_DEADLINE_DATE_INVALID');
  });

  it.each(['', 'not-a-date', '2026-02-30T00:00:00Z', '2026-10-29', '2026-10-29T00:00:00', null, undefined])('rejects invalid or missing original/requested date %s', value => {
    expect(() => assertSupplierDeadlineDates('ANALYSIS', value as string, later)).toThrow('SUPPLIER_DEADLINE_DATE_INVALID');
    expect(() => assertSupplierDeadlineDates('ANALYSIS', original, value as string)).toThrow('SUPPLIER_DEADLINE_DATE_INVALID');
  });

  it.each(['IMPLEMENTATION', '', null, undefined])('rejects unknown stage %s', stage => {
    expect(() => assertSupplierDeadlineDates(stage as SupplierDeadlineStage, original, later)).toThrow('SUPPLIER_DEADLINE_STAGE_INVALID');
  });
});
