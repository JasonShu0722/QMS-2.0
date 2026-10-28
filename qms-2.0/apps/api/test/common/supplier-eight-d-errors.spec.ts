import { PLATFORM_ERROR_CODES, PLATFORM_ERROR_MESSAGES } from '../../src/common/contracts/platform-error.js';

it('registers supplier document validation codes with actionable messages', () => {
  const messages: Readonly<Record<string, string>> = PLATFORM_ERROR_MESSAGES;
  for (const code of ['SUPPLIER_EIGHT_D_DOCUMENT_INVALID', 'SUPPLIER_EIGHT_D_ANALYSIS_INCOMPLETE', 'SUPPLIER_EIGHT_D_SUBMISSION_INCOMPLETE']) {
    expect(PLATFORM_ERROR_CODES).toContain(code);
    expect(messages[code]).toMatch(/请/);
  }
});

it('keeps supplier lifecycle/report failures actionable instead of reducing them to a generic HTTP code', () => {
  const messages: Readonly<Record<string, string>> = PLATFORM_ERROR_MESSAGES;
  const codes = ['DUE_AT_INVALID', 'DUE_AT_REQUIRED', 'EVIDENCE_CHANGED', 'EVIDENCE_INVALID', 'EVIDENCE_NOT_CLEAN',
    'EXTENSION_REQUIRED', 'REQUIRED', 'RESPONDER_INVALID', 'SQE_ASSIGNMENT_INVALID',
    ...['APPROVED_UNAVAILABLE', 'REVISION_NOT_FOUND', 'SNAPSHOT_INVALID', 'VERSION_CONFLICT', 'PRIVATE_SUPPLEMENT',
      'ACCESS_DENIED', 'EVIDENCE_DENIED', 'EVIDENCE_UNAVAILABLE', 'EVIDENCE_UNPINNED', 'EVIDENCE_LIMIT',
      'IMAGE_INVALID', 'IMAGE_LIMIT', 'PDF_LIMIT', 'OBJECT_INVALID', 'QUERY_INVALID', 'RENDER_FAILED', 'STORAGE_UNAVAILABLE']
      .map(code => `REPORT_${code}`)];
  for (const suffix of codes) {
    const code = `SUPPLIER_EIGHT_D_${suffix}`;
    expect(PLATFORM_ERROR_CODES).toContain(code);
    expect(messages[code]).toMatch(/[\u3400-\u9fff]/);
  }
});
