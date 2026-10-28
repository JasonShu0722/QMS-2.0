import { randomUUID } from 'node:crypto';
import { emptyProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import { supplierEightDReportModel } from '../../src/modules/supplier-quality/supplier-eight-d-report.model.js';

import { id, revisionId, reportRead } from './supplier-eight-d-report.fixture.js';

it('distinguishes current, pending, approved, historical and private post-close supplements', () => {
  const value = reportRead();
  expect(supplierEightDReportModel(value, {}, false).status).toBe('DRAFT');
  value.inReview = true;
  expect(supplierEightDReportModel(value, {}, false).status).toBe('IN_REVIEW');
  value.record.control.closedAt = new Date(); value.record.control.approvedRevisionId = revisionId;
  expect(supplierEightDReportModel(value, {}, false)).toMatchObject({ status: 'CLOSED_SUPPLEMENT', view: 'CURRENT' });
  value.revision = { id: revisionId };
  expect(supplierEightDReportModel(value, { view: 'APPROVED' }, false)).toMatchObject({ status: 'APPROVED', view: 'APPROVED', revisionId });
  expect(supplierEightDReportModel(value, { revisionId }, false)).toMatchObject({ status: 'HISTORICAL', view: 'HISTORICAL', revisionId, contentVersion: 2, rowVersion: 3 });
});

it('fails closed on absent approval, wrong revision, malformed or oversized historical documents', () => {
  const value = reportRead();
  expect(() => supplierEightDReportModel(value, { view: 'APPROVED' }, false)).toThrow('SUPPLIER_EIGHT_D_REPORT_APPROVED_UNAVAILABLE');
  expect(() => supplierEightDReportModel(value, { revisionId }, false)).toThrow('SUPPLIER_EIGHT_D_REPORT_VERSION_CONFLICT');
  (value.snapshot as any).document.extraSecret = 'not supported';
  expect(() => supplierEightDReportModel(value, {}, false)).toThrow('SUPPLIER_EIGHT_D_REPORT_SNAPSHOT_INVALID');
  (value.snapshot as any).document = { ...emptyProcessEightDDocument(), okFileIds: Array.from({ length: 100 }, randomUUID), ngFileIds: [randomUUID()] };
  expect(() => supplierEightDReportModel(value, {}, false)).toThrow('SUPPLIER_EIGHT_D_REPORT_EVIDENCE_LIMIT');
});

it('never exposes current internal supplements or internal source/extra fields to a supplier', () => {
  const value = reportRead(); value.record.control.closedAt = new Date(); value.record.control.approvedRevisionId = revisionId;
  expect(() => supplierEightDReportModel(value, {}, true)).toThrow('SUPPLIER_EIGHT_D_REPORT_PRIVATE_SUPPLEMENT');
  value.revision = { id: revisionId };
  Object.assign(value.snapshot as object, { privateNotes: 'INTERNAL_SECRET', sources: [{ sourceSnapshot: { vin: 'INTERNAL_VIN' } }] });
  const output = supplierEightDReportModel(value, {}, true);
  expect(output).toMatchObject({ status: 'APPROVED', view: 'APPROVED', supplierProblemId: id });
  expect(output.snapshot.sources).toEqual([]);
  expect(JSON.stringify(output)).not.toContain('INTERNAL_SECRET');
  expect(JSON.stringify(output)).not.toContain('INTERNAL_VIN');
  value.privateSupplementFileIds = [randomUUID()];
  expect(() => supplierEightDReportModel(value, {}, true)).toThrow('SUPPLIER_EIGHT_D_REPORT_PRIVATE_SUPPLEMENT');
});

it.each(['rowVersion', 'contentVersion', 'problem', 'instance', 'deadlines', 'ownerUserId', 'professionalUserId',
  'responsibleSectionDepartmentId', 'analysisCompletedAt', 'submittedAt', 'collaboratorUserIds', 'sources'])('fails closed when fixed history lacks %s', field => {
  const value = reportRead(); value.revision = { id: revisionId }; delete (value.snapshot as any)[field];
  expect(() => supplierEightDReportModel(value, { revisionId }, false)).toThrow('SUPPLIER_EIGHT_D_REPORT_SNAPSHOT_INVALID');
});

it.each(['problem.createdAt', 'problem.closedAt', 'instance.version', 'deadlines.analysisDueAt', 'deadlines.submissionDueAt', 'deadlines.closureDueAt'])('never fills missing historical %s from current record data', path => {
  const value = reportRead(); value.revision = { id: revisionId };
  const [parent, key] = path.split('.'); delete (value.snapshot as any)[parent!][key!];
  expect(() => supplierEightDReportModel(value, { revisionId }, false)).toThrow('SUPPLIER_EIGHT_D_REPORT_SNAPSHOT_INVALID');
});

it.each([null, '2026-10-28T09:12:34.567Z'])('keeps the actual current internal supplement timestamp %s without copying arbitrary fields', supplementUpdatedAt => {
  const value = reportRead(); value.record.control.closedAt = new Date();
  Object.assign((value.snapshot as any).problem, { supplementUpdatedAt, privateNotes: 'PRIVATE_REPORT_FACT' });
  const output = supplierEightDReportModel(value, {}, false);
  expect(output.snapshot.problem.supplementUpdatedAt).toBe(supplementUpdatedAt);
  expect(output.snapshot.problem).not.toHaveProperty('privateNotes');
  expect(output.generatedAt).not.toBe(supplementUpdatedAt);
});

it.each(['bad-date', 123, {}, []])('rejects an invalid current supplement timestamp %j', supplementUpdatedAt => {
  const value = reportRead(); value.record.control.closedAt = new Date();
  Object.assign((value.snapshot as any).problem, { supplementUpdatedAt });
  expect(() => supplierEightDReportModel(value, {}, false)).toThrow('SUPPLIER_EIGHT_D_REPORT_SNAPSHOT_INVALID');
});

it('does not put a present-day supplement timestamp in an open, approved, historical or supplier snapshot', () => {
  const value = reportRead();
  Object.assign((value.snapshot as any).problem, { supplementUpdatedAt: '2026-10-28T09:12:34.567Z' });
  expect(supplierEightDReportModel(value, {}, false).snapshot.problem).not.toHaveProperty('supplementUpdatedAt');
  value.record.control.closedAt = new Date(); value.record.control.approvedRevisionId = revisionId; value.revision = { id: revisionId };
  for (const supplier of [false, true]) {
    expect(supplierEightDReportModel(value, { view: 'APPROVED' }, supplier).snapshot.problem).not.toHaveProperty('supplementUpdatedAt');
    expect(supplierEightDReportModel(value, { revisionId }, supplier).snapshot.problem).not.toHaveProperty('supplementUpdatedAt');
  }
});
