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
});
