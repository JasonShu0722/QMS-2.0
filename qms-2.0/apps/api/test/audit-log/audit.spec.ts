import { jest } from '@jest/globals';
import {
  AuditLogService,
  SECURITY_AUDIT_ACTIONS,
} from '../../src/modules/audit-log/audit-log.service.js';

describe('audit log foundation', () => {
  it('records security audit events in the provided transaction with safe metadata only', async () => {
    const tx = {
      auditEvent: {
        create: jest.fn().mockResolvedValue({ id: 'audit-event-id' }),
      },
    };
    const service = new AuditLogService({} as never);

    await service.record(
      {
        actorUserId: '10000000-0000-4000-8000-000000000001',
        organizationId: '20000000-0000-4000-8000-000000000001',
        action: 'ATTACHMENT_UPLOAD_INITIALIZED',
        resourceType: 'FileObject',
        resourceId: 'file-1',
        outcome: 'SUCCESS',
        traceId: 'trace-audit-1',
        metadata: {
          contentType: 'application/pdf',
          sizeBytes: 12345,
          sha256: 'a'.repeat(64),
          originalName: 'customer-complaint.pdf',
          objectKey: 'customer-complaint.pdf',
          cookie: 'qms_session=raw',
          password: 'plain-text',
          sessionId: 'database-session-id',
          signedUrl: 'https://storage.example.test/signed',
          accessKey: 'minio',
          secretKey: 'secret',
        },
      },
      tx as never,
    );

    const data = tx.auditEvent.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      actorUserId: '10000000-0000-4000-8000-000000000001',
      organizationId: '20000000-0000-4000-8000-000000000001',
      action: 'ATTACHMENT_UPLOAD_INITIALIZED',
      resourceType: 'FileObject',
      resourceId: 'file-1',
      outcome: 'SUCCESS',
      traceId: 'trace-audit-1',
    });
    expect(data.metadata).toEqual({
      contentType: 'application/pdf',
      sizeBytes: 12345,
      sha256: 'a'.repeat(64),
    });
    expect(JSON.stringify(data.metadata)).not.toMatch(
      /cookie|password|session|signed|customer-complaint|accessKey|secretKey/i,
    );
  });

  it('publishes the required phase 1 security audit actions', () => {
    expect(SECURITY_AUDIT_ACTIONS).toEqual(
      expect.arrayContaining([
        'LOGIN_FAILED',
        'PASSWORD_RESET_REQUESTED',
        'PERMISSION_CHANGED',
        'SESSION_REVOKED',
        'ATTACHMENT_UPLOAD_INITIALIZED',
        'ACTION_REJECTED',
      ]),
    );
  });

  it('allows only controlled profile field names in changedFields and discards profile values', () => {
    const service = new AuditLogService({} as never);
    expect(service.safeMetadata({ changedFields: 'fullName,phone,email', resourceVersion: 2, fullName: 'Private name', phone: 'Private extension' })).toEqual({ changedFields: 'fullName,phone,email', resourceVersion: 2 });
    for (const changedFields of ['phone=Private extension', 'Private name', ['phone'], { phone: 'Private extension' }, 'phone,organizationId']) {
      expect(service.safeMetadata({ changedFields })).toEqual({});
    }
  });

  it('audits the factory field name only on successful process defect writes', () => {
    const service = new AuditLogService({ auditEvent: { create: jest.fn() } });
    const event = { action: 'PROCESS_DEFECT_INGESTION_UPDATED', resourceType: 'ProcessDefect', outcome: 'SUCCESS' };
    expect(service.safeMetadata({ changedFields: 'factoryCode', rawFactory: 'unexpected' }, event)).toEqual({ changedFields: 'factoryCode' });
    expect(service.safeMetadata({ changedFields: 'factoryCode,rawFactory' }, event)).toEqual({});
    expect(service.safeMetadata({ changedFields: 'factoryCode' }, { ...event, outcome: 'DENIED' })).toEqual({});
    expect(service.safeMetadata({ changedFields: 'factoryCode' }, { ...event, resourceType: 'Profile' })).toEqual({});
  });

  it('allowlists only bounded trial metadata on completed application audit outcomes', () => {
    const service = new AuditLogService({} as never);
    const event = { action: 'AI_APPLICATION_TESTED', resourceType: 'AiApplication', outcome: 'SUCCESS' };
    const metadata = { connectionId: '10000000-0000-4000-8000-000000000001', connectionVersion: 3, model: 'vendor/model-1:stable', outputMode: 'JSON' };
    expect(service.safeMetadata({ ...metadata, bindings: [{ path: 'private' }], sample: 'private', resultText: 'private', durationMs: 50 }, event)).toEqual(metadata);
    expect(service.safeMetadata(metadata, { ...event, outcome: 'FAILURE' })).toEqual(metadata);
    expect(service.safeMetadata(metadata, { ...event, outcome: 'DENIED' })).toEqual({});
    expect(service.safeMetadata(metadata, { ...event, action: 'AI_APPLICATION_CREATED' })).toEqual({});
    expect(service.safeMetadata({ connectionId: 'bad ID', connectionVersion: '3', model: 'a'.repeat(121), outputMode: ['JSON'] }, event)).toEqual({});
    expect(service.safeMetadata({ connectionVersion: 2147483648, model: 'contains space', outputMode: 'XML' }, event)).toEqual({});
  });

  it('preserves bounded structure snapshots and the initializer role ID, never arbitrary metadata or secrets', () => {
    const service = new AuditLogService({} as never);
    const snapshot = { structureCode: 'QMS-2.0', structurePreviousCode: 'QMS_OLD', structureName: 'Quality department', structurePreviousName: 'Former department name', structureGovernorRoleId: '10000000-0000-4000-8000-000000000001' };
    expect(service.safeMetadata({ ...snapshot, secret: 'private', password: 'private', cookie: 'private', structurePassword: 'private', snapshot: { password: 'private' } })).toEqual(snapshot);
    expect(service.safeMetadata({ structureCode: 'bad/code', structurePreviousCode: 'a'.repeat(65), structureName: 'n'.repeat(201), structureGovernorRoleId: 'not-a-role-id' })).toEqual({});
    expect(service.safeMetadata({ structureCode: null, structurePreviousCode: true, structureName: {}, structureGovernorRoleId: [] })).toEqual({});
    for (const structurePreviousName of ['', ' ', 'n'.repeat(201), null, false, ['name'], { name: 'private' }]) {
      expect(service.safeMetadata({ structurePreviousName })).toEqual({});
    }
  });
});
