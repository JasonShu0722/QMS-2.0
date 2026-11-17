import { expect, it } from '@jest/globals';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';

const service = new AuditLogService({ auditEvent: { create: async () => undefined } });

it('retains only supported AI protocol names and excludes credentials and prompt data', () => {
  for (const protocol of ['OPENAI_CHAT_COMPLETIONS', 'OPENAI_RESPONSES', 'ANTHROPIC_MESSAGES', 'GEMINI_GENERATE_CONTENT']) {
    expect(service.safeMetadata({ protocol, apiKey: 'private', prompt: 'private', inputFields: 'private' })).toEqual({ protocol });
  }
  expect(service.safeMetadata({ protocol: 'private-provider-text' })).toEqual({});
});

it('retains a published application version without arbitrary application content', () => {
  expect(service.safeMetadata({ publishedVersion: 2, prompt: 'private' })).toEqual({ publishedVersion: 2 });
  for (const publishedVersion of [0, -1, 1.5, 2147483648]) expect(service.safeMetadata({ publishedVersion })).toEqual({});
});
