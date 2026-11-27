import { createHash } from 'node:crypto';
import type { ProcessEightDControlledReportDto } from '../../modules/process-quality/process-eight-d-report.dto.js';
import { canonical } from '../../modules/workflow/workflow-runtime-policy.js';

export const reportPreviewFingerprintPattern = /^[a-f0-9]{64}$/;

export function reportPreviewFingerprint(report: ProcessEightDControlledReportDto): string {
  const { generatedAt: _generatedAt, previewFingerprint: _previewFingerprint, attachments, ...snapshot } = report;
  return createHash('sha256').update(canonical({ ...snapshot, attachments: [...attachments].sort((left, right) => left.id.localeCompare(right.id)) })).digest('hex');
}
