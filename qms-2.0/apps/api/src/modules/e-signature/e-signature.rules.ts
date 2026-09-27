import { HttpException } from '@nestjs/common';

export const SIGNATURE_READ_PERMISSION = 'e-signature:signatures:read';
export const SIGNATURE_WRITE_PERMISSION = 'e-signature:signatures:write';
export const APPROVAL_READ_PERMISSION = 'e-signature:approvals:read';
export const APPROVAL_SIGN_PERMISSION = 'e-signature:approvals:sign';

export function fail(code: string, status = 400): never { throw new HttpException({ code, message: code }, status); }
export function normalizeText(value: string | undefined, max: number, code = 'E_SIGNATURE_INPUT_INVALID') { const normalized = value?.trim(); if (!normalized || normalized.length > max) fail(code); return normalized; }
export function normalizeSignatureData(value: string) { const normalized = value.trim(); if (normalized.length < 16 || normalized.length > 100_000) fail('E_SIGNATURE_DATA_INVALID'); return normalized; }
