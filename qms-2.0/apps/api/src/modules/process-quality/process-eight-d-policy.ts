import { HttpException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isUUID } from 'class-validator';
import { canonical } from '../workflow/workflow-runtime-policy.js';
import type { ProcessEightDSourceConfirmation, ProcessEightDSourceInput } from './process-eight-d.types.js';

export function eightDError(code: string, status: number): never { throw new HttpException({ code, message: code }, status); }
export function eightDRequestDigest(input: unknown): string {
  // JSON conversion preserves chosen Date values; the generic workflow canonicalizer sees Date as an empty object.
  return createHash('sha256').update(canonical(JSON.parse(JSON.stringify(input)))).digest('hex');
}

export function assertEightDSources(sources: readonly ProcessEightDSourceInput[]): void {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 100
    || sources.some(s => !s || typeof s !== 'object')
    || new Set(sources.map(s => s.defectId)).size !== sources.length
    || sources.some(s => !isUUID(s.defectId) || !Number.isSafeInteger(s.expectedVersion) || s.expectedVersion < 1)) eightDError('PROCESS_EIGHT_D_SOURCES_INVALID', 400);
}

export function assertSourceConfirmation(defectId: string, relatedProblemIds: readonly string[], confirmations: readonly ProcessEightDSourceConfirmation[]): void {
  const matches = confirmations.filter(c => c.defectId === defectId);
  if (!relatedProblemIds.length && !matches.length) return;
  const confirmation = matches[0];
  if (matches.length !== 1 || !confirmation || !['RECURRENCE', 'NOT_RECURRENCE'].includes(confirmation.recurrence)
    || !Array.isArray(confirmation.relatedProblemIds) || confirmation.relatedProblemIds.length > 100
    || new Set(confirmation.relatedProblemIds).size !== confirmation.relatedProblemIds.length
    || confirmation.relatedProblemIds.some(id => typeof id !== 'string' || !isUUID(id))
    || confirmation.reason !== undefined && (typeof confirmation.reason !== 'string' || confirmation.reason.length > 2000)
    || JSON.stringify([...new Set(confirmation.relatedProblemIds)].sort()) !== JSON.stringify([...new Set(relatedProblemIds)].sort())) {
    eightDError('PROCESS_EIGHT_D_SOURCE_CONFIRMATION_REQUIRED', 409);
  }
}
