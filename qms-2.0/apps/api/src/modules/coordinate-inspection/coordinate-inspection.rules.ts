import { HttpException } from '@nestjs/common';

export const READ_PERMISSION = 'coordinate-inspection:read';
export const WRITE_PERMISSION = 'coordinate-inspection:write';
export const APPROVE_PERMISSION = 'coordinate-inspection:approve';
export const SCHEDULE_PERMISSION = 'coordinate-inspection:schedule';

export function fail(code: string, status = 400): never { throw new HttpException({ code, message: code }, status); }
export function text(value: string | undefined, max: number) { const normalized = value?.trim(); if (!normalized || normalized.length > max) fail('COORDINATE_INSPECTION_INPUT_INVALID'); return normalized; }
