import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';

describe('ingestion audit metadata stays bounded and useful', () => {
  const service = new AuditLogService({ auditEvent: { create: async () => ({}) } });
  it('retains task provenance, control reason and bounded counts without business plaintext', () => {
    const metadata = { jobId: '11111111-1111-4111-8111-111111111111', ruleId: '22222222-2222-4222-8222-222222222222', rowIndex: 0, ruleVersion: 2, receiptCount: 10, rowCount: 100, target: 'COMPONENT', result: 'AWAITING_CONFIRMATION', action: 'PAUSE', ingestionReason: '检查来源配置', enabled: true, reprocessed: false };
    expect(service.safeMetadata({ ...metadata, reason: '其他领域业务原因', body: 'private', fields: { name: 'private' }, authorization: 'Bearer private' })).toEqual(metadata);
  });
  it('rejects invalid task identities, values and free-form operation names', () => {
    expect(service.safeMetadata({ jobId: 'bad', rowIndex: -1, ruleVersion: 0, receiptCount: 100001, rowCount: Infinity, target: 'OTHER', result: 'arbitrary', action: 'execute', ingestionReason: 'x'.repeat(301), enabled: 'true', reprocessed: 1 })).toEqual({});
  });
});
