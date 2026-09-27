import { HttpException } from '@nestjs/common';

export const CONCESSION_PERMISSIONS = {
  read: 'supplier-concession:requests:read',
  write: 'supplier-concession:requests:write',
  approve: 'supplier-concession:requests:approve',
  release: 'supplier-concession:requests:release',
} as const;

export function concessionError(code: string, status = 400): never {
  throw new HttpException({ code, message: code }, status);
}

export function requiredText(value: string, maxLength: number): string {
  const result = value?.trim();
  if (!result || result.length > maxLength) concessionError('SUPPLIER_CONCESSION_INPUT_INVALID');
  return result;
}

export function validateConcessionRequest(input: { quantity: number; receivedQuantity: number; reason: string; expiresAt: Date }, now = new Date()) {
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > input.receivedQuantity) concessionError('SUPPLIER_CONCESSION_QUANTITY_INVALID');
  if (!(input.expiresAt instanceof Date) || !Number.isFinite(input.expiresAt.getTime()) || input.expiresAt <= now) concessionError('SUPPLIER_CONCESSION_EXPIRED', 409);
  return { quantity: input.quantity, reason: requiredText(input.reason, 2000) };
}
