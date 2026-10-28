import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SupplierEightDDeadlineRequestDto, SupplierEightDDeadlineDecisionDto, SupplierEightDDeadlineCancelDto } from '../../src/modules/supplier-quality/supplier-eight-d-deadline.dto.js';

const request = { stage: 'ANALYSIS', requestedDueAt: '2026-11-07T00:00:00Z', reason: 'Supplier needs verification time',
  expectedRowVersion: 1, expectedContentVersion: 2, expectedInstanceVersion: 3 };
const decision = { expectedVersion: 1, duty: 'SQE', decision: 'APPROVE', comment: 'Evidence reviewed' };
const errors = (type: new () => object, value: object) => validateSync(plainToInstance(type, value), { whitelist: true, forbidNonWhitelisted: true });

describe('supplier 8D dedicated deadline HTTP input', () => {
  it('accepts the real supplier request with three explicit server versions', () => {
    expect(errors(SupplierEightDDeadlineRequestDto, request)).toHaveLength(0);
  });
  it.each(['ANALYSIS', 'SUBMISSION', 'CLOSURE'])('accepts fixed stage %s', stage => {
    expect(errors(SupplierEightDDeadlineRequestDto, { ...request, stage })).toHaveLength(0);
  });
  it.each(['unknown', null, 'analysis'])('rejects invalid stage %s', stage => {
    expect(errors(SupplierEightDDeadlineRequestDto, { ...request, stage }).map(e => e.property)).toContain('stage');
  });
  it.each(['2026-11-07', '2026-11-07T00:00:00', '2026-02-30T00:00:00Z', 'invalid'])('rejects nonabsolute or invalid date %s', requestedDueAt => {
    expect(errors(SupplierEightDDeadlineRequestDto, { ...request, requestedDueAt }).map(e => e.property)).toContain('requestedDueAt');
  });
  it.each(['expectedRowVersion', 'expectedContentVersion', 'expectedInstanceVersion'])('requires bounded integer %s', field => {
    for (const value of [0, -1, 1.5, 2147483648, '1', null, undefined]) {
      expect(errors(SupplierEightDDeadlineRequestDto, { ...request, [field]: value }).map(e => e.property)).toContain(field);
    }
  });
  it.each(['', '   ', 'x'.repeat(2001), null])('requires a nonblank bounded reason', reason => {
    expect(errors(SupplierEightDDeadlineRequestDto, { ...request, reason }).map(e => e.property)).toContain('reason');
  });
  it('rejects client-selected approvers and server snapshot injection', () => {
    for (const key of ['sqeUserId', 'managerUserId', 'severity', 'originalDueAt', 'context', 'applicantUserId']) {
      expect(errors(SupplierEightDDeadlineRequestDto, { ...request, [key]: 'untrusted' }).map(e => e.property)).toContain(key);
    }
  });
  it.each(['SQE', 'MANAGER'])('accepts one explicit duty %s', duty => {
    expect(errors(SupplierEightDDeadlineDecisionDto, { ...decision, duty })).toHaveLength(0);
  });
  it.each([{ duty: 'MINISTER' }, { duty: ['SQE', 'MANAGER'] }, { decision: 'CANCEL' }, { comment: '   ' }, { expectedVersion: 0 }])('rejects invalid decision %p', patch => {
    expect(errors(SupplierEightDDeadlineDecisionDto, { ...decision, ...patch }).length).toBeGreaterThan(0);
  });
  it('accepts applicant cancellation with a reason and version, not an approval duty', () => {
    expect(errors(SupplierEightDDeadlineCancelDto, { expectedVersion: 1, comment: 'No longer needed' })).toHaveLength(0);
    expect(errors(SupplierEightDDeadlineCancelDto, { expectedVersion: 1, comment: 'No longer needed', duty: 'SQE' }).map(e => e.property)).toContain('duty');
  });
});
