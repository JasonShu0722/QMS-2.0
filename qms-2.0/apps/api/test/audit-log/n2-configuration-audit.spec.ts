import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { auditActionLabel } from '../../src/modules/audit-log/audit-event-read-model.js';

describe('N2 configuration audit metadata', () => {
  const audit = new AuditLogService({} as never);
  const id = 'd15a8cb5-dcca-4eb8-a18e-dab91321453a';

  it('retains bounded mapping identity and before/after values, without accepting arbitrary payloads', () => {
    const metadata = {
      componentProjectId: id, componentProjectCode: 'P-001', previousComponentProjectCode: 'P-000',
      componentProjectName: 'Project one', previousComponentProjectName: 'Original project',
      componentProjectStage: 'MASS_PRODUCTION', previousComponentProjectStage: 'NEW_PRODUCT',
      customerEngineerAssignmentId: id, previousCustomerEngineerAssignmentId: null,
      projectEngineerAssignmentId: null, previousProjectEngineerAssignmentId: id,
      componentCode: 'CONTROL-001', previousComponentCode: 'CONTROL-000',
      projectRecordId: id, previousProjectRecordId: id,
      productCategory: 'Controller', previousProductCategory: 'PCBA',
      productSubcategory: 'Control board', previousProductSubcategory: null,
      previousStatus: 'ACTIVE', resourceVersion: 2,
    };
    expect(audit.safeMetadata({ ...metadata, password: 'secret', fullPayload: { private: 'data' } })).toEqual(metadata);
    expect(audit.safeMetadata({ componentProjectId: 'not-a-uuid', componentCode: 'x'.repeat(101),
      componentProjectStage: 'UNKNOWN', previousStatus: 'OTHER', productCategory: '   ',
      componentProjectName: 'x'.repeat(201), projectRecordId: {}, productSubcategory: [] })).toEqual({});
  });

  it.each(['COMPONENT_PROJECT_CREATED', 'COMPONENT_PROJECT_UPDATED', 'COMPONENT_PROJECT_MAPPING_CREATED', 'COMPONENT_PROJECT_MAPPING_UPDATED'])('explains %s without exposing an unexplained operation code', (action) => {
    expect(auditActionLabel(action)).not.toBe(action);
  });

  it('counts configuration text like the DTO and PostgreSQL instead of UTF-16 code units', () => {
    const name = '\u{20000}'.repeat(200);
    const category = '\u{20000}'.repeat(100);
    const metadata = { componentProjectName: name, previousComponentProjectName: name,
      componentCode: category, previousComponentCode: category, productCategory: category };
    expect(audit.safeMetadata(metadata)).toEqual(metadata);
    expect(audit.safeMetadata({ componentProjectName: `${name}x`, productCategory: `${category}x` })).toEqual({});
  });

  it('retains component names and explicit clearing without admitting oversized import data', () => {
    const metadata = { componentName: null, previousComponentName: '\u{20000}'.repeat(200),
      projectRecordId: null, previousProjectRecordId: null, productCategory: null, previousProductCategory: null };
    expect(audit.safeMetadata(metadata)).toEqual(metadata);
    expect(audit.safeMetadata({ componentName: 'x'.repeat(201), previousComponentName: {} })).toEqual({});
  });

  it.each(['COMPONENT_PROJECT_IMPORT', 'COMPONENT_PROJECT_IMPORT_ROW', 'COMPONENT_PROJECT_BULK_UPDATED'])('explains %s without exposing an unexplained operation code', (action) => {
    expect(auditActionLabel(action)).not.toBe(action);
  });

  it('retains bounded management provenance and effective periods', () => {
    const metadata = {
      departmentId: id, sectionDepartmentId: id, positionId: id, previousPositionId: id,
      ministerAssignmentId: id, previousMinisterAssignmentId: id, previousSectionDepartmentId: id,
      bindingId: id, bindingVersion: 2, previousResourceVersion: 1, responsibility: 'MINISTER',
      validFrom: '2026-10-25T00:00:00.000Z', previousValidFrom: '2026-10-24T00:00:00.000Z',
      validTo: null, previousValidTo: '2026-11-25T00:00:00.000Z',
    };
    expect(audit.safeMetadata(metadata)).toEqual(metadata);
    expect(audit.safeMetadata({ departmentId: 'other', ministerAssignmentId: null, responsibility: 'ADMIN',
      bindingVersion: 0, previousResourceVersion: 1.5, validFrom: 'yesterday',
      validTo: '2026-02-30T00:00:00.000Z', previousValidFrom: {}, previousValidTo: [] })).toEqual({});
  });

  it.each(['MANAGEMENT_BINDING_CREATED', 'MANAGEMENT_BINDING_UPDATED', 'MINISTER_SCOPE_CREATED', 'MINISTER_SCOPE_UPDATED'])('explains %s without exposing an unexplained operation code', (action) => {
    expect(auditActionLabel(action)).not.toBe(action);
  });
});
