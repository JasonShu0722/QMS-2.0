import { randomUUID } from 'node:crypto';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';

it('preserves only bounded original organization facts in authorized audit projections', () => {
  const audit = new AuditLogService({} as never), id = randomUUID();
  expect(audit.safeMetadata({ originalOrganizationId: id, originalOrganizationCode: 'QA-OLD', originalOrganizationName: 'Original organization',
    originalMetadata: { secret: 'must remain server-side' }, credential: 'secret' })).toEqual({
    originalOrganizationId: id, originalOrganizationCode: 'QA-OLD', originalOrganizationName: 'Original organization',
  });
  expect(audit.safeMetadata({ originalOrganizationId: 'invalid', originalOrganizationCode: 'x'.repeat(65), originalOrganizationName: 'x'.repeat(201) })).toEqual({});
});
